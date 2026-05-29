import { groupPlantsBySpecies } from '../../canvas/plant-grouping'
import { DEFAULT_PLANT_COLOR } from '../../canvas/plant-colors'
import { getStratumColor } from '../../canvas/plants'
import { getConsortiumCanonicalName } from '../../target'
import type { Consortium, PlacedPlant } from '../../types/design'

export interface ConsortiumPlanningBar {
  canonicalName: string
  stratum: string
  startPhase: number
  endPhase: number
  subLane: number
  totalSubLanes: number
  color: string
  commonName: string
  count: number
}

export interface ConsortiumPlanningProjection {
  readonly bars: readonly ConsortiumPlanningBar[]
  readonly activeEntries: readonly Consortium[]
}

export interface BuildConsortiumPlanningProjectionOptions {
  readonly consortiums: readonly Consortium[]
  readonly plants: readonly PlacedPlant[]
  readonly speciesColors: Record<string, string>
  readonly localizedNames?: ReadonlyMap<string, string | null>
}

export function buildConsortiumPlanningProjection({
  consortiums,
  plants,
  speciesColors,
  localizedNames,
}: BuildConsortiumPlanningProjectionOptions): ConsortiumPlanningProjection {
  const activeEntries = filterActiveConsortiumEntries(consortiums, plants)
  return {
    activeEntries,
    bars: buildConsortiumBars(activeEntries, plants, speciesColors, localizedNames),
  }
}

export function buildConsortiumBars(
  entries: readonly Consortium[],
  plants: readonly PlacedPlant[],
  speciesColors: Record<string, string>,
  localizedNames?: ReadonlyMap<string, string | null>,
): ConsortiumPlanningBar[] {
  const plantCounts = groupPlantsBySpecies(plants, localizedNames)

  const bars: ConsortiumPlanningBar[] = entries.map((entry) => {
    const canonicalName = getConsortiumCanonicalName(entry)
    const plantInfo = plantCounts.get(canonicalName)
    return {
      canonicalName,
      stratum: entry.stratum,
      startPhase: entry.start_phase,
      endPhase: entry.end_phase,
      subLane: 0,
      totalSubLanes: 1,
      color: speciesColors[canonicalName] ?? getStratumColor(entry.stratum) ?? DEFAULT_PLANT_COLOR,
      commonName: plantInfo?.commonName ?? canonicalName,
      count: plantInfo?.count ?? 0,
    }
  })

  const byStratum = new Map<string, ConsortiumPlanningBar[]>()
  for (const bar of bars) {
    const group = byStratum.get(bar.stratum)
    if (group) group.push(bar)
    else byStratum.set(bar.stratum, [bar])
  }

  // Sub-lane order follows array position (user-reorderable, no auto-sort).
  for (const group of byStratum.values()) {
    for (let i = 0; i < group.length; i++) {
      group[i]!.subLane = i
      group[i]!.totalSubLanes = group.length
    }
  }

  return bars
}

export function filterActiveConsortiumEntries(
  entries: readonly Consortium[],
  plants: readonly PlacedPlant[],
): Consortium[] {
  const activeSpecies = new Set(plants.map((plant) => plant.canonical_name))
  return entries.filter((entry) => activeSpecies.has(getConsortiumCanonicalName(entry)))
}
