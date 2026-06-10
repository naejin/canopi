import type { BasemapStyle } from '../generated/contracts'
import { createMapLibreBasemapStyle } from './config'
import type {
  MapLibreApi,
  MapLibreHostViewState,
  MapLibreMapInstance,
} from './host'

export interface LocationMapLibreMap extends MapLibreMapInstance {
  addControl(control: unknown, position?: string): void
  easeTo(options: {
    center: [number, number]
    zoom?: number
    duration?: number
    essential?: boolean
  }): void
  getCenter(): { lng: number; lat: number }
  getZoom(): number
  getContainer(): HTMLElement
  project(lngLat: [number, number]): { x: number; y: number }
  on(type: 'load' | 'error' | 'sourcedata', listener: (event?: unknown) => void): void
  on(type: 'move' | 'moveend' | 'dragstart', listener: () => void): void
  off(type: 'load' | 'error' | 'sourcedata', listener: (event?: unknown) => void): void
  off(type: 'move' | 'moveend' | 'dragstart', listener: () => void): void
}

interface LocationNavigationControlApi extends MapLibreApi {
  NavigationControl?: new (options?: { visualizePitch?: boolean }) => unknown
}

export interface LocationMapLibreOptions {
  readonly basemapStyle: BasemapStyle
  readonly center: [number, number]
  readonly zoom: number
}

export function createLocationMapLibreMap(
  maplibre: MapLibreApi,
  container: HTMLElement,
  options: LocationMapLibreOptions,
): LocationMapLibreMap {
  const map = new maplibre.Map({
    container,
    style: createMapLibreBasemapStyle(options.basemapStyle),
    center: options.center,
    zoom: options.zoom,
    attributionControl: { compact: true },
    interactive: true,
    pitchWithRotate: true,
    dragRotate: true,
    touchZoomRotate: true,
  }) as unknown as LocationMapLibreMap

  try {
    const NavigationControl = (maplibre as LocationNavigationControlApi).NavigationControl
    if (NavigationControl) {
      map.addControl(new NavigationControl({ visualizePitch: false }), 'bottom-right')
    }
  } catch (error) {
    map.remove()
    throw error
  }

  return map
}

export function readLocationMapViewState(
  map: LocationMapLibreMap,
): MapLibreHostViewState {
  const center = map.getCenter()
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
  }
}
