import { encodeCanopiDesign } from "../app/contracts/canopi-design-wire";
import { decodeCanopiDesign } from "../app/contracts/design-ingestion";
import {
  CURRENT_CANOPI_FILE_VERSION,
  MISSING_CANOPI_FILE_VERSION,
} from "../generated/canopi-design-format";
import type { CanopiFile } from "../types/design";

// Canopi 2.0 reads only these records and migrates nothing (ADR 0021). Browser
// data from before 2.0 (the single `canopi:web-app-data:v1` document of the
// released Web Edition, and Drafts in an older `.canopi` format) is moved to
// dated backup keys by `setAsideDataFromBefore2_0`, never deleted.
const RECORD_VERSION = 2 as const;
const V1_KEY = "canopi:web-app-data:v1";
const BACKUP_KEY_PREFIX = "canopi:web-app-data:before-2.0-";
/** Set once the user has been told that earlier data could not be moved aside. */
const KEPT_IN_PLACE_NOTICE_KEY = "canopi:web-app-data:before-2.0-kept-in-place-notice";
const STORAGE_KEYS = {
  drafts: "canopi:web-app-data:v2:drafts",
  settings: "canopi:web-app-data:v2:settings",
  species: "canopi:web-app-data:v2:species",
  stamps: "canopi:web-app-data:v2:saved-object-stamps",
} as const;

export interface BrowserStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type BrowserAppDataWriteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

/**
 * What `setAsideDataFromBefore2_0` did; `error` is the first step that failed.
 * `keptInPlace` is true when earlier data was found but could not be moved
 * (its copy did not fit) and the user has not yet been told so.
 */
export interface BrowserSetAsideOutcome {
  readonly movedAside: boolean;
  readonly keptInPlace: boolean;
  readonly error: unknown;
}

export interface BrowserDraftSummary {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

interface BrowserSavedObjectStampRecord {
  readonly id: string;
  readonly name: string;
  readonly payload: unknown;
}


interface BrowserDraftsRecord {
  readonly version: 2;
  readonly drafts: readonly BrowserDraftSummary[];
  readonly draftFiles: Record<string, CanopiFile>;
  /**
   * Drafts this Canopi refuses to open (a damaged or newer Design, or an older
   * one not yet set aside), kept as their stored values so a write of another
   * Draft never erases them.
   */
  readonly refused: RefusedDrafts;
}

interface RefusedDrafts {
  readonly summaries: readonly unknown[];
  readonly files: Record<string, unknown>;
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

/** One independently stored record. A missing or unreadable record reads as empty. */
interface BrowserStoragePartition<TRecord> {
  readonly key: string;
  accepts(value: unknown): boolean;
  normalize(value: unknown): TRecord;
  /** Storage form of a record; defaults to the record itself. */
  encode?(record: TRecord): unknown;
}

const PARTITIONS = {
  drafts: {
    key: STORAGE_KEYS.drafts,
    accepts: isSupportedDraftsRecord,
    normalize: normalizeDraftsRecord,
    // Draft files are stored in the .canopi wire form, like every other
    // persisted Design, so they decode through the same admission.
    encode: encodeDraftsRecord,
  },
  settings: {
    key: STORAGE_KEYS.settings,
    accepts: isSupportedSettingsRecord,
    normalize: normalizeSettingsRecord,
  },
  species: {
    key: STORAGE_KEYS.species,
    accepts: isSupportedSpeciesRecord,
    normalize: normalizeSpeciesRecord,
  },
  stamps: {
    key: STORAGE_KEYS.stamps,
    accepts: isSupportedStampsRecord,
    normalize: normalizeStampsRecord,
  },
} as const;

interface SaveDraftOptions {
  readonly id?: string;
  readonly file: CanopiFile;
  readonly now: string;
  /**
   * The `updatedAt` this writer last read or wrote for the Draft (null: it
   * never saw one). When another browser tab has since written the Draft, the
   * save is refused with `BrowserDraftChangedError` instead of replacing it.
   * Omitted: overwrite unconditionally.
   */
  readonly expectedUpdatedAt?: string | null;
  /**
   * The write is not an edit (it carries only a view that moved): the Draft
   * keeps its `updatedAt` and its place in the list, so the stamp another tab
   * holds stays valid. A Draft deleted meanwhile is written as new.
   */
  readonly keepUpdatedAt?: boolean;
}

/** Another browser tab wrote the Draft after this writer last read or wrote it. */
export class BrowserDraftChangedError extends Error {
  constructor(readonly draftId: string) {
    super("The Draft was changed in another browser tab");
    this.name = "BrowserDraftChangedError";
  }
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
  /**
   * Move browser data from before Canopi 2.0 to dated backup keys
   * (`canopi:web-app-data:before-2.0-<UTC stamp>:<original key suffix>`): the
   * v1 document as it is, and older-format Drafts as a Drafts record of their
   * own. A backup never replaces another one, and nothing leaves its key until
   * its copy is written. Current, newer and damaged Drafts stay. Once moved,
   * nothing is left to move, so the caller's notice shows once. Data whose copy
   * does not fit (near the storage quota the data is briefly held twice) stays
   * in place, is reported once as `keptInPlace`, and moves on a later start
   * once there is room.
   */
  setAsideDataFromBefore2_0(now: string): BrowserSetAsideOutcome;
}

export function createBrowserAppDataStore({
  storage = browserLocalStorageAdapter(),
}: BrowserAppDataStoreOptions = {}): BrowserAppDataStore {
  function readPartition<TRecord>(partition: BrowserStoragePartition<TRecord>): TRecord {
    try {
      const raw = storage.getItem(partition.key);
      if (raw === null) return partition.normalize(null);
      const parsed: unknown = JSON.parse(raw);
      return partition.normalize(partition.accepts(parsed) ? parsed : null);
    } catch {
      return partition.normalize(null);
    }
  }

  function writePartition<TRecord, TValue>(
    partition: BrowserStoragePartition<TRecord>,
    mutate: (current: TRecord) => { next: TRecord; value: TValue },
  ): BrowserAppDataWriteResult<TValue> {
    try {
      const mutation = mutate(readPartition(partition));
      storage.setItem(
        partition.key,
        JSON.stringify(partition.encode ? partition.encode(mutation.next) : mutation.next),
      );
      return { ok: true, value: mutation.value };
    } catch (error) {
      return { ok: false, error };
    }
  }

  return {
    saveDraft({ id: requestedId, file, now, expectedUpdatedAt, keepUpdatedAt = false }) {
      return writePartition(
        PARTITIONS.drafts,
        (current) => {
          const id = normalizeDraftId(requestedId, file.name);
          // A Draft deleted meanwhile is written again rather than lost.
          const stored = current.drafts.find((draft) => draft.id === id);
          if (expectedUpdatedAt !== undefined && stored && stored.updatedAt !== expectedUpdatedAt) {
            throw new BrowserDraftChangedError(id);
          }
          const kept = keepUpdatedAt ? stored : undefined;
          const summary = {
            id,
            name: file.name || "Untitled",
            updatedAt: kept?.updatedAt ?? now,
          };
          const drafts = kept
            ? current.drafts.map((draft) => draft.id === id ? summary : draft)
            : [summary, ...current.drafts.filter((draft) => draft.id !== summary.id)];
          return {
            next: {
              version: RECORD_VERSION,
              drafts,
              draftFiles: {
                ...current.draftFiles,
                [summary.id]: file,
              },
              refused: withoutRefusedDraft(current.refused, summary.id),
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
              refused: withoutRefusedDraft(current.refused, id),
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

    setAsideDataFromBefore2_0(now) {
      let base: string | null = null;
      const backupKey = (suffix: string) => {
        base ??= freeBackupBase(storage, backupStamp(now));
        return `${base}:${suffix}`;
      };
      let movedAside = false;
      let kept = false;
      let error: unknown = null;
      for (const step of [setAsideV1Document, setAsideOlderDrafts]) {
        try {
          const outcome = step(storage, backupKey);
          if (outcome === "moved") movedAside = true;
          if (typeof outcome === "object") {
            kept = true;
            error ??= outcome.keptInPlace;
          }
        } catch (cause) {
          error ??= cause; // Nothing was found to move, or reading failed.
        }
      }
      return { movedAside, keptInPlace: noteKeptInPlace(storage, kept, now), error };
    },
  };
}

const BACKUP_SUFFIXES = { v1: "v1", drafts: "v2:drafts" } as const;

/** `2026-10-02T12:00:00.000Z` → `20261002T120000Z`. */
function backupStamp(now: string): string {
  return new Date(now).toISOString().replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");
}

function freeBackupBase(storage: BrowserStorageAdapter, stamp: string): string {
  for (let n = 0; ; n += 1) {
    const base = `${BACKUP_KEY_PREFIX}${stamp}${n === 0 ? "" : `-${n}`}`;
    const taken = Object.values(BACKUP_SUFFIXES)
      .some((suffix) => storage.getItem(`${base}:${suffix}`) !== null);
    if (!taken) return base;
  }
}

/** "moved", "nothing" to move, or found but `keptInPlace` because its copy failed. */
type SetAsideStepOutcome = "moved" | "nothing" | { readonly keptInPlace: unknown };

/**
 * True when the user should now be told that earlier data stays in place:
 * the first time it is kept. The marker is cleared once nothing is kept, and
 * when it cannot be written the user is told again on the next start.
 */
function noteKeptInPlace(storage: BrowserStorageAdapter, kept: boolean, now: string): boolean {
  try {
    const told = storage.getItem(KEPT_IN_PLACE_NOTICE_KEY) !== null;
    if (!kept) {
      if (told) storage.removeItem(KEPT_IN_PLACE_NOTICE_KEY);
      return false;
    }
    if (told) return false;
  } catch {
    return kept;
  }
  try {
    storage.setItem(KEPT_IN_PLACE_NOTICE_KEY, now);
  } catch {
    // No room even for the marker: the notice repeats until there is.
  }
  return true;
}

/**
 * Write `value` under the free `key` and read it back; throws when the copy
 * did not land, after removing whatever part of it did.
 */
function writeBackup(storage: BrowserStorageAdapter, key: string, value: string): void {
  try {
    storage.setItem(key, value);
    if (storage.getItem(key) !== value) throw new Error(`The backup ${key} could not be verified`);
  } catch (error) {
    try {
      storage.removeItem(key);
    } catch {
      // A leftover copy is harmless: the originals are untouched.
    }
    throw error;
  }
}

function setAsideV1Document(
  storage: BrowserStorageAdapter,
  backupKey: (suffix: string) => string,
): SetAsideStepOutcome {
  const raw = storage.getItem(V1_KEY);
  if (raw === null) return "nothing";
  try {
    writeBackup(storage, backupKey(BACKUP_SUFFIXES.v1), raw);
  } catch (cause) {
    return { keptInPlace: cause };
  }
  storage.removeItem(V1_KEY);
  return "moved";
}

function setAsideOlderDrafts(
  storage: BrowserStorageAdapter,
  backupKey: (suffix: string) => string,
): SetAsideStepOutcome {
  const raw = storage.getItem(STORAGE_KEYS.drafts);
  if (raw === null) return "nothing";
  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    return "nothing"; // A damaged record stays where it is.
  }
  if (!isSupportedDraftsRecord(record)) return "nothing";
  const supported = record as Record<string, unknown> & {
    drafts: readonly unknown[];
    draftFiles: Record<string, unknown>;
  };
  const { drafts, draftFiles } = supported;
  const older: Record<string, unknown> = {};
  const kept: Record<string, unknown> = {};
  for (const [id, file] of Object.entries(draftFiles)) {
    defineOwn(isFromBefore2_0(file) ? older : kept, id, file);
  }
  if (Object.keys(older).length === 0) return "nothing";
  const isOlder = (draft: unknown) => (
    isRecord(draft) && typeof draft.id === "string" && Object.prototype.hasOwnProperty.call(older, draft.id)
  );

  const key = backupKey(BACKUP_SUFFIXES.drafts);
  try {
    writeBackup(storage, key, JSON.stringify({
      version: RECORD_VERSION,
      drafts: drafts.filter(isOlder),
      draftFiles: older,
    }));
  } catch (cause) {
    return { keptInPlace: cause };
  }
  try {
    storage.setItem(STORAGE_KEYS.drafts, JSON.stringify({
      ...supported,
      drafts: drafts.filter((draft) => !isOlder(draft)),
      draftFiles: kept,
    }));
  } catch (cause) {
    // The Drafts stay where they were; drop the copy so a retry is not doubled.
    try {
      storage.removeItem(key);
    } catch {
      // A leftover copy is harmless: the originals are untouched.
    }
    return { keptInPlace: cause };
  }
  return "moved";
}

/** A Design whose `.canopi` version is older than the current one (a missing version counts as 1). */
function isFromBefore2_0(file: unknown): boolean {
  if (!isRecord(file)) return false;
  const version = Object.prototype.hasOwnProperty.call(file, "version")
    ? file.version
    : MISSING_CANOPI_FILE_VERSION;
  return typeof version === "number"
    && Number.isInteger(version)
    && version >= 1
    && version < CURRENT_CANOPI_FILE_VERSION;
}

export const browserAppDataStore = createBrowserAppDataStore();

function browserLocalStorageAdapter(): BrowserStorageAdapter {
  return {
    getItem: (key) => globalThis.localStorage.getItem(key),
    setItem: (key, value) => globalThis.localStorage.setItem(key, value),
    removeItem: (key) => globalThis.localStorage.removeItem(key),
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
  const { decoded: draftFiles, refused: refusedFiles } = decodeDraftFiles(value.draftFiles);
  const validDraftIds = new Set(Object.keys(draftFiles));
  const summaries: readonly unknown[] = Array.isArray(value.drafts) ? value.drafts : [];
  return {
    version: RECORD_VERSION,
    drafts: summaries.filter((draft): draft is BrowserDraftSummary => (
      isDraftSummary(draft) && validDraftIds.has(draft.id)
    )),
    draftFiles,
    refused: {
      summaries: summaries.filter((draft) => (
        isRecord(draft)
        && typeof draft.id === "string"
        && Object.prototype.hasOwnProperty.call(refusedFiles, draft.id)
      )),
      files: refusedFiles,
    },
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
  return { version: RECORD_VERSION, drafts: [], draftFiles: {}, refused: { summaries: [], files: {} } };
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

function encodeDraftsRecord(record: BrowserDraftsRecord): unknown {
  const draftFiles: Record<string, unknown> = {};
  for (const [id, file] of Object.entries(record.refused.files)) {
    defineOwn(draftFiles, id, file);
  }
  for (const [id, file] of Object.entries(record.draftFiles)) {
    defineOwn(draftFiles, id, encodeCanopiDesign(file));
  }
  return {
    version: record.version,
    drafts: [...record.drafts, ...record.refused.summaries],
    draftFiles,
  };
}

function withoutRefusedDraft(refused: RefusedDrafts, id: string): RefusedDrafts {
  if (!Object.prototype.hasOwnProperty.call(refused.files, id)) return refused;
  const { [id]: _removed, ...files } = refused.files;
  return {
    summaries: refused.summaries.filter((draft) => !isRecord(draft) || draft.id !== id),
    files,
  };
}

function decodeDraftFiles(value: unknown): {
  decoded: Record<string, CanopiFile>;
  refused: Record<string, unknown>;
} {
  const decoded: Record<string, CanopiFile> = {};
  const refused: Record<string, unknown> = {};
  if (!isRecord(value)) return { decoded, refused };
  for (const [id, rawFile] of Object.entries(value)) {
    try {
      defineOwn(decoded, id, decodeCanopiDesign(rawFile));
    } catch {
      // A Draft that does not open is not listed, but its stored value is
      // kept: it is the user's Design, not ours to erase.
      defineOwn(refused, id, rawFile);
    }
  }
  return { decoded, refused };
}

function defineOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
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
