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

import type { ScenePersistedState } from './runtime/scene'

const EARTH_RADIUS_METERS = 6371008.8
const EARTH_CIRCUMFERENCE_METERS = 2 * Math.PI * EARTH_RADIUS_METERS
const DEGREES_TO_RADIANS = Math.PI / 180
const MAPLIBRE_WORLD_TILE_SIZE = 512
export const LOCAL_PROJECTION_WARNING_THRESHOLD_METERS = 10_000

export interface MapMercatorCoordinate {
  x: number
  y: number
}

export interface ProjectionPrecisionSnapshot {
  readonly backendId: string
  readonly warningThresholdMeters: number
  readonly designExtentMeters: number | null
  readonly precisionWarning: boolean
}

export interface ProjectionBackend {
  readonly id: string
  readonly warningThresholdMeters: number
  worldToMercator(
    x: number,
    y: number,
    originLat: number,
    originLon: number,
    northBearingDeg?: number | null,
  ): MapMercatorCoordinate
  mercatorToWorld(
    x: number,
    y: number,
    originLat: number,
    originLon: number,
    northBearingDeg?: number | null,
  ): { x: number; y: number }
  worldToGeo(
    x: number,
    y: number,
    originLat: number,
    originLon: number,
    northBearingDeg?: number | null,
  ): { lng: number; lat: number }
  geoToWorld(
    lng: number,
    lat: number,
    originLat: number,
    originLon: number,
    northBearingDeg?: number | null,
  ): { x: number; y: number }
  stageScaleToMapZoom(stageScale: number, lat: number): number
  viewportCenterWorld(
    viewport: { x: number; y: number; scale: number },
    screenSize: { width: number; height: number },
  ): { x: number; y: number }
  viewportCenterGeo(
    viewport: { x: number; y: number; scale: number },
    screenSize: { width: number; height: number },
    originLat: number,
    originLon: number,
    northBearingDeg?: number | null,
  ): { lng: number; lat: number }
  viewportCornerWorldPoints(
    viewport: { x: number; y: number; scale: number },
    screenSize: { width: number; height: number },
  ): readonly [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ]
  viewportCornerGeoPoints(
    viewport: { x: number; y: number; scale: number },
    screenSize: { width: number; height: number },
    originLat: number,
    originLon: number,
    northBearingDeg?: number | null,
  ): readonly [
    { lng: number; lat: number },
    { lng: number; lat: number },
    { lng: number; lat: number },
    { lng: number; lat: number },
  ]
  computeSceneExtentMeters(scene: ScenePersistedState): number | null
  createPrecisionSnapshot(scene: ScenePersistedState | null): ProjectionPrecisionSnapshot
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

function localWorldToMercator(
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

function localMercatorToWorld(
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

function localWorldToGeo(
  x: number,
  y: number,
  originLat: number,
  originLon: number,
  northBearingDeg: number | null = 0,
): { lng: number; lat: number } {
  const mercator = localWorldToMercator(x, y, originLat, originLon, northBearingDeg)
  return mercatorToGeo(mercator.x, mercator.y)
}

function localGeoToWorld(
  lng: number,
  lat: number,
  originLat: number,
  originLon: number,
  northBearingDeg: number | null = 0,
): { x: number; y: number } {
  const mercator = geoToMercator(lng, lat)
  return localMercatorToWorld(mercator.x, mercator.y, originLat, originLon, northBearingDeg)
}

/**
 * Convert canvas viewport scale to a MapLibre zoom level using the same
 * Mercator world-size convention as MapLibre's transform (512px world at z=0).
 */
function localStageScaleToMapZoom(stageScale: number, lat: number): number {
  const mercatorUnitsPerMeter = mercatorUnitsPerMeterAtLat(lat)
  const pixelsPerMercatorUnit = stageScale / mercatorUnitsPerMeter
  return Math.log2(pixelsPerMercatorUnit / MAPLIBRE_WORLD_TILE_SIZE)
}

function localViewportCenterWorld(
  viewport: { x: number; y: number; scale: number },
  screenSize: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: (screenSize.width / 2 - viewport.x) / viewport.scale,
    y: (screenSize.height / 2 - viewport.y) / viewport.scale,
  }
}

function localViewportCenterGeo(
  viewport: { x: number; y: number; scale: number },
  screenSize: { width: number; height: number },
  originLat: number,
  originLon: number,
  northBearingDeg: number | null = 0,
): { lng: number; lat: number } {
  const center = localViewportCenterWorld(viewport, screenSize)
  return localWorldToGeo(center.x, center.y, originLat, originLon, northBearingDeg)
}

function localViewportCornerWorldPoints(
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

function localViewportCornerGeoPoints(
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
  const [topLeft, topRight, bottomRight, bottomLeft] = localViewportCornerWorldPoints(viewport, screenSize)
  return [
    localWorldToGeo(topLeft.x, topLeft.y, originLat, originLon, northBearingDeg),
    localWorldToGeo(topRight.x, topRight.y, originLat, originLon, northBearingDeg),
    localWorldToGeo(bottomRight.x, bottomRight.y, originLat, originLon, northBearingDeg),
    localWorldToGeo(bottomLeft.x, bottomLeft.y, originLat, originLon, northBearingDeg),
  ]
}

function localComputeSceneExtentMeters(scene: ScenePersistedState): number | null {
  let maxDistanceMeters = 0
  let hasGeometry = false

  const includePoint = (x: number, y: number) => {
    hasGeometry = true
    maxDistanceMeters = Math.max(maxDistanceMeters, Math.hypot(x, y))
  }

  for (const plant of scene.plants) includePoint(plant.position.x, plant.position.y)
  for (const zone of scene.zones) {
    for (const point of zone.points) includePoint(point.x, point.y)
  }
  for (const annotation of scene.annotations) includePoint(annotation.position.x, annotation.position.y)
  for (const group of scene.groups) includePoint(group.position.x, group.position.y)

  return hasGeometry ? maxDistanceMeters : null
}

function localCreatePrecisionSnapshot(scene: ScenePersistedState | null): ProjectionPrecisionSnapshot {
  const designExtentMeters = scene ? localComputeSceneExtentMeters(scene) : null
  return {
    backendId: 'local-mercator',
    warningThresholdMeters: LOCAL_PROJECTION_WARNING_THRESHOLD_METERS,
    designExtentMeters,
    precisionWarning: designExtentMeters != null && designExtentMeters > LOCAL_PROJECTION_WARNING_THRESHOLD_METERS,
  }
}

export const LOCAL_MERCATOR_PROJECTION_BACKEND: ProjectionBackend = {
  id: 'local-mercator',
  warningThresholdMeters: LOCAL_PROJECTION_WARNING_THRESHOLD_METERS,
  worldToMercator: localWorldToMercator,
  mercatorToWorld: localMercatorToWorld,
  worldToGeo: localWorldToGeo,
  geoToWorld: localGeoToWorld,
  stageScaleToMapZoom: localStageScaleToMapZoom,
  viewportCenterWorld: localViewportCenterWorld,
  viewportCenterGeo: localViewportCenterGeo,
  viewportCornerWorldPoints: localViewportCornerWorldPoints,
  viewportCornerGeoPoints: localViewportCornerGeoPoints,
  computeSceneExtentMeters: localComputeSceneExtentMeters,
  createPrecisionSnapshot: localCreatePrecisionSnapshot,
}

export function getActiveProjectionBackend(): ProjectionBackend {
  return LOCAL_MERCATOR_PROJECTION_BACKEND
}

export function createProjectionPrecisionSnapshot(
  scene: ScenePersistedState | null,
): ProjectionPrecisionSnapshot {
  return getActiveProjectionBackend().createPrecisionSnapshot(scene)
}

export function computeSceneExtentMeters(scene: ScenePersistedState): number | null {
  return getActiveProjectionBackend().computeSceneExtentMeters(scene)
}

export function worldToMercator(
  x: number,
  y: number,
  originLat: number,
  originLon: number,
  northBearingDeg: number | null = 0,
): MapMercatorCoordinate {
  return getActiveProjectionBackend().worldToMercator(x, y, originLat, originLon, northBearingDeg)
}

export function mercatorToWorld(
  x: number,
  y: number,
  originLat: number,
  originLon: number,
  northBearingDeg: number | null = 0,
): { x: number; y: number } {
  return getActiveProjectionBackend().mercatorToWorld(x, y, originLat, originLon, northBearingDeg)
}

export function worldToGeo(
  x: number,
  y: number,
  originLat: number,
  originLon: number,
  northBearingDeg: number | null = 0,
): { lng: number; lat: number } {
  return getActiveProjectionBackend().worldToGeo(x, y, originLat, originLon, northBearingDeg)
}

export function geoToWorld(
  lng: number,
  lat: number,
  originLat: number,
  originLon: number,
  northBearingDeg: number | null = 0,
): { x: number; y: number } {
  return getActiveProjectionBackend().geoToWorld(lng, lat, originLat, originLon, northBearingDeg)
}

export function stageScaleToMapZoom(stageScale: number, lat: number): number {
  return getActiveProjectionBackend().stageScaleToMapZoom(stageScale, lat)
}

export function viewportCenterWorld(
  viewport: { x: number; y: number; scale: number },
  screenSize: { width: number; height: number },
): { x: number; y: number } {
  return getActiveProjectionBackend().viewportCenterWorld(viewport, screenSize)
}

export function viewportCenterGeo(
  viewport: { x: number; y: number; scale: number },
  screenSize: { width: number; height: number },
  originLat: number,
  originLon: number,
  northBearingDeg: number | null = 0,
): { lng: number; lat: number } {
  return getActiveProjectionBackend().viewportCenterGeo(
    viewport,
    screenSize,
    originLat,
    originLon,
    northBearingDeg,
  )
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
  return getActiveProjectionBackend().viewportCornerWorldPoints(viewport, screenSize)
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
  return getActiveProjectionBackend().viewportCornerGeoPoints(
    viewport,
    screenSize,
    originLat,
    originLon,
    northBearingDeg,
  )
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
  return getActiveProjectionBackend().worldToGeo(
    centerWorldX,
    centerWorldY,
    originLat,
    originLon,
    northBearingDeg,
  )
}
