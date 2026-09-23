import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LidarImportJob, LidarLibrarySnapshot } from '../generated/contracts'

const listLibraryMock = vi.hoisted(() => vi.fn())
const getImportJobMock = vi.hoisted(() => vi.fn())

vi.mock('../ipc/lidar', () => ({
  lidarListLibrary: listLibraryMock,
  lidarGetImportJob: getImportJobMock,
}))

import {
  ensureLidarPolling,
  installLidarLibraryObserver,
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
    stopLidarPolling()
  })

  afterEach(() => {
    stopLidarPolling()
    openImportJob.value = null
    vi.useRealTimers()
  })

  it('tracks a running import and stops polling once it settles', async () => {
    // The one-step route settles at complete; there is no review state to wait
    // for, so polling must stop when the job is no longer working.
    getImportJobMock
      .mockResolvedValueOnce(importJob('Staging'))
      .mockResolvedValueOnce(importJob('Complete'))

    await trackImportJob('job-1')
    await flushMicrotasks()

    expect(openImportJob.value?.state).toBe('Complete')
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

  it('panel unmount does not stop an active import from settling', async () => {
    // R33: Data/Analysis/Layers subscribe; they must not own the shared timer.
    getImportJobMock.mockResolvedValue(importJob('Staging'))
    const disposeData = installLidarLibraryObserver()
    await trackImportJob('job-1')
    await flushMicrotasks()

    // Closing Data must leave the tracked job polling.
    disposeData()
    getImportJobMock.mockResolvedValue(importJob('Complete'))
    await vi.advanceTimersByTimeAsync(1_500)
    await flushMicrotasks()

    expect(openImportJob.value?.state).toBe('Complete')
  })

  it('reopening a panel refreshes immediately and observes current progress', async () => {
    getImportJobMock.mockResolvedValue(importJob('Staging'))
    await trackImportJob('job-1')
    await flushMicrotasks()
    const before = listLibraryMock.mock.calls.length

    // Reopen Data: the observer refreshes at once rather than waiting a tick.
    listLibraryMock.mockResolvedValue({
      ...emptyLibrary,
      layers: [{
        id: 'layer-1',
        name: 'Ground',
        measurement_kind: 'GroundElevation',
        units: 'm',
        state: 'Ready',
        resolution_m: 0.5,
        coverage_cells: '10',
        bounds: [0, 0, 1, 1],
        value_range: null,
        analysis_count: 0,
        tilesets: [],
      }],
    })
    installLidarLibraryObserver()
    await flushMicrotasks()
    expect(listLibraryMock.mock.calls.length).toBeGreaterThan(before)
    expect(lidarLibrary.value?.layers).toHaveLength(1)
  })
})
