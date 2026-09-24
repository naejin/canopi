import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LidarImportJob, LidarLayerSummary, LidarLibrarySnapshot } from '../generated/contracts'

const listLibraryMock = vi.hoisted(() => vi.fn())

vi.mock('../ipc/lidar', () => ({ lidarListLibrary: listLibraryMock }))

import {
  ensureLidarPolling,
  hasActiveLibraryWork,
  installLidarLibraryObserver,
  lidarLibrary,
  stopLidarPolling,
} from '../app/lidar/library-store'

const emptyLibrary: LidarLibrarySnapshot = {
  layers: [],
  analyses: [],
  engine: { available: true, version: '3.8.4', detail: null },
}

function importing(state: LidarImportJob['state']): LidarLibrarySnapshot {
  const layer: LidarLayerSummary = {
    id: 'layer-1',
    generation_id: state === 'Complete' ? 'generation-1' : null,
    name: 'Ground',
    measurement_kind: 'GroundElevation',
    units: 'm',
    state: state === 'Complete' ? 'Ready' : 'Preparing',
    resolution_m: 0.5,
    coverage_cells: null,
    bounds: null,
    value_range: null,
    display_range: null,
    analysis_count: 0,
    import_job: { job_id: 'job-1', layer_id: 'layer-1', state, message: null, progress: null },
  }
  return { ...emptyLibrary, layers: [layer] }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('LiDAR library polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    listLibraryMock.mockReset().mockResolvedValue(emptyLibrary)
    lidarLibrary.value = null
    stopLidarPolling()
  })

  afterEach(() => {
    stopLidarPolling()
    vi.useRealTimers()
  })

  it('treats running imports and calculations as active work, settled ones as idle', () => {
    expect(hasActiveLibraryWork(importing('Staging'))).toBe(true)
    expect(hasActiveLibraryWork(importing('Applying'))).toBe(true)
    expect(hasActiveLibraryWork(importing('Failed'))).toBe(false)
    expect(hasActiveLibraryWork(importing('Complete'))).toBe(false)
    expect(hasActiveLibraryWork(null)).toBe(false)
  })

  it('polls a running import until it settles, then stops', async () => {
    listLibraryMock.mockResolvedValue(importing('Staging'))
    ensureLidarPolling()
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(1_500)
    const running = listLibraryMock.mock.calls.length
    expect(running).toBeGreaterThanOrEqual(2)

    listLibraryMock.mockResolvedValue(importing('Complete'))
    await vi.advanceTimersByTimeAsync(1_500)
    const settled = listLibraryMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(6_000)

    expect(listLibraryMock).toHaveBeenCalledTimes(settled)
    expect(lidarLibrary.value?.layers[0]?.generation_id).toBe('generation-1')
  })

  it('does not poll a failed import forever', async () => {
    listLibraryMock.mockResolvedValue(importing('Failed'))
    ensureLidarPolling()
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(6_000)
    expect(listLibraryMock.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('closing the dock does not stop an import from settling', async () => {
    listLibraryMock.mockResolvedValue(importing('Staging'))
    const dispose = installLidarLibraryObserver()
    await flushMicrotasks()
    dispose()

    listLibraryMock.mockResolvedValue(importing('Complete'))
    await vi.advanceTimersByTimeAsync(1_500)
    await flushMicrotasks()
    expect(lidarLibrary.value?.layers[0]?.import_job?.state).toBe('Complete')
  })

  it('reopening the dock refreshes at once', async () => {
    installLidarLibraryObserver()
    await flushMicrotasks()
    const before = listLibraryMock.mock.calls.length
    listLibraryMock.mockResolvedValue(importing('Complete'))

    installLidarLibraryObserver()
    await flushMicrotasks()
    expect(listLibraryMock.mock.calls.length).toBeGreaterThan(before)
    expect(lidarLibrary.value?.layers).toHaveLength(1)
  })
})
