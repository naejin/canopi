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
  MAPLIBRE_WORLD_TILE_SIZE,
  geoToMercator,
  mercatorToGeo,
  mercatorUnitsPerMeterAtLat,
  stageScaleToMapZoom,
  viewportCenterWorld,
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

/** A geographic camera: the view centre and its MapLibre zoom. */
export interface GeographicView {
  readonly lon: number
  readonly lat: number
  readonly zoom: number
}

/** A camera's centre and zoom as a geographic view (ViewReadSurface.captureView), or null when they are not finite. */
export function geographicViewOfCamera(
  camera: { readonly center: GeoPosition; readonly zoom: number },
): GeographicView | null {
  const { center, zoom } = camera
  return [center.lon, center.lat, zoom].every(Number.isFinite)
    ? { lon: center.lon, lat: center.lat, zoom }
    : null
}

/** The geographic view a plane viewport shows, or null when it is not finite. */
export function geographicViewOf(
  frame: {
    readonly viewport: { readonly x: number; readonly y: number; readonly scale: number }
    readonly screenSize: { readonly width: number; readonly height: number }
  },
  plane: SessionPlane,
): GeographicView | null {
  const centre = plane.toGeo(viewportCenterWorld(frame.viewport, frame.screenSize))
  // Plane metres are scaled at the origin latitude, wherever the view is.
  const zoom = stageScaleToMapZoom(frame.viewport.scale, plane.origin.lat)
  return [centre.lon, centre.lat, zoom].every(Number.isFinite)
    ? { lon: centre.lon, lat: centre.lat, zoom }
    : null
}

/** A north-up WGS84 box on one world: `west < east`, `south < north`. */
export interface GeographicExtent {
  readonly west: number
  readonly south: number
  readonly east: number
  readonly north: number
}

// Web Mercator's latitude limit, as the file format bounds it.
const MERCATOR_MAX_LATITUDE_DEG = 85.0511287798066

/**
 * The ground a plane viewport shows edge to edge, or null when the screen is
 * empty or shows more than one world (across the antimeridian or the poles).
 */
export function geographicExtentOf(
  frame: {
    readonly viewport: { readonly x: number; readonly y: number; readonly scale: number }
    readonly screenSize: { readonly width: number; readonly height: number }
  },
  plane: SessionPlane,
): GeographicExtent | null {
  const { viewport, screenSize } = frame
  if (!(screenSize.width > 0 && screenSize.height > 0 && viewport.scale > 0)) return null
  const northWest = plane.toGeo({ x: -viewport.x / viewport.scale, y: -viewport.y / viewport.scale })
  const southEast = plane.toGeo({
    x: (screenSize.width - viewport.x) / viewport.scale,
    y: (screenSize.height - viewport.y) / viewport.scale,
  })
  return extentOnOneWorld({ west: northWest.lon, south: southEast.lat, east: southEast.lon, north: northWest.lat })
}

/**
 * A lon/lat box as a saved extent, or null when it is not a box on one world (across the antimeridian or the poles, or empty):
 * the check ViewReadSurface.captureView's raw corner bounds pass before they are saved.
 */
export function extentOnOneWorld(extent: GeographicExtent): GeographicExtent | null {
  const onOneWorld = Object.values(extent).every(Number.isFinite)
    && extent.west >= -180 && extent.east <= 180
    && extent.south >= -MERCATOR_MAX_LATITUDE_DEG && extent.north <= MERCATOR_MAX_LATITUDE_DEG
    && extent.west < extent.east && extent.south < extent.north
  return onOneWorld ? extent : null
}

/** The MapLibre zoom at which an extent just fits a frame of CSS pixels, or null for an empty frame. */
export function mapZoomToFitExtent(
  extent: GeographicExtent,
  size: { readonly width: number; readonly height: number },
): number | null {
  if (!(size.width > 0 && size.height > 0)) return null
  const northWest = geoToMercator(extent.west, extent.north)
  const southEast = geoToMercator(extent.east, extent.south)
  const width = (southEast.x - northWest.x) * MAPLIBRE_WORLD_TILE_SIZE
  const height = (southEast.y - northWest.y) * MAPLIBRE_WORLD_TILE_SIZE
  if (!(width > 0 && height > 0)) return null
  const zoom = Math.log2(Math.min(size.width / width, size.height / height))
  return Number.isFinite(zoom) ? zoom : null
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
