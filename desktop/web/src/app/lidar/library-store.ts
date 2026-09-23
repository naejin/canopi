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
let refreshInFlight: Promise<void> | null = null
/**
 * Monotonic read-start sequence.
 *
 * A queued fresh read may serve multiple callers only if it starts after all
 * their fences. Settlement records the sequence at terminal observation and
 * must not join a read already started at that point.
 */
let readStartSequence = 0
let publishedReadSequence = 0
let freshRefreshInFlight: Promise<LidarLibrarySnapshot> | null = null
let freshRefreshStartSequence = 0

async function readLibrarySnapshot(startSequence: number): Promise<LidarLibrarySnapshot> {
  const snapshot = await lidarListLibrary()
  // Publish in read-start order: an older passive response cannot overwrite
  // newer state.
  if (startSequence >= publishedReadSequence) {
    publishedReadSequence = startSequence
    lidarLibrary.value = snapshot
    lidarStatusMessage.value = null
  }
  return snapshot
}

/**
 * Refresh the library snapshot.
 *
 * Passive overlapping callers coalesce onto the in-flight read. Settlement
 * must not use this entry: waiting for an earlier read does not make its
 * snapshot fresh.
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
      // Passive library read failures leave the previous snapshot in place;
      // the rest of the app keeps working (Web Edition has no library at all).
      lidarStatusMessage.value = error instanceof Error ? error.message : String(error)
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

/**
 * Start a library read that begins after `afterSequence`.
 *
 * Settlement uses this entry so attachment never consumes a snapshot that
 * predates the terminal observation. One shared follow-up read may satisfy
 * multiple callers only when it starts after all their fences. A fresh read
 * does not join an earlier passive read that was already under way.
 */
export async function refreshLidarLibraryFresh(
  afterSequence: number = readStartSequence,
): Promise<LidarLibrarySnapshot> {
  if (
    freshRefreshInFlight &&
    freshRefreshStartSequence > afterSequence
  ) {
    return freshRefreshInFlight
  }
  readStartSequence += 1
  const startSequence = readStartSequence
  freshRefreshStartSequence = startSequence
  let inflight!: Promise<LidarLibrarySnapshot>
  inflight = (async () => {
    try {
      return await readLibrarySnapshot(startSequence)
    } catch (error) {
      lidarStatusMessage.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      if (freshRefreshInFlight === inflight) {
        freshRefreshInFlight = null
      }
    }
  })()
  freshRefreshInFlight = inflight
  return inflight
}

/** The current read-start sequence, used as a settlement fence. */
export function libraryReadSequence(): number {
  return readStartSequence
}

export interface ImportAttachmentIntent {
  readonly jobId: string
  readonly layerId: string
  readonly designIdentity: object
  consumed: boolean
}

const attachmentIntents = new Map<string, ImportAttachmentIntent>()

/**
 * Record that a successful import submission should attach its layer when the
 * job commits, but only in the Design session that submitted it.
 */
export function recordImportAttachmentIntent(
  jobId: string,
  layerId: string,
  designIdentity: object,
): void {
  attachmentIntents.set(jobId, {
    jobId,
    layerId,
    designIdentity,
    consumed: false,
  })
}

/** Drop a pending attachment without presenting anything. */
export function discardImportAttachmentIntent(jobId: string): void {
  attachmentIntents.delete(jobId)
}

/** The unconsumed attachment intent for one job, if any. */
export function peekImportAttachmentIntent(jobId: string): ImportAttachmentIntent | null {
  return attachmentIntents.get(jobId) ?? null
}

/** Consume the intent for one job, returning it if it was still pending. */
export function consumeImportAttachmentIntent(jobId: string): ImportAttachmentIntent | null {
  const intent = attachmentIntents.get(jobId)
  if (!intent || intent.consumed) return null
  intent.consumed = true
  attachmentIntents.delete(jobId)
  return intent
}

export function clearImportAttachmentIntents(): void {
  attachmentIntents.clear()
}

function hasActiveWork(snapshot: LidarLibrarySnapshot | null): boolean {
  if (!snapshot) {
    return false
  }
  return (snapshot.analyses ?? []).some(
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

/**
 * One polled tick: job and library refresh together so a terminal job and the
 * library head it published are observed as a pair. A second library read after
 * a terminal job closes the window where the job settled but the head is stale.
 */
async function pollLidarState(): Promise<void> {
  await Promise.all([refreshLidarLibrary(), refreshOpenImportJob()])
  const job = openImportJob.value
  if (
    job !== null &&
    (job.state === 'Complete' || job.state === 'Cancelled' || job.state === 'Failed')
  ) {
    await refreshLidarLibrary()
  }
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

/**
 * Subscribe a surface to the shared library snapshot.
 *
 * Panel navigation must not stop active-job settlement: the Desktop-lifetime
 * workflow owner owns the timer, and this observer only refreshes immediately
 * on mount so reopening Data/Analysis/Layers shows current progress at once.
 */
export function installLidarLibraryObserver(): () => void {
  void refreshLidarLibrary()
  ensureLidarPolling()
  return () => {
    // Intentionally does not stop polling. Native jobs remain library-owned
    // even after a panel unmounts; idle polling stops on its own when nothing
    // needs settlement.
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
