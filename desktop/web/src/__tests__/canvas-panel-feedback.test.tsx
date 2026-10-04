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
import { signal } from '@preact/signals'
import { setCurrentCanvasSession } from '../canvas/session'
import { createTestCanvasDocumentSurface, createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'

let mockBasemapState: MapLibreCanvasSurfaceState = IDLE_MAPLIBRE_CANVAS_SURFACE_STATE
let publishMapState: ((state: MapLibreCanvasSurfaceState) => void) | null = null
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
      publishMapState = onMapStateChange ?? null
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
      terrainStatus: 'idle',
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const status = container.querySelector<HTMLElement>('[role="status"]')!
    expect(status.textContent).toContain('Loading')
    expect(container.querySelector<HTMLElement>('[data-map-notice]')!.dataset.tone).toBe('loading')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(container.querySelector('[data-testid="canvas-chrome"]')).not.toBeNull()
  })

  it('shows a loading basemap notice until the map becomes active', async () => {
    designSessionFixture.file = demoDesign()
    mockBasemapState = {
      ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
      status: 'loading',
      terrainStatus: 'idle',
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
      terrainStatus: 'idle',
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
      terrainStatus: 'ready',
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
      terrainStatus: 'idle',
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
      retryable: true,
    }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const notice = container.querySelector<HTMLElement>('[data-map-notice]')!
    expect(notice.querySelector('[role="status"]')!.textContent).toBe('The map stopped drawing. Your Design is safe.')
    await act(async () => { notice.querySelector('button')!.click() })
    expect(retryMap).toHaveBeenCalledOnce()
  })

  it('hands keyboard focus to the map container once a Retried map is back, before its session returns', async () => {
    designSessionFixture.file = demoDesign()
    mockBasemapState = { ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE, status: 'error', retryable: true }
    await act(async () => {
      render(<CanvasPanel />, container)
    })
    const map = container.querySelector<HTMLElement>('[data-map-active]')!
    const retry = [...container.querySelectorAll<HTMLButtonElement>('[data-map-notice] button')]
      .find((button) => button.textContent === 'Retry')!
    retry.focus()

    // Retry rebuilds the map: the notice shows loading, then goes once the map draws, while the rebuilt interaction
    // session has not made the host a keyboard stop again yet.
    await act(async () => { retry.click() })
    await act(async () => { publishMapState!({ ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE, status: 'loading' }) })
    await act(async () => { publishMapState!({ ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE, status: 'ready' }) })

    expect(container.querySelector('[data-map-notice]')).toBeNull()
    expect(document.activeElement).toBe(map)
  })

  it('surfaces terrain degradation as a skipped layer while keeping the basemap ready', async () => {
    designSessionFixture.file = demoDesign()
    mockBasemapState = {
      ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
      status: 'ready',
      terrainStatus: 'error',
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

    const notice = container.querySelector<HTMLElement>('[data-map-notice]')!
    expect(notice.dataset.tone).toBe('error')
    expect(notice.querySelector('[role="status"]')!.textContent).toBe('Basemap couldn’t load. Check your connection.')
    const retry = [...notice.querySelectorAll('button')].find((button) => button.textContent === 'Retry')!
    await act(async () => { retry.click() })
    expect(retryMap).toHaveBeenCalledOnce()
  })
})

describe('CanvasPanel opening a Design', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    mapLayers.value = createDefaultMapLayers()
    mockBasemapState = { ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE, status: 'ready' }
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    setCurrentCanvasSession(null)
    designSessionFixture.file = null
  })

  it('keeps the start screen up and the chrome laid out but hidden until the Design\'s first scene is drawn', async () => {
    const presented = signal(false)
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ documents: createTestCanvasDocumentSurface({ presented }) }))
    designSessionFixture.file = demoDesign()

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    const area = container.querySelector<HTMLElement>('[data-design-hidden]')
    expect(area, 'the canvas area hides everything but the start screen').not.toBeNull()
    expect(container.querySelector('[data-testid="welcome-screen"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="canvas-chrome"]'), 'mounted, so it registers what it covers').not.toBeNull()
    // Transparent, not visibility: hidden, which would refuse the focus a field gives itself on mount (e2e/canvas/design-reveal.spec.ts).
    const css = readFileSync('src/components/panels/Panels.module.css', 'utf8')
    expect(css).toMatch(/\.canvasArea\[data-design-hidden\] > :not\(\[data-start-screen\], :has\(\[data-start-screen\]\)\) \{\s*opacity: 0;\s*pointer-events: none;\s*\}/)

    await act(async () => { presented.value = true })

    expect(container.querySelector('[data-design-hidden]')).toBeNull()
    expect(container.querySelector('[data-testid="welcome-screen"]')).toBeNull()
    expect(container.querySelector('[data-testid="canvas-chrome"]')).not.toBeNull()
  })

  it('keeps an open Design shown while another opens over it: the start screen comes back only after Close Design', async () => {
    const presented = signal(true)
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ documents: createTestCanvasDocumentSurface({ presented }) }))
    designSessionFixture.file = demoDesign()
    await act(async () => {
      render(<CanvasPanel />, container)
    })
    expect(container.querySelector('[data-testid="welcome-screen"]')).toBeNull()

    await act(async () => {
      designSessionFixture.file = { ...demoDesign(), name: 'Other' }
      presented.value = false
    })

    expect(container.querySelector('[data-design-hidden]')).toBeNull()
    expect(container.querySelector('[data-testid="welcome-screen"]')).toBeNull()

    await act(async () => { designSessionFixture.file = null })
    expect(container.querySelector('[data-testid="welcome-screen"]')).not.toBeNull()
    await act(async () => { designSessionFixture.file = demoDesign() })
    expect(container.querySelector('[data-design-hidden]'), 'opened from the start screen: hidden until drawn').not.toBeNull()
  })

  it('shows the Design at once on a map that failed: nothing will draw its scene', async () => {
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ documents: createTestCanvasDocumentSurface({ presented: signal(false) }) }))
    designSessionFixture.file = demoDesign()
    mockBasemapState = { ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE, status: 'error', retryable: true }

    await act(async () => {
      render(<CanvasPanel />, container)
    })

    expect(container.querySelector('[data-design-hidden]')).toBeNull()
    expect(container.querySelector('[data-testid="welcome-screen"]')).toBeNull()
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

    const notice = container.querySelector<HTMLElement>('[data-map-notice]')!
    expect(notice.querySelector('[role="status"]')!.textContent).toBe('Basemap couldn’t load. Check your connection.')
    const button = [...notice.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Retry')!
    await act(async () => { button.click() })
    expect(retry).toHaveBeenCalledOnce()
  })

  it('hands keyboard focus to the map container once a Retried map is back, before its session returns', async () => {
    let publish!: (state: MapLibreCanvasSurfaceState) => void
    const createRuntimeComposition = vi.fn((options: { onMapStateChange?: (state: MapLibreCanvasSurfaceState) => void }) => {
      publish = (state) => options.onMapStateChange?.(state)
      publish({ ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE, status: 'error', retryable: true })
      return {
        surfaces: {} as never,
        start: () => new Promise<never>(() => {}),
        dispose: async () => {},
        retryMap: () => {},
      } satisfies WorkspaceRuntimeComposition
    })
    await act(async () => {
      render(<WebCanvasWorkspace createRuntimeComposition={createRuntimeComposition} />, container)
    })
    await act(async () => { await vi.waitFor(() => expect(createRuntimeComposition).toHaveBeenCalledOnce()) })
    const map = container.querySelector<HTMLElement>('[data-testid="web-canvas-workspace-surface"]')!
    const retry = [...container.querySelectorAll<HTMLButtonElement>('[data-map-notice] button')]
      .find((button) => button.textContent === 'Retry')!
    retry.focus()

    await act(async () => { retry.click() })
    await act(async () => { publish({ ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE, status: 'loading' }) })
    await act(async () => { publish({ ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE, status: 'ready' }) })

    expect(container.querySelector('[data-map-notice]')).toBeNull()
    expect(document.activeElement).toBe(map)
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
