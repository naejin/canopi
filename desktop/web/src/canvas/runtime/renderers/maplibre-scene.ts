import type { SceneViewportState } from '../scene'
import type { DraftPresentation, SelectionPreview } from '../tools/draft'
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
  /** The shared scene layer hands these to its Pixi draft layer; optional for targets that draw no drafts (test fakes). */
  setDraft?(draft: DraftPresentation | null): void
  setSelectionPreview?(preview: SelectionPreview | null): void
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
  private latestSelectionPreview: SelectionPreview | null = null

  connect(target: MapLibreSceneRenderTarget): MapLibreSceneRenderTargetConnection {
    const generation = ++this.targetGeneration
    this.target = target
    if (this.activeBackendGeneration !== null && this.latestSnapshot) {
      target.setSnapshot(this.latestSnapshot)
    }
    // A draft set before this target connected (a style reload rebuilds the layer) is still live.
    if (this.activeBackendGeneration !== null && this.latestDraft) target.setDraft?.(this.latestDraft)
    if (this.activeBackendGeneration !== null && this.latestSelectionPreview) {
      target.setSelectionPreview?.(this.latestSelectionPreview)
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
            this.latestDraft = null
            this.latestSelectionPreview = null
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
          setDraft: (draft) => {
            this.assertBackendCurrent(generation)
            this.latestDraft = draft
            this.target?.setDraft?.(draft)
          },
          setSelectionPreview: (preview) => {
            this.assertBackendCurrent(generation)
            this.latestSelectionPreview = preview
            this.target?.setSelectionPreview?.(preview)
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
