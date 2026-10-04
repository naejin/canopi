import {
  MapLibreSceneRendererBridge,
  type MapLibreSceneRenderTargetConnection,
} from '../canvas/runtime/renderers/maplibre-scene'
import type { SceneRendererDefinition } from '../canvas/runtime/renderers/scene-types'
import {
  createSharedMapSceneLayer,
  type SharedMapSceneLayer,
  type SharedMapSceneLayerOptions,
} from './shared-scene-layer'

export interface SharedMapSceneRendererComposition {
  readonly renderer: SceneRendererDefinition
  createLayer(options: SharedMapSceneLayerOptions): SharedMapSceneLayer
}

/**
 * Builds the Scene Runtime renderer and its map-owned custom layers as one
 * composition. Layer failures go to the layer's `onFailure` observer; the
 * workspace coordinator then unmounts the renderer.
 */
export function createSharedMapSceneRendererComposition(): SharedMapSceneRendererComposition {
  const bridge = new MapLibreSceneRendererBridge()

  return {
    renderer: bridge.createRenderer(),
    createLayer(options) {
      const adapter = createSharedMapSceneLayer(options)
      let connection: MapLibreSceneRenderTargetConnection | null = bridge.connect(adapter)

      return {
        layer: adapter.layer,
        get diagnostics() { return adapter.diagnostics },
        initialize: (map, gl) => adapter.initialize(map, gl),
        setSnapshot: (snapshot) => adapter.setSnapshot(snapshot),
        requestRender: () => adapter.requestRender(),
        async dispose(disposeOptions) {
          await adapter.dispose(disposeOptions)
          connection?.disconnect()
          connection = null
        },
      }
    },
  }
}
