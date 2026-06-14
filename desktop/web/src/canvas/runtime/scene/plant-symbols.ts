import {
  DEFAULT_PLANT_SYMBOL_ID,
  PLANT_SYMBOL_IDS,
  type PlantSymbolId,
} from '../../../generated/known-canopi-keys'

export { DEFAULT_PLANT_SYMBOL_ID, PLANT_SYMBOL_IDS, type PlantSymbolId }

const PLANT_SYMBOL_ID_SET: ReadonlySet<string> = new Set(PLANT_SYMBOL_IDS)

export function resolvePlantSymbolId(symbol: string | null | undefined): PlantSymbolId {
  return symbol !== null && symbol !== undefined && PLANT_SYMBOL_ID_SET.has(symbol)
    ? (symbol as PlantSymbolId)
    : DEFAULT_PLANT_SYMBOL_ID
}

export function resolvePlantSymbolForPlant(
  plant: { canonicalName: string; symbol: string | null | undefined },
  plantSpeciesSymbols: Readonly<Record<string, string>>,
): PlantSymbolId {
  return resolvePlantSymbolId(plant.symbol ?? plantSpeciesSymbols[plant.canonicalName])
}
