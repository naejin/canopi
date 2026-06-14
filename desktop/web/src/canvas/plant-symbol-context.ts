import type { PlantSymbolId } from './runtime/scene'

export interface SelectedPlantSymbolContext {
  plantIds: string[]
  singleSpeciesCanonicalName: string | null
  singleSpeciesCommonName: string | null
  sharedCurrentSymbol: PlantSymbolId | 'mixed' | null
  sharedEffectiveSymbol: PlantSymbolId | 'mixed'
  inheritedSymbol: PlantSymbolId | null
  canClearSelectedSymbol: boolean
}
