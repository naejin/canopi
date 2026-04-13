import { worldToGeo } from './canvas/projection'
import { resolvePanelTargets } from './panel-target-resolution'
import type { PanelTarget } from './types/design'

export interface PanelTargetMapProjectionPoint {
  readonly x: number
  readonly y: number
}

export interface PanelTargetMapProjectionScene {
  readonly plants: readonly {
    readonly id: string
    readonly canonicalName: string
    readonly position: PanelTargetMapProjectionPoint
  }[]
  readonly zones: readonly {
    readonly name: string
    readonly points: readonly PanelTargetMapProjectionPoint[]
  }[]
}

export interface PanelTargetMapProjectionLocation {
  readonly lat: number
  readonly lon: number
  readonly northBearingDeg?: number | null
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

export function projectPanelTargetsToMapFeatures(
  targets: readonly PanelTarget[],
  scene: PanelTargetMapProjectionScene,
  location: PanelTargetMapProjectionLocation | null,
): PanelTargetMapProjectionResult {
  const resolution = resolvePanelTargets(targets, scene)
  if (!location) {
    return {
      features: [],
      unresolvedTargets: resolution.unresolvedTargets,
      skippedSceneIds: resolution.sceneIds,
      skippedReason: 'missing_location',
    }
  }

  const features: PanelTargetMapFeature[] = []
  const skippedSceneIds: string[] = []
  const emittedFeatureKeys = new Set<string>()
  const skippedFeatureKeys = new Set<string>()

  const pushSkipped = (key: string, sceneId: string): void => {
    if (skippedFeatureKeys.has(key)) return
    skippedFeatureKeys.add(key)
    skippedSceneIds.push(sceneId)
  }

  const pushPlantFeature = (plantId: string): void => {
    const key = `plant:${plantId}`
    if (emittedFeatureKeys.has(key)) return
    const plant = scene.plants.find((entry) => entry.id === plantId)
    if (!plant) {
      pushSkipped(key, plantId)
      return
    }
    const geo = worldToGeo(
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
    emittedFeatureKeys.add(key)
  }

  const pushZoneFeature = (zoneId: string): void => {
    const key = `zone:${zoneId}`
    if (emittedFeatureKeys.has(key)) return
    const zone = scene.zones.find((entry) => entry.name === zoneId)
    if (!zone || zone.points.length < 3) {
      pushSkipped(key, zoneId)
      return
    }
    const ring = zone.points.map((point): readonly [number, number] => {
      const geo = worldToGeo(
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
    emittedFeatureKeys.add(key)
  }

  for (const target of targets) {
    switch (target.kind) {
      case 'species':
        for (const plant of scene.plants) {
          if (plant.canonicalName === target.canonical_name && resolution.plantIds.includes(plant.id)) {
            pushPlantFeature(plant.id)
          }
        }
        break
      case 'placed_plant':
        if (resolution.plantIds.includes(target.plant_id)) pushPlantFeature(target.plant_id)
        break
      case 'zone':
        if (resolution.zoneIds.includes(target.zone_name)) pushZoneFeature(target.zone_name)
        break
      case 'manual':
      case 'none':
        break
    }
  }

  return {
    features,
    unresolvedTargets: resolution.unresolvedTargets,
    skippedSceneIds,
    skippedReason: null,
  }
}
