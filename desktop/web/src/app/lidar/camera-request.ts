import { signal } from '@preact/signals'
import {
  geoToWorld,
  mapZoomToStageScale,
  viewportCenterWorld,
  worldToGeo,
} from '../../canvas/projection'
import {
  currentCanvasQuerySurface,
  getCurrentCanvasViewportCommandSurface,
} from '../../canvas/session'
import type { SpatialFrame } from '../../types/design'
import { currentDesign } from '../document-session/store'

export const lidarMapViewBounds = signal<[number, number, number, number] | null>(null)

/** Focuses LiDAR coverage through the live renderer-neutral workspace camera. */
export function viewLidarCoverage(bounds: [number, number, number, number]): boolean {
  const frame = currentDesign.value?.spatial_frame ?? null
  const localBounds = lidarBoundsToLocalWorld(bounds, frame)
  const viewport = getCurrentCanvasViewportCommandSurface()
  if (!frame || !localBounds || !viewport) return false

  const maximumScale = mapZoomToStageScale(18, frame.anchor_latitude_deg)
  if (!Number.isFinite(maximumScale)) return false

  return viewport.focusTemporaryBounds(localBounds, {
    paddingCssPx: 48,
    maximumScale,
  })
}

/** Restores the one workspace-camera bookmark captured by coverage focus. */
export function viewDesignLocation(): boolean {
  return getCurrentCanvasViewportCommandSurface()?.returnFromTemporaryFocus() ?? false
}

export function publishLidarMapViewBounds(
  bounds: [number, number, number, number] | null,
): void {
  lidarMapViewBounds.value = bounds
}

export function lidarBoundsToLocalWorld(
  bounds: [number, number, number, number],
  frame: SpatialFrame | null,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!frame || frame.placement_status !== 'confirmed') return null

  const [west, south, east, north] = bounds
  if (
    ![west, south, east, north, frame.anchor_latitude_deg, frame.anchor_longitude_deg, frame.north_bearing_deg]
      .every(Number.isFinite)
    || west < -180
    || east > 180
    || south <= -90
    || north >= 90
    || west >= east
    || south >= north
    || frame.anchor_latitude_deg <= -90
    || frame.anchor_latitude_deg >= 90
    || frame.anchor_longitude_deg < -180
    || frame.anchor_longitude_deg > 180
  ) return null

  const corners = [
    geoToWorld(west, north, frame.anchor_latitude_deg, frame.anchor_longitude_deg, frame.north_bearing_deg),
    geoToWorld(east, north, frame.anchor_latitude_deg, frame.anchor_longitude_deg, frame.north_bearing_deg),
    geoToWorld(east, south, frame.anchor_latitude_deg, frame.anchor_longitude_deg, frame.north_bearing_deg),
    geoToWorld(west, south, frame.anchor_latitude_deg, frame.anchor_longitude_deg, frame.north_bearing_deg),
  ]
  if (!corners.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))) return null

  return {
    minX: Math.min(...corners.map(({ x }) => x)),
    minY: Math.min(...corners.map(({ y }) => y)),
    maxX: Math.max(...corners.map(({ x }) => x)),
    maxY: Math.max(...corners.map(({ y }) => y)),
  }
}

/**
 * The WGS84 point one scene point actually displays at.
 *
 * `worldToGeo` is the canvas's own projection, so this is the geographic
 * position the canvas drew — not a flat-earth reconstruction of it. Using
 * anything else would let the sampled cell differ from the drawn one, which is
 * the failure mode where a confidently wrong physical value is reported for a
 * point the user can see.
 *
 * `null` when there is no confirmed frame, because a provisional Design has no
 * geographic mapping to sample through.
 */
export function inspectionPointForScenePoint(
  point: { readonly x: number; readonly y: number },
  frame: SpatialFrame | null,
): { lat: number; lon: number } | null {
  if (
    !frame ||
    frame.placement_status !== 'confirmed' ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(frame.anchor_latitude_deg) ||
    !Number.isFinite(frame.anchor_longitude_deg) ||
    !Number.isFinite(frame.north_bearing_deg)
  ) {
    return null
  }
  const geo = worldToGeo(
    point.x,
    point.y,
    frame.anchor_latitude_deg,
    frame.anchor_longitude_deg,
    frame.north_bearing_deg,
  )
  if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) return null
  return { lat: geo.lat, lon: geo.lng }
}

/**
 * The scene point at the centre of the live viewport.
 *
 * Read from the existing canvas query surface rather than from a second camera
 * owner, so "sample at view centre" reads exactly what the user is looking at.
 */
export function inspectionViewCentreScenePoint(): { x: number; y: number } | null {
  const surface = currentCanvasQuerySurface.value
  const snapshot = surface?.viewport.value
  if (!snapshot) return null
  const centre = viewportCenterWorld(snapshot.viewport, snapshot.screenSize)
  if (!Number.isFinite(centre.x) || !Number.isFinite(centre.y)) return null
  return centre
}
