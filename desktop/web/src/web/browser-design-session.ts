import { effect } from "@preact/signals";
import { decodeCanopiDesign } from "../app/contracts/design-ingestion";
import { DEFAULT_BUDGET_CURRENCY } from "../app/contracts/document";
import {
  createDesignSessionReplacement,
  type DesignSessionPendingCanvasReplacementIdentity,
  type ResolvedDesignReplacement,
} from "../app/document-session/replacement";
import {
  designSessionStore,
  type PersistenceCapableDesignSessionStore,
} from "../app/document-session/store";
import { DESIGN_SESSION_WORKFLOWS } from "../app/document-session/workflows";
import {
  createDesignSessionWorkflowRunner,
  type DesignSessionWorkflowRunner,
} from "../app/document-session/workflow-runner";
import {
  createDesignSessionPersistence,
  DesignPersistenceLeaseError,
  type DesignReplacementGuardCapture,
} from "../app/document-session/persistence";
import {
  prepareDesignWriteDestination,
  prepareSynchronousDesignWriteDestination,
} from "../app/document-session/write-admission";
import {
  CanvasAuthorityBusyError,
  type CanvasDocumentSurface,
} from "../canvas/runtime/runtime";
import type { CanopiFile } from "../types/design";
import { CURRENT_CANOPI_FILE_VERSION } from "../generated/canopi-design-format";
import {
  browserAppDataStore,
  type BrowserAppDataStore,
  type BrowserAppDataWriteResult,
  type BrowserDraftSummary,
} from "./browser-app-data";
import type { BrowserShellCommandHandlers, BrowserShellDesignIdentity } from "./BrowserAppShell";

export interface BrowserOpenedCanopiFile {
  readonly fileName: string;
  readonly text: string;
}

export interface BrowserCanopiDownload {
  readonly fileName: string;
  readonly text: string;
}

export interface BrowserTemplateCanopiFile {
  readonly name: string;
  readonly text: string;
}

export interface BrowserDesignFileAdapter {
  openCanopiFile(): Promise<BrowserOpenedCanopiFile | null>;
  downloadCanopiFile(download: BrowserCanopiDownload): Promise<void>;
}

interface BrowserDesignSessionControllerOptions {
  readonly store?: PersistenceCapableDesignSessionStore;
  readonly fileAdapter?: BrowserDesignFileAdapter;
  readonly appDataStore?: BrowserAppDataStore;
  readonly now?: () => Date;
  readonly createDraftId?: () => string;
  readonly workflowRunner?: DesignSessionWorkflowRunner;
}

export interface BrowserDesignSessionController {
  hasCurrentDesign(): boolean;
  readDesignIdentity(): BrowserShellDesignIdentity | null;
  newDesign(): Promise<void>;
  openCanopi(): Promise<boolean>;
  openCanopiTemplate(template: BrowserTemplateCanopiFile): Promise<"opened">;
  downloadCanopi(): Promise<void>;
  renameDesign(name: string): void;
  saveCurrentDraft(): BrowserAppDataWriteResult<BrowserDraftSummary> | null;
  listDrafts(): readonly BrowserDraftSummary[];
  openDraft(id: string): boolean;
  attachCanvasSession(session: CanvasDocumentSurface): () => void;
  installAutosave(options?: BrowserDesignSessionAutosaveOptions): () => void;
  handlers(): BrowserShellCommandHandlers;
}

export interface BrowserDesignSessionAutosaveOptions {
  readonly onDraftSaved?: () => void;
}

interface PendingBrowserCanvasReplacement {
  readonly canvas: CanvasDocumentSurface;
  readonly identity: DesignSessionPendingCanvasReplacementIdentity;
  isDesignBaselineCurrent(): boolean;
}

export const browserDesignFileAdapter: BrowserDesignFileAdapter = {
  openCanopiFile,
  downloadCanopiFile,
};

export function createBrowserDesignSessionController({
  store = designSessionStore,
  fileAdapter = browserDesignFileAdapter,
  appDataStore = browserAppDataStore,
  now = () => new Date(),
  createDraftId = createBrowserDraftId,
  workflowRunner = createDesignSessionWorkflowRunner(DESIGN_SESSION_WORKFLOWS),
}: BrowserDesignSessionControllerOptions = {}): BrowserDesignSessionController {
  let activeDraftId: string | null = null;
  let canvasSession: CanvasDocumentSurface | null = null;
  let draftWriteEpoch = 0;
  let latestDraftedCommittedRevision: number | null = null;
  let nextDownloadWrite = 0;
  let replacementIntent = 0;
  let workflowInstallAttempt = 0;
  const replacement = createDesignSessionReplacement({
    store,
    workflowRunner: {
      install() {
        workflowInstallAttempt += 1;
        workflowRunner.install();
      },
      dispose: () => workflowRunner.dispose(),
    },
  });
  const persistence = createDesignSessionPersistence({ store });
  let pendingCanvasReplacement: PendingBrowserCanvasReplacement | null = null;

  function applyDesignReplacement(
    input: ResolvedDesignReplacement,
    baseline: DesignReplacementGuardCapture = persistence.beginReplacementGuard(),
  ): void {
    const canvas = canvasSession;
    if (canvas) quarantineCompetingPendingReplacement(input, canvas);
    try {
      replacement.replace(input, canvas);
      pendingCanvasReplacement = null;
    } catch (error) {
      const identity = canvas
        ? replacement.pendingCanvasReplacementIdentity(canvas)
        : null;
      pendingCanvasReplacement = canvas && identity
        ? {
            canvas,
            identity,
            isDesignBaselineCurrent: () => baseline.isDesignBaselineCurrent(),
          }
        : null;
      throw error;
    }
  }

  function quarantineCompetingPendingReplacement(
    input: ResolvedDesignReplacement,
    canvas: CanvasDocumentSurface,
  ): void {
    const identity = replacement.pendingCanvasReplacementIdentity(canvas);
    if (
      !identity
      || replacement.matchesPendingCanvasReplacement(input, canvas, identity)
    ) return;

    resumeExactPendingCanvasReplacement(canvas, identity);
    throw new CanvasAuthorityBusyError("document-settlement");
  }

  function resumeExactPendingCanvasReplacement(
    canvas: CanvasDocumentSurface,
    identity: DesignSessionPendingCanvasReplacementIdentity,
  ): void {
    const pending = pendingCanvasReplacement;
    if (
      !pending
      || pending.canvas !== canvas
      || pending.identity !== identity
    ) {
      throw new Error(
        "Browser Canvas replacement is missing its exact Design baseline",
      );
    }

    const designAlreadyFinalized =
      replacement.isPendingCanvasReplacementDesignFinalized(canvas, identity);
    const resumed = replacement.resumePendingCanvasReplacement(
      canvas,
      identity,
      {
        preserveCurrentDesign:
          !designAlreadyFinalized && !pending.isDesignBaselineCurrent(),
      },
    );
    if (!resumed) {
      throw new Error("Browser Canvas replacement changed before quarantine");
    }
    pendingCanvasReplacement = null;
  }

  async function newDesign(): Promise<void> {
    replacementIntent += 1;
    const file = createEmptyWebCanopiFile(now());
    const draftId = createDraftId();
    applyDesignReplacement({
      file,
      kind: "new",
      path: null,
      name: file.name,
      finalizationIdentity: `browser-draft:${draftId}`,
      onDesignFinalized: () => {
        activeDraftId = draftId;
      },
    });
    saveCurrentDraft();
  }

  async function openCanopi(): Promise<boolean> {
    const intent = ++replacementIntent;
    const canvas = canvasSession;
    const pendingIdentity = canvas
      ? replacement.pendingCanvasReplacementIdentity(canvas)
      : null;
    if (canvas && pendingIdentity) {
      resumeExactPendingCanvasReplacement(canvas, pendingIdentity);
      return false;
    }
    const guardCapture = persistence.beginReplacementGuard();
    let replacementGuard = guardCapture.guard;
    if (!replacementGuard) {
      await Promise.resolve();
      if (intent !== replacementIntent) return false;
      replacementGuard = guardCapture.resume();
    }
    if (
      !replacementGuard
      || intent !== replacementIntent
      || !replacementGuard.isCurrent()
    ) return false;

    const opened = await fileAdapter.openCanopiFile();
    if (intent !== replacementIntent || !replacementGuard.isCurrent()) return false;
    if (!opened) return false;
    if (!opened.fileName.toLowerCase().endsWith(".canopi")) {
      throw new Error(`Expected a .canopi file, received ${opened.fileName}.`);
    }

    const file = parseCanopiJson(opened.text);
    const draftId = createDraftId();
    if (intent !== replacementIntent || !replacementGuard.isCurrent()) return false;
    applyDesignReplacement({
      file,
      kind: "loaded",
      path: null,
      name: file.name || nameFromFileName(opened.fileName),
      finalizationIdentity: `browser-draft:${draftId}`,
      onDesignFinalized: () => {
        activeDraftId = draftId;
      },
    }, guardCapture);
    saveCurrentDraft();
    return true;
  }

  async function openCanopiTemplate(template: BrowserTemplateCanopiFile): Promise<"opened"> {
    replacementIntent += 1;
    const file = parseCanopiJson(template.text);
    const draftId = createDraftId();
    applyDesignReplacement({
      file,
      kind: "loaded",
      path: null,
      name: template.name,
      finalizationIdentity: `browser-draft:${draftId}`,
      onDesignFinalized: () => {
        activeDraftId = draftId;
      },
    });
    saveCurrentDraft();
    return "opened";
  }

  async function downloadCanopi(): Promise<void> {
    const current = store.readCurrentDesign();
    if (!current) throw new Error("No browser Design is loaded.");

    const name = current.name || store.readDesignName() || "Untitled";
    const operation = persistence.beginBrowserDownload();
    await operation.execute(prepareDesignWriteDestination({
      resource: `browser-download:${++nextDownloadWrite}`,
      blocksReplacement: false,
      async write(content) {
        await fileAdapter.downloadCanopiFile({
          fileName: `${safeFileStem(content.name || name || "Untitled")}.canopi`,
          text: `${JSON.stringify(content, null, 2)}\n`,
        });
      },
    }));
    saveCurrentDraft();
  }

  function renameDesign(name: string): void {
    const nextName = name.trim();
    if (nextName.length === 0) return;
    if (nextName === store.readDesignName()) return;

    const design = store.readCurrentDesign();
    if (!design) return;

    store.renameCurrentDesign(nextName);
  }

  function saveCurrentDraft(): BrowserAppDataWriteResult<BrowserDraftSummary> | null {
    if (!store.hasCurrentDesign()) return null;

    const capturedCommittedRevision = store.committedDesignRevision.value;
    draftWriteEpoch += 1;
    const draftId = activeDraftId ?? createDraftId();
    const operation = persistence.beginBrowserDraft();
    const previousDraftId = activeDraftId;
    const resultBox: {
      current: Extract<
        BrowserAppDataWriteResult<BrowserDraftSummary>,
        { readonly ok: true }
      > | null;
    } = { current: null };
    try {
      operation.executeImmediately(prepareSynchronousDesignWriteDestination({
        resource: "browser-app-data:canopi:web-app-data:v1",
        write(content) {
          const result = appDataStore.saveDraft({
            id: draftId,
            file: content,
            now: now().toISOString(),
          });
          if (!result.ok) throw new BrowserDraftStorageError(result);
          resultBox.current = result;
          activeDraftId = result.value.id;
          return undefined;
        },
      }));
    } catch (error) {
      if (error instanceof BrowserDraftStorageError) return error.result;
      throw error;
    }
    const result = resultBox.current;
    if (!result) throw new Error("Browser Draft write completed without a result");
    latestDraftedCommittedRevision = capturedCommittedRevision;
    if (previousDraftId && previousDraftId !== result.value.id) {
      const deleted = appDataStore.deleteDraft(previousDraftId);
      if (!deleted.ok) store.setAutosaveFailed(true);
    }
    return result;
  }

  function openDraft(id: string): boolean {
    replacementIntent += 1;
    const draft = appDataStore.loadDraft(id);
    if (!draft) return false;

    const file = draft;
    applyDesignReplacement({
      file,
      kind: "loaded",
      path: null,
      name: file.name || "Untitled",
      finalizationIdentity: `browser-draft:${id}`,
      onDesignFinalized: () => {
        activeDraftId = id;
      },
    });
    saveCurrentDraft();
    return true;
  }

  function attachCanvasSession(session: CanvasDocumentSurface): () => void {
    if (canvasSession === session) {
      throw new DesignPersistenceLeaseError("Browser Canvas session is already attached");
    }
    persistence.attachCanvas(session);
    const installAttemptBeforeAttachment = workflowInstallAttempt;
    try {
      replacement.attach(session);
    } catch (error) {
      try {
        if (workflowInstallAttempt !== installAttemptBeforeAttachment) {
          try {
            workflowRunner.dispose();
          } catch (cleanupError) {
            console.error(
              "Failed to clean up browser Design Session workflows after Canvas attachment failure:",
              cleanupError,
            );
          }
        }
      } finally {
        persistence.detachCanvas(session);
      }
      throw error;
    }
    canvasSession = session;
    return () => {
      if (canvasSession !== session) return;

      try {
        settlePendingReplacementForHandoff(session);
        if (session.hasLoadedDocument() && store.hasCurrentDesign()) {
          persistence.settleCanvasHandoff(session);
          store.markCanvasDetachedDirty(store.isCanvasDirty());
        }
      } catch (error) {
        console.error("Failed to snapshot browser canvas before detach:", error);
        throw error;
      }
      workflowRunner.dispose();
      persistence.detachCanvas(session);
      canvasSession = null;
    };
  }

  function settlePendingReplacementForHandoff(
    session: CanvasDocumentSurface,
  ): void {
    const identity = replacement.pendingCanvasReplacementIdentity(session);
    if (!identity) {
      if (pendingCanvasReplacement?.canvas === session) {
        pendingCanvasReplacement = null;
      }
      return;
    }

    const pending = pendingCanvasReplacement;
    if (
      !pending
      || pending.canvas !== session
      || pending.identity !== identity
    ) {
      throw new Error(
        "Browser Canvas replacement is missing its exact Design baseline",
      );
    }

    const designAlreadyFinalized =
      replacement.isPendingCanvasReplacementDesignFinalized(session, identity);
    const preserveCurrentDesign =
      !designAlreadyFinalized && !pending.isDesignBaselineCurrent();
    const settled = replacement.settlePendingCanvasReplacementForHandoff(
      session,
      identity,
      { preserveCurrentDesign },
    );
    if (!settled) {
      throw new Error("Browser Canvas replacement changed before handoff");
    }
    pendingCanvasReplacement = null;
  }

  function installAutosave({ onDraftSaved }: BrowserDesignSessionAutosaveOptions = {}): () => void {
    let lastCommittedRevision = store.committedDesignRevision.value;
    let lastDirty = false;
    let disposed = false;
    let scheduled = false;
    const scheduleAutosave = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      const scheduledWriteEpoch = draftWriteEpoch;
      queueMicrotask(() => {
        scheduled = false;
        if (disposed) return;
        if (scheduledWriteEpoch !== draftWriteEpoch) {
          const current = store.readCurrentDesign();
          if (
            current
            && (
              store.isDesignDirty()
              || store.committedDesignRevision.value !== latestDraftedCommittedRevision
            )
          ) {
            scheduleAutosave();
          }
          return;
        }
        let result: BrowserAppDataWriteResult<BrowserDraftSummary> | null;
        try {
          result = saveCurrentDraft();
        } catch (error) {
          try {
            store.setAutosaveFailed(true);
          } catch (publicationError) {
            logBrowserDesignSessionError(publicationError);
          }
          logBrowserDesignSessionError(error);
          return;
        }
        if (!result?.ok) return;
        try {
          onDraftSaved?.();
        } catch (error) {
          logBrowserDesignSessionError(error);
        }
      });
    };
    const disposeEffect = effect(() => {
      const committedRevision = store.committedDesignRevision.value;
      const dirty = store.designDirty.value;
      const shouldSchedule = committedRevision !== lastCommittedRevision
        || (dirty && !lastDirty);
      lastCommittedRevision = committedRevision;
      lastDirty = dirty;
      if (!shouldSchedule || !store.hasCurrentDesign()) return;

      scheduleAutosave();
    });
    return () => {
      disposed = true;
      disposeEffect();
    };
  }

  return {
    hasCurrentDesign: () => store.currentDesign.value !== null,
    readDesignIdentity() {
      const design = store.currentDesign.value;
      if (!design) return null;
      return {
        name: store.designName.value || design.name || "Untitled",
        dirty: store.designDirty.value,
      };
    },
    newDesign,
    openCanopi,
    openCanopiTemplate,
    downloadCanopi,
    renameDesign,
    saveCurrentDraft,
    listDrafts: () => appDataStore.listDrafts(),
    openDraft,
    attachCanvasSession,
    installAutosave,
    handlers() {
      return {
        newDesign: () => void newDesign().catch(logBrowserDesignSessionError),
        openCanopi: () => void openCanopi().catch(logBrowserDesignSessionError),
        downloadCanopi: () => void downloadCanopi().catch(logBrowserDesignSessionError),
      };
    },
  };
}

class BrowserDraftStorageError extends Error {
  readonly result: Extract<
    BrowserAppDataWriteResult<BrowserDraftSummary>,
    { readonly ok: false }
  >;

  constructor(result: BrowserDraftStorageError["result"]) {
    super("Browser Draft storage failed");
    this.name = "BrowserDraftStorageError";
    this.result = result;
  }
}

export const browserDesignSessionController = createBrowserDesignSessionController();

function createEmptyWebCanopiFile(now: Date): CanopiFile {
  const timestamp = now.toISOString();
  return {
    version: CURRENT_CANOPI_FILE_VERSION,
    name: "Untitled",
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: {},
    plant_species_symbols: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    measurement_guides: [],
    groups: [],
    consortiums: [],
    timeline: [],
    budget: [],
    budget_currency: DEFAULT_BUDGET_CURRENCY,
    created_at: timestamp,
    updated_at: timestamp,
    extra: {},
  };
}

function parseCanopiJson(text: string): CanopiFile {
  const parsed: unknown = JSON.parse(text);
  return decodeCanopiDesign(parsed);
}

async function openCanopiFile(): Promise<BrowserOpenedCanopiFile | null> {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".canopi,application/json";
  input.multiple = false;
  input.style.display = "none";
  document.body.appendChild(input);

  try {
    return await new Promise<BrowserOpenedCanopiFile | null>((resolve, reject) => {
      let settled = false;
      const finish = (value: BrowserOpenedCanopiFile | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      input.addEventListener("change", () => {
        const file = input.files?.[0] ?? null;
        if (!file) {
          finish(null);
          return;
        }
        file.text()
          .then((text) => finish({ fileName: file.name, text }))
          .catch(fail);
      }, { once: true });
      input.addEventListener("cancel", () => finish(null), { once: true });
      input.click();
    });
  } finally {
    input.remove();
  }
}

async function downloadCanopiFile({ fileName, text }: BrowserCanopiDownload): Promise<void> {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);

  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}

function nameFromFileName(fileName: string): string {
  return fileName.replace(/\.canopi$/i, "") || "Untitled";
}

function safeFileStem(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Untitled";
}

function createBrowserDraftId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `draft-${randomUuid}`;
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function logBrowserDesignSessionError(error: unknown): void {
  console.error("Browser Design Session command failed:", error);
}
