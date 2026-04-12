import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapLibreCanvasSurface } from '../components/canvas/MapLibreCanvasSurface'
import { setCurrentCanvasSession } from '../canvas/session'
import { currentDesign } from '../state/document'
import { layerOpacity, layerVisibility } from '../state/canvas'

const removeMock = vi.fn()
const resizeMock = vi.fn()
const jumpToMock = vi.fn()
const mapConstructorMock = vi.fn(function MockMap() {
  return {
    jumpTo: jumpToMock,
    resize: resizeMock,
    remove: removeMock,
  }
})

vi.mock('../components/canvas/maplibre-loader', () => ({
  loadMapLibre: vi.fn(async () => ({
    Map: mapConstructorMock,
  })),
}))

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
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    setCurrentCanvasSession(null)
  })

  it('does not initialize a map without a document location', async () => {
    const viewportRevision = signal(0)
    setCurrentCanvasSession({
      getSceneStore: () => { throw new Error('unused') },
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
    } as never)

    await act(async () => {
      render(<MapLibreCanvasSurface />, container)
    })

    expect(mapConstructorMock).not.toHaveBeenCalled()
  })

  it('initializes and tears down the map when basemap conditions change', async () => {
    const viewportRevision = signal(0)
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
    setCurrentCanvasSession({
      getSceneStore: () => { throw new Error('unused') },
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
    } as never)

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
})
