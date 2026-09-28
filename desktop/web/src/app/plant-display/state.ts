import { computed } from '@preact/signals'
import {
  PLANT_DISPLAY_STRATA,
  normalizePlantDisplay,
  resolveDisplayedPlantColor,
  type PlantDisplay,
  type PlantDisplayStratum,
} from '../../canvas/runtime/plant-display'
import { getConsortiumCanonicalName } from '../../target'
import type { CanopiFile } from '../../types/design'
import { readPlantDisplayOptions } from '../design-edit/plant-display'
import { currentDesign } from '../document-session/store'

/**
 * The Design's stratum per species, as Consortium assigns it. Colour by
 * stratum reads this, never the catalog: a species the Design has not placed
 * in a stratum is "No stratum yet".
 */
export function designStrata(design: Pick<CanopiFile, 'consortiums'> | null): ReadonlyMap<string, PlantDisplayStratum> {
  const strata = new Map<string, PlantDisplayStratum>()
  for (const consortium of design?.consortiums ?? []) {
    const stratum = consortium.stratum as PlantDisplayStratum
    if (PLANT_DISPLAY_STRATA.includes(stratum)) strata.set(getConsortiumCanonicalName(consortium), stratum)
  }
  return strata
}

function plantDisplayOf(design: CanopiFile | null): PlantDisplay {
  return normalizePlantDisplay({ ...readPlantDisplayOptions(design), strata: designStrata(design) })
}

/** Display on the map for the open Design: its options and its Consortium strata. */
export const currentPlantDisplay = computed(() => plantDisplayOf(currentDesign.value))

/** The colour a species or plant shows on the map under the current display. */
export function displayedPlantColor(storedColor: string, canonicalName: string): string {
  return resolveDisplayedPlantColor(storedColor, canonicalName, currentPlantDisplay.value)
}
