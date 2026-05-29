import { speciesCatalogWorkbench } from '../plant-browser'

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
