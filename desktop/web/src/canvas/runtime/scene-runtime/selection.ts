import type { ScenePersistedState } from '../scene'

export type SceneSelectionTarget =
  | { kind: 'plant'; id: string }
  | { kind: 'zone'; id: string }
  | { kind: 'annotation'; id: string }
  | { kind: 'group'; id: string }

export function getSelectedZoneIds(
  persisted: ScenePersistedState,
  selectedIds: ReadonlySet<string>,
): Set<string> {
  const resolved = new Set<string>()
  for (const zone of persisted.zones) {
    if (selectedIds.has(zone.name)) resolved.add(zone.name)
  }
  for (const group of persisted.groups) {
    if (!selectedIds.has(group.id)) continue
    for (const memberId of group.memberIds) {
      if (persisted.zones.some((zone) => zone.name === memberId)) resolved.add(memberId)
    }
  }
  return resolved
}

export function getSelectedAnnotationIds(
  persisted: ScenePersistedState,
  selectedIds: ReadonlySet<string>,
): Set<string> {
  const resolved = new Set<string>()
  for (const annotation of persisted.annotations) {
    if (selectedIds.has(annotation.id)) resolved.add(annotation.id)
  }
  for (const group of persisted.groups) {
    if (!selectedIds.has(group.id)) continue
    for (const memberId of group.memberIds) {
      if (persisted.annotations.some((annotation) => annotation.id === memberId)) resolved.add(memberId)
    }
  }
  return resolved
}

export function getSelectedPlantIds(
  persisted: ScenePersistedState,
  selectedIds: ReadonlySet<string>,
): Set<string> {
  const resolved = new Set<string>()
  for (const plant of persisted.plants) {
    if (selectedIds.has(plant.id)) resolved.add(plant.id)
  }
  for (const group of persisted.groups) {
    if (!selectedIds.has(group.id)) continue
    for (const memberId of group.memberIds) {
      if (persisted.plants.some((plant) => plant.id === memberId)) resolved.add(memberId)
    }
  }
  return resolved
}

export function getSelectedTopLevelTargets(
  persisted: ScenePersistedState,
  selectedIds: ReadonlySet<string>,
): SceneSelectionTarget[] {
  const groupedMemberIds = new Set(persisted.groups.flatMap((group) => group.memberIds))
  const seen = new Set<string>()
  const targets: SceneSelectionTarget[] = []

  for (const group of persisted.groups) {
    if (!selectedIds.has(group.id)) continue
    const key = `group:${group.id}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: 'group', id: group.id })
  }

  for (const plant of persisted.plants) {
    if (!selectedIds.has(plant.id) || groupedMemberIds.has(plant.id)) continue
    const key = `plant:${plant.id}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: 'plant', id: plant.id })
  }

  for (const zone of persisted.zones) {
    if (!selectedIds.has(zone.name) || groupedMemberIds.has(zone.name)) continue
    const key = `zone:${zone.name}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: 'zone', id: zone.name })
  }

  for (const annotation of persisted.annotations) {
    if (!selectedIds.has(annotation.id) || groupedMemberIds.has(annotation.id)) continue
    const key = `annotation:${annotation.id}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: 'annotation', id: annotation.id })
  }

  return targets
}

export function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

export function getSelectionLayer(target: SceneSelectionTarget): string {
  if (target.kind === 'zone') return 'zones'
  if (target.kind === 'annotation') return 'annotations'
  return 'plants'
}
