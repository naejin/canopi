import { createDefaultScenePersistedState } from '../../canvas/runtime/scene'
import type { WorkspaceMapContributionSnapshot } from './workspace-map-contribution-adapter'
import { describe, expect, it, vi } from 'vitest'
import { createMapLibreSurfaceAdapter } from '../../maplibre/surface-adapter'
import type {
  MapLibreApi,
  MapLibreMapConstructorOptions,
  MapLibreMapInstance,
} from '../../maplibre/loader'
import type { WorkspaceMapSnapshot } from '../../maplibre/workspace-map'
import {
  MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
  MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
  MAPLIBRE_BASEMAP_SOURCE_ID,
  REMOTE_BASEMAP_TILE_URL_TEMPLATE,
} from '../../maplibre/config'
import { MAPLIBRE_SHARED_SCENE_LAYER_ID } from '../../maplibre/shared-scene-layer'
import { WorkspaceMapControls } from './workspace-map-controls'

type MapListener = (event?: unknown) => void

class FakeMap implements MapLibreMapInstance {
  readonly canvas = document.createElement('canvas')
  readonly jumpTo = vi.fn()
  readonly resize = vi.fn()
  readonly remove = vi.fn()
  readonly sources = new Map<string, unknown>()
  readonly layers = new Map<string, unknown>()
  readonly layerOrder: string[] = []
  readonly addSource = vi.fn((id: string, source: unknown) => { this.sources.set(id, source) })
  readonly getSource = vi.fn((id: string) => this.sources.get(id) as { setData(data: unknown): void } | undefined)
  readonly removeSource = vi.fn((id: string) => { this.sources.delete(id) })
  readonly addLayer = vi.fn((layer: { id?: string }, beforeId?: string) => {
    if (!layer.id) return
    this.layers.set(layer.id, layer)
    const existingIndex = this.layerOrder.indexOf(layer.id)
    if (existingIndex >= 0) this.layerOrder.splice(existingIndex, 1)
    const beforeIndex = beforeId == null ? -1 : this.layerOrder.indexOf(beforeId)
    if (beforeIndex >= 0) this.layerOrder.splice(beforeIndex, 0, layer.id)
    else this.layerOrder.push(layer.id)
  })
  readonly setPaintProperty = vi.fn()
  readonly getLayer = vi.fn((id: string) => this.layers.get(id))
  readonly getLayersOrder = vi.fn(() => [...this.layerOrder])
  readonly moveLayer = vi.fn((id: string, beforeId?: string) => {
    const index = this.layerOrder.indexOf(id)
    if (index < 0) return
    this.layerOrder.splice(index, 1)
    const beforeIndex = beforeId == null ? -1 : this.layerOrder.indexOf(beforeId)
    if (beforeIndex < 0) this.layerOrder.push(id)
    else this.layerOrder.splice(beforeIndex, 0, id)
  })
  readonly removeLayer = vi.fn((id: string) => {
    this.layers.delete(id)
    const index = this.layerOrder.indexOf(id)
    if (index >= 0) this.layerOrder.splice(index, 1)
  })
  readonly listeners = new Map<string, Set<MapListener>>()

  constructor(
    readonly options: MapLibreMapConstructorOptions,
    webgl2: WebGL2RenderingContext | null = {} as WebGL2RenderingContext,
  ) {
    Object.defineProperty(this.canvas, 'getContext', {
      configurable: true,
      value: vi.fn((type: string) => type === 'webgl2' ? webgl2 : null),
    })
  }

  on(type: 'load' | 'style.load' | 'error' | 'sourcedata' | 'move' | 'moveend' | 'resize' | 'webglcontextlost' | 'webglcontextrestored', listener: MapListener): void {
    const listeners = this.listeners.get(type) ?? new Set<MapListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  off(type: 'load' | 'style.load' | 'error' | 'sourcedata' | 'move' | 'moveend' | 'resize' | 'webglcontextlost' | 'webglcontextrestored', listener: MapListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  getCanvas(): HTMLCanvasElement { return this.canvas }
  emit(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
  clearStyle(): void {
    this.sources.clear()
    this.layers.clear()
    this.layerOrder.length = 0
  }
}

function createApi(
  maps: FakeMap[],
  webgl2: WebGL2RenderingContext | null = {} as WebGL2RenderingContext,
): MapLibreApi {
  class TestMap extends FakeMap {
    constructor(options: MapLibreMapConstructorOptions) {
      super(options, webgl2)
      maps.push(this)
    }
  }
  return { Map: TestMap, addProtocol: vi.fn() }
}

function createControls(options: {
  contributions?: ConstructorParameters<typeof WorkspaceMapControls>[0]['contributions']
  placementStatus?: 'provisional' | 'confirmed'
  basemapVisible?: boolean
  load?: () => Promise<MapLibreApi>
  webgl2?: WebGL2RenderingContext | null
} = {}) {
  const maps: FakeMap[] = []
  const observers: Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
  const api = createApi(
    maps,
    options.webgl2 === undefined ? {} as WebGL2RenderingContext : options.webgl2,
  )
  const surface = createMapLibreSurfaceAdapter<FakeMap>({
    loadMapLibre: options.load ?? (async () => api),
    createResizeObserver: () => {
      const observer = { observe: vi.fn(), disconnect: vi.fn() }
      observers.push(observer)
      return observer
    },
  })
  const snapshot: WorkspaceMapSnapshot = {
    anchor: { lat: 48.86, lon: 2.35 }, northBearingDeg: 12,
    placementStatus: options.placementStatus ?? 'confirmed',
    basemapStyle: 'street', basemapVisible: options.basemapVisible ?? true, basemapOpacity: 0.4,
  }
  const controls = new TestWorkspaceMapControls({
    container: document.createElement('div'),
    surface,
    contributions: options.contributions,
  }, snapshot)
  return { controls, maps, observers }
}

class TestWorkspaceMapControls extends WorkspaceMapControls {
  readonly sessionIdentity = {}
  constructor(
    options: ConstructorParameters<typeof WorkspaceMapControls>[0],
    private readonly defaultSnapshot: WorkspaceMapSnapshot,
  ) {
    super(options)
  }

  override createMap(signal: AbortSignal, snapshot = this.defaultSnapshot) {
    return super.createMap(signal, snapshot, this.sessionIdentity)
  }
}

async function waitForMap(maps: FakeMap[]): Promise<FakeMap> {
  await vi.waitFor(() => expect(maps).toHaveLength(1))
  return maps[0]!
}

function targetContribution(sessionIdentity: object): WorkspaceMapContributionSnapshot {
  const scene = createDefaultScenePersistedState()
  scene.zones = [{ kind: 'zone', locked: false, name: 'plot', zoneType: 'polygon', rotationDeg: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], fillColor: null, notes: null }]
  return {
    sessionIdentity, lidar: [],
    terrain: { contourIntervalMeters: 1, contoursVisible: false, contoursOpacity: 1, hillshadeVisible: false, hillshadeOpacity: 1, isDark: false },
    overlays: { runtime: { getSceneSnapshot: () => scene }, location: { lat: 48, lon: 2 }, northBearingDeg: 0, hoveredTargets: [{ kind: 'zone', zone_name: 'plot' }], selectedTargets: [] },
    frame: null, designExtentMeters: 0,
  }
}

describe('WorkspaceMapControls', () => {
  it.each([
    ['LiDAR', 'removeLayer'], ['LiDAR', 'removeSource'],
    ['terrain', 'removeLayer'], ['terrain', 'removeSource'],
  ] as const)('releases the map after %s rollback cannot %s', async (kind, removeMethod) => {
    const states = vi.fn()
    const { controls, maps } = createControls({ contributions: {
      onStateChange: states,
      loadTerrainSupport: async () => ({ sharedDemProtocolUrl: 'dem://tiles', contourProtocolUrl: () => 'contour://tiles' }),
    } })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    const admitted = await acquisition
    const failure = vi.fn((error: unknown) => controls.releaseMap(admitted, error))
    controls.watchFailure(admitted, failure)
    const partialLayer = kind === 'LiDAR' ? 'lidar-partial' : 'hillshade-layer'
    const partialSource = kind === 'LiDAR' ? 'lidar-partial' : 'terrain-dem'
    const add = map.addLayer.getMockImplementation()!
    map.addLayer.mockImplementation((candidate, before) => {
      add(candidate, before)
      if (candidate.id === partialLayer) throw new Error('partial contribution add')
    })
    const cleanup = new Error(`${kind} rollback failed`)
    const remove = map[removeMethod].getMockImplementation()!
    map[removeMethod].mockImplementation((id) => {
      if (id === partialLayer || id === partialSource) throw cleanup
      remove(id)
    })
    const input: WorkspaceMapContributionSnapshot = {
      ...targetContribution(controls.sessionIdentity),
      terrain: { ...targetContribution(controls.sessionIdentity).terrain, hillshadeVisible: kind === 'terrain' },
      lidar: kind === 'terrain' ? [] : [{ id: 'lidar-partial', name: 'partial', visible: true, opacity: 1, urlTemplate: 'local/{z}/{x}/{y}', minZoom: 1, maxZoom: 18, bounds: [1, 2, 3, 4] }],
    }
    controls.updateMapContributions(input)
    await vi.waitFor(() => expect(failure).toHaveBeenCalledExactlyOnceWith(cleanup))
    expect(map.remove).toHaveBeenCalledOnce()
    expect(states.mock.lastCall?.[0]).toMatchObject({ status: 'error', errorMessage: cleanup.message })
    const mutations = map.addSource.mock.calls.length
    controls.updateMapContributions(input)
    expect(map.addSource).toHaveBeenCalledTimes(mutations)
  })

  it('rejects and releases initial contribution failure before any failure watcher is installed', async () => {
    const states = vi.fn()
    const { controls, maps } = createControls({ contributions: { onStateChange: states } })
    const acquisition = controls.createMap(new AbortController().signal)
    controls.updateMapContributions(targetContribution(controls.sessionIdentity))
    const map = await waitForMap(maps)
    const error = new Error('target layer failed')
    const add = map.addLayer.getMockImplementation()!
    map.addLayer.mockImplementation((layer, before) => {
      if (layer.id?.startsWith('panel-target-')) throw error
      add(layer, before)
    })
    const remove = map.removeSource.getMockImplementation()!
    map.removeSource.mockImplementation((id) => {
      remove(id)
      if (id.startsWith('panel-target-')) map.emit('error', { error: new Error('cleanup failed') })
    })
    const rejected = expect(acquisition).rejects.toBe(error)
    map.emit('style.load')
    await rejected
    expect(map.remove).toHaveBeenCalledOnce()
    expect(states.mock.lastCall?.[0]).toMatchObject({ status: 'error', errorMessage: error.message })
    controls.updateMapContributions(targetContribution(controls.sessionIdentity))
    expect(map.remove).toHaveBeenCalledOnce()
  })

  it.each(['live', 'reload'] as const)('reports contribution failure once during %s work and retains error through release', async (phase) => {
    const states = vi.fn()
    const { controls, maps } = createControls({ contributions: { onStateChange: states } })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    const admitted = await acquisition
    const failure = vi.fn()
    controls.watchFailure(admitted, failure)
    controls.installStyleRestorer(admitted, () => {})
    if (phase === 'reload') controls.updateMapContributions(targetContribution(controls.sessionIdentity))
    const error = new Error('target source failed')
    const add = map.addSource.getMockImplementation()!
    map.addSource.mockImplementation((id, source) => {
      if (id.startsWith('panel-target-')) throw error
      add(id, source)
    })
    if (phase === 'reload') {
      map.clearStyle()
      map.emit('style.load')
    } else controls.updateMapContributions(targetContribution(controls.sessionIdentity))
    expect(failure).toHaveBeenCalledExactlyOnceWith(error)
    const mutations = map.addSource.mock.calls.length
    controls.updateMapContributions(targetContribution(controls.sessionIdentity))
    map.emit('style.load')
    expect(map.addSource).toHaveBeenCalledTimes(mutations)
    controls.releaseMap(admitted)
    expect(states.mock.lastCall?.[0]).toMatchObject({ status: 'error', errorMessage: error.message })
    expect(failure).toHaveBeenCalledOnce()
  })

  it.each(['loader', 'constructor', 'webgl', 'pre-admission'] as const)('publishes the acquisition error for %s failure', async (stage) => {
    const states = vi.fn()
    const error = new Error(`${stage} failed`)
    const { controls, maps } = createControls({
      contributions: { onStateChange: states },
      ...(stage === 'loader' ? { load: async () => { throw error } } : {}),
      ...(stage === 'constructor' ? { load: async () => ({ Map: class { constructor() { throw error } } as never, addProtocol: vi.fn() }) } : {}),
      ...(stage === 'webgl' ? { webgl2: null } : {}),
    })
    const acquisition = controls.createMap(new AbortController().signal)
    const rejection = expect(acquisition).rejects.toThrow(stage === 'webgl' ? 'WebGL2' : error.message)
    if (stage === 'pre-admission') (await waitForMap(maps)).emit('error', { error })
    await rejection
    expect(states.mock.lastCall?.[0]).toMatchObject({ status: 'error', errorMessage: stage === 'webgl' ? expect.stringContaining('WebGL2') : error.message })
  })

  it('keeps an ordinary acquisition abort idle', async () => {
    const states = vi.fn()
    const { controls, maps } = createControls({ contributions: { onStateChange: states } })
    const abort = new AbortController()
    const acquisition = controls.createMap(abort.signal)
    await waitForMap(maps)
    const rejected = expect(acquisition).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    await rejected
    expect(states.mock.lastCall?.[0]).toMatchObject({ status: 'idle', errorMessage: null })
  })

  it.each(['loader rejected', new DOMException('access denied', 'SecurityError'), new DOMException('loader cancelled internally', 'AbortError')])(
    'preserves a non-Error acquisition failure message: %s', async (error) => {
      const states = vi.fn()
      const { controls } = createControls({
        contributions: { onStateChange: states },
        load: async () => { throw error },
      })
      const abort = new AbortController()
      await expect(controls.createMap(abort.signal)).rejects.toBe(error)
      expect(abort.signal.aborted).toBe(false)
      expect(states.mock.lastCall?.[0]).toMatchObject({
        status: 'error', errorMessage: typeof error === 'string' ? error : error.message,
      })
    },
  )

  it.each([new Error('shared renderer failed'), new DOMException('renderer cancelled internally', 'AbortError')])('retains an external camera or shared-renderer failure on final map release: %s', async (error) => {
    const states = vi.fn()
    const { controls, maps } = createControls({ contributions: { onStateChange: states } })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    const admitted = await acquisition
    controls.releaseMap(admitted, error)
    controls.releaseMap(admitted)
    expect(states.mock.lastCall?.[0]).toMatchObject({ status: 'error', errorMessage: error.message })
    expect(map.remove).toHaveBeenCalledOnce()
  })

  it('rebuilds contribution layers after style reload on one map and clears them before removal', async () => {
    const bounds = vi.fn()
    const diagnostics = vi.fn()
    const states = vi.fn()
    const { controls, maps, observers } = createControls({
      contributions: { publishViewBounds: bounds, publishDiagnostics: diagnostics, onStateChange: states },
    })
    const acquisition = controls.createMap(new AbortController().signal)
    const input: WorkspaceMapContributionSnapshot = {
      sessionIdentity: controls.sessionIdentity,
      lidar: [{ id: 'lidar-test', name: 'test', visible: true, opacity: 1, urlTemplate: 'local/{z}/{x}/{y}', minZoom: 1, maxZoom: 18, bounds: [1, 2, 3, 4] }],
      terrain: { contourIntervalMeters: 1, contoursVisible: false, contoursOpacity: 1, hillshadeVisible: false, hillshadeOpacity: 1, isDark: false },
      overlays: { runtime: null, location: null, northBearingDeg: 0, hoveredTargets: [], selectedTargets: [] },
      frame: null, designExtentMeters: 0,
    }
    controls.updateMapContributions(input)
    const map = await waitForMap(maps)
    map.emit('style.load')
    const admitted = await acquisition
    const scene = { id: MAPLIBRE_SHARED_SCENE_LAYER_ID, type: 'custom' }
    map.addLayer(scene)
    controls.installStyleRestorer(admitted, () => map.addLayer(scene))
    controls.updateMapContributions({ ...input, lidar: [{ ...input.lidar[0]!, opacity: 0.2 }] })
    expect(maps).toHaveLength(1)
    expect(map.setPaintProperty).toHaveBeenCalledWith('lidar-test', 'raster-opacity', 0.2)
    map.clearStyle()
    map.emit('style.load')
    expect(map.getLayersOrder()).toEqual([MAPLIBRE_BASEMAP_RASTER_LAYER_ID, 'lidar-test', MAPLIBRE_SHARED_SCENE_LAYER_ID])
    expect(map.setPaintProperty).toHaveBeenLastCalledWith(MAPLIBRE_BASEMAP_RASTER_LAYER_ID, 'raster-opacity', 0.4)
    map.remove.mockImplementation(() => {
      expect(map.getSource('lidar-test')).toBeUndefined()
      expect([...map.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true)
      expect(bounds).toHaveBeenLastCalledWith(null)
      expect(diagnostics).toHaveBeenLastCalledWith(null, null)
      expect(states.mock.lastCall?.[0].status).toBe('idle')
    })
    controls.releaseMap(admitted)
    controls.releaseMap(admitted)
    expect(map.remove).toHaveBeenCalledOnce()
    expect(observers[0]?.disconnect).toHaveBeenCalledOnce()
  })

  it.each([
    ['provisional', true],
    ['confirmed', false],
  ] as const)('does not add a remote source for %s or hidden base presentation', async (placementStatus, basemapVisible) => {
    const { controls, maps } = createControls({ placementStatus, basemapVisible })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)

    map.emit('style.load')
    await expect(acquisition).resolves.toBe(map)
    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.addLayer).not.toHaveBeenCalled()
    expect(JSON.stringify(map.options.style)).not.toContain('tile.openstreetmap.org')
  })

  it('adds the confirmed visible contribution at style admission without waiting for tile events', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)

    map.emit('style.load')
    await expect(acquisition).resolves.toBe(map)

    expect(map.addSource).toHaveBeenCalledWith(MAPLIBRE_BASEMAP_SOURCE_ID, expect.objectContaining({ type: 'raster' }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
      source: MAPLIBRE_BASEMAP_SOURCE_ID,
    }))
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
      'raster-opacity',
      0.4,
    )
  })

  it('applies opacity-only presentation updates without recreating the basemap contribution', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    map.addSource.mockClear()
    map.addLayer.mockClear()
    map.removeLayer.mockClear()
    map.removeSource.mockClear()
    map.setPaintProperty.mockClear()

    controls.updateBasemapPresentation({
      basemapStyle: 'street', basemapVisible: true, basemapOpacity: 0.75,
    })

    expect(map.setPaintProperty).toHaveBeenCalledWith(
      MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
      'raster-opacity',
      0.75,
    )
    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.addLayer).not.toHaveBeenCalled()
    expect(map.removeLayer).not.toHaveBeenCalled()
    expect(map.removeSource).not.toHaveBeenCalled()
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'normalizes non-finite opacity %p to zero',
    async (basemapOpacity) => {
      const { controls, maps } = createControls()
      const acquisition = controls.createMap(new AbortController().signal)
      const map = await waitForMap(maps)
      map.emit('style.load')
      await acquisition
      map.setPaintProperty.mockClear()

      controls.updateBasemapPresentation({
        basemapStyle: 'street', basemapVisible: true, basemapOpacity,
      })

      expect(map.setPaintProperty).toHaveBeenCalledWith(
        MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
        'raster-opacity',
        0,
      )
    },
  )

  it('removes before source removal, retains hidden style, and restores the latest visible style', async () => {
    vi.stubEnv('VITE_MAPTILER_KEY', 'live-presentation-key')
    try {
      const { controls, maps } = createControls()
      const acquisition = controls.createMap(new AbortController().signal)
      const map = await waitForMap(maps)
      map.emit('style.load')
      await acquisition

      controls.updateBasemapPresentation({
        basemapStyle: 'satellite', basemapVisible: false, basemapOpacity: 1.2,
      })
      expect(map.removeLayer.mock.invocationCallOrder[0]).toBeLessThan(
        map.removeSource.mock.invocationCallOrder[0]!,
      )
      const sourceCountWhileHidden = map.addSource.mock.calls.length
      controls.updateBasemapPresentation({
        basemapStyle: 'satellite', basemapVisible: false, basemapOpacity: 0.2,
      })
      expect(map.addSource).toHaveBeenCalledTimes(sourceCountWhileHidden)

      controls.updateBasemapPresentation({
        basemapStyle: 'satellite', basemapVisible: true, basemapOpacity: 2,
      })
      expect(map.addSource).toHaveBeenLastCalledWith(
        MAPLIBRE_BASEMAP_SOURCE_ID,
        expect.objectContaining({ tiles: [expect.stringContaining('maptiler.com')] }),
      )
      expect(map.setPaintProperty).toHaveBeenLastCalledWith(
        MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
        'raster-opacity',
        1,
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('retains the latest presentation during acquisition before style admission', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    controls.updateBasemapPresentation({
      basemapStyle: 'street', basemapVisible: false, basemapOpacity: 0.1,
    })

    map.emit('style.load')
    await acquisition
    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.addLayer).not.toHaveBeenCalled()
  })

  it('keeps a confirmed presentation update inert for a provisional attempt', async () => {
    const { controls, maps } = createControls({ placementStatus: 'provisional' })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition

    controls.updateBasemapPresentation({
      basemapStyle: 'street', basemapVisible: true, basemapOpacity: 0.8,
    })

    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.addLayer).not.toHaveBeenCalled()
  })

  it('replaces and hides only the basemap while preserving local contribution identities and order', async () => {
    vi.stubEnv('VITE_MAPTILER_KEY', 'live-presentation-key')
    try {
      const { controls, maps } = createControls()
      const acquisition = controls.createMap(new AbortController().signal)
      const map = await waitForMap(maps)
      map.emit('style.load')
      await acquisition
      const background = { id: MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID }
      const lidarSource = { type: 'raster', tiles: ['lidar'] }
      const referenceSource = { type: 'geojson' }
      const lidar = { id: 'lidar-layer', source: 'lidar-source' }
      const reference = { id: 'reference-layer', source: 'reference-source' }
      const scene = { id: MAPLIBRE_SHARED_SCENE_LAYER_ID }
      map.addLayer(background)
      map.layerOrder.splice(0, map.layerOrder.length,
        MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
        MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
      )
      map.addSource('lidar-source', lidarSource)
      map.addSource('reference-source', referenceSource)
      map.addLayer(lidar)
      map.addLayer(reference)
      map.addLayer(scene)
      map.removeLayer.mockClear()
      map.removeSource.mockClear()
      map.addLayer.mockClear()
      map.addSource.mockClear()

      controls.updateBasemapPresentation({
        basemapStyle: 'satellite', basemapVisible: true, basemapOpacity: 0.6,
      })

      expect(map.removeLayer).toHaveBeenCalledExactlyOnceWith(MAPLIBRE_BASEMAP_RASTER_LAYER_ID)
      expect(map.removeSource).toHaveBeenCalledExactlyOnceWith(MAPLIBRE_BASEMAP_SOURCE_ID)
      expect(map.getSource('lidar-source')).toBe(lidarSource)
      expect(map.getSource('reference-source')).toBe(referenceSource)
      expect(map.getLayer('lidar-layer')).toBe(lidar)
      expect(map.getLayer('reference-layer')).toBe(reference)
      expect(map.getLayer(MAPLIBRE_SHARED_SCENE_LAYER_ID)).toBe(scene)
      expect(map.layerOrder).toEqual([
        MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
        MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
        'lidar-layer',
        'reference-layer',
        MAPLIBRE_SHARED_SCENE_LAYER_ID,
      ])

      controls.updateBasemapPresentation({
        basemapStyle: 'satellite', basemapVisible: false, basemapOpacity: 0.6,
      })
      controls.updateBasemapPresentation({
        basemapStyle: 'satellite', basemapVisible: true, basemapOpacity: 0.6,
      })

      expect(map.getSource('lidar-source')).toBe(lidarSource)
      expect(map.getSource('reference-source')).toBe(referenceSource)
      expect(map.getLayer('lidar-layer')).toBe(lidar)
      expect(map.getLayer('reference-layer')).toBe(reference)
      expect(map.getLayer(MAPLIBRE_SHARED_SCENE_LAYER_ID)).toBe(scene)
      expect(map.removeLayer.mock.calls).toEqual([
        [MAPLIBRE_BASEMAP_RASTER_LAYER_ID],
        [MAPLIBRE_BASEMAP_RASTER_LAYER_ID],
      ])
      expect(map.removeSource.mock.calls).toEqual([
        [MAPLIBRE_BASEMAP_SOURCE_ID],
        [MAPLIBRE_BASEMAP_SOURCE_ID],
      ])
      expect(map.layerOrder).toEqual([
        MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
        MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
        'lidar-layer',
        'reference-layer',
        MAPLIBRE_SHARED_SCENE_LAYER_ID,
      ])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('binds map construction and later style restoration to each attempt snapshot', async () => {
    const { controls, maps } = createControls()
    const snapshotA: WorkspaceMapSnapshot = {
      anchor: { lat: 10, lon: 20 },
      northBearingDeg: 30,
      placementStatus: 'confirmed',
      basemapStyle: 'street',
      basemapVisible: true,
      basemapOpacity: 0.2,
    }
    const snapshotB: WorkspaceMapSnapshot = {
      anchor: { lat: -40, lon: 70 },
      northBearingDeg: 80,
      placementStatus: 'confirmed',
      basemapStyle: 'satellite',
      basemapVisible: true,
      basemapOpacity: 0.8,
    }
    const first = controls.createMap(new AbortController().signal, snapshotA)
    await vi.waitFor(() => expect(maps).toHaveLength(1))
    const mapA = maps[0]!
    mapA.emit('style.load')
    await first
    controls.installStyleRestorer(mapA as never, vi.fn())

    const second = controls.createMap(new AbortController().signal, snapshotB)
    await vi.waitFor(() => expect(maps).toHaveLength(2))
    const mapB = maps[1]!
    mapB.emit('style.load')
    await second
    controls.installStyleRestorer(mapB as never, vi.fn())

    mapA.clearStyle()
    mapA.emit('style.load')
    mapB.clearStyle()
    mapB.emit('style.load')

    expect(mapA.options.center).toEqual([20, 10])
    expect(mapA.options.bearing).toBe(30)
    expect(mapA.setPaintProperty).toHaveBeenCalledTimes(1)
    expect(mapA.setPaintProperty).toHaveBeenLastCalledWith(
      MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
      'raster-opacity',
      0.2,
    )
    expect(mapB.options.center).toEqual([70, -40])
    expect(mapB.options.bearing).toBe(80)
    expect(mapB.setPaintProperty).toHaveBeenCalledTimes(2)
    expect(mapB.setPaintProperty).toHaveBeenLastCalledWith(
      MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
      'raster-opacity',
      0.8,
    )
  })

  it('owns the call-time map snapshot through admission and later style reload', async () => {
    vi.stubEnv('VITE_MAPTILER_KEY', 'snapshot-test-key')
    try {
      const { controls, maps } = createControls()
      const snapshot: WorkspaceMapSnapshot = {
        anchor: { lat: 11, lon: 22 },
        northBearingDeg: 33,
        placementStatus: 'confirmed',
        basemapStyle: 'street',
        basemapVisible: true,
        basemapOpacity: 0.25,
      }
      const acquisition = controls.createMap(new AbortController().signal, snapshot)
      const map = await waitForMap(maps)

      ;(snapshot.anchor as { lat: number; lon: number }).lat = 81
      ;(snapshot.anchor as { lat: number; lon: number }).lon = 82
      ;(snapshot as { northBearingDeg: number }).northBearingDeg = 83
      ;(snapshot as { basemapStyle: 'street' | 'satellite' }).basemapStyle = 'satellite'
      ;(snapshot as { basemapVisible: boolean }).basemapVisible = false
      ;(snapshot as { basemapOpacity: number }).basemapOpacity = 0.95

      map.emit('style.load')
      await acquisition
      controls.installStyleRestorer(map as never, vi.fn())

      expect(map.options.center).toEqual([22, 11])
      expect(map.options.bearing).toBe(33)
      expect(map.addSource).toHaveBeenCalledWith(
        MAPLIBRE_BASEMAP_SOURCE_ID,
        expect.objectContaining({ tiles: [REMOTE_BASEMAP_TILE_URL_TEMPLATE] }),
      )
      expect(map.setPaintProperty).toHaveBeenLastCalledWith(
        MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
        'raster-opacity',
        0.25,
      )

      map.clearStyle()
      map.emit('style.load')

      expect(map.addSource).toHaveBeenCalledTimes(2)
      expect(map.addSource).toHaveBeenLastCalledWith(
        MAPLIBRE_BASEMAP_SOURCE_ID,
        expect.objectContaining({ tiles: [REMOTE_BASEMAP_TILE_URL_TEMPLATE] }),
      )
      expect(map.setPaintProperty).toHaveBeenCalledTimes(2)
      expect(map.setPaintProperty).toHaveBeenLastCalledWith(
        MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
        'raster-opacity',
        0.25,
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('orders a preserved shared scene through moveLayer without recreating it', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    map.addLayer({ id: MAPLIBRE_SHARED_SCENE_LAYER_ID })
    map.layerOrder.splice(0, map.layerOrder.length,
      MAPLIBRE_SHARED_SCENE_LAYER_ID,
      MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
      MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
    )
    map.addLayer.mockClear()
    map.addSource.mockClear()
    map.setPaintProperty.mockClear()

    controls.installStyleRestorer(map as never, vi.fn())

    expect(map.getLayersOrder).toHaveBeenCalled()
    expect(map.moveLayer).toHaveBeenCalled()
    expect(map.layerOrder).toEqual([
      MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
      MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
      MAPLIBRE_SHARED_SCENE_LAYER_ID,
    ])
    expect(map.addLayer).not.toHaveBeenCalled()
    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.setPaintProperty).not.toHaveBeenCalled()
  })

  it('reports an initial semantic-order failure through the shared fallback watcher', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    map.addLayer({ id: MAPLIBRE_SHARED_SCENE_LAYER_ID })
    map.layerOrder.splice(0, map.layerOrder.length,
      MAPLIBRE_SHARED_SCENE_LAYER_ID,
      MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
      MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
    )
    const failure = new Error('semantic move rejected')
    const reportFailure = vi.fn()
    controls.watchFailure(map as never, reportFailure)
    map.moveLayer.mockImplementation(() => { throw failure })

    controls.installStyleRestorer(map as never, vi.fn())

    expect(reportFailure).toHaveBeenCalledWith(failure)
  })

  it('uses initial style.load only for admission, then restores the basemap before its restorer', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    const restorer = vi.fn()
    controls.installStyleRestorer(map as never, restorer)
    expect(restorer).not.toHaveBeenCalled()

    map.clearStyle()
    map.emit('style.load')

    expect(map.addSource).toHaveBeenCalledTimes(2)
    expect(map.setPaintProperty).toHaveBeenCalledTimes(2)
    expect(restorer).toHaveBeenCalledOnce()
    expect(map.addSource.mock.invocationCallOrder[1]).toBeLessThan(restorer.mock.invocationCallOrder[0]!)
  })

  it('inserts a restored basemap below a custom scene layer preserved by a diff reload', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    map.addLayer({ id: MAPLIBRE_SHARED_SCENE_LAYER_ID })
    const restorer = vi.fn()
    controls.installStyleRestorer(map as never, restorer)

    map.removeLayer(MAPLIBRE_BASEMAP_RASTER_LAYER_ID)
    map.removeSource(MAPLIBRE_BASEMAP_SOURCE_ID)
    map.emit('style.load')

    expect(map.layerOrder).toEqual([
      MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
      MAPLIBRE_SHARED_SCENE_LAYER_ID,
    ])
    expect(map.addLayer).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: MAPLIBRE_BASEMAP_RASTER_LAYER_ID }),
      MAPLIBRE_SHARED_SCENE_LAYER_ID,
    )
    expect(restorer).toHaveBeenCalledOnce()
  })

  it('queues a style reload emitted synchronously during restoration', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    let reloadDuringRestoration = true
    const restorer = vi.fn(() => {
      if (!reloadDuringRestoration) return
      reloadDuringRestoration = false
      map.clearStyle()
      map.emit('style.load')
    })
    controls.installStyleRestorer(map as never, restorer)

    map.clearStyle()
    map.emit('style.load')
    await Promise.resolve()

    expect(restorer).toHaveBeenCalledTimes(2)
    expect(map.addSource).toHaveBeenCalledTimes(3)
    expect(map.addLayer).toHaveBeenCalledTimes(3)
    expect(map.getLayer(MAPLIBRE_BASEMAP_RASTER_LAYER_ID)).toBeDefined()
  })

  it('replays the latest presentation requested reentrantly by a style restorer', async () => {
    vi.stubEnv('VITE_MAPTILER_KEY', 'live-presentation-key')
    try {
      const { controls, maps } = createControls()
      const acquisition = controls.createMap(new AbortController().signal)
      const map = await waitForMap(maps)
      map.emit('style.load')
      await acquisition
      let updateDuringRestore = true
      controls.installStyleRestorer(map as never, () => {
        if (!updateDuringRestore) return
        updateDuringRestore = false
        controls.updateBasemapPresentation({
          basemapStyle: 'satellite', basemapVisible: true, basemapOpacity: 0.9,
        })
      })

      map.clearStyle()
      map.emit('style.load')
      await Promise.resolve()

      expect(map.addSource).toHaveBeenLastCalledWith(
        MAPLIBRE_BASEMAP_SOURCE_ID,
        expect.objectContaining({ tiles: [expect.stringContaining('maptiler.com')] }),
      )
      expect(map.setPaintProperty).toHaveBeenLastCalledWith(
        MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
        'raster-opacity',
        0.9,
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('serializes reentrant presentation and style signals from a live style replacement', async () => {
    vi.stubEnv('VITE_MAPTILER_KEY', 'live-presentation-key')
    try {
      const { controls, maps } = createControls()
      const acquisition = controls.createMap(new AbortController().signal)
      const map = await waitForMap(maps)
      map.emit('style.load')
      await acquisition
      const restorer = vi.fn()
      controls.installStyleRestorer(map as never, restorer)
      const sourceMutationDepths: number[] = []
      let removalDepth = 0
      let reentered = false
      map.removeLayer.mockImplementation((id: string) => {
        map.layers.delete(id)
        const index = map.layerOrder.indexOf(id)
        if (index >= 0) map.layerOrder.splice(index, 1)
        if (id !== MAPLIBRE_BASEMAP_RASTER_LAYER_ID || reentered) return
        reentered = true
        removalDepth += 1
        controls.updateBasemapPresentation({
          basemapStyle: 'street', basemapVisible: true, basemapOpacity: 0.9,
        })
        map.emit('style.load')
        removalDepth -= 1
      })
      map.addSource.mockImplementation((id: string, source: unknown) => {
        sourceMutationDepths.push(removalDepth)
        map.sources.set(id, source)
      })

      controls.updateBasemapPresentation({
        basemapStyle: 'satellite', basemapVisible: true, basemapOpacity: 0.3,
      })

      expect(sourceMutationDepths).toEqual([0, 0])
      expect(map.addSource).toHaveBeenLastCalledWith(
        MAPLIBRE_BASEMAP_SOURCE_ID,
        expect.objectContaining({ tiles: [REMOTE_BASEMAP_TILE_URL_TEMPLATE] }),
      )
      expect(map.setPaintProperty).toHaveBeenLastCalledWith(
        MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
        'raster-opacity',
        0.9,
      )
      expect(restorer).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it.each([
    ['provisional', true],
    ['confirmed', false],
  ] as const)('does not restore a remote basemap for %s or hidden presentation', async (placementStatus, basemapVisible) => {
    const { controls, maps } = createControls({ placementStatus, basemapVisible })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    const restorer = vi.fn()
    controls.installStyleRestorer(map as never, restorer)

    map.clearStyle()
    map.emit('style.load')

    expect(map.addSource).not.toHaveBeenCalled()
    expect(restorer).toHaveBeenCalledOnce()
  })

  it('replays one coalesced style reload that arrived before registration', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    map.clearStyle()
    map.emit('style.load')
    map.emit('style.load')
    const restorer = vi.fn()

    controls.installStyleRestorer(map as never, restorer)

    expect(restorer).toHaveBeenCalledOnce()
    expect(map.addSource).toHaveBeenCalledTimes(2)
  })

  it('stops style reconstruction as soon as its registration is disposed', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    const restorer = vi.fn()
    const dispose = controls.installStyleRestorer(map as never, restorer)

    dispose()
    map.clearStyle()
    map.emit('style.load')

    expect(map.addSource).toHaveBeenCalledOnce()
    expect(restorer).not.toHaveBeenCalled()
  })

  it('reports a post-admission restoration failure through the existing watcher', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    const reportFailure = vi.fn()
    controls.watchFailure(map as never, reportFailure)
    controls.installStyleRestorer(map as never, vi.fn())
    const failure = new Error('restored source rejected')
    map.clearStyle()
    map.addSource.mockImplementation(() => { throw failure })

    map.emit('style.load')

    expect(reportFailure).toHaveBeenCalledWith(failure)
  })

  it('reports a restored basemap paint failure through the existing watcher', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    const reportFailure = vi.fn()
    controls.watchFailure(map as never, reportFailure)
    controls.installStyleRestorer(map as never, vi.fn())
    const failure = new Error('restored opacity rejected')
    map.clearStyle()
    map.setPaintProperty.mockImplementation(() => { throw failure })

    map.emit('style.load')

    expect(reportFailure).toHaveBeenCalledWith(failure)
  })

  it('reports one live presentation mutation failure through the existing watcher', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    const reportFailure = vi.fn()
    controls.watchFailure(map as never, reportFailure)
    controls.installStyleRestorer(map as never, vi.fn())
    const failure = new Error('opacity rejected')
    map.setPaintProperty.mockImplementation(() => { throw failure })
    map.setPaintProperty.mockClear()

    controls.updateBasemapPresentation({
      basemapStyle: 'street', basemapVisible: true, basemapOpacity: 0.6,
    })
    controls.updateBasemapPresentation({
      basemapStyle: 'street', basemapVisible: true, basemapOpacity: 0.7,
    })
    map.emit('style.load')

    expect(reportFailure).toHaveBeenCalledTimes(1)
    expect(reportFailure).toHaveBeenCalledWith(failure)
    expect(map.setPaintProperty).toHaveBeenCalledOnce()
  })

  it('reports a scene restorer failure through the existing watcher', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    const reportFailure = vi.fn()
    controls.watchFailure(map as never, reportFailure)
    const failure = new Error('scene layer rejected')
    controls.installStyleRestorer(map as never, () => { throw failure })

    map.clearStyle()
    map.emit('style.load')

    expect(reportFailure).toHaveBeenCalledWith(failure)
  })

  it('treats a synchronous source event as passive after the local style is admitted', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    const error = new Error('tile request failed immediately')
    const event = { sourceId: MAPLIBRE_BASEMAP_SOURCE_ID, error }
    map.addSource.mockImplementation(() => map.emit('error', event))

    map.emit('style.load')

    await expect(acquisition).resolves.toBe(map)
    expect(map.remove).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(
      'Passive MapLibre workspace basemap error:',
      event,
    )
    logError.mockRestore()
  })

  it('rejects a thrown basemap configuration error and releases the map', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    const error = new Error('source definition rejected')
    map.addSource.mockImplementation(() => { throw error })

    map.emit('style.load')

    await expect(acquisition).rejects.toBe(error)
    expect(map.remove).toHaveBeenCalledOnce()
  })

  it('rejects before admission for context loss and releases through the surface adapter', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)

    map.emit('webglcontextlost')
    await expect(acquisition).rejects.toThrow('WebGL context was lost')
    expect(map.remove).toHaveBeenCalledOnce()
  })

  it('routes a loader failure to the acquisition rejection', async () => {
    const error = new Error('module unavailable')
    const { controls } = createControls({ load: async () => { throw error } })
    await expect(controls.createMap(new AbortController().signal)).rejects.toBe(error)
  })

  it('routes a MapLibre constructor failure to the acquisition rejection', async () => {
    const error = new Error('map construction failed')
    const surface = createMapLibreSurfaceAdapter({
      loadMapLibre: async () => ({
        Map: class {
          constructor() { throw error }
        } as never,
        addProtocol: vi.fn(),
      }),
    })
    const controls = new WorkspaceMapControls({
      container: document.createElement('div'), surface,
    })
    await expect(controls.createMap(new AbortController().signal, {
      anchor: { lat: 0, lon: 0 }, northBearingDeg: 0, placementStatus: 'confirmed',
      basemapStyle: 'street', basemapVisible: true, basemapOpacity: 1,
    }, {})).rejects.toBe(error)
  })

  it('rejects and releases when the constructed map has no public WebGL2 context', async () => {
    const { controls, maps, observers } = createControls({ webgl2: null })

    await expect(controls.createMap(new AbortController().signal)).rejects.toThrow(
      'did not expose a WebGL2 context',
    )

    expect(maps).toHaveLength(1)
    expect(maps[0]?.remove).toHaveBeenCalledOnce()
    expect(observers[0]?.disconnect).toHaveBeenCalledOnce()
  })

  it('rejects a pre-admission MapLibre error and releases the map', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    const error = new Error('style failed')

    map.emit('error', error)
    await expect(acquisition).rejects.toBe(error)
    expect(map.remove).toHaveBeenCalledOnce()
  })

  it('retains post-admission context loss until the coordinator registers its watcher', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition

    map.emit('webglcontextlost')
    const reportFailure = vi.fn()
    controls.watchFailure(map as never, reportFailure)
    expect(reportFailure).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('WebGL context was lost') }))
    map.emit('webglcontextlost')
    expect(reportFailure).toHaveBeenCalledOnce()
  })

  it('retains a generic post-admission map failure until the watcher registers', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    const error = new Error('map engine failed')

    map.emit('error', { error })
    const reportFailure = vi.fn()
    controls.watchFailure(map as never, reportFailure)

    expect(reportFailure).toHaveBeenCalledWith(error)
  })

  it('reports a generic map failure after the watcher registers', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    const reportFailure = vi.fn()
    controls.watchFailure(map as never, reportFailure)
    const error = new Error('map engine failed later')

    map.emit('error', { error })

    expect(reportFailure).toHaveBeenCalledWith(error)
  })

  it('ignores passive basemap errors after style admission', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition

    const event = {
      sourceId: MAPLIBRE_BASEMAP_SOURCE_ID,
      error: new Error('tile unavailable'),
    }
    map.emit('error', event)
    expect(map.remove).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith('Passive MapLibre workspace basemap error:', event)
    logError.mockRestore()
  })

  it('cancels module loading and style waiting without leaving a map alive', async () => {
    let resolveLoad!: (api: MapLibreApi) => void
    const loader = new Promise<MapLibreApi>((resolve) => { resolveLoad = resolve })
    const loaded = createControls({ load: () => loader })
    const loadingAbort = new AbortController()
    const loading = loaded.controls.createMap(loadingAbort.signal)
    loadingAbort.abort()
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' })
    resolveLoad(createApi(loaded.maps))
    await Promise.resolve()
    expect(loaded.maps).toEqual([])

    const waiting = createControls()
    const styleAbort = new AbortController()
    const acquisition = waiting.controls.createMap(styleAbort.signal)
    const map = await waitForMap(waiting.maps)
    styleAbort.abort()
    await expect(acquisition).rejects.toMatchObject({ name: 'AbortError' })
    expect(map.remove).toHaveBeenCalledOnce()
    expect(map.listeners.get('style.load')?.size ?? 0).toBe(0)
    expect(waiting.observers[0]?.disconnect).toHaveBeenCalledOnce()
  })

  it('cancels a superseded acquisition before creating the replacement map', async () => {
    const { controls, maps } = createControls()
    const first = controls.createMap(new AbortController().signal)
    const second = controls.createMap(new AbortController().signal)

    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const map = await waitForMap(maps)
    map.emit('style.load')
    await expect(second).resolves.toBe(map)
    expect(maps).toHaveLength(1)
  })

  it('releases an admitted map through the surface exactly once', async () => {
    const { controls, maps, observers } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition

    controls.releaseMap(map as never)
    controls.releaseMap(map as never)

    expect(map.remove).toHaveBeenCalledOnce()
    expect(observers[0]?.disconnect).toHaveBeenCalledOnce()
  })

  it('leaves a released attempt inert when a later presentation arrives', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    controls.releaseMap(map as never)
    map.addSource.mockClear()
    map.addLayer.mockClear()
    map.setPaintProperty.mockClear()

    controls.updateBasemapPresentation({
      basemapStyle: 'street', basemapVisible: false, basemapOpacity: 0,
    })

    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.addLayer).not.toHaveBeenCalled()
    expect(map.setPaintProperty).not.toHaveBeenCalled()
  })

  it('reads WebGL2 only from the public map canvas', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    const context = {} as WebGL2RenderingContext
    const getContext = vi.fn(() => context)
    Object.defineProperty(map.canvas, 'getContext', { value: getContext })

    expect(controls.getWebGL2Context(map as never)).toBe(context)
    expect(getContext).toHaveBeenCalledWith('webgl2')
  })
})
