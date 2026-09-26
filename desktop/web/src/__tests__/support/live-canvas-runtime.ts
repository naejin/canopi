import { SceneCanvasRuntime, type SceneCanvasRuntimeOptions } from '../../canvas/runtime/scene-runtime'
import type { CanvasRuntimeSurfaces } from '../../canvas/runtime/runtime'

export type TestCanvasRuntimeHostOptions = SceneCanvasRuntimeOptions

/**
 * A live scene runtime without the map workspace, for scene-level tests.
 * Production and the UI gallery mount the shared workspace composition
 * (app/canvas-map-surface/workspace-runtime-composition.ts) instead.
 */
export interface CanvasRuntimeHost {
  readonly surfaces: CanvasRuntimeSurfaces
  init(container: HTMLElement): Promise<void>
  destroy(): Promise<void>
}

export function createLiveTestCanvasRuntimeHost(
  options: TestCanvasRuntimeHostOptions = {},
): CanvasRuntimeHost {
  const runtime = new SceneCanvasRuntime(options)
  return {
    surfaces: {
      commands: runtime.commandSurface,
      queries: runtime.querySurface,
      documents: runtime.documentSurface,
    },
    init: (container) => runtime.init(container),
    destroy: async () => {
      runtime.destroy()
    },
  }
}
