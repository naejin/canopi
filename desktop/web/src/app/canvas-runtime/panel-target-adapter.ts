import {
  clearPanelOriginTargets,
  readPanelOriginTargets,
  setCanvasHoveredTargets,
  subscribePanelOriginTargetChanges,
} from '../panel-targets/presentation'
import type { SceneRuntimePanelTargetAdapter } from '../../canvas/runtime/scene-runtime/panel-target-adapter'

export function createAppSceneRuntimePanelTargetAdapter(): SceneRuntimePanelTargetAdapter {
  return {
    readPanelOriginTargets,
    setCanvasHoverTargets: setCanvasHoveredTargets,
    clearPanelOriginTargets,
    subscribePanelOriginTargetChanges,
  }
}
