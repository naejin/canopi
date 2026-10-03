import { readFileSync } from 'node:fs'
import { useEffect } from 'preact/hooks'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { layerVisibility } from '../app/canvas-settings/signals'
import { createDefaultMapLayers, mapLayers } from '../app/map-layers/state'
import { CanvasPanel } from '../components/panels/CanvasPanel'
import { WebCanvasWorkspace } from '../web/WebCanvasWorkspace'
import {
  IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  type MapLibreCanvasSurfaceState,
} from '../maplibre/canvas-surface-state'
import type { WorkspaceRuntimeComposition } from '../app/canvas-map-surface/workspace-runtime-composition'
import { designSessionFixture } from './support/design-session-state'
import type { CanopiFile } from '../types/design'
import { locale } from '../app/settings/state'

let mockBasemapState: MapLibreCanvasSurfaceState = IDLE_MAPLIBRE_CANVAS_SURFACE_STATE
const retryMap = vi.fn()

vi.mock('../components/canvas/CanvasChrome', () => ({
  CanvasChrome: () => <div data-testid="canvas-chrome" />,
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
    onMapStateChange?: (state: MapLibreCanvasSurfaceState) => void
  }) => {
    useEffect(() => {
      onMapStateChange?.(mockBasemapState)
    }, [onMapStateChange])
    return { retryMap }
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
    mockBasemapState = IDLE_MAPLIBRE_CANVAS_SURFACE_STATE
    retryMap.mockClear()
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

  it('shows loading feedback as one quiet status chip over the map with the floating chrome', async () => {
    designSessionFixture.file = demoDesign()
    mockBasemapState = {
      ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
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
    expect(status.dataset.tone).toBe('loading')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(container.querySelector('[data-testid="canvas-chrome"]')).not.toBeNull()
  })

  it('shows a loading basemap notice until the map becomes active', async () => {
    designSessionFixture.file = demoDesign()
    mockBasemapState = {
      ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
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
    expect(container.querySelector('[data-map-active="true"]')).not.toBeNull()
  })

  it('hides the clean ready Map Notice once the basemap becomes active', async () => {
    designSessionFixture.file = demoDesign()
    mockBasemapState = {
      ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
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
      ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
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
      ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
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

  it('shows a map failure with a fixed message and never the engine text', async () => {
    designSessionFixture.file = demoDesign()
    mockBasemapState = {
      ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
      status: 'error',
      errorMessage: 'style fetch failed',
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toBe('Map unavailable')
    expect(container.querySelector('button')).toBeNull()
  })

  it('offers Retry when the map stopped drawing and hands it to the Design session', async () => {
    designSessionFixture.file = demoDesign()
    mockBasemapState = {
      ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
      status: 'error',
      errorMessage: 'MapLibre WebGL context was lost.',
      retryable: true,
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector<HTMLElement>('[role="status"]')!
    expect(status.textContent).toBe('The map stopped drawing. Your Design is safe.Retry')
    await act(async () => { status.querySelector('button')!.click() })
    expect(retryMap).toHaveBeenCalledOnce()
  })

  it('surfaces terrain degradation as a skipped layer while keeping the basemap ready', async () => {
    designSessionFixture.file = demoDesign()
    mockBasemapState = {
      ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
      status: 'ready',
      terrainStatus: 'error',
      terrainErrorMessage: 'dem fetch failed',
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toBe('A map layer couldn’t be shown')
    expect(container.querySelector('[data-map-active="true"]')).toBeTruthy()
  })

  it('offers Retry on a basemap that couldn’t load and hands it to the Design session', async () => {
    designSessionFixture.file = demoDesign()
    mockBasemapState = { ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE, status: 'ready', basemapStatus: 'failed' }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector<HTMLElement>('[role="status"]')!
    expect(status.dataset.tone).toBe('error')
    expect(status.textContent).toContain('Basemap couldn’t load. Check your connection.')
    const retry = [...status.querySelectorAll('button')].find((button) => button.textContent === 'Retry')!
    await act(async () => { retry.click() })
    expect(retryMap).toHaveBeenCalledOnce()
  })
})

describe('WebCanvasWorkspace map notice', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    mapLayers.value = createDefaultMapLayers()
    designSessionFixture.file = demoDesign()
  })

  afterEach(async () => {
    await act(async () => { render(null, container) })
    container.remove()
    designSessionFixture.file = null
  })

  it('shows the same basemap notice as the desktop and Retry reaches its composition', async () => {
    const retry = vi.fn()
    const createRuntimeComposition = vi.fn((options: { onMapStateChange?: (state: MapLibreCanvasSurfaceState) => void }) => {
      options.onMapStateChange?.({ ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE, status: 'ready', basemapStatus: 'failed' })
      return {
        surfaces: {} as never,
        start: () => new Promise<never>(() => {}),
        dispose: async () => {},
        retryMap: retry,
      } satisfies WorkspaceRuntimeComposition
    })

    await act(async () => {
      render(<WebCanvasWorkspace createRuntimeComposition={createRuntimeComposition} />, container)
    })
    await act(async () => { await vi.waitFor(() => expect(createRuntimeComposition).toHaveBeenCalledOnce()) })

    const status = container.querySelector<HTMLElement>('[role="status"]')!
    expect(status.textContent).toContain('Basemap couldn’t load. Check your connection.')
    const button = [...status.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Retry')!
    await act(async () => { button.click() })
    expect(retry).toHaveBeenCalledOnce()
  })

  it('wraps a long localized notice beside Retry instead of cutting off its advice', () => {
    // jsdom has no layout: the chip's text rule must let the sentence wrap (German basemapFailed plus Retry is ~550 px).
    const css = readFileSync('src/components/panels/Panels.module.css', 'utf8')
    const text = /\.basemapFeedbackText\s*\{(?<body>[^}]*)\}/.exec(css)?.groups?.body
    expect(text).toBeDefined()
    expect(text).not.toMatch(/white-space:\s*nowrap/)
    expect(text).not.toMatch(/text-overflow:\s*ellipsis/)
  })
})

function demoDesign(): CanopiFile {
  return {
    version: 9,
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
