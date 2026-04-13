import type { ScenePersistedState } from '../canvas/runtime/scene'
import type {
  PanelTargetMapFeature,
  PanelTargetMapProjectionResult,
  PanelTargetMapProjectionScene,
} from '../panel-target-map-projection'

export type PanelTargetMapOverlayVariant = 'hover' | 'selection'

export interface PanelTargetMapOverlayFeatureCollection {
  readonly type: 'FeatureCollection'
  readonly features: readonly PanelTargetMapFeature[]
}

export interface PanelTargetMapOverlaySourceSpec {
  readonly id: string
  readonly type: 'geojson'
  readonly data: PanelTargetMapOverlayFeatureCollection
}

export interface PanelTargetMapOverlayLayerSpec {
  readonly id: string
  readonly source: string
  readonly type: 'circle' | 'fill' | 'line'
  readonly filter: readonly ['==', readonly ['get', 'kind'], 'plant' | 'zone']
  readonly paint: Readonly<Record<string, string | number>>
}

export interface PanelTargetMapOverlayContract {
  readonly variant: PanelTargetMapOverlayVariant
  readonly source: PanelTargetMapOverlaySourceSpec
  readonly layers: readonly PanelTargetMapOverlayLayerSpec[]
  readonly unresolvedTargets: PanelTargetMapProjectionResult['unresolvedTargets']
  readonly skippedSceneIds: readonly string[]
  readonly skippedReason: PanelTargetMapProjectionResult['skippedReason']
  readonly hasRenderableFeatures: boolean
}

const OVERLAY_STYLE = {
  hover: {
    plantColor: '#f59e0b',
    zoneFillColor: '#f59e0b',
    zoneLineColor: '#b45309',
    zoneFillOpacity: 0.22,
    lineWidth: 2,
    circleRadius: 6,
    circleStrokeColor: '#fff7ed',
  },
  selection: {
    plantColor: '#0f766e',
    zoneFillColor: '#0f766e',
    zoneLineColor: '#134e4a',
    zoneFillOpacity: 0.24,
    lineWidth: 2.5,
    circleRadius: 7,
    circleStrokeColor: '#ecfeff',
  },
} as const

function createLayerSpecs(
  variant: PanelTargetMapOverlayVariant,
  sourceId: string,
): readonly PanelTargetMapOverlayLayerSpec[] {
  const prefix = `panel-target-${variant}`
  const style = OVERLAY_STYLE[variant]

  return [
    {
      id: `${prefix}-zones-fill`,
      source: sourceId,
      type: 'fill',
      filter: ['==', ['get', 'kind'], 'zone'],
      paint: {
        'fill-color': style.zoneFillColor,
        'fill-opacity': style.zoneFillOpacity,
      },
    },
    {
      id: `${prefix}-zones-line`,
      source: sourceId,
      type: 'line',
      filter: ['==', ['get', 'kind'], 'zone'],
      paint: {
        'line-color': style.zoneLineColor,
        'line-opacity': 0.95,
        'line-width': style.lineWidth,
      },
    },
    {
      id: `${prefix}-plants`,
      source: sourceId,
      type: 'circle',
      filter: ['==', ['get', 'kind'], 'plant'],
      paint: {
        'circle-color': style.plantColor,
        'circle-opacity': 0.95,
        'circle-radius': style.circleRadius,
        'circle-stroke-color': style.circleStrokeColor,
        'circle-stroke-width': 2,
      },
    },
  ]
}

export function buildPanelTargetProjectionScene(scene: ScenePersistedState): PanelTargetMapProjectionScene {
  return {
    plants: scene.plants.map((plant) => ({
      id: plant.id,
      canonicalName: plant.canonicalName,
      position: plant.position,
    })),
    zones: scene.zones.map((zone) => ({
      name: zone.name,
      points: zone.points,
    })),
  }
}

export function createPanelTargetMapOverlayContract(
  variant: PanelTargetMapOverlayVariant,
  projection: PanelTargetMapProjectionResult,
): PanelTargetMapOverlayContract {
  const sourceId = `panel-target-${variant}-source`
  return {
    variant,
    source: {
      id: sourceId,
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: projection.features,
      },
    },
    layers: createLayerSpecs(variant, sourceId),
    unresolvedTargets: projection.unresolvedTargets,
    skippedSceneIds: projection.skippedSceneIds,
    skippedReason: projection.skippedReason,
    hasRenderableFeatures: projection.features.length > 0,
  }
}
