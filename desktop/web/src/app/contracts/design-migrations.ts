// Forward migrations of `.canopi` Designs (ADR 0013): the Web mirror of
// `common-types/src/migrations.rs`, step for step and formula for formula, so
// the shared conformance corpus admits the same document on both trust
// boundaries. Nothing outside this module and `design-ingestion.ts` reads an
// older format.
//
// - v5 (Canopi 1.2): local metres with an optional `location` → v6: the same
//   metres under a `spatial_frame` (confirmed when the file had a location).
// - v6 → v7: positions become lon/lat through the local Mercator frame; a
//   provisional frame has no site, so the step stops with `needs_site`.
// - v7 → v8: `views` and `stories` appear, empty.
// - v8 → v9: a zone's name becomes its `id` (and its display name when the
//   user typed it); `zone_name` targets become `zone_id`; LiDAR `Analysis`
//   entries become `Derived`.

import {
  CURRENT_CANOPI_FILE_VERSION,
  MINIMUM_SUPPORTED_CANOPI_FILE_VERSION,
} from '../../generated/canopi-design-format'
import type { PendingDesignSite } from '../../types/design'

export type JsonObject = Record<string, unknown>

export type MigrationOutcome =
  | { readonly kind: 'current'; readonly value: JsonObject; readonly migratedFrom: number | null }
  | { readonly kind: 'needs_site'; readonly pending: PendingDesignSite }

export class DesignMigrationError extends Error {
  constructor(
    readonly kind: 'unsupported_version' | 'invalid_document',
    message: string,
    /** The refused version when `kind` is `unsupported_version`. */
    readonly unsupportedVersion: number | null = null,
  ) {
    super(message)
    this.name = 'DesignMigrationError'
  }
}

const PROVISIONAL_ANCHOR = { lon: 13, lat: 23 } as const
const RETIRED_LAYER_NAMES: readonly string[] = ['base', 'contours']
const EARTH_RADIUS_METERS = 6371008.8
const EARTH_CIRCUMFERENCE_METERS = 2 * Math.PI * EARTH_RADIUS_METERS
const DEGREES_TO_RADIANS = Math.PI / 180
const WEB_MERCATOR_MAX_LATITUDE_DEG = 85.0511287798066

export function unsupportedVersionMessage(version: number): string {
  return `$.version: unsupported Canopi Design version ${version}; this build opens versions ${MINIMUM_SUPPORTED_CANOPI_FILE_VERSION} to ${CURRENT_CANOPI_FILE_VERSION}`
}

/** Upgrade `value`, a document at format `from`, to the current format. */
export function migrateToCurrent(value: unknown, from: number): MigrationOutcome {
  if (from < MINIMUM_SUPPORTED_CANOPI_FILE_VERSION || from > CURRENT_CANOPI_FILE_VERSION) {
    throw new DesignMigrationError('unsupported_version', unsupportedVersionMessage(from), from)
  }
  if (!isRecord(value)) {
    throw new DesignMigrationError('invalid_document', '$: expected a Canopi Design object')
  }
  if (from === CURRENT_CANOPI_FILE_VERSION) return { kind: 'current', value, migratedFrom: null }
  let object: JsonObject = structuredClone(value)
  for (let version = from; version < CURRENT_CANOPI_FILE_VERSION; version += 1) {
    switch (version) {
      case 5:
        stepV5ToV6(object)
        break
      case 6: {
        const placement = stepV6ToV7(object)
        if (placement.kind === 'needs_site') {
          return { kind: 'needs_site', pending: describePending(placement.document, from) }
        }
        object = placement.document
        break
      }
      case 7:
        stepV7ToV8(object)
        break
      case 8:
        stepV8ToV9(object)
        break
      default:
        throw new DesignMigrationError('unsupported_version', unsupportedVersionMessage(version), version)
    }
  }
  return { kind: 'current', value: object, migratedFrom: from }
}

/**
 * Finish a pending Design: its objects, centred on their own extent, land
 * around `site` with north up, then the rest of the ladder runs.
 */
export function placeAtSite(
  pending: PendingDesignSite,
  site: { readonly lon: number; readonly lat: number },
): MigrationOutcome {
  if (!isValidGeoPoint(site)) {
    throw new DesignMigrationError(
      'invalid_document',
      '$.site: expected lon in [-180, 180] and a Web Mercator latitude',
    )
  }
  const object = readPendingDocument(pending)
  const bounds = localBounds(object)
  const centre = bounds
    ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
    : { x: 0, y: 0 }
  translateLocalGeometry(object, -centre.x, -centre.y)
  const frame = isRecord(object.spatial_frame) ? object.spatial_frame : {}
  frame.anchor_longitude_deg = site.lon
  frame.anchor_latitude_deg = site.lat
  frame.placement_status = 'confirmed'
  if (!Object.prototype.hasOwnProperty.call(frame, 'north_bearing_deg')) frame.north_bearing_deg = 0
  object.spatial_frame = frame
  const outcome = migrateToCurrent(object, 6)
  if (outcome.kind !== 'current') {
    throw new DesignMigrationError('invalid_document', '$.spatial_frame: the placed frame is still provisional')
  }
  return { kind: 'current', value: outcome.value, migratedFrom: pending.from_version }
}

function readPendingDocument(pending: PendingDesignSite): JsonObject {
  let document: unknown
  try {
    document = JSON.parse(pending.document_json)
  } catch (error) {
    throw new DesignMigrationError(
      'invalid_document',
      `$: pending Design is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!isRecord(document)) {
    throw new DesignMigrationError('invalid_document', '$: expected a pending Canopi Design object')
  }
  return document
}

function describePending(document: JsonObject, fromVersion: number): PendingDesignSite {
  const count = (key: string) => (Array.isArray(document[key]) ? (document[key] as unknown[]).length : 0)
  const bounds = localBounds(document)
  const plantCount = count('plants')
  const zoneCount = count('zones')
  return {
    from_version: fromVersion,
    name: typeof document.name === 'string' ? document.name : '',
    plant_count: plantCount,
    zone_count: zoneCount,
    object_count: plantCount + zoneCount + count('annotations') + count('measurement_guides'),
    width_m: bounds ? bounds.maxX - bounds.minX : 0,
    height_m: bounds ? bounds.maxY - bounds.minY : 0,
    document_json: JSON.stringify(document),
  }
}

// ---------------------------------------------------------------------------
// v5 → v6
// ---------------------------------------------------------------------------

function stepV5ToV6(object: JsonObject): void {
  const location = object.location
  delete object.location
  const rawBearing = object.north_bearing_deg
  delete object.north_bearing_deg
  const bearing = typeof rawBearing === 'number' && Number.isFinite(rawBearing) ? rawBearing : 0
  let anchor: { lon: number; lat: number } | null = null
  let altitude: number | null = null
  if (isRecord(location)) {
    const { lon, lat } = location
    if (typeof lon === 'number' && typeof lat === 'number' && isValidGeoPoint({ lon, lat })) {
      anchor = { lon, lat }
    }
    if (typeof location.altitude_m === 'number' && Number.isFinite(location.altitude_m)) {
      altitude = location.altitude_m
    }
  }
  object.spatial_frame = {
    anchor_longitude_deg: anchor ? anchor.lon : PROVISIONAL_ANCHOR.lon,
    anchor_latitude_deg: anchor ? anchor.lat : PROVISIONAL_ANCHOR.lat,
    north_bearing_deg: bearing,
    placement_status: anchor ? 'confirmed' : 'provisional',
    location_metadata: { altitude_m: altitude },
  }
  object.version = 6
}

// ---------------------------------------------------------------------------
// v6 → v7
// ---------------------------------------------------------------------------

type Placement =
  | { readonly kind: 'placed'; readonly document: JsonObject }
  | { readonly kind: 'needs_site'; readonly document: JsonObject }

interface LocalPoint {
  readonly x: number
  readonly y: number
}

/** The local Mercator frame a v6 `spatial_frame` describes. */
class LocalFrame {
  private readonly mercatorOriginX: number
  private readonly mercatorOriginY: number
  private readonly unitsPerMeter: number
  private readonly bearingCos: number
  private readonly bearingSin: number

  constructor(anchor: { readonly lon: number; readonly lat: number }, private readonly bearingDeg: number) {
    const bearingRad = bearingDeg * DEGREES_TO_RADIANS
    this.mercatorOriginX = mercatorXFromLon(anchor.lon)
    this.mercatorOriginY = mercatorYFromLat(anchor.lat)
    this.unitsPerMeter = 1 / EARTH_CIRCUMFERENCE_METERS / Math.cos(anchor.lat * DEGREES_TO_RADIANS)
    this.bearingCos = Math.cos(bearingRad)
    this.bearingSin = Math.sin(bearingRad)
  }

  eastNorth(x: number, y: number): { east: number; north: number } {
    return {
      east: x * this.bearingCos + y * this.bearingSin,
      north: x * this.bearingSin - y * this.bearingCos,
    }
  }

  geoFromEastNorth(east: number, north: number): { lon: number; lat: number } {
    const lon = lonFromMercatorX(this.mercatorOriginX + east * this.unitsPerMeter)
    const lat = latFromMercatorY(this.mercatorOriginY - north * this.unitsPerMeter)
    return { lon: roundGeoDegrees(lon), lat: roundGeoDegrees(lat) }
  }

  geo(x: number, y: number): { lon: number; lat: number } {
    const { east, north } = this.eastNorth(x, y)
    return this.geoFromEastNorth(east, north)
  }

  /** A canvas rotation (degrees clockwise on the canvas) as degrees clockwise from true north. */
  rotation(canvasDegrees: number): number {
    const normalized = remEuclid(canvasDegrees - this.bearingDeg, 360)
    return normalized === 0 ? 0 : normalized
  }
}

function stepV6ToV7(object: JsonObject): Placement {
  const frame = object.spatial_frame
  if (!isRecord(frame)) {
    throw new DesignMigrationError('invalid_document', '$.spatial_frame: expected the v6 spatial frame object')
  }
  if (frame.placement_status !== 'confirmed') return { kind: 'needs_site', document: object }
  const anchor = {
    lon: typeof frame.anchor_longitude_deg === 'number' ? frame.anchor_longitude_deg : Number.NaN,
    lat: typeof frame.anchor_latitude_deg === 'number' ? frame.anchor_latitude_deg : Number.NaN,
  }
  if (!isValidGeoPoint(anchor)) {
    throw new DesignMigrationError(
      'invalid_document',
      '$.spatial_frame: expected a finite anchor in WGS84 and Web Mercator range',
    )
  }
  const bearing = typeof frame.north_bearing_deg === 'number' ? frame.north_bearing_deg : 0
  if (!Number.isFinite(bearing)) {
    throw new DesignMigrationError('invalid_document', '$.spatial_frame.north_bearing_deg: expected a finite number')
  }
  const local = new LocalFrame(anchor, bearing)
  delete object.spatial_frame

  forEachObject(object, 'plants', (plant) => {
    const point = localPoint(plant.position)
    if (point) plant.position = local.geo(point.x, point.y)
    rotateField(plant, 'rotation', local)
  })
  forEachObject(object, 'annotations', (annotation) => {
    const point = localPoint(annotation.position)
    if (point) annotation.position = local.geo(point.x, point.y)
    rotateField(annotation, 'rotation', local)
  })
  forEachObject(object, 'measurement_guides', (guide) => {
    for (const key of ['start', 'end'] as const) {
      const point = localPoint(guide[key])
      if (point) guide[key] = local.geo(point.x, point.y)
    }
  })
  forEachObject(object, 'zones', (zone) => {
    const points = Array.isArray(zone.points)
      ? zone.points.map((point) => localPoint(point)).filter((point): point is LocalPoint => point !== null)
      : []
    const boxed = zone.zone_type === 'rect' || zone.zone_type === 'rectangle' || zone.zone_type === 'ellipse'
    let projected: { lon: number; lat: number }[]
    if (boxed && points.length === 2) {
      // Opposite corners of the unrotated box: keep the box's size and centre,
      // whatever the frame's bearing.
      const centre = { x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2 }
      const { east: centreEast, north: centreNorth } = local.eastNorth(centre.x, centre.y)
      projected = points.map((point) =>
        local.geoFromEastNorth(centreEast + (point.x - centre.x), centreNorth - (point.y - centre.y)))
    } else {
      projected = points.map((point) => local.geo(point.x, point.y))
    }
    zone.points = projected
    const rotation = typeof zone.rotation === 'number' ? zone.rotation : 0
    zone.rotation = local.rotation(rotation)
  })
  if (Array.isArray(object.guides)) {
    const placed: JsonObject[] = []
    for (const guide of object.guides) {
      if (!isRecord(guide)) continue
      const { id, axis, position } = guide
      if (typeof id !== 'string' || typeof axis !== 'string' || typeof position !== 'number') continue
      if (axis === 'h') placed.push({ id, axis: 'h', lat: local.geo(0, position).lat })
      else if (axis === 'v') placed.push({ id, axis: 'v', lon: local.geo(position, 0).lon })
    }
    object.guides = placed
  }
  if (Array.isArray(object.layers)) {
    object.layers = object.layers.filter((layer) =>
      !(isRecord(layer) && typeof layer.name === 'string' && RETIRED_LAYER_NAMES.includes(layer.name)))
  }
  object.version = 7
  return { kind: 'placed', document: object }
}

function rotateField(item: JsonObject, key: string, local: LocalFrame): void {
  const rotation = item[key]
  if (typeof rotation === 'number') item[key] = local.rotation(rotation)
}

function localPoint(value: unknown): LocalPoint | null {
  if (!isRecord(value)) return null
  const { x, y } = value
  if (typeof x !== 'number' || typeof y !== 'number') return null
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

function forEachObject(object: JsonObject, key: string, visit: (item: JsonObject) => void): void {
  const items = object[key]
  if (!Array.isArray(items)) return
  for (const item of items) if (isRecord(item)) visit(item)
}

interface LocalBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function localBounds(document: JsonObject): LocalBounds | null {
  let bounds: LocalBounds | null = null
  const include = (value: unknown) => {
    const point = localPoint(value)
    if (!point) return
    if (!bounds) bounds = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }
    bounds.minX = Math.min(bounds.minX, point.x)
    bounds.minY = Math.min(bounds.minY, point.y)
    bounds.maxX = Math.max(bounds.maxX, point.x)
    bounds.maxY = Math.max(bounds.maxY, point.y)
  }
  const items = (key: string): unknown[] => (Array.isArray(document[key]) ? document[key] as unknown[] : [])
  for (const plant of items('plants')) if (isRecord(plant)) include(plant.position)
  for (const annotation of items('annotations')) if (isRecord(annotation)) include(annotation.position)
  for (const guide of items('measurement_guides')) {
    if (!isRecord(guide)) continue
    include(guide.start)
    include(guide.end)
  }
  for (const zone of items('zones')) {
    if (!isRecord(zone) || !Array.isArray(zone.points)) continue
    for (const point of zone.points) include(point)
  }
  return bounds
}

function translateLocalGeometry(object: JsonObject, dx: number, dy: number): void {
  const shift = (value: unknown): unknown => {
    const point = localPoint(value)
    return point ? { x: point.x + dx, y: point.y + dy } : value
  }
  for (const key of ['plants', 'annotations']) {
    forEachObject(object, key, (item) => { item.position = shift(item.position) })
  }
  forEachObject(object, 'measurement_guides', (guide) => {
    guide.start = shift(guide.start)
    guide.end = shift(guide.end)
  })
  forEachObject(object, 'zones', (zone) => {
    if (Array.isArray(zone.points)) zone.points = zone.points.map(shift)
  })
  forEachObject(object, 'guides', (guide) => {
    if (typeof guide.position !== 'number') return
    if (guide.axis === 'h') guide.position += dy
    else if (guide.axis === 'v') guide.position += dx
  })
}

// ---------------------------------------------------------------------------
// v7 → v8
// ---------------------------------------------------------------------------

function stepV7ToV8(object: JsonObject): void {
  for (const key of ['views', 'stories']) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) object[key] = []
  }
  object.version = 8
}

// ---------------------------------------------------------------------------
// v8 → v9
// ---------------------------------------------------------------------------

function stepV8ToV9(object: JsonObject): void {
  const taken = new Set<string>()
  forEachObject(object, 'zones', (zone) => {
    const name = zone.name
    if (typeof name !== 'string') return
    // The old name stays the identity so targets, groups and saved views
    // still resolve; a second zone with the same name gets a numbered id.
    let id = name
    let n = 2
    while (taken.has(id)) {
      id = `${name} (${n})`
      n += 1
    }
    taken.add(id)
    zone.id = id
    zone.name = isGeneratedZoneName(name) ? null : name
  })
  forEachObject(object, 'timeline', (action) => {
    if (Array.isArray(action.targets)) action.targets.forEach(convertZoneTarget)
  })
  forEachObject(object, 'budget', (item) => {
    convertZoneTarget(item.target)
  })
  if (isRecord(object.lidar)) {
    forEachObject(object.lidar, 'entries', (entry) => {
      if (entry.kind === 'Analysis') entry.kind = 'Derived'
    })
  }
  object.version = 9
}

function convertZoneTarget(target: unknown): void {
  if (!isRecord(target) || target.kind !== 'zone') return
  if (!Object.prototype.hasOwnProperty.call(target, 'zone_name')) return
  const name = target.zone_name
  delete target.zone_name
  if (!Object.prototype.hasOwnProperty.call(target, 'zone_id')) target.zone_id = name
}

/**
 * A zone name Canopi generated (`zone-<uuid>`, a bare UUID, or a pasted
 * " copy" / " copy 2" of one) rather than one the user typed.
 */
export function isGeneratedZoneName(name: string): boolean {
  return /^(?:zone-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?: copy(?: \d+)?)*$/.test(name)
}

// ---------------------------------------------------------------------------
// Projection (the same formulas as canvas/projection.ts and the Rust module)
// ---------------------------------------------------------------------------

function mercatorXFromLon(lon: number): number {
  return (180 + lon) / 360
}

function mercatorYFromLat(lat: number): number {
  return (180 - (180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + lat * DEGREES_TO_RADIANS / 2)))) / 360
}

function lonFromMercatorX(x: number): number {
  return x * 360 - 180
}

function latFromMercatorY(y: number): number {
  const y2 = 180 - y * 360
  return 360 / Math.PI * Math.atan(Math.exp(y2 * Math.PI / 180)) - 90
}

/** 1e-9 degree, with `floor(v + 0.5)` so Rust and JavaScript agree on every half. */
function roundGeoDegrees(value: number): number {
  const rounded = Math.floor(value * 1e9 + 0.5) / 1e9
  return rounded === 0 ? 0 : rounded
}

function remEuclid(value: number, modulus: number): number {
  const remainder = value % modulus
  return remainder < 0 ? remainder + modulus : remainder
}

function isValidGeoPoint(point: { readonly lon: number; readonly lat: number }): boolean {
  return Number.isFinite(point.lon) && point.lon >= -180 && point.lon <= 180
    && Number.isFinite(point.lat) && Math.abs(point.lat) <= WEB_MERCATOR_MAX_LATITUDE_DEG
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
