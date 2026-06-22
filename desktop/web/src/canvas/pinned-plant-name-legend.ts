import { DEFAULT_PLANT_COLOR, normalizeHexColor } from './plant-colors'
import { resolvePlantSymbolForPlant, type PlantSymbolId, type ScenePersistedState } from './runtime/scene'
import { getStratumColor } from './plants'

export interface PinnedPlantNameLegendEntry {
  readonly label: string
  readonly color: string
  readonly symbol: PlantSymbolId
  readonly count: number
}

export interface PinnedPlantNameLegendSource {
  getSceneSnapshot(): ScenePersistedState
  getLocalizedCommonNames(): ReadonlyMap<string, string | null>
}

export function buildPinnedPlantNameLegendEntries(
  source: PinnedPlantNameLegendSource,
): PinnedPlantNameLegendEntry[] {
  const scene = source.getSceneSnapshot()
  const plantLayer = scene.layers.find((layer) => layer.name === 'plants')
  if (plantLayer && !plantLayer.visible) return []

  const localizedNames = source.getLocalizedCommonNames()
  const groups = new Map<string, PinnedPlantNameLegendEntry>()

  for (const plant of scene.plants) {
    if (plant.pinnedName !== true) continue

    const label = localizedNames.get(plant.canonicalName) ?? plant.commonName ?? plant.canonicalName
    const color = normalizeHexColor(plant.color) ?? getStratumColor(plant.stratum) ?? DEFAULT_PLANT_COLOR
    const symbol = resolvePlantSymbolForPlant(plant, scene.plantSpeciesSymbols)
    const key = `${label}\u0000${symbol}\u0000${color}`
    const existing = groups.get(key)

    if (existing) {
      groups.set(key, { ...existing, count: existing.count + 1 })
      continue
    }

    groups.set(key, { label, color, symbol, count: 1 })
  }

  return [...groups.values()].sort(comparePinnedPlantNameLegendEntries)
}

function comparePinnedPlantNameLegendEntries(
  left: PinnedPlantNameLegendEntry,
  right: PinnedPlantNameLegendEntry,
): number {
  return (
    left.label.localeCompare(right.label)
    || left.symbol.localeCompare(right.symbol)
    || left.color.localeCompare(right.color)
  )
}
