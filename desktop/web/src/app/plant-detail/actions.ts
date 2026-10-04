import { speciesCatalogWorkbench } from '../plant-browser'
import { selectPanel } from '../shell/state'

/** Opens a species' detail in the Plant catalog (the map's right-click Species details). */
export function openSpeciesDetail(canonicalName: string): void {
  selectPanel('plant-db')
  speciesCatalogWorkbench.selectSpecies(canonicalName)
}

export function resolvePlantDetailName(canonicalName: string): string {
  return speciesCatalogWorkbench.selectedCanonicalName.value ?? canonicalName
}

export function closePlantDetail(): void {
  speciesCatalogWorkbench.closeSpeciesDetail()
}

export function isPlantDetailFavorite(canonicalName: string): boolean {
  return speciesCatalogWorkbench.isFavorite(canonicalName)
}

export async function togglePlantDetailFavorite(canonicalName: string): Promise<void> {
  await speciesCatalogWorkbench.toggleFavorite(canonicalName)
}
