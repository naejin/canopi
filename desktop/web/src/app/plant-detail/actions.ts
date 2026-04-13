import {
  favoriteNames,
  selectedCanonicalName,
  toggleFavoriteAction,
} from '../plant-browser'

export function resolvePlantDetailName(canonicalName: string): string {
  return selectedCanonicalName.value ?? canonicalName
}

export function closePlantDetail(): void {
  selectedCanonicalName.value = null
}

export function isPlantDetailFavorite(canonicalName: string): boolean {
  return favoriteNames.value.includes(canonicalName)
}

export async function togglePlantDetailFavorite(canonicalName: string): Promise<void> {
  await toggleFavoriteAction(canonicalName)
}
