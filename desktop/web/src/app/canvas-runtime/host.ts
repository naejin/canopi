import type { CanvasRuntimeHost, CanvasRuntimeSurfaces } from '../../canvas/runtime/runtime'
import { SceneCanvasRuntime } from '../../canvas/runtime/scene-runtime'
import { createCanvasRuntimeSurfaces } from '../../canvas/runtime/surfaces'
import { createAppSceneRuntimePanelTargetAdapter } from './panel-target-adapter'

export function createAppCanvasRuntimeHost(): CanvasRuntimeHost {
  return createSceneCanvasRuntimeHost(new SceneCanvasRuntime({
    targetPresentation: createAppSceneRuntimePanelTargetAdapter(),
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
