import {
  getSceneGroupedMemberKeys,
  normalizeSceneDesignObjectTargets,
  sceneTargetKey,
  type SceneDesignObjectSelection,
  type SceneDesignObjectTarget,
  type ScenePersistedState,
} from '../scene'
import type { SceneSelectionTarget } from './selection'

export function getSelectablePlantIdsForSpecies(
  scene: ScenePersistedState,
  canonicalName: string,
): string[] {
  if (!isPlantsLayerEditable(scene)) return []
  const groupedMemberKeys = getSceneGroupedMemberKeys(scene)

  return scene.plants
    .filter((plant) =>
      plant.canonicalName === canonicalName
      && !plant.locked
      && !groupedMemberKeys.has(sceneTargetKey({ kind: 'plant', id: plant.id })),
    )
    .map((plant) => plant.id)
}

export function applySpeciesSelection(
  currentSelection: SceneDesignObjectSelection,
  speciesPlantIds: readonly string[],
  additive: boolean,
): SceneDesignObjectTarget[] {
  const speciesTargets = speciesPlantIds.map((id): SceneDesignObjectTarget => ({ kind: 'plant', id }))
  if (!additive) return speciesTargets

  const next = new Map(currentSelection.map((target) => [sceneTargetKey(target), target]))
  const allSelected = speciesPlantIds.length > 0
    && speciesTargets.every((target) => next.has(sceneTargetKey(target)))
  for (const target of speciesTargets) {
    const key = sceneTargetKey(target)
    if (allSelected) next.delete(key)
    else next.set(key, target)
  }
  return normalizeSceneDesignObjectTargets(next.values())
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
