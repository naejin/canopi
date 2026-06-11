import type { ScenePersistedState } from '../scene'

export type SceneCreationLayerName = 'plants' | 'zones' | 'annotations'

export function isSceneLayerOpenForCreation(
  scene: ScenePersistedState,
  layerName: SceneCreationLayerName,
): boolean {
  const layer = scene.layers.find((entry) => entry.name === layerName)
  return layer?.visible !== false && layer?.locked !== true
}
