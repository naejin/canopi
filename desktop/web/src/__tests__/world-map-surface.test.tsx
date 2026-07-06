import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { basemapStyle } from '../app/settings/state'
import { WorldMapSurface } from '../components/world-map/WorldMapSurface'
import type { TemplateMeta } from '../types/community'

const maplibreMock = vi.hoisted(() => ({
  mapConstructor: vi.fn(),
  navigationControlConstructor: vi.fn(),
  markerConstructor: vi.fn(),
  boundsConstructor: vi.fn(),
}))

vi.mock('maplibre-gl', () => ({
  default: {
    Map: maplibreMock.mapConstructor,
    NavigationControl: maplibreMock.navigationControlConstructor,
    Marker: maplibreMock.markerConstructor,
    LngLatBounds: maplibreMock.boundsConstructor,
  },
}))

class FakeWorldMap {
  readonly addControl = vi.fn()
  readonly remove = vi.fn()
  readonly resize = vi.fn()
  readonly fitBounds = vi.fn()
  readonly flyTo = vi.fn()
  center = { lng: 0, lat: 14 }
  zoom = 1.15

  constructor(readonly options: Record<string, unknown>) {}

  getCenter() {
    return this.center
  }

  getZoom() {
    return this.zoom
  }
}

class FakeMarker {
  readonly remove = vi.fn()
  readonly setLngLat = vi.fn((lngLat: [number, number]) => {
    this.lngLat = lngLat
    return this
  })
  readonly addTo = vi.fn((map: FakeWorldMap) => {
    this.map = map
    return this
  })
  lngLat: [number, number] | null = null
  map: FakeWorldMap | null = null

  constructor(readonly options: { element: HTMLElement }) {}

  getElement(): HTMLElement {
    return this.options.element
  }
}

class FakeBounds {
  readonly points: Array<[number, number]> = []

  extend(lngLat: [number, number]): void {
    this.points.push(lngLat)
  }

  isEmpty(): boolean {
    return this.points.length === 0
  }
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  readonly observe = vi.fn()
  readonly disconnect = vi.fn()

  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }
}

function template(id: string, lon: number, lat: number): TemplateMeta {
  return {
    id,
    title: `Template ${id}`,
    author: 'Canopi',
    description: '',
    location: { lon, lat, altitude_m: null },
    plant_count: 12,
    climate_zone: 'temperate',
    tags: [],
    screenshot_url: null,
    download_url: `/templates/${id}.canopi`,
  }
}

async function renderWorldMap(
  container: HTMLElement,
  props: {
    templates: TemplateMeta[]
    selectedId: string | null
    onSelect: (template: TemplateMeta) => void
  },
): Promise<void> {
  await act(async () => {
    render(<WorldMapSurface {...props} />, container)
  })
}

describe('WorldMapSurface', () => {
  let container: HTMLDivElement
  let maps: FakeWorldMap[]
  let markers: FakeMarker[]

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).ResizeObserver = FakeResizeObserver
    FakeResizeObserver.instances = []
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    basemapStyle.value = 'street'
    maps = []
    markers = []
    maplibreMock.mapConstructor.mockReset()
    maplibreMock.navigationControlConstructor.mockReset()
    maplibreMock.markerConstructor.mockReset()
    maplibreMock.boundsConstructor.mockReset()
    maplibreMock.mapConstructor.mockImplementation(function (options: Record<string, unknown>) {
      const map = new FakeWorldMap(options)
      maps.push(map)
      return map
    })
    maplibreMock.navigationControlConstructor.mockImplementation(function () {
      return {}
    })
    maplibreMock.markerConstructor.mockImplementation(function (options: { element: HTMLElement }) {
      const marker = new FakeMarker(options)
      markers.push(marker)
      return marker
    })
    maplibreMock.boundsConstructor.mockImplementation(function () {
      return new FakeBounds()
    })
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    basemapStyle.value = 'street'
  })

  it('renders template markers, fits their bounds, selects markers, flies to selection, and resizes through the host', async () => {
    const first = template('forest', 2.35, 48.85)
    const second = template('orchard', 13.4, 52.52)
    const onSelect = vi.fn()

    await renderWorldMap(container, {
      templates: [first, second],
      selectedId: null,
      onSelect,
    })
    await vi.waitFor(() => expect(maps).toHaveLength(1))
    await vi.waitFor(() => expect(markers).toHaveLength(2))

    expect(maps[0]!.options).toMatchObject({
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: false,
    })
    expect(maplibreMock.navigationControlConstructor).toHaveBeenCalledWith({
      visualizePitch: false,
      showCompass: false,
      showZoom: true,
    })
    expect(markers[0]!.lngLat).toEqual([2.35, 48.85])
    expect(markers[1]!.lngLat).toEqual([13.4, 52.52])
    expect(maps[0]!.fitBounds).toHaveBeenCalledWith(
      expect.objectContaining({ points: [[2.35, 48.85], [13.4, 52.52]] }),
      { padding: 48, maxZoom: 4.5, duration: 0 },
    )

    markers[1]!.getElement().click()
    expect(onSelect).toHaveBeenCalledWith(second)

    await renderWorldMap(container, {
      templates: [first, second],
      selectedId: 'orchard',
      onSelect,
    })
    await vi.waitFor(() => expect(markers).toHaveLength(4))
    const latestMarkers = markers.slice(-2)
    expect(latestMarkers[1]!.getElement().className).not.toBe(latestMarkers[0]!.getElement().className)
    expect(maps[0]!.flyTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [13.4, 52.52],
      zoom: 4.5,
    }))

    maps[0]!.resize.mockClear()
    act(() => {
      FakeResizeObserver.instances[0]?.callback([], {} as ResizeObserver)
    })
    expect(maps[0]!.resize).toHaveBeenCalled()
  })

  it('preserves the current world map view when the basemap style rebuilds', async () => {
    const templates = [template('forest', 2.35, 48.85)]

    await renderWorldMap(container, {
      templates,
      selectedId: null,
      onSelect: vi.fn(),
    })
    await vi.waitFor(() => expect(maps).toHaveLength(1))

    maps[0]!.center = { lng: -74.006, lat: 40.7128 }
    maps[0]!.zoom = 6
    act(() => {
      basemapStyle.value = 'satellite'
    })

    await vi.waitFor(() => expect(maps).toHaveLength(2))
    expect(maps[0]!.remove).toHaveBeenCalled()
    expect(maps[1]!.options).toMatchObject({
      center: [-74.006, 40.7128],
      zoom: 6,
    })
  })
})
