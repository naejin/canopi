import { signal } from '@preact/signals'
import { geoToWorld, mapZoomToStageScale } from '../../canvas/projection'
import { getCurrentCanvasViewportCommandSurface } from '../../canvas/session'
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
 * The inspection aim for one scene point.
 *
 * The canvas knows a click as scene metres; the native sampler needs the
 * Design's own anchor plus a metre offset. Both come from the document's
 * spatial frame, and the offset here is the inverse of the frontend's
 * authoritative `canvasWorldToEastNorthMeters`, so the point the user clicked is
 * the point that gets sampled.
 *
 * `null` when there is no confirmed frame, because a provisional Design has no
 * geographic mapping to sample through.
 */
export function inspectionAimForScenePoint(
  point: { readonly x: number; readonly y: number },
  frame: SpatialFrame | null,
): {
  anchor: { lat: number; lon: number }
  eastMetres: number
  northMetres: number
  northBearingDeg: number
} | null {
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
  return {
    anchor: { lat: frame.anchor_latitude_deg, lon: frame.anchor_longitude_deg },
    ...canvasWorldToEastNorthMetres(point, frame.north_bearing_deg),
    northBearingDeg: frame.north_bearing_deg,
  }
}

/** Inverse of the projection module's `canvasWorldToEastNorthMeters`. */
function canvasWorldToEastNorthMetres(
  point: { readonly x: number; readonly y: number },
  northBearingDeg: number,
): { eastMetres: number; northMetres: number } {
  const bearing = (northBearingDeg * Math.PI) / 180
  const cos = Math.cos(bearing)
  const sin = Math.sin(bearing)
  return {
    eastMetres: point.x * cos + point.y * sin,
    northMetres: point.x * sin - point.y * cos,
  }
}
