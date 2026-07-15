import { getFavorites, getRecentlyViewed, toggleFavorite } from '../../ipc/favorites'
import {
  getDynamicFilterOptions,
  getFilterOptions,
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
})

export const speciesCatalogWorkbench: SpeciesCatalogWorkbench = liveSpeciesCatalogWorkbench

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    liveSpeciesCatalogWorkbench.dispose()
  })
}
