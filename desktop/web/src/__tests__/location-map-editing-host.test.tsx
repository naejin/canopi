import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeBasemapContribution } from './support/fake-basemap-contribution'
import {
  useLocationWorkbench,
  type LocationWorkbench,
} from '../app/location'
import {
  useLocationMapEditingHost,
  type LocationMapEditingHost,
} from '../app/location/map-editing'
import { basemapStyle, locale } from '../app/settings/state'
import {
  designSessionFixture,
  currentDesign,
  nonCanvasRevision,
} from './support/design-session-state'
import type { CanopiFile } from '../types/design'

const maplibreMock = vi.hoisted(() => ({
  mapConstructor: vi.fn(),
  navigationControlConstructor: vi.fn(),
}))

vi.mock('maplibre-gl', () => ({
  Map: maplibreMock.mapConstructor,
  NavigationControl: maplibreMock.navigationControlConstructor,
  setWorkerUrl: vi.fn(),
}))

function makeDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 6,
    name: 'Location map editing host test',
    description: null,
    spatial_frame: { anchor_longitude_deg: 2.3522, anchor_latitude_deg: 48.8566, north_bearing_deg: 0, placement_status: 'confirmed', location_metadata: { altitude_m: 35 } },
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
  // The app reconciles the basemap provider into whichever map is live, so the
  // fake offers that surface; without it the binding legitimately throws.
  readonly contribution = createFakeBasemapContribution()
  readonly addSource = this.contribution.addSource.bind(this.contribution)
  readonly getSource = this.contribution.getSource.bind(this.contribution)
  readonly removeSource = this.contribution.removeSource.bind(this.contribution)
  readonly addLayer = this.contribution.addLayer.bind(this.contribution)
  readonly getLayer = this.contribution.getLayer.bind(this.contribution)
  readonly removeLayer = this.contribution.removeLayer.bind(this.contribution)
  readonly setLayoutProperty = this.contribution.setLayoutProperty.bind(this.contribution)
  readonly addControl = vi.fn()
  readonly remove = vi.fn()
  readonly resize = vi.fn()
  readonly easeTo = vi.fn((options: { center: [number, number] }) => {
    this.center = { lng: options.center[0], lat: options.center[1] }
  })
  readonly handlers = new Map<string, Set<(event?: unknown) => void>>()
  center: { lng: number; lat: number }
  zoom = 10
  projected = { x: 120, y: 80 }

  constructor(private readonly container: HTMLElement, center: [number, number]) {
    this.center = { lng: center[0], lat: center[1] }
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
    designSessionFixture.file = makeDesign()
    designSessionFixture.nonCanvasRevision = 0
    workbench = null
    host = null
    map = null
    maplibreMock.mapConstructor.mockReset()
    maplibreMock.navigationControlConstructor.mockReset()
    maplibreMock.mapConstructor.mockImplementation(function (options: { container: HTMLElement; center: [number, number] }) {
      map = new FakeLocationMap(options.container, options.center)
      return map
    })
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    designSessionFixture.file = null
    designSessionFixture.nonCanvasRevision = 0
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

  it('commits search, panned-center, and clicked locations through one action', async () => {
    renderProbe()
    await vi.waitFor(() => expect(currentHost().pin.visible).toBe(true))
    await flushMapHost()

    expect(maplibreMock.mapConstructor.mock.calls[0]?.[0]).toMatchObject({
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: false,
    })
    expect(maplibreMock.navigationControlConstructor).toHaveBeenCalledWith({
      visualizePitch: false,
      showCompass: false,
      showZoom: true,
    })
    expect(currentHost().pin).toMatchObject({ visible: true, x: 120, y: 80, clamped: false })
    expect(currentHost().canConfirmLocation).toBe(false)

    act(() => {
      currentHost().previewSearchResult({ displayName: 'Invalid', lat: 91, lon: 13.405 })
    })
    expect(currentHost().canConfirmLocation).toBe(false)
    expect(currentDesign.value?.spatial_frame).toMatchObject({
      anchor_latitude_deg: 48.8566,
      anchor_longitude_deg: 2.3522,
    })

    act(() => {
      currentHost().previewSearchResult({ displayName: 'Berlin', lat: 52.52, lon: 13.405 })
    })
    expect(currentMap().easeTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [13.405, 52.52],
      zoom: 14,
    }))
    expect(currentHost().canConfirmLocation).toBe(true)

    act(() => {
      expect(currentHost().confirmLocation()).toBe(true)
    })
    expect(currentDesign.value?.spatial_frame).toMatchObject({ anchor_latitude_deg: 52.52, anchor_longitude_deg: 13.405, location_metadata: { altitude_m: 35 } })
    expect(nonCanvasRevision.value).toBe(1)

    act(() => {
      currentMap().center = { lng: -74.006, lat: 40.7128 }
      currentMap().fire('move')
    })
    expect(currentHost().canConfirmLocation).toBe(true)

    act(() => {
      expect(currentHost().confirmLocation()).toBe(true)
    })
    expect(currentDesign.value?.spatial_frame).toMatchObject({ anchor_latitude_deg: 40.7128, anchor_longitude_deg: -74.006, location_metadata: { altitude_m: 35 } })
    expect(nonCanvasRevision.value).toBe(2)

    act(() => {
      currentMap().fire('click', { lngLat: { lng: -0.1276, lat: 51.5072 } })
    })
    expect(currentDesign.value?.spatial_frame).toMatchObject({ anchor_latitude_deg: 51.5072, anchor_longitude_deg: -0.1276, location_metadata: { altitude_m: 35 } })
    expect(nonCanvasRevision.value).toBe(2)

    act(() => {
      expect(currentHost().confirmLocation()).toBe(true)
    })

    act(() => {
      currentMap().projected = { x: 230, y: 170 }
      FakeResizeObserver.instances[0]?.callback()
    })
    expect(currentMap().resize).toHaveBeenCalled()
    expect(currentHost().pin).toMatchObject({ visible: true, x: 216, y: 156, clamped: true })
    expect(workbench?.pendingPlacement).toBeNull()
    expect(nonCanvasRevision.value).toBe(3)
  })

  it('changes the basemap on the live map without rebuilding it', async () => {
    renderProbe()
    await vi.waitFor(() => expect(maplibreMock.mapConstructor).toHaveBeenCalledTimes(1))
    const map = currentMap()
    map.center = { lng: 13.405, lat: 52.52 }
    map.zoom = 8

    act(() => {
      basemapStyle.value = 'satellite'
    })

    // The provider reconciles into the live map, so a basemap change must not
    // recreate the map or disturb the camera. This test used to require the
    // rebuild, which is precisely what the product contract forbids: recreating
    // the map on a provider, key or session change is what loses the camera, the
    // placement crosshair and an edit in progress.
    await vi.waitFor(() => expect(map.contribution.sources.size).toBe(0))
    expect(maplibreMock.mapConstructor).toHaveBeenCalledTimes(1)
    expect(map.remove).not.toHaveBeenCalled()
    expect(map.center).toEqual({ lng: 13.405, lat: 52.52 })
    expect(map.zoom).toBe(8)
  })

  it('uses the latest saved Location when lazy map creation completes', async () => {
    renderProbe()

    act(() => {
      designSessionFixture.file = makeDesign({
        spatial_frame: { anchor_longitude_deg: 13.405, anchor_latitude_deg: 52.52, north_bearing_deg: 0, placement_status: 'confirmed', location_metadata: { altitude_m: 45 } },
      })
    })

    await vi.waitFor(() => expect(maplibreMock.mapConstructor).toHaveBeenCalledTimes(1))

    expect(maplibreMock.mapConstructor.mock.calls[0]?.[0]).toMatchObject({
      center: [13.405, 52.52],
      zoom: 10,
    })
  })

  it('centres a provisional Design on its authored anchor without showing a saved pin', async () => {
    designSessionFixture.file = makeDesign({
      spatial_frame: { anchor_longitude_deg: 13, anchor_latitude_deg: 23, north_bearing_deg: 0, placement_status: 'provisional', location_metadata: { altitude_m: null } },
    })

    renderProbe()
    await vi.waitFor(() => expect(maplibreMock.mapConstructor).toHaveBeenCalledTimes(1))

    expect(maplibreMock.mapConstructor.mock.calls[0]?.[0]).toMatchObject({
      center: [13, 23],
      zoom: 3.2,
    })
    expect(currentHost().pin.visible).toBe(false)
    expect(currentHost().canConfirmLocation).toBe(true)

    act(() => {
      expect(currentHost().confirmLocation()).toBe(true)
    })
    expect(currentDesign.value?.spatial_frame).toMatchObject({
      anchor_longitude_deg: 13,
      anchor_latitude_deg: 23,
      placement_status: 'confirmed',
    })
    expect(nonCanvasRevision.value).toBe(1)
    expect(currentHost().canConfirmLocation).toBe(false)
  })
})
