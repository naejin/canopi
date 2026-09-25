import { createDefaultScenePersistedState } from '../../canvas/runtime/scene'
import type { WorkspaceMapContributionSnapshot } from './workspace-map-contribution-adapter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMapLibreSurfaceAdapter } from '../../maplibre/surface-adapter'
import type {
  MapLibreApi,
  MapLibreMapConstructorOptions,
  MapLibreMapInstance,
} from '../../maplibre/loader'
import type { WorkspaceMapSnapshot } from '../../maplibre/workspace-map'
import {
  MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
  MAPLIBRE_SATELLITE_LAYER_ID,
  MAPLIBRE_SATELLITE_SOURCE_ID,
} from '../../maplibre/config'
import type { MapBackgroundPresentation } from '../../maplibre/map-background'
import { OPENFREEMAP_BASEMAPS } from '../../maplibre/openfreemap-basemap'
import { GOOGLE_KEYLESS_TILES, GOOGLE_SESSION_TILES } from '../../maplibre/satellite-provider'
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
  readonly setLayoutProperty = vi.fn()
  readonly setGlyphs = vi.fn()
  readonly setSprite = vi.fn()
  readonly setStyle = vi.fn()
  readonly controls = new Set<unknown>()
  readonly addControl = vi.fn((control: unknown, _position?: string) => { this.controls.add(control) })
  readonly removeControl = vi.fn((control: unknown) => { this.controls.delete(control) })
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

class FakeAttributionControl {
  constructor(readonly options?: { compact?: boolean; customAttribution?: string | string[] }) {}
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
  return { Map: TestMap, addProtocol: vi.fn(), AttributionControl: FakeAttributionControl } as unknown as MapLibreApi
}

/** A small OpenFreeMap-like style; the network is never reached. */
const OPENFREEMAP_STYLE = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
  sources: {
    openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f8f4f0' } },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': '#9ec8e0', 'fill-opacity': 0.8 } },
    { id: 'place-label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'text-field': ['get', 'name'] } },
  ],
}
const OPENFREEMAP_LAYER_IDS = ['ofm:background', 'ofm:water', 'ofm:place-label']

const styleFetch = vi.fn(async (_url: string | URL | Request) => new Response(
  JSON.stringify(OPENFREEMAP_STYLE),
  { status: 200, headers: { 'content-type': 'application/json' } },
))

function background(
  basemap: Partial<MapBackgroundPresentation['basemap']> = {},
  satellite: Partial<MapBackgroundPresentation['satellite']> = {},
  locale = 'en',
): MapBackgroundPresentation {
  return {
    basemap: { style: 'liberty', visible: false, opacity: 0.4, ...basemap },
    satellite: { visible: false, opacity: 0.4, ...satellite },
    locale,
  }
}

/** Keyless Google imagery is ready synchronously, so the band lands at admission. */
function satelliteOn(opacity = 0.4): MapBackgroundPresentation {
  return background({}, { visible: true, opacity })
}

function hidden(opacity = 0.4): MapBackgroundPresentation {
  return background({ opacity }, { opacity })
}

function basemapOn(
  basemap: Partial<MapBackgroundPresentation['basemap']> = {},
  locale = 'en',
): MapBackgroundPresentation {
  return background({ visible: true, ...basemap }, {}, locale)
}

function hasOpenFreeMapBasemap(map: FakeMap): boolean {
  return OPENFREEMAP_LAYER_IDS.every((id) => map.getLayer(id) !== undefined)
    && map.getSource('ofm-openmaptiles') !== undefined
}

function hasAnyOpenFreeMapLayer(map: FakeMap): boolean {
  return [...map.layers.keys()].some((id) => id.startsWith('ofm:'))
    || [...map.sources.keys()].some((id) => id.startsWith('ofm-'))
}

function createControls(options: {
  contributions?: ConstructorParameters<typeof WorkspaceMapControls>[0]['contributions']
  background?: MapBackgroundPresentation
  logError?: (message?: unknown, ...optionalParams: unknown[]) => void
  load?: () => Promise<MapLibreApi>
  webgl2?: WebGL2RenderingContext | null
  canCreateWebGL2Context?: () => boolean
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
    initialCenter: { lat: 48.86, lon: 2.35 },
    background: options.background ?? satelliteOn(),
  }
  const controls = new TestWorkspaceMapControls({
    container: document.createElement('div'),
    surface,
    contributions: options.contributions,
    ...(options.logError ? { logError: options.logError } : {}),
    canCreateWebGL2Context: options.canCreateWebGL2Context ?? (() => true),
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
    overlays: { runtime: { getSceneSnapshot: () => scene }, location: { lat: 48, lon: 2 }, hoveredTargets: [{ kind: 'zone', zone_name: 'plot' }], selectedTargets: [] },
    frame: null,
  }
}

beforeEach(() => {
  styleFetch.mockClear()
  vi.stubGlobal('fetch', styleFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WorkspaceMapControls', () => {
  it('acceptance: repeated Satellite hide/show releases mount-owned movement listeners', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    const admitted = await acquisition
    try {
      expect(map.getSource(MAPLIBRE_SATELLITE_SOURCE_ID)).toBeDefined()
      const initial = map.listeners.get('moveend')?.size ?? 0
      expect(initial).toBeGreaterThan(0)
      for (let i = 0; i < 3; i++) {
        controls.updateBackgroundPresentation(hidden())
        expect(map.getSource(MAPLIBRE_SATELLITE_SOURCE_ID)).toBeUndefined()
        controls.updateBackgroundPresentation(satelliteOn())
        expect(map.getSource(MAPLIBRE_SATELLITE_SOURCE_ID)).toBeDefined()
      }
      expect(map.listeners.get('moveend')?.size).toBe(initial)
    } finally { controls.releaseMap(admitted) }
    expect(map.listeners.get('moveend')?.size ?? 0).toBe(0)
  })

  it('acceptance: workspace leaves attribution control ownership to the background mount', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    const admitted = await acquisition
    try {
      expect(map.getSource(MAPLIBRE_SATELLITE_SOURCE_ID)).toBeDefined()
      expect(map.options.attributionControl).toBe(false)
      // One compact control, owned by the background band, at any time.
      const attribution = () => {
        expect(map.controls.size).toBe(1)
        const [control] = [...map.controls]
        expect(control).toBeInstanceOf(FakeAttributionControl)
        return control as FakeAttributionControl
      }
      expect(attribution().options?.compact).toBe(true)
      expect(attribution().options?.customAttribution).toBe('&copy; Google')
      expect(map.addControl).toHaveBeenLastCalledWith(attribution(), 'bottom-right')

      controls.updateBackgroundPresentation(hidden())
      expect(attribution().options?.customAttribution).toBeUndefined()
      controls.updateBackgroundPresentation(satelliteOn())
      expect(attribution().options?.customAttribution).toBe('&copy; Google')
    } finally { controls.releaseMap(admitted) }
    expect(map.controls.size).toBe(0)
  })

  it('requests antialiasing before the shared workspace creates its WebGL context', async () => {
    const { controls, maps } = createControls({ background: hidden() })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    const admitted = await acquisition

    try {
      expect(map.options.canvasContextAttributes).toEqual({ antialias: true })
    } finally {
      controls.releaseMap(admitted)
    }
  })

  it('configures the production map shell for zoom 27 and one world', async () => {
    const { controls, maps } = createControls({ background: hidden() })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    const admitted = await acquisition

    try {
      expect(map.options).toMatchObject({
        minZoom: 0,
        maxZoom: 27,
        renderWorldCopies: false,
        interactive: false,
      })
    } finally {
      controls.releaseMap(admitted)
    }
  })

  // Raster rollback belongs to the upstream renderer adapter; terrain keeps
  // the synchronous rollback contract here.
  it.each([
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
    const partialLayer = 'hillshade-layer'
    const partialSource = 'terrain-dem'
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
      lidar: [],
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
      lidar: [],
      terrain: { contourIntervalMeters: 1, contoursVisible: false, contoursOpacity: 1, hillshadeVisible: false, hillshadeOpacity: 1, isDark: false },
      overlays: { runtime: null, location: null, hoveredTargets: [], selectedTargets: [] },
      frame: null,
    }
    controls.updateMapContributions(input)
    const map = await waitForMap(maps)
    map.emit('style.load')
    const admitted = await acquisition
    const scene = { id: MAPLIBRE_SHARED_SCENE_LAYER_ID, type: 'custom' }
    map.addLayer(scene)
    controls.installStyleRestorer(admitted, () => map.addLayer(scene))
    controls.updateMapContributions({ ...input })
    expect(maps).toHaveLength(1)
    map.clearStyle()
    map.emit('style.load')
    expect(map.getLayersOrder()).toEqual([MAPLIBRE_SATELLITE_LAYER_ID, MAPLIBRE_SHARED_SCENE_LAYER_ID])
    expect(map.setPaintProperty).toHaveBeenLastCalledWith(MAPLIBRE_SATELLITE_LAYER_ID, 'raster-opacity', 0.4)
    map.remove.mockImplementation(() => {
      expect([...map.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true)
      expect(bounds).toHaveBeenLastCalledWith(null)
      expect(diagnostics).toHaveBeenLastCalledWith(null)
      expect(states.mock.lastCall?.[0].status).toBe('idle')
    })
    controls.releaseMap(admitted)
    controls.releaseMap(admitted)
    expect(map.remove).toHaveBeenCalledOnce()
    expect(observers[0]?.disconnect).toHaveBeenCalledOnce()
  })

  it('does not add a remote source for hidden background presentation', async () => {
    const { controls, maps } = createControls({ background: hidden() })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)

    map.emit('style.load')
    await expect(acquisition).resolves.toBe(map)
    await Promise.resolve()
    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.addLayer).not.toHaveBeenCalled()
    expect(styleFetch).not.toHaveBeenCalled()
    expect(map.setStyle).not.toHaveBeenCalled()
    expect(JSON.stringify(map.options.style)).not.toContain('openfreemap')
    expect(JSON.stringify(map.options.style)).not.toContain('google.com')
  })

  it('adds the visible contribution at style admission without waiting for tile events', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)

    map.emit('style.load')
    await expect(acquisition).resolves.toBe(map)

    expect(map.addSource).toHaveBeenCalledWith(MAPLIBRE_SATELLITE_SOURCE_ID, expect.objectContaining({
      type: 'raster',
      tiles: [GOOGLE_KEYLESS_TILES],
    }))
    // Nothing Canopi-owned is above it yet, so it is appended without an anchor.
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: MAPLIBRE_SATELLITE_LAYER_ID,
      source: MAPLIBRE_SATELLITE_SOURCE_ID,
    }), undefined)
    expect(styleFetch).not.toHaveBeenCalled()
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      MAPLIBRE_SATELLITE_LAYER_ID,
      'raster-opacity',
      0.4,
    )
  })

  it('applies opacity-only presentation updates without recreating the Satellite contribution', async () => {
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

    controls.updateBackgroundPresentation(satelliteOn(0.75))

    expect(map.setPaintProperty).toHaveBeenCalledWith(
      MAPLIBRE_SATELLITE_LAYER_ID,
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
    async (opacity) => {
      const { controls, maps } = createControls()
      const acquisition = controls.createMap(new AbortController().signal)
      const map = await waitForMap(maps)
      map.emit('style.load')
      await acquisition
      map.setPaintProperty.mockClear()

      controls.updateBackgroundPresentation(satelliteOn(opacity))

      expect(map.setPaintProperty).toHaveBeenCalledWith(
        MAPLIBRE_SATELLITE_LAYER_ID,
        'raster-opacity',
        0,
      )
    },
  )

  it('removes before source removal, retains hidden presentation, and restores the latest visible one', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition

    controls.updateBackgroundPresentation(hidden(1.2))
    expect(map.removeLayer.mock.invocationCallOrder[0]).toBeLessThan(
      map.removeSource.mock.invocationCallOrder[0]!,
    )
    const sourceCountWhileHidden = map.addSource.mock.calls.length
    controls.updateBackgroundPresentation(hidden(0.2))
    expect(map.addSource).toHaveBeenCalledTimes(sourceCountWhileHidden)

    controls.updateBackgroundPresentation(satelliteOn(2))
    expect(map.addSource).toHaveBeenLastCalledWith(
      MAPLIBRE_SATELLITE_SOURCE_ID,
      expect.objectContaining({ tiles: [GOOGLE_KEYLESS_TILES] }),
    )
    expect(map.setPaintProperty).toHaveBeenLastCalledWith(
      MAPLIBRE_SATELLITE_LAYER_ID,
      'raster-opacity',
      1,
    )
  })

  it('retains the latest presentation during acquisition before style admission', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    controls.updateBackgroundPresentation(hidden(0.1))

    map.emit('style.load')
    await acquisition
    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.addLayer).not.toHaveBeenCalled()
  })

  it('adds Satellite imagery when a hidden attempt receives a visible presentation update', async () => {
    const { controls, maps } = createControls({ background: hidden() })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    expect(map.addSource).not.toHaveBeenCalled()

    controls.updateBackgroundPresentation(satelliteOn(0.8))

    expect(map.addSource).toHaveBeenCalledWith(MAPLIBRE_SATELLITE_SOURCE_ID, expect.objectContaining({ type: 'raster' }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: MAPLIBRE_SATELLITE_LAYER_ID }), undefined)
  })

  it('hides and restores only the Satellite imagery while preserving local contribution identities and order', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    const backgroundLayer = { id: MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID }
    const lidarSource = { type: 'raster', tiles: ['lidar'] }
    const referenceSource = { type: 'geojson' }
    const lidar = { id: 'lidar-layer', source: 'lidar-source' }
    const reference = { id: 'reference-layer', source: 'reference-source' }
    const scene = { id: MAPLIBRE_SHARED_SCENE_LAYER_ID }
    map.addLayer(backgroundLayer)
    map.layerOrder.splice(0, map.layerOrder.length,
      MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
      MAPLIBRE_SATELLITE_LAYER_ID,
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
    const expectLocalContributions = () => {
      expect(map.getSource('lidar-source')).toBe(lidarSource)
      expect(map.getSource('reference-source')).toBe(referenceSource)
      expect(map.getLayer('lidar-layer')).toBe(lidar)
      expect(map.getLayer('reference-layer')).toBe(reference)
      expect(map.getLayer(MAPLIBRE_SHARED_SCENE_LAYER_ID)).toBe(scene)
    }

    controls.updateBackgroundPresentation(hidden(0.6))

    expect(map.removeLayer).toHaveBeenCalledExactlyOnceWith(MAPLIBRE_SATELLITE_LAYER_ID)
    expect(map.removeSource).toHaveBeenCalledExactlyOnceWith(MAPLIBRE_SATELLITE_SOURCE_ID)
    expectLocalContributions()
    expect(map.layerOrder).toEqual([
      MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
      'lidar-layer',
      'reference-layer',
      MAPLIBRE_SHARED_SCENE_LAYER_ID,
    ])

    controls.updateBackgroundPresentation(satelliteOn(0.6))

    expectLocalContributions()
    expect(map.layerOrder).toEqual([
      MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
      MAPLIBRE_SATELLITE_LAYER_ID,
      'lidar-layer',
      'reference-layer',
      MAPLIBRE_SHARED_SCENE_LAYER_ID,
    ])

    controls.updateBackgroundPresentation(hidden(0.6))
    controls.updateBackgroundPresentation(satelliteOn(0.6))

    expectLocalContributions()
    expect(map.removeLayer.mock.calls).toEqual([
      [MAPLIBRE_SATELLITE_LAYER_ID],
      [MAPLIBRE_SATELLITE_LAYER_ID],
    ])
    expect(map.removeSource.mock.calls).toEqual([
      [MAPLIBRE_SATELLITE_SOURCE_ID],
      [MAPLIBRE_SATELLITE_SOURCE_ID],
    ])
    expect(map.layerOrder).toEqual([
      MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
      MAPLIBRE_SATELLITE_LAYER_ID,
      'lidar-layer',
      'reference-layer',
      MAPLIBRE_SHARED_SCENE_LAYER_ID,
    ])
  })

  it('binds map construction and later style restoration to each attempt snapshot', async () => {
    const { controls, maps } = createControls()
    const snapshotA: WorkspaceMapSnapshot = {
      initialCenter: { lat: 10, lon: 20 },
      background: satelliteOn(0.2),
    }
    const snapshotB: WorkspaceMapSnapshot = {
      initialCenter: { lat: -40, lon: 70 },
      background: satelliteOn(0.8),
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
    const mapAPaintBeforeReload = mapA.setPaintProperty.mock.calls.length
    const mapBPaintBeforeReload = mapB.setPaintProperty.mock.calls.length

    mapA.clearStyle()
    mapA.emit('style.load')
    mapB.clearStyle()
    mapB.emit('style.load')

    expect(mapA.options.center).toEqual([20, 10])
    expect(mapA.options.bearing).toBe(0)
    // The released first attempt ignores its later style reload.
    expect(mapA.setPaintProperty).toHaveBeenCalledTimes(mapAPaintBeforeReload)
    expect(mapA.setPaintProperty).toHaveBeenLastCalledWith(
      MAPLIBRE_SATELLITE_LAYER_ID,
      'raster-opacity',
      0.2,
    )
    expect(mapA.getSource(MAPLIBRE_SATELLITE_SOURCE_ID)).toBeUndefined()
    expect(mapB.options.center).toEqual([70, -40])
    expect(mapB.options.bearing).toBe(0)
    expect(mapB.setPaintProperty.mock.calls.length).toBeGreaterThan(mapBPaintBeforeReload)
    expect(mapB.setPaintProperty).toHaveBeenLastCalledWith(
      MAPLIBRE_SATELLITE_LAYER_ID,
      'raster-opacity',
      0.8,
    )
    expect(mapB.getSource(MAPLIBRE_SATELLITE_SOURCE_ID)).toBeDefined()
  })

  it('owns the call-time map snapshot through admission and later style reload', async () => {
    const { controls, maps } = createControls()
    const snapshot: WorkspaceMapSnapshot = {
      initialCenter: { lat: 11, lon: 22 },
      background: satelliteOn(0.25),
    }
    const acquisition = controls.createMap(new AbortController().signal, snapshot)
    const map = await waitForMap(maps)

    ;(snapshot.initialCenter as { lat: number; lon: number }).lat = 81
    ;(snapshot.initialCenter as { lat: number; lon: number }).lon = 82
    ;(snapshot.background.satellite as { visible: boolean }).visible = false
    ;(snapshot.background.satellite as { opacity: number }).opacity = 0.95
    ;(snapshot.background.basemap as { visible: boolean }).visible = true

    map.emit('style.load')
    await acquisition
    controls.installStyleRestorer(map as never, vi.fn())

    expect(map.options.center).toEqual([22, 11])
    expect(map.options.bearing).toBe(0)
    expect(map.addSource).toHaveBeenCalledWith(
      MAPLIBRE_SATELLITE_SOURCE_ID,
      expect.objectContaining({ tiles: [GOOGLE_KEYLESS_TILES] }),
    )
    expect(map.setPaintProperty).toHaveBeenLastCalledWith(
      MAPLIBRE_SATELLITE_LAYER_ID,
      'raster-opacity',
      0.25,
    )

    map.clearStyle()
    map.emit('style.load')

    expect(map.addSource).toHaveBeenCalledTimes(2)
    expect(map.addSource).toHaveBeenLastCalledWith(
      MAPLIBRE_SATELLITE_SOURCE_ID,
      expect.objectContaining({ tiles: [GOOGLE_KEYLESS_TILES] }),
    )
    expect(map.setPaintProperty).toHaveBeenLastCalledWith(
      MAPLIBRE_SATELLITE_LAYER_ID,
      'raster-opacity',
      0.25,
    )
    expect(styleFetch).not.toHaveBeenCalled()
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
      MAPLIBRE_SATELLITE_LAYER_ID,
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
      MAPLIBRE_SATELLITE_LAYER_ID,
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
      MAPLIBRE_SATELLITE_LAYER_ID,
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

    const paintBeforeReload = map.setPaintProperty.mock.calls.length
    map.clearStyle()
    map.emit('style.load')

    expect(map.addSource).toHaveBeenCalledTimes(2)
    expect(map.setPaintProperty.mock.calls.length).toBeGreaterThan(paintBeforeReload)
    expect(map.setPaintProperty).toHaveBeenLastCalledWith(MAPLIBRE_SATELLITE_LAYER_ID, 'raster-opacity', 0.4)
    expect(restorer).toHaveBeenCalledOnce()
    expect(map.addSource.mock.invocationCallOrder[1]).toBeLessThan(restorer.mock.invocationCallOrder[0]!)
    expect(map.setPaintProperty.mock.invocationCallOrder.at(-1)).toBeLessThan(restorer.mock.invocationCallOrder[0]!)
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

    map.removeLayer(MAPLIBRE_SATELLITE_LAYER_ID)
    map.removeSource(MAPLIBRE_SATELLITE_SOURCE_ID)
    map.emit('style.load')

    expect(map.layerOrder).toEqual([
      MAPLIBRE_SATELLITE_LAYER_ID,
      MAPLIBRE_SHARED_SCENE_LAYER_ID,
    ])
    expect(map.addLayer).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: MAPLIBRE_SATELLITE_LAYER_ID }),
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
    expect(map.getLayer(MAPLIBRE_SATELLITE_LAYER_ID)).toBeDefined()
  })

  it('replays the latest presentation requested reentrantly by a style restorer', async () => {
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    let updateDuringRestore = true
    controls.installStyleRestorer(map as never, () => {
      if (!updateDuringRestore) return
      updateDuringRestore = false
      controls.updateBackgroundPresentation(satelliteOn(0.9))
    })

    map.clearStyle()
    map.emit('style.load')
    await Promise.resolve()

    expect(map.addSource).toHaveBeenLastCalledWith(
      MAPLIBRE_SATELLITE_SOURCE_ID,
      expect.objectContaining({ tiles: [GOOGLE_KEYLESS_TILES] }),
    )
    expect(map.setPaintProperty).toHaveBeenLastCalledWith(
      MAPLIBRE_SATELLITE_LAYER_ID,
      'raster-opacity',
      0.9,
    )
  })

  it('serializes reentrant presentation and style signals from a live Satellite withdrawal', async () => {
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
      if (id !== MAPLIBRE_SATELLITE_LAYER_ID || reentered) return
      reentered = true
      removalDepth += 1
      controls.updateBackgroundPresentation(satelliteOn(0.9))
      map.emit('style.load')
      removalDepth -= 1
    })
    map.addSource.mockImplementation((id: string, source: unknown) => {
      sourceMutationDepths.push(removalDepth)
      map.sources.set(id, source)
    })

    controls.updateBackgroundPresentation(hidden(0.3))

    expect(sourceMutationDepths.length).toBeGreaterThan(0)
    expect(sourceMutationDepths.every((depth) => depth === 0)).toBe(true)
    expect(map.addSource).toHaveBeenLastCalledWith(
      MAPLIBRE_SATELLITE_SOURCE_ID,
      expect.objectContaining({ tiles: [GOOGLE_KEYLESS_TILES] }),
    )
    expect(map.getLayer(MAPLIBRE_SATELLITE_LAYER_ID)).toBeDefined()
    expect(map.setPaintProperty).toHaveBeenLastCalledWith(
      MAPLIBRE_SATELLITE_LAYER_ID,
      'raster-opacity',
      0.9,
    )
    expect(restorer).toHaveBeenCalledOnce()
  })

  it('does not restore a remote background for hidden presentation', async () => {
    const { controls, maps } = createControls({ background: hidden() })
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
    await vi.waitFor(() => expect(reportFailure).toHaveBeenCalledWith(failure))
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
    await vi.waitFor(() => expect(reportFailure).toHaveBeenCalledWith(failure))
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

    controls.updateBackgroundPresentation(satelliteOn(0.6))
    controls.updateBackgroundPresentation(satelliteOn(0.7))
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
    await vi.waitFor(() => expect(reportFailure).toHaveBeenCalledWith(failure))
  })

  it('treats a synchronous source event as passive after the local style is admitted', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { controls, maps } = createControls()
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    const error = new Error('tile request failed immediately')
    const event = { sourceId: MAPLIBRE_SATELLITE_SOURCE_ID, error }
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
      canCreateWebGL2Context: () => true,
    })
    await expect(controls.createMap(new AbortController().signal, {
      initialCenter: { lat: 0, lon: 0 },
      background: satelliteOn(1),
    }, {})).rejects.toBe(error)
  })

  it('rejects unavailable WebGL2 before constructing a MapLibre map', async () => {
    const canCreateWebGL2Context = vi.fn(() => false)
    const { controls, maps, observers } = createControls({ canCreateWebGL2Context })

    await expect(controls.createMap(new AbortController().signal)).rejects.toThrow(
      'WebGL2 is unavailable',
    )

    expect(canCreateWebGL2Context).toHaveBeenCalledOnce()
    expect(maps).toEqual([])
    expect(observers).toEqual([])
  })

  it('publishes the map-unavailable error state when WebGL2 is unavailable', async () => {
    const states = vi.fn()
    const { controls, maps } = createControls({
      canCreateWebGL2Context: () => false,
      contributions: { onStateChange: states },
    })

    await expect(controls.createMap(new AbortController().signal)).rejects.toThrow('WebGL2 is unavailable')

    expect(maps).toEqual([])
    expect(states).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      status: 'error',
      errorMessage: expect.stringContaining('WebGL2 is unavailable'),
    }))
  })

  it('does not ask a browser without the WebGL2 interface to create a context', async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    const loadMapLibre = vi.fn<() => Promise<MapLibreApi>>()
    const surface = createMapLibreSurfaceAdapter({ loadMapLibre })
    vi.stubGlobal('WebGL2RenderingContext', undefined)
    try {
      const controls = new WorkspaceMapControls({
        container: document.createElement('div'),
        surface,
      })

      await expect(controls.createMap(new AbortController().signal, {
        initialCenter: { lat: 0, lon: 0 },
        background: satelliteOn(1),
      }, {})).rejects.toThrow('WebGL2 is unavailable')

      expect(getContext).not.toHaveBeenCalled()
      expect(loadMapLibre).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      getContext.mockRestore()
    }
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
      sourceId: MAPLIBRE_SATELLITE_SOURCE_ID,
      error: new Error('tile unavailable'),
    }
    map.emit('error', event)
    expect(map.remove).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith('Passive MapLibre workspace basemap error:', event)
    logError.mockRestore()
  })

  it('ignores passive OpenFreeMap source errors after style admission', async () => {
    const logError = vi.fn()
    const { controls, maps } = createControls({ logError })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    const reportFailure = vi.fn()
    controls.watchFailure(map as never, reportFailure)

    const event = { sourceId: 'ofm-openmaptiles', error: new Error('vector tile unavailable') }
    map.emit('error', event)

    expect(map.remove).not.toHaveBeenCalled()
    expect(reportFailure).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith('Passive MapLibre workspace basemap error:', event)
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

    controls.updateBackgroundPresentation(basemapOn({ opacity: 0 }))
    await Promise.resolve()

    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.addLayer).not.toHaveBeenCalled()
    expect(map.setPaintProperty).not.toHaveBeenCalled()
    expect(styleFetch).not.toHaveBeenCalled()
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

describe('WorkspaceMapControls OpenFreeMap basemap', () => {
  it('installs the OpenFreeMap basemap without setStyle and below Canopi layers', async () => {
    const { controls, maps } = createControls({ background: basemapOn({ style: 'bright', opacity: 0.5 }, 'fr') })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    map.addLayer({ id: MAPLIBRE_SHARED_SCENE_LAYER_ID })

    await vi.waitFor(() => expect(hasOpenFreeMapBasemap(map)).toBe(true))

    expect(map.setStyle).not.toHaveBeenCalled()
    expect(styleFetch).toHaveBeenCalledWith(OPENFREEMAP_BASEMAPS.bright.styleUrl)
    expect(map.setGlyphs).toHaveBeenCalledWith(OPENFREEMAP_STYLE.glyphs)
    expect(map.setSprite).toHaveBeenCalledWith(OPENFREEMAP_STYLE.sprite)
    expect(map.getSource('ofm-openmaptiles')).toEqual(OPENFREEMAP_STYLE.sources.openmaptiles)
    expect(map.getLayer('ofm:water')).toMatchObject({
      source: 'ofm-openmaptiles',
      paint: { 'fill-opacity': 0.4 },
    })
    expect(map.getLayer('ofm:place-label')).toMatchObject({
      layout: { 'text-field': ['coalesce', ['get', 'name:fr'], ['get', 'name']] },
    })
    expect(map.layerOrder).toEqual([...OPENFREEMAP_LAYER_IDS, MAPLIBRE_SHARED_SCENE_LAYER_ID])
    expect(map.getSource(MAPLIBRE_SATELLITE_SOURCE_ID)).toBeUndefined()
  })

  it('installs Satellite imagery in place of the basemap and restores the basemap when Satellite is off', async () => {
    const { controls, maps } = createControls({ background: basemapOn() })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    await vi.waitFor(() => expect(hasOpenFreeMapBasemap(map)).toBe(true))

    controls.updateBackgroundPresentation(background({ visible: true }, { visible: true, opacity: 0.7 }))

    expect(hasAnyOpenFreeMapLayer(map)).toBe(false)
    expect(map.getSource(MAPLIBRE_SATELLITE_SOURCE_ID)).toMatchObject({ tiles: [GOOGLE_KEYLESS_TILES] })
    expect(map.getLayer(MAPLIBRE_SATELLITE_LAYER_ID)).toBeDefined()
    expect(map.setPaintProperty).toHaveBeenLastCalledWith(MAPLIBRE_SATELLITE_LAYER_ID, 'raster-opacity', 0.7)

    controls.updateBackgroundPresentation(basemapOn())

    expect(map.getSource(MAPLIBRE_SATELLITE_SOURCE_ID)).toBeUndefined()
    expect(map.getLayer(MAPLIBRE_SATELLITE_LAYER_ID)).toBeUndefined()
    await vi.waitFor(() => expect(hasOpenFreeMapBasemap(map)).toBe(true))
    expect(map.setStyle).not.toHaveBeenCalled()
  })

  it('reinstalls the basemap after a same-map style reload', async () => {
    const { controls, maps } = createControls({ background: basemapOn() })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    const admitted = await acquisition
    await vi.waitFor(() => expect(hasOpenFreeMapBasemap(map)).toBe(true))
    const restorer = vi.fn()
    controls.installStyleRestorer(admitted, restorer)

    map.clearStyle()
    map.emit('style.load')

    expect(restorer).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(hasOpenFreeMapBasemap(map)).toBe(true))
    expect(maps).toHaveLength(1)
    expect(map.setStyle).not.toHaveBeenCalled()
  })

  it('logs a basemap style failure without failing the workspace map', async () => {
    styleFetch.mockImplementationOnce(async () => new Response('unavailable', { status: 503 }))
    const logError = vi.fn()
    const { controls, maps } = createControls({ background: basemapOn({ style: 'dark' }), logError })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    const admitted = await acquisition
    const reportFailure = vi.fn()
    controls.watchFailure(admitted, reportFailure)

    await vi.waitFor(() => expect(logError).toHaveBeenCalledWith(
      'Map basemap style failed to load:',
      expect.objectContaining({ message: expect.stringContaining('503') }),
    ))
    expect(hasAnyOpenFreeMapLayer(map)).toBe(false)
    expect(reportFailure).not.toHaveBeenCalled()
    expect(map.remove).not.toHaveBeenCalled()
  })

  it('never installs a basemap that finishes loading after the map is released', async () => {
    let resolveStyle!: (response: Response) => void
    styleFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveStyle = resolve }))
    const { controls, maps } = createControls({ background: basemapOn({ style: 'positron' }) })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    const admitted = await acquisition
    await vi.waitFor(() => expect(styleFetch).toHaveBeenCalledWith(OPENFREEMAP_BASEMAPS.positron.styleUrl))

    controls.releaseMap(admitted)
    resolveStyle(new Response(JSON.stringify(OPENFREEMAP_STYLE), { status: 200 }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(hasAnyOpenFreeMapLayer(map)).toBe(false)
    expect(map.remove).toHaveBeenCalledOnce()
  })
})

describe('WorkspaceMapControls Google satellite', () => {
  /**
   * The canvas previously built a static imagery contribution, which cannot
   * serve the official Google path: that path needs a session acquired per
   * generation and an authenticated tile request. The defect this pins is that
   * a configured key was silently ignored on the main Canvas.
   */
  it('follows the official Google session path when a device key is configured', async () => {
    const calls: Array<{ url: string; method?: string }> = []
    vi.stubGlobal('fetch', (async (url: string, init?: { method?: string }) => {
      calls.push({ url: String(url), method: init?.method })
      if (String(url).includes('createSession')) {
        return new Response(JSON.stringify({
          session: 'fake-session-token',
          expiry: '4000000000',
          tileWidth: 512,
          tileHeight: 512,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        copyright: 'Imagery ©2026 Google',
        maxZoomRects: [{ north: 90, south: -90, east: 180, west: -180, maxZoom: 20 }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch)
    const { googleMapsApiKey } = await import('../../app/settings/state')
    googleMapsApiKey.value = 'fake-canvas-google-key'

    try {
      const { controls, maps } = createControls()
      const acquisition = controls.createMap(new AbortController().signal, {
        initialCenter: { lat: 48.86, lon: 2.35 },
        background: background({ visible: true }, { visible: true, opacity: 0.8 }),
      })
      const map = await waitForMap(maps)
      map.emit('style.load')
      await acquisition

      await vi.waitFor(() => expect(map.addSource).toHaveBeenCalled())
      // The published template is credential-free and unresolved: the transport
      // supplies the session for this fixed endpoint.
      expect(map.addSource).toHaveBeenLastCalledWith(
        MAPLIBRE_SATELLITE_SOURCE_ID,
        expect.objectContaining({ tiles: [GOOGLE_SESSION_TILES] }),
      )
      // The keyless endpoint would mean the configured key was silently
      // ignored, and the key itself never enters map state.
      expect(JSON.stringify([...map.sources.entries()])).not.toContain('mt1.google.com')
      expect(JSON.stringify([...map.sources.entries()])).not.toContain('fake-canvas-google-key')
      expect(JSON.stringify([...map.layers.entries()])).not.toContain('fake-canvas-google-key')
      // Satellite on hides the Basemap, so no basemap style is requested.
      expect(calls.some((call) => call.url.includes('openfreemap'))).toBe(false)

      // The request the map would make carries the live session and the key.
      const transform = map.options.transformRequest
      expect(transform, 'the canvas map must be created with the request seam').toBeTypeOf('function')
      const outgoing = transform!(
        (map.sources.get(MAPLIBRE_SATELLITE_SOURCE_ID) as { tiles: string[] }).tiles[0]!
          .split('{z}').join('14').split('{x}').join('8192').split('{y}').join('5461'),
      )
      expect(outgoing.url).toContain('session=fake-session-token')
      expect(outgoing.url).toContain('key=fake-canvas-google-key')
      expect(outgoing.url).not.toContain('{session}')

      // The session request is authenticated too, and the viewport metadata
      // established the attribution the layer shows.
      expect(calls[0]?.url).toContain('createSession')
      expect(calls[0]?.url).toContain('fake-canvas-google-key')
      expect(calls.some((call) => call.url.includes('/viewport'))).toBe(true)
      // The viewport copyright is shown by the map's one attribution control.
      const attributions = [...map.controls] as FakeAttributionControl[]
      expect(attributions).toHaveLength(1)
      expect(attributions[0]?.options?.customAttribution).toBe('Imagery ©2026 Google')
      expect(JSON.stringify(attributions[0]?.options)).not.toContain('fake-canvas-google-key')
    } finally {
      googleMapsApiKey.value = null
    }
  })

  it('shows Google keyless imagery without a session request when no key is set', async () => {
    const { googleMapsApiKey } = await import('../../app/settings/state')
    googleMapsApiKey.value = null
    const { controls, maps } = createControls({
      background: background({}, { visible: true }),
    })
    const acquisition = controls.createMap(new AbortController().signal)
    const map = await waitForMap(maps)
    map.emit('style.load')
    await acquisition
    await Promise.resolve()

    expect(map.getSource(MAPLIBRE_SATELLITE_SOURCE_ID)).toMatchObject({ tiles: [GOOGLE_KEYLESS_TILES] })
    expect(map.getLayer(MAPLIBRE_SATELLITE_LAYER_ID)).toBeDefined()
    expect(styleFetch).not.toHaveBeenCalled()
    expect(map.remove).not.toHaveBeenCalled()
  })

  it('replaces keyless tiles with official session tiles when a key is saved on a live map', async () => {
    vi.stubGlobal('fetch', (async (url: string) => {
      if (String(url).includes('createSession')) {
        return new Response(JSON.stringify({
          session: 'fake-session-token',
          expiry: '4000000000',
          tileWidth: 256,
          tileHeight: 256,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        copyright: 'Imagery ©2026 Google',
        maxZoomRects: [{ north: 90, south: -90, east: 180, west: -180, maxZoom: 20 }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch)
    const { googleMapsApiKey } = await import('../../app/settings/state')
    googleMapsApiKey.value = null
    try {
      const { controls, maps } = createControls()
      const acquisition = controls.createMap(new AbortController().signal)
      const map = await waitForMap(maps)
      map.emit('style.load')
      await acquisition
      expect(map.getSource(MAPLIBRE_SATELLITE_SOURCE_ID)).toMatchObject({ tiles: [GOOGLE_KEYLESS_TILES] })

      googleMapsApiKey.value = 'fake-canvas-google-key'

      await vi.waitFor(() => expect(map.getSource(MAPLIBRE_SATELLITE_SOURCE_ID))
        .toMatchObject({ tiles: [GOOGLE_SESSION_TILES] }))
      expect(JSON.stringify([...map.sources.entries()])).not.toContain('fake-canvas-google-key')
      expect(map.setStyle).not.toHaveBeenCalled()
      expect(map.remove).not.toHaveBeenCalled()
    } finally {
      googleMapsApiKey.value = null
    }
  })
})
