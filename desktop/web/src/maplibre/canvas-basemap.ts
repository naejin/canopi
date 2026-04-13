import type { MapFrame } from '../canvas/maplibre-camera'
import {
  MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
  MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
  createDefaultMapLibreBasemapStyle,
  REMOTE_BASEMAP_TILE_URL_TEMPLATE,
} from './config'
import type { MapLibreApi, MapLibreMapInstance } from '../components/canvas/maplibre-loader'

export interface BasemapPresentationMap {
  isStyleLoaded?(): boolean
  setPaintProperty?(layerId: string, property: string, value: unknown): void
}

export function createCanvasMapLibreMap(
  maplibre: MapLibreApi,
  container: HTMLElement,
  initialCamera: MapFrame | null,
): MapLibreMapInstance {
  return new maplibre.Map({
    container,
    style: createDefaultMapLibreBasemapStyle(REMOTE_BASEMAP_TILE_URL_TEMPLATE),
    center: initialCamera ? [initialCamera.center[0], initialCamera.center[1]] : undefined,
    zoom: initialCamera?.zoom,
    bearing: initialCamera?.bearing,
    attributionControl: false,
    interactive: false,
    pitchWithRotate: false,
    dragRotate: false,
    touchZoomRotate: false,
  })
}

export function isMapLibreStyleReady(
  map: BasemapPresentationMap,
  currentStatus: 'idle' | 'loading' | 'ready' | 'error',
): boolean {
  const isStyleLoaded = map.isStyleLoaded?.()
  if (typeof isStyleLoaded === 'boolean') return isStyleLoaded
  return currentStatus === 'ready'
}

export function syncBasemapPresentation(
  map: BasemapPresentationMap,
  currentStatus: 'idle' | 'loading' | 'ready' | 'error',
  basemapVisible: boolean,
  basemapOpacity: number,
): void {
  if (!isMapLibreStyleReady(map, currentStatus)) return

  const effectiveOpacity = basemapVisible ? basemapOpacity : 0
  map.setPaintProperty?.(
    MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
    'background-opacity',
    effectiveOpacity,
  )
  map.setPaintProperty?.(
    MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
    'raster-opacity',
    effectiveOpacity,
  )
}
