import { invoke } from '@tauri-apps/api/core';
import { plantDbStatus } from '../state/app';
import type {
  SpeciesListItem,
  SpeciesDetail,
  Relationship,
  SpeciesFilter,
  FilterOptions,
  PaginatedResult,
  Sort,
} from '../types/species';

/** Returns true when plant DB is not available — all queries should short-circuit. */
function isDegraded(): boolean {
  return plantDbStatus.value !== 'available';
}

export async function searchSpecies(
  text: string,
  filters: SpeciesFilter,
  cursor: string | null | undefined,
  limit = 50,
  sort: Sort = 'Name',
  locale = 'en',
): Promise<PaginatedResult<SpeciesListItem>> {
  if (isDegraded()) return { items: [], next_cursor: null, total_estimate: 0 };
  return invoke('search_species', {
    text,
    filters,
    cursor: cursor ?? null,
    limit,
    sort,
    locale,
  });
}

export async function getSpeciesDetail(
  canonicalName: string,
  locale = 'en',
): Promise<SpeciesDetail> {
  if (isDegraded()) throw new Error('Plant database unavailable');
  return invoke('get_species_detail', { canonicalName, locale });
}

export async function getSpeciesRelationships(
  canonicalName: string,
): Promise<Relationship[]> {
  if (isDegraded()) return [];
  return invoke('get_species_relationships', { canonicalName });
}

export async function getFilterOptions(): Promise<FilterOptions> {
  if (isDegraded()) return { families: [], growth_rates: [], strata: [], hardiness_range: [0, 0], life_cycles: [], sun_tolerances: [], soil_tolerances: [] };
  return invoke('get_filter_options');
}

/** Batch lookup: returns canonical_name → common_name map for the given locale. */
export async function getCommonNames(
  canonicalNames: string[],
  locale: string,
): Promise<Record<string, string>> {
  if (isDegraded()) return {};
  return invoke('get_common_names', { canonicalNames, locale });
}

/** Batch-fetch full detail records for multiple species. */
export async function getSpeciesBatch(
  canonicalNames: string[],
  locale: string,
): Promise<SpeciesDetail[]> {
  if (isDegraded()) return [];
  return invoke('get_species_batch', { canonicalNames, locale });
}
