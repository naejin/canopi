import { computed } from '@preact/signals'
import { normalizePlantDisplay, type PlantDisplay } from '../../canvas/runtime/plant-display'
import type { CanopiFile } from '../../types/design'
import { readPlantDisplayOptions } from '../design-edit/plant-display'
import { currentDesign } from '../document-session/store'

export function plantDisplayOf(design: CanopiFile | null): PlantDisplay {
  return normalizePlantDisplay(readPlantDisplayOptions(design))
}

/** Display on the map for the open Design. */
export const currentPlantDisplay = computed(() => plantDisplayOf(currentDesign.value))
