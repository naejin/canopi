import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'
import { MapLibreCanvasSurface } from '../components/canvas/MapLibreCanvasSurface'
import { setCurrentCanvasSession } from '../canvas/session'
import { currentDesign } from '../state/document'
import { hoveredPanelTargets, layerOpacity, layerVisibility, selectedPanelTargets } from '../state/canvas'

const removeMock = vi.fn()
const resizeMock = vi.fn()
const jumpToMock = vi.fn()
const onMock = vi.fn()
const offMock = vi.fn()
const loadedMock = vi.fn(() => true)
const addSourceMock = vi.fn()
const removeSourceMock = vi.fn()
const addLayerMock = vi.fn()
const removeLayerMock = vi.fn()
const loadMapLibreMock = vi.hoisted(() => vi.fn())
let sourceStore = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
let layerStore = new Set<string>()

const mapConstructorMock = vi.fn(function MockMap() {
  return {
    jumpTo: jumpToMock,
    resize: resizeMock,
    remove: removeMock,
    on: onMock,
    off: offMock,
    loaded: loadedMock,
    addSource: addSourceMock,
    getSource: (id: string) => sourceStore.get(id),
    removeSource: removeSourceMock,
    addLayer: addLayerMock,
    getLayer: (id: string) => (layerStore.has(id) ? { id } : undefined),
    removeLayer: removeLayerMock,
  }
})

vi.mock('../components/canvas/maplibre-loader', () => ({
  loadMapLibre: loadMapLibreMock,
}))

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

describe('MapLibreCanvasSurface overlays', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      disconnect() {}
    }
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
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
    layerVisibility.value = { base: true }
    layerOpacity.value = { base: 0.6 }
    hoveredPanelTargets.value = []
    selectedPanelTargets.value = []
    addSourceMock.mockReset()
    addSourceMock.mockImplementation((id: string) => {
      sourceStore.set(id, { setData: vi.fn() })
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
    loadMapLibreMock.mockReset()
    loadMapLibreMock.mockResolvedValue({
      Map: mapConstructorMock,
    })
    sourceStore = new Map()
    layerStore = new Set()
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    hoveredPanelTargets.value = []
    selectedPanelTargets.value = []
    setCurrentCanvasSession(null)
  })

  it('renders and clears hover and selection overlays without mutating map authority', async () => {
    const scene = createDefaultScenePersistedState()
    scene.plants = [
      {
        kind: 'plant',
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
        name: 'orchard',
        zoneType: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        fillColor: null,
        notes: null,
      },
    ]
    setCurrentCanvasSession(createRuntime(scene))

    await act(async () => {
      render(<MapLibreCanvasSurface />, container)
    })

    await act(async () => {
      hoveredPanelTargets.value = [{ kind: 'zone', zone_name: 'orchard' }]
      selectedPanelTargets.value = [{ kind: 'placed_plant', plant_id: 'plant-1' }]
    })

    expect(addSourceMock).toHaveBeenCalledWith(
      'panel-target-selection-source',
      expect.objectContaining({ type: 'geojson' }),
    )
    expect(addSourceMock).toHaveBeenCalledWith(
      'panel-target-hover-source',
      expect.objectContaining({ type: 'geojson' }),
    )
    expect(addLayerMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'panel-target-selection-plants' }))
    expect(addLayerMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'panel-target-hover-zones-fill' }))

    await act(async () => {
      hoveredPanelTargets.value = []
      selectedPanelTargets.value = []
    })

    expect(removeLayerMock).toHaveBeenCalledWith('panel-target-hover-zones-line')
    expect(removeLayerMock).toHaveBeenCalledWith('panel-target-hover-zones-fill')
    expect(removeLayerMock).toHaveBeenCalledWith('panel-target-selection-plants')
    expect(removeSourceMock).toHaveBeenCalledWith('panel-target-hover-source')
    expect(removeSourceMock).toHaveBeenCalledWith('panel-target-selection-source')
  })
})
