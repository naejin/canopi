import type { PanelTarget, SpeciesPanelTarget } from '../types/design'

export type Target = PanelTarget
export type SpeciesTarget = SpeciesPanelTarget

export interface TargetScenePoint {
  readonly x: number
  readonly y: number
}

export interface TargetPlantRef {
  readonly id: string
  readonly canonicalName: string
  readonly position?: TargetScenePoint
}

export interface TargetZoneRef {
  readonly name: string
  readonly zoneType?: string
  readonly points?: readonly TargetScenePoint[]
}

export interface TargetSceneInput {
  readonly plants: readonly TargetPlantRef[]
  readonly zones: readonly TargetZoneRef[]
}

export interface TargetSceneIndex {
  readonly plantsById: ReadonlyMap<string, TargetPlantRef>
  readonly plantIdsBySpecies: ReadonlyMap<string, readonly string[]>
  readonly zonesByName: ReadonlyMap<string, TargetZoneRef>
}

export type ResolvedTargetRef =
  | { readonly kind: 'plant'; readonly id: string; readonly plant: TargetPlantRef }
  | { readonly kind: 'zone'; readonly id: string; readonly zone: TargetZoneRef }

export interface TargetResolution {
  readonly plantIds: readonly string[]
  readonly zoneIds: readonly string[]
  readonly sceneIds: readonly string[]
  readonly unresolvedTargets: readonly Target[]
  readonly resolvedRefs: readonly ResolvedTargetRef[]
}

export const MANUAL_TARGET: Target = { kind: 'manual' }
export const NONE_TARGET: Target = { kind: 'none' }

export function speciesTarget(canonicalName: string): SpeciesTarget {
  return { kind: 'species', canonical_name: canonicalName }
}

export function isSpeciesTarget(target: Target): target is SpeciesTarget {
  return target.kind === 'species'
}

export function targetKey(target: Target): string {
  switch (target.kind) {
    case 'placed_plant':
      return `placed_plant:${target.plant_id}`
    case 'species':
      return `species:${target.canonical_name}`
    case 'zone':
      return `zone:${target.zone_name}`
    case 'manual':
      return 'manual'
    case 'none':
      return 'none'
  }
}

export function targetListsEqual(left: readonly Target[], right: readonly Target[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (targetKey(left[i]!) !== targetKey(right[i]!)) return false
  }
  return true
}

export function targetsEqual(left: Target, right: Target): boolean {
  return targetKey(left) === targetKey(right)
}

export function indexTargetScene(scene: TargetSceneInput): TargetSceneIndex {
  const plantsById = new Map<string, TargetPlantRef>()
  const plantIdsBySpecies = new Map<string, string[]>()
  const zonesByName = new Map<string, TargetZoneRef>()

  for (const plant of scene.plants) {
    plantsById.set(plant.id, plant)
    const speciesPlantIds = plantIdsBySpecies.get(plant.canonicalName) ?? []
    speciesPlantIds.push(plant.id)
    plantIdsBySpecies.set(plant.canonicalName, speciesPlantIds)
  }

  for (const zone of scene.zones) {
    zonesByName.set(zone.name, zone)
  }

  return { plantsById, plantIdsBySpecies, zonesByName }
}

export function resolveTargetsInScene(
  values: readonly Target[],
  index: TargetSceneIndex,
): TargetResolution {
  const seenSceneIds = new Set<string>()
  const seenFeatureKeys = new Set<string>()
  const plantIds: string[] = []
  const zoneIds: string[] = []
  const sceneIds: string[] = []
  const unresolvedTargets: Target[] = []
  const resolvedRefs: ResolvedTargetRef[] = []

  const addSceneId = (id: string): void => {
    if (seenSceneIds.has(id)) return
    seenSceneIds.add(id)
    sceneIds.push(id)
  }

  const addPlant = (id: string, plant: TargetPlantRef): void => {
    if (!plantIds.includes(id)) plantIds.push(id)
    addSceneId(id)
    const featureKey = `plant:${id}`
    if (seenFeatureKeys.has(featureKey)) return
    seenFeatureKeys.add(featureKey)
    resolvedRefs.push({ kind: 'plant', id, plant })
  }

  const addZone = (id: string, zone: TargetZoneRef): void => {
    if (!zoneIds.includes(id)) zoneIds.push(id)
    addSceneId(id)
    const featureKey = `zone:${id}`
    if (seenFeatureKeys.has(featureKey)) return
    seenFeatureKeys.add(featureKey)
    resolvedRefs.push({ kind: 'zone', id, zone })
  }

  for (const target of values) {
    switch (target.kind) {
      case 'species': {
        const speciesPlantIds = index.plantIdsBySpecies.get(target.canonical_name) ?? []
        if (speciesPlantIds.length === 0) {
          unresolvedTargets.push(target)
          break
        }
        for (const plantId of speciesPlantIds) {
          const plant = index.plantsById.get(plantId)
          if (plant) addPlant(plantId, plant)
        }
        break
      }
      case 'placed_plant': {
        const plant = index.plantsById.get(target.plant_id)
        if (plant) addPlant(target.plant_id, plant)
        else unresolvedTargets.push(target)
        break
      }
      case 'zone': {
        const zone = index.zonesByName.get(target.zone_name)
        if (zone) addZone(target.zone_name, zone)
        else unresolvedTargets.push(target)
        break
      }
      case 'manual':
      case 'none':
        break
    }
  }

  return {
    plantIds,
    zoneIds,
    sceneIds,
    unresolvedTargets,
    resolvedRefs,
  }
}

export const targetIdentity = {
  species: speciesTarget,
  key: targetKey,
  equals: targetsEqual,
  listEquals: targetListsEqual,
  indexScene: indexTargetScene,
  resolve: resolveTargetsInScene,
} as const
