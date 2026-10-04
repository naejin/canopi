import { batch } from '@preact/signals'
import { plantColorMenuOpen } from '../../plant-color-menu-state'
import { plantSymbolMenuOpen } from '../../plant-symbol-menu-state'
import type { CanopiFile } from '../../../types/design'
import { setCanvasSelection } from '../../session-state'
import type { SceneStateReader } from '../scene'
import type { CanvasRuntimeLayerProjectionAdapter } from '../app-adapter'

export function resetTransientRuntimeState(
  setTool: (name: string) => void,
): void {
  setTool('select')
  plantColorMenuOpen.value = false
  plantSymbolMenuOpen.value = false
}

function syncCanvasSignalsFromDocument(
  file: CanopiFile,
  layerProjections: CanvasRuntimeLayerProjectionAdapter,
): void {
  batch(() => {
    layerProjections.syncFromLayers(file.layers)
  })
}

function syncCanvasSignalsFromPersistedScene(
  sceneStore: SceneStateReader,
  layerProjections: CanvasRuntimeLayerProjectionAdapter,
): void {
  const persisted = sceneStore.persisted

  batch(() => {
    layerProjections.syncFromLayers(persisted.layers)
  })
}

export { syncCanvasSignalsFromDocument }

export function syncCanvasSignalsFromScene(
  sceneStore: SceneStateReader,
  layerProjections: CanvasRuntimeLayerProjectionAdapter,
): void {
  syncCanvasSignalsFromPersistedScene(sceneStore, layerProjections)
  batch(() => {
    setCanvasSelection(sceneStore.session.selectedTargets.map((target) => target.id))
  })
}
