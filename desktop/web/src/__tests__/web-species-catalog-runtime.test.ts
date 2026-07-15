import { describe, expect, it, vi } from 'vitest'
import { createBrowserSpeciesCatalogRuntime } from '../app/plant-browser/browser-runtime'
import { createBrowserAppDataStore, type BrowserStorageAdapter } from '../web/browser-app-data'

describe('Web Species Catalog runtime', () => {
  it('owns terminal Workbench and reader disposal behind one idempotent boundary', async () => {
    const disposeReader = vi.fn(async () => {})
    const reader = {
      searchSpecies: vi.fn(async () => ({ items: [], next_cursor: null, total_estimate: 0 })),
      listSpeciesByCanonicalNames: vi.fn(async () => []),
      getSupportedFilterFields: vi.fn(async () => []),
      getFilterOptions: vi.fn(async () => ({
        families: [],
        growth_rates: [],
        climate_zones: [],
        habits: [],
        life_cycles: [],
        sun_tolerances: [],
        soil_tolerances: [],
      })),
      getDynamicFilterOptions: vi.fn(async () => []),
      getSpeciesDetail: vi.fn(async () => null),
      dispose: disposeReader,
    }
    const runtime = createBrowserSpeciesCatalogRuntime({
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      reader,
    })
    const stop = runtime.workbench.mount()

    const firstDisposal = runtime.dispose()
    const secondDisposal = runtime.dispose()

    expect(secondDisposal).toBe(firstDisposal)
    await firstDisposal
    expect(disposeReader).toHaveBeenCalledOnce()
    reader.searchSpecies.mockClear()
    runtime.workbench.retrySearch()
    await Promise.resolve()
    expect(reader.searchSpecies).not.toHaveBeenCalled()
    stop()
  })
})

function memoryStorage(): BrowserStorageAdapter {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }
}
