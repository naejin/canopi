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
  resolveCommonNames(names: readonly string[], locale: string): Promise<Record<string, string>>
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
    favoritesIncludeRecentlyViewed: true,
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
    async resolveCommonNames(names, locale) {
      const rows = await reader.listSpeciesByCanonicalNames(names, locale, new Set())
      return Object.fromEntries(rows.filter((row) => row.common_name?.trim()).map((row) => [row.canonical_name, row.common_name!]))
    },
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
