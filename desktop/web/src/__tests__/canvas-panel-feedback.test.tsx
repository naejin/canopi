import { useEffect } from 'preact/hooks'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasPanel } from '../components/panels/CanvasPanel'
import { currentDesign } from '../state/document'
import { layerVisibility } from '../state/canvas'
import { locale } from '../state/app'

const initMock = vi.fn(async () => {})
const showCanvasChromeMock = vi.fn()
const hideCanvasChromeMock = vi.fn()
const initializeViewportMock = vi.fn()
const attachRulersToMock = vi.fn()
const resizeMock = vi.fn()
const destroyMock = vi.fn()
let mockBasemapState: {
  status: 'idle' | 'loading' | 'ready' | 'error'
  active: boolean
  errorMessage: string | null
} = {
  status: 'idle',
  active: false,
  errorMessage: null,
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
    onActiveChange,
    onStateChange,
  }: {
    onActiveChange?: (active: boolean) => void
    onStateChange?: (state: typeof mockBasemapState) => void
  }) => {
    useEffect(() => {
      onActiveChange?.(mockBasemapState.active)
      onStateChange?.(mockBasemapState)
    }, [onActiveChange, onStateChange])
    return <div data-testid="maplibre-surface" />
  },
}))

vi.mock('../canvas/runtime/scene-runtime', () => ({
  SceneCanvasRuntime: class {
    init = initMock
    initializeViewport = initializeViewportMock
    attachRulersTo = attachRulersToMock
    showCanvasChrome = showCanvasChromeMock
    hideCanvasChrome = hideCanvasChromeMock
    resize = resizeMock
    destroy = destroyMock
  },
}))

vi.mock('../state/document', async () => {
  const actual = await vi.importActual<typeof import('../state/document')>('../state/document')
  return {
    ...actual,
    loadCanvasFromDocument: vi.fn(),
    consumeQueuedDocumentLoad: vi.fn(() => () => {}),
    snapshotCanvasIntoCurrentDocument: vi.fn(),
    disposeDocumentWorkflows: vi.fn(),
    installConsortiumSync: vi.fn(),
    writeCanvasIntoDocument: vi.fn(() => ''),
  }
})

vi.mock('../ipc/design', () => ({
  autosaveDesign: vi.fn(async () => undefined),
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
    currentDesign.value = null
    initMock.mockClear()
    showCanvasChromeMock.mockClear()
    hideCanvasChromeMock.mockClear()
    initializeViewportMock.mockClear()
    attachRulersToMock.mockClear()
    resizeMock.mockClear()
    destroyMock.mockClear()
    mockBasemapState = {
      status: 'idle',
      active: false,
      errorMessage: null,
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
    expect(status?.textContent).toContain('Basemap')
    expect(status?.textContent).toContain('Set a design location first')
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
      active: false,
      errorMessage: null,
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Basemap')
    expect(status?.textContent).toContain('Loading')
    expect(container.querySelector('[data-basemap-active="true"]')).toBeNull()
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
      active: true,
      errorMessage: null,
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Current: 48.8566, 2.3522 (35 m)')
    expect(container.querySelector('[data-basemap-active="true"]')).toBeTruthy()
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
      active: false,
      errorMessage: 'style fetch failed',
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Basemap unavailable')
    expect(status?.textContent).toContain('style fetch failed')
  })
})
