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
  DesignPersistenceSettlementError,
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
  readonly selectDesignSavePath: typeof designIpc.selectDesignSavePath;
  readonly prepareDesignWrite: typeof designIpc.prepareDesignWrite;
  readonly prepareRecoveryWrite: typeof designIpc.prepareRecoveryWrite;
  readonly loadDesign: typeof designIpc.loadDesign;
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
  selectDesignSavePath: (hint) => designIpc.selectDesignSavePath(hint),
  prepareDesignWrite: (path) => designIpc.prepareDesignWrite(path),
  prepareRecoveryWrite: (path) => designIpc.prepareRecoveryWrite(path),
  loadDesign: (path) => designIpc.loadDesign(path),
  showMessage: (text, options) => message(text, options),
  translate: t,
  workflowRunner: createDesignSessionWorkflowRunner(DESIGN_SESSION_WORKFLOWS),
};

export class DesignSessionStateMachine {
  private state: DesignSessionState = INITIAL_STATE;
  private operationIntent = 0;
  private readonly activeOperationStates = new Map<number, DesignSessionState | null>();
  private activeTransitionOperationIntent: number | null = null;
  private presentedOperationIntent: number | null = null;
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
    this.operationIntent += 1;
    this.activeOperationStates.clear();
    this.activeTransitionOperationIntent = null;
    this.presentedOperationIntent = null;
    this.retainedReplacementAuthorization = null;
    this.deps.persistence.dispose();
    this.publishState(INITIAL_STATE);
  }

  async startAttachedDesignSession(
    session: CanvasDocumentSurface,
  ): Promise<DocumentTransitionResult | null> {
    const operationIntent = this.claimOperationIntent();
    let canvasLease: ReturnType<DesignSessionPersistence["attachCanvas"]>;
    try {
      canvasLease = this.deps.persistence.attachCanvas(session);
    } catch (error) {
      this.finishTransitionOperationState(operationIntent, null);
      throw error;
    }
    if (!this.deps.store.hasCurrentDesign()) {
      this.beginEmptyDocumentSession(session);
      return null;
    }

    this.activateTransitionOperation(operationIntent, this.steadyStateFor(session));
    this.publishOperationState(
      operationIntent,
      this.operationState("loading", "mount-existing", session),
    );
    try {
      this.replacement.attach(session);
      this.retainedReplacementAuthorization = null;
      canvasLease.assertCurrent();
      this.finishTransitionOperationState(
        operationIntent,
        this.steadyStateFor(session),
      );
      return {
        status: "applied",
        documentLoaded: session.hasLoadedDocument(),
      };
    } catch (error) {
      this.finishTransitionOperationState(operationIntent, {
        ...this.operationState("failed", "mount-existing", session),
        error,
      });
      return {
        status: "failed",
        documentLoaded: session.hasLoadedDocument(),
        error,
      };
    }
  }

  beginEmptyDocumentSession(session: CanvasDocumentSurface): void {
    this.deps.persistence.attachCanvas(session);
    this.operationIntent += 1;
    this.activeOperationStates.clear();
    this.activeTransitionOperationIntent = null;
    this.presentedOperationIntent = null;
    this.transitionIntent += 1;
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
    return this.saveCurrentDesignForIntent(
      options,
      this.claimOperationIntent(),
      true,
    );
  }

  private async saveCurrentDesignForIntent(
    options: SaveCurrentDesignOptions,
    operationIntent: number,
    finishIntent: boolean,
  ): Promise<DesignSaveSettlement | null> {
    const session = this.sessionForOption(options.session);
    let stateStarted = false;
    try {
      if (session) this.deps.persistence.attachCanvas(session);
      this.publishOperationState(
        operationIntent,
        this.operationState("saving", "save", session),
      );
      stateStarted = true;
      if (this.deps.store.readDesignPath()) {
        const save = this.deps.persistence.beginSave();
        return await save.execute(this.deps.prepareDesignWrite(save.destinationPath));
      }
      const saveAs = this.deps.persistence.beginSaveAs();
      const savedPath = await this.deps.selectDesignSavePath(saveAs.destinationHint);
      return await saveAs.execute(this.deps.prepareDesignWrite(savedPath));
    } finally {
      if (finishIntent) {
        this.finishOperationState(
          operationIntent,
          stateStarted ? this.steadyStateFor(session) : null,
        );
      } else if (stateStarted) {
        this.publishOperationState(operationIntent, this.steadyStateFor(session));
      }
    }
  }

  async saveAsCurrentDesign(
    options: SaveCurrentDesignOptions = {},
  ): Promise<DesignSaveSettlement | null> {
    const operationIntent = this.claimOperationIntent();
    const session = this.sessionForOption(options.session);
    let stateStarted = false;
    try {
      if (session) this.deps.persistence.attachCanvas(session);
      this.publishOperationState(
        operationIntent,
        this.operationState("saving", "save-as", session),
      );
      stateStarted = true;
      const saveAs = this.deps.persistence.beginSaveAs();
      let path: string;
      try {
        path = await this.deps.selectDesignSavePath(saveAs.destinationHint);
      } catch (error) {
        if (isCancelled(error)) return null;
        throw error;
      }
      return await saveAs.execute(this.deps.prepareDesignWrite(path));
    } finally {
      this.finishOperationState(
        operationIntent,
        stateStarted ? this.steadyStateFor(session) : null,
      );
    }
  }

  async transitionDocument(
    request: DocumentTransitionRequest,
  ): Promise<DocumentTransitionResult> {
    const operationIntent = this.claimOperationIntent();
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
    const publishCompletionIfOwned = (state: DesignSessionState) => {
      this.finishTransitionOperationState(
        operationIntent,
        intent === null ? null : state,
      );
    };

    try {
      canvasLease = session
        ? this.deps.persistence.attachCanvas(session)
        : this.deps.persistence.acquireDetachedCanvasLease();
      const activeCanvasLease = canvasLease;
      intent = this.activateTransitionOperation(
        operationIntent,
        this.steadyStateFor(session),
      );
      if (!session && !this.deps.store.hasCurrentDesign() && request.deferWhenDetachedAndEmpty) {
        request.deferWhenDetachedAndEmpty();
        publishCompletionIfOwned(this.steadyStateFor(session));
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
        publishCompletionIfOwned(this.steadyStateFor(session));
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
          operationIntent,
        );
        if (decision === "cancel") {
          publishCompletionIfOwned(this.steadyStateFor(session));
          return cancelledResult(session);
        }
      }

      return await this.deps.persistence.withReplacementWriteFence(async (writeFence) => {
        assertReplacementAttemptCurrent();
        this.publishOperationState(
          operationIntent,
          this.operationState("loading", request.source, session),
        );
        const loaded = await request.load();
        if (request.isCancelled?.()) {
          publishCompletionIfOwned(this.steadyStateFor(session));
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
          if (
            !retainedReplacementDesignWasApplied
            && !retainedReplacementWasAuthorized
          ) {
            writeFence.invalidatePredecessorWrites();
          }
          this.retainedReplacementAuthorization = null;
          activeCanvasLease.assertCurrent();
          publishCompletionIfOwned(this.steadyStateFor(session));
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
          const pendingDesignWasApplied = pendingIdentity && session
            ? this.replacement.isPendingCanvasReplacementDesignFinalized(
                session,
                pendingIdentity,
              )
            : false;
          this.retainedReplacementAuthorization = pendingIdentity && session
            ? {
                canvas: session,
                identity: pendingIdentity,
                isDesignBaselineCurrent: designBaselineIsCurrent,
              }
            : null;
          if (pendingIdentity && !pendingDesignWasApplied) {
            writeFence.invalidatePredecessorWrites();
          }
          throw error;
        }
        this.retainedReplacementAuthorization = null;
        // Design publication can synchronously issue a successor transition. Once the
        // replacement is applied, supersession may hide this state but cannot cancel it.
        activeCanvasLease.assertCurrent();

        publishCompletionIfOwned(this.steadyStateFor(session));
        return {
          status: "applied",
          documentLoaded: session?.hasLoadedDocument() ?? false,
        };
      });
    } catch (error) {
      if (error instanceof DesignSessionTransitionSupersededError) {
        publishCompletionIfOwned(this.steadyStateFor(session));
        return cancelledResult(session);
      }
      if (isCancelled(error)) {
        publishCompletionIfOwned(this.steadyStateFor(session));
        return cancelledResult(session);
      }
      publishCompletionIfOwned({
        ...this.operationState("failed", request.source, session),
        error,
      });
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
          file: cloneDocument(queuedTemplate.file),
          path: null,
          name: queuedTemplate.name,
        }),
        isStillPending: () =>
          this.deps.store.readPendingTemplateImport()?.identity === queuedTemplate.identity,
        clearPending: () => {
          if (this.deps.store.readPendingTemplateImport()?.identity === queuedTemplate.identity) {
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

    const operationIntent = this.claimOperationIntent();
    let stateStarted = false;
    try {
      this.deps.persistence.attachCanvas(session);
      this.publishOperationState(
        operationIntent,
        this.operationState("autosaving", "autosave", session),
      );
      stateStarted = true;
      try {
        const operation = this.deps.persistence.beginRecovery();
        return await operation.execute(
          this.deps.prepareRecoveryWrite(operation.destinationHint),
        );
      } catch (error) {
        logError(
          error instanceof DesignPersistenceSettlementError
            ? "Autosave settlement failed:"
            : "Autosave failed:",
          error,
        );
        return false;
      }
    } finally {
      this.finishOperationState(
        operationIntent,
        stateStarted ? this.steadyStateFor(session) : null,
      );
    }
  }

  teardownAttachedDesignSession({
    session,
    runtimeInitialized,
    logError,
  }: TeardownDesignSessionOptions): void {
    if (!this.deps.persistence.isCanvasAttached(session)) return;
    const operationIntent = this.claimOperationIntent();
    let canvasLease: ReturnType<DesignSessionPersistence["attachCanvas"]>;
    try {
      canvasLease = this.deps.persistence.attachCanvas(session);
    } catch (error) {
      this.finishTransitionOperationState(operationIntent, null);
      throw error;
    }
    this.activateTransitionOperation(operationIntent, this.steadyStateFor(session));
    this.publishOperationState(
      operationIntent,
      this.operationState("tearing-down", "teardown", session),
    );

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
        this.finishTransitionOperationState(
          operationIntent,
          this.steadyStateFor(session),
        );
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
      this.finishTransitionOperationState(
        operationIntent,
        this.steadyStateFor(canvasDetached ? null : session),
      );
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
    operationIntent: number,
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
        const settlement = await this.saveCurrentDesignForIntent(
          { session },
          operationIntent,
          false,
        );
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

  private publishState(state: DesignSessionState): void {
    this.state = state;
  }

  private claimOperationIntent(): number {
    this.operationIntent += 1;
    this.activeOperationStates.set(this.operationIntent, null);
    return this.operationIntent;
  }

  private activateTransitionOperation(
    intent: number,
    fallbackState: DesignSessionState,
  ): number {
    const predecessor = this.activeTransitionOperationIntent;
    this.activeTransitionOperationIntent = intent;
    if (predecessor !== null) {
      this.finishOperationState(predecessor, fallbackState);
    }
    this.transitionIntent += 1;
    return this.transitionIntent;
  }

  private publishOperationState(
    intent: number,
    state: DesignSessionState,
  ): void {
    if (!this.activeOperationStates.has(intent)) return;
    this.activeOperationStates.set(intent, state);
    if (intent !== this.latestActiveOperationIntent()) return;
    this.presentedOperationIntent = intent;
    this.publishState(state);
  }

  private finishOperationState(
    intent: number,
    state: DesignSessionState | null,
  ): void {
    if (!this.activeOperationStates.has(intent)) return;
    const wasPresented = intent === this.presentedOperationIntent;
    this.activeOperationStates.delete(intent);
    if (!wasPresented && this.presentedOperationIntent !== null) return;
    const next = this.latestActiveOperationState();
    this.presentedOperationIntent = next?.intent ?? null;
    const presentation = next?.state ?? state;
    if (presentation) this.publishState(presentation);
  }

  private finishTransitionOperationState(
    intent: number,
    state: DesignSessionState | null,
  ): void {
    if (this.activeTransitionOperationIntent === intent) {
      this.activeTransitionOperationIntent = null;
    }
    this.finishOperationState(intent, state);
  }

  private latestActiveOperationIntent(): number | null {
    let latest: number | null = null;
    for (const intent of this.activeOperationStates.keys()) latest = intent;
    return latest;
  }

  private latestActiveOperationState(): {
    readonly intent: number;
    readonly state: DesignSessionState;
  } | null {
    let latest: { intent: number; state: DesignSessionState } | null = null;
    for (const [intent, state] of this.activeOperationStates) {
      if (state) latest = { intent, state };
    }
    return latest;
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

function cloneDocument(file: CanopiFile): CanopiFile {
  return JSON.parse(JSON.stringify(file)) as CanopiFile;
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
