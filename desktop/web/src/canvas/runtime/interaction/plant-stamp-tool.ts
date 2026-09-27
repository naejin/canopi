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
  /** A click found no species chosen, and none has been chosen since. */
  readonly promptsSpecies: () => boolean
  readonly clear: () => void
}

export function createPlantStampTool(context: PlantStampToolContext): PlantStampTool {
  let speciesPrompted = false

  function pointerDown(world: ScenePoint): void {
    const source = readPlantStampSource()
    speciesPrompted = source === null
    if (!source) return
    if (!isSceneLayerOpenForCreation(context.getSceneStore().persisted, 'plants')) return

    context.sceneEdits.run('interaction-stamp-plant', (tx) => {
      let placedPlantId = ''
      tx.mutate((draft) => {
        placedPlantId = appendPlantStampSourceToDraft(draft, source, context.applySnapping(world))
      })
      if (placedPlantId) tx.setSelection([{ kind: 'plant', id: placedPlantId }])
    })
  }

  return {
    pointerDown,
    promptsSpecies: () => speciesPrompted && readPlantStampSource() === null,
    clear() {
      speciesPrompted = false
      clearPlantStampSource()
    },
  }
}

export function createPlantStampToolAdapter(tool: PlantStampTool): SceneToolAdapter {
  return {
    onDeactivate: tool.clear,
    describeGuidance: () => ({ promptSpecies: tool.promptsSpecies() }),
    pointerDown({ rawWorld }) {
      tool.pointerDown(rawWorld)
      return true
    },
    dispose: tool.clear,
  }
}
