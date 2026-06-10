import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useLocationWorkbench,
  type LocationWorkbench,
} from '../app/location'
import {
  useLocationMapEditingHost,
  type LocationMapEditingHost,
} from '../app/location/map-editing'
import { basemapStyle, locale } from '../app/settings/state'
import { currentDesign, nonCanvasRevision } from './support/design-session-state'
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
    name: 'Location map editing host test',
    description: null,
    location: { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
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

class FakeLocationMap {
  readonly addControl = vi.fn()
  readonly remove = vi.fn()
  readonly resize = vi.fn()
  readonly easeTo = vi.fn((options: { center: [number, number] }) => {
    this.center = { lng: options.center[0], lat: options.center[1] }
  })
  readonly handlers = new Map<string, Set<() => void>>()
  center = { lng: 2.3522, lat: 48.8566 }
  zoom = 10
  projected = { x: 120, y: 80 }

  constructor(private readonly container: HTMLElement) {
    Object.defineProperty(container, 'clientWidth', { value: 240, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 180, configurable: true })
  }

  on(event: string, handler: () => void): void {
    const handlers = this.handlers.get(event) ?? new Set()
    handlers.add(handler)
    this.handlers.set(event, handlers)
  }

  off(event: string, handler: () => void): void {
    this.handlers.get(event)?.delete(handler)
  }

  fire(event: string): void {
    for (const handler of this.handlers.get(event) ?? []) handler()
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
  static instances: FakeResizeObserver[] = []
  element: Element | null = null

  constructor(readonly callback: () => void) {
    FakeResizeObserver.instances.push(this)
  }

  observe(element: Element): void {
    this.element = element
  }

  disconnect(): void {
    this.element = null
  }
}

function HostProbe({ onRender }: {
  onRender: (workbench: LocationWorkbench, host: LocationMapEditingHost) => void
}) {
  const workbench = useLocationWorkbench()
  const host = useLocationMapEditingHost(workbench)
  onRender(workbench, host)
  return <div ref={host.mapContainerRef} />
}

async function flushMapHost(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('Location map editing host', () => {
  let container: HTMLDivElement
  let workbench: LocationWorkbench | null
  let host: LocationMapEditingHost | null
  let map: FakeLocationMap | null

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).ResizeObserver = FakeResizeObserver
    FakeResizeObserver.instances = []
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    basemapStyle.value = 'street'
    currentDesign.value = makeDesign()
    nonCanvasRevision.value = 0
    workbench = null
    host = null
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
  })

  function renderProbe() {
    act(() => {
      render(
        <HostProbe
          onRender={(nextWorkbench, nextHost) => {
            workbench = nextWorkbench
            host = nextHost
          }}
        />,
        container,
      )
    })
  }

  function currentHost(): LocationMapEditingHost {
    if (!host) throw new Error('Location map editing host was not rendered')
    return host
  }

  function currentMap(): FakeLocationMap {
    if (!map) throw new Error('Fake map was not created')
    return map
  }

  it('owns saved pin projection, pending search preview, drag clearing, resize, and map commits', async () => {
    renderProbe()
    await vi.waitFor(() => expect(currentHost().pin.visible).toBe(true))
    await flushMapHost()

    expect(currentHost().pin).toMatchObject({ visible: true, x: 120, y: 80, clamped: false })

    act(() => {
      currentHost().previewSearchResult({ displayName: 'Berlin', lat: 52.52, lon: 13.405 })
    })
    expect(currentMap().easeTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [13.405, 52.52],
      zoom: 14,
    }))

    act(() => {
      currentHost().commitMapLocation()
    })
    expect(currentDesign.value?.location).toEqual({ lat: 52.52, lon: 13.405, altitude_m: 35 })

    act(() => {
      currentHost().previewSearchResult({ displayName: 'Ignored', lat: 1, lon: 1 })
      currentMap().center = { lng: -74.006, lat: 40.7128 }
      currentMap().fire('dragstart')
      currentHost().commitMapLocation()
    })
    expect(currentDesign.value?.location).toEqual({ lat: 40.7128, lon: -74.006, altitude_m: 35 })

    act(() => {
      currentMap().projected = { x: 230, y: 170 }
      FakeResizeObserver.instances[0]?.callback()
    })
    expect(currentMap().resize).toHaveBeenCalled()
    expect(currentHost().pin).toMatchObject({ visible: true, x: 216, y: 156, clamped: true })
    expect(workbench?.pendingMapResult).toBeNull()
    expect(nonCanvasRevision.value).toBe(2)
  })

  it('preserves the current map view when the basemap style rebuilds', async () => {
    renderProbe()
    await vi.waitFor(() => expect(maplibreMock.mapConstructor).toHaveBeenCalledTimes(1))

    currentMap().center = { lng: 13.405, lat: 52.52 }
    currentMap().zoom = 8
    act(() => {
      basemapStyle.value = 'satellite'
    })

    await vi.waitFor(() => expect(maplibreMock.mapConstructor).toHaveBeenCalledTimes(2))
    expect(maplibreMock.mapConstructor.mock.calls[1]?.[0]).toMatchObject({
      center: [13.405, 52.52],
      zoom: 8,
    })
  })

  it('uses the latest saved Location when lazy map creation completes', async () => {
    renderProbe()

    act(() => {
      currentDesign.value = makeDesign({
        location: { lat: 52.52, lon: 13.405, altitude_m: 45 },
      })
    })

    await vi.waitFor(() => expect(maplibreMock.mapConstructor).toHaveBeenCalledTimes(1))

    expect(maplibreMock.mapConstructor.mock.calls[0]?.[0]).toMatchObject({
      center: [13.405, 52.52],
      zoom: 10,
    })
  })
})
