import type { DraftPresentation } from '../tools/draft'
import type {
  SceneRenderer,
  SceneRendererDefinition,
  SceneRendererSnapshot,
} from './scene-types'

export const MAPLIBRE_SCENE_RENDERER_ID = 'maplibre-pixi'

/**
 * The map lifecycle owns this target and its graphics resources. The Scene
 * Runtime only publishes retained scene state and asks the map for a frame.
 */
export interface MapLibreSceneRenderTarget {
  setSnapshot(snapshot: SceneRendererSnapshot): void
  /** A camera frame: the layer reads the view itself when MapLibre draws it. */
  requestRender(): void
  /** The shared scene layer hands these to its Pixi draft layer; optional for targets that draw no drafts (test fakes). */
  setDraft?(draft: DraftPresentation | null): void
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
  private latestDraft: DraftPresentation | null = null

  connect(target: MapLibreSceneRenderTarget): MapLibreSceneRenderTargetConnection {
    const generation = ++this.targetGeneration
    this.target = target
    if (this.activeBackendGeneration !== null && this.latestSnapshot) {
      target.setSnapshot(this.latestSnapshot)
    }
    // A draft set before this target connected (a style reload rebuilds the layer) is still live.
    if (this.activeBackendGeneration !== null && this.latestDraft) target.setDraft?.(this.latestDraft)

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

        const instance: SceneRenderer = {
          id: MAPLIBRE_SCENE_RENDERER_ID,
          dispose: () => {
            if (this.activeBackendGeneration !== generation) return
            this.activeBackendGeneration = null
            this.latestSnapshot = null
            this.latestDraft = null
          },
          // The Pixi presentation redraws everything it is given until phase R reads the change set.
          syncScene: (snapshot) => {
            this.assertBackendCurrent(generation)
            this.latestSnapshot = snapshot
            this.target?.setSnapshot(snapshot)
          },
          setView: () => {
            this.assertBackendCurrent(generation)
            this.target?.requestRender()
          },
          setDraft: (draft) => {
            this.assertBackendCurrent(generation)
            this.latestDraft = draft
            this.target?.setDraft?.(draft)
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
