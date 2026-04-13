import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'
import { MapLibreCanvasSurface } from '../components/canvas/MapLibreCanvasSurface'
import { setCurrentCanvasSession } from '../canvas/session'
import { currentDesign } from '../state/document'
import { layerOpacity, layerVisibility } from '../state/canvas'

const removeMock = vi.fn()
const resizeMock = vi.fn()
const jumpToMock = vi.fn()
const onMock = vi.fn()
const offMock = vi.fn()
const loadedMock = vi.fn(() => true)
const loadMapLibreMock = vi.hoisted(() => vi.fn())
const mapConstructorMock = vi.fn(function MockMap() {
  return {
    jumpTo: jumpToMock,
    resize: resizeMock,
    remove: removeMock,
    on: onMock,
    off: offMock,
    loaded: loadedMock,
    addSource: vi.fn(),
    getSource: vi.fn(() => undefined),
    removeSource: vi.fn(),
    addLayer: vi.fn(),
    getLayer: vi.fn(() => undefined),
    removeLayer: vi.fn(),
  }
})

vi.mock('../components/canvas/maplibre-loader', () => ({
  loadMapLibre: loadMapLibreMock,
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

function createRuntime(scene = createDefaultScenePersistedState()) {
  const viewportRevision = signal(0)
  return {
    getSceneStore: () => ({ persisted: scene }),
    getViewport: () => ({ x: 0, y: 0, scale: 1 }),
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
    layerVisibility.value = { base: true }
    layerOpacity.value = { base: 0.6 }
    setCurrentCanvasSession(null)
    mapConstructorMock.mockClear()
    jumpToMock.mockClear()
    resizeMock.mockClear()
    removeMock.mockClear()
    onMock.mockClear()
    offMock.mockClear()
    loadedMock.mockReset()
    loadedMock.mockReturnValue(true)
    loadMapLibreMock.mockReset()
    loadMapLibreMock.mockResolvedValue({
      Map: mapConstructorMock,
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
    })

    expect(mapConstructorMock).toHaveBeenCalledTimes(1)
    expect(jumpToMock).toHaveBeenCalled()

    await act(async () => {
      layerVisibility.value = { base: false }
    })

    expect(removeMock).toHaveBeenCalledTimes(1)
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
    const deferred = createDeferred<{ Map: typeof mapConstructorMock }>()
    loadMapLibreMock.mockReturnValueOnce(deferred.promise)

    await act(async () => {
      render(<MapLibreCanvasSurface />, container)
    })

    await act(async () => {
      render(null, container)
      deferred.resolve({ Map: mapConstructorMock })
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
    })

    expect(states).toContain('loading:')
    expect(states).toContain('error:style fetch failed')
    expect(mapConstructorMock).not.toHaveBeenCalled()
  })
})
