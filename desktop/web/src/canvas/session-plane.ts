// ---------------------------------------------------------------------------
// Session plane: the runtime's local metre frame for the open Design.
//
// Files store WGS84 lon/lat; tools, snapping, measurements, hit testing and
// PDF layout work in metres. The plane is a local Mercator frame (x east,
// y south) scaled at its origin latitude, so it stays an exact affine image of
// the MapLibre Mercator surface. It is rebuilt at the view centre when the view
// moves more than 10 km away; stored lon/lat stays authoritative throughout.
// ---------------------------------------------------------------------------

import {
  geoToMercator,
  mercatorToGeo,
  mercatorUnitsPerMeterAtLat,
} from './projection'

export interface GeoPosition {
  readonly lon: number
  readonly lat: number
}

export interface PlanePoint {
  readonly x: number
  readonly y: number
}

// Plane-to-plane change: next = previous * scale + offset.
export interface SessionPlaneTransform {
  readonly scale: number
  readonly offsetX: number
  readonly offsetY: number
}

export const SESSION_PLANE_REORIGIN_DISTANCE_METERS = 10_000
export const DEFAULT_NEW_DESIGN_VIEW = Object.freeze({ lon: 13.0, lat: 23.0, zoom: 4 })

export interface SessionPlane {
  readonly origin: GeoPosition
  toPlane(point: GeoPosition): PlanePoint
  toGeo(point: PlanePoint): GeoPosition
  needsReorigin(viewCentre: PlanePoint): boolean
  transformTo(next: SessionPlane): SessionPlaneTransform
  // Mercator units per plane metre; exposed for affine camera math.
  readonly mercatorUnitsPerMeter: number
  readonly mercatorOrigin: PlanePoint
}

/** A geographic camera: the view centre, its MapLibre zoom and its bearing (degrees clockwise from north). */
export interface GeographicView {
  readonly lon: number
  readonly lat: number
  readonly zoom: number
  readonly bearing: number
}

/** A camera's centre, zoom and bearing as a geographic view (ViewReadSurface.captureView), or null when they are not finite. */
export function geographicViewOfCamera(
  camera: { readonly center: GeoPosition; readonly zoom: number; readonly bearingDeg: number },
): GeographicView | null {
  const { center, zoom, bearingDeg } = camera
  return [center.lon, center.lat, zoom, bearingDeg].every(Number.isFinite)
    ? { lon: center.lon, lat: center.lat, zoom, bearing: storedBearing(bearingDeg) }
    : null
}

/**
 * A bearing as stored data writes it (the last view, saved views): rounded to 1e-6 degrees and folded into [0, 360), so 360
 * is 0; a missing or non-finite bearing is north up. App code cannot import the view's normaliseBearing (P10).
 */
export function storedBearing(deg: number | null | undefined): number {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return 0
  const folded = Math.round((((deg % 360) + 360) % 360) * 1e6) / 1e6
  return folded >= 360 ? 0 : folded
}

export function createSessionPlane(origin: GeoPosition): SessionPlane {
  const frozenOrigin = Object.freeze({ lon: origin.lon, lat: origin.lat })
  const mercatorOrigin = Object.freeze(geoToMercator(origin.lon, origin.lat))
  const unitsPerMeter = mercatorUnitsPerMeterAtLat(origin.lat)
  return Object.freeze({
    origin: frozenOrigin,
    mercatorOrigin,
    mercatorUnitsPerMeter: unitsPerMeter,
    toPlane(point: GeoPosition): PlanePoint {
      const mercator = geoToMercator(point.lon, point.lat)
      return {
        x: (mercator.x - mercatorOrigin.x) / unitsPerMeter,
        y: (mercator.y - mercatorOrigin.y) / unitsPerMeter,
      }
    },
    toGeo(point: PlanePoint): GeoPosition {
      const geo = mercatorToGeo(
        mercatorOrigin.x + point.x * unitsPerMeter,
        mercatorOrigin.y + point.y * unitsPerMeter,
      )
      return { lon: geo.lng, lat: geo.lat }
    },
    needsReorigin(viewCentre: PlanePoint): boolean {
      return Math.hypot(viewCentre.x, viewCentre.y) > SESSION_PLANE_REORIGIN_DISTANCE_METERS
    },
    transformTo(next: SessionPlane): SessionPlaneTransform {
      return {
        scale: unitsPerMeter / next.mercatorUnitsPerMeter,
        offsetX: (mercatorOrigin.x - next.mercatorOrigin.x) / next.mercatorUnitsPerMeter,
        offsetY: (mercatorOrigin.y - next.mercatorOrigin.y) / next.mercatorUnitsPerMeter,
      }
    },
  })
}

// Canonical 1e-9 degree (about 0.1 mm) rounding for changed positions.
// Dividing the rounded integer by 1e9 yields the double nearest the decimal,
// so it prints without float noise; -0 is normalised to 0.
export function roundGeoDegrees(value: number): number {
  const rounded = Math.round(value * 1e9) / 1e9
  return rounded === 0 ? 0 : rounded
}

export function sessionPlaneOriginForPoints(
  points: Iterable<GeoPosition>,
  fallback: GeoPosition,
): GeoPosition {
  let minLon = Infinity
  let maxLon = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const point of points) {
    if (point.lon < minLon) minLon = point.lon
    if (point.lon > maxLon) maxLon = point.lon
    if (point.lat < minLat) minLat = point.lat
    if (point.lat > maxLat) maxLat = point.lat
  }
  if (minLon === Infinity) return { lon: fallback.lon, lat: fallback.lat }
  return { lon: (minLon + maxLon) / 2, lat: (minLat + maxLat) / 2 }
}
