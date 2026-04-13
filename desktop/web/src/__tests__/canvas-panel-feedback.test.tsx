import { useEffect } from 'preact/hooks'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasPanel } from '../components/panels/CanvasPanel'
import { currentDesign } from '../state/design'
import { hillshadeVisible, layerVisibility, northBearingDeg } from '../state/canvas'
import { locale } from '../app/settings/state'

let mockBasemapState: {
  status: 'idle' | 'loading' | 'ready' | 'error'
  errorMessage: string | null
  terrainStatus: 'idle' | 'loading' | 'ready' | 'error'
  terrainErrorMessage: string | null
  precisionWarning: boolean
  designExtentMeters: number | null
} = {
  status: 'idle',
  errorMessage: null,
  terrainStatus: 'idle',
  terrainErrorMessage: null,
  precisionWarning: false,
  designExtentMeters: null,
}

vi.mock('../components/canvas/CanvasToolbar', () => ({
  CanvasToolbar: () => <div data-testid="canvas-toolbar" />,
}))

vi.mock('../components/canvas/DisplayLegend', () => ({
  DisplayLegend: () => <div data-testid="display-legend" />,
}))

vi.mock('../components/canvas/DisplayModeControls', () => ({
  DisplayModeControls: () => <div data-testid="display-mode-controls" />,
}))

vi.mock('../components/canvas/ZoomControls', () => ({
  ZoomControls: () => <div data-testid="zoom-controls" />,
}))

vi.mock('../components/canvas/BottomPanelLauncher', () => ({
  BottomPanelLauncher: () => <div data-testid="bottom-panel-launcher" />,
}))

vi.mock('../components/canvas/BottomPanel', () => ({
  BottomPanel: () => <div data-testid="bottom-panel" />,
}))

vi.mock('../components/canvas/LayerPanel', () => ({
  LayerPanel: () => <div data-testid="layer-panel" />,
}))

vi.mock('../components/shared/WelcomeScreen', () => ({
  WelcomeScreen: () => <div data-testid="welcome-screen" />,
}))

vi.mock('../components/canvas/MapLibreCanvasSurface', () => ({
  MapLibreCanvasSurface: ({
    onStateChange,
  }: {
    onStateChange?: (state: typeof mockBasemapState) => void
  }) => {
    useEffect(() => {
      onStateChange?.(mockBasemapState)
    }, [onStateChange])
    return <div data-testid="maplibre-surface" />
  },
}))

vi.mock('../app/document-session/use-canvas-document-session', () => ({
  useCanvasDocumentSession: vi.fn(),
}))

describe('CanvasPanel basemap feedback', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      disconnect() {}
    }
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    layerVisibility.value = { base: true, plants: true, zones: true, annotations: true }
    hillshadeVisible.value = false
    northBearingDeg.value = 0
    currentDesign.value = null
    mockBasemapState = {
      status: 'idle',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
      precisionWarning: false,
      designExtentMeters: null,
    }
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('shows a location-required basemap notice when no design location is saved', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: null,
      north_bearing_deg: 0,
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

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Set a design location first')
    expect(container.querySelector('[role="img"][aria-label^="Compass"]')).toBeNull()
  })

  it('shows a loading basemap notice until the map becomes active', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
      north_bearing_deg: 0,
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
    mockBasemapState = {
      status: 'loading',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
      precisionWarning: false,
      designExtentMeters: null,
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Loading')
    expect(container.querySelector('[data-map-active="true"]')).not.toBeNull()
  })

  it('shows the saved location once the basemap becomes active', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
      north_bearing_deg: 0,
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
    mockBasemapState = {
      status: 'ready',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
      precisionWarning: false,
      designExtentMeters: null,
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('48.8566, 2.3522 (35 m)')
    expect(container.querySelector('[data-map-active="true"]')).toBeTruthy()
  })

  it('renders a display-only compass in canvas chrome', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
      north_bearing_deg: 32,
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
    northBearingDeg.value = 32

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const compass = container.querySelector('[role="img"][aria-label^="Compass"]')
    expect(compass?.getAttribute('aria-label')).toContain('32°')
  })

  it('keeps the canvas map surface active for terrain-only visibility', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
      north_bearing_deg: 0,
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
    layerVisibility.value = { base: false, plants: true, zones: true, annotations: true }
    hillshadeVisible.value = true
    mockBasemapState = {
      status: 'ready',
      errorMessage: null,
      terrainStatus: 'ready',
      terrainErrorMessage: null,
      precisionWarning: false,
      designExtentMeters: null,
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    expect(container.querySelector('[data-map-active="true"]')).toBeTruthy()
    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('48.8566, 2.3522 (35 m)')
  })

  it('shows a basemap error when the surface reports a load failure', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
      north_bearing_deg: 0,
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
    mockBasemapState = {
      status: 'error',
      errorMessage: 'style fetch failed',
      terrainStatus: 'idle',
      terrainErrorMessage: null,
      precisionWarning: false,
      designExtentMeters: null,
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Basemap unavailable')
    expect(status?.textContent).toContain('style fetch failed')
  })

  it('surfaces terrain degradation while keeping the basemap ready', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
      north_bearing_deg: 0,
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
    mockBasemapState = {
      status: 'ready',
      errorMessage: null,
      terrainStatus: 'error',
      terrainErrorMessage: 'dem fetch failed',
      precisionWarning: false,
      designExtentMeters: null,
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('48.8566, 2.3522 (35 m)')
    expect(status?.textContent).toContain('Map Layers: dem fetch failed')
    expect(container.querySelector('[data-map-active="true"]')).toBeTruthy()
  })

  it('surfaces a precision warning for large designs', async () => {
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
      north_bearing_deg: 0,
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
    mockBasemapState = {
      status: 'ready',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
      precisionWarning: true,
      designExtentMeters: 12_000,
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Precision may degrade for large designs')
  })
})
