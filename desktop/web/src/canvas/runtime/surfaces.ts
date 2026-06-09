import { createSceneCanvasCommandSurface } from './command-surface'
import type { CanvasDocumentSurface, CanvasQuerySurface, CanvasRuntimeSurfaces } from './runtime'
import type { SceneCanvasRuntime } from './scene-runtime'

export function createCanvasRuntimeSurfaces(runtime: SceneCanvasRuntime): CanvasRuntimeSurfaces {
  return {
    commands: createSceneCanvasCommandSurface(runtime),
    queries: querySurfaceFrom(runtime),
    documents: documentSurfaceFrom(runtime),
  }
}

function querySurfaceFrom(runtime: SceneCanvasRuntime): CanvasQuerySurface {
  const maybeRuntime = runtime as SceneCanvasRuntime & {
    readonly querySurface?: CanvasQuerySurface
  }
  return maybeRuntime.querySurface ?? runtime
}

function documentSurfaceFrom(runtime: SceneCanvasRuntime): CanvasDocumentSurface {
  const maybeRuntime = runtime as SceneCanvasRuntime & {
    readonly documentSurface?: CanvasDocumentSurface
  }
  return maybeRuntime.documentSurface ?? runtime
}
