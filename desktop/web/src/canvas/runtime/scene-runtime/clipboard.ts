import type {
  SceneAnnotationEntity,
  SceneObjectGroupEntity,
  ScenePersistedState,
  ScenePlantEntity,
  SceneZoneEntity,
} from '../scene'
import type { SceneSelectionTarget } from './selection'

const CLIPBOARD_OFFSET = 20

export interface SceneClipboardPayload {
  plants: ScenePlantEntity[]
  zones: SceneZoneEntity[]
  annotations: SceneAnnotationEntity[]
  groups: SceneObjectGroupEntity[]
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
    for (const memberId of group.memberIds) {
      if (persisted.plants.some((plant) => plant.id === memberId)) plantIds.add(memberId)
      else if (persisted.zones.some((zone) => zone.name === memberId)) zoneIds.add(memberId)
      else if (persisted.annotations.some((annotation) => annotation.id === memberId)) annotationIds.add(memberId)
    }
  }

  return {
    plants: persisted.plants.filter((plant) => plantIds.has(plant.id)).map(clonePlantEntity),
    zones: persisted.zones.filter((zone) => zoneIds.has(zone.name)).map(cloneZoneEntity),
    annotations: persisted.annotations.filter((annotation) => annotationIds.has(annotation.id)).map(cloneAnnotationEntity),
    groups: persisted.groups.filter((group) => groupIds.has(group.id)).map(cloneGroupEntity),
  }
}

export function pasteClipboardPayload(
  payload: SceneClipboardPayload,
  draft: ScenePersistedState,
): Set<string> {
  const nextSelection = new Set<string>()
  const existingZoneNames = new Set(draft.zones.map((zone) => zone.name))
  const sourceToCloneId = new Map<string, string>()

  for (const plant of payload.plants) {
    const clone = clonePlantWithOffset(plant)
    draft.plants.push(clone)
    sourceToCloneId.set(plant.id, clone.id)
  }

  for (const zone of payload.zones) {
    const clone = cloneZoneWithOffset(zone, existingZoneNames)
    existingZoneNames.add(clone.name)
    draft.zones.push(clone)
    sourceToCloneId.set(zone.name, clone.name)
  }

  for (const annotation of payload.annotations) {
    const clone = cloneAnnotationWithOffset(annotation)
    draft.annotations.push(clone)
    sourceToCloneId.set(annotation.id, clone.id)
  }

  for (const group of payload.groups) {
    const memberIds = group.memberIds
      .map((memberId) => sourceToCloneId.get(memberId) ?? null)
      .filter((memberId): memberId is string => memberId !== null)
    if (memberIds.length === 0) continue
    const cloneGroup: SceneObjectGroupEntity = {
      ...group,
      id: crypto.randomUUID(),
      position: {
        x: group.position.x + CLIPBOARD_OFFSET,
        y: group.position.y + CLIPBOARD_OFFSET,
      },
      memberIds,
    }
    draft.groups.push(cloneGroup)
    nextSelection.add(cloneGroup.id)
  }

  if (nextSelection.size > 0) return nextSelection

  for (const plant of payload.plants) {
    const cloneId = sourceToCloneId.get(plant.id)
    if (cloneId) nextSelection.add(cloneId)
  }
  for (const zone of payload.zones) {
    const cloneName = sourceToCloneId.get(zone.name)
    if (cloneName) nextSelection.add(cloneName)
  }
  for (const annotation of payload.annotations) {
    const cloneId = sourceToCloneId.get(annotation.id)
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
    position: { ...group.position },
    memberIds: [...group.memberIds],
  }
}

function clonePlantWithOffset(plant: ScenePlantEntity): ScenePlantEntity {
  return {
    ...clonePlantEntity(plant),
    id: crypto.randomUUID(),
    position: {
      x: plant.position.x + CLIPBOARD_OFFSET,
      y: plant.position.y + CLIPBOARD_OFFSET,
    },
  }
}

function cloneZoneWithOffset(zone: SceneZoneEntity, existingNames: Set<string>): SceneZoneEntity {
  const nextName = uniqueZoneName(zone.name, existingNames)
  return {
    ...cloneZoneEntity(zone),
    name: nextName,
    points: zone.points.map((point) => ({
      x: point.x + CLIPBOARD_OFFSET,
      y: point.y + CLIPBOARD_OFFSET,
    })),
  }
}

function cloneAnnotationWithOffset(annotation: SceneAnnotationEntity): SceneAnnotationEntity {
  return {
    ...cloneAnnotationEntity(annotation),
    id: crypto.randomUUID(),
    position: {
      x: annotation.position.x + CLIPBOARD_OFFSET,
      y: annotation.position.y + CLIPBOARD_OFFSET,
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
