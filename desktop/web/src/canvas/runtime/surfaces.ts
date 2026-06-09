import { createSceneCanvasCommandSurface } from './command-surface'
import { createSceneCanvasQuerySurface } from './query-surface'
import type { CanvasDocumentSurface, CanvasRuntimeSurfaces } from './runtime'
import type { SceneCanvasRuntime } from './scene-runtime'

export function createCanvasRuntimeSurfaces(runtime: SceneCanvasRuntime): CanvasRuntimeSurfaces {
  return {
    commands: createSceneCanvasCommandSurface(runtime),
    queries: createSceneCanvasQuerySurface(runtime),
    documents: documentSurfaceFrom(runtime),
  }
}

function documentSurfaceFrom(runtime: SceneCanvasRuntime): CanvasDocumentSurface {
  const maybeRuntime = runtime as SceneCanvasRuntime & {
    readonly documentSurface?: CanvasDocumentSurface
  }
  return maybeRuntime.documentSurface ?? runtime
}
