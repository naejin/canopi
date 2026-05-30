import { message } from "@tauri-apps/plugin-dialog";
import type { CanvasDocumentSurface } from "../../canvas/runtime/runtime";
import { getCurrentCanvasDocumentSurface } from "../../canvas/session";
import { normalizeLoadedDocument, normalizeNewDocument } from "../contracts/document";
import * as designIpc from "../../ipc/design";
import { t } from "../../i18n";
import type { CanopiFile } from "../../types/design";
import {
  designSessionStore,
  type DesignSessionStore,
} from "./store";
import {
  buildPersistedDesignSessionContent,
  disposeDesignSessionPersistence,
  snapshotCanvasIntoDesignSession,
} from "./persistence";
import { installConsortiumSync } from "./workflows";

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
  readonly store: DesignSessionStore;
  readonly getCurrentSession: () => CanvasDocumentSurface | null;
  readonly saveDesign: typeof designIpc.saveDesign;
  readonly saveDesignAs: typeof designIpc.saveDesignAs;
  readonly loadDesign: typeof designIpc.loadDesign;
  readonly autosaveDesign: typeof designIpc.autosaveDesign;
  readonly showMessage: typeof message;
  readonly translate: typeof t;
  readonly buildPersistedContent: typeof buildPersistedDesignSessionContent;
  readonly snapshotCanvasIntoSession: typeof snapshotCanvasIntoDesignSession;
  readonly disposePersistence: typeof disposeDesignSessionPersistence;
  readonly installWorkflows: typeof installConsortiumSync;
}

type ReplacementDecision = "proceed" | "cancel";

const INITIAL_STATE: DesignSessionState = {
  status: "detached-empty",
  attached: false,
  documentLoaded: false,
  operation: null,
};

const DEFAULT_DEPS: DesignSessionStateMachineDeps = {
  store: designSessionStore,
  getCurrentSession: getCurrentCanvasDocumentSurface,
  saveDesign: (path, content) => designIpc.saveDesign(path, content),
  saveDesignAs: (content) => designIpc.saveDesignAs(content),
  loadDesign: (path) => designIpc.loadDesign(path),
  autosaveDesign: (content, path) => designIpc.autosaveDesign(content, path),
  showMessage: (text, options) => message(text, options),
  translate: t,
  buildPersistedContent: buildPersistedDesignSessionContent,
  snapshotCanvasIntoSession: snapshotCanvasIntoDesignSession,
  disposePersistence: disposeDesignSessionPersistence,
  installWorkflows: installConsortiumSync,
};

export class DesignSessionStateMachine {
  private state: DesignSessionState = INITIAL_STATE;

  constructor(private readonly deps: DesignSessionStateMachineDeps = DEFAULT_DEPS) {}

  getState(): DesignSessionState {
    return this.state;
  }

  resetState(): void {
    this.state = INITIAL_STATE;
  }

  async startAttachedDesignSession(
    session: CanvasDocumentSurface,
  ): Promise<DocumentTransitionResult | null> {
    if (!this.deps.store.hasCurrentDesign()) {
      this.beginEmptyDocumentSession(session);
      return null;
    }

    return this.transitionDocument({
      source: "mount-existing",
      dirtyGuard: "skip",
      session,
      load: async () => {
        const file = this.deps.store.readCurrentDesign();
        if (!file) throw new Error("No current design to mount");
        return {
          file,
          path: this.deps.store.readDesignPath(),
          name: this.deps.store.readDesignName(),
        };
      },
    });
  }

  beginEmptyDocumentSession(session: CanvasDocumentSurface): void {
    this.state = {
      status: "attached-empty",
      attached: true,
      documentLoaded: session.hasLoadedDocument(),
      operation: null,
    };
    this.deps.installWorkflows();
    session.hideCanvasChrome();
  }

  async saveCurrentDesign(options: SaveCurrentDesignOptions = {}): Promise<void> {
    const session = this.sessionForOption(options.session);
    this.state = this.operationState("saving", "save", session);

    try {
      const content = this.deps.buildPersistedContent({
        session,
        name: this.deps.store.readDesignName(),
        store: this.deps.store,
      });

      const path = this.deps.store.readDesignPath();
      if (path) {
        await this.deps.saveDesign(path, content);
        this.deps.store.replaceCurrentDesignState(
          content,
          path,
          this.deps.store.readDesignName(),
        );
      } else {
        const savedPath = await this.deps.saveDesignAs(content);
        this.deps.store.replaceCurrentDesignState(content, savedPath, nameFromPath(savedPath));
      }

      this.deps.store.markSaved(session);
    } finally {
      this.state = this.steadyStateFor(session);
    }
  }

  async saveAsCurrentDesign(options: SaveCurrentDesignOptions = {}): Promise<void> {
    const session = this.sessionForOption(options.session);
    this.state = this.operationState("saving", "save-as", session);

    try {
      const content = this.deps.buildPersistedContent({
        session,
        name: this.deps.store.readDesignName(),
        store: this.deps.store,
      });
      const path = await this.deps.saveDesignAs(content);
      this.deps.store.replaceCurrentDesignState(content, path, nameFromPath(path));
      this.deps.store.markSaved(session);
    } catch (error) {
      if (isCancelled(error)) return;
      throw error;
    } finally {
      this.state = this.steadyStateFor(session);
    }
  }

  async transitionDocument(
    request: DocumentTransitionRequest,
  ): Promise<DocumentTransitionResult> {
    const session = this.sessionForTransition(request);

    try {
      if (!session && !this.deps.store.hasCurrentDesign() && request.deferWhenDetachedAndEmpty) {
        request.deferWhenDetachedAndEmpty();
        this.state = this.steadyStateFor(session);
        return {
          status: "queued",
          documentLoaded: false,
        };
      }

      if (request.dirtyGuard === "confirm") {
        const decision = await this.confirmReplacement(session);
        if (decision === "cancel") {
          this.state = this.steadyStateFor(session);
          return cancelledResult(session);
        }
      }

      this.state = this.operationState("loading", request.source, session);
      const loaded = await request.load();
      if (request.isCancelled?.()) {
        this.state = this.steadyStateFor(session);
        return cancelledResult(session);
      }

      const file = normalizeDocumentForSource(request.source, loaded.file);
      this.applyDocumentTransition({
        source: request.source,
        session,
        file,
        path: loaded.path,
        name: loaded.name,
      });

      this.state = this.steadyStateFor(session);
      return {
        status: "applied",
        documentLoaded: session?.hasLoadedDocument() ?? false,
      };
    } catch (error) {
      if (isCancelled(error)) {
        this.state = this.steadyStateFor(session);
        return cancelledResult(session);
      }
      this.state = {
        ...this.operationState("failed", request.source, session),
        error,
      };
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

    this.state = this.operationState("autosaving", "autosave", session);
    try {
      const content = this.deps.buildPersistedContent({
        session,
        name: this.deps.store.readDesignName(),
        store: this.deps.store,
      });
      await this.deps.autosaveDesign(content, this.deps.store.readDesignPath());
      this.deps.store.setAutosaveFailed(false);
      return true;
    } catch (error) {
      logError("Autosave failed:", error);
      this.deps.store.setAutosaveFailed(true);
      return false;
    } finally {
      this.state = this.steadyStateFor(session);
    }
  }

  teardownAttachedDesignSession({
    session,
    runtimeInitialized,
    logError,
  }: TeardownDesignSessionOptions): void {
    this.state = this.operationState("tearing-down", "teardown", session);

    try {
      if (runtimeInitialized && session.hasLoadedDocument() && this.deps.store.hasCurrentDesign()) {
        try {
          this.deps.snapshotCanvasIntoSession({
            session,
            name: this.deps.store.readDesignName(),
            store: this.deps.store,
          });
          this.deps.store.markCanvasDetachedDirty(this.deps.store.isCanvasDirty());
        } catch (error) {
          logError("Failed to snapshot canvas before teardown:", error);
        }
      }
    } finally {
      this.deps.disposePersistence();
      this.state = this.steadyStateFor(null);
    }
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

  private applyDocumentTransition({
    source,
    session,
    file,
    path,
    name,
  }: ApplyDocumentTransitionOptions): void {
    if (!session) {
      this.applyDetachedDocumentTransition({ source, file, path, name });
      return;
    }

    if (source === "mount-existing") {
      session.loadDocument(file);
    } else {
      session.replaceDocument(file);
      this.deps.store.replaceCurrentDesignState(file, path, name);
      this.deps.store.resetDirtyBaselines();
    }

    session.clearHistory();
    session.showCanvasChrome();
    session.zoomToFit();
    this.deps.installWorkflows();
  }

  private applyDetachedDocumentTransition({
    source,
    file,
    path,
    name,
  }: Omit<ApplyDocumentTransitionOptions, "session">): void {
    if (source === "mount-existing") {
      throw new Error("mount-existing document transitions require an attached canvas session");
    }

    this.deps.store.replaceCurrentDesignState(file, path, name);
    this.deps.store.resetDirtyBaselines();
    this.deps.installWorkflows();
  }

  private async confirmReplacement(session: CanvasDocumentSurface | null): Promise<ReplacementDecision> {
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

    if (result === cancelLabel) return "cancel";
    if (result === saveLabel) {
      try {
        await this.saveCurrentDesign({ session });
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
  return new DesignSessionStateMachine({
    ...DEFAULT_DEPS,
    ...deps,
  });
}

interface ApplyDocumentTransitionOptions {
  source: DocumentTransitionSource;
  session: CanvasDocumentSurface | null;
  file: CanopiFile;
  path: string | null;
  name: string;
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

function normalizeDocumentForSource(
  source: DocumentTransitionSource,
  file: CanopiFile,
): CanopiFile {
  if (source === "new") return normalizeNewDocument(file);
  if (source === "mount-existing") return file;
  return normalizeLoadedDocument(file);
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
