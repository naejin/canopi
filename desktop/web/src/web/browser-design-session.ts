import { effect } from "@preact/signals";
import {
  DEFAULT_BUDGET_CURRENCY,
  normalizeLoadedDocument,
  normalizeNewDocument,
} from "../app/contracts/document";
import {
  designSessionStore,
  type DesignSessionStore,
} from "../app/document-session/store";
import { buildPersistedDesignSessionContent } from "../app/document-session/persistence";
import type { CanvasDocumentSurface } from "../canvas/runtime/runtime";
import type { CanopiFile } from "../types/design";
import {
  browserAppDataStore,
  type BrowserAppDataStore,
  type BrowserAppDataWriteResult,
  type BrowserDraftSummary,
} from "./browser-app-data";
import type { BrowserShellCommandHandlers, BrowserShellDesignIdentity } from "./BrowserAppShell";

const WEB_CANOPI_FILE_VERSION = 5;

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
  readonly store?: DesignSessionStore;
  readonly fileAdapter?: BrowserDesignFileAdapter;
  readonly appDataStore?: BrowserAppDataStore;
  readonly now?: () => Date;
  readonly createDraftId?: () => string;
}

export interface BrowserDesignSessionController {
  hasCurrentDesign(): boolean;
  readDesignIdentity(): BrowserShellDesignIdentity | null;
  newDesign(): Promise<void>;
  openCanopi(): Promise<boolean>;
  openCanopiTemplate(template: BrowserTemplateCanopiFile): Promise<"opened">;
  downloadCanopi(): Promise<void>;
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
}: BrowserDesignSessionControllerOptions = {}): BrowserDesignSessionController {
  let activeDraftId: string | null = null;
  let canvasSession: CanvasDocumentSurface | null = null;

  async function newDesign(): Promise<void> {
    const file = createEmptyWebCanopiFile(now());
    activeDraftId = null;
    store.replaceCurrentDesignState(file, null, file.name);
    store.resetDirtyBaselines();
    saveCurrentDraft();
  }

  async function openCanopi(): Promise<boolean> {
    const opened = await fileAdapter.openCanopiFile();
    if (!opened) return false;
    if (!opened.fileName.toLowerCase().endsWith(".canopi")) {
      throw new Error(`Expected a .canopi file, received ${opened.fileName}.`);
    }

    const file = normalizeLoadedDocument(parseCanopiJson(opened.text));
    activeDraftId = null;
    store.replaceCurrentDesignState(file, null, file.name || nameFromFileName(opened.fileName));
    store.resetDirtyBaselines();
    saveCurrentDraft();
    return true;
  }

  async function openCanopiTemplate(template: BrowserTemplateCanopiFile): Promise<"opened"> {
    const file = normalizeLoadedDocument(parseCanopiJson(template.text));
    activeDraftId = null;
    store.replaceCurrentDesignState(file, null, template.name);
    store.resetDirtyBaselines();
    saveCurrentDraft();
    return "opened";
  }

  async function downloadCanopi(): Promise<void> {
    const current = store.readCurrentDesign();
    if (!current) throw new Error("No browser Design is loaded.");

    const name = current.name || store.readDesignName() || "Untitled";
    const content = buildPersistedDesignSessionContent({
      session: activeCanvasSession(),
      name,
      store,
    });
    const fileName = `${safeFileStem(content.name || "Untitled")}.canopi`;
    await fileAdapter.downloadCanopiFile({
      fileName,
      text: `${JSON.stringify(content, null, 2)}\n`,
    });
    store.replaceCurrentDesignState(content, null, content.name);
    store.markSaved(null);
    saveCurrentDraft();
  }

  function saveCurrentDraft(): BrowserAppDataWriteResult<BrowserDraftSummary> | null {
    if (!store.hasCurrentDesign()) return null;

    const name = store.readCurrentDesign()?.name || store.readDesignName() || "Untitled";
    const draftId = activeDraftId ?? createDraftId();
    const content = buildPersistedDesignSessionContent({
      session: activeCanvasSession(),
      name,
      store,
    });
    const result = appDataStore.saveDraft({
      id: draftId,
      file: content,
      now: now().toISOString(),
    });
    store.setAutosaveFailed(!result.ok);
    if (result.ok) {
      const previousDraftId = activeDraftId;
      activeDraftId = result.value.id;
      store.markSaved(activeCanvasSession());
      if (previousDraftId && previousDraftId !== result.value.id) {
        const deleted = appDataStore.deleteDraft(previousDraftId);
        if (!deleted.ok) store.setAutosaveFailed(true);
      }
    }
    return result;
  }

  function openDraft(id: string): boolean {
    const draft = appDataStore.loadDraft(id);
    if (!draft) return false;

    const file = normalizeLoadedDocument(draft);
    activeDraftId = id;
    store.replaceCurrentDesignState(file, null, file.name || "Untitled");
    store.resetDirtyBaselines();
    saveCurrentDraft();
    return true;
  }

  function attachCanvasSession(session: CanvasDocumentSurface): () => void {
    canvasSession = session;
    return () => {
      if (canvasSession === session) {
        canvasSession = null;
      }
    };
  }

  function activeCanvasSession(): CanvasDocumentSurface | null {
    if (!canvasSession?.hasLoadedDocument()) return null;
    return canvasSession;
  }

  function installAutosave({ onDraftSaved }: BrowserDesignSessionAutosaveOptions = {}): () => void {
    let lastDesign = store.readCurrentDesign();
    return effect(() => {
      const current = store.currentDesign.value;
      const dirty = store.designDirty.value;
      if (current === lastDesign && !dirty) return;
      lastDesign = current;
      if (!current) return;

      const result = saveCurrentDraft();
      if (result?.ok) onDraftSaved?.();
    });
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
        openDraft: (id) => openDraft(id),
        openDrafts: () => undefined,
      };
    },
  };
}

export const browserDesignSessionController = createBrowserDesignSessionController();

function createEmptyWebCanopiFile(now: Date): CanopiFile {
  const timestamp = now.toISOString();
  return normalizeNewDocument({
    version: WEB_CANOPI_FILE_VERSION,
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
  });
}

function parseCanopiJson(text: string): CanopiFile {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Selected .canopi file does not contain a design object.");
  }
  return parsed as CanopiFile;
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
