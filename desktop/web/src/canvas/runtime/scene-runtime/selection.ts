import { getAnnotationWorldBounds } from '../annotation-layout'
import type { SceneBounds } from '../camera'
import {
  getPlantWorldBounds,
  type PlantPresentationContext,
} from '../plant-presentation'
import type {
  CanvasDesignObjectSelectionBlockedTarget,
  CanvasDesignObjectSelectionMissingTarget,
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
} from '../scene'
import { getZoneWorldBounds } from '../zone-geometry'
import { getSameSpeciesReferenceCanonicalName } from './species-selection'

export type SceneSelectionTarget = CanvasDesignObjectSelectionTarget

export interface SceneSelectionReadModelOptions {
  readonly annotationViewportScale: number
  readonly plantContext: PlantPresentationContext
}

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
    for (const member of group.members) {
      if (member.kind === 'zone' && persisted.zones.some((zone) => zone.name === member.id)) {
        resolved.add(member.id)
      }
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
    for (const member of group.members) {
      if (
        member.kind === 'annotation'
        && persisted.annotations.some((annotation) => annotation.id === member.id)
      ) {
        resolved.add(member.id)
      }
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
    for (const member of group.members) {
      if (member.kind === 'plant' && persisted.plants.some((plant) => plant.id === member.id)) {
        resolved.add(member.id)
      }
    }
  }
  return resolved
}

export function getSelectedMeasurementGuideIds(
  persisted: ScenePersistedState,
  selectedIds: ReadonlySet<string>,
): Set<string> {
  const resolved = new Set<string>()
  for (const guide of persisted.measurementGuides) {
    if (selectedIds.has(guide.id)) resolved.add(guide.id)
  }
  return resolved
}

export function getSelectedTopLevelTargets(
  persisted: ScenePersistedState,
  selectedIds: ReadonlySet<string>,
): SceneSelectionTarget[] {
  const groupedMemberKeys = getSceneGroupedMemberKeys(persisted)
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
    if (
      !selectedIds.has(plant.id)
      || groupedMemberKeys.has(sceneTargetKey({ kind: 'plant', id: plant.id }))
    ) continue
    const key = `plant:${plant.id}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: 'plant', id: plant.id })
  }

  for (const zone of persisted.zones) {
    if (
      !selectedIds.has(zone.name)
      || groupedMemberKeys.has(sceneTargetKey({ kind: 'zone', id: zone.name }))
    ) continue
    const key = `zone:${zone.name}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: 'zone', id: zone.name })
  }

  for (const annotation of persisted.annotations) {
    if (
      !selectedIds.has(annotation.id)
      || groupedMemberKeys.has(sceneTargetKey({ kind: 'annotation', id: annotation.id }))
    ) continue
    const key = `annotation:${annotation.id}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: 'annotation', id: annotation.id })
  }

  for (const guide of persisted.measurementGuides) {
    if (!selectedIds.has(guide.id)) continue
    const key = `measurement-guide:${guide.id}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: 'measurement-guide', id: guide.id })
  }

  return targets
}

export function getDesignObjectSelectionModel(
  persisted: ScenePersistedState,
  selectedIds: ReadonlySet<string>,
  options: SceneSelectionReadModelOptions,
): CanvasDesignObjectSelectionModel {
  const topLevelTargets = getSelectedTopLevelTargets(persisted, selectedIds)
  const blockedTargets = getBlockedSelectionTargets(persisted, selectedIds)
  const blockedKeys = new Set(blockedTargets.map((blocked) => targetKey(blocked.target)))
  const lockedTargets = blockedTargets
    .filter((blocked): blocked is CanvasDesignObjectSelectionBlockedTarget & {
      target: CanvasDesignObjectSelectionTarget
    } =>
      blocked.reason === 'locked-design-object'
      && blocked.target.kind !== 'missing'
      && isDirectSceneDesignObjectLocked(persisted, blocked.target.id),
    )
    .map((blocked) => blocked.target)
  const editableTargets = topLevelTargets.filter((target) => !blockedKeys.has(targetKey(target)))
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
  selectedIds: ReadonlySet<string>,
): CanvasDesignObjectSelectionBlockedTarget[] {
  const blockedTargets: CanvasDesignObjectSelectionBlockedTarget[] = []
  const seen = new Set<string>()
  const groupedMemberKeys = getSceneGroupedMemberKeys(persisted)

  for (const selectedId of selectedIds) {
    const target = resolveTarget(persisted, selectedId)
    if (!target) {
      pushBlocked(blockedTargets, seen, {
        target: { kind: 'missing', id: selectedId },
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
    if (isSceneDesignObjectLocked(persisted, target.id)) {
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
  const key = targetKey(blocked.target)
  if (seen.has(key)) return
  seen.add(key)
  blockedTargets.push(blocked)
}

function resolveTarget(
  persisted: ScenePersistedState,
  id: string,
): SceneSelectionTarget | null {
  if (persisted.groups.some((group) => group.id === id)) return { kind: 'group', id }
  if (persisted.plants.some((plant) => plant.id === id)) return { kind: 'plant', id }
  if (persisted.zones.some((zone) => zone.name === id)) return { kind: 'zone', id }
  if (persisted.annotations.some((annotation) => annotation.id === id)) return { kind: 'annotation', id }
  if (persisted.measurementGuides.some((guide) => guide.id === id)) return { kind: 'measurement-guide', id }
  return null
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

function targetKey(target: SceneSelectionTarget | CanvasDesignObjectSelectionMissingTarget): string {
  return `${target.kind}:${target.id}`
}
