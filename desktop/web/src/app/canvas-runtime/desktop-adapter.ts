import type { CanvasRuntimeAppAdapter } from '../../canvas/runtime/app-adapter'
import { CanvasPlantLabelResolver } from '../../canvas/runtime/plant-labels'
import { CanvasSpeciesCache } from '../../canvas/runtime/species-cache'
import { speciesCatalogWorkbench } from '../plant-browser'
import { finishSiteProfile } from '../lidar/profile'
import { pinSiteDataPoint } from '../lidar/site-values'
import { savedObjectStampWorkbench } from '../saved-object-stamps'
import { createAppCanvasRuntimeAppAdapter, type CanvasRuntimeAppCapabilities } from './app-adapter'

/**
 * Site data is Desktop's: a tap no tool uses pins, and Profile's finished line is profiled. The UI gallery, which stands
 * in for Desktop, hands its canvas the same two.
 */
export const DESKTOP_SITE_DATA_CAPABILITIES: Pick<CanvasRuntimeAppCapabilities, 'pinAt' | 'finishProfile'> = Object.freeze({
  pinAt: pinSiteDataPoint,
  finishProfile: finishSiteProfile,
})

export function createDesktopCanvasRuntimeAppAdapter(): CanvasRuntimeAppAdapter {
  return createAppCanvasRuntimeAppAdapter({
    presentationData: {
      // Labels read the catalog's one display-name projection, batched and cached there.
      plantLabels: new CanvasPlantLabelResolver((names, locale) => speciesCatalogWorkbench.resolveDisplayNames(names, locale)),
      speciesCache: new CanvasSpeciesCache(),
    },
    savedObjectStamps: {
      saveCurrentSelection: (capture) => savedObjectStampWorkbench.saveSelection(capture),
    },
    ...DESKTOP_SITE_DATA_CAPABILITIES,
  })
}
