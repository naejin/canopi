import { signal } from '@preact/signals'
import type {
  LidarLibrarySnapshot,
  LidarImportJob,
  LidarPresentationEntryKind,
} from '../../generated/contracts'
import {
  lidarGetImportJob,
  lidarListLibrary,
  type LidarAnalysisSummary,
  type LidarLayerSummary,
  type LidarTileset,
} from '../../ipc/lidar'
import { currentDesign } from '../document-session/store'

export type { LidarAnalysisSummary, LidarLayerSummary, LidarTileset }

const LIDAR_POLL_INTERVAL_MS = 1500

/** Library-side snapshot; null until the first successful read. */
export const lidarLibrary = signal<LidarLibrarySnapshot | null>(null)

/**
 * The import job this session is tracking.
 *
 * A job is progress, not a decision: the one-step route has no review to return
 * to, so this exists for the progress, cancel and retry the Data surface shows.
 */
export const openImportJob = signal<LidarImportJob | null>(null)
export const lidarStatusMessage = signal<string | null>(null)

let pollTimer: ReturnType<typeof setInterval> | null = null
let refreshInFlight = false

export async function refreshLidarLibrary(): Promise<void> {
  if (refreshInFlight) {
    return
  }
  refreshInFlight = true
  try {
    const snapshot = await lidarListLibrary()
    lidarLibrary.value = snapshot
    lidarStatusMessage.value = null
  } catch (error) {
    // Passive library read failures leave the previous snapshot in place;
    // the rest of the app keeps working (Web Edition has no library at all).
    lidarStatusMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    refreshInFlight = false
  }
}

function hasActiveWork(snapshot: LidarLibrarySnapshot | null): boolean {
  if (!snapshot) {
    return false
  }
  return snapshot.analyses.some(
    (analysis) =>
      analysis.state === 'Preparing' ||
      analysis.state === 'Refreshing',
  )
}

function importIsActive(job: LidarImportJob | null): boolean {
  return job?.state === 'Staging' || job?.state === 'Applying'
}

export async function refreshOpenImportJob(): Promise<void> {
  const tracked = openImportJob.value
  if (tracked === null) return
  try {
    const next = await lidarGetImportJob(tracked.job_id)
    if (openImportJob.value?.job_id !== tracked.job_id) return
    openImportJob.value = next
  } catch (error) {
    lidarStatusMessage.value = error instanceof Error ? error.message : String(error)
  }
}

async function pollLidarState(): Promise<void> {
  await Promise.all([refreshLidarLibrary(), refreshOpenImportJob()])
  if (!hasActiveWork(lidarLibrary.value) && !importIsActive(openImportJob.value)) {
    stopLidarPolling()
  }
}

/**
 * Poll while analysis work is in flight so result states settle without any
 * user action; idle libraries stop polling to stay cheap.
 */
export function ensureLidarPolling(): void {
  void pollLidarState()
  if (pollTimer !== null) return
  pollTimer = setInterval(() => {
    void pollLidarState()
  }, LIDAR_POLL_INTERVAL_MS)
}

export async function trackImportJob(jobId: string): Promise<void> {
  const job = await lidarGetImportJob(jobId)
  openImportJob.value = job
  ensureLidarPolling()
}

export function stopLidarPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export function installLidarLibraryObserver(): () => void {
  void refreshLidarLibrary()
  return () => {
    stopLidarPolling()
  }
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
   * `null` for a source layer, whose unit is read from the library summary, and
   * for a definition written before the unit was recorded.
   */
  slopeUnit: LidarAnalysisSummary['slope_unit'] | null
  state: LidarAnalysisSummary['state'] | 'unavailable'
  visible: boolean
  opacity: number
  order: number
  bounds: [number, number, number, number] | null
  tilesets: LidarTileset[]
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
              tilesets: layer.tilesets,
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
              tilesets: [],
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
              name: analysisName(source?.name, analysis.kind),
              detail: analysis.kind,
              // The result's own unit, never the input layer's.
              slopeUnit: analysis.slope_unit ?? 'Degrees',
              state: analysis.state,
              visible: entry.visible,
              opacity: entry.opacity,
              order: entry.order,
              bounds: analysis.bounds ?? null,
              tilesets: analysis.tilesets,
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
              tilesets: [],
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
