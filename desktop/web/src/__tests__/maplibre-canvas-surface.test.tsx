import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { layerOpacity, layerVisibility, hillshadeVisible } from '../app/canvas-settings/signals'
import { hoveredPanelTargets, selectedPanelTargets } from '../app/panel-targets/state'
import { basemapStyle, theme } from '../app/settings/state'
import { setCurrentCanvasSession } from '../canvas/session'
import type { CanvasQuerySurface } from '../canvas/runtime/runtime'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'
import { MapLibreCanvasSurface } from '../components/canvas/MapLibreCanvasSurface'
import {
  IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  type MapLibreCanvasSurfaceState,
} from '../maplibre/canvas-surface-state'
import { currentDesign } from './support/design-session-state'
import { createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'

const attachMock = vi.hoisted(() => vi.fn())
const updateMock = vi.hoisted(() => vi.fn())
const destroyMock = vi.hoisted(() => vi.fn())
const createLifecycleMock = vi.hoisted(() => vi.fn((_deps: unknown) => ({
  attach: attachMock,
  update: updateMock,
  destroy: destroyMock,
})))

vi.mock('../app/canvas-map-surface/lifecycle', () => ({
  createCanvasMapSurfaceLifecycle: createLifecycleMock,
}))

function createRuntime(): CanvasQuerySurface {
  const viewportRevision = signal(0)
  return {
    revision: { scene: signal(0), plantNames: signal(0), viewport: signal(0) },
    getSceneSnapshot: () => createDefaultScenePersistedState(),
    getViewport: () => ({ x: 0, y: 0, scale: 1 }),
    getViewportScreenSize: () => ({ width: 400, height: 300 }),
    viewportRevision,
    getSelection: () => new Set(),
    getDesignObjectSelection: () => ({
      editableTargets: [],
      blockedTargets: [],
      bounds: null,
      sameSpeciesReferenceCanonicalName: null,
    }),
    getPlantSizeMode: () => 'default',
    getPlantColorByAttr: () => null,
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
  }
}

function setQuerySurfaceForTest(surface: CanvasQuerySurface | null): void {
  setCurrentCanvasSession(surface ? createTestCanvasRuntimeSurfaces({ queries: surface }) : null)
}

describe('MapLibreCanvasSurface adapter', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    attachMock.mockClear()
    updateMock.mockClear()
    destroyMock.mockClear()
    createLifecycleMock.mockClear()
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
      budget_currency: 'EUR',
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    basemapStyle.value = 'street'
    theme.value = 'light'
    layerVisibility.value = { base: true, contours: false }
    layerOpacity.value = { base: 0.6, contours: 0.5 }
    hillshadeVisible.value = false
    hoveredPanelTargets.value = []
    selectedPanelTargets.value = []
    setCurrentCanvasSession(null)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    setCurrentCanvasSession(null)
  })

  it('mounts the lifecycle and forwards signal snapshots', async () => {
    const runtime = createRuntime()
    setQuerySurfaceForTest(runtime)

    await act(async () => {
      render(<MapLibreCanvasSurface />, container)
    })

    expect(createLifecycleMock).toHaveBeenCalledTimes(1)
    expect(attachMock).toHaveBeenCalledWith(expect.any(HTMLDivElement))
    expect(updateMock).toHaveBeenLastCalledWith(expect.objectContaining({
      runtime,
      location: { lat: 48.8566, lon: 2.3522 },
      northBearingDeg: 12,
      basemapStyle: 'street',
      layerVisibility: { base: true, contours: false },
      layerOpacity: { base: 0.6, contours: 0.5 },
      terrain: expect.objectContaining({
        contoursVisible: false,
        hillshadeVisible: false,
        isDark: false,
      }),
      hoveredTargets: [],
      selectedTargets: [],
      theme: 'light',
    }))

    await act(async () => {
      theme.value = 'dark'
      layerVisibility.value = { base: true, contours: true }
      layerOpacity.value = { base: 0.4, contours: 0.75 }
      hoveredPanelTargets.value = [{ kind: 'manual' }]
      selectedPanelTargets.value = [{ kind: 'none' }]
    })

    expect(updateMock).toHaveBeenLastCalledWith(expect.objectContaining({
      layerVisibility: { base: true, contours: true },
      layerOpacity: { base: 0.4, contours: 0.75 },
      terrain: expect.objectContaining({
        contoursVisible: true,
        contoursOpacity: 0.75,
        isDark: true,
      }),
      hoveredTargets: [{ kind: 'manual' }],
      selectedTargets: [{ kind: 'none' }],
      theme: 'dark',
    }))
  })

  it('forwards lifecycle state changes and destroys the lifecycle on unmount', async () => {
    const onStateChange = vi.fn<(state: MapLibreCanvasSurfaceState) => void>()
    setQuerySurfaceForTest(createRuntime())

    await act(async () => {
      render(<MapLibreCanvasSurface onStateChange={onStateChange} />, container)
    })

    const deps = createLifecycleMock.mock.calls[0]?.[0] as unknown as {
      onStateChange: (state: MapLibreCanvasSurfaceState) => void
    }
    deps.onStateChange(IDLE_MAPLIBRE_CANVAS_SURFACE_STATE)
    expect(onStateChange).toHaveBeenCalledWith(IDLE_MAPLIBRE_CANVAS_SURFACE_STATE)

    render(null, container)
    expect(destroyMock).toHaveBeenCalled()
  })
})
