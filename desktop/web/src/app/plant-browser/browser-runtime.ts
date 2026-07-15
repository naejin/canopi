import { createDuckDbReducedSpeciesCatalogReader } from '../../web/duckdb-wasm-catalog'
import {
  createReducedSpeciesCatalogAdapters,
  type ReducedSpeciesCatalogReader,
} from '../../web/reduced-species-catalog'
import {
  browserAppDataStore,
  type BrowserAppDataStore,
} from '../../web/browser-app-data'
import {
  createSpeciesCatalogWorkbench,
  type SpeciesCatalogWorkbench,
} from './workbench'

interface OwnedReducedSpeciesCatalogReader extends ReducedSpeciesCatalogReader {
  dispose(): Promise<void>
}

interface BrowserSpeciesCatalogRuntimeOptions {
  readonly appDataStore?: BrowserAppDataStore
  readonly reader?: OwnedReducedSpeciesCatalogReader
}

export interface BrowserSpeciesCatalogRuntime {
  readonly workbench: SpeciesCatalogWorkbench
  dispose(): Promise<void>
}

export function createBrowserSpeciesCatalogRuntime({
  appDataStore = browserAppDataStore,
  reader = createDuckDbReducedSpeciesCatalogReader(),
}: BrowserSpeciesCatalogRuntimeOptions = {}): BrowserSpeciesCatalogRuntime {
  const catalogAdapters = createReducedSpeciesCatalogAdapters({
    appDataStore,
    reader,
  })
  const workbench = createSpeciesCatalogWorkbench({
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
  let disposePromise: Promise<void> | null = null

  return {
    workbench,
    dispose(): Promise<void> {
      if (disposePromise) return disposePromise
      disposePromise = (async () => {
        workbench.dispose()
        await reader.dispose()
      })()
      return disposePromise
    },
  }
}
