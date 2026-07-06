import type { BasemapStyle } from '../generated/contracts'
import { createMapLibreBasemapStyle } from './config'
import type {
  MapLibreApi,
  MapLibreHostViewState,
  MapLibreMapInstance,
} from './host'

export interface WorldMapLibreMap extends MapLibreMapInstance {
  addControl(control: unknown, position?: string): void
  fitBounds(bounds: WorldMapBounds, options: { padding: number; maxZoom: number; duration: number }): void
  flyTo(options: {
    center: [number, number]
    zoom?: number
    duration?: number
    essential?: boolean
  }): void
  getCenter(): { lng: number; lat: number }
  getZoom(): number
}

export interface WorldMapMarker {
  setLngLat(lngLat: [number, number]): WorldMapMarker
  addTo(map: WorldMapLibreMap): WorldMapMarker
  remove(): void
  getElement(): HTMLElement
}

export interface WorldMapBounds {
  extend(lngLat: [number, number]): void
  isEmpty(): boolean
}

interface WorldMapLibreApi extends MapLibreApi {
  NavigationControl?: new (options?: {
    visualizePitch?: boolean
    showCompass?: boolean
    showZoom?: boolean
  }) => unknown
  Marker?: new (options: { element: HTMLElement }) => WorldMapMarker
  LngLatBounds?: new () => WorldMapBounds
}

export interface WorldMapLibreOptions {
  readonly basemapStyle: BasemapStyle
  readonly center: [number, number]
  readonly zoom: number
}

export function createWorldMapLibreMap(
  maplibre: MapLibreApi,
  container: HTMLElement,
  options: WorldMapLibreOptions,
): WorldMapLibreMap {
  const map = new maplibre.Map({
    container,
    style: createMapLibreBasemapStyle(options.basemapStyle),
    center: options.center,
    zoom: options.zoom,
    attributionControl: { compact: true },
    interactive: true,
    pitchWithRotate: false,
    dragRotate: false,
    touchZoomRotate: false,
  }) as unknown as WorldMapLibreMap

  try {
    const NavigationControl = (maplibre as WorldMapLibreApi).NavigationControl
    if (NavigationControl) {
      map.addControl(new NavigationControl({
        visualizePitch: false,
        showCompass: false,
        showZoom: true,
      }), 'top-right')
    }
  } catch (error) {
    map.remove()
    throw error
  }

  return map
}

export function createWorldMapMarker(
  maplibre: MapLibreApi,
  element: HTMLElement,
): WorldMapMarker {
  const Marker = (maplibre as WorldMapLibreApi).Marker
  if (!Marker) throw new Error('MapLibre Marker constructor unavailable')
  return new Marker({ element })
}

export function createWorldMapBounds(maplibre: MapLibreApi): WorldMapBounds {
  const LngLatBounds = (maplibre as WorldMapLibreApi).LngLatBounds
  if (!LngLatBounds) throw new Error('MapLibre LngLatBounds constructor unavailable')
  return new LngLatBounds()
}

export function readWorldMapViewState(map: WorldMapLibreMap): MapLibreHostViewState {
  const center = map.getCenter()
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
  }
}
