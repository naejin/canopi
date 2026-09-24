import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LidarDisplayDescriptor } from '../ipc/lidar'
import type { LidarPresentationItem } from '../app/lidar/library-store'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

const display = await import('../app/lidar/display')

function item(overrides: Partial<LidarPresentationItem> = {}): LidarPresentationItem {
  return {
    kind: 'Source',
    id: 'lyr-1',
    name: 'Orchard terrain',
    detail: 'GroundElevation',
    slopeUnit: null,
    state: 'Ready',
    visible: true,
    opacity: 0.8,
    order: 0,
    bounds: [0, 0, 1, 1],
    generationId: 'gen-2',
    displayRange: [104, 132],
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
    const [layer] = display.lidarDisplayLayers([item()], descriptors, () => 'm', (path) => `asset://localhost/${encodeURIComponent(path)}`)
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

  it('colours slope in its own stored unit, never as degrees for a percent result', () => {
    const degrees = display.lidarDisplayStyle(item({ kind: 'Analysis', slopeUnit: 'Degrees' }), '')
    const percent = display.lidarDisplayStyle(item({ kind: 'Analysis', slopeUnit: 'Percent' }), '')
    expect(degrees).toMatchObject({ colormap: 'magma', reversed: true, rescale: [0, 60], units: '°' })
    expect(percent).toMatchObject({ colormap: 'magma', reversed: true, rescale: [0, 173.2], units: '%' })
    expect(display.lidarDisplayStyle(item({ detail: 'AboveGroundHeight', displayRange: [3, 3] }), 'm'))
      .toMatchObject({ colormap: 'viridis', rescale: [3, 4], units: 'm' })
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
