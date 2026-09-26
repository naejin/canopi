import { useMemo } from 'preact/hooks'
import { currentCanvasQuerySurface, currentCanvasSelection } from '../../canvas/session'
import type { CanvasQuerySurface } from '../../canvas/runtime/runtime'

/** The species of the plants selected on the map: the "Selected on map" quick filter. */
export interface MapSelectionSpecies {
  readonly plantCount: number
  readonly plantCountBySpecies: ReadonlyMap<string, number>
}

const NO_SELECTION: MapSelectionSpecies = { plantCount: 0, plantCountBySpecies: new Map() }

/** Follows the canvas selection through read-only runtime queries. */
export function useMapSelectionSpecies(): MapSelectionSpecies {
  const queries = currentCanvasQuerySurface.value
  const selection = currentCanvasSelection.value
  const sceneRevision = queries?.revision.scene.value
  return useMemo(
    () => readMapSelectionSpecies(queries),
    [queries, selection, sceneRevision],
  )
}

export function readMapSelectionSpecies(queries: CanvasQuerySurface | null): MapSelectionSpecies {
  if (!queries) return NO_SELECTION
  const plantIds = new Set(queries.getSelectedPlantColorContext().plantIds)
  if (plantIds.size === 0) return NO_SELECTION
  const plantCountBySpecies = new Map<string, number>()
  let plantCount = 0
  // The same plant list the planning projections read, so counts agree across panels.
  for (const plant of queries.getPlacedPlants()) {
    if (!plantIds.has(plant.id)) continue
    plantCount += 1
    plantCountBySpecies.set(plant.canonical_name, (plantCountBySpecies.get(plant.canonical_name) ?? 0) + 1)
  }
  return plantCount === 0 ? NO_SELECTION : { plantCount, plantCountBySpecies }
}
