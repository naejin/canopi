import { decodeCanopiDesign } from "../app/contracts/design-ingestion";
import type { CanopiFile } from "../types/design";
import {
  createBrowserPartitionStorage,
  type BrowserPartitionWriteResult,
  type BrowserStorageAdapter as StorageAdapter,
} from "./browser-partition-storage";

const LEGACY_STORAGE_KEY = "canopi:web-app-data:v1";
const V2_COMMITTED_AUTHORITY_STORAGE_KEY = "canopi:web-app-data:v2:authority";
const V2_MIGRATION_PROGRESS_STORAGE_KEY = "canopi:web-app-data:v2:migration-progress";
const V2_AUTHORITY_RESERVATION_STORAGE_KEY = "canopi:web-app-data:v2:authority-reservation";
const RECORD_VERSION = 2 as const;
const STORAGE_KEYS = {
  drafts: "canopi:web-app-data:v2:drafts",
  settings: "canopi:web-app-data:v2:settings",
  species: "canopi:web-app-data:v2:species",
  stamps: "canopi:web-app-data:v2:saved-object-stamps",
} as const;

export type BrowserStorageAdapter = StorageAdapter;

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

export type BrowserAppDataWriteResult<T> = BrowserPartitionWriteResult<T>;

interface LegacyBrowserAppDataDocument {
  readonly drafts: readonly BrowserDraftSummary[];
  readonly draftFiles: Record<string, CanopiFile>;
  readonly settings: Record<string, unknown> | null;
  readonly favoriteSpecies: readonly string[];
  readonly recentlyViewedSpecies: readonly string[];
  readonly savedObjectStamps: readonly BrowserSavedObjectStampRecord[];
}

interface BrowserDraftsRecord {
  readonly version: 2;
  readonly drafts: readonly BrowserDraftSummary[];
  readonly draftFiles: Record<string, CanopiFile>;
}

interface BrowserSettingsRecord {
  readonly version: 2;
  readonly settings: Record<string, unknown> | null;
}

interface BrowserSpeciesRecord {
  readonly version: 2;
  readonly favoriteSpecies: readonly string[];
  readonly recentlyViewedSpecies: readonly string[];
}

interface BrowserSavedObjectStampsRecord {
  readonly version: 2;
  readonly savedObjectStamps: readonly BrowserSavedObjectStampRecord[];
}

const PARTITIONS = {
  drafts: {
    key: STORAGE_KEYS.drafts,
    slot: 0,
    accepts: isSupportedDraftsRecord,
    normalize: normalizeDraftsRecord,
    fromLegacy: draftsRecordFromLegacy,
    toLegacy: legacyDocumentWithDrafts,
  },
  settings: {
    key: STORAGE_KEYS.settings,
    slot: 1,
    accepts: isSupportedSettingsRecord,
    normalize: normalizeSettingsRecord,
    fromLegacy: settingsRecordFromLegacy,
    toLegacy: legacyDocumentWithSettings,
  },
  species: {
    key: STORAGE_KEYS.species,
    slot: 2,
    accepts: isSupportedSpeciesRecord,
    normalize: normalizeSpeciesRecord,
    fromLegacy: speciesRecordFromLegacy,
    toLegacy: legacyDocumentWithSpecies,
  },
  stamps: {
    key: STORAGE_KEYS.stamps,
    slot: 3,
    accepts: isSupportedStampsRecord,
    normalize: normalizeStampsRecord,
    fromLegacy: stampsRecordFromLegacy,
    toLegacy: legacyDocumentWithStamps,
  },
} as const;

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
  const { readPartition, writePartition } = createBrowserPartitionStorage({
    storage,
    legacyKey: LEGACY_STORAGE_KEY,
    committedAuthorityKey: V2_COMMITTED_AUTHORITY_STORAGE_KEY,
    migrationProgressKey: V2_MIGRATION_PROGRESS_STORAGE_KEY,
    authorityReservationKey: V2_AUTHORITY_RESERVATION_STORAGE_KEY,
    recordVersion: RECORD_VERSION,
    partitions: Object.values(PARTITIONS),
    decodeLegacy(raw) {
      try {
        return normalizeLegacyAppDataDocument(JSON.parse(raw));
      } catch {
        return emptyLegacyDocument();
      }
    },
  });

  return {
    saveDraft({ id: requestedId, file, now }) {
      return writePartition(
        PARTITIONS.drafts,
        (current) => {
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
              version: RECORD_VERSION,
              drafts,
              draftFiles: {
                ...current.draftFiles,
                [summary.id]: file,
              },
            },
            value: summary,
          };
        },
      );
    },

    listDrafts() {
      return readPartition(PARTITIONS.drafts).drafts;
    },

    loadDraft(id) {
      const draftFiles = readPartition(PARTITIONS.drafts).draftFiles;
      return Object.prototype.hasOwnProperty.call(draftFiles, id)
        ? draftFiles[id] ?? null
        : null;
    },

    deleteDraft(id) {
      return writePartition(
        PARTITIONS.drafts,
        (current) => {
          const { [id]: _removed, ...draftFiles } = current.draftFiles;
          return {
            next: {
              version: RECORD_VERSION,
              drafts: current.drafts.filter((draft) => draft.id !== id),
              draftFiles,
            },
            value: null,
          };
        },
      );
    },

    saveSettings(settings) {
      return writePartition(
        PARTITIONS.settings,
        () => ({
          next: {
            version: RECORD_VERSION,
            settings: { ...settings },
          },
          value: { ...settings },
        }),
      );
    },

    loadSettings() {
      return readPartition(PARTITIONS.settings).settings;
    },

    setFavoriteSpecies(canonicalNames) {
      const favorites = uniqueStrings(canonicalNames);
      return writePartition(
        PARTITIONS.species,
        (current) => ({
          next: {
            ...current,
            favoriteSpecies: favorites,
          },
          value: favorites,
        }),
      );
    },

    listFavoriteSpecies() {
      return readPartition(PARTITIONS.species).favoriteSpecies;
    },

    recordRecentlyViewedSpecies(canonicalName, limit = 50) {
      const normalized = canonicalName.trim();
      return writePartition(
        PARTITIONS.species,
        (current) => {
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
        },
      );
    },

    listRecentlyViewedSpecies() {
      return readPartition(PARTITIONS.species).recentlyViewedSpecies;
    },

    saveSavedObjectStamps(records) {
      const savedObjectStamps = records.map((record) => ({ ...record }));
      return writePartition(
        PARTITIONS.stamps,
        () => ({
          next: {
            version: RECORD_VERSION,
            savedObjectStamps,
          },
          value: savedObjectStamps,
        }),
      );
    },

    listSavedObjectStamps() {
      return readPartition(PARTITIONS.stamps).savedObjectStamps;
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

function draftsRecordFromLegacy(document: LegacyBrowserAppDataDocument): BrowserDraftsRecord {
  return {
    version: RECORD_VERSION,
    drafts: document.drafts.map((draft) => ({ ...draft })),
    draftFiles: { ...document.draftFiles },
  };
}

function settingsRecordFromLegacy(document: LegacyBrowserAppDataDocument): BrowserSettingsRecord {
  return {
    version: RECORD_VERSION,
    settings: document.settings ? { ...document.settings } : null,
  };
}

function speciesRecordFromLegacy(document: LegacyBrowserAppDataDocument): BrowserSpeciesRecord {
  return {
    version: RECORD_VERSION,
    favoriteSpecies: [...document.favoriteSpecies],
    recentlyViewedSpecies: [...document.recentlyViewedSpecies],
  };
}

function stampsRecordFromLegacy(document: LegacyBrowserAppDataDocument): BrowserSavedObjectStampsRecord {
  return {
    version: RECORD_VERSION,
    savedObjectStamps: document.savedObjectStamps.map((record) => ({ ...record })),
  };
}

function legacyDocumentWithDrafts(
  document: LegacyBrowserAppDataDocument,
  record: BrowserDraftsRecord,
): LegacyBrowserAppDataDocument {
  return {
    ...document,
    drafts: record.drafts.map((draft) => ({ ...draft })),
    draftFiles: { ...record.draftFiles },
  };
}

function legacyDocumentWithSettings(
  document: LegacyBrowserAppDataDocument,
  record: BrowserSettingsRecord,
): LegacyBrowserAppDataDocument {
  return {
    ...document,
    settings: record.settings ? { ...record.settings } : null,
  };
}

function legacyDocumentWithSpecies(
  document: LegacyBrowserAppDataDocument,
  record: BrowserSpeciesRecord,
): LegacyBrowserAppDataDocument {
  return {
    ...document,
    favoriteSpecies: [...record.favoriteSpecies],
    recentlyViewedSpecies: [...record.recentlyViewedSpecies],
  };
}

function legacyDocumentWithStamps(
  document: LegacyBrowserAppDataDocument,
  record: BrowserSavedObjectStampsRecord,
): LegacyBrowserAppDataDocument {
  return {
    ...document,
    savedObjectStamps: record.savedObjectStamps.map((stamp) => ({ ...stamp })),
  };
}

function isSupportedDraftsRecord(value: unknown): boolean {
  return isV2Record(value)
    && Array.isArray(value.drafts)
    && isRecord(value.draftFiles);
}

function isSupportedSettingsRecord(value: unknown): boolean {
  return isV2Record(value)
    && (value.settings === null || isRecord(value.settings));
}

function isSupportedSpeciesRecord(value: unknown): boolean {
  return isV2Record(value)
    && Array.isArray(value.favoriteSpecies)
    && Array.isArray(value.recentlyViewedSpecies);
}

function isSupportedStampsRecord(value: unknown): boolean {
  return isV2Record(value) && Array.isArray(value.savedObjectStamps);
}

function normalizeDraftsRecord(value: unknown): BrowserDraftsRecord {
  if (!isV2Record(value)) return emptyDraftsRecord();
  const draftFiles = decodeDraftFiles(value.draftFiles);
  const validDraftIds = new Set(Object.keys(draftFiles));
  return {
    version: RECORD_VERSION,
    drafts: Array.isArray(value.drafts)
      ? value.drafts.filter((draft): draft is BrowserDraftSummary => (
        isDraftSummary(draft) && validDraftIds.has(draft.id)
      ))
      : [],
    draftFiles,
  };
}

function normalizeSettingsRecord(value: unknown): BrowserSettingsRecord {
  if (!isV2Record(value)) return emptySettingsRecord();
  return {
    version: RECORD_VERSION,
    settings: isRecord(value.settings) ? { ...value.settings } : null,
  };
}

function normalizeSpeciesRecord(value: unknown): BrowserSpeciesRecord {
  if (!isV2Record(value)) return emptySpeciesRecord();
  return {
    version: RECORD_VERSION,
    favoriteSpecies: Array.isArray(value.favoriteSpecies)
      ? uniqueStrings(value.favoriteSpecies)
      : [],
    recentlyViewedSpecies: Array.isArray(value.recentlyViewedSpecies)
      ? uniqueStrings(value.recentlyViewedSpecies)
      : [],
  };
}

function normalizeStampsRecord(value: unknown): BrowserSavedObjectStampsRecord {
  if (!isV2Record(value)) return emptyStampsRecord();
  return {
    version: RECORD_VERSION,
    savedObjectStamps: Array.isArray(value.savedObjectStamps)
      ? value.savedObjectStamps.filter(isSavedObjectStampRecord)
      : [],
  };
}

function emptyDraftsRecord(): BrowserDraftsRecord {
  return { version: RECORD_VERSION, drafts: [], draftFiles: {} };
}

function emptySettingsRecord(): BrowserSettingsRecord {
  return { version: RECORD_VERSION, settings: null };
}

function emptySpeciesRecord(): BrowserSpeciesRecord {
  return {
    version: RECORD_VERSION,
    favoriteSpecies: [],
    recentlyViewedSpecies: [],
  };
}

function emptyStampsRecord(): BrowserSavedObjectStampsRecord {
  return { version: RECORD_VERSION, savedObjectStamps: [] };
}

function isV2Record(value: unknown): value is Record<string, unknown> & { version: 2 } {
  return isRecord(value) && value.version === RECORD_VERSION;
}

function emptyLegacyDocument(): LegacyBrowserAppDataDocument {
  return {
    drafts: [],
    draftFiles: {},
    settings: null,
    favoriteSpecies: [],
    recentlyViewedSpecies: [],
    savedObjectStamps: [],
  };
}

function normalizeLegacyAppDataDocument(value: unknown): LegacyBrowserAppDataDocument {
  if (!isRecord(value)) return emptyLegacyDocument();
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
