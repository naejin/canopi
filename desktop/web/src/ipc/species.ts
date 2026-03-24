import { invoke } from '@tauri-apps/api/core';
import type {
  SpeciesListItem,
  SpeciesDetail,
  Relationship,
  SpeciesFilter,
  FilterOptions,
  PaginatedResult,
  Sort,
} from '../types/species';

export async function searchSpecies(
  text: string,
  filters: SpeciesFilter,
  cursor: string | null | undefined,
  limit = 50,
  sort: Sort = 'Name',
  locale = 'en',
): Promise<PaginatedResult<SpeciesListItem>> {
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
  return invoke('get_species_detail', { canonicalName, locale });
}

export async function getSpeciesRelationships(
  canonicalName: string,
): Promise<Relationship[]> {
  return invoke('get_species_relationships', { canonicalName });
}

export async function getFilterOptions(): Promise<FilterOptions> {
  return invoke('get_filter_options');
}

/** Batch lookup: returns canonical_name → common_name map for the given locale. */
export async function getCommonNames(
  canonicalNames: string[],
  locale: string,
): Promise<Record<string, string>> {
  return invoke('get_common_names', { canonicalNames, locale });
}
