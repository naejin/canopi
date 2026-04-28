import { effect } from '@preact/signals'
import { panelTargets } from '../../panel-targets'
import { clearPanelOriginTargets } from '../panel-targets/coordinator'
import {
  hoveredCanvasTargets,
  hoveredPanelTargets,
  selectedPanelTargets,
} from '../panel-targets/state'
import type { SceneRuntimePanelTargetAdapter } from '../../canvas/runtime/scene-runtime/panel-target-adapter'

export function createAppSceneRuntimePanelTargetAdapter(): SceneRuntimePanelTargetAdapter {
  return {
    readPanelOriginTargets: () => [
      ...selectedPanelTargets.value,
      ...hoveredPanelTargets.value,
    ],
    setCanvasHoverTargets: (targets) => {
      if (!panelTargets.listEquals(hoveredCanvasTargets.peek(), targets)) {
        hoveredCanvasTargets.value = targets
      }
    },
    clearPanelOriginTargets,
    subscribePanelOriginTargetChanges: (onChange) => effect(() => {
      void hoveredPanelTargets.value
      void selectedPanelTargets.value
      onChange()
    }),
  }
}
