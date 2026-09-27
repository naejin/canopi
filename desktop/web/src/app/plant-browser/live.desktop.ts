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
  resolveCommonNames: (canonicalNames, locale) => getCommonNames([...canonicalNames], locale),
  resolveHabits: resolveDesktopHabits,
})

// get_species_habits takes at most 500 names per call.
const HABIT_BATCH = 500

async function resolveDesktopHabits(canonicalNames: readonly string[]): Promise<Record<string, string>> {
  const batches: string[][] = []
  for (let start = 0; start < canonicalNames.length; start += HABIT_BATCH) {
    batches.push(canonicalNames.slice(start, start + HABIT_BATCH))
  }
  return Object.assign({}, ...await Promise.all(batches.map((batch) => getSpeciesHabits(batch))))
}

export const speciesCatalogWorkbench: SpeciesCatalogWorkbench = liveSpeciesCatalogWorkbench

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    liveSpeciesCatalogWorkbench.dispose()
  })
}
