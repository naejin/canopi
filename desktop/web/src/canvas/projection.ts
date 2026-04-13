// ---------------------------------------------------------------------------
// Canonical canvas↔map projection seam.
//
// Canvas world coordinates remain authoritative and are expressed in local
// design meters. MapLibre is derived from those meters through a Mercator-
// anchored local frame so the canvas and map share the same affine surface.
//
// The design location is the local-frame origin (0,0 in canvas world space).
// The local frame is still an approximation over very large extents, so callers
// may warn when a design grows too large for the local model.
// ---------------------------------------------------------------------------

const EARTH_RADIUS_METERS = 6371008.8
const EARTH_CIRCUMFERENCE_METERS = 2 * Math.PI * EARTH_RADIUS_METERS
const DEGREES_TO_RADIANS = Math.PI / 180
const MAPLIBRE_WORLD_TILE_SIZE = 512

export interface MapMercatorCoordinate {
  x: number
  y: number
}

function resolveBearingRad(northBearingDeg: number | null | undefined): number {
  return (northBearingDeg ?? 0) * DEGREES_TO_RADIANS
}

function canvasWorldToEastNorthMeters(
  x: number,
  y: number,
  northBearingDeg: number | null | undefined,
): { east: number; north: number } {
  const bearingRad = resolveBearingRad(northBearingDeg)
  const cos = Math.cos(bearingRad)
  const sin = Math.sin(bearingRad)
  return {
    east: x * cos + y * sin,
    north: x * sin - y * cos,
  }
}

function eastNorthMetersToCanvasWorld(
  east: number,
  north: number,
  northBearingDeg: number | null | undefined,
): { x: number; y: number } {
  const bearingRad = resolveBearingRad(northBearingDeg)
  const cos = Math.cos(bearingRad)
  const sin = Math.sin(bearingRad)
  return {
    x: east * cos + north * sin,
    y: east * sin - north * cos,
  }
}

function mercatorXfromLng(lng: number): number {
  return (180 + lng) / 360
}

function mercatorYfromLat(lat: number): number {
  return (180 - (180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + lat * DEGREES_TO_RADIANS / 2)))) / 360
}

function lngFromMercatorX(x: number): number {
  return x * 360 - 180
}

function latFromMercatorY(y: number): number {
  const y2 = 180 - y * 360
  return 360 / Math.PI * Math.atan(Math.exp(y2 * Math.PI / 180)) - 90
}

export function mercatorUnitsPerMeterAtLat(lat: number): number {
  return 1 / EARTH_CIRCUMFERENCE_METERS / Math.cos(lat * DEGREES_TO_RADIANS)
}

export function geoToMercator(lng: number, lat: number): MapMercatorCoordinate {
  return {
    x: mercatorXfromLng(lng),
    y: mercatorYfromLat(lat),
  }
}

export function mercatorToGeo(x: number, y: number): { lng: number; lat: number } {
  return {
    lng: lngFromMercatorX(x),
    lat: latFromMercatorY(y),
  }
}

export function worldToMercator(
  x: number,
  y: number,
  originLat: number,
  originLon: number,
  northBearingDeg: number | null = 0,
): MapMercatorCoordinate {
  const origin = geoToMercator(originLon, originLat)
  const mercatorUnitsPerMeter = mercatorUnitsPerMeterAtLat(originLat)
  const { east, north } = canvasWorldToEastNorthMeters(x, y, northBearingDeg)
  return {
    x: origin.x + east * mercatorUnitsPerMeter,
    y: origin.y - north * mercatorUnitsPerMeter,
  }
}

export function mercatorToWorld(
  x: number,
  y: number,
  originLat: number,
  originLon: number,
  northBearingDeg: number | null = 0,
): { x: number; y: number } {
  const origin = geoToMercator(originLon, originLat)
  const mercatorUnitsPerMeter = mercatorUnitsPerMeterAtLat(originLat)
  const east = (x - origin.x) / mercatorUnitsPerMeter
  const north = -(y - origin.y) / mercatorUnitsPerMeter
  return eastNorthMetersToCanvasWorld(east, north, northBearingDeg)
}

export function worldToGeo(
  x: number,
  y: number,
  originLat: number,
  originLon: number,
  northBearingDeg: number | null = 0,
): { lng: number; lat: number } {
  const mercator = worldToMercator(x, y, originLat, originLon, northBearingDeg)
  return mercatorToGeo(mercator.x, mercator.y)
}

export function geoToWorld(
  lng: number,
  lat: number,
  originLat: number,
  originLon: number,
  northBearingDeg: number | null = 0,
): { x: number; y: number } {
  const mercator = geoToMercator(lng, lat)
  return mercatorToWorld(mercator.x, mercator.y, originLat, originLon, northBearingDeg)
}

/**
 * Convert canvas viewport scale to a MapLibre zoom level using the same
 * Mercator world-size convention as MapLibre's transform (512px world at z=0).
 */
export function stageScaleToMapZoom(stageScale: number, lat: number): number {
  const mercatorUnitsPerMeter = mercatorUnitsPerMeterAtLat(lat)
  const pixelsPerMercatorUnit = stageScale / mercatorUnitsPerMeter
  return Math.log2(pixelsPerMercatorUnit / MAPLIBRE_WORLD_TILE_SIZE)
}

export function viewportCenterWorld(
  viewport: { x: number; y: number; scale: number },
  screenSize: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: (screenSize.width / 2 - viewport.x) / viewport.scale,
    y: (screenSize.height / 2 - viewport.y) / viewport.scale,
  }
}

export function viewportCenterGeo(
  viewport: { x: number; y: number; scale: number },
  screenSize: { width: number; height: number },
  originLat: number,
  originLon: number,
  northBearingDeg: number | null = 0,
): { lng: number; lat: number } {
  const center = viewportCenterWorld(viewport, screenSize)
  return worldToGeo(center.x, center.y, originLat, originLon, northBearingDeg)
}

export function viewportCornerWorldPoints(
  viewport: { x: number; y: number; scale: number },
  screenSize: { width: number; height: number },
): readonly [
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
] {
  const screenPoints = [
    { x: 0, y: 0 },
    { x: screenSize.width, y: 0 },
    { x: screenSize.width, y: screenSize.height },
    { x: 0, y: screenSize.height },
  ] as const

  const [topLeft, topRight, bottomRight, bottomLeft] = screenPoints.map((point) => ({
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  }))
  return [topLeft!, topRight!, bottomRight!, bottomLeft!]
}

export function viewportCornerGeoPoints(
  viewport: { x: number; y: number; scale: number },
  screenSize: { width: number; height: number },
  originLat: number,
  originLon: number,
  northBearingDeg: number | null = 0,
): readonly [
  { lng: number; lat: number },
  { lng: number; lat: number },
  { lng: number; lat: number },
  { lng: number; lat: number },
] {
  const [topLeft, topRight, bottomRight, bottomLeft] = viewportCornerWorldPoints(viewport, screenSize)
  return [
    worldToGeo(topLeft.x, topLeft.y, originLat, originLon, northBearingDeg),
    worldToGeo(topRight.x, topRight.y, originLat, originLon, northBearingDeg),
    worldToGeo(bottomRight.x, bottomRight.y, originLat, originLon, northBearingDeg),
    worldToGeo(bottomLeft.x, bottomLeft.y, originLat, originLon, northBearingDeg),
  ]
}

/**
 * Convert a stage-like viewport center to geographic coordinates.
 */
export function stageViewportCenter(
  stage: { width(): number; height(): number; position(): { x: number; y: number }; scaleX(): number },
  originLat: number,
  originLon: number,
  northBearingDeg: number | null = 0,
): { lng: number; lat: number } {
  const pos = stage.position()
  const scale = stage.scaleX()
  const centerWorldX = (-pos.x + stage.width() / 2) / scale
  const centerWorldY = (-pos.y + stage.height() / 2) / scale
  return worldToGeo(centerWorldX, centerWorldY, originLat, originLon, northBearingDeg)
}
