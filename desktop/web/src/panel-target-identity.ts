import type { PanelTarget, SpeciesPanelTarget } from './types/design'

export interface PanelTargetScenePoint {
  readonly x: number
  readonly y: number
}

export interface PanelTargetPlantRef {
  readonly id: string
  readonly canonicalName: string
  readonly position?: PanelTargetScenePoint
}

export interface PanelTargetZoneRef {
  readonly name: string
  readonly points?: readonly PanelTargetScenePoint[]
}

export interface PanelTargetSceneInput {
  readonly plants: readonly PanelTargetPlantRef[]
  readonly zones: readonly PanelTargetZoneRef[]
}

export interface PanelTargetSceneIndex {
  readonly plantsById: ReadonlyMap<string, PanelTargetPlantRef>
  readonly plantIdsBySpecies: ReadonlyMap<string, readonly string[]>
  readonly zonesByName: ReadonlyMap<string, PanelTargetZoneRef>
}

export type ResolvedPanelTargetRef =
  | { readonly kind: 'plant'; readonly id: string; readonly plant: PanelTargetPlantRef }
  | { readonly kind: 'zone'; readonly id: string; readonly zone: PanelTargetZoneRef }

export interface PanelTargetResolution {
  readonly plantIds: readonly string[]
  readonly zoneIds: readonly string[]
  readonly sceneIds: readonly string[]
  readonly unresolvedTargets: readonly PanelTarget[]
  readonly resolvedRefs: readonly ResolvedPanelTargetRef[]
}

export const MANUAL_TARGET: PanelTarget = { kind: 'manual' }
export const NONE_TARGET: PanelTarget = { kind: 'none' }

export function speciesTarget(canonicalName: string): SpeciesPanelTarget {
  return { kind: 'species', canonical_name: canonicalName }
}

export function isSpeciesTarget(target: PanelTarget): target is SpeciesPanelTarget {
  return target.kind === 'species'
}

export function panelTargetKey(target: PanelTarget): string {
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

export function panelTargetsEqual(left: readonly PanelTarget[], right: readonly PanelTarget[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (panelTargetKey(left[i]!) !== panelTargetKey(right[i]!)) return false
  }
  return true
}

export function panelTargetEqual(left: PanelTarget, right: PanelTarget): boolean {
  return panelTargetKey(left) === panelTargetKey(right)
}

export function indexPanelTargetScene(scene: PanelTargetSceneInput): PanelTargetSceneIndex {
  const plantsById = new Map<string, PanelTargetPlantRef>()
  const plantIdsBySpecies = new Map<string, string[]>()
  const zonesByName = new Map<string, PanelTargetZoneRef>()

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

export function resolvePanelTargetIdentity(
  targets: readonly PanelTarget[],
  index: PanelTargetSceneIndex,
): PanelTargetResolution {
  const seenSceneIds = new Set<string>()
  const seenFeatureKeys = new Set<string>()
  const plantIds: string[] = []
  const zoneIds: string[] = []
  const sceneIds: string[] = []
  const unresolvedTargets: PanelTarget[] = []
  const resolvedRefs: ResolvedPanelTargetRef[] = []

  const addSceneId = (id: string): void => {
    if (seenSceneIds.has(id)) return
    seenSceneIds.add(id)
    sceneIds.push(id)
  }

  const addPlant = (id: string, plant: PanelTargetPlantRef): void => {
    if (!plantIds.includes(id)) plantIds.push(id)
    addSceneId(id)
    const featureKey = `plant:${id}`
    if (seenFeatureKeys.has(featureKey)) return
    seenFeatureKeys.add(featureKey)
    resolvedRefs.push({ kind: 'plant', id, plant })
  }

  const addZone = (id: string, zone: PanelTargetZoneRef): void => {
    if (!zoneIds.includes(id)) zoneIds.push(id)
    addSceneId(id)
    const featureKey = `zone:${id}`
    if (seenFeatureKeys.has(featureKey)) return
    seenFeatureKeys.add(featureKey)
    resolvedRefs.push({ kind: 'zone', id, zone })
  }

  for (const target of targets) {
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

export const panelTargetIdentity = {
  species: speciesTarget,
  key: panelTargetKey,
  equals: panelTargetEqual,
  listEquals: panelTargetsEqual,
  indexScene: indexPanelTargetScene,
  resolve: resolvePanelTargetIdentity,
} as const
