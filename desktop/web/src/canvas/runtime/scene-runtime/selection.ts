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
    for (const memberId of group.memberIds) {
      if (persisted.zones.some((zone) => zone.name === memberId)) resolved.add(memberId)
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
    for (const memberId of group.memberIds) {
      if (persisted.annotations.some((annotation) => annotation.id === memberId)) resolved.add(memberId)
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
    for (const memberId of group.memberIds) {
      if (persisted.plants.some((plant) => plant.id === memberId)) resolved.add(memberId)
    }
  }
  return resolved
}

export function getSelectedTopLevelTargets(
  persisted: ScenePersistedState,
  selectedIds: ReadonlySet<string>,
): SceneSelectionTarget[] {
  const groupedMemberIds = new Set(persisted.groups.flatMap((group) => group.memberIds))
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
    if (!selectedIds.has(plant.id) || groupedMemberIds.has(plant.id)) continue
    const key = `plant:${plant.id}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: 'plant', id: plant.id })
  }

  for (const zone of persisted.zones) {
    if (!selectedIds.has(zone.name) || groupedMemberIds.has(zone.name)) continue
    const key = `zone:${zone.name}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: 'zone', id: zone.name })
  }

  for (const annotation of persisted.annotations) {
    if (!selectedIds.has(annotation.id) || groupedMemberIds.has(annotation.id)) continue
    const key = `annotation:${annotation.id}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: 'annotation', id: annotation.id })
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
  return {
    editableTargets,
    lockedTargets,
    blockedTargets,
    bounds: getCombinedTargetBounds(persisted, [...editableTargets, ...lockedTargets], options),
    sameSpeciesReferenceCanonicalName: getSameSpeciesReferenceCanonicalName(persisted, editableTargets),
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
      group.memberIds
        .map((memberId) => resolveTarget(persisted, memberId))
        .filter((member): member is SceneSelectionTarget => member !== null),
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
  if (!annotation) return null
  const bounds = getAnnotationWorldBounds(annotation, options.annotationViewportScale)
  return {
    minX: bounds.x,
    minY: bounds.y,
    maxX: bounds.x + bounds.width,
    maxY: bounds.y + bounds.height,
  }
}

function getBlockedSelectionTargets(
  persisted: ScenePersistedState,
  selectedIds: ReadonlySet<string>,
): CanvasDesignObjectSelectionBlockedTarget[] {
  const blockedTargets: CanvasDesignObjectSelectionBlockedTarget[] = []
  const seen = new Set<string>()
  const groupedMemberIds = new Map<string, string>()
  for (const group of persisted.groups) {
    for (const memberId of group.memberIds) groupedMemberIds.set(memberId, group.id)
  }

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

    const groupId = groupedMemberIds.get(selectedId)
    if (groupId) {
      pushBlocked(blockedTargets, seen, {
        target,
        reason: 'grouped-member',
        layerName: getSelectionLayer(target),
        groupId,
      })
      continue
    }

    const layerName = getTargetLayerName(persisted, target)
    const layer = layerName ? findLayer(persisted, layerName) : null
    if (layer?.visible === false) {
      pushBlocked(blockedTargets, seen, {
        target,
        reason: 'hidden-layer',
        layerName,
      })
      continue
    }
    if (layer?.locked === true) {
      pushBlocked(blockedTargets, seen, {
        target,
        reason: 'locked-layer',
        layerName,
      })
      continue
    }
    if (isSceneDesignObjectLocked(persisted, target.id)) {
      pushBlocked(blockedTargets, seen, {
        target,
        reason: 'locked-design-object',
        layerName,
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
  return null
}

function getTargetLayerName(
  persisted: ScenePersistedState,
  target: SceneSelectionTarget,
): string | null {
  if (target.kind === 'group') {
    return persisted.groups.find((group) => group.id === target.id)?.layer ?? null
  }
  return getSelectionLayer(target)
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
