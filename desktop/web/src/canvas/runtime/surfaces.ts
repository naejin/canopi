import type { CanvasRuntimeSurfaces } from './runtime'
import type { SceneCanvasRuntime } from './scene-runtime'

export function createCanvasRuntimeSurfaces(runtime: SceneCanvasRuntime): CanvasRuntimeSurfaces {
  return {
    commands: runtime.commandSurface,
    queries: runtime.querySurface,
    documents: runtime.documentSurface,
  }
}
