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
  fail(error: unknown): void
  disconnect(): void
}

/**
 * Connects the existing renderer-neutral Scene Runtime to one MapLibre custom
 * layer without taking ownership of the map, its canvas, or its frame loop.
 */
export class MapLibreSceneRendererBridge {
  private target: MapLibreSceneRenderTarget | null = null
  private targetGeneration = 0
  private backendGeneration = 0
  private activeBackendGeneration: number | null = null
  private latestSnapshot: SceneRendererSnapshot | null = null
  private targetFailure: unknown | null = null
  private backendFailure: unknown | null = null

  /**
   * Fences the bridge backend even when no custom-layer target made it far
   * enough to connect. Workspace admission uses this for failures before
   * MapLibre calls the custom layer's onAdd hook.
   */
  failActiveBackend(error: unknown): void {
    this.backendFailure = normalizeFailure(error)
  }

  connect(target: MapLibreSceneRenderTarget): MapLibreSceneRenderTargetConnection {
    const generation = ++this.targetGeneration
    this.target = target
    this.targetFailure = null
    if (this.activeBackendGeneration !== null && this.latestSnapshot) {
      target.setSnapshot(this.latestSnapshot)
    }

    return {
      fail: (error) => {
        if (this.targetGeneration !== generation || this.target !== target) return
        this.targetFailure = normalizeFailure(error)
      },
      disconnect: () => {
        if (this.targetGeneration !== generation || this.target !== target) return
        this.targetGeneration += 1
        this.target = null
        this.targetFailure = null
      },
    }
  }

  createRenderer(): SceneRendererDefinition {
    return {
      id: MAPLIBRE_SCENE_RENDERER_ID,
      supports: (capabilities) => capabilities.webgl2,
      initialize: () => {
        if (this.activeBackendGeneration !== null) {
          throw new Error('The MapLibre scene renderer bridge already has an active backend.')
        }
        const generation = ++this.backendGeneration
        this.activeBackendGeneration = generation

        const instance: SceneRendererInstance = {
          id: MAPLIBRE_SCENE_RENDERER_ID,
          dispose: () => {
            if (this.activeBackendGeneration !== generation) return
            this.activeBackendGeneration = null
            this.latestSnapshot = null
            this.backendFailure = null
          },
          resize: () => {
            // MapLibre owns both CSS and backing-store dimensions.
          },
          renderScene: (snapshot) => {
            this.assertBackendCurrent(generation)
            this.throwTargetFailure()
            this.latestSnapshot = snapshot
            this.target?.setSnapshot(snapshot)
          },
          setViewport: (_viewport: SceneViewportState) => {
            this.assertBackendCurrent(generation)
            this.throwTargetFailure()
            this.target?.requestRender()
          },
        }
        return instance
      },
    }
  }

  private assertBackendCurrent(generation: number): void {
    if (this.activeBackendGeneration !== generation) {
      throw new Error('The MapLibre scene renderer backend is no longer active.')
    }
  }

  private throwTargetFailure(): void {
    if (this.backendFailure !== null) throw this.backendFailure
    if (this.targetFailure !== null) throw this.targetFailure
  }
}

function normalizeFailure(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(typeof error === 'string' ? error : 'MapLibre scene rendering failed.')
}
