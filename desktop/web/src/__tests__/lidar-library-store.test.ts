import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibrarySnapshot, LidarImportJob } from '../generated/contracts'
import { librarySnapshot, slopeItem, sourceItem } from './support/library-fixtures'

const listLibraryMock = vi.hoisted(() => vi.fn())

vi.mock('../ipc/lidar', () => ({ lidarListLibrary: listLibraryMock }))

import {
  ensureLidarPolling,
  hasActiveLibraryWork,
  installLidarLibraryObserver,
  lidarLibrary,
  lidarStatusMessage,
  readLidarPresentation,
  stopLidarPolling,
} from '../app/lidar/library-store'
import { locale } from '../app/settings/state'

const emptyLibrary: LibrarySnapshot = librarySnapshot([])

function importing(state: LidarImportJob['state']): LibrarySnapshot {
  return librarySnapshot([sourceItem('layer-1', 'Ground', {
    generation_id: state === 'Complete' ? 'generation-1' : null,
    state: state === 'Complete' ? 'Ready' : 'Preparing',
    import_job: { job_id: 'job-1', layer_id: 'layer-1', state, message: null, progress: null },
  })])
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

  it('treats a running analysis as active work, including a refresh of a published result', () => {
    const running = { job_id: 'j', state: 'Preparing' as const, message: null }
    expect(hasActiveLibraryWork(librarySnapshot([slopeItem('s', 'a', { generation_id: null, state: 'Preparing', run: running })]))).toBe(true)
    expect(hasActiveLibraryWork(librarySnapshot([slopeItem('s', 'a', { run: running })]))).toBe(true)
    expect(hasActiveLibraryWork(librarySnapshot([slopeItem('s', 'a')]))).toBe(false)
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
    expect(lidarLibrary.value?.items[0]?.generation_id).toBe('generation-1')
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
    expect(lidarLibrary.value?.items[0]?.import_job?.state).toBe('Complete')
  })

  it('reopening the dock refreshes at once', async () => {
    installLidarLibraryObserver()
    await flushMicrotasks()
    const before = listLibraryMock.mock.calls.length
    listLibraryMock.mockResolvedValue(importing('Complete'))

    installLidarLibraryObserver()
    await flushMicrotasks()
    expect(listLibraryMock.mock.calls.length).toBeGreaterThan(before)
    expect(lidarLibrary.value?.items).toHaveLength(1)
  })

  it('refuses a malformed snapshot as a failed read and stops polling', async () => {
    listLibraryMock.mockResolvedValue({ plant_db: 'missing' })
    ensureLidarPolling()
    await flushMicrotasks()
    await flushMicrotasks()
    expect(lidarLibrary.value).toBeNull()
    expect(lidarStatusMessage.value).toMatch(/malformed/i)
    const calls = listLibraryMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(listLibraryMock.mock.calls.length).toBe(calls)
  })
})

describe('LiDAR presentation join', () => {
  beforeEach(() => {
    locale.value = 'en'
  })

  it('joins Design entries with their items, typed and in their own units, back to front', () => {
    const library = librarySnapshot([
      sourceItem('ground', 'Ground', { display_range: { min: 100, max: 180, basis: 'Exact' } }),
      slopeItem('slope', 'ground', {
        units: '%',
        freshness: { state: 'Stale', reasons: [{ reason: 'InputUpdated', input_key: 'dem', item_id: 'ground' }] },
      }),
    ])
    const design = { lidar: { entries: [
      { kind: 'Analysis' as const, id: 'slope', visible: true, opacity: 0.5, order: 1, style: null },
      { kind: 'Source' as const, id: 'ground', visible: false, opacity: 1, order: 0, style: null },
      { kind: 'Analysis' as const, id: 'gone', visible: true, opacity: 1, order: 2, style: null },
    ] } }

    const [ground, slope, gone] = readLidarPresentation(design, library)
    expect(ground).toMatchObject({ kind: 'Source', role: 'Source', name: 'Ground', units: 'm', displayRange: [100, 180], definitionId: null })
    expect(slope).toMatchObject({
      kind: 'Analysis',
      role: 'Derived',
      name: 'Ground · Slope',
      itemType: { kind: 'Raster', quantity: 'Slope' },
      units: '%',
      definitionId: 'slope-def',
      freshness: { state: 'Stale' },
    })
    expect(gone).toMatchObject({ role: 'Derived', state: 'unavailable', itemType: null, name: 'gone' })
  })

  it('never joins an entry to an item of the other role', () => {
    const library = librarySnapshot([sourceItem('same', 'Ground')])
    const [entry] = readLidarPresentation(
      { lidar: { entries: [{ kind: 'Analysis', id: 'same', visible: true, opacity: 1, order: 0, style: null }] } },
      library,
    )
    expect(entry?.state).toBe('unavailable')
  })
})
