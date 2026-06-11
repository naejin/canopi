import type { ScenePersistedState } from '../scene'
import type { SceneSelectionTarget } from './selection'

export function getSelectablePlantIdsForSpecies(
  scene: ScenePersistedState,
  canonicalName: string,
): string[] {
  if (!isPlantsLayerEditable(scene)) return []
  const groupedMemberIds = new Set(scene.groups.flatMap((group) => group.memberIds))

  return scene.plants
    .filter((plant) =>
      plant.canonicalName === canonicalName
      && !plant.locked
      && !groupedMemberIds.has(plant.id),
    )
    .map((plant) => plant.id)
}

export function applySpeciesSelection(
  currentSelection: ReadonlySet<string>,
  speciesPlantIds: readonly string[],
  additive: boolean,
): Set<string> {
  if (!additive) return new Set(speciesPlantIds)

  const next = new Set(currentSelection)
  const allSelected = speciesPlantIds.length > 0
    && speciesPlantIds.every((id) => next.has(id))
  for (const id of speciesPlantIds) {
    if (allSelected) next.delete(id)
    else next.add(id)
  }
  return next
}

export function getSameSpeciesReferenceCanonicalName(
  scene: ScenePersistedState,
  targets: readonly SceneSelectionTarget[],
): string | null {
  if (targets.length === 0) return null
  const canonicalNames = new Set<string>()
  for (const target of targets) {
    if (target.kind !== 'plant') return null
    const plant = scene.plants.find((entry) => entry.id === target.id)
    if (!plant) return null
    canonicalNames.add(plant.canonicalName)
    if (canonicalNames.size > 1) return null
  }
  return [...canonicalNames][0] ?? null
}

function isPlantsLayerEditable(scene: ScenePersistedState): boolean {
  const layer = scene.layers.find((entry) => entry.name === 'plants')
  return layer?.visible !== false && layer?.locked !== true
}
