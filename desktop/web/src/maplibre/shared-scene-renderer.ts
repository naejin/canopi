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
 * `connectRenderTarget`) from MapLibre's `onAdd` until its disposal begins. Only an attached layer asks MapLibre for a frame,
 * so the slot settles a scene render one frame after the layer's frame has drawn it, never before the layer is initialized
 * (render-scheduler.ts). Layer failures go to the layer's `onFailure` observer; the workspace coordinator then unmounts
 * the runtime's renderer.
 */
export function createSharedMapSceneRendererComposition(
  connect: (target: SceneRenderTarget) => () => void,
): SharedMapSceneRendererComposition {
  return {
    createLayer(options) {
      const adapter = createSharedMapSceneLayer(options)
      let disconnect: (() => void) | null = null

      return {
        layer: {
          ...adapter.layer,
          onAdd(map, gl) {
            adapter.layer.onAdd?.(map, gl)
            if (adapter.diagnostics.phase === 'attached') disconnect ??= connect(adapter)
          },
        },
        get diagnostics() { return adapter.diagnostics },
        initialize: (map, gl) => adapter.initialize(map, gl),
        setSnapshot: (snapshot) => adapter.setSnapshot(snapshot),
        requestRender: () => adapter.requestRender(),
        dispose() {
          // Leave the slot first: a disposal that fails must not keep a dead layer as the runtime's target.
          disconnect?.()
          disconnect = null
          return adapter.dispose()
        },
      }
    },
  }
}
