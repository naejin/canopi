import type { SceneViewportState } from './runtime/scene'
import {
  stageScaleToMapZoom,
  viewportCenterGeo,
  viewportCenterWorld,
  viewportCornerGeoPoints,
} from './projection'

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

export interface MapFrameDiagnostics {
  readonly viewportCenterWorld: { x: number; y: number }
  readonly viewportCornerGeo: readonly [
    { lng: number; lat: number },
    { lng: number; lat: number },
    { lng: number; lat: number },
    { lng: number; lat: number },
  ]
}

export interface MapFrame extends MapLibreCameraOptions {
  readonly diagnostics: MapFrameDiagnostics
}

const MAPLIBRE_MIN_ZOOM = 0
// Preserve exact canvas-following behavior as far as the map stack can
// reasonably support it. The raster basemap will overzoom and blur before
// this ceiling, but we do not want to clamp the derived camera early.
const MAPLIBRE_MAX_ZOOM = 30

function clampZoom(zoom: number): number {
  return Math.min(MAPLIBRE_MAX_ZOOM, Math.max(MAPLIBRE_MIN_ZOOM, zoom))
}

function normalizeBearingDegrees(degrees: number): number {
  const normalized = ((degrees % 360) + 360) % 360
  return normalized === 360 ? 0 : normalized
}

export function maplibreBearingFromNorthBearing(northBearingDeg: number | null | undefined): number {
  // Keep document semantics explicit at the integration boundary:
  // north_bearing_deg says where geographic north points in the design.
  // MapLibre bearing says which compass direction is "up" on screen.
  // If north points 90deg clockwise from up in the design, then west is up.
  return normalizeBearingDegrees(-(northBearingDeg ?? 0))
}

export function createMapFrame(
  viewport: SceneViewportState,
  screenSize: MapLibreCameraScreenSize,
  location: MapLibreCameraLocation | null,
  northBearingDeg: number | null,
): MapFrame | null {
  if (!location) return null
  if (screenSize.width <= 0 || screenSize.height <= 0) return null
  if (viewport.scale <= 0) return null

  const center = viewportCenterGeo(
    viewport,
    screenSize,
    location.lat,
    location.lon,
    northBearingDeg,
  )
  const viewportCenter = viewportCenterWorld(viewport, screenSize)

  return {
    center: [center.lng, center.lat],
    zoom: clampZoom(stageScaleToMapZoom(viewport.scale, location.lat)),
    bearing: maplibreBearingFromNorthBearing(northBearingDeg),
    diagnostics: {
      viewportCenterWorld: viewportCenter,
      viewportCornerGeo: viewportCornerGeoPoints(
        viewport,
        screenSize,
        location.lat,
        location.lon,
        northBearingDeg,
      ),
    },
  }
}

export function computeMapLibreCamera(
  viewport: SceneViewportState,
  screenSize: MapLibreCameraScreenSize,
  location: MapLibreCameraLocation | null,
  northBearingDeg: number | null,
): MapLibreCameraOptions | null {
  const frame = createMapFrame(viewport, screenSize, location, northBearingDeg)
  if (!frame) return null
  return {
    center: frame.center,
    zoom: frame.zoom,
    bearing: frame.bearing,
  }
}
