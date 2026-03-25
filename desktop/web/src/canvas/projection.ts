// ---------------------------------------------------------------------------
// Local Tangent Plane projection — converts between canvas world coordinates
// (meters from origin) and geographic coordinates (lng/lat).
//
// The design's location is the origin (0,0 in world coordinates).
// This is a linearized projection valid for areas up to ~50km.
//
// AD-6: Konva world meters are authoritative, MapLibre is derived.
// ---------------------------------------------------------------------------

const METERS_PER_DEG_LAT = 111320

/**
 * Convert world coordinates (meters) to geographic coordinates (lng/lat).
 * @param x world x (meters east of origin)
 * @param y world y (meters — positive is DOWN in Konva, so SOUTH)
 * @param originLat design location latitude
 * @param originLon design location longitude
 */
export function worldToGeo(
  x: number,
  y: number,
  originLat: number,
  originLon: number,
): { lng: number; lat: number } {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180)
  return {
    lng: originLon + x / metersPerDegLon,
    lat: originLat - y / METERS_PER_DEG_LAT, // Konva y-down = geographic south
  }
}

/**
 * Convert geographic coordinates (lng/lat) to world coordinates (meters).
 * @param lng longitude
 * @param lat latitude
 * @param originLat design location latitude
 * @param originLon design location longitude
 */
export function geoToWorld(
  lng: number,
  lat: number,
  originLat: number,
  originLon: number,
): { x: number; y: number } {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180)
  return {
    x: (lng - originLon) * metersPerDegLon,
    y: -(lat - originLat) * METERS_PER_DEG_LAT, // geographic north = Konva y-up (negative)
  }
}

/**
 * Convert Konva stage zoom level to an approximate MapLibre zoom level.
 * Konva stageScale = pixels per meter.
 * MapLibre zoom level relates to meters per pixel at equator.
 *
 * At MapLibre zoom 0, one pixel ≈ 156543m (at equator).
 * At zoom z, one pixel ≈ 156543 / 2^z meters.
 * So: stageScale = 2^z / 156543 → z = log2(stageScale * 156543)
 */
export function stageScaleToMapZoom(stageScale: number, lat: number): number {
  const metersPerPxAtEquator = 156543.03392
  const cosLat = Math.cos((lat * Math.PI) / 180)
  return Math.log2(stageScale * metersPerPxAtEquator * cosLat)
}

/**
 * Convert the Konva stage viewport center to geographic coordinates.
 */
export function stageViewportCenter(
  stage: { width(): number; height(): number; position(): { x: number; y: number }; scaleX(): number },
  originLat: number,
  originLon: number,
): { lng: number; lat: number } {
  const pos = stage.position()
  const scale = stage.scaleX()
  const centerWorldX = (-pos.x + stage.width() / 2) / scale
  const centerWorldY = (-pos.y + stage.height() / 2) / scale
  return worldToGeo(centerWorldX, centerWorldY, originLat, originLon)
}
