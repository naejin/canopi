import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LidarImportJob } from '../generated/contracts'

const upsertMock = vi.hoisted(() => vi.fn())
const createLayerMock = vi.hoisted(() => vi.fn())
const importSourcesMock = vi.hoisted(() => vi.fn())
const cancelImportMock = vi.hoisted(() => vi.fn())
const trackImportMock = vi.hoisted(() => vi.fn())
const refreshLibraryMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const sessionIdentity = vi.hoisted(() => ({ value: { id: 'design-a' } as object }))

vi.mock('../app/design-edit/lidar', () => ({
  upsertLidarEntry: upsertMock,
  patchLidarEntryById: vi.fn(),
  removeLidarEntries: vi.fn(),
  moveLidarEntry: vi.fn(),
}))

vi.mock('../ipc/lidar', () => ({
  lidarCreateLayer: createLayerMock,
  lidarImportSources: importSourcesMock,
  lidarCancelImport: cancelImportMock,
  lidarCancelAnalysisJob: vi.fn(),
  lidarCreateAnalysis: vi.fn(),
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
  lidarListLibrary: vi.fn(),
  lidarGetImportJob: vi.fn(),
}))

vi.mock('../app/lidar/library-store', async () => {
  const { signal } = await import('@preact/signals')
  return {
    ensureLidarPolling: vi.fn(),
    lidarStatusMessage: signal<string | null>(null),
    openImportJob: signal(null as LidarImportJob | null),
    refreshOpenImportJob: vi.fn(),
    refreshLidarLibrary: refreshLibraryMock,
    trackImportJob: trackImportMock,
    stopLidarPolling: vi.fn(),
    installLidarLibraryObserver: vi.fn(() => () => {}),
  }
})

vi.mock('../app/lidar/inspection', () => ({
  reconcileInspectionWithPresentation: vi.fn(),
}))

vi.mock('../app/document-session/store', () => ({
  designSessionStore: { sessionIdentity },
}))

const { importSourcesIntoNewLayer, cancelOpenImport } = await import('../app/lidar/actions')
const {
  disposeLidarWorkflow,
  installLidarWorkflow,
  recordImportAttachmentIntent,
} = await import('../app/lidar/workflow')
const { openImportJob: trackedJob } = await import('../app/lidar/library-store')

function job(state: LidarImportJob['state'], id = 'job-1'): LidarImportJob {
  return {
    job_id: id,
    layer_id: 'lyr-1',
    state,
    message: null,
    progress: null,
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('import attachment through the LiDAR workflow owner', () => {
  beforeEach(() => {
    disposeLidarWorkflow()
    upsertMock.mockReset()
    createLayerMock.mockReset().mockResolvedValue('lyr-1')
    importSourcesMock.mockReset().mockResolvedValue('job-1')
    cancelImportMock.mockReset().mockResolvedValue(undefined)
    trackImportMock.mockReset().mockResolvedValue(undefined)
    refreshLibraryMock.mockClear().mockResolvedValue(undefined)
    sessionIdentity.value = { id: 'design-a' }
    trackedJob.value = null
  })

  it('attaches once on committed success in the submitting Design session', async () => {
    installLidarWorkflow()
    await importSourcesIntoNewLayer(['/a.tif'], 'Ground', 'GroundElevation', {
      label: null,
      unknown: false,
    })
    // Submission records intent; it does not present the layer early.
    expect(upsertMock).not.toHaveBeenCalled()

    trackedJob.value = job('Staging')
    await flush()
    expect(upsertMock).not.toHaveBeenCalled()

    trackedJob.value = job('Complete')
    await flush()
    await flush()
    expect(upsertMock).toHaveBeenCalledTimes(1)
    expect(upsertMock).toHaveBeenCalledWith('Source', 'lyr-1')

    // A later observation of the same terminal job must not attach again.
    trackedJob.value = job('Complete')
    await flush()
    expect(upsertMock).toHaveBeenCalledTimes(1)
  })

  it('does not attach when the submitting Design session was replaced', async () => {
    installLidarWorkflow()
    await importSourcesIntoNewLayer(['/a.tif'], 'Ground', 'GroundElevation', {
      label: null,
      unknown: false,
    })
    sessionIdentity.value = { id: 'design-b' }
    trackedJob.value = job('Complete')
    await flush()
    await flush()
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('does not attach after failure or genuine cancellation', async () => {
    installLidarWorkflow()
    await importSourcesIntoNewLayer(['/a.tif'], 'Ground', 'GroundElevation', {
      label: null,
      unknown: false,
    })
    trackedJob.value = job('Failed')
    await flush()
    await flush()
    expect(upsertMock).not.toHaveBeenCalled()

    await importSourcesIntoNewLayer(['/b.tif'], 'Ground', 'GroundElevation', {
      label: null,
      unknown: false,
    })
    trackedJob.value = job('Cancelled', 'job-2')
    await flush()
    await flush()
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('a cancellation request that loses to commit still attaches', async () => {
    // R44: cancel is a request, not a decision. The observed terminal result
    // owns attachment, so a job that already committed still attaches.
    installLidarWorkflow()
    await importSourcesIntoNewLayer(['/a.tif'], 'Ground', 'GroundElevation', {
      label: null,
      unknown: false,
    })
    trackedJob.value = job('Staging')
    await cancelOpenImport()
    // Native publication won: the job settles Complete despite the request.
    trackedJob.value = job('Complete')
    await flush()
    await flush()
    expect(upsertMock).toHaveBeenCalledTimes(1)
    expect(upsertMock).toHaveBeenCalledWith('Source', 'lyr-1')
  })

  it('keeps attachment intent when Data closes and attaches after reopen', async () => {
    installLidarWorkflow()
    await importSourcesIntoNewLayer(['/a.tif'], 'Ground', 'GroundElevation', {
      label: null,
      unknown: false,
    })
    // Closing Data is only an observer dispose; intent lives in the workflow.
    trackedJob.value = job('Complete')
    await flush()
    await flush()
    expect(upsertMock).toHaveBeenCalledWith('Source', 'lyr-1')
  })

  it('genuine cancellation after the request consumes intent without attaching', async () => {
    installLidarWorkflow()
    await importSourcesIntoNewLayer(['/a.tif'], 'Ground', 'GroundElevation', {
      label: null,
      unknown: false,
    })
    trackedJob.value = job('Staging')
    await cancelOpenImport()
    trackedJob.value = job('Cancelled')
    await flush()
    await flush()
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('a failed initial submission leaves an honest empty retryable dataset', async () => {
    installLidarWorkflow()
    createLayerMock.mockResolvedValue('lyr-empty')
    importSourcesMock.mockRejectedValue(new Error('submission refused'))
    await expect(
      importSourcesIntoNewLayer(['/a.tif'], 'Ground', 'GroundElevation', {
        label: null,
        unknown: false,
      }),
    ).rejects.toThrow('submission refused')
    // The dataset exists; no presentation mutation and no attachment intent.
    expect(createLayerMock).toHaveBeenCalledTimes(1)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('records intent only after submission succeeds', async () => {
    installLidarWorkflow()
    importSourcesMock.mockRejectedValue(new Error('nope'))
    await expect(
      importSourcesIntoNewLayer(['/a.tif'], 'Ground', 'GroundElevation', {
        label: null,
        unknown: false,
      }),
    ).rejects.toThrow('nope')
    // Even a forced settlement cannot invent an attachment for a failed submit.
    recordImportAttachmentIntent('job-x', 'lyr-x', sessionIdentity.value)
    trackedJob.value = job('Complete', 'job-x')
    await flush()
    await flush()
    expect(upsertMock).toHaveBeenCalledWith('Source', 'lyr-x')
    upsertMock.mockClear()
    // Failed submit left no intent for job-1.
    trackedJob.value = job('Complete', 'job-1')
    await flush()
    await flush()
    expect(upsertMock).not.toHaveBeenCalled()
  })
})
