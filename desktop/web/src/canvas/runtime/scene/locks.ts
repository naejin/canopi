import { resolveSceneObjectGroupMembers, type SceneConcreteDesignObjectTarget } from './group-members'
import type { ScenePersistedState } from './types'

export function isSceneDesignObjectLocked(state: ScenePersistedState, id: string): boolean {
  return isDirectSceneDesignObjectLocked(state, id)
    || isSceneGroupLockedByMember(state, id)
}

export function isDirectSceneDesignObjectLocked(state: ScenePersistedState, id: string): boolean {
  return state.plants.some((plant) => plant.id === id && plant.locked)
    || state.zones.some((zone) => zone.name === id && zone.locked)
    || state.annotations.some((annotation) => annotation.id === id && annotation.locked)
    || state.groups.some((group) => group.id === id && group.locked)
}

function isSceneGroupLockedByMember(state: ScenePersistedState, id: string): boolean {
  const group = state.groups.find((entry) => entry.id === id)
  if (!group) return false
  return resolveSceneObjectGroupMembers(state, group)
    .some((member) => isDirectSceneDesignObjectTargetLocked(state, member))
}

function isDirectSceneDesignObjectTargetLocked(
  state: ScenePersistedState,
  target: SceneConcreteDesignObjectTarget,
): boolean {
  if (target.kind === 'plant') return state.plants.some((plant) => plant.id === target.id && plant.locked)
  if (target.kind === 'zone') return state.zones.some((zone) => zone.name === target.id && zone.locked)
  return state.annotations.some((annotation) => annotation.id === target.id && annotation.locked)
}

export function getLockedSceneDesignObjectIds(state: ScenePersistedState): Set<string> {
  const ids = new Set<string>()
  for (const plant of state.plants) {
    if (plant.locked) ids.add(plant.id)
  }
  for (const zone of state.zones) {
    if (zone.locked) ids.add(zone.name)
  }
  for (const annotation of state.annotations) {
    if (annotation.locked) ids.add(annotation.id)
  }
  for (const group of state.groups) {
    if (group.locked) ids.add(group.id)
  }
  return ids
}

export function setSceneDesignObjectLocks(
  state: ScenePersistedState,
  ids: Iterable<string>,
  locked: boolean,
): void {
  const idSet = new Set(ids)
  for (const plant of state.plants) {
    if (idSet.has(plant.id)) plant.locked = locked
  }
  for (const zone of state.zones) {
    if (idSet.has(zone.name)) zone.locked = locked
  }
  for (const annotation of state.annotations) {
    if (idSet.has(annotation.id)) annotation.locked = locked
  }
  for (const group of state.groups) {
    if (idSet.has(group.id)) group.locked = locked
  }
}

export function clearSceneDesignObjectLocks(state: ScenePersistedState): void {
  for (const plant of state.plants) plant.locked = false
  for (const zone of state.zones) zone.locked = false
  for (const annotation of state.annotations) annotation.locked = false
  for (const group of state.groups) group.locked = false
}
