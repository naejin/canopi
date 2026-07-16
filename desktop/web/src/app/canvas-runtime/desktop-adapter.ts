import type { CanvasRuntimeAppAdapter } from '../../canvas/runtime/app-adapter'
import { CanvasPlantLabelResolver } from '../../canvas/runtime/plant-labels'
import { CanvasSpeciesCache } from '../../canvas/runtime/species-cache'
import { savedObjectStampWorkbench } from '../saved-object-stamps'
import { createAppCanvasRuntimeAppAdapter } from './app-adapter'

export function createDesktopCanvasRuntimeAppAdapter(): CanvasRuntimeAppAdapter {
  return createAppCanvasRuntimeAppAdapter({
    presentationData: {
      plantLabels: new CanvasPlantLabelResolver(),
      speciesCache: new CanvasSpeciesCache(),
    },
    savedObjectStamps: {
      saveCurrentSelection: (capture) => savedObjectStampWorkbench.saveSelection(capture),
    },
  })
}
