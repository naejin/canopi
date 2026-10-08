import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LidarDisplayDescriptor } from '../ipc/lidar'
import type { LidarPresentationItem } from '../app/lidar/library-store'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
const requestCutOutlierRange = vi.fn()
const cutRanges = new Map<string, readonly [number, number]>()
vi.mock('../app/lidar/display-range', () => ({
  requestCutOutlierRange: (...args: unknown[]) => requestCutOutlierRange(...args),
  cutOutlierRange: (key: string) => cutRanges.get(key) ?? null,
  resetCutOutlierRanges: () => cutRanges.clear(),
}))

const display = await import('../app/lidar/display')
const { lidarLibrary } = await import('../app/lidar/library-store')
const { setStoryPresentationOverrides } = await import('../app/story-presentation/overrides')
const { designSessionFixture } = await import('./support/design-session-state')
const { createDefaultMapLayers } = await import('../app/map-layers/state')
const { librarySnapshot, sourceItem } = await import('./support/library-fixtures')

function item(overrides: Partial<LidarPresentationItem> = {}): LidarPresentationItem {
  return {
    kind: 'Source',
    id: 'lyr-1',
    name: 'Orchard terrain',
    availability: 'present',
    itemType: { kind: 'Raster', quantity: 'GroundElevation' },
    units: 'm',
    state: 'Ready',
    visible: true,
    shown: true,
    opacity: 0.8,
    order: 0,
    ramp: null,
    reversed: false,
    range: null,
    bounds: [0, 0, 1, 1],
    generationId: 'gen-2',
    displayRange: [104, 132],
    freshness: { state: 'Current' },
    definitionId: null,
    analysisId: null,
    outputKey: null,
    run: null,
    inputId: null,
    parentId: null,
    depth: 0,
    ...overrides,
  }
}

function descriptor(overrides: Partial<LidarDisplayDescriptor> = {}): LidarDisplayDescriptor {
  return {
    kind: 'Source',
    entity_id: 'lyr-1',
    generation_id: 'gen-2',
    profile: 'display-cog-3857-v2',
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
    const [layer] = display.lidarDisplayLayers([item()], descriptors, null, (path) => `asset://localhost/${encodeURIComponent(path)}`)
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
      colormap: 'schwarzwald',
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
      item({ visible: false, shown: false }),
      item({ shown: false }),
      item({ id: 'lyr-2', availability: 'not-in-library', state: null }),
      item({ id: 'lyr-3', generationId: 'gen-9' }),
      item({ generationId: 'gen-3' }),
    ], descriptors, null)).toEqual([])
  })

  it('draws what a presented story step shows, whatever the Design stores', () => {
    const descriptors = new Map([
      [display.displayKey('Source', 'lyr-1', 'gen-2'), descriptor()],
      [display.displayKey('Source', 'lyr-2', 'gen-2'), descriptor({ entity_id: 'lyr-2' })],
    ])
    const items = [item({ visible: false, shown: false }), item({ id: 'lyr-2' })]
    const drawn = (presented: ReadonlySet<string> | null) =>
      display.lidarDisplayLayers(items, descriptors, presented, (path) => path).map((layer) => layer.id)

    expect(drawn(null)).toEqual(['lidar-source-lyr-2-gen-2'])
    expect(drawn(new Set(['lyr-1']))).toEqual(['lidar-source-lyr-1-gen-2'])
    expect(drawn(new Set())).toEqual([])
  })

  it('styles each reference by its item type, its own units and its own display, and a missing one not at all', () => {
    const slope = { kind: 'Derived' as const, itemType: { kind: 'Raster' as const, quantity: 'Slope' as const } }
    expect(display.lidarDisplayStyle(item({ ...slope, units: '%' })))
      .toMatchObject({ colormap: 'ylorrd', reversed: false, rescale: [0, 57.7], units: '%' })
    expect(display.lidarDisplayStyle(item({ ramp: 'Earth', reversed: true, range: { mode: 'Custom', min: 110, max: 120 } })))
      .toMatchObject({ ramp: 'Earth', colormap: 'turbid', reversed: true, rescale: [110, 120] })
    expect(display.lidarDisplayStyle(item({ itemType: null, availability: 'not-in-library', state: null, units: '' }))).toBeNull()
  })

  it('names a derived layer as a result, keyed by its role', () => {
    const derived = item({ kind: 'Derived', id: 'slope-1', itemType: { kind: 'Raster', quantity: 'Slope' }, units: '°' })
    const descriptors = new Map([[display.displayKey('Derived', 'slope-1', 'gen-2'), descriptor({ kind: 'Derived', entity_id: 'slope-1' })]])
    const [layer] = display.lidarDisplayLayers([derived], descriptors, null, (path) => path)
    expect(layer).toMatchObject({ id: 'lidar-result-slope-1-gen-2', colormap: 'ylorrd', reversed: false, rescale: [0, 30] })
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

  // canopi-f47t.51: the story override reached the map but not the
  // descriptor requests, so a step showing an entry hidden in the Design drew
  // nothing unless its descriptor was cached earlier.
  it('requests the descriptor of an entry a presented story step shows while the Design hides it', async () => {
    invoke.mockResolvedValue(descriptor())
    lidarLibrary.value = librarySnapshot([sourceItem('lyr-1', 'Orchard terrain', { generation_id: 'gen-2' })])
    designSessionFixture.file = {
      version: 9, name: 'Orchard', description: null,
      plant_species_colors: {}, plant_species_symbols: {}, plant_species_codes: {},
      layers: [], plants: [], zones: [], annotations: [], measurement_guides: [],
      consortiums: [], groups: [], timeline: [], budget: [], budget_currency: 'EUR',
      lidar: { schema_version: 1, visible: true, entries: [
        { kind: 'Source', id: 'lyr-1', name: 'Orchard terrain', visible: false, opacity: 1, order: 0, ramp: null, reversed: false, range: null },
      ] },
      created_at: '', updated_at: '', extra: {},
    }
    try {
      display.installLidarDisplayDescriptors()
      await vi.advanceTimersByTimeAsync(0)
      expect(invoke).not.toHaveBeenCalled()

      setStoryPresentationOverrides({
        mapLayers: createDefaultMapLayers(), siteDataIds: new Set(['lyr-1']), plantLabels: 'names', targets: [],
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(invoke).toHaveBeenCalledWith('lidar_display_descriptor', {
        request: { kind: 'Source', entity_id: 'lyr-1', expected_generation_id: 'gen-2', retry: false },
      })
    } finally {
      setStoryPresentationOverrides(null)
      designSessionFixture.file = null
      lidarLibrary.value = null
    }
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

  it('reads Cut outliers\' range only for an entry set to it with a ready display, by generation, and draws it', async () => {
    requestCutOutlierRange.mockClear()
    invoke.mockImplementation(async (_command: string, args: { request: { entity_id: string, expected_generation_id: string } }) =>
      descriptor({ entity_id: args.request.entity_id, generation_id: args.request.expected_generation_id }))
    lidarLibrary.value = librarySnapshot([
      sourceItem('lyr-1', 'Orchard terrain', { generation_id: 'gen-2' }),
      sourceItem('lyr-2', 'Canopy', { generation_id: 'gen-5' }),
    ])
    const entry = (id: string, range: unknown) => ({ kind: 'Source', id, name: id, visible: true, opacity: 1, order: 0, ramp: null, reversed: false, range })
    designSessionFixture.file = {
      version: 9, name: 'Orchard', description: null,
      plant_species_colors: {}, plant_species_symbols: {}, plant_species_codes: {},
      layers: [], plants: [], zones: [], annotations: [], measurement_guides: [],
      consortiums: [], groups: [], timeline: [], budget: [], budget_currency: 'EUR',
      lidar: { schema_version: 1, visible: true, entries: [entry('lyr-1', { mode: 'CutOutliers' }), entry('lyr-2', null)] as never },
      created_at: '', updated_at: '', extra: {},
    }
    try {
      display.installLidarDisplayDescriptors((path) => `served:${path}`)
      await vi.advanceTimersByTimeAsync(0)
      // requestCutOutlierRange reads a key once; the effect may ask again as descriptors land.
      expect([...new Set(requestCutOutlierRange.mock.calls.map((call) => JSON.stringify(call)))].map((call) => JSON.parse(call))).toEqual([[
        display.displayKey('Source', 'lyr-1', 'gen-2'),
        ['served:/data/lidar/display-cog/asset-top.tif', 'served:/data/lidar/display-cog/asset under.tif'],
      ]])
      cutRanges.set(display.displayKey('Source', 'lyr-1', 'gen-2'), [106, 129])
      expect(display.lidarDisplayStyle(item({ range: { mode: 'CutOutliers' } }))?.rescale).toEqual([106, 129])
      expect(display.lidarDisplayStyle(item({ range: { mode: 'CutOutliers' }, generationId: 'gen-3' }))?.rescale).toEqual([104, 132])
    } finally {
      display.disposeLidarDisplayDescriptors()
      invoke.mockReset()
      designSessionFixture.file = null
      lidarLibrary.value = null
    }
  })

  // A hidden entry set to Cut outliers still shows its range in its fields and legend, and Custom starts from it.
  it('reads Cut outliers\' range of an entry the map hides, and only for that mode', async () => {
    requestCutOutlierRange.mockClear()
    invoke.mockImplementation(async (_command: string, args: { request: { entity_id: string, expected_generation_id: string } }) =>
      descriptor({ entity_id: args.request.entity_id, generation_id: args.request.expected_generation_id }))
    lidarLibrary.value = librarySnapshot([
      sourceItem('lyr-1', 'Orchard terrain', { generation_id: 'gen-2' }),
      sourceItem('lyr-2', 'Canopy', { generation_id: 'gen-5' }),
    ])
    const entry = (id: string, range: unknown) => ({ kind: 'Source', id, name: id, visible: false, opacity: 1, order: 0, ramp: null, reversed: false, range })
    designSessionFixture.file = {
      version: 9, name: 'Orchard', description: null,
      plant_species_colors: {}, plant_species_symbols: {}, plant_species_codes: {},
      layers: [], plants: [], zones: [], annotations: [], measurement_guides: [],
      consortiums: [], groups: [], timeline: [], budget: [], budget_currency: 'EUR',
      lidar: { schema_version: 1, visible: true, entries: [entry('lyr-1', { mode: 'CutOutliers' }), entry('lyr-2', null)] as never },
      created_at: '', updated_at: '', extra: {},
    }
    try {
      display.installLidarDisplayDescriptors((path) => `served:${path}`)
      await vi.advanceTimersByTimeAsync(0)
      expect(invoke.mock.calls.map(([, args]) => (args as { request: { entity_id: string } }).request.entity_id)).toEqual(['lyr-1'])
      expect(requestCutOutlierRange).toHaveBeenCalledWith(display.displayKey('Source', 'lyr-1', 'gen-2'), expect.any(Array))
      expect(display.lidarDisplayLayers([item({ visible: false, shown: false, range: { mode: 'CutOutliers' } })], display.lidarDisplayDescriptors.value, null)).toEqual([])
    } finally {
      display.disposeLidarDisplayDescriptors()
      invoke.mockReset()
      designSessionFixture.file = null
      lidarLibrary.value = null
    }
  })
})
