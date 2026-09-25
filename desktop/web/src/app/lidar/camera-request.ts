import { signal } from '@preact/signals'
import { mapZoomToStageScale, viewportCenterWorld } from '../../canvas/projection'
import {
  currentCanvasQuerySurface,
  getCurrentCanvasViewportCommandSurface,
} from '../../canvas/session'
import type { SessionPlane } from '../../canvas/session-plane'

export const lidarMapViewBounds = signal<[number, number, number, number] | null>(null)

function currentSessionPlane(): SessionPlane | null {
  return currentCanvasQuerySurface.value?.sessionPlane.value ?? null
}

/** Focuses LiDAR coverage through the live renderer-neutral workspace camera. */
export function viewLidarCoverage(bounds: [number, number, number, number]): boolean {
  const plane = currentSessionPlane()
  const localBounds = lidarBoundsToLocalWorld(bounds, plane)
  const viewport = getCurrentCanvasViewportCommandSurface()
  if (!plane || !localBounds || !viewport) return false

  const maximumScale = mapZoomToStageScale(18, plane.origin.lat)
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
  plane: SessionPlane | null,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!plane) return null

  const [west, south, east, north] = bounds
  if (
    ![west, south, east, north].every(Number.isFinite)
    || west < -180
    || east > 180
    || south <= -90
    || north >= 90
    || west >= east
    || south >= north
  ) return null

  const corners = [
    plane.toPlane({ lon: west, lat: north }),
    plane.toPlane({ lon: east, lat: north }),
    plane.toPlane({ lon: east, lat: south }),
    plane.toPlane({ lon: west, lat: south }),
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
 * The session plane is the canvas's own projection, so this is the geographic
 * position the canvas drew — not a flat-earth reconstruction of it. Using
 * anything else would let the sampled cell differ from the drawn one, which is
 * the failure mode where a confidently wrong physical value is reported for a
 * point the user can see.
 */
export function inspectionPointForScenePoint(
  point: { readonly x: number; readonly y: number },
  plane: SessionPlane | null = currentSessionPlane(),
): { lat: number; lon: number } | null {
  if (!plane || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  const geo = plane.toGeo(point)
  if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) return null
  return { lat: geo.lat, lon: geo.lon }
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
