import type { CanvasRuntimeHost } from '../../canvas/runtime/runtime'
import { createSceneCanvasRuntimeHost } from '../../canvas/runtime/host'
import { SceneCanvasRuntime } from '../../canvas/runtime/scene-runtime'
import { createDesktopCanvasRuntimeAppAdapter } from './desktop-adapter'
import { createAppSceneRuntimePanelTargetAdapter } from './panel-target-adapter'

export function createAppCanvasRuntimeHost(): CanvasRuntimeHost {
  const appAdapter = createDesktopCanvasRuntimeAppAdapter()

  return createSceneCanvasRuntimeHost(new SceneCanvasRuntime({
    appAdapter,
    targetPresentation: createAppSceneRuntimePanelTargetAdapter(),
  }))
}
