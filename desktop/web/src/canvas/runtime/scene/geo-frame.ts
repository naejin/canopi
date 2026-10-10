import {
  createSessionPlane,
  roundGeoDegrees,
  type GeoPosition,
  type SessionPlane,
} from '../../session-plane'
import type { ScenePersistedState, ScenePoint, SceneZoneEntity } from './types'

// The largest 1e-9 degree grid latitude inside Web Mercator's ±85.0511287798066.
const GRID_MAX_LATITUDE_DEG = 85.051128779

// Positions are written rounded to 1e-9 degree (about 0.1 mm), latitude clamped to the grid inside Web Mercator.
// Rounding is idempotent through the session plane, so an unedited position on the grid is written unchanged after
// any number of re-origins, and one with more decimals is rounded once.
function gridGeoPosition(point: GeoPosition): GeoPosition {
  const lat = Math.min(GRID_MAX_LATITUDE_DEG, Math.max(-GRID_MAX_LATITUDE_DEG, roundGeoDegrees(point.lat)))
  return { lon: roundGeoDegrees(point.lon), lat }
}

// A saved position also clamps longitude to ±180°, the range the decoder admits, so a Design dragged past the
// antimeridian still reopens. Only serialize clamps; the re-origin reprojector keeps the unclamped grid position.
export function roundGeoPosition(point: GeoPosition): GeoPosition {
  const grid = gridGeoPosition(point)
  return { lon: Math.min(180, Math.max(-180, grid.lon)), lat: grid.lat }
}

// --- hydrate: lon/lat -> plane ------------------------------------------------

export function hydrateGeoPoint(plane: SessionPlane, geo: GeoPosition): ScenePoint {
  return plane.toPlane(geo)
}

// Ellipses are stored as opposite corners of their unrotated bounding box and
// held in the runtime as centre + radii.
export function hydrateGeoEllipse(
  plane: SessionPlane,
  corners: readonly [GeoPosition, GeoPosition],
): [ScenePoint, ScenePoint] {
  const first = plane.toPlane(corners[0])
  const second = plane.toPlane(corners[1])
  const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
  const radii = { x: (second.x - first.x) / 2, y: (second.y - first.y) / 2 }
  return [center, radii]
}

// --- serialize: plane -> rounded lon/lat --------------------------------------

export function serializeGeoPoint(plane: SessionPlane, point: ScenePoint): GeoPosition {
  return roundGeoPosition(plane.toGeo(point))
}

export function serializeGeoEllipse(
  plane: SessionPlane,
  center: ScenePoint,
  radii: ScenePoint,
): [GeoPosition, GeoPosition] {
  return ellipseCorners(plane, center, radii, roundGeoPosition)
}

function ellipseCorners(
  plane: SessionPlane,
  center: ScenePoint,
  radii: ScenePoint,
  round: (point: GeoPosition) => GeoPosition,
): [GeoPosition, GeoPosition] {
  return [
    round(plane.toGeo({ x: center.x - radii.x, y: center.y - radii.y })),
    round(plane.toGeo({ x: center.x + radii.x, y: center.y + radii.y })),
  ]
}

// --- re-origin --------------------------------------------------------------

// Moves every metre coordinate from one session plane to another through its
// rounded lon/lat, as a save would write it but without the longitude clamp. The same reprojector must be
// applied to every metre holder (scene, history, clipboard) so they stay
// consistent.
export class ScenePlaneReprojector {
  readonly next: SessionPlane

  constructor(private readonly previous: SessionPlane, nextOrigin: GeoPosition) {
    this.next = createSessionPlane(nextOrigin)
  }

  point(point: ScenePoint): ScenePoint {
    return hydrateGeoPoint(this.next, gridGeoPosition(this.previous.toGeo(point)))
  }

  ellipse(center: ScenePoint, radii: ScenePoint): [ScenePoint, ScenePoint] {
    return hydrateGeoEllipse(this.next, ellipseCorners(this.previous, center, radii, gridGeoPosition))
  }

  zone(zone: SceneZoneEntity): SceneZoneEntity {
    if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
      const [center, radii] = this.ellipse(zone.points[0]!, zone.points[1]!)
      return { ...zone, points: [center, radii, ...zone.points.slice(2).map((point) => this.point(point))] }
    }
    return { ...zone, points: zone.points.map((point) => this.point(point)) }
  }

  persisted<T extends Partial<ScenePersistedState>>(state: T): T {
    const next: Partial<ScenePersistedState> = { ...state }
    if (state.plants) {
      next.plants = state.plants.map((plant) => ({ ...plant, position: this.point(plant.position) }))
    }
    if (state.zones) next.zones = state.zones.map((zone) => this.zone(zone))
    if (state.annotations) {
      next.annotations = state.annotations.map((annotation) => ({
        ...annotation,
        position: this.point(annotation.position),
      }))
    }
    if (state.measurementGuides) {
      next.measurementGuides = state.measurementGuides.map((guide) => ({
        ...guide,
        start: this.point(guide.start),
        end: this.point(guide.end),
      }))
    }
    return next as T
  }
}
