import { signal } from '@preact/signals'
import type {
  AnalysisRunStatus,
  Freshness,
  LibraryItemRole,
  LibraryItemSummary,
  LibraryItemType,
  LibrarySnapshot,
  LidarPresentationEntryKind,
  LidarResultState,
} from '../../generated/contracts'
import { lidarListLibrary } from '../../ipc/lidar'
import { derivedItemName } from '../analyses/registry'
import { currentDesign } from '../document-session/store'

const LIDAR_POLL_INTERVAL_MS = 1500

/** Library-side snapshot; null until the first successful read. */
export const lidarLibrary = signal<LibrarySnapshot | null>(null)
export const lidarStatusMessage = signal<string | null>(null)

let pollTimer: ReturnType<typeof setInterval> | null = null
let refreshInFlight: Promise<void> | null = null
/**
 * Monotonic read-start sequence: an older passive response cannot overwrite a
 * snapshot from a read that started later.
 */
let readStartSequence = 0
let publishedReadSequence = 0

/** A snapshot without its item list is refused as a failed read, never published. */
function assertLibrarySnapshot(value: unknown): asserts value is LibrarySnapshot {
  const snapshot = value as Partial<LibrarySnapshot> | null
  if (!snapshot || !Array.isArray(snapshot.items)) {
    throw new Error('The LiDAR library returned a malformed snapshot.')
  }
}

async function readLibrarySnapshot(startSequence: number): Promise<LibrarySnapshot> {
  const snapshot: unknown = await lidarListLibrary()
  assertLibrarySnapshot(snapshot)
  if (startSequence >= publishedReadSequence) {
    publishedReadSequence = startSequence
    lidarLibrary.value = snapshot
    lidarStatusMessage.value = null
  }
  return snapshot
}

/**
 * Refresh the library snapshot. Overlapping callers coalesce onto the read in
 * flight; a failed read keeps the previous snapshot (Web has no library).
 */
export async function refreshLidarLibrary(): Promise<void> {
  if (refreshInFlight) {
    return refreshInFlight
  }
  readStartSequence += 1
  const startSequence = readStartSequence
  refreshInFlight = (async () => {
    try {
      await readLibrarySnapshot(startSequence)
    } catch (error) {
      lidarStatusMessage.value = error instanceof Error ? error.message : String(error)
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

/**
 * Whether any library operation is still running: an import, or an analysis
 * run (a first calculation or a refresh of a published result).
 */
export function hasActiveLibraryWork(snapshot: LibrarySnapshot | null): boolean {
  if (!snapshot) return false
  return snapshot.items.some((item) =>
    item.import_job?.state === 'Staging'
    || item.import_job?.state === 'Applying'
    || item.run?.state === 'Preparing')
}

async function pollLidarState(): Promise<void> {
  await refreshLidarLibrary()
  if (!hasActiveLibraryWork(lidarLibrary.value)) stopLidarPolling()
}

/**
 * Poll while library work runs so operations settle without any user action;
 * an idle library stops polling. Work belongs to the library, not a panel or
 * a Design: closing the dock or switching Designs never stops it.
 */
export function ensureLidarPolling(): void {
  if (pollTimer !== null) return
  void pollLidarState()
  pollTimer = setInterval(() => {
    void pollLidarState()
  }, LIDAR_POLL_INTERVAL_MS)
}

export function stopLidarPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/**
 * Subscribe a surface to the shared library snapshot: refresh on mount and
 * keep polling while work runs. Unmounting never stops library work.
 */
export function installLidarLibraryObserver(): () => void {
  void refreshLidarLibrary()
  ensureLidarPolling()
  return () => {}
}

export interface LidarPresentationItem {
  /** The Design entry kind; the file format keeps `Analysis` for derived items. */
  kind: LidarPresentationEntryKind
  role: LibraryItemRole
  id: string
  name: string
  /** `null` for a reference whose library item is gone. */
  itemType: LibraryItemType | null
  /** The item's own stored units, never an input's. */
  units: string
  state: LidarResultState | 'unavailable'
  visible: boolean
  opacity: number
  order: number
  bounds: [number, number, number, number] | null
  /** Current immutable generation; display and inspection aim at it. */
  generationId: string | null
  /** Stretch domain in the stored units, when known. */
  displayRange: [number, number] | null
  freshness: Freshness
  /** The definition a derived item belongs to, for Refresh. */
  definitionId: string | null
  /** The latest run of a derived item, for Refresh progress. */
  run: AnalysisRunStatus | null
}

/** The library role a Design entry names. */
export function itemRole(kind: LidarPresentationEntryKind): LibraryItemRole {
  return kind === 'Analysis' ? 'Derived' : 'Source'
}

/** The Design entry kind that references an item of this role. */
export function presentationEntryKind(role: LibraryItemRole): LidarPresentationEntryKind {
  return role === 'Derived' ? 'Analysis' : 'Source'
}

/** The range styling and legends use: the labelled display range, else the exact values. */
export function itemDisplayRange(item: LibraryItemSummary): [number, number] | null {
  return item.display_range ? [item.display_range.min, item.display_range.max] : item.value_range ?? null
}

/** An item's name; an unnamed derived item is named by its first input and analysis. */
export function libraryItemName(item: LibraryItemSummary, library: LibrarySnapshot | null): string {
  if (item.name) return item.name
  const provenance = item.provenance
  if (!provenance) return item.id
  const inputId = provenance.inputs[0]?.item_id
  const input = inputId ? library?.items.find((candidate) => candidate.id === inputId) : undefined
  return derivedItemName(input?.name, provenance.analysis_id)
}

/**
 * Join library identity/status with document presentation entries, ordered
 * back to front. Unavailable references persist and are flagged instead of
 * dropped, per the plan.
 */
export function readLidarPresentation(
  design: {
    lidar?: { entries: LidarPresentationDocEntry[] } | null
  } | null,
  library: LibrarySnapshot | null,
): LidarPresentationItem[] {
  const entries = design?.lidar?.entries ?? []
  const items: LidarPresentationItem[] = []
  for (const entry of entries) {
    const role = itemRole(entry.kind)
    const item = library?.items.find((candidate) => candidate.id === entry.id && candidate.role === role)
    const presentation = { kind: entry.kind, role, id: entry.id, visible: entry.visible, opacity: entry.opacity, order: entry.order }
    items.push(item
      ? {
          ...presentation,
          name: libraryItemName(item, library),
          itemType: item.item_type,
          units: item.units,
          state: item.state,
          bounds: item.bounds ?? null,
          generationId: item.generation_id ?? null,
          displayRange: itemDisplayRange(item),
          freshness: item.freshness,
          definitionId: item.provenance?.definition_id ?? null,
          run: item.run,
        }
      : {
          ...presentation,
          name: entry.id,
          itemType: null,
          units: '',
          state: 'unavailable',
          bounds: null,
          generationId: null,
          displayRange: null,
          freshness: { state: 'Current' },
          definitionId: null,
          run: null,
        })
  }
  return items.sort((a, b) => a.order - b.order)
}

interface LidarPresentationDocEntry {
  kind: LidarPresentationEntryKind
  id: string
  visible: boolean
  opacity: number
  order: number
  style: string | null
}

/**
 * Presentation join for the current Design and the latest library snapshot;
 * this seam owns the design read so map snapshot code never bypasses it.
 */
export function readCurrentLidarPresentation(): LidarPresentationItem[] {
  return readLidarPresentation(currentDesign.value, lidarLibrary.value)
}
