import type { SceneViewportState } from './runtime/scene'
import {
  LOCAL_MERCATOR_PROJECTION_ID,
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

export function createMapFrame(
  viewport: SceneViewportState,
  screenSize: MapLibreCameraScreenSize,
  location: MapLibreCameraLocation | null,
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
  )
  const viewportCenter = viewportCenterWorld(viewport, screenSize)

  return {
    center: [center.lng, center.lat],
    zoom: clampZoom(stageScaleToMapZoom(viewport.scale, location.lat), policy),
    bearing: 0,
    diagnostics: {
      projectionId: LOCAL_MERCATOR_PROJECTION_ID,
      viewportCenterWorld: viewportCenter,
      viewportCornerGeo: viewportCornerGeoPoints(
        viewport,
        screenSize,
        location.lat,
        location.lon,
      ),
    },
  }
}
