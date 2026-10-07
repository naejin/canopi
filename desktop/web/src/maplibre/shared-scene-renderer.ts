import type { SceneRenderTarget } from '../canvas/runtime/renderers/scene-types'
import {
  createSharedMapSceneLayer,
  type SharedMapSceneLayer,
  type SharedMapSceneLayerOptions,
} from './shared-scene-layer'

export interface SharedMapSceneRendererComposition {
  createLayer(options: SharedMapSceneLayerOptions): SharedMapSceneLayer
}

/**
 * Builds the workspace map's custom layers, each connected to the runtime's one target slot (`connect`, the runtime's
 * `connectRenderTarget`) until its final disposal. Layer failures go to the layer's `onFailure` observer; the workspace
 * coordinator then unmounts the runtime's renderer.
 */
export function createSharedMapSceneRendererComposition(
  connect: (target: SceneRenderTarget) => () => void,
): SharedMapSceneRendererComposition {
  return {
    createLayer(options) {
      const adapter = createSharedMapSceneLayer(options)
      let disconnect: (() => void) | null = connect(adapter)

      return {
        layer: adapter.layer,
        get diagnostics() { return adapter.diagnostics },
        initialize: (map, gl) => adapter.initialize(map, gl),
        setSnapshot: (snapshot) => adapter.setSnapshot(snapshot),
        requestRender: () => adapter.requestRender(),
        async dispose(disposeOptions) {
          await adapter.dispose(disposeOptions)
          disconnect?.()
          disconnect = null
        },
      }
    },
  }
}
