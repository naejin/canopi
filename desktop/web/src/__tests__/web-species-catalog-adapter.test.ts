import { describe, expect, it } from 'vitest'
import { createEmptySpeciesFilter, createSpeciesCatalogWorkbench } from '../app/plant-browser'
import { createBrowserAppDataStore, type BrowserStorageAdapter } from '../web/browser-app-data'
import {
  createInMemoryReducedSpeciesCatalogReader,
  createReducedSpeciesCatalogAdapters,
  type ReducedSpeciesCatalogData,
} from '../web/reduced-species-catalog'
import type { SpeciesSearchRequest } from '../types/species'

describe('Web Edition reduced Species Catalog adapter', () => {
  it('browses pages and searches canonical or localized common names', async () => {
    const adapters = createReducedSpeciesCatalogAdapters({
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      reader: createInMemoryReducedSpeciesCatalogReader(catalogFixture()),
    })

    const firstPage = await adapters.search(searchRequest({
      limit: 1,
      locale: 'fr',
      include_total: true,
    }))

    expect(firstPage.items.map((item) => item.canonical_name)).toEqual(['Malus domestica'])
    expect(firstPage.items[0]?.common_name).toBe('Pommier')
    expect(firstPage.next_cursor).toBe('offset:1')
    expect(firstPage.total_estimate).toBe(3)

    const nextPage = await adapters.search(searchRequest({
      cursor: firstPage.next_cursor,
      limit: 2,
      locale: 'fr',
    }))

    expect(nextPage.items.map((item) => item.canonical_name)).toEqual([
      'Melissa officinalis',
      'Prunus persica',
    ])
    expect(nextPage.next_cursor).toBeNull()

    const canonicalMatch = await adapters.search(searchRequest({
      text: 'melissa',
      locale: 'fr',
    }))

    expect(canonicalMatch.items.map((item) => item.canonical_name)).toEqual(['Melissa officinalis'])

    const localizedMatch = await adapters.search(searchRequest({
      text: 'peche',
      locale: 'fr',
    }))

    expect(localizedMatch.items.map((item) => item.canonical_name)).toEqual(['Prunus persica'])
    expect(localizedMatch.items[0]).toMatchObject({
      common_name: 'Pecher',
      matched_common_name: 'Pecher',
      height_max_m: null,
      hardiness_zone_min: null,
      hardiness_zone_max: null,
      stratum: null,
      edibility_rating: null,
    })
  })

  it('filters v1 fields and stores favorites or recently viewed Species in browser app data', async () => {
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const adapters = createReducedSpeciesCatalogAdapters({
      appDataStore,
      reader: createInMemoryReducedSpeciesCatalogReader(catalogFixture()),
    })

    const filterOptions = await adapters.getFilterOptions()

    expect(filterOptions).toMatchObject({
      climate_zones: ['Mediterranean', 'Temperate'],
      habits: ['Forb', 'Herbaceous', 'Tree'],
      life_cycles: ['Perennial'],
      sun_tolerances: [],
      soil_tolerances: [],
      growth_rates: [],
    })

    const mediterranean = await adapters.search(searchRequest({
      filters: {
        ...createEmptySpeciesFilter(),
        climate_zones: ['Mediterranean'],
      },
      locale: 'fr',
    }))

    expect(mediterranean.items.map((item) => item.canonical_name)).toEqual(['Prunus persica'])

    const growthForm = await adapters.search(searchRequest({
      filters: {
        ...createEmptySpeciesFilter(),
        habit: ['Forb'],
      },
      locale: 'fr',
    }))

    expect(growthForm.items.map((item) => item.canonical_name)).toEqual(['Melissa officinalis'])

    await expect(adapters.toggleFavorite('Prunus persica')).resolves.toBe(true)
    await adapters.recordRecentlyViewed('Melissa officinalis')
    await adapters.recordRecentlyViewed('Prunus persica')

    const favorites = await adapters.getFavorites('fr')
    const recent = await adapters.getRecentlyViewed('fr', 1)

    expect(favorites).toEqual([
      expect.objectContaining({
        canonical_name: 'Prunus persica',
        common_name: 'Pecher',
        is_favorite: true,
      }),
    ])
    expect(recent.map((item) => item.canonical_name)).toEqual(['Prunus persica'])
    expect(recent[0]?.is_favorite).toBe(true)

    await expect(adapters.toggleFavorite('Prunus persica')).resolves.toBe(false)
    await expect(adapters.getFavorites('fr')).resolves.toEqual([])
  })

  it('lets the Species Catalog Workbench adapter record recently viewed Species on selection', () => {
    const selected: string[] = []
    const workbench = createSpeciesCatalogWorkbench({
      search: async () => ({ items: [], next_cursor: null, total_estimate: 0 }),
      loadDynamicFilterOptions: async () => [],
      getFilterOptions: async () => null,
      getFavorites: async () => [],
      getRecentlyViewed: async () => [],
      toggleFavorite: async () => false,
      onSpeciesSelected: (canonicalName) => {
        selected.push(canonicalName)
      },
    })

    workbench.selectSpecies('Malus domestica')

    expect(selected).toEqual(['Malus domestica'])
  })
})

function searchRequest(overrides: Partial<SpeciesSearchRequest> = {}): SpeciesSearchRequest {
  return {
    text: '',
    filters: createEmptySpeciesFilter(),
    cursor: null,
    limit: 50,
    sort: 'Name',
    locale: 'en',
    include_total: false,
    ...overrides,
  }
}

function catalogFixture(): ReducedSpeciesCatalogData {
  return {
    species: [
      {
        id: 'species-apple',
        slug: 'malus-domestica',
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        climate_zones: ['Temperate'],
        habit: 'Tree',
        growth_form: 'Tree',
        life_cycles: ['Perennial'],
      },
      {
        id: 'species-balm',
        slug: 'melissa-officinalis',
        canonical_name: 'Melissa officinalis',
        common_name: 'Lemon balm',
        climate_zones: ['Temperate'],
        habit: 'Herbaceous',
        growth_form: 'Forb',
        life_cycles: ['Perennial'],
      },
      {
        id: 'species-peach',
        slug: 'prunus-persica',
        canonical_name: 'Prunus persica',
        common_name: 'Peach',
        climate_zones: ['Mediterranean', 'Temperate'],
        habit: 'Tree',
        growth_form: 'Tree',
        life_cycles: ['Perennial'],
      },
    ],
    names: [
      {
        species_id: 'species-apple',
        language: 'fr',
        common_name: 'Pommier',
        normalized_name: 'pommier',
        is_primary: true,
      },
      {
        species_id: 'species-balm',
        language: 'fr',
        common_name: 'Melisse',
        normalized_name: 'melisse',
        is_primary: true,
      },
      {
        species_id: 'species-peach',
        language: 'fr',
        common_name: 'Pecher',
        normalized_name: 'pecher',
        is_primary: true,
      },
    ],
    images: [],
  }
}

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
