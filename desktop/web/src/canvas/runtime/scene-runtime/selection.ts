import { getAnnotationWorldBounds } from '../annotation-layout'
import type { SceneBounds } from '../camera'
import {
  getPlantWorldBounds,
  type PlantPresentationContext,
} from '../plant-presentation'
import type {
  CanvasDesignObjectSelectionBlockedTarget,
  CanvasDesignObjectSelectionModel,
  CanvasDesignObjectSelectionTarget,
} from '../runtime'
import type { SceneLayerEntity, ScenePersistedState } from '../scene'
import { isDirectSceneDesignObjectLocked, isSceneDesignObjectLocked } from '../scene'
import {
  getSceneGroupedMemberKeys,
  resolveSceneObjectGroupMembers,
  sceneObjectGroupMemberFromTarget,
  sceneObjectGroupMemberLayerName,
  sceneObjectGroupMemberKey,
  sceneTargetKey,
  type SceneDesignObjectSelection,
} from '../scene'
import { getZoneWorldBounds } from '../zone-geometry'
import { getSameSpeciesReferenceCanonicalName } from './species-selection'

export type SceneSelectionTarget = CanvasDesignObjectSelectionTarget

export interface SceneSelectionReadModelOptions {
  readonly annotationViewportScale: number
  readonly plantContext: PlantPresentationContext
}

export interface SceneSelectionEntityIds {
  readonly selectedPlantIds: Set<string>
  readonly selectedZoneIds: Set<string>
  readonly selectedAnnotationIds: Set<string>
  readonly selectedMeasurementGuideIds: Set<string>
}

export function projectSceneSelectionEntityIds(
  persisted: ScenePersistedState,
  selectedTargets: SceneDesignObjectSelection,
): SceneSelectionEntityIds {
  const selectedKeys = new Set(selectedTargets.map(sceneTargetKey))
  const selectedGroupMemberKeys = new Set<string>()

  for (const group of persisted.groups) {
    if (!selectedKeys.has(sceneTargetKey({ kind: 'group', id: group.id }))) continue
    for (const member of group.members) {
      selectedGroupMemberKeys.add(sceneObjectGroupMemberKey(member))
    }
  }

  const isSelected = (target: SceneSelectionTarget): boolean => {
    const key = sceneTargetKey(target)
    return selectedKeys.has(key) || selectedGroupMemberKeys.has(key)
  }
  const selectedPlantIds = new Set<string>()
  const selectedZoneIds = new Set<string>()
  const selectedAnnotationIds = new Set<string>()
  const selectedMeasurementGuideIds = new Set<string>()

  for (const plant of persisted.plants) {
    if (isSelected({ kind: 'plant', id: plant.id })) selectedPlantIds.add(plant.id)
  }
  for (const zone of persisted.zones) {
    if (isSelected({ kind: 'zone', id: zone.name })) selectedZoneIds.add(zone.name)
  }
  for (const annotation of persisted.annotations) {
    if (isSelected({ kind: 'annotation', id: annotation.id })) {
      selectedAnnotationIds.add(annotation.id)
    }
  }
  for (const guide of persisted.measurementGuides) {
    if (selectedKeys.has(sceneTargetKey({ kind: 'measurement-guide', id: guide.id }))) {
      selectedMeasurementGuideIds.add(guide.id)
    }
  }

  return {
    selectedPlantIds,
    selectedZoneIds,
    selectedAnnotationIds,
    selectedMeasurementGuideIds,
  }
}

export function getSelectedTopLevelTargets(
  persisted: ScenePersistedState,
  selectedTargets: SceneDesignObjectSelection,
): SceneSelectionTarget[] {
  const groupedMemberKeys = getSceneGroupedMemberKeys(persisted)
  const selectedKeys = new Set(selectedTargets.map(sceneTargetKey))
  const seen = new Set<string>()
  const targets: SceneSelectionTarget[] = []

  for (const group of persisted.groups) {
    if (!selectedKeys.has(sceneTargetKey({ kind: 'group', id: group.id }))) continue
    const key = `group:${group.id}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: 'group', id: group.id })
  }

  for (const plant of persisted.plants) {
    if (
      !selectedKeys.has(sceneTargetKey({ kind: 'plant', id: plant.id }))
      || groupedMemberKeys.has(sceneTargetKey({ kind: 'plant', id: plant.id }))
    ) continue
    const key = `plant:${plant.id}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: 'plant', id: plant.id })
  }

  for (const zone of persisted.zones) {
    if (
      !selectedKeys.has(sceneTargetKey({ kind: 'zone', id: zone.name }))
      || groupedMemberKeys.has(sceneTargetKey({ kind: 'zone', id: zone.name }))
    ) continue
    const key = `zone:${zone.name}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: 'zone', id: zone.name })
  }

  for (const annotation of persisted.annotations) {
    if (
      !selectedKeys.has(sceneTargetKey({ kind: 'annotation', id: annotation.id }))
      || groupedMemberKeys.has(sceneTargetKey({ kind: 'annotation', id: annotation.id }))
    ) continue
    const key = `annotation:${annotation.id}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: 'annotation', id: annotation.id })
  }

  for (const guide of persisted.measurementGuides) {
    if (!selectedKeys.has(sceneTargetKey({ kind: 'measurement-guide', id: guide.id }))) continue
    const key = `measurement-guide:${guide.id}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: 'measurement-guide', id: guide.id })
  }

  return targets
}

export function getDesignObjectSelectionModel(
  persisted: ScenePersistedState,
  selectedTargets: SceneDesignObjectSelection,
  options: SceneSelectionReadModelOptions,
): CanvasDesignObjectSelectionModel {
  const topLevelTargets = getSelectedTopLevelTargets(persisted, selectedTargets)
  const blockedTargets = getBlockedSelectionTargets(persisted, selectedTargets)
  const blockedKeys = new Set(blockedTargets.map((blocked) => sceneTargetKey(blocked.target)))
  const lockedTargets = blockedTargets
    .filter((blocked): blocked is CanvasDesignObjectSelectionBlockedTarget & {
      target: CanvasDesignObjectSelectionTarget
    } =>
      blocked.reason === 'locked-design-object'
      && isDirectSceneDesignObjectLocked(persisted, blocked.target),
    )
    .map((blocked) => blocked.target)
  const editableTargets = topLevelTargets.filter(
    (target) => !blockedKeys.has(sceneTargetKey(target)),
  )
  const plantNamePinning = getPlantNamePinning(persisted, editableTargets)
  return {
    editableTargets,
    lockedTargets,
    blockedTargets,
    bounds: getCombinedTargetBounds(persisted, [...editableTargets, ...lockedTargets], options),
    sameSpeciesReferenceCanonicalName: getSameSpeciesReferenceCanonicalName(persisted, editableTargets),
    plantNamePinning,
  }
}

function getPlantNamePinning(
  persisted: ScenePersistedState,
  editableTargets: readonly SceneSelectionTarget[],
): CanvasDesignObjectSelectionModel['plantNamePinning'] {
  const plantIds = editableTargets
    .filter((target): target is Extract<SceneSelectionTarget, { kind: 'plant' }> => target.kind === 'plant')
    .map((target) => target.id)
  if (plantIds.length === 0) {
    return {
      plantIds: [],
      allPinned: false,
    }
  }
  const pinnedById = new Map(persisted.plants.map((plant) => [plant.id, plant.pinnedName]))
  return {
    plantIds,
    allPinned: plantIds.every((id) => pinnedById.get(id) === true),
  }
}

export function getSelectionLayer(target: SceneSelectionTarget): string {
  if (target.kind === 'zone') return 'zones'
  if (target.kind === 'annotation') return 'annotations'
  if (target.kind === 'measurement-guide') return 'measurement-guides'
  return 'plants'
}

export function getCombinedTargetBounds(
  persisted: ScenePersistedState,
  targets: readonly SceneSelectionTarget[],
  options: SceneSelectionReadModelOptions,
): SceneBounds | null {
  let combined: SceneBounds | null = null
  for (const target of targets) {
    const bounds = getTargetBounds(persisted, target, options)
    if (!bounds) continue
    combined = combined
      ? {
          minX: Math.min(combined.minX, bounds.minX),
          minY: Math.min(combined.minY, bounds.minY),
          maxX: Math.max(combined.maxX, bounds.maxX),
          maxY: Math.max(combined.maxY, bounds.maxY),
        }
      : bounds
  }
  return combined
}

export function getTargetBounds(
  persisted: ScenePersistedState,
  target: SceneSelectionTarget,
  options: SceneSelectionReadModelOptions,
): SceneBounds | null {
  if (target.kind === 'group') {
    const group = persisted.groups.find((entry) => entry.id === target.id)
    if (!group) return null
    return getCombinedTargetBounds(
      persisted,
      resolveSceneObjectGroupMembers(persisted, group),
      options,
    )
  }

  const plant = target.kind === 'plant'
    ? persisted.plants.find((entry) => entry.id === target.id)
    : null
  if (plant) {
    const bounds = getPlantWorldBounds(plant, options.plantContext)
    return {
      minX: bounds.x,
      minY: bounds.y,
      maxX: bounds.x + bounds.width,
      maxY: bounds.y + bounds.height,
    }
  }

  const zone = target.kind === 'zone'
    ? persisted.zones.find((entry) => entry.name === target.id)
    : null
  if (zone && zone.points.length > 0) {
    const bounds = getZoneWorldBounds(zone)
    if (!bounds) return null
    return {
      minX: bounds.x,
      minY: bounds.y,
      maxX: bounds.x + bounds.width,
      maxY: bounds.y + bounds.height,
    }
  }

  const annotation = target.kind === 'annotation'
    ? persisted.annotations.find((entry) => entry.id === target.id)
    : null
  if (annotation) {
    const bounds = getAnnotationWorldBounds(annotation, options.annotationViewportScale)
    return {
      minX: bounds.x,
      minY: bounds.y,
      maxX: bounds.x + bounds.width,
      maxY: bounds.y + bounds.height,
    }
  }

  const guide = target.kind === 'measurement-guide'
    ? persisted.measurementGuides.find((entry) => entry.id === target.id)
    : null
  if (!guide) return null
  return {
    minX: Math.min(guide.start.x, guide.end.x),
    minY: Math.min(guide.start.y, guide.end.y),
    maxX: Math.max(guide.start.x, guide.end.x),
    maxY: Math.max(guide.start.y, guide.end.y),
  }
}

function getBlockedSelectionTargets(
  persisted: ScenePersistedState,
  selectedTargets: SceneDesignObjectSelection,
): CanvasDesignObjectSelectionBlockedTarget[] {
  const blockedTargets: CanvasDesignObjectSelectionBlockedTarget[] = []
  const seen = new Set<string>()
  const groupedMemberKeys = getSceneGroupedMemberKeys(persisted)

  for (const target of selectedTargets) {
    if (!sceneContainsTarget(persisted, target)) {
      pushBlocked(blockedTargets, seen, {
        target,
        reason: 'missing-design-object',
        layerName: null,
      })
      continue
    }

    const member = sceneObjectGroupMemberFromTarget(target)
    const groupId = member ? groupedMemberKeys.get(sceneObjectGroupMemberKey(member)) : null
    if (groupId) {
      pushBlocked(blockedTargets, seen, {
        target,
        reason: 'grouped-member',
        layerName: getSelectionLayer(target),
        groupId,
      })
      continue
    }

    const layerBlock = getTargetLayerBlock(persisted, target)
    if (layerBlock?.reason === 'hidden-layer') {
      pushBlocked(blockedTargets, seen, {
        target,
        reason: 'hidden-layer',
        layerName: layerBlock.layerName,
      })
      continue
    }
    if (layerBlock?.reason === 'locked-layer') {
      pushBlocked(blockedTargets, seen, {
        target,
        reason: 'locked-layer',
        layerName: layerBlock.layerName,
      })
      continue
    }
    if (isSceneDesignObjectLocked(persisted, target)) {
      pushBlocked(blockedTargets, seen, {
        target,
        reason: 'locked-design-object',
        layerName: getTargetPrimaryLayerName(persisted, target),
      })
    }
  }

  return blockedTargets
}

function pushBlocked(
  blockedTargets: CanvasDesignObjectSelectionBlockedTarget[],
  seen: Set<string>,
  blocked: CanvasDesignObjectSelectionBlockedTarget,
): void {
  const key = sceneTargetKey(blocked.target)
  if (seen.has(key)) return
  seen.add(key)
  blockedTargets.push(blocked)
}

function sceneContainsTarget(
  persisted: ScenePersistedState,
  target: SceneSelectionTarget,
): boolean {
  if (target.kind === 'group') return persisted.groups.some((group) => group.id === target.id)
  if (target.kind === 'plant') return persisted.plants.some((plant) => plant.id === target.id)
  if (target.kind === 'zone') return persisted.zones.some((zone) => zone.name === target.id)
  if (target.kind === 'annotation') {
    return persisted.annotations.some((annotation) => annotation.id === target.id)
  }
  return persisted.measurementGuides.some((guide) => guide.id === target.id)
}

function getTargetPrimaryLayerName(
  persisted: ScenePersistedState,
  target: SceneSelectionTarget,
): string | null {
  if (target.kind === 'group') {
    const group = persisted.groups.find((entry) => entry.id === target.id)
    const firstMember = group?.members.find((member) => resolveSceneObjectGroupMemberLayer(persisted, member) !== null)
    return firstMember ? sceneObjectGroupMemberLayerName(firstMember) : null
  }
  return getSelectionLayer(target)
}

function getTargetLayerBlock(
  persisted: ScenePersistedState,
  target: SceneSelectionTarget,
): { reason: 'hidden-layer' | 'locked-layer'; layerName: string } | null {
  const layerNames = getTargetLayerNames(persisted, target)
  for (const layerName of layerNames) {
    const layer = findLayer(persisted, layerName)
    if (layer?.visible === false) return { reason: 'hidden-layer', layerName }
  }
  for (const layerName of layerNames) {
    const layer = findLayer(persisted, layerName)
    if (layer?.locked === true) return { reason: 'locked-layer', layerName }
  }
  return null
}

function getTargetLayerNames(
  persisted: ScenePersistedState,
  target: SceneSelectionTarget,
): string[] {
  if (target.kind !== 'group') return [getSelectionLayer(target)]
  const group = persisted.groups.find((entry) => entry.id === target.id)
  if (!group) return []
  const layerNames = new Set<string>()
  for (const member of group.members) {
    if (!resolveSceneObjectGroupMemberLayer(persisted, member)) continue
    layerNames.add(sceneObjectGroupMemberLayerName(member))
  }
  return [...layerNames]
}

function resolveSceneObjectGroupMemberLayer(
  persisted: ScenePersistedState,
  member: { kind: 'plant' | 'zone' | 'annotation'; id: string },
): string | null {
  if (member.kind === 'plant') {
    return persisted.plants.some((plant) => plant.id === member.id) ? 'plants' : null
  }
  if (member.kind === 'zone') {
    return persisted.zones.some((zone) => zone.name === member.id) ? 'zones' : null
  }
  return persisted.annotations.some((annotation) => annotation.id === member.id) ? 'annotations' : null
}

function findLayer(
  persisted: ScenePersistedState,
  layerName: string,
): SceneLayerEntity | null {
  return persisted.layers.find((layer) => layer.name === layerName) ?? null
}
