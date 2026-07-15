import type { SceneRendererSnapshot } from '../../canvas/runtime/renderers/scene-types'
import type { ScenePersistedState } from '../../canvas/runtime/scene'
import {
  getSelectedAnnotationIds,
  getSelectedMeasurementGuideIds,
  getSelectedPlantIds,
  getSelectedZoneIds,
} from '../../canvas/runtime/scene-runtime/selection'

export interface TestSceneRendererSnapshotOptions {
  readonly scene?: Partial<ScenePersistedState>
  readonly viewport?: SceneRendererSnapshot['viewport']
  readonly selectedEntityIds?: SceneRendererSnapshot['selectedEntityIds']
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
  const selectedEntityIds = new Set(options.selectedEntityIds ?? [])

  return {
    scene,
    viewport: options.viewport ?? { x: 0, y: 0, scale: 1 },
    selectedEntityIds,
    selectedPlantIds: getSelectedPlantIds(scene, selectedEntityIds),
    selectedZoneIds: getSelectedZoneIds(scene, selectedEntityIds),
    selectedAnnotationIds: getSelectedAnnotationIds(scene, selectedEntityIds),
    selectedMeasurementGuideIds: getSelectedMeasurementGuideIds(scene, selectedEntityIds),
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
