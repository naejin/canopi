import type { RendererBackendContext, RendererBackendDefinition, RendererBackendInstance } from './types'
import type { ScenePersistedState, SceneViewportState } from '../scene'
import type { PlantNameLabel, SelectionLabel } from '../selection-labels'
import type { SpeciesCacheEntry } from '../species-cache'

export type SceneRendererHoverState =
  | 'hover'
  | 'locked-design-object'
  | 'locked-layer'

export type SceneRendererHoverTarget =
  | { kind: 'plant'; id: string; state: SceneRendererHoverState }
  | { kind: 'zone'; id: string; state: SceneRendererHoverState }
  | { kind: 'annotation'; id: string; state: SceneRendererHoverState }
  | { kind: 'measurement-guide'; id: string; state: SceneRendererHoverState }
  | { kind: 'group'; id: string; state: SceneRendererHoverState }

export interface SceneRendererSnapshot {
  readonly scene: ScenePersistedState
  readonly viewport: SceneViewportState
  readonly selectedEntityIds: ReadonlySet<string>
  readonly selectedPlantIds: ReadonlySet<string>
  readonly selectedZoneIds: ReadonlySet<string>
  readonly selectedAnnotationIds: ReadonlySet<string>
  readonly selectedMeasurementGuideIds: ReadonlySet<string>
  readonly highlightedPlantIds: ReadonlySet<string>
  readonly highlightedZoneIds: ReadonlySet<string>
  readonly speciesCache: ReadonlyMap<string, SpeciesCacheEntry>
  readonly localizedCommonNames: ReadonlyMap<string, string | null>
  readonly hoveredCanonicalName: string | null
  readonly hoverTarget: SceneRendererHoverTarget | null
  readonly pinnedPlantNameLabels: readonly PlantNameLabel[]
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
