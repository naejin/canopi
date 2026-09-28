// Forward migrations of `.canopi` Designs (ADR 0013): the Web mirror of
// `common-types/src/migrations.rs`, step for step, so the shared conformance
// corpus admits the same document on both trust boundaries. Nothing outside
// this module and `design-ingestion.ts` reads an older format.
//
// - v7 (first Canopi 2 preview, geolocated) → v8: `views` and `stories`
//   appear, empty.
// - v8 → v9: a zone's name becomes its `id` (and its display name when the
//   user typed it); `zone_name` targets become `zone_id`; LiDAR `Analysis`
//   entries become `Derived`.
//
// Formats before v7 held local metres and are refused as `unsupported_version`
// (user decision of 2026-09-28: support back to v7, refuse older with a message).

import {
  CURRENT_CANOPI_FILE_VERSION,
  MINIMUM_SUPPORTED_CANOPI_FILE_VERSION,
} from '../../generated/canopi-design-format'

export type JsonObject = Record<string, unknown>

/** A current-format document; `migratedFrom` is null when the input already was current. */
export interface Migrated {
  readonly value: JsonObject
  readonly migratedFrom: number | null
}

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

export function unsupportedVersionMessage(version: number): string {
  return `$.version: unsupported Canopi Design version ${version}; this build opens versions ${MINIMUM_SUPPORTED_CANOPI_FILE_VERSION} to ${CURRENT_CANOPI_FILE_VERSION}`
}

/** Upgrade `value`, a document at format `from`, to the current format. */
export function migrateToCurrent(value: unknown, from: number): Migrated {
  if (from < MINIMUM_SUPPORTED_CANOPI_FILE_VERSION || from > CURRENT_CANOPI_FILE_VERSION) {
    throw new DesignMigrationError('unsupported_version', unsupportedVersionMessage(from), from)
  }
  if (!isRecord(value)) {
    throw new DesignMigrationError('invalid_document', '$: expected a Canopi Design object')
  }
  if (from === CURRENT_CANOPI_FILE_VERSION) return { value, migratedFrom: null }
  const object: JsonObject = structuredClone(value)
  for (let version = from; version < CURRENT_CANOPI_FILE_VERSION; version += 1) {
    switch (version) {
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
  return { value: object, migratedFrom: from }
}

function forEachObject(object: JsonObject, key: string, visit: (item: JsonObject) => void): void {
  const items = object[key]
  if (!Array.isArray(items)) return
  for (const item of items) if (isRecord(item)) visit(item)
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

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
