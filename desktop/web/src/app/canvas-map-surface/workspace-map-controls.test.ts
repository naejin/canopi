import { describe, expect, it, vi } from 'vitest'
import { createMapLibreSurfaceAdapter } from '../../maplibre/surface-adapter'
import type {
  MapLibreApi,
  MapLibreMapConstructorOptions,
  MapLibreMapInstance,
} from '../../maplibre/loader'
import {
  MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
  MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
  MAPLIBRE_BASEMAP_SOURCE_ID,
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
  const controls = new WorkspaceMapControls({
    container: document.createElement('div'),
    surface,
    snapshot: {
      anchor: { lat: 48.86, lon: 2.35 }, northBearingDeg: 12,
      placementStatus: options.placementStatus ?? 'confirmed',
      basemapStyle: 'street', basemapVisible: options.basemapVisible ?? true, basemapOpacity: 0.4,
    },
  })
  return { controls, maps, observers }
}

async function waitForMap(maps: FakeMap[]): Promise<FakeMap> {
  await vi.waitFor(() => expect(maps).toHaveLength(1))
  return maps[0]!
}

describe('WorkspaceMapControls', () => {
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
      snapshot: {
        anchor: { lat: 0, lon: 0 }, northBearingDeg: 0, placementStatus: 'confirmed',
        basemapStyle: 'street', basemapVisible: true, basemapOpacity: 1,
      },
    })
    await expect(controls.createMap(new AbortController().signal)).rejects.toBe(error)
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
    expect(reportFailure).toHaveBeenCalledTimes(2)
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
