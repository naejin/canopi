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
import type { CanopiFile } from "../types/design";
import type { BrowserShellCommandHandlers } from "./BrowserAppShell";

const WEB_CANOPI_FILE_VERSION = 5;

export interface BrowserOpenedCanopiFile {
  readonly fileName: string;
  readonly text: string;
}

export interface BrowserCanopiDownload {
  readonly fileName: string;
  readonly text: string;
}

export interface BrowserDesignFileAdapter {
  openCanopiFile(): Promise<BrowserOpenedCanopiFile | null>;
  downloadCanopiFile(download: BrowserCanopiDownload): Promise<void>;
}

interface BrowserDesignSessionControllerOptions {
  readonly store?: DesignSessionStore;
  readonly fileAdapter?: BrowserDesignFileAdapter;
  readonly now?: () => Date;
}

export interface BrowserDesignSessionController {
  newDesign(): Promise<void>;
  openCanopi(): Promise<boolean>;
  downloadCanopi(): Promise<void>;
  handlers(): BrowserShellCommandHandlers;
}

export const browserDesignFileAdapter: BrowserDesignFileAdapter = {
  openCanopiFile,
  downloadCanopiFile,
};

export function createBrowserDesignSessionController({
  store = designSessionStore,
  fileAdapter = browserDesignFileAdapter,
  now = () => new Date(),
}: BrowserDesignSessionControllerOptions = {}): BrowserDesignSessionController {
  async function newDesign(): Promise<void> {
    const file = createEmptyWebCanopiFile(now());
    store.replaceCurrentDesignState(file, null, file.name);
    store.resetDirtyBaselines();
  }

  async function openCanopi(): Promise<boolean> {
    const opened = await fileAdapter.openCanopiFile();
    if (!opened) return false;
    if (!opened.fileName.toLowerCase().endsWith(".canopi")) {
      throw new Error(`Expected a .canopi file, received ${opened.fileName}.`);
    }

    const file = normalizeLoadedDocument(parseCanopiJson(opened.text));
    store.replaceCurrentDesignState(file, null, file.name || nameFromFileName(opened.fileName));
    store.resetDirtyBaselines();
    return true;
  }

  async function downloadCanopi(): Promise<void> {
    const current = store.readCurrentDesign();
    if (!current) throw new Error("No browser Design is loaded.");

    const name = current.name || store.readDesignName() || "Untitled";
    const content = buildPersistedDesignSessionContent({
      session: null,
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
  }

  return {
    newDesign,
    openCanopi,
    downloadCanopi,
    handlers() {
      return {
        newDesign: () => void newDesign().catch(logBrowserDesignSessionError),
        openCanopi: () => void openCanopi().catch(logBrowserDesignSessionError),
        downloadCanopi: () => void downloadCanopi().catch(logBrowserDesignSessionError),
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
      input.addEventListener("change", () => {
        const file = input.files?.[0] ?? null;
        if (!file) {
          resolve(null);
          return;
        }
        file.text()
          .then((text) => resolve({ fileName: file.name, text }))
          .catch(reject);
      }, { once: true });
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

function logBrowserDesignSessionError(error: unknown): void {
  console.error("Browser Design Session command failed:", error);
}
