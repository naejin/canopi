import type {
  SpeciesCatalogWorkbench,
  SpeciesCatalogWorkbenchOptions,
} from '../../app/plant-browser/workbench'
import type { PaginatedResult, SpeciesListItem } from '../../types/species'

export function makeSpeciesListItem(canonicalName: string, isFavorite = false): SpeciesListItem {
  return {
    canonical_name: canonicalName,
    slug: canonicalName.toLowerCase().replace(/\s+/g, '-'),
    common_name: canonicalName,
    common_name_2: null,
    is_name_fallback: false,
    family: null,
    genus: null,
    height_max_m: null,
    hardiness_zone_min: null,
    hardiness_zone_max: null,
    growth_rate: null,
    stratum: null,
    edibility_rating: null,
    medicinal_rating: null,
    width_max_m: null,
    is_favorite: isFavorite,
  }
}

export function emptySpeciesSearchResult(): PaginatedResult<SpeciesListItem> {
  return {
    items: [],
    next_cursor: null,
    total_estimate: 0,
  }
}

export async function createTestSpeciesCatalogWorkbench(
  options: SpeciesCatalogWorkbenchOptions = {},
): Promise<SpeciesCatalogWorkbench> {
  const { createSpeciesCatalogWorkbench } = await import('../../app/plant-browser/workbench')
  return createSpeciesCatalogWorkbench({
    search: async () => emptySpeciesSearchResult(),
    loadDynamicFilterOptions: async () => [],
    getFilterOptions: async () => null,
    getFavorites: async () => [],
    getRecentlyViewed: async () => [],
    toggleFavorite: async () => false,
    textDebounceMs: 0,
    ...options,
  })
}
