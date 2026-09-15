import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LidarImportJob, LidarLibrarySnapshot } from '../generated/contracts'

const listLibraryMock = vi.hoisted(() => vi.fn())
const getImportJobMock = vi.hoisted(() => vi.fn())

vi.mock('../ipc/lidar', () => ({
  lidarListLibrary: listLibraryMock,
  lidarGetImportJob: getImportJobMock,
}))

import {
  dismissTrackedImport,
  ensureLidarPolling,
  importPanelOpen,
  lidarLibrary,
  openImportJob,
  stopLidarPolling,
  trackImportJob,
} from '../app/lidar/library-store'

const emptyLibrary: LidarLibrarySnapshot = {
  layers: [],
  analyses: [],
  engine: { available: true, version: '3.8.4', detail: null },
}

function importJob(state: LidarImportJob['state']): LidarImportJob {
  return {
    job_id: 'job-1',
    layer_id: 'layer-1',
    state,
    review: null,
    message: null,
    progress: null,
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('LiDAR library polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    listLibraryMock.mockReset().mockResolvedValue(emptyLibrary)
    getImportJobMock.mockReset()
    lidarLibrary.value = null
    openImportJob.value = null
    importPanelOpen.value = false
    stopLidarPolling()
  })

  afterEach(() => {
    stopLidarPolling()
    dismissTrackedImport()
    vi.useRealTimers()
  })

  it('keeps a staged import visible and stops polling when review is ready', async () => {
    getImportJobMock
      .mockResolvedValueOnce(importJob('Staging'))
      .mockResolvedValueOnce({ ...importJob('AwaitingReview'), review: {
        job_id: 'job-1',
        layer_id: 'layer-1',
        sources: [],
        uncovered_cells: '0',
        overlap_cells: '0',
        invalid_cells: '0',
        compatible: true,
        issues: [],
        before_preview_path: null,
        after_preview_path: null,
      } })

    await trackImportJob('job-1')
    await flushMicrotasks()

    expect(openImportJob.value?.state).toBe('AwaitingReview')
    expect(importPanelOpen.value).toBe(true)
    expect(getImportJobMock).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(getImportJobMock).toHaveBeenCalledTimes(2)
  })

  it('does not poll failed or incomplete analysis states forever', async () => {
    listLibraryMock.mockResolvedValue({
      ...emptyLibrary,
      analyses: [{
        id: 'analysis-1',
        source_layer_id: 'layer-1',
        kind: 'Slope',
        state: 'Failed',
        detail: 'generation failed',
        bounds: null,
        value_range: null,
        tilesets: [],
      }],
    })

    ensureLidarPolling()
    await flushMicrotasks()
    const settledCalls = listLibraryMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(5_000)

    expect(settledCalls).toBe(1)
    expect(listLibraryMock).toHaveBeenCalledTimes(settledCalls)
  })
})
