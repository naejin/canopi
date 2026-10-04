import type {
  SceneAnnotationEntity,
  SceneMeasurementGuideEntity,
  SceneObjectGroupEntity,
  ScenePersistedState,
  ScenePlantEntity,
  ScenePoint,
  SceneZoneEntity,
} from '../scene'
import type { SessionPlane } from '../../session-plane'
import type { SceneSelectionTarget } from './selection'
import type { SceneArrangementTemplate } from './arrangement-placement'
import {
  cloneSceneObjectGroupMembers,
  resolveSceneObjectGroupMembers,
} from '../scene'

export interface SceneClipboardPayload {
  /** The session plane the metre positions below are expressed in. */
  plane: SessionPlane
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
  plane: SessionPlane,
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
    plane,
    plants: persisted.plants.filter((plant) => plantIds.has(plant.id)).map(clonePlantEntity),
    zones: persisted.zones.filter((zone) => zoneIds.has(zone.id)).map(cloneZoneEntity),
    annotations: persisted.annotations.filter((annotation) => annotationIds.has(annotation.id)).map(cloneAnnotationEntity),
    measurementGuides: persisted.measurementGuides
      .filter((guide) => measurementGuideIds.has(guide.id))
      .map(cloneMeasurementGuideEntity),
    groups: persisted.groups.filter((group) => groupIds.has(group.id)).map(cloneGroupEntity),
    sourceTargets: selected.map(cloneSelectionTarget),
  }
}

/**
 * Copied objects keep their geographic position: a paste after a re-origin or
 * in another Design first moves the payload into the current plane through
 * lon/lat. Copies are new objects, so the geo ledger is not involved.
 */
export function reprojectClipboardPayload(
  payload: SceneClipboardPayload,
  plane: SessionPlane,
): SceneClipboardPayload {
  if (payload.plane === plane) return payload
  const point = (p: ScenePoint): ScenePoint => plane.toPlane(payload.plane.toGeo(p))
  const ellipse = (center: ScenePoint, radii: ScenePoint): [ScenePoint, ScenePoint] => {
    const min = point({ x: center.x - radii.x, y: center.y - radii.y })
    const max = point({ x: center.x + radii.x, y: center.y + radii.y })
    return [
      { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 },
      { x: (max.x - min.x) / 2, y: (max.y - min.y) / 2 },
    ]
  }
  return {
    ...payload,
    plane,
    plants: payload.plants.map((plant) => ({ ...plant, position: point(plant.position) })),
    zones: payload.zones.map((zone) => {
      if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
        const [center, radii] = ellipse(zone.points[0]!, zone.points[1]!)
        return { ...zone, points: [center, radii, ...zone.points.slice(2).map(point)] }
      }
      return { ...zone, points: zone.points.map(point) }
    }),
    annotations: payload.annotations.map((annotation) => ({ ...annotation, position: point(annotation.position) })),
    measurementGuides: payload.measurementGuides.map((guide) => ({
      ...guide,
      start: point(guide.start),
      end: point(guide.end),
    })),
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
      sourceId: zone.id,
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
