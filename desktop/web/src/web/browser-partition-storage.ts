export interface BrowserStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type BrowserPartitionWriteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

interface BrowserStoragePartitionDescriptor {
  readonly key: string;
  readonly slot: 0 | 1 | 2 | 3;
  accepts(value: unknown): boolean;
}

export interface BrowserStoragePartition<TLegacy, TRecord>
  extends BrowserStoragePartitionDescriptor {
  normalize(value: unknown): TRecord;
  fromLegacy(document: TLegacy): TRecord;
  toLegacy(document: TLegacy, record: TRecord): TLegacy;
}

interface BrowserPartitionStorageOptions<TLegacy> {
  readonly storage: BrowserStorageAdapter;
  readonly legacyKey: string;
  readonly committedAuthorityKey: string;
  readonly migrationProgressKey: string;
  readonly authorityReservationKey: string;
  readonly recordVersion: number;
  readonly partitions: readonly BrowserStoragePartitionDescriptor[];
  decodeLegacy(raw: string): TLegacy;
}

interface PartitionState<TLegacy, TRecord> {
  readonly record: TRecord;
  readonly legacyDocument: TLegacy | null;
}

interface DecodedPartition<T> {
  readonly valid: boolean;
  readonly record: T;
}

interface MigrationProgress {
  readonly version: number;
  readonly state: "migrating";
  readonly partitions: string;
}

export interface BrowserPartitionStorage<TLegacy> {
  readPartition<TRecord>(
    partition: BrowserStoragePartition<TLegacy, TRecord>,
  ): TRecord;
  writePartition<TRecord, TValue>(
    partition: BrowserStoragePartition<TLegacy, TRecord>,
    mutate: (current: TRecord) => { next: TRecord; value: TValue },
  ): BrowserPartitionWriteResult<TValue>;
}

export function createBrowserPartitionStorage<TLegacy>({
  storage,
  legacyKey,
  committedAuthorityKey,
  migrationProgressKey,
  authorityReservationKey,
  recordVersion,
  partitions,
  decodeLegacy,
}: BrowserPartitionStorageOptions<TLegacy>): BrowserPartitionStorage<TLegacy> {
  const initialMigrationProgressJson = JSON.stringify({
    version: recordVersion,
    state: "migrating",
    partitions: "0000",
  });
  const authorityReservationJson = JSON.stringify({
    version: recordVersion,
    reserves: "v2-authority-tombstone",
  });
  const committedAuthorityJson = JSON.stringify({
    version: recordVersion,
    authority: "v2",
  });
  const partitionSlots = new Set(partitions.map((partition) => partition.slot));
  if (partitions.length !== 4 || partitionSlots.size !== 4) {
    throw new Error("browser partition storage requires one resource for each of four slots");
  }
  const storageKeys = [
    legacyKey,
    committedAuthorityKey,
    migrationProgressKey,
    authorityReservationKey,
    ...partitions.map((partition) => partition.key),
  ];
  if (new Set(storageKeys).size !== storageKeys.length) {
    throw new Error("browser partition storage keys must be unique");
  }
  if (
    authorityReservationKey.length + authorityReservationJson.length
    < committedAuthorityKey.length + committedAuthorityJson.length
  ) {
    throw new Error("browser authority reservation must cover the committed tombstone");
  }
  let recoveryChecked = false;

  function hasCommittedAuthority(): boolean {
    const raw = storage.getItem(committedAuthorityKey);
    if (raw === null) return false;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed)
        && Object.keys(parsed).length === 2
        && parsed.version === recordVersion
        && parsed.authority === "v2";
    } catch {
      return false;
    }
  }

  function readMigrationProgress(): MigrationProgress | null {
    const raw = storage.getItem(migrationProgressKey);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || Object.keys(parsed).length !== 3) return null;
      if (parsed.version !== recordVersion || parsed.state !== "migrating") return null;
      if (typeof parsed.partitions !== "string" || !/^[01]{4}$/.test(parsed.partitions)) {
        return null;
      }
      return {
        version: recordVersion,
        state: "migrating",
        partitions: parsed.partitions,
      };
    } catch {
      return null;
    }
  }

  function hasAuthorityReservation(): boolean {
    const raw = storage.getItem(authorityReservationKey);
    if (raw === null) return false;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed)
        && Object.keys(parsed).length === 2
        && parsed.version === recordVersion
        && parsed.reserves === "v2-authority-tombstone";
    } catch {
      return false;
    }
  }

  function ensureMigrationProgress(): void {
    if (hasCommittedAuthority()) return;
    if (!readMigrationProgress()) {
      storage.setItem(migrationProgressKey, initialMigrationProgressJson);
    }
    if (!hasAuthorityReservation()) {
      storage.setItem(authorityReservationKey, authorityReservationJson);
    }
  }

  function removeMigrationSourcesAfterCommit(): void {
    try {
      storage.removeItem(legacyKey);
    } catch {
      // The committed tombstone is authoritative; removal is cleanup only.
    }
    releaseMigrationMetadataForLegacyFallback();
  }

  function releaseMigrationMetadataForLegacyFallback(): void {
    try {
      storage.removeItem(migrationProgressKey);
    } catch {
      // Best effort: the subsequent legacy write still reports quota failure.
    }
    try {
      storage.removeItem(authorityReservationKey);
    } catch {
      // Best effort: v1 remains the durable recovery trigger for this resource.
    }
  }

  function finalizeAuthorityIfComplete(): boolean {
    if (hasCommittedAuthority()) {
      removeMigrationSourcesAfterCommit();
      return true;
    }

    for (const partition of partitions) {
      const raw = storage.getItem(partition.key);
      if (raw === null || !isSupportedPartition(raw, partition.accepts)) return false;
    }

    // Progress remains as a durable recovery trigger while the separate quota
    // reservation is exchanged for the immutable committed tombstone.
    ensureMigrationProgress();
    if (hasAuthorityReservation()) storage.removeItem(authorityReservationKey);
    try {
      storage.setItem(committedAuthorityKey, committedAuthorityJson);
    } catch (error) {
      // Progress remains intact, so a later instance retries finalization.
      throw error;
    }
    removeMigrationSourcesAfterCommit();
    return true;
  }

  function recoverInterruptedMigrationOnce(): void {
    if (recoveryChecked) return;
    recoveryChecked = true;
    try {
      if (hasCommittedAuthority()) {
        removeMigrationSourcesAfterCommit();
        return;
      }
      const progress = readMigrationProgress();
      if (!progress) return;

      // A zero bit may mean publication never happened or the tab crashed
      // between the resource write and progress update. Inspect only zero-bit
      // resources so reopening a normal partial migration never parses an
      // already-transitioned Draft partition.
      const recovered = [...progress.partitions];
      for (const partition of partitions) {
        if (recovered[partition.slot] === "1") continue;
        const raw = storage.getItem(partition.key);
        if (raw !== null && isSupportedPartition(raw, partition.accepts)) {
          recovered[partition.slot] = "1";
        }
      }
      const recoveredPartitions = recovered.join("");
      if (recoveredPartitions !== progress.partitions) {
        const nextProgress: MigrationProgress = {
          version: recordVersion,
          state: "migrating",
          partitions: recoveredPartitions,
        };
        storage.setItem(migrationProgressKey, JSON.stringify(nextProgress));
      }
      if (recoveredPartitions === "1111") finalizeAuthorityIfComplete();
    } catch {
      // Recovery is maintenance; resource reads retain their fallback and
      // writes report only the result of their own target publication.
    }
  }

  function recordPublishedPartition(slot: 0 | 1 | 2 | 3): void {
    try {
      if (hasCommittedAuthority()) {
        removeMigrationSourcesAfterCommit();
        return;
      }
      const progress = readMigrationProgress();
      if (!progress) return;
      const published = [...progress.partitions];
      published[slot] = "1";
      const nextProgress: MigrationProgress = {
        version: recordVersion,
        state: "migrating",
        partitions: published.join(""),
      };
      storage.setItem(migrationProgressKey, JSON.stringify(nextProgress));
      if (nextProgress.partitions === "1111") finalizeAuthorityIfComplete();
    } catch {
      // The resource write already committed. A later instance validates all
      // partitions and resumes marker finalization.
    }
  }

  function readVisiblePartition<TRecord>(
    partition: BrowserStoragePartition<TLegacy, TRecord>,
  ): TRecord | null {
    const raw = storage.getItem(partition.key);
    if (raw === null) return null;
    const decoded = decodeStoredPartition(raw, partition.accepts, partition.normalize);
    return decoded.valid ? decoded.record : null;
  }

  function readPartitionForWrite<TRecord>(
    partition: BrowserStoragePartition<TLegacy, TRecord>,
  ): PartitionState<TLegacy, TRecord> {
    const stored = storage.getItem(partition.key);
    if (stored !== null) {
      const decoded = decodeStoredPartition(stored, partition.accepts, partition.normalize);
      if (decoded.valid) return { record: decoded.record, legacyDocument: null };
    }
    if (hasCommittedAuthority()) {
      return { record: partition.normalize(null), legacyDocument: null };
    }
    const rawLegacy = storage.getItem(legacyKey);
    const legacyDocument = rawLegacy === null ? null : decodeLegacy(rawLegacy);
    return {
      record: legacyDocument
        ? partition.fromLegacy(legacyDocument)
        : partition.normalize(null),
      legacyDocument,
    };
  }

  return {
    readPartition<TRecord>(partition: BrowserStoragePartition<TLegacy, TRecord>): TRecord {
      recoverInterruptedMigrationOnce();
      try {
        const stored = storage.getItem(partition.key);
        if (stored !== null) {
          const decoded = decodeStoredPartition(stored, partition.accepts, partition.normalize);
          if (decoded.valid) return decoded.record;
        }
        if (hasCommittedAuthority()) return partition.normalize(null);
        const rawLegacy = storage.getItem(legacyKey);
        return rawLegacy === null
          ? partition.normalize(null)
          : partition.fromLegacy(decodeLegacy(rawLegacy));
      } catch {
        return partition.normalize(null);
      }
    },

    writePartition<TRecord, TValue>(
      partition: BrowserStoragePartition<TLegacy, TRecord>,
      mutate: (current: TRecord) => { next: TRecord; value: TValue },
    ): BrowserPartitionWriteResult<TValue> {
      try {
        recoverInterruptedMigrationOnce();
        const state = readPartitionForWrite(partition);
        const mutation = mutate(state.record);

        const publishRebasedV2 = (current: TRecord): BrowserPartitionWriteResult<TValue> => {
          const rebased = mutate(current);
          storage.setItem(partition.key, JSON.stringify(rebased.next));
          recordPublishedPartition(partition.slot);
          return { ok: true, value: rebased.value };
        };

        const publishLegacyFallback = (): BrowserPartitionWriteResult<TValue> => {
          if (!state.legacyDocument) throw new Error("v1 fallback requires a legacy source");

          const concurrent = readVisiblePartition(partition);
          if (concurrent !== null) return publishRebasedV2(concurrent);
          if (hasCommittedAuthority()) return publishRebasedV2(partition.normalize(null));

          // Metadata must not consume the quota that made legacy writes viable
          // before migration. v1 itself remains the recovery trigger.
          releaseMigrationMetadataForLegacyFallback();
          const currentRawLegacy = storage.getItem(legacyKey);
          if (currentRawLegacy === null) {
            const appeared = readVisiblePartition(partition);
            if (appeared !== null) return publishRebasedV2(appeared);
            if (hasCommittedAuthority()) return publishRebasedV2(partition.normalize(null));
            throw new Error("v1 fallback source disappeared");
          }
          const currentLegacy = decodeLegacy(currentRawLegacy);
          const legacyMutation = mutate(partition.fromLegacy(currentLegacy));
          storage.setItem(
            legacyKey,
            JSON.stringify(partition.toLegacy(currentLegacy, legacyMutation.next)),
          );

          // Revalidate after fallback so a competing v2 transition cannot make
          // a successful result immediately invisible.
          const publishedConcurrently = readVisiblePartition(partition);
          if (publishedConcurrently !== null) return publishRebasedV2(publishedConcurrently);
          if (hasCommittedAuthority()) return publishRebasedV2(partition.normalize(null));
          return { ok: true, value: legacyMutation.value };
        };

        try {
          ensureMigrationProgress();
        } catch (markerError) {
          if (!state.legacyDocument) throw markerError;
          return publishLegacyFallback();
        }

        try {
          storage.setItem(partition.key, JSON.stringify(mutation.next));
        } catch (publicationError) {
          if (!state.legacyDocument) throw publicationError;
          return publishLegacyFallback();
        }

        recordPublishedPartition(partition.slot);
        return { ok: true, value: mutation.value };
      } catch (error) {
        return { ok: false, error };
      }
    },
  };
}

function decodeStoredPartition<T>(
  raw: string,
  accepts: (value: unknown) => boolean,
  normalize: (value: unknown) => T,
): DecodedPartition<T> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return { valid: accepts(parsed), record: normalize(parsed) };
  } catch {
    return { valid: false, record: normalize(null) };
  }
}

function isSupportedPartition(
  raw: string,
  accepts: (value: unknown) => boolean,
): boolean {
  try {
    return accepts(JSON.parse(raw));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
