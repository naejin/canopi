import { getActiveProjectionBackend } from './canvas/projection'
import type { BudgetItem, Consortium, PanelTarget, SpeciesPanelTarget, TimelineAction } from './types/design'

export interface PanelTargetMapProjectionPoint {
  readonly x: number
  readonly y: number
}

export interface PanelTargetPlantRef {
  readonly id: string
  readonly canonicalName: string
  readonly position?: PanelTargetMapProjectionPoint
}

export interface PanelTargetZoneRef {
  readonly name: string
  readonly points?: readonly PanelTargetMapProjectionPoint[]
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

export interface PanelTargetMapProjectionLocation {
  readonly lat: number
  readonly lon: number
  readonly northBearingDeg?: number | null
}

export interface PanelTargetMapPlantRef {
  readonly id: string
  readonly canonicalName: string
  readonly position: PanelTargetMapProjectionPoint
}

export interface PanelTargetMapZoneRef {
  readonly name: string
  readonly points: readonly PanelTargetMapProjectionPoint[]
}

export interface PanelTargetMapProjectionScene {
  readonly plants: readonly PanelTargetMapPlantRef[]
  readonly zones: readonly PanelTargetMapZoneRef[]
}

export interface PanelTargetMapPlantFeature {
  readonly type: 'Feature'
  readonly geometry: {
    readonly type: 'Point'
    readonly coordinates: readonly [number, number]
  }
  readonly properties: {
    readonly kind: 'plant'
    readonly sceneId: string
  }
}

export interface PanelTargetMapZoneFeature {
  readonly type: 'Feature'
  readonly geometry: {
    readonly type: 'Polygon'
    readonly coordinates: readonly (readonly [number, number])[][]
  }
  readonly properties: {
    readonly kind: 'zone'
    readonly sceneId: string
  }
}

export type PanelTargetMapFeature = PanelTargetMapPlantFeature | PanelTargetMapZoneFeature
export type PanelTargetMapSkippedReason = 'missing_location' | null

export interface PanelTargetMapProjectionResult {
  readonly features: readonly PanelTargetMapFeature[]
  readonly unresolvedTargets: readonly PanelTarget[]
  readonly skippedSceneIds: readonly string[]
  readonly skippedReason: PanelTargetMapSkippedReason
}

export interface PanelTargetResolution {
  readonly plantIds: readonly string[]
  readonly zoneIds: readonly string[]
  readonly sceneIds: readonly string[]
  readonly unresolvedTargets: readonly PanelTarget[]
  toMapFeatures(location: PanelTargetMapProjectionLocation | null): PanelTargetMapProjectionResult
}

type ResolvedPanelTargetRef =
  | { readonly kind: 'plant'; readonly id: string }
  | { readonly kind: 'zone'; readonly id: string }

export const MANUAL_TARGET: PanelTarget = { kind: 'manual' }
export const NONE_TARGET: PanelTarget = { kind: 'none' }

export function speciesTarget(canonicalName: string): SpeciesPanelTarget {
  return { kind: 'species', canonical_name: canonicalName }
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

  const addPlantId = (id: string): void => {
    if (!plantIds.includes(id)) plantIds.push(id)
    addSceneId(id)
    const featureKey = `plant:${id}`
    if (seenFeatureKeys.has(featureKey)) return
    seenFeatureKeys.add(featureKey)
    resolvedRefs.push({ kind: 'plant', id })
  }

  const addZoneId = (id: string): void => {
    if (!zoneIds.includes(id)) zoneIds.push(id)
    addSceneId(id)
    const featureKey = `zone:${id}`
    if (seenFeatureKeys.has(featureKey)) return
    seenFeatureKeys.add(featureKey)
    resolvedRefs.push({ kind: 'zone', id })
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
          addPlantId(plantId)
        }
        break
      }
      case 'placed_plant':
        if (index.plantsById.has(target.plant_id)) addPlantId(target.plant_id)
        else unresolvedTargets.push(target)
        break
      case 'zone':
        if (index.zonesByName.has(target.zone_name)) addZoneId(target.zone_name)
        else unresolvedTargets.push(target)
        break
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
    toMapFeatures: (location) => projectResolvedPanelTargetsToMapFeatures({
      index,
      resolvedRefs,
      sceneIds,
      unresolvedTargets,
      location,
    }),
  }
}

function projectResolvedPanelTargetsToMapFeatures(input: {
  readonly index: PanelTargetSceneIndex
  readonly resolvedRefs: readonly ResolvedPanelTargetRef[]
  readonly sceneIds: readonly string[]
  readonly unresolvedTargets: readonly PanelTarget[]
  readonly location: PanelTargetMapProjectionLocation | null
}): PanelTargetMapProjectionResult {
  const { index, resolvedRefs, sceneIds, unresolvedTargets, location } = input
  if (!location) {
    return {
      features: [],
      unresolvedTargets,
      skippedSceneIds: sceneIds,
      skippedReason: 'missing_location',
    }
  }

  const features: PanelTargetMapFeature[] = []
  const skippedSceneIds: string[] = []
  const skippedFeatureKeys = new Set<string>()
  const projectionBackend = getActiveProjectionBackend()

  const pushSkipped = (key: string, sceneId: string): void => {
    if (skippedFeatureKeys.has(key)) return
    skippedFeatureKeys.add(key)
    skippedSceneIds.push(sceneId)
  }

  for (const ref of resolvedRefs) {
    if (ref.kind === 'plant') {
      const key = `plant:${ref.id}`
      const plant = index.plantsById.get(ref.id)
      if (!plant?.position) {
        pushSkipped(key, ref.id)
        continue
      }
      const geo = projectionBackend.worldToGeo(
        plant.position.x,
        plant.position.y,
        location.lat,
        location.lon,
        location.northBearingDeg ?? 0,
      )
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [geo.lng, geo.lat],
        },
        properties: {
          kind: 'plant',
          sceneId: plant.id,
        },
      })
      continue
    }

    const key = `zone:${ref.id}`
    const zone = index.zonesByName.get(ref.id)
    if (!zone?.points || zone.points.length < 3) {
      pushSkipped(key, ref.id)
      continue
    }
    const ring = zone.points.map((point): readonly [number, number] => {
      const geo = projectionBackend.worldToGeo(
        point.x,
        point.y,
        location.lat,
        location.lon,
        location.northBearingDeg ?? 0,
      )
      return [geo.lng, geo.lat]
    })
    const first = ring[0]!
    const last = ring[ring.length - 1]!
    const closedRing = first[0] === last[0] && first[1] === last[1]
      ? ring
      : [...ring, first]

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [closedRing],
      },
      properties: {
        kind: 'zone',
        sceneId: zone.name,
      },
    })
  }

  return {
    features,
    unresolvedTargets,
    skippedSceneIds,
    skippedReason: null,
  }
}

export const panelTargets = {
  species: speciesTarget,
  key: panelTargetKey,
  equals: panelTargetEqual,
  listEquals: panelTargetsEqual,
  indexScene: indexPanelTargetScene,
  resolve: resolvePanelTargetIdentity,
} as const

export function isSpeciesTarget(target: PanelTarget): target is SpeciesPanelTarget {
  return target.kind === 'species'
}

export function getConsortiumCanonicalName(entry: Consortium): string {
  return entry.target.canonical_name
}

export function consortiumTarget(canonicalName: string): SpeciesPanelTarget {
  return speciesTarget(canonicalName)
}

export function speciesBudgetTarget(canonicalName: string): SpeciesPanelTarget {
  return speciesTarget(canonicalName)
}

export function getBudgetHoverTarget(item: BudgetItem | null | undefined, canonicalName: string): PanelTarget {
  return item?.target ?? speciesBudgetTarget(canonicalName)
}

export function getTimelineHoverTargets(action: TimelineAction): readonly PanelTarget[] {
  return action.targets
}

export function getBudgetSpeciesTarget(item: BudgetItem): SpeciesPanelTarget | null {
  return item.category === 'plants' && item.target.kind === 'species' ? item.target : null
}

export function getTimelineSpeciesTarget(action: TimelineAction): SpeciesPanelTarget | null {
  for (const target of action.targets) {
    if (target.kind === 'species') return target
  }
  return null
}
