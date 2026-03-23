import { invoke } from '@tauri-apps/api/core';
import type { SpeciesListItem } from '../types/species';

export async function toggleFavorite(canonicalName: string): Promise<boolean> {
  return invoke('toggle_favorite', { canonicalName });
}

export async function getFavorites(locale: string): Promise<SpeciesListItem[]> {
  return invoke('get_favorites', { locale });
}

export async function getRecentlyViewed(
  locale: string,
  limit = 50,
): Promise<SpeciesListItem[]> {
  return invoke('get_recently_viewed', { locale, limit });
}
