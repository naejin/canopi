import type {
  SceneObjectGroupMember,
  ScenePoint,
} from './runtime/scene'

export interface SavedObjectStampPayload {
  readonly version: 1
  readonly anchor: ScenePoint
  readonly plants: SavedObjectStampPlant[]
  readonly zones: SavedObjectStampZone[]
  readonly annotations: SavedObjectStampAnnotation[]
  readonly groups: SavedObjectStampGroup[]
}

export interface SavedObjectStampPlant {
  readonly id: string
  readonly canonicalName: string
  readonly commonName: string | null
  readonly color: string | null
  readonly symbol?: string | null
  readonly position: ScenePoint
  readonly rotationDeg: number | null
  readonly scale: number | null
}

export interface SavedObjectStampZone {
  readonly id: string
  readonly name: string
  readonly zoneType: string
  readonly points: ScenePoint[]
  readonly rotationDeg: number
  readonly fillColor: string | null
}

export interface SavedObjectStampAnnotation {
  readonly id: string
  readonly annotationType: string
  readonly position: ScenePoint
  readonly text: string
  readonly fontSize: number
  readonly rotationDeg: number | null
}

export interface SavedObjectStampGroup {
  readonly id: string
  readonly name: string | null
  readonly members: SceneObjectGroupMember[]
}

export function parseSavedObjectStampPayload(raw: string): SavedObjectStampPayload | null {
  if (!raw) return null

  try {
    return normalizeSavedObjectStampPayload(JSON.parse(raw))
  } catch {
    return null
  }
}

export function normalizeSavedObjectStampPayload(data: unknown): SavedObjectStampPayload | null {
  if (!isRecord(data)) return null
  if (data.version !== 1) return null
  const anchor = pointFromUnknown(data.anchor)
  if (!anchor) return null

  const plants = arrayFromUnknown(data.plants, plantFromUnknown)
  const zones = arrayFromUnknown(data.zones, zoneFromUnknown)
  const annotations = arrayFromUnknown(data.annotations, annotationFromUnknown)
  const groups = arrayFromUnknown(data.groups, groupFromUnknown)
  if (!plants || !zones || !annotations || !groups) return null

  return {
    version: 1,
    anchor,
    plants,
    zones,
    annotations,
    groups,
  }
}

function plantFromUnknown(data: unknown): SavedObjectStampPlant | null {
  if (!isRecord(data)) return null
  const id = stringFromUnknown(data.id)
  const canonicalName = stringFromUnknown(data.canonicalName)
  const position = pointFromUnknown(data.position)
  if (!id || !canonicalName || !position) return null

  return {
    id,
    canonicalName,
    commonName: nullableStringFromUnknown(data.commonName),
    color: nullableStringFromUnknown(data.color),
    symbol: nullableStringFromUnknown(data.symbol),
    position,
    rotationDeg: nullableNumberFromUnknown(data.rotationDeg),
    scale: nullableNumberFromUnknown(data.scale),
  }
}

function zoneFromUnknown(data: unknown): SavedObjectStampZone | null {
  if (!isRecord(data)) return null
  const id = stringFromUnknown(data.id)
  const name = stringFromUnknown(data.name)
  const zoneType = stringFromUnknown(data.zoneType)
  const points = arrayFromUnknown(data.points, pointFromUnknown)
  if (!id || !name || !zoneType || !points || points.length === 0) return null

  return {
    id,
    name,
    zoneType,
    points,
    rotationDeg: numberFromUnknown(data.rotationDeg) ?? 0,
    fillColor: nullableStringFromUnknown(data.fillColor),
  }
}

function annotationFromUnknown(data: unknown): SavedObjectStampAnnotation | null {
  if (!isRecord(data)) return null
  const id = stringFromUnknown(data.id)
  const annotationType = stringFromUnknown(data.annotationType)
  const position = pointFromUnknown(data.position)
  const text = stringFromUnknown(data.text)
  const fontSize = numberFromUnknown(data.fontSize)
  if (!id || !annotationType || !position || text === null || fontSize === null) return null

  return {
    id,
    annotationType,
    position,
    text,
    fontSize,
    rotationDeg: nullableNumberFromUnknown(data.rotationDeg),
  }
}

function groupFromUnknown(data: unknown): SavedObjectStampGroup | null {
  if (!isRecord(data)) return null
  const id = stringFromUnknown(data.id)
  if (!id) return null
  const members = arrayFromUnknown(data.members, groupMemberFromUnknown)
  if (!members) return null

  return {
    id,
    name: nullableStringFromUnknown(data.name),
    members,
  }
}

function groupMemberFromUnknown(data: unknown): SceneObjectGroupMember | null {
  if (!isRecord(data)) return null
  const kind = data.kind
  const id = stringFromUnknown(data.id)
  if (!id) return null
  if (kind === 'plant' || kind === 'zone' || kind === 'annotation') return { kind, id }
  return null
}

function pointFromUnknown(data: unknown): ScenePoint | null {
  if (!isRecord(data)) return null
  const x = numberFromUnknown(data.x)
  const y = numberFromUnknown(data.y)
  if (x === null || y === null) return null
  return { x, y }
}

function arrayFromUnknown<T>(
  data: unknown,
  map: (entry: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(data)) return null
  const result: T[] = []
  for (const entry of data) {
    const mapped = map(entry)
    if (mapped === null) return null
    result.push(mapped)
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function nullableStringFromUnknown(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberFromUnknown(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nullableNumberFromUnknown(value: unknown): number | null {
  return value === null || value === undefined ? null : numberFromUnknown(value)
}
