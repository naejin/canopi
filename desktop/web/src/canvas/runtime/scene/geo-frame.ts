import {
  createSessionPlane,
  roundGeoDegrees,
  type GeoPosition,
  type PlanePoint,
  type SessionPlane,
} from '../../session-plane'
import type { ScenePersistedState, ScenePoint, SceneZoneEntity } from './types'

// The codec's memory of loaded lon/lat, keyed by the exact plane coordinates
// each position hydrated to. A position whose plane coordinates are unchanged
// writes its original lon/lat verbatim, so open → save is byte-identical;
// anything else is converted and rounded to 1e-9 degree.
export class SceneGeoLedger {
  private readonly _points = new Map<string, GeoPosition>()
  private readonly _ellipses = new Map<string, readonly [GeoPosition, GeoPosition]>()
  private readonly _latitudes = new Map<number, number>()
  private readonly _longitudes = new Map<number, number>()

  rememberPoint(plane: PlanePoint, geo: GeoPosition): void {
    this._points.set(pointKey(plane), geo)
  }

  point(plane: PlanePoint): GeoPosition | undefined {
    return this._points.get(pointKey(plane))
  }

  rememberEllipse(center: PlanePoint, radii: PlanePoint, corners: readonly [GeoPosition, GeoPosition]): void {
    this._ellipses.set(ellipseKey(center, radii), corners)
  }

  ellipse(center: PlanePoint, radii: PlanePoint): readonly [GeoPosition, GeoPosition] | undefined {
    return this._ellipses.get(ellipseKey(center, radii))
  }

  rememberLatitude(y: number, lat: number): void {
    this._latitudes.set(y, lat)
  }

  latitude(y: number): number | undefined {
    return this._latitudes.get(y)
  }

  rememberLongitude(x: number, lon: number): void {
    this._longitudes.set(x, lon)
  }

  longitude(x: number): number | undefined {
    return this._longitudes.get(x)
  }
}

function pointKey(point: PlanePoint): string {
  return `${point.x}|${point.y}`
}

function ellipseKey(center: PlanePoint, radii: PlanePoint): string {
  return `${center.x}|${center.y}|${radii.x}|${radii.y}`
}

export interface SceneGeoFrame {
  readonly plane: SessionPlane
  readonly ledger: SceneGeoLedger
}

export function createSceneGeoFrame(origin: GeoPosition): SceneGeoFrame {
  return { plane: createSessionPlane(origin), ledger: new SceneGeoLedger() }
}

export function roundGeoPosition(point: GeoPosition): GeoPosition {
  return { lon: roundGeoDegrees(point.lon), lat: roundGeoDegrees(point.lat) }
}

// --- hydrate: lon/lat -> plane, remembering the original -------------------

export function hydrateGeoPoint(frame: SceneGeoFrame, geo: GeoPosition): ScenePoint {
  const plane = frame.plane.toPlane(geo)
  frame.ledger.rememberPoint(plane, { lon: geo.lon, lat: geo.lat })
  return { x: plane.x, y: plane.y }
}

// Ellipses are stored as opposite corners of their unrotated bounding box and
// held in the runtime as centre + radii.
export function hydrateGeoEllipse(
  frame: SceneGeoFrame,
  corners: readonly [GeoPosition, GeoPosition],
): [ScenePoint, ScenePoint] {
  const first = frame.plane.toPlane(corners[0])
  const second = frame.plane.toPlane(corners[1])
  const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
  const radii = { x: (second.x - first.x) / 2, y: (second.y - first.y) / 2 }
  frame.ledger.rememberEllipse(center, radii, [
    { lon: corners[0].lon, lat: corners[0].lat },
    { lon: corners[1].lon, lat: corners[1].lat },
  ])
  return [center, radii]
}

export function hydrateGeoLatitude(frame: SceneGeoFrame, lat: number): number {
  const y = frame.plane.toPlane({ lon: frame.plane.origin.lon, lat }).y
  frame.ledger.rememberLatitude(y, lat)
  return y
}

export function hydrateGeoLongitude(frame: SceneGeoFrame, lon: number): number {
  const x = frame.plane.toPlane({ lon, lat: frame.plane.origin.lat }).x
  frame.ledger.rememberLongitude(x, lon)
  return x
}

// --- serialize: plane -> lon/lat, canonical when unchanged -----------------

export function serializeGeoPoint(frame: SceneGeoFrame, point: ScenePoint): GeoPosition {
  const original = frame.ledger.point(point)
  if (original) return { lon: original.lon, lat: original.lat }
  return roundGeoPosition(frame.plane.toGeo(point))
}

export function serializeGeoEllipse(
  frame: SceneGeoFrame,
  center: ScenePoint,
  radii: ScenePoint,
): [GeoPosition, GeoPosition] {
  const original = frame.ledger.ellipse(center, radii)
  if (original) return [{ ...original[0] }, { ...original[1] }]
  return [
    roundGeoPosition(frame.plane.toGeo({ x: center.x - radii.x, y: center.y - radii.y })),
    roundGeoPosition(frame.plane.toGeo({ x: center.x + radii.x, y: center.y + radii.y })),
  ]
}

export function serializeGeoLatitude(frame: SceneGeoFrame, y: number): number {
  return frame.ledger.latitude(y)
    ?? roundGeoDegrees(frame.plane.toGeo({ x: 0, y }).lat)
}

export function serializeGeoLongitude(frame: SceneGeoFrame, x: number): number {
  return frame.ledger.longitude(x)
    ?? roundGeoDegrees(frame.plane.toGeo({ x, y: 0 }).lon)
}

// --- re-origin --------------------------------------------------------------

// Moves every metre coordinate from one session plane to another through its
// lon/lat: remembered positions re-project from their stored lon/lat, other
// positions take their canonical (rounded) lon/lat now. The same reprojector
// must be applied to every metre holder (scene, history, clipboard) so they
// stay consistent; it records a fresh ledger for the next plane as it goes.
export class ScenePlaneReprojector {
  readonly next: SceneGeoFrame

  constructor(private readonly previous: SceneGeoFrame, nextOrigin: GeoPosition) {
    this.next = createSceneGeoFrame(nextOrigin)
  }

  point(point: ScenePoint): ScenePoint {
    return hydrateGeoPoint(this.next, serializeGeoPoint(this.previous, point))
  }

  ellipse(center: ScenePoint, radii: ScenePoint): [ScenePoint, ScenePoint] {
    return hydrateGeoEllipse(this.next, serializeGeoEllipse(this.previous, center, radii))
  }

  guide(axis: 'h' | 'v', position: number): number {
    return axis === 'h'
      ? hydrateGeoLatitude(this.next, serializeGeoLatitude(this.previous, position))
      : hydrateGeoLongitude(this.next, serializeGeoLongitude(this.previous, position))
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
    if (state.guides) {
      next.guides = state.guides.map((guide) => ({ ...guide, position: this.guide(guide.axis, guide.position) }))
    }
    return next as T
  }
}
