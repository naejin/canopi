import { createSceneCanvasRuntimeHost } from '../../app/canvas-runtime/host'
import { SceneCanvasRuntime, type SceneCanvasRuntimeOptions } from '../../canvas/runtime/scene-runtime'
import type { CanvasRuntimeHost } from '../../canvas/runtime/runtime'

export type TestCanvasRuntimeHostOptions = SceneCanvasRuntimeOptions

export function createLiveTestCanvasRuntimeHost(
  options: TestCanvasRuntimeHostOptions = {},
): CanvasRuntimeHost {
  return createSceneCanvasRuntimeHost(new SceneCanvasRuntime(options))
}
