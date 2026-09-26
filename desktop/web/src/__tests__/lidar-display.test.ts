import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LidarDisplayDescriptor } from '../ipc/lidar'
import type { LidarPresentationItem } from '../app/lidar/library-store'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

const display = await import('../app/lidar/display')

function item(overrides: Partial<LidarPresentationItem> = {}): LidarPresentationItem {
  return {
    kind: 'Source',
    role: 'Source',
    id: 'lyr-1',
    name: 'Orchard terrain',
    itemType: { kind: 'Raster', quantity: 'GroundElevation' },
    units: 'm',
    state: 'Ready',
    visible: true,
    opacity: 0.8,
    order: 0,
    bounds: [0, 0, 1, 1],
    generationId: 'gen-2',
    displayRange: [104, 132],
    freshness: { state: 'Current' },
    definitionId: null,
    run: null,
    ...overrides,
  }
}

function descriptor(overrides: Partial<LidarDisplayDescriptor> = {}): LidarDisplayDescriptor {
  return {
    kind: 'Source',
    entity_id: 'lyr-1',
    generation_id: 'gen-2',
    profile: 'display-cog-deflate256-v1',
    state: 'Ready',
    message: null,
    assets: [
      { path: '/data/lidar/display-cog/asset-top.tif', bounds: [0, 0, 0.6, 1] },
      { path: '/data/lidar/display-cog/asset under.tif', bounds: [0.4, -0.1, 1, 1] },
    ],
    prepared_assets: 2,
    total_assets: 2,
    ...overrides,
  }
}

describe('LiDAR display projection', () => {
  it('draws a ready generation from its ordered asset URLs with one layer-wide stretch', () => {
    const descriptors = new Map([[display.displayKey('Source', 'lyr-1', 'gen-2'), descriptor()]])
    const [layer] = display.lidarDisplayLayers([item()], descriptors, (path) => `asset://localhost/${encodeURIComponent(path)}`)
    expect(layer).toEqual({
      id: 'lidar-source-lyr-1-gen-2',
      name: 'Orchard terrain',
      assets: [
        { url: 'asset://localhost/%2Fdata%2Flidar%2Fdisplay-cog%2Fasset-top.tif', bbox: [0, 0, 0.6, 1] },
        { url: 'asset://localhost/%2Fdata%2Flidar%2Fdisplay-cog%2Fasset%20under.tif', bbox: [0.4, -0.1, 1, 1] },
      ],
      bounds: [0, -0.1, 1, 1],
      opacity: 0.8,
      rescale: [104, 132],
      colormap: 'terrain',
      reversed: false,
    })
  })

  it('draws nothing for hidden, unavailable, preparing or other-generation references', () => {
    const ready = descriptor()
    const descriptors = new Map([
      [display.displayKey('Source', 'lyr-1', 'gen-2'), ready],
      [display.displayKey('Source', 'lyr-3', 'gen-9'), descriptor({ entity_id: 'lyr-3', generation_id: 'gen-9', state: 'Preparing' })],
    ])
    expect(display.lidarDisplayLayers([
      item({ visible: false }),
      item({ id: 'lyr-2', state: 'unavailable' }),
      item({ id: 'lyr-3', generationId: 'gen-9' }),
      item({ generationId: 'gen-3' }),
    ], descriptors)).toEqual([])
  })

  it('styles each reference by its item type and its own units', () => {
    const slope = { kind: 'Analysis' as const, role: 'Derived' as const, itemType: { kind: 'Raster' as const, quantity: 'Slope' as const } }
    expect(display.lidarDisplayStyle(item({ ...slope, units: '%' })))
      .toMatchObject({ colormap: 'magma', reversed: true, rescale: [0, 173.2], units: '%' })
    expect(display.lidarDisplayStyle(item({ itemType: null, state: 'unavailable', units: '' })))
      .toMatchObject({ colormap: 'viridis', rescale: [0, 1] })
  })

  it('names a derived layer as a result, keyed by its role', () => {
    const derived = item({ kind: 'Analysis', role: 'Derived', id: 'slope-1', itemType: { kind: 'Raster', quantity: 'Slope' }, units: '°' })
    const descriptors = new Map([[display.displayKey('Derived', 'slope-1', 'gen-2'), descriptor({ kind: 'Derived', entity_id: 'slope-1' })]])
    const [layer] = display.lidarDisplayLayers([derived], descriptors, (path) => path)
    expect(layer).toMatchObject({ id: 'lidar-result-slope-1-gen-2', colormap: 'magma', reversed: true, rescale: [0, 60] })
  })
})

describe('LiDAR display descriptor requests', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    invoke.mockReset()
    display.disposeLidarDisplayDescriptors()
    display.lidarDisplayDescriptors.value = new Map()
  })
  afterEach(() => {
    display.disposeLidarDisplayDescriptors()
    vi.useRealTimers()
  })

  it('polls a preparing generation until its derivatives are ready, then stops asking', async () => {
    invoke
      .mockResolvedValueOnce(descriptor({ state: 'Preparing', assets: [], prepared_assets: 1 }))
      .mockResolvedValueOnce(descriptor())
    display.requestLidarDisplay('Source', 'lyr-1', 'gen-2')
    await vi.advanceTimersByTimeAsync(0)
    expect(display.readLidarDisplay('Source', 'lyr-1', 'gen-2')?.state).toBe('Preparing')
    await vi.advanceTimersByTimeAsync(800)
    expect(display.readLidarDisplay('Source', 'lyr-1', 'gen-2')?.state).toBe('Ready')
    display.requestLidarDisplay('Source', 'lyr-1', 'gen-2')
    await vi.advanceTimersByTimeAsync(5000)
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenCalledWith('lidar_display_descriptor', {
      request: { kind: 'Source', entity_id: 'lyr-1', expected_generation_id: 'gen-2', retry: false },
    })
  })

  it('never stores a late answer after the owner is disposed', async () => {
    let answer!: (value: LidarDisplayDescriptor) => void
    invoke.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
    display.requestLidarDisplay('Source', 'lyr-1', 'gen-2')
    display.disposeLidarDisplayDescriptors()
    answer(descriptor())
    await vi.advanceTimersByTimeAsync(0)
    expect(display.readLidarDisplay('Source', 'lyr-1', 'gen-2')).toBeNull()
  })
})
