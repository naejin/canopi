import { useEffect } from 'preact/hooks'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { layerVisibility } from '../app/canvas-settings/signals'
import { createDefaultMapLayers, mapLayers } from '../app/map-layers/state'
import { CanvasPanel } from '../components/panels/CanvasPanel'
import { designSessionFixture } from './support/design-session-state'
import type { CanopiFile } from '../types/design'
import { locale } from '../app/settings/state'
import {
  CANVAS_NOTICE_MARGIN_PX,
  CANVAS_RULER_SIZE_PX,
} from '../canvas/canvas-notice-layout'
import { SCALE_BAR_CANVAS_WIDTH, SCALE_BAR_RESERVED_BOTTOM_PX } from '../canvas/scale-bar'

let mockBasemapState: {
  status: 'idle' | 'loading' | 'ready' | 'error'
  errorMessage: string | null
  terrainStatus: 'idle' | 'loading' | 'ready' | 'error'
  terrainErrorMessage: string | null
} = {
  status: 'idle',
  errorMessage: null,
  terrainStatus: 'idle',
  terrainErrorMessage: null,
}

vi.mock('../components/canvas/CanvasToolbar', () => ({
  CanvasToolbar: () => <div data-testid="canvas-toolbar" />,
}))

vi.mock('../components/canvas/DisplayLegend', () => ({
  DisplayLegend: () => <div data-testid="display-legend" />,
}))

vi.mock('../components/canvas/ZoomControls', () => ({
  ZoomControls: () => <div data-testid="zoom-controls" />,
}))

vi.mock('../components/canvas/LayerPanel', () => ({
  LayerPanel: () => <div data-testid="layer-panel" />,
}))

vi.mock('../components/shared/WelcomeScreen', () => ({
  WelcomeScreen: () => <div data-testid="welcome-screen" />,
}))

vi.mock('../app/document-session/use-canvas-document-session', () => ({
  useCanvasDocumentSession: vi.fn(({
    onMapStateChange,
  }: {
    onMapStateChange?: (state: typeof mockBasemapState) => void
  }) => {
    useEffect(() => {
      onMapStateChange?.(mockBasemapState)
    }, [onMapStateChange])
  }),
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
    layerVisibility.value = { plants: true, zones: true, annotations: true }
    mapLayers.value = createDefaultMapLayers()
    designSessionFixture.file = null
    mockBasemapState = {
      status: 'idle',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
    }
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('does not show a Map Notice or activate the map surface without an open Design', async () => {
    designSessionFixture.file = null
    mockBasemapState = { ...mockBasemapState, status: 'loading' }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[data-map-active="true"]')).toBeNull()
  })

  it('places loading feedback as a bottom-left Map Notice above the scale bar', async () => {
    designSessionFixture.file = demoDesign()
    mockBasemapState = {
      status: 'loading',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector<HTMLElement>('[role="status"]')!
    expect(status.textContent).toContain('Loading')
    expect(status.dataset.locationNoticePlacement).toBe('bottom-left-above-scale-bar')
    expect(status.style.left).toBe(`${CANVAS_RULER_SIZE_PX + CANVAS_NOTICE_MARGIN_PX}px`)
    expect(status.style.bottom).toBe(`${SCALE_BAR_RESERVED_BOTTOM_PX + CANVAS_NOTICE_MARGIN_PX}px`)
    expect(status.style.top).toBe('auto')
  })

  it('shifts Map Notices to the right of the scale bar when canvas height is tight', async () => {
    const widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    const heightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(72)
    designSessionFixture.file = demoDesign()
    mockBasemapState = {
      status: 'loading',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
    }

    try {
      await act(async () => {
        render(<CanvasPanel />, container)
      })

      const status = container.querySelector<HTMLElement>('[role="status"]')!
      expect(status.dataset.locationNoticePlacement).toBe('bottom-left-right-of-scale-bar')
      expect(status.style.left).toBe(`${SCALE_BAR_CANVAS_WIDTH + CANVAS_NOTICE_MARGIN_PX}px`)
      expect(status.style.bottom).toBe(`${CANVAS_NOTICE_MARGIN_PX}px`)
    } finally {
      widthSpy.mockRestore()
      heightSpy.mockRestore()
    }
  })

  it('keeps compact Map Notices visible under severe layout pressure', async () => {
    const widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    const heightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(72)
    designSessionFixture.file = demoDesign()
    mockBasemapState = {
      status: 'loading',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
    }

    try {
      await act(async () => {
        render(<CanvasPanel />, container)
      })

      const status = container.querySelector<HTMLElement>('[role="status"]')!
      expect(status.dataset.locationNoticePlacement).toBe('bottom-left-compact')
      expect(status.dataset.compact).toBe('true')
      expect(Number.parseFloat(status.style.maxWidth)).toBeLessThan(240)
      expect(status.querySelector('[aria-hidden="true"]')).not.toBeNull()
      expect(status.textContent).toContain('Loading')
    } finally {
      widthSpy.mockRestore()
      heightSpy.mockRestore()
    }
  })

  it('shows a loading basemap notice until the map becomes active', async () => {
    designSessionFixture.file = demoDesign()
    mockBasemapState = {
      status: 'loading',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Loading')
    expect((status as HTMLElement | null)?.dataset.locationNoticePlacement).toBe('bottom-left-above-scale-bar')
    expect(container.querySelector('[data-map-active="true"]')).not.toBeNull()
  })

  it('hides the clean ready Map Notice once the basemap becomes active', async () => {
    designSessionFixture.file = demoDesign()
    mockBasemapState = {
      status: 'ready',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[data-map-active="true"]')).toBeTruthy()
  })

  it('keeps the canvas map surface active for terrain-only visibility', async () => {
    designSessionFixture.file = demoDesign()
    const defaults = createDefaultMapLayers()
    mapLayers.value = {
      ...defaults,
      basemap: { ...defaults.basemap, visible: false },
      satellite: { ...defaults.satellite, visible: false },
      hillshade: { ...defaults.hillshade, visible: true },
    }
    mockBasemapState = {
      status: 'ready',
      errorMessage: null,
      terrainStatus: 'ready',
      terrainErrorMessage: null,
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    expect(container.querySelector('[data-map-active="true"]')).toBeTruthy()
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('keeps the canvas map surface active when only Satellite is visible', async () => {
    designSessionFixture.file = demoDesign()
    const defaults = createDefaultMapLayers()
    mapLayers.value = {
      ...defaults,
      basemap: { ...defaults.basemap, visible: false },
      satellite: { ...defaults.satellite, visible: true },
    }
    mockBasemapState = {
      status: 'ready',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    expect(container.querySelector('[data-map-active="true"]')).toBeTruthy()
  })

  it('shows a basemap error when the surface reports a load failure', async () => {
    designSessionFixture.file = demoDesign()
    mockBasemapState = {
      status: 'error',
      errorMessage: 'style fetch failed',
      terrainStatus: 'idle',
      terrainErrorMessage: null,
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Map unavailable')
    expect(status?.textContent).toContain('style fetch failed')
  })

  it('surfaces terrain degradation while keeping the basemap ready', async () => {
    designSessionFixture.file = demoDesign()
    mockBasemapState = {
      status: 'ready',
      errorMessage: null,
      terrainStatus: 'error',
      terrainErrorMessage: 'dem fetch failed',
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Map Layers: dem fetch failed')
    expect(container.querySelector('[data-map-active="true"]')).toBeTruthy()
  })
})

function demoDesign(): CanopiFile {
  return {
    version: 7,
    name: 'Demo',
    description: null,
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
}
