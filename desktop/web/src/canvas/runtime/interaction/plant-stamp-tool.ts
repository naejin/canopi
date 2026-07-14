import { clearPlantStampSource, readPlantStampSource } from '../../plant-stamp-source'
import { appendPlantStampSourceToDraft } from './tool-actions'
import type { ScenePoint, SceneStateReader } from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import type { SceneToolAdapter } from './tool-adapter'
import { isSceneLayerOpenForCreation } from './layer-guards'

export interface PlantStampToolContext {
  readonly getSceneStore: () => SceneStateReader
  readonly sceneEdits: SceneEditCoordinator
  readonly applySnapping: (point: ScenePoint) => ScenePoint
}

export interface PlantStampTool {
  readonly pointerDown: (world: ScenePoint) => void
  readonly clear: () => void
}

export function createPlantStampTool(context: PlantStampToolContext): PlantStampTool {
  function pointerDown(world: ScenePoint): void {
    const source = readPlantStampSource()
    if (!source) return
    if (!isSceneLayerOpenForCreation(context.getSceneStore().persisted, 'plants')) return

    context.sceneEdits.run('interaction-stamp-plant', (tx) => {
      let placedPlantId = ''
      tx.mutate((draft) => {
        placedPlantId = appendPlantStampSourceToDraft(draft, source, context.applySnapping(world))
      })
      if (placedPlantId) tx.setSelection([placedPlantId])
    })
  }

  return {
    pointerDown,
    clear() {
      clearPlantStampSource()
    },
  }
}

export function createPlantStampToolAdapter(tool: PlantStampTool): SceneToolAdapter {
  return {
    onDeactivate: tool.clear,
    pointerDown({ rawWorld }) {
      tool.pointerDown(rawWorld)
      return true
    },
    dispose: tool.clear,
  }
}
