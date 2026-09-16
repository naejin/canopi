import type { SceneViewportState } from './runtime/scene'
import {
  LOCAL_MERCATOR_PROJECTION_ID,
  LOCAL_PROJECTION_WARNING_THRESHOLD_METERS,
  stageScaleToMapZoom,
  viewportCenterGeo,
  viewportCenterWorld,
  viewportCornerGeoPoints,
} from './projection'
import {
  createWorkspaceCameraPolicy,
  type WorkspaceCameraPolicy,
} from './workspace-camera-policy'

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
  readonly projectionId: typeof LOCAL_MERCATOR_PROJECTION_ID
  readonly warningThresholdMeters: number
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

function clampZoom(zoom: number, policy: WorkspaceCameraPolicy): number {
  return Math.min(policy.maximumMapZoom, Math.max(policy.minimumMapZoom, zoom))
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
  policy: WorkspaceCameraPolicy = createWorkspaceCameraPolicy(location?.lat ?? 0),
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
    zoom: clampZoom(stageScaleToMapZoom(viewport.scale, location.lat), policy),
    bearing: maplibreBearingFromNorthBearing(northBearingDeg),
    diagnostics: {
      projectionId: LOCAL_MERCATOR_PROJECTION_ID,
      warningThresholdMeters: LOCAL_PROJECTION_WARNING_THRESHOLD_METERS,
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
