// canvas/runtime/view/camera-math.ts  (pure; the only place camera targets are computed)
//
// Owns camera targets in both of the drivers' terms: geographic ViewCameras (Web Mercator plus bearing, what the MapLibre driver
// sends) and PlanarCameras (today's CameraController placement plus a bearing, what the headless driver keeps, bit for bit today's
// arithmetic at bearing 0), and the one conversion each way between them through the session plane. Nothing here constrains:
// the drivers pass every target through constrainCamera (navigation-policy.ts) or clamp the scale first.

import {
  geoToMercator,
  MAPLIBRE_WORLD_TILE_SIZE,
  mapZoomToStageScale,
  mercatorToGeo,
  stageScaleToMapZoom,
} from '../../projection'
import type { SessionPlane } from '../../session-plane'
import { bearingCosSin, normaliseBearing } from './navigation-policy'
import type { GeoPoint, PlanarCamera, ScreenPoint, ViewCamera, ViewScreen } from './types'

interface Vector { readonly x: number; readonly y: number }

/** Web Mercator + bearing: the camera that keeps `ground` under `screenPoint`. */
export function cameraKeepingPoint(camera: ViewCamera, screen: ViewScreen, ground: GeoPoint, screenPoint: ScreenPoint): ViewCamera {
  const center = centreKeeping(geoToMercator(ground.lon, ground.lat), camera.zoom, camera.bearingDeg, screen, screenPoint)
  return { center, zoom: camera.zoom, bearingDeg: camera.bearingDeg, pitchDeg: 0 }
}

export function panCamera(camera: ViewCamera, screen: ViewScreen, deltaPx: ScreenPoint): ViewCamera {
  if (deltaPx.x === 0 && deltaPx.y === 0) return camera
  const centre = screenToMercator(camera, screen, { x: screen.width / 2 - deltaPx.x, y: screen.height / 2 - deltaPx.y })
  return { center: geoPoint(centre), zoom: camera.zoom, bearingDeg: camera.bearingDeg, pitchDeg: 0 }
}

/** A factor of 1 (the driver's clamped factor when the zoom limit is reached) returns the camera itself: no centre-only move. */
export function zoomCameraAround(camera: ViewCamera, screen: ViewScreen, anchorPx: ScreenPoint, factor: number): ViewCamera {
  if (factor === 1 || !(factor > 0) || !Number.isFinite(factor)) return camera
  const zoom = camera.zoom + Math.log2(factor)
  const center = centreKeeping(screenToMercator(camera, screen, anchorPx), zoom, camera.bearingDeg, screen, anchorPx)
  return { center, zoom, bearingDeg: camera.bearingDeg, pitchDeg: 0 }
}

export function rotateCameraAround(camera: ViewCamera, screen: ViewScreen, anchorPx: ScreenPoint | 'centre', bearingDeg: number): ViewCamera {
  const bearing = normaliseBearing(bearingDeg)
  if (bearing === camera.bearingDeg) return camera
  if (anchorPx === 'centre') return { center: camera.center, zoom: camera.zoom, bearingDeg: bearing, pitchDeg: 0 }
  const center = centreKeeping(screenToMercator(camera, screen, anchorPx), camera.zoom, bearing, screen, anchorPx)
  return { center, zoom: camera.zoom, bearingDeg: bearing, pitchDeg: 0 }
}

export function screenToGeo(camera: ViewCamera, screen: ViewScreen, s: ScreenPoint): GeoPoint {
  return geoPoint(screenToMercator(camera, screen, s))
}

export function geoToScreen(camera: ViewCamera, screen: ViewScreen, g: GeoPoint): ScreenPoint {
  const point = geoToMercator(g.lon, g.lat)
  const centre = geoToMercator(camera.center.lon, camera.center.lat)
  const worldSize = worldSizeAt(camera.zoom)
  const onScreen = planeToScreenAxes({ x: (point.x - centre.x) * worldSize, y: (point.y - centre.y) * worldSize }, camera.bearingDeg)
  return { x: onScreen.x + screen.width / 2, y: onScreen.y + screen.height / 2 }
}

// The headless driver's PlanarCamera (ADR 0016, amended 2026-09-30): at bearing 0 these are today's CameraController arithmetic,
// bit for bit (panBy camera.ts:316-323; zoomCameraViewportToScale :502-518, with the scale clamped by the caller first, as :498 does).
export function panPlanar(camera: PlanarCamera, deltaPx: ScreenPoint): PlanarCamera {
  if (deltaPx.x === 0 && deltaPx.y === 0) return camera
  return { x: camera.x + deltaPx.x, y: camera.y + deltaPx.y, scale: camera.scale, bearingDeg: camera.bearingDeg }
}

/**
 * Today's pointer-anchored zoom. (anchor − { x, y }) / scale is the anchor's plane point turned into screen axes, so the same
 * arithmetic keeps the ground under the anchor at any bearing.
 */
export function zoomPlanarToScale(camera: PlanarCamera, anchorPx: ScreenPoint, scale: number): PlanarCamera {
  if (scale === camera.scale) return camera
  const fromAnchor = {
    x: (anchorPx.x - camera.x) / camera.scale,
    y: (anchorPx.y - camera.y) / camera.scale,
  }
  return {
    x: anchorPx.x - fromAnchor.x * scale,
    y: anchorPx.y - fromAnchor.y * scale,
    scale,
    bearingDeg: camera.bearingDeg,
  }
}

export function rotatePlanarAround(camera: PlanarCamera, screen: ViewScreen, anchorPx: ScreenPoint | 'centre', bearingDeg: number): PlanarCamera {
  const bearing = normaliseBearing(bearingDeg)
  if (bearing === camera.bearingDeg) return camera
  const anchor = anchorPx === 'centre' ? { x: screen.width / 2, y: screen.height / 2 } : anchorPx
  const ground = screenToPlaneAxes({ x: (anchor.x - camera.x) / camera.scale, y: (anchor.y - camera.y) / camera.scale }, camera.bearingDeg)
  const turned = planeToScreenAxes(ground, bearing)
  return { x: anchor.x - turned.x * camera.scale, y: anchor.y - turned.y * camera.scale, scale: camera.scale, bearingDeg: bearing }
}

/** The one conversion each way: readers' ViewCamera, geographic inputs, and attach and detach (re-origin stays in plane terms: planeChanged). */
export function planarToViewCamera(camera: PlanarCamera, screen: ViewScreen, plane: SessionPlane): ViewCamera {
  // At bearing 0 the centre is today's viewportCenterWorld and the zoom today's geographicViewOf.
  const centreWorld = screenToPlaneAxes({
    x: (screen.width / 2 - camera.x) / camera.scale,
    y: (screen.height / 2 - camera.y) / camera.scale,
  }, camera.bearingDeg)
  return {
    center: plane.toGeo(centreWorld),
    zoom: stageScaleToMapZoom(camera.scale, plane.origin.lat),
    bearingDeg: normaliseBearing(camera.bearingDeg),
    pitchDeg: 0,
  }
}

export function viewCameraToPlanar(camera: ViewCamera, screen: ViewScreen, plane: SessionPlane): PlanarCamera {
  // At bearing 0 this is today's centredViewport: x = w/2 − p.x·scale.
  const scale = mapZoomToStageScale(camera.zoom, plane.origin.lat)
  const centreWorld = plane.toPlane(camera.center)
  const centreOnScreen = planeToScreenAxes({ x: centreWorld.x * scale, y: centreWorld.y * scale }, camera.bearingDeg)
  return {
    x: screen.width / 2 - centreOnScreen.x,
    y: screen.height / 2 - centreOnScreen.y,
    scale,
    bearingDeg: normaliseBearing(camera.bearingDeg),
  }
}

/** CSS px per Mercator unit at a zoom: MapLibre's worldSize. */
function worldSizeAt(zoom: number): number {
  return MAPLIBRE_WORLD_TILE_SIZE * 2 ** zoom
}

/** The Mercator point under a screen point. */
function screenToMercator(camera: ViewCamera, screen: ViewScreen, s: ScreenPoint): Vector {
  const centre = geoToMercator(camera.center.lon, camera.center.lat)
  const worldSize = worldSizeAt(camera.zoom)
  const offset = screenToPlaneAxes({ x: s.x - screen.width / 2, y: s.y - screen.height / 2 }, camera.bearingDeg)
  return { x: centre.x + offset.x / worldSize, y: centre.y + offset.y / worldSize }
}

/** The centre that puts a Mercator point under a screen point at a zoom and bearing. */
function centreKeeping(point: Vector, zoom: number, bearingDeg: number, screen: ViewScreen, s: ScreenPoint): GeoPoint {
  const worldSize = worldSizeAt(zoom)
  const offset = screenToPlaneAxes({ x: s.x - screen.width / 2, y: s.y - screen.height / 2 }, bearingDeg)
  return geoPoint({ x: point.x - offset.x / worldSize, y: point.y - offset.y / worldSize })
}

function geoPoint(mercator: Vector): GeoPoint {
  const { lng, lat } = mercatorToGeo(mercator.x, mercator.y)
  return { lon: lng, lat }
}

/** A plane (or Mercator) vector in screen axes: turned counter-clockwise on screen by the bearing. The identity at bearing 0. */
function planeToScreenAxes(vector: Vector, bearingDeg: number): Vector {
  const [cos, sin] = bearingCosSin(bearingDeg)
  if (cos === 1 && sin === 0) return vector
  return { x: cos * vector.x + sin * vector.y, y: cos * vector.y - sin * vector.x }
}

/** A screen-axis vector in plane (or Mercator) axes: the inverse turn. The identity at bearing 0. */
function screenToPlaneAxes(vector: Vector, bearingDeg: number): Vector {
  const [cos, sin] = bearingCosSin(bearingDeg)
  if (cos === 1 && sin === 0) return vector
  return { x: cos * vector.x - sin * vector.y, y: sin * vector.x + cos * vector.y }
}
