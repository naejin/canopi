import { plantStampSpecies } from '../../plant-tool-state'
import type { PlantDropPayload } from './tool-actions'
import { appendDroppedPlantToDraft } from './tool-actions'
import type { ScenePoint } from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import type { SceneToolAdapter } from './tool-adapter'

export interface PlantStampToolContext {
  readonly sceneEdits: SceneEditCoordinator
  readonly applySnapping: (point: ScenePoint) => ScenePoint
}

export interface PlantStampTool {
  readonly pointerDown: (world: ScenePoint) => void
  readonly clear: () => void
}

export function createPlantStampTool(context: PlantStampToolContext): PlantStampTool {
  function pointerDown(world: ScenePoint): void {
    const species: PlantDropPayload | null = plantStampSpecies.value
    if (!species) return

    context.sceneEdits.run('interaction-stamp-plant', (tx) => {
      tx.mutate((draft) => {
        appendDroppedPlantToDraft(draft, species, context.applySnapping(world))
      })
    })
  }

  return {
    pointerDown,
    clear() {
      plantStampSpecies.value = null
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
  }
}
