import type { CanopiFile } from '../../types/design'

/** The LiDAR presentation schema this build writes (`common-types/src/lidar.rs`). */
const LIDAR_PRESENTATION_SCHEMA_VERSION = 1

/**
 * Identities and ranges of an admitted current-format Design: the Web mirror
 * of `admit_design_identities_and_ranges` in `common-types/src/design.rs`,
 * same rules and same messages. Returns the problem, or null after repairing
 * a plant or measurement guide without an id (an id is optional in the file).
 */
export function designIdentitiesAndRangesProblem(file: CanopiFile): string | null {
  const plantIds = explicitIds('plants', file.plants.map((plant) => plant.id))
  if (typeof plantIds === 'string') return plantIds
  for (const [index, plant] of file.plants.entries()) {
    if (!plant.id) plant.id = generatedId('plant', index, plantIds)
    if (plant.scale != null && !(Number.isFinite(plant.scale) && plant.scale > 0)) {
      return `$.plants[${index}].scale: expected a finite number above 0`
    }
    if (plant.rotation != null && !Number.isFinite(plant.rotation)) {
      return `$.plants[${index}].rotation: expected a finite number`
    }
  }
  const guides = file.measurement_guides ?? []
  const guideIds = explicitIds('measurement_guides', guides.map((guide) => guide.id))
  if (typeof guideIds === 'string') return guideIds
  for (const [index, guide] of guides.entries()) {
    if (!guide.id) guide.id = generatedId('measurement-guide', index, guideIds)
  }
  return uniqueIdsProblem('zones', file.zones.map((zone) => zone.id))
    ?? uniqueIdsProblem('annotations', file.annotations.map((annotation) => annotation.id))
    ?? uniqueIdsProblem('groups', file.groups.map((group) => group.id))
    ?? annotationRangesProblem(file)
    ?? layerRangesProblem(file)
    ?? lidarProblem(file)
}

function annotationRangesProblem(file: CanopiFile): string | null {
  for (const [index, annotation] of file.annotations.entries()) {
    if (!(Number.isFinite(annotation.font_size) && annotation.font_size > 0)) {
      return `$.annotations[${index}].font_size: expected a finite number above 0`
    }
    if (annotation.rotation != null && !Number.isFinite(annotation.rotation)) {
      return `$.annotations[${index}].rotation: expected a finite number`
    }
  }
  return null
}

function layerRangesProblem(file: CanopiFile): string | null {
  for (const [index, layer] of file.layers.entries()) {
    if (!(Number.isFinite(layer.opacity) && layer.opacity >= 0 && layer.opacity <= 1)) {
      return `$.layers[${index}].opacity: expected a number in [0, 1]`
    }
  }
  return null
}

function lidarProblem(file: CanopiFile): string | null {
  const lidar = file.lidar
  if (!lidar) return null
  if (lidar.schema_version !== LIDAR_PRESENTATION_SCHEMA_VERSION) {
    return `$.lidar.schema_version: expected ${LIDAR_PRESENTATION_SCHEMA_VERSION}`
  }
  for (const [index, entry] of lidar.entries.entries()) {
    if (!(Number.isFinite(entry.opacity) && entry.opacity >= 0 && entry.opacity <= 1)) {
      return `$.lidar.entries[${index}].opacity: expected a number in [0, 1]`
    }
  }
  return null
}

/**
 * Every explicit (non-empty) id of a list that may repair missing ids, or the
 * problem naming a duplicate among them. Collected before any id is
 * generated, so a generated id never takes an explicit id that comes later.
 */
function explicitIds(key: string, ids: readonly (string | undefined)[]): Set<string> | string {
  const seen = new Set<string>()
  for (const [index, id] of ids.entries()) {
    if (!id) continue
    if (seen.has(id)) return `$.${key}[${index}].id: duplicate id ${JSON.stringify(id)}`
    seen.add(id)
  }
  return seen
}

/** The first free `${prefix}-${n}` from `index + 1`, recorded as taken. */
function generatedId(prefix: string, index: number, taken: Set<string>): string {
  for (let n = index + 1; ; n += 1) {
    const candidate = `${prefix}-${n}`
    if (!taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }
}

function uniqueIdsProblem(key: string, ids: readonly string[]): string | null {
  const seen = new Set<string>()
  for (const [index, id] of ids.entries()) {
    if (id === '') return `$.${key}[${index}].id: expected a non-empty id`
    if (seen.has(id)) return `$.${key}[${index}].id: duplicate id ${JSON.stringify(id)}`
    seen.add(id)
  }
  return null
}
