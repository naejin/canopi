import { getFavorites, getRecentlyViewed, toggleFavorite } from '../../ipc/favorites'
import {
  getCommonNames,
  getDynamicFilterOptions,
  getFilterOptions,
  getSpeciesHabits,
  searchSpecies,
  supersedeSpeciesSearch,
} from '../../ipc/species'
import {
  createSpeciesCatalogWorkbench,
  type SpeciesCatalogWorkbench,
} from './workbench'

const liveSpeciesCatalogWorkbench = createSpeciesCatalogWorkbench({
  search: searchSpecies,
  supersedeSearch: supersedeSpeciesSearch,
  loadDynamicFilterOptions: getDynamicFilterOptions,
  getFilterOptions,
  getFavorites,
  getRecentlyViewed,
  toggleFavorite,
  resolveCommonNames: (canonicalNames, locale) => inBatches(canonicalNames, (batch) => getCommonNames(batch, locale)),
  resolveHabits: (canonicalNames) => inBatches(canonicalNames, getSpeciesHabits),
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
