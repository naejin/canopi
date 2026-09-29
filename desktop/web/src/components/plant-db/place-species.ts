import { focusMapSurface } from '../../app/shell/focus-regions'
import {
  beginPlantStampFromSpecies,
  type PlantStampSourceInput,
} from '../../canvas/plant-stamp-source'
import type { CanvasToolCommandSurface } from '../../canvas/runtime/runtime'

/**
 * A panel's Place button: arms Place plants with the species, then hands
 * focus to the map so the next click places and Esc cancels. Without a canvas
 * nothing is armed, so focus stays on the button.
 */
export function placeSpeciesOnMap(
  source: PlantStampSourceInput,
  commandSurface: Pick<CanvasToolCommandSurface, 'setTool'> | null | undefined,
): void {
  beginPlantStampFromSpecies(source, commandSurface)
  if (commandSurface) focusMapSurface()
}
