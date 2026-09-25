import type { SceneViewportState } from '../scene'
import type {
  SceneRendererDefinition,
  SceneRendererInstance,
  SceneRendererSnapshot,
} from './scene-types'

export const MAPLIBRE_SCENE_RENDERER_ID = 'maplibre-pixi'

/**
 * The map lifecycle owns this target and its graphics resources. The Scene
 * Runtime only publishes retained scene state and asks the map for a frame.
 */
export interface MapLibreSceneRenderTarget {
  setSnapshot(snapshot: SceneRendererSnapshot): void
  requestRender(): void
}

export interface MapLibreSceneRenderTargetConnection {
  disconnect(): void
}

/**
 * Connects the renderer-neutral Scene Runtime to one MapLibre custom layer
 * without taking ownership of the map, its canvas, or its frame loop. Map and
 * layer failures are reported by the workspace coordinator, which unmounts this
 * renderer and shows the map-unavailable state.
 */
export class MapLibreSceneRendererBridge {
  private target: MapLibreSceneRenderTarget | null = null
  private targetGeneration = 0
  private backendGeneration = 0
  private activeBackendGeneration: number | null = null
  private latestSnapshot: SceneRendererSnapshot | null = null

  connect(target: MapLibreSceneRenderTarget): MapLibreSceneRenderTargetConnection {
    const generation = ++this.targetGeneration
    this.target = target
    if (this.activeBackendGeneration !== null && this.latestSnapshot) {
      target.setSnapshot(this.latestSnapshot)
    }

    return {
      disconnect: () => {
        if (this.targetGeneration !== generation || this.target !== target) return
        this.targetGeneration += 1
        this.target = null
      },
    }
  }

  createRenderer(): SceneRendererDefinition {
    return {
      id: MAPLIBRE_SCENE_RENDERER_ID,
      initialize: () => {
        if (this.activeBackendGeneration !== null) {
          throw new Error('The MapLibre scene renderer bridge already has an active renderer.')
        }
        const generation = ++this.backendGeneration
        this.activeBackendGeneration = generation

        const instance: SceneRendererInstance = {
          id: MAPLIBRE_SCENE_RENDERER_ID,
          dispose: () => {
            if (this.activeBackendGeneration !== generation) return
            this.activeBackendGeneration = null
            this.latestSnapshot = null
          },
          renderScene: (snapshot) => {
            this.assertBackendCurrent(generation)
            this.latestSnapshot = snapshot
            this.target?.setSnapshot(snapshot)
          },
          setViewport: (_viewport: SceneViewportState) => {
            this.assertBackendCurrent(generation)
            this.target?.requestRender()
          },
        }
        return instance
      },
    }
  }

  private assertBackendCurrent(generation: number): void {
    if (this.activeBackendGeneration !== generation) {
      throw new Error('The MapLibre scene renderer is no longer active.')
    }
  }
}
