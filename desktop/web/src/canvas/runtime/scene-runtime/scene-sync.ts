import { batch } from '@preact/signals'
import { plantColorMenuOpen } from '../../plant-color-menu-state'
import { plantSymbolMenuOpen } from '../../plant-symbol-menu-state'
import { setCanvasSelection } from '../../session-state'
import type { ToolId } from '../interaction-types'
import type { SceneStateReader } from '../scene'
import type { CanvasRuntimeLayerProjectionAdapter } from '../app-adapter'

export function resetTransientRuntimeState(
  setTool: (id: ToolId) => void,
): void {
  setTool('select')
  plantColorMenuOpen.value = false
  plantSymbolMenuOpen.value = false
}

/** The Scene's layers and selection reach the app's signals together, after each commit, undo and redo. */
export function syncCanvasSignalsFromScene(
  sceneStore: SceneStateReader,
  layerProjections: CanvasRuntimeLayerProjectionAdapter,
): void {
  batch(() => {
    layerProjections.syncFromLayers(sceneStore.persisted.layers)
    setCanvasSelection(sceneStore.session.selectedTargets.map((target) => target.id))
  })
}
