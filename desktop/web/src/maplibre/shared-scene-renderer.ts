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
  failActiveLayer(error: unknown): void
}

/**
 * Builds the Scene Runtime backend and its map-owned custom layers as one
 * composition so adapter failures cannot bypass RendererHost failover.
 */
export function createSharedMapSceneRendererComposition(): SharedMapSceneRendererComposition {
  const bridge = new MapLibreSceneRendererBridge()
  let activeConnection: MapLibreSceneRenderTargetConnection | null = null

  return {
    renderer: bridge.createRenderer(),
    failActiveLayer(error) {
      activeConnection?.fail(error)
    },
    createLayer(options) {
      let connection: MapLibreSceneRenderTargetConnection | null = null
      const adapter = createSharedMapSceneLayer({
        ...options,
        onFailure: (error) => {
          connection?.fail(error)
          options.onFailure?.(error)
        },
      })
      connection = bridge.connect(adapter)
      activeConnection = connection

      return {
        layer: adapter.layer,
        get diagnostics() { return adapter.diagnostics },
        initialize: (map, gl) => adapter.initialize(map, gl),
        setSnapshot: (snapshot) => adapter.setSnapshot(snapshot),
        requestRender: () => adapter.requestRender(),
        async dispose(disposeOptions) {
          await adapter.dispose(disposeOptions)
          connection?.disconnect()
          if (activeConnection === connection) activeConnection = null
          connection = null
        },
      }
    },
  }
}
