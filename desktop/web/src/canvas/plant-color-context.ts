export interface SelectedPlantColorContext {
  plantIds: string[]
  singleSpeciesCanonicalName: string | null
  singleSpeciesCommonName: string | null
  sharedCurrentColor: string | null
  suggestedColor: string | null
  singleSpeciesDefaultColor: string | null
}
