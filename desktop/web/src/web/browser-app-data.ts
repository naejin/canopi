import { decodeCanopiDesign } from "../app/contracts/design-ingestion";
import type { CanopiFile } from "../types/design";

const STORAGE_KEY = "canopi:web-app-data:v1";

export interface BrowserStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BrowserDraftSummary {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

export interface BrowserSavedObjectStampRecord {
  readonly id: string;
  readonly name: string;
  readonly payload: unknown;
}

export type BrowserAppDataWriteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

interface BrowserAppDataDocument {
  readonly drafts: readonly BrowserDraftSummary[];
  readonly draftFiles: Record<string, CanopiFile>;
  readonly settings: Record<string, unknown> | null;
  readonly favoriteSpecies: readonly string[];
  readonly recentlyViewedSpecies: readonly string[];
  readonly savedObjectStamps: readonly BrowserSavedObjectStampRecord[];
}

interface SaveDraftOptions {
  readonly id?: string;
  readonly file: CanopiFile;
  readonly now: string;
}

interface BrowserAppDataStoreOptions {
  readonly storage?: BrowserStorageAdapter;
}

export interface BrowserAppDataStore {
  saveDraft(options: SaveDraftOptions): BrowserAppDataWriteResult<BrowserDraftSummary>;
  listDrafts(): readonly BrowserDraftSummary[];
  loadDraft(id: string): CanopiFile | null;
  deleteDraft(id: string): BrowserAppDataWriteResult<null>;
  saveSettings(settings: Record<string, unknown>): BrowserAppDataWriteResult<Record<string, unknown>>;
  loadSettings(): Record<string, unknown> | null;
  setFavoriteSpecies(canonicalNames: readonly string[]): BrowserAppDataWriteResult<readonly string[]>;
  listFavoriteSpecies(): readonly string[];
  recordRecentlyViewedSpecies(canonicalName: string, limit?: number): BrowserAppDataWriteResult<readonly string[]>;
  listRecentlyViewedSpecies(): readonly string[];
  saveSavedObjectStamps(records: readonly BrowserSavedObjectStampRecord[]): BrowserAppDataWriteResult<readonly BrowserSavedObjectStampRecord[]>;
  listSavedObjectStamps(): readonly BrowserSavedObjectStampRecord[];
}

export function createBrowserAppDataStore({
  storage = browserLocalStorageAdapter(),
}: BrowserAppDataStoreOptions = {}): BrowserAppDataStore {
  function read(): BrowserAppDataDocument {
    try {
      return normalizeAppDataDocument(JSON.parse(storage.getItem(STORAGE_KEY) ?? "null"));
    } catch {
      return emptyDocument();
    }
  }

  function write<T>(
    mutate: (current: BrowserAppDataDocument) => { next: BrowserAppDataDocument; value: T },
  ): BrowserAppDataWriteResult<T> {
    try {
      const { next, value } = mutate(read());
      storage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error };
    }
  }

  return {
    saveDraft({ id: requestedId, file, now }) {
      return write((current) => {
        const id = normalizeDraftId(requestedId, file.name);
        const summary = {
          id,
          name: file.name || "Untitled",
          updatedAt: now,
        };
        const drafts = [
          summary,
          ...current.drafts.filter((draft) => draft.id !== summary.id),
        ];
        return {
          next: {
            ...current,
            drafts,
            draftFiles: {
              ...current.draftFiles,
              [summary.id]: file,
            },
          },
          value: summary,
        };
      });
    },

    listDrafts() {
      return read().drafts;
    },

    loadDraft(id) {
      const draftFiles = read().draftFiles;
      return Object.prototype.hasOwnProperty.call(draftFiles, id)
        ? draftFiles[id] ?? null
        : null;
    },

    deleteDraft(id) {
      return write((current) => {
        const { [id]: _removed, ...draftFiles } = current.draftFiles;
        return {
          next: {
            ...current,
            drafts: current.drafts.filter((draft) => draft.id !== id),
            draftFiles,
          },
          value: null,
        };
      });
    },

    saveSettings(settings) {
      return write((current) => ({
        next: {
          ...current,
          settings: { ...settings },
        },
        value: { ...settings },
      }));
    },

    loadSettings() {
      return read().settings;
    },

    setFavoriteSpecies(canonicalNames) {
      const favorites = uniqueStrings(canonicalNames);
      return write((current) => ({
        next: {
          ...current,
          favoriteSpecies: favorites,
        },
        value: favorites,
      }));
    },

    listFavoriteSpecies() {
      return read().favoriteSpecies;
    },

    recordRecentlyViewedSpecies(canonicalName, limit = 50) {
      const normalized = canonicalName.trim();
      return write((current) => {
        const recentlyViewedSpecies = normalized.length === 0
          ? current.recentlyViewedSpecies
          : [normalized, ...current.recentlyViewedSpecies.filter((name) => name !== normalized)]
            .slice(0, Math.max(0, limit));
        return {
          next: {
            ...current,
            recentlyViewedSpecies,
          },
          value: recentlyViewedSpecies,
        };
      });
    },

    listRecentlyViewedSpecies() {
      return read().recentlyViewedSpecies;
    },

    saveSavedObjectStamps(records) {
      const savedObjectStamps = records.map((record) => ({ ...record }));
      return write((current) => ({
        next: {
          ...current,
          savedObjectStamps,
        },
        value: savedObjectStamps,
      }));
    },

    listSavedObjectStamps() {
      return read().savedObjectStamps;
    },
  };
}

export const browserAppDataStore = createBrowserAppDataStore();

function browserLocalStorageAdapter(): BrowserStorageAdapter {
  return {
    getItem: (key) => globalThis.localStorage.getItem(key),
    setItem: (key, value) => globalThis.localStorage.setItem(key, value),
    removeItem: (key) => globalThis.localStorage.removeItem(key),
  };
}

function emptyDocument(): BrowserAppDataDocument {
  return {
    drafts: [],
    draftFiles: {},
    settings: null,
    favoriteSpecies: [],
    recentlyViewedSpecies: [],
    savedObjectStamps: [],
  };
}

function normalizeAppDataDocument(value: unknown): BrowserAppDataDocument {
  if (!isRecord(value)) return emptyDocument();
  const draftFiles = decodeDraftFiles(value.draftFiles);
  const validDraftIds = new Set(Object.keys(draftFiles));
  return {
    drafts: Array.isArray(value.drafts)
      ? value.drafts.filter((draft): draft is BrowserDraftSummary => (
        isDraftSummary(draft) && validDraftIds.has(draft.id)
      ))
      : [],
    draftFiles,
    settings: isRecord(value.settings) ? { ...value.settings } : null,
    favoriteSpecies: Array.isArray(value.favoriteSpecies) ? uniqueStrings(value.favoriteSpecies) : [],
    recentlyViewedSpecies: Array.isArray(value.recentlyViewedSpecies) ? uniqueStrings(value.recentlyViewedSpecies) : [],
    savedObjectStamps: Array.isArray(value.savedObjectStamps)
      ? value.savedObjectStamps.filter(isSavedObjectStampRecord)
      : [],
  };
}

function decodeDraftFiles(value: unknown): Record<string, CanopiFile> {
  if (!isRecord(value)) return {};
  const decoded: Record<string, CanopiFile> = {};
  for (const [id, rawFile] of Object.entries(value)) {
    try {
      Object.defineProperty(decoded, id, {
        configurable: true,
        enumerable: true,
        value: decodeCanopiDesign(rawFile),
        writable: true,
      });
    } catch {
      // A corrupt Draft is local convenience data; omit it without poisoning
      // settings, Species data, stamps, or other independently valid Drafts.
    }
  }
  return decoded;
}

function isDraftSummary(value: unknown): value is BrowserDraftSummary {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.updatedAt === "string";
}

function isSavedObjectStampRecord(value: unknown): value is BrowserSavedObjectStampRecord {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && Object.prototype.hasOwnProperty.call(value, "payload");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values: readonly unknown[]): readonly string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function draftIdFor(name: string): string {
  const slug = name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `draft-${slug || "untitled"}`;
}

function normalizeDraftId(id: string | undefined, name: string): string {
  const normalized = id?.trim();
  return normalized && normalized.length > 0 ? normalized : draftIdFor(name);
}
