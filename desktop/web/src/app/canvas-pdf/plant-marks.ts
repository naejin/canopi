import type { PrintPlant } from '../../canvas/print'
import { nearestPlantSpacing } from '../../canvas/plant-spacing'
import { MM, PRINT } from './print-style'

/** Physical visibility floor; legend samples retain the nominal symbol size. */
export function paperPlantRadius(plants: readonly PrintPlant[], plant: PrintPlant, scale: number): number {
  return Math.max(.35 * MM, Math.min(PRINT.marker, nearestPlantSpacing(plants, plant.position) * scale * .42))
}
