import type { CanvasQuerySurface } from './runtime'
import type { SceneCanvasRuntime } from './scene-runtime'

export function createSceneCanvasQuerySurface(runtime: SceneCanvasRuntime): CanvasQuerySurface {
  return new SceneCanvasQueryRole(runtime)
}

class SceneCanvasQueryRole implements CanvasQuerySurface {
  constructor(private readonly runtime: SceneCanvasRuntime) {}

  get revision() { return this.runtime.revision }
  getSceneSnapshot() { return this.runtime.getSceneSnapshot() }
  getViewport() { return this.runtime.getViewport() }
  getViewportScreenSize() { return this.runtime.getViewportScreenSize() }
  get viewportRevision() { return this.runtime.viewportRevision }
  getSelection() { return this.runtime.getSelection() }
  getPlantSizeMode() { return this.runtime.getPlantSizeMode() }
  getPlantColorByAttr() { return this.runtime.getPlantColorByAttr() }
  getSelectedPlantColorContext() { return this.runtime.getSelectedPlantColorContext() }
  getPlacedPlants() { return this.runtime.getPlacedPlants() }
  getLocalizedCommonNames() { return this.runtime.getLocalizedCommonNames() }
}
