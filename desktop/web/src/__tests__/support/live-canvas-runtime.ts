import { SceneCanvasRuntime, type SceneCanvasRuntimeOptions } from '../../canvas/runtime/scene-runtime'
import type { CanvasRuntimeSurfaces } from '../../canvas/runtime/runtime'
import { createForwardingCanvasKeyboardPort } from '../../canvas/runtime/keyboard-port'

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
      // Before init there is no map host yet: the port answers with a detached one and consumes nothing.
      keyboard: createForwardingCanvasKeyboardPort(() => runtime.keyboardPort, document.createElement('div')),
    },
    init: (container) => runtime.init(container),
    destroy: async () => {
      runtime.destroy()
    },
  }
}
