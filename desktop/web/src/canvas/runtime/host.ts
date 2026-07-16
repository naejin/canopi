import type { CanvasRuntimeHost, CanvasRuntimeSurfaces } from './runtime'
import { SceneCanvasRuntime } from './scene-runtime'
import { createCanvasRuntimeSurfaces } from './surfaces'

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
