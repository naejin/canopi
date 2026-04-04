import type { RendererBackendContext, RendererBackendDefinition, RendererBackendInstance } from './types'
import type { ScenePersistedState, SceneViewportState } from '../scene'
import type { SelectionLabel } from '../selection-labels'
import type { ColorByAttribute, PlantSizeMode } from '../../../state/canvas'

export interface SceneRendererSnapshot {
  readonly scene: ScenePersistedState
  readonly viewport: SceneViewportState
  readonly selectedPlantIds: ReadonlySet<string>
  readonly selectedZoneIds: ReadonlySet<string>
  readonly selectedAnnotationIds: ReadonlySet<string>
  readonly sizeMode: PlantSizeMode
  readonly colorByAttr: ColorByAttribute | null
  readonly speciesCache: ReadonlyMap<string, Record<string, unknown>>
  readonly localizedCommonNames: ReadonlyMap<string, string | null>
  readonly hoveredCanonicalName: string | null
  readonly selectionLabels: readonly SelectionLabel[]
}

export interface SceneRendererContext {
  readonly container: HTMLElement
}

export interface SceneRendererInstance extends RendererBackendInstance {
  resize(width: number, height: number): void
  // Full scene/content rebuild. Use this for scene, selection, or presentation changes.
  renderScene(snapshot: SceneRendererSnapshot): void
  // Camera-only update. Must not assume the runtime will provide a fresh scene snapshot.
  setViewport(viewport: SceneViewportState): void
}

export type SceneRendererDefinition = RendererBackendDefinition<SceneRendererContext, SceneRendererInstance>

export interface SceneRendererBackendInit {
  readonly context: SceneRendererContext
  readonly backendContext: RendererBackendContext
}
