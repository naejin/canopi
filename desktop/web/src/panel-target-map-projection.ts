import { panelTargets } from './panel-targets'
import type {
  PanelTargetMapProjectionLocation,
  PanelTargetMapProjectionResult,
  PanelTargetMapProjectionScene,
  PanelTargetSceneIndex,
} from './panel-targets'
import type { PanelTarget } from './types/design'

export type {
  PanelTargetMapFeature,
  PanelTargetMapPlantFeature,
  PanelTargetMapProjectionLocation,
  PanelTargetMapProjectionPoint,
  PanelTargetMapProjectionResult,
  PanelTargetMapProjectionScene,
  PanelTargetMapSkippedReason,
  PanelTargetMapZoneFeature,
} from './panel-targets'

function isPanelTargetSceneIndex(
  scene: PanelTargetMapProjectionScene | PanelTargetSceneIndex,
): scene is PanelTargetSceneIndex {
  return 'plantsById' in scene
}

export function projectPanelTargetsToMapFeatures(
  targets: readonly PanelTarget[],
  scene: PanelTargetMapProjectionScene | PanelTargetSceneIndex,
  location: PanelTargetMapProjectionLocation | null,
): PanelTargetMapProjectionResult {
  const index = isPanelTargetSceneIndex(scene) ? scene : panelTargets.indexScene(scene)
  return panelTargets.resolve(targets, index).toMapFeatures(location)
}
