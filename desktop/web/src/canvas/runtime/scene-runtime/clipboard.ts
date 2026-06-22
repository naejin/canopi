import type {
  SceneAnnotationEntity,
  SceneObjectGroupEntity,
  SceneObjectGroupMember,
  ScenePersistedState,
  ScenePlantEntity,
  ScenePoint,
  SceneZoneEntity,
} from '../scene'
import type { SceneSelectionTarget } from './selection'
import { createUuid } from '../../../utils/ids'
import {
  cloneSceneObjectGroupMembers,
  resolveSceneObjectGroupMembers,
  sceneObjectGroupMemberKey,
} from '../scene'

export interface SceneClipboardPayload {
  plants: ScenePlantEntity[]
  zones: SceneZoneEntity[]
  annotations: SceneAnnotationEntity[]
  groups: SceneObjectGroupEntity[]
  sourceTargets: SceneSelectionTarget[]
}

export function createClipboardPayload(
  persisted: ScenePersistedState,
  selected: readonly SceneSelectionTarget[],
): SceneClipboardPayload | null {
  if (selected.length === 0) return null

  const plantIds = new Set<string>()
  const zoneIds = new Set<string>()
  const annotationIds = new Set<string>()
  const groupIds = new Set<string>()

  for (const target of selected) {
    if (target.kind === 'plant') {
      plantIds.add(target.id)
      continue
    }
    if (target.kind === 'zone') {
      zoneIds.add(target.id)
      continue
    }
    if (target.kind === 'annotation') {
      annotationIds.add(target.id)
      continue
    }
    groupIds.add(target.id)
    const group = persisted.groups.find((entry) => entry.id === target.id)
    if (!group) continue
    for (const member of resolveSceneObjectGroupMembers(persisted, group)) {
      if (member.kind === 'plant') plantIds.add(member.id)
      else if (member.kind === 'zone') zoneIds.add(member.id)
      else annotationIds.add(member.id)
    }
  }

  return {
    plants: persisted.plants.filter((plant) => plantIds.has(plant.id)).map(clonePlantEntity),
    zones: persisted.zones.filter((zone) => zoneIds.has(zone.name)).map(cloneZoneEntity),
    annotations: persisted.annotations.filter((annotation) => annotationIds.has(annotation.id)).map(cloneAnnotationEntity),
    groups: persisted.groups.filter((group) => groupIds.has(group.id)).map(cloneGroupEntity),
    sourceTargets: selected.map(cloneSelectionTarget),
  }
}

export function pasteClipboardPayload(
  payload: SceneClipboardPayload,
  draft: ScenePersistedState,
  offset: ScenePoint,
  options: { preservePinnedNames?: boolean } = {},
): Set<string> {
  const nextSelection = new Set<string>()
  const existingZoneNames = new Set(draft.zones.map((zone) => zone.name))
  const sourceToCloneId = new Map<string, string>()

  for (const plant of payload.plants) {
    const clone = clonePlantWithOffset(plant, offset, options)
    draft.plants.push(clone)
    sourceToCloneId.set(sceneObjectGroupMemberKey({ kind: 'plant', id: plant.id }), clone.id)
  }

  for (const zone of payload.zones) {
    const clone = cloneZoneWithOffset(zone, existingZoneNames, offset)
    existingZoneNames.add(clone.name)
    draft.zones.push(clone)
    sourceToCloneId.set(sceneObjectGroupMemberKey({ kind: 'zone', id: zone.name }), clone.name)
  }

  for (const annotation of payload.annotations) {
    const clone = cloneAnnotationWithOffset(annotation, offset)
    draft.annotations.push(clone)
    sourceToCloneId.set(sceneObjectGroupMemberKey({ kind: 'annotation', id: annotation.id }), clone.id)
  }

  for (const group of payload.groups) {
    const members = group.members
      .map((member): SceneObjectGroupMember | null => {
        const cloneId = sourceToCloneId.get(sceneObjectGroupMemberKey(member))
        return cloneId ? { kind: member.kind, id: cloneId } : null
      })
      .filter((member): member is SceneObjectGroupMember => member !== null)
    if (members.length < 2) continue
    const cloneGroup: SceneObjectGroupEntity = {
      ...group,
      id: createUuid(),
      members,
    }
    draft.groups.push(cloneGroup)
    nextSelection.add(cloneGroup.id)
  }

  if (nextSelection.size > 0) return nextSelection

  for (const plant of payload.plants) {
    const cloneId = sourceToCloneId.get(sceneObjectGroupMemberKey({ kind: 'plant', id: plant.id }))
    if (cloneId) nextSelection.add(cloneId)
  }
  for (const zone of payload.zones) {
    const cloneName = sourceToCloneId.get(sceneObjectGroupMemberKey({ kind: 'zone', id: zone.name }))
    if (cloneName) nextSelection.add(cloneName)
  }
  for (const annotation of payload.annotations) {
    const cloneId = sourceToCloneId.get(sceneObjectGroupMemberKey({ kind: 'annotation', id: annotation.id }))
    if (cloneId) nextSelection.add(cloneId)
  }

  return nextSelection
}

function clonePlantEntity(plant: ScenePlantEntity): ScenePlantEntity {
  return {
    ...plant,
    position: { ...plant.position },
  }
}

function cloneZoneEntity(zone: SceneZoneEntity): SceneZoneEntity {
  return {
    ...zone,
    points: zone.points.map((point) => ({ ...point })),
  }
}

function cloneAnnotationEntity(annotation: SceneAnnotationEntity): SceneAnnotationEntity {
  return {
    ...annotation,
    position: { ...annotation.position },
  }
}

function cloneGroupEntity(group: SceneObjectGroupEntity): SceneObjectGroupEntity {
  return {
    ...group,
    members: cloneSceneObjectGroupMembers(group.members),
  }
}

function cloneSelectionTarget(target: SceneSelectionTarget): SceneSelectionTarget {
  return { ...target }
}

function clonePlantWithOffset(
  plant: ScenePlantEntity,
  offset: ScenePoint,
  options: { preservePinnedNames?: boolean },
): ScenePlantEntity {
  return {
    ...clonePlantEntity(plant),
    id: createUuid(),
    pinnedName: options.preservePinnedNames === true ? plant.pinnedName === true : false,
    position: {
      x: plant.position.x + offset.x,
      y: plant.position.y + offset.y,
    },
  }
}

function cloneZoneWithOffset(
  zone: SceneZoneEntity,
  existingNames: Set<string>,
  offset: ScenePoint,
): SceneZoneEntity {
  const nextName = uniqueZoneName(zone.name, existingNames)
  return {
    ...cloneZoneEntity(zone),
    name: nextName,
    points: cloneZonePointsWithOffset(zone, offset),
  }
}

function cloneZonePointsWithOffset(zone: SceneZoneEntity, offset: ScenePoint): ScenePoint[] {
  if (zone.zoneType === 'ellipse') {
    return zone.points.map((point, index) =>
      index === 0
        ? { x: point.x + offset.x, y: point.y + offset.y }
        : { ...point },
    )
  }
  return zone.points.map((point) => ({
    x: point.x + offset.x,
    y: point.y + offset.y,
  }))
}

function cloneAnnotationWithOffset(annotation: SceneAnnotationEntity, offset: ScenePoint): SceneAnnotationEntity {
  return {
    ...cloneAnnotationEntity(annotation),
    id: createUuid(),
    position: {
      x: annotation.position.x + offset.x,
      y: annotation.position.y + offset.y,
    },
  }
}

function uniqueZoneName(baseName: string, existingNames: Set<string>): string {
  if (!existingNames.has(baseName)) return baseName
  let index = 2
  let candidate = `${baseName} copy`
  while (existingNames.has(candidate)) {
    candidate = `${baseName} copy ${index}`
    index += 1
  }
  return candidate
}
