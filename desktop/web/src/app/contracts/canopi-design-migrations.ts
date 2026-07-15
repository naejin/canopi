import {
  MISSING_CANOPI_FILE_VERSION,
  MIN_SUPPORTED_CANOPI_FILE_VERSION,
} from '../../generated/canopi-design-format'
import { CanopiDesignIngestionError } from './canopi-design-errors'

export function migrateCanopiDesignValue(
  value: unknown,
  currentVersion: number,
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error('$: expected a Canopi Design object')

  const migrated = cloneJsonRecord(value, '$')
  const version = readInputVersion(migrated)
  if (version > currentVersion) {
    throw new CanopiDesignIngestionError(
      'unsupported_version',
      `$.version: unsupported Canopi Design version ${version}; current version is ${currentVersion}`,
    )
  }

  let nextVersion = version
  while (nextVersion < currentVersion) {
    switch (nextVersion) {
      case 1:
        migrateVersion1To2(migrated)
        break
      case 2:
        migrateVersion2To3(migrated)
        break
      case 3:
        migrateVersion3To4(migrated)
        break
      case 4:
        migrateVersion4To5(migrated)
        break
      default:
        throw new Error(`$.version: migration from Canopi Design version ${nextVersion} is unavailable`)
    }
    nextVersion = readInputVersion(migrated)
  }

  migrateLegacyObjectGroups(migrated)

  return migrated
}

function migrateLegacyObjectGroups(value: Record<string, unknown>): void {
  if (!Array.isArray(value.groups)) return

  const plantIds = stringFieldSet(value.plants, 'id')
  const zoneIds = stringFieldSet(value.zones, 'name')
  const annotationIds = stringFieldSet(value.annotations, 'id')
  const migrated: unknown[] = []

  value.groups.forEach((group, groupIndex) => {
    if (!isRecord(group)) {
      migrated.push(group)
      return
    }

    const membersPath = `$.groups[${groupIndex}].members`
    if (Object.prototype.hasOwnProperty.call(group, 'members') && group.members !== null) {
      if (!Array.isArray(group.members)) throw new Error(`${membersPath}: expected an array`)
      group.members = dedupeGroupMembers(group.members)
      migrated.push(group)
      return
    }

    const memberIdsPath = `$.groups[${groupIndex}].member_ids`
    const memberIds = group.member_ids
    if (memberIds !== undefined && memberIds !== null && !Array.isArray(memberIds)) {
      throw new Error(`${memberIdsPath}: expected an array`)
    }

    const resolved: Record<string, unknown>[] = []
    for (const [memberIndex, memberId] of (Array.isArray(memberIds) ? memberIds : []).entries()) {
      if (typeof memberId !== 'string') {
        throw new Error(`${memberIdsPath}[${memberIndex}]: expected a string`)
      }
      const member = resolveLegacyGroupMember(memberId, plantIds, zoneIds, annotationIds)
      if (member && !hasGroupMember(resolved, member)) resolved.push(member)
    }
    if (resolved.length < 2) return
    group.members = resolved
    migrated.push(group)
  })

  value.groups = migrated
}

function stringFieldSet(entries: unknown, field: string): Set<string> {
  return new Set(
    arrayEntries(entries)
      .filter(isRecord)
      .map((entry) => entry[field])
      .filter((entry): entry is string => typeof entry === 'string'),
  )
}

function resolveLegacyGroupMember(
  id: string,
  plantIds: ReadonlySet<string>,
  zoneIds: ReadonlySet<string>,
  annotationIds: ReadonlySet<string>,
): Record<string, unknown> | null {
  const matches: Record<string, unknown>[] = []
  if (plantIds.has(id)) matches.push({ kind: 'plant', id })
  if (zoneIds.has(id)) matches.push({ kind: 'zone', id })
  if (annotationIds.has(id)) matches.push({ kind: 'annotation', id })
  return matches.length === 1 ? matches[0] ?? null : null
}

function dedupeGroupMembers(members: unknown[]): unknown[] {
  const deduped: unknown[] = []
  for (const member of members) {
    if (!isTypedGroupMember(member) || !hasGroupMember(deduped, member)) {
      deduped.push(member)
    }
  }
  return deduped
}

function hasGroupMember(members: readonly unknown[], candidate: Record<string, unknown>): boolean {
  return members.some((member) => (
    isTypedGroupMember(member)
    && member.kind === candidate.kind
    && member.id === candidate.id
  ))
}

function isTypedGroupMember(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.kind === 'plant' || value.kind === 'zone' || value.kind === 'annotation')
}

function migrateVersion1To2(value: Record<string, unknown>): void {
  migrateLegacyTimelineTargets(value)
  migrateLegacyBudgetTargets(value)
  migrateLegacyConsortiums(value)
  value.version = 2
}

function migrateLegacyTimelineTargets(value: Record<string, unknown>): void {
  const plantIds = new Set(
    arrayEntries(value.plants)
      .filter(isRecord)
      .map((plant) => plant.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )

  for (const action of arrayEntries(value.timeline)) {
    if (!isRecord(action) || Array.isArray(action.targets)) continue

    const targets: Record<string, unknown>[] = []
    for (const reference of arrayEntries(action.plants)) {
      if (typeof reference !== 'string') continue
      const trimmed = reference.trim()
      if (trimmed.length === 0) continue
      targets.push(plantIds.has(trimmed)
        ? { kind: 'placed_plant', plant_id: trimmed }
        : speciesTarget(trimmed))
    }
    if (typeof action.zone === 'string' && action.zone.trim().length > 0) {
      targets.push({ kind: 'zone', zone_name: action.zone.trim() })
    }
    action.targets = targets.length > 0 ? targets : [manualTarget()]
  }
}

function migrateLegacyBudgetTargets(value: Record<string, unknown>): void {
  for (const item of arrayEntries(value.budget)) {
    if (!isRecord(item) || Object.prototype.hasOwnProperty.call(item, 'target')) continue
    const description = typeof item.description === 'string' ? item.description.trim() : ''
    item.target = item.category === 'plants' && description.length > 0
      ? speciesTarget(description)
      : manualTarget()
  }
}

function migrateLegacyConsortiums(value: Record<string, unknown>): void {
  const plantLookup = new Map<string, string>()
  for (const plant of arrayEntries(value.plants)) {
    if (!isRecord(plant) || typeof plant.canonical_name !== 'string') continue
    if (typeof plant.id === 'string' && plant.id.length > 0) {
      plantLookup.set(plant.id, plant.canonical_name)
    }
    plantLookup.set(plant.canonical_name, plant.canonical_name)
  }

  if (!Array.isArray(value.consortiums)) return
  const migrated: unknown[] = []
  const seenSpecies = new Set<string>()
  for (const entry of value.consortiums) {
    if (!isRecord(entry)) continue

    if (Object.prototype.hasOwnProperty.call(entry, 'canonical_name')) {
      if (typeof entry.canonical_name === 'string') {
        const canonicalName = entry.canonical_name.trim()
        seenSpecies.add(canonicalName)
        if (!Object.prototype.hasOwnProperty.call(entry, 'target')) {
          entry.target = speciesTarget(canonicalName)
        }
      }
      migrated.push(entry)
      continue
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'target')) {
      if (
        isRecord(entry.target)
        && typeof entry.target.canonical_name === 'string'
      ) {
        seenSpecies.add(entry.target.canonical_name.trim())
      }
      migrated.push(entry)
      continue
    }

    const references = Object.prototype.hasOwnProperty.call(entry, 'plant_ids')
      ? entry.plant_ids
      : entry.plants
    if (!Array.isArray(references)) continue

    for (const reference of references) {
      if (typeof reference !== 'string') continue
      const canonicalName = (plantLookup.get(reference) ?? reference).trim()
      if (canonicalName.length === 0 || seenSpecies.has(canonicalName)) continue
      seenSpecies.add(canonicalName)
      migrated.push({
        target: speciesTarget(canonicalName),
        stratum: 'unassigned',
        start_phase: 0,
        end_phase: 2,
      })
    }
  }
  value.consortiums = migrated
}

function speciesTarget(canonicalName: string): Record<string, unknown> {
  return { kind: 'species', canonical_name: canonicalName }
}

function manualTarget(): Record<string, unknown> {
  return { kind: 'manual' }
}

function arrayEntries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readInputVersion(value: Record<string, unknown>): number {
  const version = Object.prototype.hasOwnProperty.call(value, 'version')
    ? value.version
    : MISSING_CANOPI_FILE_VERSION
  if (
    typeof version !== 'number'
    || !Number.isInteger(version)
    || version < MIN_SUPPORTED_CANOPI_FILE_VERSION
  ) {
    throw new CanopiDesignIngestionError(
      'invalid_version',
      '$.version: expected a positive integer',
    )
  }
  return version
}

function migrateVersion2To3(value: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(value, 'plant_species_symbols')) {
    value.plant_species_symbols = {}
  }
  value.version = 3
}

function migrateVersion3To4(value: Record<string, unknown>): void {
  if (Array.isArray(value.plants)) {
    for (const plant of value.plants) {
      if (isRecord(plant) && !Object.prototype.hasOwnProperty.call(plant, 'pinned_name')) {
        plant.pinned_name = false
      }
    }
  }
  value.version = 4
}

function migrateVersion4To5(value: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(value, 'measurement_guides')) {
    value.measurement_guides = []
  }
  if (Array.isArray(value.layers) && !value.layers.some(isMeasurementGuidesLayer)) {
    const annotationIndex = value.layers.findIndex(isAnnotationsLayer)
    value.layers.splice(annotationIndex < 0 ? value.layers.length : annotationIndex, 0, {
      name: 'measurement-guides',
      visible: true,
      locked: false,
      opacity: 1,
    })
  }
  value.version = 5
}

function isMeasurementGuidesLayer(value: unknown): boolean {
  return isRecord(value) && value.name === 'measurement-guides'
}

function isAnnotationsLayer(value: unknown): boolean {
  return isRecord(value) && value.name === 'annotations'
}

function cloneJsonRecord(value: Record<string, unknown>, path: string): Record<string, unknown> {
  return cloneJsonValue(value, path, new Set()) as Record<string, unknown>
}

function cloneJsonValue(value: unknown, path: string, ancestors: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path}: expected a finite number`)
    return value
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error(`${path}: expected an acyclic JSON value`)
    ancestors.add(value)
    const cloned = value.map((entry, index) => cloneJsonValue(entry, `${path}[${index}]`, ancestors))
    ancestors.delete(value)
    return cloned
  }
  if (!isPlainRecord(value)) throw new Error(`${path}: expected a JSON value`)
  if (ancestors.has(value)) throw new Error(`${path}: expected an acyclic JSON value`)

  ancestors.add(value)
  const cloned: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    defineJsonProperty(cloned, key, cloneJsonValue(entry, pathForProperty(path, key), ancestors))
  }
  ancestors.delete(value)
  return cloned
}

function defineJsonProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}

function pathForProperty(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
