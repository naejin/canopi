import { getActiveProjectionBackend } from './canvas/projection'
import {
  indexPanelTargetScene,
  resolvePanelTargetIdentity,
  type PanelTargetResolution,
  type PanelTargetSceneIndex,
  type PanelTargetScenePoint,
} from './panel-target-identity'
import type {
  PanelTargetSceneInput,
} from './panel-target-identity'
import type { PanelTarget } from './types/design'

export type PanelTargetMapProjectionPoint = PanelTargetScenePoint

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

function isPanelTargetSceneIndex(
  scene: PanelTargetSceneInput | PanelTargetSceneIndex,
): scene is PanelTargetSceneIndex {
  return 'plantsById' in scene
}

export function projectPanelTargetResolutionToMapFeatures(
  resolution: PanelTargetResolution,
  location: PanelTargetMapProjectionLocation | null,
): PanelTargetMapProjectionResult {
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

export function projectPanelTargetsToMapFeatures(
  targets: readonly PanelTarget[],
  scene: PanelTargetMapProjectionScene | PanelTargetSceneIndex,
  location: PanelTargetMapProjectionLocation | null,
): PanelTargetMapProjectionResult {
  const index = isPanelTargetSceneIndex(scene) ? scene : indexPanelTargetScene(scene)
  return projectPanelTargetResolutionToMapFeatures(resolvePanelTargetIdentity(targets, index), location)
}

export const panelTargetMapProjection = {
  project: projectPanelTargetResolutionToMapFeatures,
  projectTargets: projectPanelTargetsToMapFeatures,
} as const
