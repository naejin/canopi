import { getActiveProjectionBackend } from '../canvas/projection'
import {
  indexTargetScene,
  resolveTargetsInScene,
  type TargetResolution,
  type TargetSceneIndex,
  type TargetSceneInput,
  type TargetScenePoint,
} from './identity'
import type { PanelTarget } from '../types/design'

export type TargetMapProjectionPoint = TargetScenePoint

export interface TargetMapProjectionLocation {
  readonly lat: number
  readonly lon: number
  readonly northBearingDeg?: number | null
}

export interface TargetMapPlantRef {
  readonly id: string
  readonly canonicalName: string
  readonly position: TargetMapProjectionPoint
}

export interface TargetMapZoneRef {
  readonly name: string
  readonly points: readonly TargetMapProjectionPoint[]
}

export interface TargetMapProjectionScene {
  readonly plants: readonly TargetMapPlantRef[]
  readonly zones: readonly TargetMapZoneRef[]
}

export interface TargetMapPlantFeature {
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

export interface TargetMapZoneFeature {
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

export type TargetMapFeature = TargetMapPlantFeature | TargetMapZoneFeature
export type TargetMapSkippedReason = 'missing_location' | null

export interface TargetMapProjectionResult {
  readonly features: readonly TargetMapFeature[]
  readonly unresolvedTargets: readonly PanelTarget[]
  readonly skippedSceneIds: readonly string[]
  readonly skippedReason: TargetMapSkippedReason
}

function isTargetSceneIndex(
  scene: TargetSceneInput | TargetSceneIndex,
): scene is TargetSceneIndex {
  return 'plantsById' in scene
}

export function projectTargetResolutionToMapFeatures(
  resolution: TargetResolution,
  location: TargetMapProjectionLocation | null,
): TargetMapProjectionResult {
  if (!location) {
    return {
      features: [],
      unresolvedTargets: resolution.unresolvedTargets,
      skippedSceneIds: resolution.sceneIds,
      skippedReason: 'missing_location',
    }
  }

  const features: TargetMapFeature[] = []
  const skippedSceneIds: string[] = []
  const skippedFeatureKeys = new Set<string>()
  const projectionBackend = getActiveProjectionBackend()

  const pushSkipped = (key: string, sceneId: string): void => {
    if (skippedFeatureKeys.has(key)) return
    skippedFeatureKeys.add(key)
    skippedSceneIds.push(sceneId)
  }

  for (const ref of resolution.resolvedRefs) {
    if (ref.kind === 'plant') {
      const key = `plant:${ref.id}`
      if (!ref.plant.position) {
        pushSkipped(key, ref.id)
        continue
      }
      const geo = projectionBackend.worldToGeo(
        ref.plant.position.x,
        ref.plant.position.y,
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
          sceneId: ref.plant.id,
        },
      })
      continue
    }

    const key = `zone:${ref.id}`
    if (!ref.zone.points || ref.zone.points.length < 3) {
      pushSkipped(key, ref.id)
      continue
    }
    const ring = ref.zone.points.map((point): readonly [number, number] => {
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
        sceneId: ref.zone.name,
      },
    })
  }

  return {
    features,
    unresolvedTargets: resolution.unresolvedTargets,
    skippedSceneIds,
    skippedReason: null,
  }
}

export function projectTargetsToMapFeatures(
  values: readonly PanelTarget[],
  scene: TargetMapProjectionScene | TargetSceneIndex,
  location: TargetMapProjectionLocation | null,
): TargetMapProjectionResult {
  const index = isTargetSceneIndex(scene) ? scene : indexTargetScene(scene)
  return projectTargetResolutionToMapFeatures(resolveTargetsInScene(values, index), location)
}

export const targetMapProjection = {
  project: projectTargetResolutionToMapFeatures,
  projectTargets: projectTargetsToMapFeatures,
} as const
