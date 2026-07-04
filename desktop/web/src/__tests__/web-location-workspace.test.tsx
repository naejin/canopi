import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { basemapStyle, locale } from '../app/settings/state'
import { REMOTE_BASEMAP_TILE_URL_TEMPLATE } from '../maplibre/config'
import type { CanopiFile } from '../types/design'
import { WebLocationWorkspace } from '../web/WebLocationWorkspace'
import { currentDesign, nonCanvasRevision } from './support/design-session-state'

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
    name: 'Web Location workspace test',
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
    created_at: '2026-07-04T00:00:00.000Z',
    updated_at: '2026-07-04T00:00:00.000Z',
    ...overrides,
  }
}

class FakeLocationMap {
  readonly addControl = vi.fn()
  readonly remove = vi.fn()
  readonly resize = vi.fn()
  readonly easeTo = vi.fn()
  readonly handlers = new Map<string, Set<(event?: unknown) => void>>()
  center = { lng: 2.3522, lat: 48.8566 }
  zoom = 10
  projected = { x: 120, y: 80 }

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
    return this.center
  }

  getZoom() {
    return this.zoom
  }

  getContainer() {
    return this.container
  }

  project() {
    return this.projected
  }
}

class FakeResizeObserver {
  constructor(readonly callback: () => void) {}

  observe(): void {}
  disconnect(): void {}
}

describe('Web Edition Location workspace', () => {
  let container: HTMLDivElement
  let map: FakeLocationMap | null

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).ResizeObserver = FakeResizeObserver
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    currentDesign.value = makeDesign()
    nonCanvasRevision.value = 0
    locale.value = 'en'
    basemapStyle.value = 'street'
    map = null
    maplibreMock.mapConstructor.mockReset()
    maplibreMock.navigationControlConstructor.mockReset()
    maplibreMock.mapConstructor.mockImplementation(function (options: { container: HTMLElement }) {
      map = new FakeLocationMap(options.container)
      return map
    })
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    currentDesign.value = null
    nonCanvasRevision.value = 0
    vi.restoreAllMocks()
  })

  it('saves manual coordinates without rendering address search controls', async () => {
    await renderWorkspace()

    expect(container.querySelector('[data-testid="web-location-workspace"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Address')
    expect(container.querySelector('input[placeholder="Search for a location..."]')).toBeNull()

    setInput('web-location-latitude', '48.8566')
    setInput('web-location-longitude', '2.3522')
    setInput('web-location-altitude', '35')
    click('web-location-save-manual')

    expect(currentDesign.value?.location).toEqual({ lat: 48.8566, lon: 2.3522, altitude_m: 35 })
    expect(nonCanvasRevision.value).toBe(1)
  })

  it('uses the street basemap and saves clicked map coordinates', async () => {
    basemapStyle.value = 'satellite'
    currentDesign.value = makeDesign({
      location: { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
    })

    await renderWorkspace()
    await vi.waitFor(() => expect(maplibreMock.mapConstructor).toHaveBeenCalledOnce())

    const style = maplibreMock.mapConstructor.mock.calls[0]?.[0]?.style
    expect(JSON.stringify(style)).toContain(REMOTE_BASEMAP_TILE_URL_TEMPLATE)
    expect(JSON.stringify(style)).not.toContain('api.maptiler.com')
    expect(container.textContent).not.toContain('Satellite')
    expect(container.textContent).not.toContain('Terrain')
    expect(container.textContent).not.toContain('Offline')

    act(() => {
      currentMap().fire('click', { lngLat: { lng: 13.405, lat: 52.52 } })
    })

    expect(currentDesign.value?.location).toEqual({ lat: 52.52, lon: 13.405, altitude_m: 35 })
  })

  it('presents map failures without changing the saved Location', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    currentDesign.value = makeDesign({
      location: { lat: 40.7128, lon: -74.006, altitude_m: null },
    })
    maplibreMock.mapConstructor.mockImplementationOnce(() => {
      throw new Error('Map unavailable')
    })

    await renderWorkspace()
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('Map unavailable'))

    click('web-location-save-map')

    expect(logError).toHaveBeenCalled()
    expect(currentDesign.value?.location).toEqual({ lat: 40.7128, lon: -74.006, altitude_m: null })
  })

  async function renderWorkspace(): Promise<void> {
    await act(async () => {
      render(<WebLocationWorkspace />, container)
    })
  }

  function currentMap(): FakeLocationMap {
    if (!map) throw new Error('Fake map was not created')
    return map
  }

  function setInput(testId: string, value: string): void {
    const input = container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)
    if (!input) throw new Error(`Missing input ${testId}`)
    act(() => {
      input.value = value
      input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
  }

  function click(testId: string): void {
    const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
    if (!button) throw new Error(`Missing button ${testId}`)
    act(() => {
      button.click()
    })
  }
})
