import type { CanvasRuntimeAppAdapter } from '../canvas/runtime/app-adapter'
import { createSceneCanvasRuntimeHost } from '../canvas/runtime/host'
import type { CanvasRuntimeHost } from '../canvas/runtime/runtime'
import { SceneCanvasRuntime } from '../canvas/runtime/scene-runtime'
import { createDetachedCanvasPlantLabelSource, createDetachedCanvasSpeciesPresentationCache } from '../canvas/runtime/presentation-data'
import { createAppCanvasRuntimeAppAdapter } from '../app/canvas-runtime/app-adapter'
import { createAppSceneRuntimePanelTargetAdapter } from '../app/canvas-runtime/panel-target-adapter'

export function createBrowserCanvasRuntimeHost(): CanvasRuntimeHost {
  const runtime = new SceneCanvasRuntime({
    appAdapter: createBrowserCanvasRuntimeAppAdapter(),
    targetPresentation: createAppSceneRuntimePanelTargetAdapter(),
  })
  return createSceneCanvasRuntimeHost(runtime)
}

export function createBrowserCanvasRuntimeAppAdapter(): CanvasRuntimeAppAdapter {
  return createAppCanvasRuntimeAppAdapter({
    presentationData: {
      plantLabels: createDetachedCanvasPlantLabelSource(),
      speciesCache: createDetachedCanvasSpeciesPresentationCache(),
    },
  })
}
