import type { CanvasRuntimeHost, CanvasRuntimeSurfaces } from '../../canvas/runtime/runtime'
import { SceneCanvasRuntime } from '../../canvas/runtime/scene-runtime'
import { createCanvasRuntimeSurfaces } from '../../canvas/runtime/surfaces'
import { CanvasPlantLabelResolver } from '../../canvas/runtime/plant-labels'
import { CanvasSpeciesCache } from '../../canvas/runtime/species-cache'
import { createAppCanvasRuntimeAppAdapter } from './app-adapter'
import { createAppSceneRuntimePanelTargetAdapter } from './panel-target-adapter'

export function createAppCanvasRuntimeHost(): CanvasRuntimeHost {
  return createSceneCanvasRuntimeHost(new SceneCanvasRuntime({
    appAdapter: createAppCanvasRuntimeAppAdapter(),
    targetPresentation: createAppSceneRuntimePanelTargetAdapter(),
    plantLabels: new CanvasPlantLabelResolver(),
    speciesCache: new CanvasSpeciesCache(),
  }))
}

export function createSceneCanvasRuntimeHost(runtime: SceneCanvasRuntime): CanvasRuntimeHost {
  return new SceneCanvasRuntimeHost(runtime, createCanvasRuntimeSurfaces(runtime))
}

class SceneCanvasRuntimeHost implements CanvasRuntimeHost {
  constructor(
    private readonly runtime: SceneCanvasRuntime,
    readonly surfaces: CanvasRuntimeSurfaces,
  ) {}

  init(container: HTMLElement): Promise<void> {
    return this.runtime.init(container)
  }

  destroy(): void {
    this.runtime.destroy()
  }
}
