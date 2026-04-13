import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'
import { MapLibreCanvasSurface } from '../components/canvas/MapLibreCanvasSurface'
import { setCurrentCanvasSession } from '../canvas/session'
import { currentDesign } from '../state/design'
import { theme } from '../app/shell/state'
import {
  contourIntervalMeters,
  hillshadeOpacity,
  hillshadeVisible,
  layerOpacity,
  layerVisibility,
} from '../state/canvas'

const removeMock = vi.fn()
const resizeMock = vi.fn()
const jumpToMock = vi.fn()
const onMock = vi.fn()
const offMock = vi.fn()
const loadedMock = vi.fn(() => true)
const loadMapLibreMock = vi.hoisted(() => vi.fn())
const loadMapLibreTerrainSupportMock = vi.hoisted(() => vi.fn())
const addSourceMock = vi.fn()
const removeSourceMock = vi.fn()
const addLayerMock = vi.fn()
const removeLayerMock = vi.fn()
const setPaintPropertyMock = vi.fn()
const isSourceLoadedMock = vi.fn(() => true)
const isStyleLoadedMock = vi.fn(() => true)
let sourceStore = new Map<string, Record<string, unknown>>()
let layerStore = new Set<string>()
const mapConstructorMock = vi.fn(function MockMap() {
  return {
    jumpTo: jumpToMock,
    resize: resizeMock,
    remove: removeMock,
    on: onMock,
    off: offMock,
    loaded: loadedMock,
    isSourceLoaded: isSourceLoadedMock,
    isStyleLoaded: isStyleLoadedMock,
    addSource: addSourceMock,
    getSource: (id: string) => sourceStore.get(id) as { setData(data: unknown): void } | undefined,
    removeSource: removeSourceMock,
    addLayer: addLayerMock,
    setPaintProperty: setPaintPropertyMock,
    getLayer: (id: string) => (layerStore.has(id) ? { id } : undefined),
    removeLayer: removeLayerMock,
  }
})

vi.mock('../components/canvas/maplibre-loader', () => ({
  loadMapLibre: loadMapLibreMock,
}))

vi.mock('../maplibre/terrain-loader', () => ({
  loadMapLibreTerrainSupport: loadMapLibreTerrainSupportMock,
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

async function eventually(assertion: () => void, attempts = 6): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      })
    }
  }
  throw lastError
}

function createRuntime(
  scene = createDefaultScenePersistedState(),
  options: {
    viewport?: { x: number; y: number; scale: number }
    viewportRevision?: ReturnType<typeof signal<number>>
  } = {},
) {
  const viewportRevision = options.viewportRevision ?? signal(0)
  const viewport = options.viewport ?? { x: 0, y: 0, scale: 1 }
  return {
    getSceneStore: () => ({ persisted: scene }),
    getViewport: () => viewport,
    getViewportScreenSize: () => ({ width: 400, height: 300 }),
    viewportRevision,
    getSelection: () => new Set(),
    setSelection: () => {},
    clearSelection: () => {},
    initializeViewport: () => {},
    attachRulersTo: () => {},
    showCanvasChrome: () => {},
    hideCanvasChrome: () => {},
    setTool: () => {},
    zoomIn: () => {},
    zoomOut: () => {},
    zoomToFit: () => {},
    canUndo: signal(false),
    canRedo: signal(false),
    undo: () => {},
    redo: () => {},
    copy: () => {},
    paste: () => {},
    duplicateSelected: () => {},
    deleteSelected: () => {},
    selectAll: () => {},
    bringToFront: () => {},
    sendToBack: () => {},
    lockSelected: () => {},
    unlockSelected: () => {},
    groupSelected: () => {},
    ungroupSelected: () => {},
    toggleGrid: () => {},
    toggleSnapToGrid: () => {},
    toggleRulers: () => {},
    getPlantSizeMode: () => 'default',
    setPlantSizeMode: () => {},
    getPlantColorByAttr: () => null,
    setPlantColorByAttr: () => {},
    getSelectedPlantColorContext: () => ({
      plantIds: [],
      singleSpeciesCanonicalName: null,
      singleSpeciesCommonName: null,
      sharedCurrentColor: null,
      suggestedColor: null,
      singleSpeciesDefaultColor: null,
    }),
    getPlacedPlants: () => [],
    getLocalizedCommonNames: () => new Map(),
    ensureSpeciesCacheEntries: async () => true,
    setSelectedPlantColor: () => 0,
    setPlantColorForSpecies: () => 0,
    clearPlantSpeciesColor: () => false,
    loadDocument: () => {},
    replaceDocument: () => {},
    serializeDocument: () => { throw new Error('unused') },
    markSaved: () => {},
    clearHistory: () => {},
    destroy: () => {},
  } as never
}

describe('MapLibreCanvasSurface', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      disconnect() {}
    }
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    currentDesign.value = null
    contourIntervalMeters.value = 0
    hillshadeVisible.value = false
    hillshadeOpacity.value = 0.55
    layerVisibility.value = { base: true }
    layerOpacity.value = { base: 0.6 }
    theme.value = 'light'
    setCurrentCanvasSession(null)
    mapConstructorMock.mockClear()
    jumpToMock.mockClear()
    resizeMock.mockClear()
    removeMock.mockClear()
    onMock.mockClear()
    offMock.mockClear()
    loadedMock.mockReset()
    loadedMock.mockReturnValue(true)
    isSourceLoadedMock.mockReset()
    isSourceLoadedMock.mockReturnValue(true)
    isStyleLoadedMock.mockReset()
    isStyleLoadedMock.mockReturnValue(true)
    addSourceMock.mockReset()
    addSourceMock.mockImplementation((id: string, source: Record<string, unknown>) => {
      sourceStore.set(id, source)
    })
    removeSourceMock.mockReset()
    removeSourceMock.mockImplementation((id: string) => {
      sourceStore.delete(id)
    })
    addLayerMock.mockReset()
    addLayerMock.mockImplementation((layer: { id: string }) => {
      layerStore.add(layer.id)
    })
    removeLayerMock.mockReset()
    removeLayerMock.mockImplementation((id: string) => {
      layerStore.delete(id)
    })
    setPaintPropertyMock.mockReset()
    sourceStore = new Map()
    layerStore = new Set()
    loadMapLibreMock.mockReset()
    loadMapLibreMock.mockResolvedValue({
      Map: mapConstructorMock,
      addProtocol: vi.fn(),
    })
    loadMapLibreTerrainSupportMock.mockReset()
    loadMapLibreTerrainSupportMock.mockResolvedValue({
      sharedDemProtocolUrl: 'canopi-terrain-shared://{z}/{x}/{y}',
      contourProtocolUrl: () => 'canopi-terrain-contours://{z}/{x}/{y}?thresholds=auto',
    })
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    setCurrentCanvasSession(null)
  })

  it('does not initialize a map without a document location', async () => {
    setCurrentCanvasSession(createRuntime())

    await act(async () => {
      render(<MapLibreCanvasSurface />, container)
      await Promise.resolve()
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(mapConstructorMock).not.toHaveBeenCalled()
  })

  it('initializes and tears down the map when basemap conditions change', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
      north_bearing_deg: 12,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    setCurrentCanvasSession(createRuntime())

    await act(async () => {
      render(<MapLibreCanvasSurface />, container)
      await Promise.resolve()
    })

    await eventually(() => {
      expect(mapConstructorMock).toHaveBeenCalledTimes(1)
      expect(jumpToMock).toHaveBeenCalled()
    })
    expect(mapConstructorMock).toHaveBeenCalledWith(expect.objectContaining({
      center: expect.arrayContaining([expect.any(Number), expect.any(Number)]),
      zoom: expect.any(Number),
      bearing: expect.any(Number),
      attributionControl: { compact: true },
    }))

    await act(async () => {
      layerVisibility.value = { base: false }
    })

    expect(removeMock).toHaveBeenCalledTimes(1)
  })

  it('reapplies the map camera for tiny viewport changes', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
      north_bearing_deg: 12,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    const viewport = { x: 0, y: 0, scale: 1 }
    const viewportRevision = signal(0)
    setCurrentCanvasSession(createRuntime(undefined, { viewport, viewportRevision }))

    await act(async () => {
      render(<MapLibreCanvasSurface />, container)
    })

    await eventually(() => {
      expect(mapConstructorMock).toHaveBeenCalledTimes(1)
      expect(jumpToMock).toHaveBeenCalled()
    })

    const initialJumpCount = jumpToMock.mock.calls.length
    await act(async () => {
      viewport.x += 0.0625
      viewport.y -= 0.0625
      viewportRevision.value += 1
      await Promise.resolve()
    })

    await eventually(() => {
      expect(jumpToMock.mock.calls.length).toBeGreaterThan(initialJumpCount)
    })
  })

  it('keeps terrain mounted when the basemap is hidden and only basemap paint changes', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
      north_bearing_deg: 12,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    setCurrentCanvasSession(createRuntime())
    layerVisibility.value = { base: true, contours: true }
    layerOpacity.value = { base: 0.6, contours: 0.5 }

    await act(async () => {
      render(<MapLibreCanvasSurface />, container)
    })

    await eventually(() => {
      expect(mapConstructorMock).toHaveBeenCalledTimes(1)
      expect(addLayerMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'contour-minor' }))
    })

    setPaintPropertyMock.mockClear()
    await act(async () => {
      layerVisibility.value = { base: false, contours: true }
    })

    await eventually(() => {
      expect(mapConstructorMock).toHaveBeenCalledTimes(1)
      expect(removeMock).not.toHaveBeenCalled()
      expect(setPaintPropertyMock).toHaveBeenCalledWith('basemap-background', 'background-opacity', 0)
      expect(setPaintPropertyMock).toHaveBeenCalledWith('openstreetmap-raster', 'raster-opacity', 0)
    })
  })

  it('does not instantiate a stale map after unmount during lazy load', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
      north_bearing_deg: 12,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    setCurrentCanvasSession(createRuntime())
    const deferred = createDeferred<{ Map: typeof mapConstructorMock; addProtocol: ReturnType<typeof vi.fn> }>()
    loadMapLibreMock.mockReturnValueOnce(deferred.promise)

    await act(async () => {
      render(<MapLibreCanvasSurface />, container)
    })

    await act(async () => {
      render(null, container)
      deferred.resolve({ Map: mapConstructorMock, addProtocol: vi.fn() })
      await deferred.promise
    })

    expect(mapConstructorMock).not.toHaveBeenCalled()
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('reports loader failures through the surface state callback', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
      north_bearing_deg: 12,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    setCurrentCanvasSession(createRuntime())
    const states: string[] = []
    loadMapLibreMock.mockRejectedValueOnce(new Error('style fetch failed'))

    await act(async () => {
      render(
        <MapLibreCanvasSurface
          onStateChange={(state) => {
            states.push(`${state.status}:${state.errorMessage ?? ''}`)
          }}
        />,
        container,
      )
      await Promise.resolve()
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(states).toContain('loading:')
    expect(states).toContain('error:style fetch failed')
    expect(mapConstructorMock).not.toHaveBeenCalled()
  })

  it('stays loading until the basemap source reports loaded', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
      north_bearing_deg: 12,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    setCurrentCanvasSession(createRuntime())
    const states: string[] = []
    isSourceLoadedMock.mockReturnValue(false)

    await act(async () => {
      render(
        <MapLibreCanvasSurface
          onStateChange={(state) => {
            states.push(state.status)
          }}
        />,
        container,
      )
    })

    expect(states).toContain('loading')
    expect(states).not.toContain('ready')
  })

  it('does not fail when basemap paint sync runs before the style is ready', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
      north_bearing_deg: 12,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    setCurrentCanvasSession(createRuntime())
    const states: string[] = []
    loadedMock.mockReturnValue(false)
    isSourceLoadedMock.mockReturnValue(false)
    isStyleLoadedMock.mockReturnValue(false)

    await act(async () => {
      render(
        <MapLibreCanvasSurface
          onStateChange={(state) => {
            states.push(`${state.status}:${state.errorMessage ?? ''}`)
          }}
        />,
        container,
      )
    })

    await act(async () => {
      layerOpacity.value = { base: 0.4 }
      await Promise.resolve()
    })

    expect(states).toContain('loading:')
    expect(states).not.toContain('error:Style is not done loading')
    expect(setPaintPropertyMock).not.toHaveBeenCalled()
  })

  it('adds and clears terrain layers without recreating the map', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
      north_bearing_deg: 12,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    setCurrentCanvasSession(createRuntime())
    layerVisibility.value = { base: true, contours: true }
    layerOpacity.value = { base: 0.6, contours: 0.5 }

    await act(async () => {
      render(<MapLibreCanvasSurface />, container)
    })

    await eventually(() => {
      expect(mapConstructorMock).toHaveBeenCalledTimes(1)
      expect(loadMapLibreTerrainSupportMock.mock.calls.length).toBeGreaterThanOrEqual(1)
      expect(addSourceMock).toHaveBeenCalledWith(
        'terrain-contour-source',
        expect.objectContaining({ type: 'vector' }),
      )
      expect(addLayerMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'contour-minor' }))
    })

    await act(async () => {
      layerVisibility.value = { base: true, contours: false }
    })

    await eventually(() => {
      expect(mapConstructorMock).toHaveBeenCalledTimes(1)
      expect(removeLayerMock).toHaveBeenCalledWith('contour-minor')
      expect(removeSourceMock).toHaveBeenCalledWith('terrain-contour-source')
    })
  })

  it('ignores stale async terrain rebuilds when contour settings change quickly', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
      north_bearing_deg: 12,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    setCurrentCanvasSession(createRuntime())
    layerVisibility.value = { base: true, contours: true }
    contourIntervalMeters.value = 10

    const firstTerrainLoad = createDeferred<{
      sharedDemProtocolUrl: string
      contourProtocolUrl: ({ thresholds }: { thresholds: Record<number, number | number[]> }) => string
    }>()
    const terrainProtocols = {
      sharedDemProtocolUrl: 'canopi-terrain-shared://{z}/{x}/{y}',
      contourProtocolUrl: ({ thresholds }: { thresholds: Record<number, number | number[]> }) =>
        `canopi-terrain-contours://{z}/{x}/{y}?thresholds=${encodeURIComponent(JSON.stringify(thresholds))}`,
    }
    loadMapLibreTerrainSupportMock
      .mockImplementationOnce(() => firstTerrainLoad.promise)
      .mockResolvedValue(terrainProtocols)

    await act(async () => {
      render(<MapLibreCanvasSurface />, container)
    })

    await act(async () => {
      contourIntervalMeters.value = 25
      await Promise.resolve()
    })

    await eventually(() => {
      expect(addSourceMock).toHaveBeenCalledWith(
        'terrain-contour-source',
        expect.objectContaining({
          tiles: [expect.stringContaining('%5B25%2C125%5D')],
        }),
      )
    })

    const addSourceCallCount = addSourceMock.mock.calls.length
    await act(async () => {
      firstTerrainLoad.resolve(terrainProtocols)
      await firstTerrainLoad.promise
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(addSourceMock.mock.calls.length).toBe(addSourceCallCount)
  })

  it('updates basemap opacity without changing terrain opacity', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
      north_bearing_deg: 12,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    setCurrentCanvasSession(createRuntime())
    layerVisibility.value = { base: true, contours: true }
    layerOpacity.value = { base: 1, contours: 0.5 }

    await act(async () => {
      render(<MapLibreCanvasSurface />, container)
    })

    await eventually(() => {
      expect(mapConstructorMock).toHaveBeenCalledTimes(1)
    })

    setPaintPropertyMock.mockClear()
    await act(async () => {
      layerOpacity.value = { base: 0.25, contours: 0.5 }
    })

    await eventually(() => {
      expect(setPaintPropertyMock).toHaveBeenCalledWith('basemap-background', 'background-opacity', 0.25)
      expect(setPaintPropertyMock).toHaveBeenCalledWith('openstreetmap-raster', 'raster-opacity', 0.25)
      expect(removeLayerMock).not.toHaveBeenCalledWith('contour-minor')
    })
  })

  it('updates contour paint in place without rebuilding terrain sources', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
      north_bearing_deg: 12,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    setCurrentCanvasSession(createRuntime())
    layerVisibility.value = { base: true, contours: true }
    layerOpacity.value = { base: 1, contours: 0.5 }

    await act(async () => {
      render(<MapLibreCanvasSurface />, container)
    })

    await eventually(() => {
      expect(addSourceMock).toHaveBeenCalledWith(
        'terrain-contour-source',
        expect.objectContaining({ type: 'vector' }),
      )
    })

    addSourceMock.mockClear()
    addLayerMock.mockClear()
    setPaintPropertyMock.mockClear()

    await act(async () => {
      layerOpacity.value = { base: 1, contours: 0.7 }
    })

    await eventually(() => {
      expect(setPaintPropertyMock).toHaveBeenCalledWith('contour-minor', 'line-opacity', expect.any(Number))
      expect(setPaintPropertyMock).toHaveBeenCalledWith('contour-major', 'line-opacity', expect.any(Number))
      expect(addSourceMock).not.toHaveBeenCalled()
      expect(addLayerMock).not.toHaveBeenCalled()
    })
  })

  it('updates contour theme paint in place without rebuilding terrain sources', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
      north_bearing_deg: 12,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    setCurrentCanvasSession(createRuntime())
    layerVisibility.value = { base: true, contours: true }

    await act(async () => {
      render(<MapLibreCanvasSurface />, container)
    })

    await eventually(() => {
      expect(addSourceMock).toHaveBeenCalledWith(
        'terrain-contour-source',
        expect.objectContaining({ type: 'vector' }),
      )
    })

    addSourceMock.mockClear()
    addLayerMock.mockClear()
    setPaintPropertyMock.mockClear()

    await act(async () => {
      theme.value = 'dark'
    })

    await eventually(() => {
      expect(setPaintPropertyMock).toHaveBeenCalledWith('contour-minor', 'line-color', expect.any(String))
      expect(setPaintPropertyMock).toHaveBeenCalledWith('contour-major', 'line-color', expect.any(String))
      expect(addSourceMock).not.toHaveBeenCalled()
      expect(addLayerMock).not.toHaveBeenCalled()
    })
  })

  it('keeps the basemap ready when terrain support fails to load', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
      north_bearing_deg: 12,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    setCurrentCanvasSession(createRuntime())
    layerVisibility.value = { base: true, contours: true }
    const states: string[] = []
    loadMapLibreTerrainSupportMock.mockRejectedValueOnce(new Error('dem fetch failed'))

    await act(async () => {
      render(
        <MapLibreCanvasSurface
          onStateChange={(state) => {
            states.push(`${state.status}:${state.errorMessage ?? ''}`)
          }}
        />,
        container,
      )
    })

    await eventually(() => {
      expect(states).toContain('ready:')
      expect(states).not.toContain('error:dem fetch failed')
      expect(removeMock).not.toHaveBeenCalled()
    })
  })
})
