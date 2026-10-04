import { invoke } from '@tauri-apps/api/core';
import type {
  SpeciesListItem,
  SpeciesDetail,
  SpeciesSearchRequest,
  FilterOptions,
  PaginatedResult,
  DynamicFilterOptions,
  CommonNameEntry,
  SpeciesImage,
  FlowerColorResolution,
} from '../types/species';

// Plain transport: the plant DB health gate lives in app/plant-browser/live.desktop.ts.

export async function searchSpecies(
  request: SpeciesSearchRequest,
): Promise<PaginatedResult<SpeciesListItem>> {
  return invoke('search_species', { request });
}

export async function supersedeSpeciesSearch(): Promise<void> {
  return invoke('supersede_species_search');
}

export async function getSpeciesDetail(
  canonicalName: string,
  locale = 'en',
): Promise<SpeciesDetail> {
  return invoke('get_species_detail', { canonicalName, locale });
}

export async function getFilterOptions(): Promise<FilterOptions> {
  return invoke('get_filter_options');
}

export async function getDynamicFilterOptions(
  fields: string[],
  locale: string,
): Promise<DynamicFilterOptions[]> {
  return invoke('get_dynamic_filter_options', { fields, locale });
}

/** Batch lookup: returns canonical_name → common_name map for the given locale. */
export async function getCommonNames(
  canonicalNames: string[],
  locale: string,
): Promise<Record<string, string>> {
  return invoke('get_common_names', { canonicalNames, locale });
}

/** Batch lookup: returns canonical_name → catalog habit (`Tree`, `Shrub`, ...) where the catalog has one. */
export async function getSpeciesHabits(canonicalNames: string[]): Promise<Record<string, string>> {
  return invoke('get_species_habits', { canonicalNames });
}

/** Batch-fetch full detail records for multiple species. */
export async function getSpeciesBatch(
  canonicalNames: string[],
  locale: string,
): Promise<SpeciesDetail[]> {
  return invoke('get_species_batch', { canonicalNames, locale });
}

export async function getFlowerColorBatch(
  canonicalNames: string[],
): Promise<FlowerColorResolution[]> {
  return invoke('get_flower_color_batch', { canonicalNames });
}

/** Returns all common names for a species in the given locale. */
export async function getLocaleCommonNames(
  canonicalName: string,
  locale: string,
): Promise<CommonNameEntry[]> {
  return invoke('get_locale_common_names', { canonicalName, locale });
}

/** Returns images for a species by canonical name. */
export async function getSpeciesImages(
  canonicalName: string,
): Promise<SpeciesImage[]> {
  return invoke('get_species_images', { canonicalName });
}

/** Ensures an image is cached locally and returns the cache file path. */
export async function getCachedImagePath(url: string): Promise<string> {
  return invoke('get_cached_image_path', { url });
}
