import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale } from '../app/settings/state'
import { LocationTab } from '../components/canvas/LocationTab'
import { currentDesign } from './support/design-session-state'
import type { CanopiFile } from '../types/design'

const maplibreMock = vi.hoisted(() => ({
  mapConstructor: vi.fn(),
  navigationControlConstructor: vi.fn(),
}))

vi.mock('maplibre-gl', () => ({
  default: {
    Map: maplibreMock.mapConstructor,
    NavigationControl: maplibreMock.navigationControlConstructor,
  },
}))

function makeDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 2,
    name: 'Location tab map failure test',
    description: null,
    location: null,
    north_bearing_deg: null,
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
    extra: {},
    created_at: '2026-04-08T00:00:00.000Z',
    updated_at: '2026-04-08T00:00:00.000Z',
    ...overrides,
  }
}

class FakeLocationTabMap {
  readonly addControl = vi.fn()
  readonly remove = vi.fn()
  readonly resize = vi.fn()
  readonly handlers = new Map<string, Set<(event?: unknown) => void>>()
  readonly loaded = vi.fn(() => false)
  readonly isStyleLoaded = vi.fn(() => false)

  constructor(private readonly container: HTMLElement) {
    Object.defineProperty(container, 'clientWidth', { value: 240, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 180, configurable: true })
  }

  on(event: string, handler: (event?: unknown) => void): void {
    const handlers = this.handlers.get(event) ?? new Set()
    handlers.add(handler)
    this.handlers.set(event, handlers)
  }

  off(event: string, handler: (event?: unknown) => void): void {
    this.handlers.get(event)?.delete(handler)
  }

  fire(event: string, payload?: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload)
  }

  getCenter() {
    return { lng: 2.3522, lat: 48.8566 }
  }

  getZoom() {
    return 10
  }

  getContainer() {
    return this.container
  }

  project() {
    return { x: 120, y: 80 }
  }

  easeTo() {}
}

function requireFakeLocationTabMap(map: FakeLocationTabMap | null): FakeLocationTabMap {
  if (!map) throw new Error('Fake Location tab map was not created')
  return map
}

describe('LocationTab map failures', () => {
  let container: HTMLDivElement
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      disconnect() {}
    }
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    currentDesign.value = makeDesign()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    maplibreMock.mapConstructor.mockReset()
    maplibreMock.navigationControlConstructor.mockReset()
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    currentDesign.value = null
    consoleError.mockRestore()
  })

  it('keeps the location panel mounted when MapLibre initialization throws', async () => {
    maplibreMock.mapConstructor.mockImplementation(function () {
      throw new Error('Worker blocked by CSP')
    })

    await act(async () => {
      render(<LocationTab />, container)
    })

    await vi.waitFor(() => {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Map unavailable')
    })
    expect(container.querySelector('input')?.getAttribute('placeholder')).toBe('Search for a location...')
    expect(maplibreMock.navigationControlConstructor).not.toHaveBeenCalled()
  })

  it('surfaces MapLibre runtime errors before the style is ready', async () => {
    let map: FakeLocationTabMap | null = null
    maplibreMock.mapConstructor.mockImplementation(function (options: { container: HTMLElement }) {
      map = new FakeLocationTabMap(options.container)
      return map
    })

    await act(async () => {
      render(<LocationTab />, container)
    })

    await vi.waitFor(() => {
      expect(maplibreMock.mapConstructor).toHaveBeenCalledTimes(1)
    })

    const currentMap = requireFakeLocationTabMap(map)
    await act(async () => {
      currentMap.fire('error', { error: new Error('style worker failed') })
    })

    await vi.waitFor(() => {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Map unavailable')
    })
    expect(container.querySelector('input')?.getAttribute('placeholder')).toBe('Search for a location...')
    expect(currentMap.remove).toHaveBeenCalledTimes(1)
  })

  it('keeps a ready map mounted when MapLibre reports a nonfatal runtime error', async () => {
    let map: FakeLocationTabMap | null = null
    maplibreMock.mapConstructor.mockImplementation(function (options: { container: HTMLElement }) {
      map = new FakeLocationTabMap(options.container)
      map.loaded.mockReturnValue(true)
      return map
    })

    await act(async () => {
      render(<LocationTab />, container)
    })

    await vi.waitFor(() => {
      expect(maplibreMock.mapConstructor).toHaveBeenCalledTimes(1)
    })

    const currentMap = requireFakeLocationTabMap(map)
    await act(async () => {
      currentMap.fire('error', { error: new Error('tile failed') })
    })

    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(currentMap.remove).not.toHaveBeenCalled()
  })
})
