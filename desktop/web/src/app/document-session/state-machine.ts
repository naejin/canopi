import { message } from "@tauri-apps/plugin-dialog";
import {
  CanvasAuthorityBusyError,
  type CanvasDocumentSurface,
} from "../../canvas/runtime/runtime";
import { getCurrentCanvasDocumentSurface } from "../../canvas/session";
import * as designIpc from "../../ipc/design";
import { t } from "../../i18n";
import type { CanopiFile } from "../../types/design";
import {
  designSessionStore,
  type PersistenceCapableDesignSessionStore,
} from "./store";
import {
  createDesignSessionPersistence,
  settleWrittenDesignOperation,
  type DesignRecoveryOperation,
  type DesignReplacementGuard,
  type DesignSaveSettlement,
  type DesignSessionPersistence,
} from "./persistence";
import {
  createDesignSessionReplacement,
  type DesignSessionPendingCanvasReplacementIdentity,
  type DesignSessionReplacement,
} from "./replacement";
import { DESIGN_SESSION_WORKFLOWS } from "./workflows";
import {
  createDesignSessionWorkflowRunner,
  type DesignSessionWorkflowRunner,
} from "./workflow-runner";

export type DocumentTransitionSource =
  | "new"
  | "open-path"
  | "open-dialog"
  | "template"
  | "queued-path"
  | "queued-template"
  | "mount-existing";

export type DirtyGuardMode = "confirm" | "skip";

export interface DocumentTransitionLoadResult {
  file: CanopiFile;
  path: string | null;
  name: string;
}

export interface DocumentTransitionRequest {
  source: DocumentTransitionSource;
  dirtyGuard: DirtyGuardMode;
  session?: CanvasDocumentSurface | null;
  load: () => Promise<DocumentTransitionLoadResult>;
  isCancelled?: () => boolean;
  deferWhenDetachedAndEmpty?: () => void;
}

export type DocumentTransitionStatus = "applied" | "cancelled" | "queued" | "failed";

export interface DocumentTransitionResult {
  status: DocumentTransitionStatus;
  documentLoaded: boolean;
  error?: unknown;
}

export interface SaveCurrentDesignOptions {
  session?: CanvasDocumentSurface | null;
}

export interface QueuedDocumentLoadOptions {
  onResult?: (result: DocumentTransitionResult) => void;
}

export type DesignSessionStateStatus =
  | "detached-empty"
  | "detached-ready"
  | "attached-empty"
  | "attached-ready"
  | "loading"
  | "saving"
  | "autosaving"
  | "tearing-down"
  | "failed";

export interface DesignSessionState {
  readonly status: DesignSessionStateStatus;
  readonly attached: boolean;
  readonly documentLoaded: boolean;
  readonly operation: DocumentTransitionSource | "save" | "save-as" | "autosave" | "teardown" | null;
  readonly error?: unknown;
}

export interface AutosaveDesignSessionOptions {
  readonly session: CanvasDocumentSurface;
  readonly runtimeInitialized: boolean;
  readonly logError: (message?: unknown, ...optionalParams: unknown[]) => void;
}

export interface TeardownDesignSessionOptions {
  readonly session: CanvasDocumentSurface;
  readonly runtimeInitialized: boolean;
  readonly logError: (message?: unknown, ...optionalParams: unknown[]) => void;
}

export interface DesignSessionStateMachineDeps {
  readonly store: PersistenceCapableDesignSessionStore;
  readonly getCurrentSession: () => CanvasDocumentSurface | null;
  readonly saveDesign: typeof designIpc.saveDesign;
  readonly saveDesignAs: typeof designIpc.saveDesignAs;
  readonly loadDesign: typeof designIpc.loadDesign;
  readonly autosaveDesign: typeof designIpc.autosaveDesign;
  readonly showMessage: typeof message;
  readonly translate: typeof t;
  readonly persistence: DesignSessionPersistence;
  readonly workflowRunner: DesignSessionWorkflowRunner;
}

type ReplacementDecision = "proceed" | "cancel";

class DesignSessionTransitionSupersededError extends Error {
  constructor() {
    super("Document transition was superseded");
    this.name = "DesignSessionTransitionSupersededError";
  }
}

const INITIAL_STATE: DesignSessionState = {
  status: "detached-empty",
  attached: false,
  documentLoaded: false,
  operation: null,
};

const DEFAULT_DEPS: Omit<DesignSessionStateMachineDeps, "persistence"> = {
  store: designSessionStore,
  getCurrentSession: getCurrentCanvasDocumentSurface,
  saveDesign: (path, content) => designIpc.saveDesign(path, content),
  saveDesignAs: (content) => designIpc.saveDesignAs(content),
  loadDesign: (path) => designIpc.loadDesign(path),
  autosaveDesign: (content, path) => designIpc.autosaveDesign(content, path),
  showMessage: (text, options) => message(text, options),
  translate: t,
  workflowRunner: createDesignSessionWorkflowRunner(DESIGN_SESSION_WORKFLOWS),
};

export class DesignSessionStateMachine {
  private state: DesignSessionState = INITIAL_STATE;
  private stateEpoch = 0;
  private transitionIntent = 0;
  private readonly replacement: DesignSessionReplacement;
  private retainedReplacementAuthorization: {
    readonly canvas: CanvasDocumentSurface;
    readonly identity: DesignSessionPendingCanvasReplacementIdentity;
    readonly isDesignBaselineCurrent: () => boolean;
  } | null = null;

  constructor(private readonly deps: DesignSessionStateMachineDeps) {
    this.replacement = createDesignSessionReplacement({
      store: deps.store,
      workflowRunner: deps.workflowRunner,
    });
  }

  getState(): DesignSessionState {
    return this.state;
  }

  captureCurrentDesignObservation(
    session = this.deps.getCurrentSession(),
  ): CanopiFile | null {
    return this.deps.persistence.captureObservation(session);
  }

  resetState(): void {
    this.transitionIntent += 1;
    this.retainedReplacementAuthorization = null;
    this.deps.persistence.dispose();
    this.publishState(INITIAL_STATE);
  }

  async startAttachedDesignSession(
    session: CanvasDocumentSurface,
  ): Promise<DocumentTransitionResult | null> {
    const canvasLease = this.deps.persistence.attachCanvas(session);
    if (!this.deps.store.hasCurrentDesign()) {
      this.beginEmptyDocumentSession(session);
      return null;
    }

    const intent = ++this.transitionIntent;
    this.publishState(this.operationState("loading", "mount-existing", session));
    try {
      this.replacement.attach(session);
      this.retainedReplacementAuthorization = null;
      canvasLease.assertCurrent();
      if (intent === this.transitionIntent) {
        this.publishState(this.steadyStateFor(session));
      }
      return {
        status: "applied",
        documentLoaded: session.hasLoadedDocument(),
      };
    } catch (error) {
      if (intent === this.transitionIntent && canvasLease.isCurrent()) {
        this.publishState({
          ...this.operationState("failed", "mount-existing", session),
          error,
        });
      }
      return {
        status: "failed",
        documentLoaded: session.hasLoadedDocument(),
        error,
      };
    }
  }

  beginEmptyDocumentSession(session: CanvasDocumentSurface): void {
    this.transitionIntent += 1;
    this.deps.persistence.attachCanvas(session);
    this.publishState({
      status: "attached-empty",
      attached: true,
      documentLoaded: session.hasLoadedDocument(),
      operation: null,
    });
    this.replacement.attach(session);
  }

  async saveCurrentDesign(
    options: SaveCurrentDesignOptions = {},
  ): Promise<DesignSaveSettlement | null> {
    const session = this.sessionForOption(options.session);
    if (session) this.deps.persistence.attachCanvas(session);
    const stateEpoch = this.publishState(this.operationState("saving", "save", session));
    try {
      if (this.deps.store.readDesignPath()) {
        const save = this.deps.persistence.beginSave();
        try {
          await this.deps.saveDesign(save.destinationPath, save.content);
        } catch (error) {
          save.fail(error);
          throw error;
        }
        return settleWrittenDesignOperation(save);
      }
      const saveAs = this.deps.persistence.beginSaveAs();
      let savedPath: string;
      try {
        savedPath = await this.deps.saveDesignAs(saveAs.content);
      } catch (error) {
        saveAs.fail(error);
        throw error;
      }
      return settleWrittenDesignOperation({
        succeed: () => saveAs.succeed(savedPath),
      });
    } finally {
      this.finishState(stateEpoch, this.steadyStateFor(session));
    }
  }

  async saveAsCurrentDesign(
    options: SaveCurrentDesignOptions = {},
  ): Promise<DesignSaveSettlement | null> {
    const session = this.sessionForOption(options.session);
    if (session) this.deps.persistence.attachCanvas(session);
    const stateEpoch = this.publishState(this.operationState("saving", "save-as", session));
    try {
      const saveAs = this.deps.persistence.beginSaveAs();
      let path: string;
      try {
        path = await this.deps.saveDesignAs(saveAs.content);
      } catch (error) {
        saveAs.fail(error);
        if (isCancelled(error)) return null;
        throw error;
      }
      return settleWrittenDesignOperation({
        succeed: () => saveAs.succeed(path),
      });
    } finally {
      this.finishState(stateEpoch, this.steadyStateFor(session));
    }
  }

  async transitionDocument(
    request: DocumentTransitionRequest,
  ): Promise<DocumentTransitionResult> {
    const session = this.sessionForTransition(request);
    let canvasLease: ReturnType<DesignSessionPersistence["attachCanvas"]> | null = null;
    let replacementGuard: DesignReplacementGuard | null = null;
    let retainedReplacementRetry = false;
    let retainedReplacementWasAuthorized = false;
    let retainedReplacementDesignWasApplied = false;
    let retainedReplacementIdentity: DesignSessionPendingCanvasReplacementIdentity | null = null;
    let designBaselineIsCurrent = () => false;
    let intent: number | null = null;
    const transitionIsCurrent = () => intent !== null
      && intent === this.transitionIntent
      && canvasLease?.isCurrent() === true;
    const replacementIsCurrent = () => transitionIsCurrent()
      && replacementGuard?.isCurrent() === true;
    const assertReplacementCurrent = () => {
      if (!replacementIsCurrent()) throw new DesignSessionTransitionSupersededError();
    };
    const assertReplacementAttemptCurrent = () => {
      if (retainedReplacementRetry) {
        if (!transitionIsCurrent() || !designBaselineIsCurrent()) {
          throw new DesignSessionTransitionSupersededError();
        }
        return;
      }
      assertReplacementCurrent();
    };

    try {
      canvasLease = session
        ? this.deps.persistence.attachCanvas(session)
        : this.deps.persistence.acquireDetachedCanvasLease();
      intent = ++this.transitionIntent;
      if (!session && !this.deps.store.hasCurrentDesign() && request.deferWhenDetachedAndEmpty) {
        request.deferWhenDetachedAndEmpty();
        this.publishState(this.steadyStateFor(session));
        return {
          status: "queued",
          documentLoaded: false,
        };
      }
      const guardCapture = this.deps.persistence.beginReplacementGuard();
      designBaselineIsCurrent = guardCapture.isDesignBaselineCurrent;
      replacementGuard = guardCapture.guard;
      if (!replacementGuard) {
        // Reactive Design publication may synchronously start a successor while
        // the predecessor still owns Scene replacement settlement. The capture
        // retains the Design baseline while this finalizer returns.
        await Promise.resolve();
        if (!transitionIsCurrent()) throw new DesignSessionTransitionSupersededError();
        try {
          replacementGuard = guardCapture.resume();
        } catch (error) {
          const pendingIdentity = session
            ? this.replacement.pendingCanvasReplacementIdentity(session)
            : null;
          const retainedAuthorization = this.retainedReplacementAuthorization;
          if (
            !(error instanceof CanvasAuthorityBusyError)
            || !session
            || !pendingIdentity
            || retainedAuthorization?.canvas !== session
            || retainedAuthorization.identity !== pendingIdentity
          ) throw error;
          retainedReplacementRetry = true;
          retainedReplacementIdentity = pendingIdentity;
          retainedReplacementWasAuthorized =
            retainedAuthorization.isDesignBaselineCurrent();
          retainedReplacementDesignWasApplied =
            this.replacement.isPendingCanvasReplacementDesignFinalized(
              session,
              pendingIdentity,
            );
        }
        if (!replacementGuard && !retainedReplacementRetry) {
          throw new DesignSessionTransitionSupersededError();
        }
      }
      assertReplacementAttemptCurrent();

      if (
        retainedReplacementRetry
        && !retainedReplacementWasAuthorized
        && !retainedReplacementDesignWasApplied
        && request.dirtyGuard === "skip"
      ) {
        if (transitionIsCurrent()) this.publishState(this.steadyStateFor(session));
        return cancelledResult(session);
      }

      if (
        request.dirtyGuard === "confirm"
        && (!retainedReplacementRetry || !retainedReplacementWasAuthorized)
      ) {
        const decision = await this.confirmReplacement(
          session,
          retainedReplacementRetry
            ? () => transitionIsCurrent() && designBaselineIsCurrent()
            : replacementIsCurrent,
        );
        if (decision === "cancel") {
          if (transitionIsCurrent()) {
            this.publishState(this.steadyStateFor(session));
          }
          return cancelledResult(session);
        }
      }

      assertReplacementAttemptCurrent();
      this.publishState(this.operationState("loading", request.source, session));
      const loaded = await request.load();
      if (request.isCancelled?.()) {
        if (transitionIsCurrent()) {
          this.publishState(this.steadyStateFor(session));
        }
        return cancelledResult(session);
      }
      assertReplacementAttemptCurrent();

      const replacementInput = {
        file: loaded.file,
        kind: request.source === "new" ? "new" as const : "loaded" as const,
        path: loaded.path,
        name: loaded.name,
      };
      if (
        retainedReplacementRetry
        && retainedReplacementIdentity
        && session
        && request.source !== "mount-existing"
        && !this.replacement.matchesPendingCanvasReplacement(
          replacementInput,
          session,
          retainedReplacementIdentity,
        )
      ) {
        const resumed = this.replacement.resumePendingCanvasReplacement(
          session,
          retainedReplacementIdentity,
          {
            preserveCurrentDesign:
              !retainedReplacementDesignWasApplied
              && !retainedReplacementWasAuthorized,
          },
        );
        if (!resumed) {
          throw new CanvasAuthorityBusyError("document-settlement");
        }
        this.retainedReplacementAuthorization = null;
        canvasLease.assertCurrent();
        if (transitionIsCurrent()) {
          this.publishState(this.steadyStateFor(session));
        }
        return cancelledResult(session);
      }

      try {
        if (request.source === "mount-existing") {
          if (!session) {
            throw new Error("mount-existing document transitions require an attached canvas session");
          }
          this.replacement.attach(session);
        } else {
          this.replacement.replace(replacementInput, session);
        }
      } catch (error) {
        const pendingIdentity = session
          ? this.replacement.pendingCanvasReplacementIdentity(session)
          : null;
        this.retainedReplacementAuthorization = pendingIdentity && session
          ? {
              canvas: session,
              identity: pendingIdentity,
              isDesignBaselineCurrent: designBaselineIsCurrent,
            }
          : null;
        throw error;
      }
      this.retainedReplacementAuthorization = null;
      // Design publication can synchronously issue a successor transition. Once the
      // replacement is applied, supersession may hide this state but cannot cancel it.
      canvasLease.assertCurrent();

      if (transitionIsCurrent()) {
        this.publishState(this.steadyStateFor(session));
      }
      return {
        status: "applied",
        documentLoaded: session?.hasLoadedDocument() ?? false,
      };
    } catch (error) {
      if (error instanceof DesignSessionTransitionSupersededError) {
        if (transitionIsCurrent()) this.publishState(this.steadyStateFor(session));
        return cancelledResult(session);
      }
      if (isCancelled(error)) {
        if (transitionIsCurrent()) this.publishState(this.steadyStateFor(session));
        return cancelledResult(session);
      }
      if (transitionIsCurrent()) {
        this.publishState({
          ...this.operationState("failed", request.source, session),
          error,
        });
      }
      return {
        status: "failed",
        documentLoaded: session?.hasLoadedDocument() ?? false,
        error,
      };
    }
  }

  consumeQueuedDocumentLoad(
    session: CanvasDocumentSurface,
    options: QueuedDocumentLoadOptions = {},
  ): () => void {
    const queuedTemplate = this.deps.store.readPendingTemplateImport();
    if (queuedTemplate) {
      return this.startQueuedDocumentLoad({
        session,
        options,
        source: "queued-template",
        label: queuedTemplate.name,
        load: async () => ({
          file: await this.deps.loadDesign(queuedTemplate.path),
          path: null,
          name: queuedTemplate.name,
        }),
        isStillPending: () =>
          this.deps.store.readPendingTemplateImport()?.path === queuedTemplate.path,
        clearPending: () => {
          if (this.deps.store.readPendingTemplateImport()?.path === queuedTemplate.path) {
            this.deps.store.setPendingTemplateImport(null);
          }
        },
        restorePending: () => {
          this.deps.store.setPendingTemplateImport(queuedTemplate);
        },
      });
    }

    const queuedPath = this.deps.store.readPendingDesignPath();
    if (!queuedPath) return () => {};

    return this.startQueuedDocumentLoad({
      session,
      options,
      source: "queued-path",
      label: nameFromPath(queuedPath),
      load: async () => {
        const file = await this.deps.loadDesign(queuedPath);
        return {
          file,
          path: queuedPath,
          name: file.name,
        };
      },
      isStillPending: () => this.deps.store.readPendingDesignPath() === queuedPath,
      clearPending: () => {
        if (this.deps.store.readPendingDesignPath() === queuedPath) {
          this.deps.store.setPendingDesignPath(null);
        }
      },
      restorePending: () => {
        this.deps.store.setPendingDesignPath(queuedPath);
      },
    });
  }

  async autosaveDesignSession({
    session,
    runtimeInitialized,
    logError,
  }: AutosaveDesignSessionOptions): Promise<boolean> {
    if (!this.deps.store.isDesignDirty()) return false;
    if (!runtimeInitialized) return false;

    this.deps.persistence.attachCanvas(session);
    const stateEpoch = this.publishState(this.operationState("autosaving", "autosave", session));
    let operation: DesignRecoveryOperation | null = null;
    try {
      try {
        operation = this.deps.persistence.beginRecovery();
        await this.deps.autosaveDesign(operation.content, operation.destinationHint);
      } catch (error) {
        logError("Autosave failed:", error);
        operation?.fail(error);
        return false;
      }
      try {
        return settleWrittenDesignOperation(operation);
      } catch (error) {
        logError("Autosave settlement failed:", error);
        return false;
      }
    } finally {
      this.finishState(stateEpoch, this.steadyStateFor(session));
    }
  }

  teardownAttachedDesignSession({
    session,
    runtimeInitialized,
    logError,
  }: TeardownDesignSessionOptions): void {
    if (!this.deps.persistence.isCanvasAttached(session)) return;
    this.transitionIntent += 1;
    const canvasLease = this.deps.persistence.attachCanvas(session);
    const stateEpoch = this.publishState(this.operationState("tearing-down", "teardown", session));

    if (runtimeInitialized && session.hasLoadedDocument()) {
      try {
        this.settlePendingCanvasReplacementForHandoff(session);
        if (this.deps.store.hasCurrentDesign()) {
          this.deps.persistence.settleCanvasHandoff(session);
          canvasLease.assertCurrent();
          this.deps.store.markCanvasDetachedDirty(this.deps.store.isCanvasDirty());
          canvasLease.assertCurrent();
        }
      } catch (error) {
        logError("Failed to snapshot canvas before teardown:", error);
        this.finishState(stateEpoch, this.steadyStateFor(session));
        throw error;
      }
    }

    let canvasDetached = false;
    try {
      canvasLease.assertCurrent();
      this.deps.workflowRunner.dispose();
      canvasLease.assertCurrent();
      this.deps.persistence.detachCanvas(session);
      canvasDetached = true;
      this.deps.persistence.dispose();
    } finally {
      this.finishState(stateEpoch, this.steadyStateFor(canvasDetached ? null : session));
    }
  }

  private settlePendingCanvasReplacementForHandoff(
    session: CanvasDocumentSurface,
  ): void {
    const identity = this.replacement.pendingCanvasReplacementIdentity(session);
    if (!identity) return;

    const authorization = this.retainedReplacementAuthorization;
    const designWasApplied =
      this.replacement.isPendingCanvasReplacementDesignFinalized(session, identity);
    const originalDesignIsCurrent = authorization?.canvas === session
      && authorization.identity === identity
      && authorization.isDesignBaselineCurrent();
    const settled = this.replacement.settlePendingCanvasReplacementForHandoff(
      session,
      identity,
      {
        preserveCurrentDesign: !designWasApplied && !originalDesignIsCurrent,
      },
    );
    if (!settled) {
      throw new CanvasAuthorityBusyError("document-settlement");
    }
    this.retainedReplacementAuthorization = null;
  }

  private startQueuedDocumentLoad({
    session,
    options,
    source,
    label,
    load,
    isStillPending,
    clearPending,
    restorePending,
  }: QueuedDocumentLoadRequest): () => void {
    let cancelled = false;

    void this.transitionDocument({
      source,
      dirtyGuard: "skip",
      session,
      load,
      isCancelled: () => cancelled,
    }).then((result) => {
      options.onResult?.(result);
      if (cancelled) return;
      if (result.status === "applied") {
        if (isStillPending()) clearPending();
        return;
      }
      if (result.status === "failed") {
        restorePending();
        console.error("Queued document load failed:", result.error);
        void this.deps.showMessage(`Failed to open ${label}.\n\n${formatError(result.error)}`, {
          title: "Open failed",
          kind: "error",
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }

  private async confirmReplacement(
    session: CanvasDocumentSurface | null,
    replacementIsCurrent: () => boolean,
  ): Promise<ReplacementDecision> {
    if (!this.deps.store.hasCurrentDesign()) return "proceed";
    if (!this.deps.store.isDesignDirty()) return "proceed";

    const saveLabel = this.deps.translate("canvas.file.save");
    const discardLabel = this.deps.translate("canvas.file.dontSave");
    const cancelLabel = this.deps.translate("canvas.file.cancel");

    const result = await this.deps.showMessage(this.deps.translate("canvas.file.unsavedChanges"), {
      title: this.deps.translate("canvas.file.unsavedChanges"),
      kind: "warning",
      buttons: {
        yes: saveLabel,
        no: discardLabel,
        cancel: cancelLabel,
      },
    });

    if (!replacementIsCurrent()) return "cancel";
    if (result === cancelLabel) return "cancel";
    if (result === saveLabel) {
      try {
        const settlement = await this.saveCurrentDesign({ session });
        if (settlement?.status !== "applied" || this.deps.store.isDesignDirty()) {
          return "cancel";
        }
      } catch (error) {
        if (isCancelled(error)) return "cancel";
        throw error;
      }
    }

    return "proceed";
  }

  private sessionForTransition(request: DocumentTransitionRequest): CanvasDocumentSurface | null {
    return this.sessionForOption(request.session);
  }

  private sessionForOption(
    session: CanvasDocumentSurface | null | undefined,
  ): CanvasDocumentSurface | null {
    return session === undefined
      ? this.deps.getCurrentSession()
      : session;
  }

  private operationState(
    status: DesignSessionStateStatus,
    operation: DesignSessionState["operation"],
    session: CanvasDocumentSurface | null,
  ): DesignSessionState {
    return {
      status,
      attached: session !== null,
      documentLoaded: session?.hasLoadedDocument() ?? false,
      operation,
    };
  }

  private publishState(state: DesignSessionState): number {
    this.state = state;
    this.stateEpoch += 1;
    return this.stateEpoch;
  }

  private finishState(epoch: number, state: DesignSessionState): void {
    if (epoch !== this.stateEpoch) return;
    this.publishState(state);
  }

  private steadyStateFor(session: CanvasDocumentSurface | null): DesignSessionState {
    const attached = session !== null;
    const documentLoaded = session?.hasLoadedDocument() ?? false;
    const hasDesign = this.deps.store.hasCurrentDesign();
    return {
      status: attached
        ? documentLoaded || hasDesign ? "attached-ready" : "attached-empty"
        : hasDesign ? "detached-ready" : "detached-empty",
      attached,
      documentLoaded,
      operation: null,
    };
  }
}

export function createDesignSessionStateMachine(
  deps: Partial<DesignSessionStateMachineDeps> = {},
): DesignSessionStateMachine {
  const store = deps.store ?? DEFAULT_DEPS.store;
  return new DesignSessionStateMachine({
    ...DEFAULT_DEPS,
    ...deps,
    store,
    persistence: deps.persistence ?? createDesignSessionPersistence({ store }),
  });
}

interface QueuedDocumentLoadRequest {
  session: CanvasDocumentSurface;
  options: QueuedDocumentLoadOptions;
  source: "queued-path" | "queued-template";
  label: string;
  load: () => Promise<DocumentTransitionLoadResult>;
  isStillPending: () => boolean;
  clearPending: () => void;
  restorePending: () => void;
}

function cancelledResult(session: CanvasDocumentSurface | null): DocumentTransitionResult {
  return {
    status: "cancelled",
    documentLoaded: session?.hasLoadedDocument() ?? false,
  };
}

export function nameFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.canopi$/i, "") || "Untitled";
}

export function isCancelled(error: unknown): boolean {
  return typeof error === "string"
    ? error.includes("Dialog cancelled") || error.includes("cancelled")
    : error instanceof Error
      ? error.message.includes("cancelled")
      : false;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
