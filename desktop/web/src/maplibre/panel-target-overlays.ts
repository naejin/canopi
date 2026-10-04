import {
  getCanvasInteractionStrokeVisual,
  MIN_PLANT_RING_RADIUS_PX,
  type CanvasInteractionStrokeVisual,
} from '../canvas/runtime/scene-visuals'
import type {
  TargetMapFeature,
  TargetMapProjectionResult,
} from '../target'

export type PanelTargetMapOverlayVariant = 'hover' | 'selection'

export interface PanelTargetMapOverlayFeatureCollection {
  readonly type: 'FeatureCollection'
  readonly features: readonly TargetMapFeature[]
}

interface PanelTargetMapOverlaySourceSpec {
  readonly id: string
  readonly type: 'geojson'
  readonly data: PanelTargetMapOverlayFeatureCollection
}

type PanelTargetMapOverlayKindFilter =
  readonly ['==', readonly ['get', 'kind'], 'plant' | 'zone']

type PanelTargetMapOverlayGeometryFilter =
  readonly ['==', readonly ['geometry-type'], 'Polygon' | 'LineString' | 'Point']

type PanelTargetMapOverlayLayerFilter =
  | PanelTargetMapOverlayKindFilter
  | readonly ['all', PanelTargetMapOverlayKindFilter, PanelTargetMapOverlayGeometryFilter]

interface PanelTargetMapOverlayLayerSpec {
  readonly id: string
  readonly source: string
  readonly type: 'circle' | 'fill' | 'line'
  readonly filter: PanelTargetMapOverlayLayerFilter
  readonly paint: Readonly<Record<string, string | number>>
}

export interface PanelTargetMapOverlayContract {
  readonly variant: PanelTargetMapOverlayVariant
  readonly source: PanelTargetMapOverlaySourceSpec
  readonly layers: readonly PanelTargetMapOverlayLayerSpec[]
  readonly unresolvedTargets: TargetMapProjectionResult['unresolvedTargets']
  readonly skippedSceneIds: readonly string[]
  readonly skippedReason: TargetMapProjectionResult['skippedReason']
  readonly hasRenderableFeatures: boolean
}

/**
 * Panel highlights speak the scene's ring language: a selection is the accent
 * highlight ring over its halo, a panel hover the hover stroke; both read the
 * canvas colour tokens and keep the finder-ring minimum size on screen.
 */
function overlayVisual(variant: PanelTargetMapOverlayVariant): CanvasInteractionStrokeVisual {
  return getCanvasInteractionStrokeVisual(variant === 'selection' ? 'highlight' : 'hover')
}

const ZONE_FILL_OPACITY: Readonly<Record<PanelTargetMapOverlayVariant, number>> = {
  hover: 0.08,
  selection: 0.12,
}

function createLayerSpecs(
  variant: PanelTargetMapOverlayVariant,
  sourceId: string,
): readonly PanelTargetMapOverlayLayerSpec[] {
  const prefix = `panel-target-${variant}`
  const visual = overlayVisual(variant)
  const zoneFilter = ['==', ['get', 'kind'], 'zone'] as const
  const plantFilter = ['==', ['get', 'kind'], 'plant'] as const
  // MapLibre strokes a circle outside its radius; centre each stroke on the ring radius.
  const ringRadius = (strokeWidth: number) => MIN_PLANT_RING_RADIUS_PX - strokeWidth / 2

  return [
    {
      id: `${prefix}-zones-fill`,
      source: sourceId,
      type: 'fill',
      filter: ['all', zoneFilter, ['==', ['geometry-type'], 'Polygon']],
      paint: {
        'fill-color': visual.color,
        'fill-opacity': ZONE_FILL_OPACITY[variant],
      },
    },
    {
      id: `${prefix}-zones-casing`,
      source: sourceId,
      type: 'line',
      filter: zoneFilter,
      paint: {
        'line-color': visual.casingColor,
        'line-width': visual.casingWidthPx,
      },
    },
    {
      id: `${prefix}-zones-line`,
      source: sourceId,
      type: 'line',
      filter: zoneFilter,
      paint: {
        'line-color': visual.color,
        'line-opacity': visual.alpha,
        'line-width': visual.widthPx,
      },
    },
    {
      id: `${prefix}-plants-halo`,
      source: sourceId,
      type: 'circle',
      filter: plantFilter,
      paint: {
        'circle-opacity': 0,
        'circle-radius': ringRadius(visual.casingWidthPx),
        'circle-stroke-color': visual.casingColor,
        'circle-stroke-width': visual.casingWidthPx,
      },
    },
    {
      id: `${prefix}-plants`,
      source: sourceId,
      type: 'circle',
      filter: plantFilter,
      paint: {
        'circle-opacity': 0,
        'circle-radius': ringRadius(visual.widthPx),
        'circle-stroke-color': visual.color,
        'circle-stroke-opacity': visual.alpha,
        'circle-stroke-width': visual.widthPx,
      },
    },
  ]
}

export function createPanelTargetMapOverlayContract(
  variant: PanelTargetMapOverlayVariant,
  projection: TargetMapProjectionResult,
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
