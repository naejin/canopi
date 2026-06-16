import type {
  SceneObjectGroupEntity,
  SceneObjectGroupMember,
  ScenePersistedState,
} from './types'

export type SceneConcreteDesignObjectTarget =
  | { kind: 'plant'; id: string }
  | { kind: 'zone'; id: string }
  | { kind: 'annotation'; id: string }

export type SceneDesignObjectTarget =
  | SceneConcreteDesignObjectTarget
  | { kind: 'group'; id: string }

export function cloneSceneObjectGroupMember(
  member: SceneObjectGroupMember,
): SceneObjectGroupMember {
  return { ...member }
}

export function cloneSceneObjectGroupMembers(
  members: readonly SceneObjectGroupMember[],
): SceneObjectGroupMember[] {
  return members.map(cloneSceneObjectGroupMember)
}

export function sceneObjectGroupMemberKey(member: SceneObjectGroupMember): string {
  return `${member.kind}:${member.id}`
}

export function sceneTargetKey(target: SceneDesignObjectTarget): string {
  return `${target.kind}:${target.id}`
}

export function sceneObjectGroupMemberFromTarget(
  target: SceneDesignObjectTarget,
): SceneObjectGroupMember | null {
  if (target.kind === 'group') return null
  return { kind: target.kind, id: target.id }
}

export function sceneObjectGroupMemberToTarget(
  member: SceneObjectGroupMember,
): SceneConcreteDesignObjectTarget {
  return { kind: member.kind, id: member.id }
}

export function sceneObjectGroupMemberLayerName(member: SceneObjectGroupMember): string {
  if (member.kind === 'zone') return 'zones'
  if (member.kind === 'annotation') return 'annotations'
  return 'plants'
}

export function dedupeSceneObjectGroupMembers(
  members: readonly SceneObjectGroupMember[],
): SceneObjectGroupMember[] {
  const seen = new Set<string>()
  const deduped: SceneObjectGroupMember[] = []
  for (const member of members) {
    const key = sceneObjectGroupMemberKey(member)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(cloneSceneObjectGroupMember(member))
  }
  return deduped
}

export function resolveSceneObjectGroupMember(
  scene: ScenePersistedState,
  member: SceneObjectGroupMember,
): SceneConcreteDesignObjectTarget | null {
  if (member.kind === 'plant') {
    return scene.plants.some((plant) => plant.id === member.id) ? { kind: 'plant', id: member.id } : null
  }
  if (member.kind === 'zone') {
    return scene.zones.some((zone) => zone.name === member.id) ? { kind: 'zone', id: member.id } : null
  }
  return scene.annotations.some((annotation) => annotation.id === member.id)
    ? { kind: 'annotation', id: member.id }
    : null
}

export function resolveSceneObjectGroupMembers(
  scene: ScenePersistedState,
  group: SceneObjectGroupEntity,
): SceneConcreteDesignObjectTarget[] {
  return group.members
    .map((member) => resolveSceneObjectGroupMember(scene, member))
    .filter((target): target is SceneConcreteDesignObjectTarget => target !== null)
}

export function getSceneGroupedMemberKeys(scene: ScenePersistedState): Map<string, string> {
  const grouped = new Map<string, string>()
  for (const group of scene.groups) {
    for (const member of group.members) {
      grouped.set(sceneObjectGroupMemberKey(member), group.id)
    }
  }
  return grouped
}

export function isSceneObjectGroupMemberTarget(
  member: SceneObjectGroupMember,
  target: SceneConcreteDesignObjectTarget,
): boolean {
  return member.kind === target.kind && member.id === target.id
}
