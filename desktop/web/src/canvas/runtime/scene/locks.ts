import {
  resolveSceneObjectGroupMembers,
} from './group-members'
import {
  sceneTargetKey,
  type SceneConcreteDesignObjectTarget,
  type SceneDesignObjectTarget,
} from './design-object-targets'
import type { ScenePersistedState } from './types'

export function isSceneDesignObjectLocked(
  state: ScenePersistedState,
  target: SceneDesignObjectTarget,
): boolean {
  return isDirectSceneDesignObjectLocked(state, target)
    || (target.kind === 'group' && isSceneGroupLockedByMember(state, target.id))
}

export function isDirectSceneDesignObjectLocked(
  state: ScenePersistedState,
  target: SceneDesignObjectTarget,
): boolean {
  if (target.kind === 'plant') {
    return state.plants.some((plant) => plant.id === target.id && plant.locked)
  }
  if (target.kind === 'zone') {
    return state.zones.some((zone) => zone.name === target.id && zone.locked)
  }
  if (target.kind === 'annotation') {
    return state.annotations.some((annotation) => annotation.id === target.id && annotation.locked)
  }
  if (target.kind === 'measurement-guide') {
    return state.measurementGuides.some((guide) => guide.id === target.id && guide.locked)
  }
  return state.groups.some((group) => group.id === target.id && group.locked)
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
  return isDirectSceneDesignObjectLocked(state, target)
}

export function setSceneDesignObjectLocks(
  state: ScenePersistedState,
  targets: Iterable<SceneDesignObjectTarget>,
  locked: boolean,
): void {
  const targetKeys = new Set([...targets].map(sceneTargetKey))
  for (const plant of state.plants) {
    if (targetKeys.has(sceneTargetKey({ kind: 'plant', id: plant.id }))) plant.locked = locked
  }
  for (const zone of state.zones) {
    if (targetKeys.has(sceneTargetKey({ kind: 'zone', id: zone.name }))) zone.locked = locked
  }
  for (const annotation of state.annotations) {
    if (targetKeys.has(sceneTargetKey({ kind: 'annotation', id: annotation.id }))) annotation.locked = locked
  }
  for (const guide of state.measurementGuides) {
    if (targetKeys.has(sceneTargetKey({ kind: 'measurement-guide', id: guide.id }))) guide.locked = locked
  }
  for (const group of state.groups) {
    if (targetKeys.has(sceneTargetKey({ kind: 'group', id: group.id }))) group.locked = locked
  }
}
