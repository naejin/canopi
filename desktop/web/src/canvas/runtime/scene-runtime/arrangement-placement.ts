import { createUuid } from '../../../utils/ids'
import type {
  SceneAnnotationEntity,
  SceneMeasurementGuideEntity,
  SceneObjectGroupEntity,
  SceneObjectGroupMember,
  ScenePersistedState,
  ScenePlantEntity,
  ScenePoint,
  SceneZoneEntity,
} from '../scene'
import {
  dedupeSceneObjectGroupMembers,
  sceneObjectGroupMemberKey,
} from '../scene'
import type { SceneEditCoordinator } from './transactions'

export interface SceneArrangementPrototype<T> {
  readonly sourceId: string
  readonly entity: T
}

export interface SceneArrangementTemplate {
  readonly plants: readonly SceneArrangementPrototype<ScenePlantEntity>[]
  readonly zones: readonly SceneArrangementPrototype<SceneZoneEntity>[]
  readonly annotations: readonly SceneArrangementPrototype<SceneAnnotationEntity>[]
  readonly measurementGuides: readonly SceneArrangementPrototype<SceneMeasurementGuideEntity>[]
  readonly groups: readonly SceneArrangementPrototype<SceneObjectGroupEntity>[]
}

export interface SceneArrangementPlacementInput {
  readonly template: SceneArrangementTemplate
  readonly translateBy: ScenePoint
  readonly historyType: string
  readonly onCommitted?: () => void
}

export interface SceneArrangementPlacementReceipt {
  readonly committed: boolean
  readonly createdCount: number
  readonly selectedTopLevelIds: ReadonlySet<string>
}

export interface SceneArrangementPlacement {
  place(input: SceneArrangementPlacementInput): SceneArrangementPlacementReceipt
}

export interface SceneArrangementPlacementDeps {
  readonly sceneEdits: SceneEditCoordinator
  readonly createId?: () => string
}

export function createSceneArrangementPlacement({
  sceneEdits,
  createId = createUuid,
}: SceneArrangementPlacementDeps): SceneArrangementPlacement {
  return {
    place({ template, translateBy, historyType, onCommitted }): SceneArrangementPlacementReceipt {
      let createdCount = 0
      let selectedTopLevelIds = new Set<string>()
      const committed = sceneEdits.run(historyType, (tx) => {
        tx.mutate((draft) => {
          const placement = materializeSceneArrangement(draft, template, translateBy, createId)
          appendPlacement(draft, placement)
          createdCount = placement.createdCount
          selectedTopLevelIds = placement.selectedTopLevelIds
        })
        if (selectedTopLevelIds.size > 0) tx.setSelection(selectedTopLevelIds)
      }, { onCommitted })

      return { committed, createdCount, selectedTopLevelIds }
    },
  }
}

interface MaterializedSceneArrangement {
  readonly plants: ScenePlantEntity[]
  readonly zones: SceneZoneEntity[]
  readonly annotations: SceneAnnotationEntity[]
  readonly measurementGuides: SceneMeasurementGuideEntity[]
  readonly groups: SceneObjectGroupEntity[]
  readonly selectedTopLevelIds: Set<string>
  readonly createdCount: number
}

function materializeSceneArrangement(
  draft: ScenePersistedState,
  template: SceneArrangementTemplate,
  translateBy: ScenePoint,
  createId: () => string,
): MaterializedSceneArrangement {
  const reservedIds = existingSceneIds(draft)
  const sourceToCloneId = new Map<string, string>()

  const plants = template.plants.map(({ sourceId, entity }): ScenePlantEntity => {
    const id = allocateUniqueId(reservedIds, createId)
    sourceToCloneId.set(sceneObjectGroupMemberKey({ kind: 'plant', id: sourceId }), id)
    return {
      ...entity,
      id,
      locked: false,
      position: translatePoint(entity.position, translateBy),
    }
  })

  const zones = template.zones.map(({ sourceId, entity }): SceneZoneEntity => {
    const name = uniqueZoneName(entity.name, reservedIds)
    reservedIds.add(name)
    sourceToCloneId.set(sceneObjectGroupMemberKey({ kind: 'zone', id: sourceId }), name)
    return {
      ...entity,
      name,
      locked: false,
      points: translateZonePoints(entity, translateBy),
    }
  })

  const annotations = template.annotations.map(({ sourceId, entity }): SceneAnnotationEntity => {
    const id = allocateUniqueId(reservedIds, createId)
    sourceToCloneId.set(sceneObjectGroupMemberKey({ kind: 'annotation', id: sourceId }), id)
    return {
      ...entity,
      id,
      locked: false,
      position: translatePoint(entity.position, translateBy),
    }
  })

  const measurementGuides = template.measurementGuides.map(({ entity }): SceneMeasurementGuideEntity => ({
    ...entity,
    id: allocateUniqueId(reservedIds, () => `measurement-guide-${createId()}`),
    locked: false,
    start: translatePoint(entity.start, translateBy),
    end: translatePoint(entity.end, translateBy),
  }))

  const groupedMemberKeys = new Set<string>()
  const groups = template.groups
    .map(({ entity }): SceneObjectGroupEntity | null => {
      const members = dedupeSceneObjectGroupMembers(
        entity.members
          .map((member): SceneObjectGroupMember | null => {
            const cloneId = sourceToCloneId.get(sceneObjectGroupMemberKey(member))
            return cloneId ? { kind: member.kind, id: cloneId } : null
          })
          .filter((member): member is SceneObjectGroupMember => member !== null),
      )
      if (members.length < 2) return null
      for (const member of members) groupedMemberKeys.add(sceneObjectGroupMemberKey(member))
      return {
        ...entity,
        id: allocateUniqueId(reservedIds, createId),
        locked: false,
        members,
      }
    })
    .filter((group): group is SceneObjectGroupEntity => group !== null)

  const selectedTopLevelIds = new Set(groups.map((group) => group.id))
  addUngroupedSelection(selectedTopLevelIds, groupedMemberKeys, plants, zones, annotations)
  for (const guide of measurementGuides) selectedTopLevelIds.add(guide.id)

  return {
    plants,
    zones,
    annotations,
    measurementGuides,
    groups,
    selectedTopLevelIds,
    createdCount: plants.length + zones.length + annotations.length + measurementGuides.length + groups.length,
  }
}

function appendPlacement(draft: ScenePersistedState, placement: MaterializedSceneArrangement): void {
  draft.plants = [...draft.plants, ...placement.plants]
  draft.zones = [...draft.zones, ...placement.zones]
  draft.annotations = [...draft.annotations, ...placement.annotations]
  draft.measurementGuides = [...draft.measurementGuides, ...placement.measurementGuides]
  draft.groups = [...draft.groups, ...placement.groups]
}

function addUngroupedSelection(
  selection: Set<string>,
  groupedMemberKeys: ReadonlySet<string>,
  plants: readonly ScenePlantEntity[],
  zones: readonly SceneZoneEntity[],
  annotations: readonly SceneAnnotationEntity[],
): void {
  for (const plant of plants) {
    if (!groupedMemberKeys.has(sceneObjectGroupMemberKey({ kind: 'plant', id: plant.id }))) {
      selection.add(plant.id)
    }
  }
  for (const zone of zones) {
    if (!groupedMemberKeys.has(sceneObjectGroupMemberKey({ kind: 'zone', id: zone.name }))) {
      selection.add(zone.name)
    }
  }
  for (const annotation of annotations) {
    if (!groupedMemberKeys.has(sceneObjectGroupMemberKey({ kind: 'annotation', id: annotation.id }))) {
      selection.add(annotation.id)
    }
  }
}

function existingSceneIds(scene: ScenePersistedState): Set<string> {
  return new Set([
    ...scene.plants.map((plant) => plant.id),
    ...scene.zones.map((zone) => zone.name),
    ...scene.annotations.map((annotation) => annotation.id),
    ...scene.measurementGuides.map((guide) => guide.id),
    ...scene.groups.map((group) => group.id),
  ])
}

function allocateUniqueId(reservedIds: Set<string>, createId: () => string): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = createId()
    if (reservedIds.has(id)) continue
    reservedIds.add(id)
    return id
  }
  throw new Error('Unable to allocate a unique Scene arrangement identity')
}

function translatePoint(point: ScenePoint, delta: ScenePoint): ScenePoint {
  return { x: point.x + delta.x, y: point.y + delta.y }
}

function translateZonePoints(zone: SceneZoneEntity, delta: ScenePoint): ScenePoint[] {
  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    return zone.points.map((point, index) => index === 0 ? translatePoint(point, delta) : { ...point })
  }
  return zone.points.map((point) => translatePoint(point, delta))
}

function uniqueZoneName(baseName: string, existingNames: ReadonlySet<string>): string {
  if (!existingNames.has(baseName)) return baseName
  let index = 2
  let candidate = `${baseName} copy`
  while (existingNames.has(candidate)) {
    candidate = `${baseName} copy ${index}`
    index += 1
  }
  return candidate
}
