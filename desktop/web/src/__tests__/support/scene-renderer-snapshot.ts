import type { SceneRendererSnapshot } from '../../canvas/runtime/renderers/scene-types'
import type {
  SceneDesignObjectSelection,
  ScenePersistedState,
} from '../../canvas/runtime/scene'
import { projectSceneSelectionEntityIds } from '../../canvas/runtime/scene-runtime/selection'

export interface TestSceneRendererSnapshotOptions {
  readonly scene?: Partial<ScenePersistedState>
  readonly viewport?: SceneRendererSnapshot['viewport']
  readonly selectedTargets?: SceneDesignObjectSelection
  readonly highlightedPlantIds?: SceneRendererSnapshot['highlightedPlantIds']
  readonly highlightedZoneIds?: SceneRendererSnapshot['highlightedZoneIds']
  readonly speciesCache?: SceneRendererSnapshot['speciesCache']
  readonly localizedCommonNames?: SceneRendererSnapshot['localizedCommonNames']
  readonly hoveredCanonicalName?: SceneRendererSnapshot['hoveredCanonicalName']
  readonly hoverTarget?: SceneRendererSnapshot['hoverTarget']
  readonly pinnedPlantNameLabels?: SceneRendererSnapshot['pinnedPlantNameLabels']
  readonly selectionLabels?: SceneRendererSnapshot['selectionLabels']
}

export function createTestSceneRendererSnapshot(
  options: TestSceneRendererSnapshotOptions = {},
): SceneRendererSnapshot {
  const scene: ScenePersistedState = {
    plantSpeciesColors: options.scene?.plantSpeciesColors ?? {},
    plantSpeciesSymbols: options.scene?.plantSpeciesSymbols ?? {},
    layers: options.scene?.layers ?? [],
    plants: options.scene?.plants ?? [],
    zones: options.scene?.zones ?? [],
    annotations: options.scene?.annotations ?? [],
    measurementGuides: options.scene?.measurementGuides ?? [],
    groups: options.scene?.groups ?? [],
    guides: options.scene?.guides ?? [],
  }
  const selectedTargets = options.selectedTargets ?? []
  const singleSelectedPlant = selectedTargets.length === 1 && selectedTargets[0]?.kind === 'plant'
    ? selectedTargets[0]
    : null
  const selectionProjection = projectSceneSelectionEntityIds(scene, selectedTargets)

  return {
    scene,
    viewport: options.viewport ?? { x: 0, y: 0, scale: 1 },
    selectionLabelPlantIds: new Set(singleSelectedPlant ? [singleSelectedPlant.id] : []),
    ...selectionProjection,
    highlightedPlantIds: new Set(options.highlightedPlantIds ?? []),
    highlightedZoneIds: new Set(options.highlightedZoneIds ?? []),
    speciesCache: new Map(options.speciesCache ?? []),
    localizedCommonNames: new Map(options.localizedCommonNames ?? []),
    hoveredCanonicalName: options.hoveredCanonicalName ?? null,
    hoverTarget: options.hoverTarget ?? null,
    pinnedPlantNameLabels: options.pinnedPlantNameLabels ?? [],
    selectionLabels: options.selectionLabels ?? [],
  }
}
