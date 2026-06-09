import type {
  CanvasCommandSurface,
  CanvasDocumentSurface,
  CanvasQuerySurface,
  CanvasRuntimeSurfaces,
} from './runtime'
import type { SceneCanvasRuntime } from './scene-runtime'

export function createCanvasRuntimeSurfaces(runtime: SceneCanvasRuntime): CanvasRuntimeSurfaces {
  return {
    commands: commandSurfaceFrom(runtime),
    queries: querySurfaceFrom(runtime),
    documents: documentSurfaceFrom(runtime),
  }
}

function commandSurfaceFrom(runtime: SceneCanvasRuntime): CanvasCommandSurface {
  const maybeRuntime = runtime as SceneCanvasRuntime & {
    readonly commandSurface?: CanvasCommandSurface
  }
  return maybeRuntime.commandSurface ?? runtime
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
