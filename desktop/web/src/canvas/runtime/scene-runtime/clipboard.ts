import type {
  SceneAnnotationEntity,
  SceneMeasurementGuideEntity,
  SceneObjectGroupEntity,
  ScenePersistedState,
  ScenePlantEntity,
  SceneZoneEntity,
} from '../scene'
import type { SceneSelectionTarget } from './selection'
import type { SceneArrangementTemplate } from './arrangement-placement'
import {
  cloneSceneObjectGroupMembers,
  resolveSceneObjectGroupMembers,
} from '../scene'

export interface SceneClipboardPayload {
  plants: ScenePlantEntity[]
  zones: SceneZoneEntity[]
  annotations: SceneAnnotationEntity[]
  measurementGuides: SceneMeasurementGuideEntity[]
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
  const measurementGuideIds = new Set<string>()
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
    if (target.kind === 'measurement-guide') {
      measurementGuideIds.add(target.id)
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
    measurementGuides: (persisted.measurementGuides ?? [])
      .filter((guide) => measurementGuideIds.has(guide.id))
      .map(cloneMeasurementGuideEntity),
    groups: persisted.groups.filter((group) => groupIds.has(group.id)).map(cloneGroupEntity),
    sourceTargets: selected.map(cloneSelectionTarget),
  }
}

export function createClipboardArrangementTemplate(
  payload: SceneClipboardPayload,
  options: { preservePinnedNames?: boolean } = {},
): SceneArrangementTemplate {
  return {
    plants: payload.plants.map((plant) => ({
      sourceId: plant.id,
      entity: {
        ...clonePlantEntity(plant),
        pinnedName: options.preservePinnedNames === true ? plant.pinnedName === true : false,
      },
    })),
    zones: payload.zones.map((zone) => ({
      sourceId: zone.name,
      entity: cloneZoneEntity(zone),
    })),
    annotations: payload.annotations.map((annotation) => ({
      sourceId: annotation.id,
      entity: cloneAnnotationEntity(annotation),
    })),
    measurementGuides: payload.measurementGuides.map((guide) => ({
      sourceId: guide.id,
      entity: cloneMeasurementGuideEntity(guide),
    })),
    groups: payload.groups.map((group) => ({
      sourceId: group.id,
      entity: cloneGroupEntity(group),
    })),
  }
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

function cloneMeasurementGuideEntity(guide: SceneMeasurementGuideEntity): SceneMeasurementGuideEntity {
  return {
    ...guide,
    start: { ...guide.start },
    end: { ...guide.end },
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
