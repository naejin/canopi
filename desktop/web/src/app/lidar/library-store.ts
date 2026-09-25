import { signal } from '@preact/signals'
import type {
  LidarLibrarySnapshot,
  LidarPresentationEntryKind,
} from '../../generated/contracts'
import {
  lidarListLibrary,
  type LidarAnalysisSummary,
  type LidarLayerSummary,
} from '../../ipc/lidar'
import { currentDesign } from '../document-session/store'

export type { LidarAnalysisSummary, LidarLayerSummary }

const LIDAR_POLL_INTERVAL_MS = 1500

/** Library-side snapshot; null until the first successful read. */
export const lidarLibrary = signal<LidarLibrarySnapshot | null>(null)
export const lidarStatusMessage = signal<string | null>(null)

let pollTimer: ReturnType<typeof setInterval> | null = null
let refreshInFlight: Promise<void> | null = null
/**
 * Monotonic read-start sequence: an older passive response cannot overwrite a
 * snapshot from a read that started later.
 */
let readStartSequence = 0
let publishedReadSequence = 0

/** A snapshot without its lists is refused as a failed read, never published. */
function assertLibrarySnapshot(value: unknown): asserts value is LidarLibrarySnapshot {
  const snapshot = value as Partial<LidarLibrarySnapshot> | null
  if (!snapshot || !Array.isArray(snapshot.layers) || !Array.isArray(snapshot.analyses)) {
    throw new Error('The LiDAR library returned a malformed snapshot.')
  }
}

async function readLibrarySnapshot(startSequence: number): Promise<LidarLibrarySnapshot> {
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

/** Whether any library operation is still running: imports or calculations. */
export function hasActiveLibraryWork(snapshot: LidarLibrarySnapshot | null): boolean {
  if (!snapshot) return false
  return snapshot.layers.some((layer) =>
    layer.import_job?.state === 'Staging' || layer.import_job?.state === 'Applying')
    || snapshot.analyses.some((analysis) =>
      analysis.state === 'Preparing')
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
  kind: LidarPresentationEntryKind
  id: string
  name: string
  /** Measurement kind for source layers, analysis kind for results. */
  detail: string
  /**
   * The unit a result was computed in.
   *
   * `null` for a source layer, whose unit is read from the library summary.
   */
  slopeUnit: LidarAnalysisSummary['slope_unit'] | null
  state: LidarAnalysisSummary['state'] | 'unavailable'
  visible: boolean
  opacity: number
  order: number
  bounds: [number, number, number, number] | null
  /** Current immutable generation; display and inspection aim at it. */
  generationId: string | null
  /** Stretch domain in the stored units, when known. */
  displayRange: [number, number] | null
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
  library: LidarLibrarySnapshot | null,
): LidarPresentationItem[] {
  const entries = design?.lidar?.entries ?? []
  const items: LidarPresentationItem[] = []
  for (const entry of entries) {
    if (entry.kind === 'Source') {
      const layer = library?.layers.find((candidate) => candidate.id === entry.id)
      items.push(
        layer
          ? {
              kind: entry.kind,
              id: entry.id,
              name: layer.name,
              detail: layer.measurement_kind,
              slopeUnit: null,
              state: layer.state,
              visible: entry.visible,
              opacity: entry.opacity,
              order: entry.order,
              bounds: layer.bounds ?? null,
              generationId: layer.generation_id ?? null,
              displayRange: layer.display_range
                ? [layer.display_range.min, layer.display_range.max]
                : layer.value_range ?? null,
            }
          : {
              kind: entry.kind,
              id: entry.id,
              name: entry.id,
              detail: 'unavailable',
              slopeUnit: null,
              state: 'unavailable',
              visible: entry.visible,
              opacity: entry.opacity,
              order: entry.order,
              bounds: null,
              generationId: null,
              displayRange: null,
            },
      )
    } else {
      const analysis = library?.analyses.find((candidate) => candidate.id === entry.id)
      const source = analysis
        ? library?.layers.find((candidate) => candidate.id === analysis.source_layer_id)
        : undefined
      items.push(
        analysis
          ? {
              kind: entry.kind,
              id: analysis.id,
              name: analysis.name ?? analysisName(source?.name, analysis.kind),
              detail: analysis.kind,
              // The result's own unit, never the input layer's.
              slopeUnit: analysis.slope_unit,
              state: analysis.state,
              visible: entry.visible,
              opacity: entry.opacity,
              order: entry.order,
              bounds: analysis.bounds ?? null,
              generationId: analysis.generation_id ?? null,
              displayRange: analysis.value_range ?? null,
            }
          : {
              kind: entry.kind,
              id: entry.id,
              name: entry.id,
              detail: 'unavailable',
              slopeUnit: null,
              state: 'unavailable',
              visible: entry.visible,
              opacity: entry.opacity,
              order: entry.order,
              bounds: null,
              generationId: null,
              displayRange: null,
            },
      )
    }
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

export function analysisName(
  sourceLayerName: string | undefined,
  kind: LidarAnalysisSummary['kind'],
): string {
  if (!sourceLayerName) {
    return kind
  }
  return `${sourceLayerName} · ${kind}`
}

/** Slice 1 ships one style per entity kind; restyling lands with legends. */
export function styleForKind(kind: LidarPresentationEntryKind): string {
  return kind === 'Analysis' ? 'slope' : 'elevation'
}

/**
 * Presentation join for the current Design and the latest library snapshot;
 * this seam owns the design read so map snapshot code never bypasses it.
 */
export function readCurrentLidarPresentation(): LidarPresentationItem[] {
  return readLidarPresentation(currentDesign.value, lidarLibrary.value)
}
