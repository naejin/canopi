import { getFavorites, getRecentlyViewed, toggleFavorite } from '../../ipc/favorites'
import {
  getCommonNames,
  getDynamicFilterOptions,
  getFilterOptions,
  getSpeciesHabits,
  searchSpecies,
  supersedeSpeciesSearch,
} from '../../ipc/species'
import { plantDbUnavailableMessage } from '../../ipc/plant-db-errors'
import { plantDbStatus } from '../health/state'
import {
  createSpeciesCatalogWorkbench,
  type SpeciesCatalogWorkbench,
} from './workbench'

/**
 * The plant DB health gate. With the bundled DB missing or corrupt no catalog
 * query crosses IPC: a search fails with the reason the panel shows, a lookup
 * answers empty. The transport (`ipc/species.ts`) knows nothing of app state.
 */
function whenPlantDbAvailable<T>(fallback: () => Promise<T>, query: () => Promise<T>): Promise<T> {
  return plantDbStatus.value === 'available' ? query() : fallback()
}
const empty = <T>(value: T) => () => Promise.resolve(value)
const unavailable = () => Promise.reject(new Error(plantDbUnavailableMessage(plantDbStatus.value)))

const liveSpeciesCatalogWorkbench = createSpeciesCatalogWorkbench({
  search: (request) => whenPlantDbAvailable(unavailable, () => searchSpecies(request)),
  supersedeSearch: supersedeSpeciesSearch,
  loadDynamicFilterOptions: (fields, locale) => whenPlantDbAvailable(empty([]), () => getDynamicFilterOptions(fields, locale)),
  getFilterOptions: () => whenPlantDbAvailable(empty(null), getFilterOptions),
  getFavorites,
  getRecentlyViewed,
  toggleFavorite,
  resolveCommonNames: (canonicalNames, locale) =>
    whenPlantDbAvailable(empty({}), () => inBatches(canonicalNames, (batch) => getCommonNames(batch, locale))),
  resolveHabits: (canonicalNames) => whenPlantDbAvailable(empty({}), () => inBatches(canonicalNames, getSpeciesHabits)),
})

// get_common_names and get_species_habits take at most 500 names per call.
const NAME_BATCH = 500

async function inBatches(
  canonicalNames: readonly string[],
  lookup: (batch: string[]) => Promise<Record<string, string>>,
): Promise<Record<string, string>> {
  const batches: string[][] = []
  for (let start = 0; start < canonicalNames.length; start += NAME_BATCH) {
    batches.push(canonicalNames.slice(start, start + NAME_BATCH))
  }
  return Object.assign({}, ...await Promise.all(batches.map(lookup)))
}

export const speciesCatalogWorkbench: SpeciesCatalogWorkbench = liveSpeciesCatalogWorkbench

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    liveSpeciesCatalogWorkbench.dispose()
  })
}
