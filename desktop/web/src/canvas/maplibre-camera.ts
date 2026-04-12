import type { SceneViewportState } from './runtime/scene'
import { stageScaleToMapZoom, worldToGeo } from './projection'

export interface MapLibreCameraLocation {
  readonly lat: number
  readonly lon: number
}

export interface MapLibreCameraScreenSize {
  readonly width: number
  readonly height: number
}

export interface MapLibreCameraOptions {
  readonly center: readonly [number, number]
  readonly zoom: number
  readonly bearing: number
}

const MAPLIBRE_MIN_ZOOM = 0
const MAPLIBRE_MAX_ZOOM = 24

function clampZoom(zoom: number): number {
  return Math.min(MAPLIBRE_MAX_ZOOM, Math.max(MAPLIBRE_MIN_ZOOM, zoom))
}

export function computeMapLibreCamera(
  viewport: SceneViewportState,
  screenSize: MapLibreCameraScreenSize,
  location: MapLibreCameraLocation | null,
  northBearingDeg: number | null,
): MapLibreCameraOptions | null {
  if (!location) return null
  if (screenSize.width <= 0 || screenSize.height <= 0) return null
  if (viewport.scale <= 0) return null

  const centerWorldX = (screenSize.width / 2 - viewport.x) / viewport.scale
  const centerWorldY = (screenSize.height / 2 - viewport.y) / viewport.scale
  const center = worldToGeo(centerWorldX, centerWorldY, location.lat, location.lon)

  return {
    center: [center.lng, center.lat],
    zoom: clampZoom(stageScaleToMapZoom(viewport.scale, location.lat)),
    bearing: northBearingDeg ?? 0,
  }
}
