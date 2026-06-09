import { createSceneCanvasCommandSurface } from './command-surface'
import { createSceneCanvasDocumentSurface } from './document-surface'
import { createSceneCanvasQuerySurface } from './query-surface'
import type { CanvasRuntimeSurfaces } from './runtime'
import type { SceneCanvasRuntime } from './scene-runtime'

export function createCanvasRuntimeSurfaces(runtime: SceneCanvasRuntime): CanvasRuntimeSurfaces {
  return {
    commands: createSceneCanvasCommandSurface(runtime),
    queries: createSceneCanvasQuerySurface(runtime),
    documents: createSceneCanvasDocumentSurface(runtime),
  }
}
