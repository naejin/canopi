import { browserAppDataStore } from '../../web/browser-app-data'
import { createDuckDbReducedSpeciesCatalogReader } from '../../web/duckdb-wasm-catalog'
import { createReducedSpeciesCatalogAdapters } from '../../web/reduced-species-catalog'
import {
  createSpeciesCatalogWorkbench,
  type SpeciesCatalogWorkbench,
} from './workbench'

const catalogAdapters = createReducedSpeciesCatalogAdapters({
  appDataStore: browserAppDataStore,
  reader: createDuckDbReducedSpeciesCatalogReader(),
})

const liveSpeciesCatalogWorkbench = createSpeciesCatalogWorkbench({
  search: catalogAdapters.search,
  loadDynamicFilterOptions: catalogAdapters.loadDynamicFilterOptions,
  getFilterOptions: catalogAdapters.getFilterOptions,
  getSupportedFilterFields: catalogAdapters.getSupportedFilterFields,
  getFavorites: catalogAdapters.getFavorites,
  getRecentlyViewed: catalogAdapters.getRecentlyViewed,
  getSpeciesDetail: catalogAdapters.getSpeciesDetail,
  toggleFavorite: catalogAdapters.toggleFavorite,
  onSpeciesSelected: catalogAdapters.recordRecentlyViewed,
})

export const speciesCatalogWorkbench: SpeciesCatalogWorkbench = liveSpeciesCatalogWorkbench

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    liveSpeciesCatalogWorkbench.dispose()
  })
}
