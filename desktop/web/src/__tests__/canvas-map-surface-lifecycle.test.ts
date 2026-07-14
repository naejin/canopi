import { signal } from '@preact/signals'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCanvasMapSurfaceLifecycle,
  type CanvasMapSurfaceSnapshot,
} from '../app/canvas-map-surface/lifecycle'
import type { CanvasQuerySurface } from '../canvas/runtime/runtime'
import { createDefaultScenePersistedState, type ScenePersistedState } from '../canvas/runtime/scene'
import type {
  MapLibreApi,
  MapLibreMapConstructorOptions,
  MapLibreMapInstance,
} from '../maplibre/loader'
import { MAPLIBRE_BASEMAP_SOURCE_ID, MAPLIBRE_BASEMAP_RASTER_LAYER_ID } from '../maplibre/config'
import {
  TERRAIN_CONTOUR_LAYER_IDS,
  TERRAIN_CONTOUR_SOURCE_ID,
  type TerrainProtocolSupport,
} from '../maplibre/terrain'
import type { MapLibreCanvasSurfaceState } from '../maplibre/canvas-surface-state'

type MapEventType = 'load' | 'error' | 'sourcedata'
type MapEventHandler = (event?: unknown) => void

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

class FakeMap implements MapLibreMapInstance {
  readonly options: MapLibreMapConstructorOptions
  readonly jumpTo = vi.fn()
  readonly resize = vi.fn()
  readonly remove = vi.fn()
  readonly on = vi.fn((type: MapEventType, listener: MapEventHandler) => {
    this.handlers.get(type)?.add(listener)
  })
  readonly off = vi.fn((type: MapEventType, listener: MapEventHandler) => {
    this.handlers.get(type)?.delete(listener)
  })
  readonly loaded = vi.fn(() => this.loadedValue)
  readonly isStyleLoaded = vi.fn(() => this.styleLoaded)
  readonly isSourceLoaded = vi.fn((id: string) => this.loadedSourceIds.has(id))
  readonly addSource = vi.fn((id: string, source: Record<string, unknown>) => {
    this.sources.set(id, { source, setData: vi.fn() })
  })
  readonly getSource = vi.fn((id: string) => this.sources.get(id))
  readonly removeSource = vi.fn((id: string) => {
    this.sources.delete(id)
  })
  readonly addLayer = vi.fn((layer: Record<string, unknown>) => {
    const id = typeof layer.id === 'string' ? layer.id : ''
    if (id) this.layers.add(id)
  })
  readonly setPaintProperty = vi.fn()
  readonly getLayer = vi.fn((id: string) => (this.layers.has(id) ? { id } : undefined))
  readonly removeLayer = vi.fn((id: string) => {
    this.layers.delete(id)
  })

  loadedValue = true
  styleLoaded = true
  readonly loadedSourceIds = new Set<string>([MAPLIBRE_BASEMAP_SOURCE_ID])
  readonly sources = new Map<string, { source: Record<string, unknown>; setData(data: unknown): void }>()
  readonly layers = new Set<string>()
  private readonly handlers = new Map<MapEventType, Set<MapEventHandler>>([
    ['load', new Set()],
    ['error', new Set()],
    ['sourcedata', new Set()],
  ])

  constructor(options: MapLibreMapConstructorOptions) {
    this.options = options
  }

  emit(type: MapEventType, event?: unknown): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(event)
    }
  }
}

class FakeResizeObserver {
  readonly observe = vi.fn()
  readonly disconnect = vi.fn()
  constructor(readonly callback: ResizeObserverCallback) {}

  emit(): void {
    this.callback([], this as unknown as ResizeObserver)
  }
}

function createFakeMapLibreApi(
  maps: FakeMap[],
  configureMap: (map: FakeMap) => void = () => {},
): MapLibreApi {
  class TestMap extends FakeMap {
    constructor(options: MapLibreMapConstructorOptions) {
      super(options)
      configureMap(this)
      maps.push(this)
    }
  }

  return {
    Map: TestMap,
    addProtocol: vi.fn(),
  }
}

function createRuntime(
  scene: ScenePersistedState = createDefaultScenePersistedState(),
  options: {
    viewport?: { x: number; y: number; scale: number }
  } = {},
): CanvasQuerySurface {
  const viewport = options.viewport ?? { x: 0, y: 0, scale: 1 }
  return {
    revision: { scene: signal(0), plantNames: signal(0), viewport: signal(0) },
    getSceneSnapshot: () => scene,
    getViewport: () => viewport,
    getViewportScreenSize: () => ({ width: 400, height: 300 }),
    viewportRevision: signal(0),
    getSelection: () => new Set(),
    getDesignObjectSelection: () => ({
      editableTargets: [],
      lockedTargets: [],
      blockedTargets: [],
      bounds: null,
      sameSpeciesReferenceCanonicalName: null,
    }),
    getSelectedPlantColorContext: () => ({
      plantIds: [],
      singleSpeciesCanonicalName: null,
      singleSpeciesCommonName: null,
      sharedCurrentColor: null,
      suggestedColor: null,
      singleSpeciesDefaultColor: null,
    }),
    getSelectedPlantSymbolContext: () => ({
      plantIds: [],
      singleSpeciesCanonicalName: null,
      singleSpeciesCommonName: null,
      sharedCurrentSymbol: null,
      sharedEffectiveSymbol: 'round',
      inheritedSymbol: null,
      singleSpeciesDefaultSymbol: null,
      canClearSelectedSymbol: false,
    }),
    getPlacedPlants: () => [],
    getSettledPlacedPlants: () => [],
    getLocalizedCommonNames: () => new Map(),
  }
}

const terrainProtocols: TerrainProtocolSupport = {
  sharedDemProtocolUrl: 'canopi-terrain-shared://{z}/{x}/{y}',
  contourProtocolUrl: ({ thresholds }: { thresholds: Record<number, number | number[]> }) =>
    `canopi-terrain-contours://{z}/{x}/{y}?thresholds=${encodeURIComponent(JSON.stringify(thresholds))}`,
}

function createSnapshot(
  overrides: Partial<CanvasMapSurfaceSnapshot> = {},
): CanvasMapSurfaceSnapshot {
  return {
    runtime: createRuntime(),
    location: { lat: 48.8566, lon: 2.3522 },
    northBearingDeg: 12,
    basemapStyle: 'street',
    hasVisibleMapLayer: true,
    layerVisibility: { base: true, contours: false },
    layerOpacity: { base: 0.6, contours: 0.5 },
    terrain: {
      contourIntervalMeters: 0,
      contoursVisible: false,
      contoursOpacity: 0.5,
      hillshadeVisible: false,
      hillshadeOpacity: 0.55,
      isDark: false,
    },
    hoveredTargets: [],
    selectedTargets: [],
    theme: 'light',
    ...overrides,
  }
}

describe('Canvas map surface lifecycle', () => {
  let container: HTMLDivElement
  let maps: FakeMap[]
  let observers: FakeResizeObserver[]
  let maplibre: MapLibreApi
  let configureNextMap: ((map: FakeMap) => void) | null
  let loadMapLibre: ReturnType<typeof vi.fn<() => Promise<MapLibreApi>>>
  let loadTerrainSupport: ReturnType<typeof vi.fn<(api: MapLibreApi) => Promise<TerrainProtocolSupport>>>
  let onStateChange: ReturnType<typeof vi.fn<(state: MapLibreCanvasSurfaceState) => void>>
  let logError: ReturnType<typeof vi.fn<(message?: unknown, ...optionalParams: unknown[]) => void>>

  beforeEach(() => {
    container = document.createElement('div')
    maps = []
    observers = []
    configureNextMap = null
    maplibre = createFakeMapLibreApi(maps, (map) => {
      configureNextMap?.(map)
      configureNextMap = null
    })
    loadMapLibre = vi.fn(async () => maplibre)
    loadTerrainSupport = vi.fn(async () => terrainProtocols)
    onStateChange = vi.fn<(state: MapLibreCanvasSurfaceState) => void>()
    logError = vi.fn<(message?: unknown, ...optionalParams: unknown[]) => void>()
  })

  function createLifecycle() {
    return createCanvasMapSurfaceLifecycle({
      loadMapLibre,
      loadTerrainSupport,
      onStateChange,
      publishDiagnostics: vi.fn(),
      createResizeObserver: (callback) => {
        const observer = new FakeResizeObserver(callback)
        observers.push(observer)
        return observer
      },
      logError,
    })
  }

  function mapAt(index = 0): FakeMap {
    const map = maps[index]
    expect(map).toBeDefined()
    return map!
  }

  function observerAt(index = 0): FakeResizeObserver {
    const observer = observers[index]
    expect(observer).toBeDefined()
    return observer!
  }

  it('creates a map only with a query surface, location, and visible map layer', async () => {
    const lifecycle = createLifecycle()
    lifecycle.attach(container)

    lifecycle.update(createSnapshot({ location: null }))
    await flushPromises()
    expect(maps).toHaveLength(0)

    lifecycle.update(createSnapshot({ runtime: null }))
    await flushPromises()
    expect(maps).toHaveLength(0)

    lifecycle.update(createSnapshot({
      hasVisibleMapLayer: false,
      layerVisibility: { base: false, contours: false },
      terrain: {
        ...createSnapshot().terrain,
        hillshadeVisible: false,
      },
    }))
    await flushPromises()
    expect(maps).toHaveLength(0)

    lifecycle.update(createSnapshot())
    await flushPromises()
    expect(maps).toHaveLength(1)
    expect(mapAt().jumpTo).toHaveBeenCalled()
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }))
  })

  it('applies every lifecycle update as a camera sync through the projection seam', async () => {
    const viewport = { x: 0, y: 0, scale: 1 }
    const runtime = createRuntime(createDefaultScenePersistedState(), { viewport })
    const lifecycle = createLifecycle()
    lifecycle.attach(container)
    lifecycle.update(createSnapshot({ runtime }))
    await flushPromises()

    const map = mapAt()
    const initialJumpCount = map.jumpTo.mock.calls.length
    viewport.x += 0.0625
    viewport.y -= 0.0625
    lifecycle.update(createSnapshot({ runtime }))

    expect(map.jumpTo.mock.calls.length).toBeGreaterThan(initialJumpCount)
  })

  it('waits for the basemap source before publishing ready', async () => {
    configureNextMap = (map) => {
      map.loadedValue = false
      map.loadedSourceIds.clear()
    }
    const lifecycle = createLifecycle()
    lifecycle.attach(container)
    lifecycle.update(createSnapshot())
    await flushPromises()
    const map = mapAt()
    onStateChange.mockClear()

    map.emit('sourcedata', { sourceId: 'other-source' })
    expect(onStateChange).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }))

    map.emit('sourcedata', { sourceId: MAPLIBRE_BASEMAP_SOURCE_ID })
    expect(onStateChange).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }))

    map.loadedSourceIds.add(MAPLIBRE_BASEMAP_SOURCE_ID)
    map.emit('sourcedata', { sourceId: MAPLIBRE_BASEMAP_SOURCE_ID })
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }))
  })

  it('reports errors before ready and only logs errors after ready', async () => {
    configureNextMap = (map) => {
      map.loadedValue = false
      map.loadedSourceIds.clear()
    }
    const lifecycle = createLifecycle()
    lifecycle.attach(container)
    lifecycle.update(createSnapshot())
    await flushPromises()

    const map = mapAt()
    onStateChange.mockClear()
    map.emit('error', new Error('style fetch failed'))
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      errorMessage: 'style fetch failed',
    }))

    const readyLifecycle = createLifecycle()
    readyLifecycle.attach(container)
    readyLifecycle.update(createSnapshot())
    await flushPromises()
    const readyMap = mapAt(1)
    onStateChange.mockClear()
    readyMap.emit('error', new Error('late tile failed'))
    expect(logError).toHaveBeenCalledWith('MapLibre surface error:', expect.any(Error))
    expect(onStateChange).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }))
  })

  it('cancels stale map loads and cleans up map events and resize observation on destroy', async () => {
    const deferredMapLibre = createDeferred<MapLibreApi>()
    loadMapLibre.mockReturnValueOnce(deferredMapLibre.promise)
    const lifecycle = createLifecycle()
    lifecycle.attach(container)
    lifecycle.update(createSnapshot())

    lifecycle.destroy()
    deferredMapLibre.resolve(maplibre)
    await flushPromises()
    expect(maps).toHaveLength(0)

    lifecycle.attach(container)
    lifecycle.update(createSnapshot())
    await flushPromises()
    const map = mapAt()
    expect(observers).toHaveLength(1)
    expect(observerAt().observe).toHaveBeenCalledWith(container)

    observerAt().emit()
    expect(map.resize).toHaveBeenCalled()

    lifecycle.destroy()
    expect(observerAt().disconnect).toHaveBeenCalled()
    expect(map.off).toHaveBeenCalledWith('load', expect.any(Function))
    expect(map.off).toHaveBeenCalledWith('sourcedata', expect.any(Function))
    expect(map.off).toHaveBeenCalledWith('error', expect.any(Function))
    expect(map.remove).toHaveBeenCalled()
  })

  it('rebuilds, paints, and clears terrain without recreating the map', async () => {
    const lifecycle = createLifecycle()
    lifecycle.attach(container)
    lifecycle.update(createSnapshot({
      layerVisibility: { base: true, contours: true },
      terrain: {
        ...createSnapshot().terrain,
        contourIntervalMeters: 10,
        contoursVisible: true,
      },
    }))
    await flushPromises()

    const map = mapAt()
    expect(loadTerrainSupport).toHaveBeenCalledWith(maplibre)
    expect(map.addSource).toHaveBeenCalledWith(TERRAIN_CONTOUR_SOURCE_ID, expect.objectContaining({ type: 'vector' }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: TERRAIN_CONTOUR_LAYER_IDS[0] }))

    map.addSource.mockClear()
    map.addLayer.mockClear()
    map.setPaintProperty.mockClear()
    lifecycle.update(createSnapshot({
      layerVisibility: { base: true, contours: true },
      layerOpacity: { base: 0.6, contours: 0.75 },
      terrain: {
        ...createSnapshot().terrain,
        contourIntervalMeters: 10,
        contoursVisible: true,
        contoursOpacity: 0.75,
      },
    }))
    expect(map.setPaintProperty).toHaveBeenCalledWith(TERRAIN_CONTOUR_LAYER_IDS[0], 'line-opacity', expect.any(Number))
    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.addLayer).not.toHaveBeenCalled()

    lifecycle.update(createSnapshot({
      layerVisibility: { base: true, contours: false },
      terrain: {
        ...createSnapshot().terrain,
        contoursVisible: false,
      },
    }))
    expect(map.removeLayer).toHaveBeenCalledWith(TERRAIN_CONTOUR_LAYER_IDS[0])
    expect(map.removeSource).toHaveBeenCalledWith(TERRAIN_CONTOUR_SOURCE_ID)
    expect(maps).toHaveLength(1)
  })

  it('ignores stale async terrain rebuilds when terrain settings change quickly', async () => {
    const firstTerrainLoad = createDeferred<TerrainProtocolSupport>()
    loadTerrainSupport
      .mockImplementationOnce(() => firstTerrainLoad.promise)
      .mockResolvedValue(terrainProtocols)

    const lifecycle = createLifecycle()
    lifecycle.attach(container)
    lifecycle.update(createSnapshot({
      layerVisibility: { base: true, contours: true },
      terrain: {
        ...createSnapshot().terrain,
        contourIntervalMeters: 10,
        contoursVisible: true,
      },
    }))
    await flushPromises()

    lifecycle.update(createSnapshot({
      layerVisibility: { base: true, contours: true },
      terrain: {
        ...createSnapshot().terrain,
        contourIntervalMeters: 25,
        contoursVisible: true,
      },
    }))
    await flushPromises()

    const map = mapAt()
    expect(map.addSource).toHaveBeenCalledWith(
      TERRAIN_CONTOUR_SOURCE_ID,
      expect.objectContaining({
        tiles: [expect.stringContaining('%5B25%2C125%5D')],
      }),
    )
    const addSourceCallCount = map.addSource.mock.calls.length

    firstTerrainLoad.resolve(terrainProtocols)
    await flushPromises()
    expect(map.addSource.mock.calls.length).toBe(addSourceCallCount)
  })

  it('recreates the map for basemap style changes and keeps basemap paint separate from terrain paint', async () => {
    const originalMapTilerKey = import.meta.env.VITE_MAPTILER_KEY
    ;(import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY = 'test-maptiler-key'

    try {
      const lifecycle = createLifecycle()
      lifecycle.attach(container)
      lifecycle.update(createSnapshot({
        layerVisibility: { base: true, contours: true },
        layerOpacity: { base: 1, contours: 0.5 },
        terrain: {
          ...createSnapshot().terrain,
          contoursVisible: true,
          contoursOpacity: 0.5,
        },
      }))
      await flushPromises()
      const firstMap = mapAt()

      lifecycle.update(createSnapshot({
        basemapStyle: 'satellite',
        layerVisibility: { base: true, contours: true },
        layerOpacity: { base: 0.25, contours: 0.5 },
        terrain: {
          ...createSnapshot().terrain,
          contoursVisible: true,
          contoursOpacity: 0.5,
        },
      }))
      await flushPromises()

      expect(firstMap.remove).toHaveBeenCalled()
      expect(maps).toHaveLength(2)
      const secondMap = mapAt(1)
      expect(secondMap.options.style).toMatchObject({
        sources: {
          [MAPLIBRE_BASEMAP_SOURCE_ID]: expect.objectContaining({
            tiles: [expect.stringContaining('api.maptiler.com/tiles/satellite-v4/{z}/{x}/{y}?key=test-maptiler-key')],
          }),
        },
      })

      secondMap.setPaintProperty.mockClear()
      lifecycle.update(createSnapshot({
        basemapStyle: 'satellite',
        layerVisibility: { base: true, contours: true },
        layerOpacity: { base: 0.4, contours: 0.5 },
        terrain: {
          ...createSnapshot().terrain,
          contoursVisible: true,
          contoursOpacity: 0.5,
        },
      }))
      expect(secondMap.setPaintProperty).toHaveBeenCalledWith(MAPLIBRE_BASEMAP_RASTER_LAYER_ID, 'raster-opacity', 0.4)
      expect(secondMap.removeLayer).not.toHaveBeenCalledWith(TERRAIN_CONTOUR_LAYER_IDS[0])
    } finally {
      ;(import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY = originalMapTilerKey
    }
  })

  it('syncs and clears panel target overlays from lifecycle snapshots', async () => {
    const scene = createDefaultScenePersistedState()
    scene.plants = [
      {
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: null,
        position: { x: 0, y: 0 },
        rotationDeg: null,
        scale: null,
        notes: null,
        plantedDate: null,
        quantity: null,
      },
    ]
    scene.zones = [
      {
        kind: 'zone',
        locked: false,
        name: 'orchard',
        zoneType: 'polygon',
        rotationDeg: 0,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        fillColor: null,
        notes: null,
      },
    ]

    const lifecycle = createLifecycle()
    lifecycle.attach(container)
    lifecycle.update(createSnapshot({
      runtime: createRuntime(scene),
      hoveredTargets: [{ kind: 'zone', zone_name: 'orchard' }],
      selectedTargets: [{ kind: 'placed_plant', plant_id: 'plant-1' }],
    }))
    await flushPromises()

    const map = mapAt()
    expect(map.addSource).toHaveBeenCalledWith('panel-target-selection-source', expect.objectContaining({ type: 'geojson' }))
    expect(map.addSource).toHaveBeenCalledWith('panel-target-hover-source', expect.objectContaining({ type: 'geojson' }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'panel-target-selection-plants' }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'panel-target-hover-zones-fill' }))

    lifecycle.update(createSnapshot({
      runtime: createRuntime(scene),
      hoveredTargets: [],
      selectedTargets: [],
    }))

    expect(map.removeLayer).toHaveBeenCalledWith('panel-target-hover-zones-fill')
    expect(map.removeLayer).toHaveBeenCalledWith('panel-target-selection-plants')
    expect(map.removeSource).toHaveBeenCalledWith('panel-target-hover-source')
    expect(map.removeSource).toHaveBeenCalledWith('panel-target-selection-source')
  })
})
