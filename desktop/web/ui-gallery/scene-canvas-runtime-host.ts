import type { CanvasRuntimeHost, CanvasRuntimeSurfaces } from '../src/canvas/runtime/runtime'
import type { SceneCanvasRuntime } from '../src/canvas/runtime/scene-runtime'

// Standalone Canvas host for the UI gallery and live-runtime tests. Production
// workspaces compose surfaces in app/canvas-map-surface/workspace-runtime-composition.ts.
export function createSceneCanvasRuntimeHost(runtime: SceneCanvasRuntime): CanvasRuntimeHost {
  const surfaces: CanvasRuntimeSurfaces = {
    commands: runtime.commandSurface,
    queries: runtime.querySurface,
    documents: runtime.documentSurface,
  }
  return {
    surfaces,
    init: (container) => runtime.init(container),
    destroy: async () => {
      runtime.destroy()
    },
  }
}
