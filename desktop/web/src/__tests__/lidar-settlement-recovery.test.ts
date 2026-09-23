import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LidarImportJob, LidarLibrarySnapshot } from '../generated/contracts'

const listLibraryMock = vi.hoisted(() => vi.fn())
const getImportJobMock = vi.hoisted(() => vi.fn())
const upsertMock = vi.hoisted(() => vi.fn())

vi.mock('../ipc/lidar', () => ({
  lidarListLibrary: listLibraryMock,
  lidarGetImportJob: getImportJobMock,
  lidarCreateLayer: vi.fn(),
  lidarImportSources: vi.fn(),
  lidarCancelImport: vi.fn(),
  lidarCancelAnalysisJob: vi.fn(),
  lidarCreateAnalysis: vi.fn(),
  lidarRetryAnalysis: vi.fn(),
  lidarDeleteAnalysis: vi.fn(),
  lidarDeleteLayer: vi.fn(),
  lidarDeleteLayerImpact: vi.fn(),
  lidarRenameLayer: vi.fn(),
  lidarLayerHistory: vi.fn(),
  lidarLayerCollection: vi.fn(),
  lidarMoveLayerSource: vi.fn(),
  lidarRemoveLayerSource: vi.fn(),
  lidarRestoreLayerVersion: vi.fn(),
  lidarUndoLayerChange: vi.fn(),
}))

vi.mock('../app/design-edit/lidar', () => ({
  upsertLidarEntry: upsertMock,
  patchLidarEntryById: vi.fn(),
  removeLidarEntries: vi.fn(),
  moveLidarEntry: vi.fn(),
}))

vi.mock('../app/lidar/inspection', () => ({
  reconcileInspectionWithPresentation: vi.fn(),
}))

const identity = vi.hoisted(() => ({ value: { id: 'design-a' } as object }))
vi.mock('../app/document-session/store', () => ({
  designSessionStore: { sessionIdentity: identity },
}))

const { installLidarWorkflow, disposeLidarWorkflow } = await import('../app/lidar/workflow')
const {
  clearImportAttachmentIntents,
  openImportJob,
  peekImportAttachmentIntent,
  recordImportAttachmentIntent,
  stopLidarPolling,
  trackImportJob,
} = await import('../app/lidar/library-store')

function layer(id = 'lyr-1') {
  return {
    id,
    name: 'Ground',
    measurement_kind: 'GroundElevation' as const,
    units: 'm',
    state: 'Ready' as const,
    resolution_m: 0.5,
    coverage_cells: '1',
    bounds: null,
    value_range: null,
    analysis_count: 0,
    display_range: null,
    tilesets: [],
  }
}

function libraryWith(layerId: string | null): LidarLibrarySnapshot {
  return {
    layers: layerId ? [layer(layerId)] : [],
    analyses: [],
    engine: { available: true, version: null, detail: null },
  }
}

function job(state: LidarImportJob['state']): LidarImportJob {
  return { job_id: 'job-1', layer_id: 'lyr-1', state, message: null, progress: null }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('E2/E3 settlement through the real store and workflow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    disposeLidarWorkflow()
    stopLidarPolling()
    clearImportAttachmentIntents()
    upsertMock.mockReset()
    identity.value = { id: 'design-a' }
    openImportJob.value = null
    listLibraryMock.mockReset().mockResolvedValue(libraryWith(null))
    getImportJobMock.mockReset()
    installLidarWorkflow()
  })

  afterEach(() => {
    disposeLidarWorkflow()
    stopLidarPolling()
    vi.useRealTimers()
  })

  it('E2: failed read retains intent; later poll with unchanged Complete attaches once', async () => {
    // Healthy idle control first: library has no layer yet.
    await vi.advanceTimersByTimeAsync(1)
    await flush()
    expect(upsertMock).not.toHaveBeenCalled()

    recordImportAttachmentIntent('job-1', 'lyr-1', identity.value)
    // IPC reports Complete while library reads reject. Production records the
    // intent then tracks the job, which arms polling.
    getImportJobMock.mockResolvedValue(job('Complete'))
    listLibraryMock.mockRejectedValue(new Error('read refused'))
    await trackImportJob('job-1')
    await vi.advanceTimersByTimeAsync(1)
    await flush()

    // No attachment against a failed read; intent retained.
    expect(upsertMock).not.toHaveBeenCalled()
    expect(peekImportAttachmentIntent('job-1')).not.toBeNull()

    // Recovery: library reads succeed and contain the layer. Unchanged Complete.
    listLibraryMock.mockResolvedValue(libraryWith('lyr-1'))
    await vi.advanceTimersByTimeAsync(6_000)
    await flush()

    expect(upsertMock).toHaveBeenCalledTimes(1)
    expect(upsertMock).toHaveBeenCalledWith('Source', 'lyr-1')
    expect(peekImportAttachmentIntent('job-1')).toBeNull()
  })

  it('E2 healthy control: Complete plus successful read attaches once', async () => {
    recordImportAttachmentIntent('job-1', 'lyr-1', identity.value)
    getImportJobMock.mockResolvedValue(job('Complete'))
    listLibraryMock.mockResolvedValue(libraryWith('lyr-1'))
    await trackImportJob('job-1')
    await vi.advanceTimersByTimeAsync(1)
    await flush()

    expect(upsertMock).toHaveBeenCalledTimes(1)
    expect(upsertMock).toHaveBeenCalledWith('Source', 'lyr-1')
  })

  it('E3: two Complete observations start one settlement read and one attachment', async () => {
    // Let the idle poll's passive read finish first so only settlement reads
    // are gated below. Polling stays armed; recording intent must not force
    // another passive tick.
    await vi.advanceTimersByTimeAsync(1)
    await flush()
    listLibraryMock.mockReset()
    const gate: { releases: Array<(snapshot: LidarLibrarySnapshot) => void> } = { releases: [] }
    listLibraryMock.mockImplementation(
      () =>
        new Promise<LidarLibrarySnapshot>((resolve) => {
          gate.releases.push(resolve)
        }),
    )
    recordImportAttachmentIntent('job-1', 'lyr-1', identity.value)
    getImportJobMock.mockResolvedValue(job('Complete'))
    await trackImportJob('job-1')

    // First Complete observation starts the settlement read.
    openImportJob.value = job('Complete')
    await flush()
    const readsAfterFirst = gate.releases.length
    expect(readsAfterFirst).toBeGreaterThanOrEqual(1)

    // A second Complete observation before the read resolves must not start
    // another attempt for the same job.
    openImportJob.value = { ...job('Complete'), message: 'again' }
    await flush()
    expect(gate.releases.length).toBe(readsAfterFirst)

    for (const release of gate.releases) release(libraryWith('lyr-1'))
    await flush()
    await flush()
    expect(upsertMock).toHaveBeenCalledTimes(1)
    expect(upsertMock).toHaveBeenCalledWith('Source', 'lyr-1')
  })
})
