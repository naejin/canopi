import type { SpeciesFocus } from '../species-key'
import type { SceneDesignObjectTarget, ScenePersistedState, SceneViewportState } from '../scene'
import type { DraftPresentation } from '../tools/draft'
import type { ViewTransform } from '../view/types'
import type { PlantNameLabel, SelectionLabel } from '../selection-labels'
import type { SpeciesCacheEntry } from '../species-cache'
import type { PlantLabelMode } from '../plant-display'

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
  readonly speciesFocus: SpeciesFocus
  readonly scene: ScenePersistedState
  readonly viewport: SceneViewportState
  readonly revealedAnnotationId: string | null
  readonly selectionLabelPlantIds: ReadonlySet<string>
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
  /** Labels a saved view's snapshot draws; absent, the workspace's plant display decides. */
  readonly plantLabels?: PlantLabelMode
}

interface SceneRendererContext {
  readonly container: HTMLElement
}

/**
 * The mounted scene renderer. MapLibre owns the drawing surface, its size and
 * its frame loop, so the renderer only receives retained scene state and
 * camera-only updates.
 */
export interface SceneRendererInstance {
  readonly id: string
  // Full scene/content refresh. Retain unchanged graphics across selection/presentation changes.
  renderScene(snapshot: SceneRendererSnapshot): void
  // Camera-only update. Must not assume the runtime will provide a fresh scene snapshot.
  setViewport(viewport: SceneViewportState): void
  /**
   * Tool drafts (the ToolHost's renderer sink), for the Pixi draft layer. Optional in 0B because test fakes build
   * this interface as a literal; SceneRenderer (end of 0D2) requires it.
   */
  setDraft?(draft: DraftPresentation | null): void
  dispose(): void | PromiseLike<void>
}

/** The one scene renderer the runtime mounts (ADR 0004): there is no selection or fallback. */
export interface SceneRendererDefinition {
  readonly id: string
  initialize(context: SceneRendererContext): SceneRendererInstance | PromiseLike<SceneRendererInstance>
}

export interface SceneChangeSet {
  readonly scene: boolean                                   // document revision
  readonly selection: boolean
  readonly hover: readonly SceneDesignObjectTarget[]        // old and new hover target only: a two-node restyle
  readonly style: boolean                                   // theme, backdrop, plant display settings
  readonly labels: boolean                                  // label admission recomputed (settled or band change)
}

export interface SceneRendererV2 {   // renamed SceneRenderer at the end of 0D2
  readonly id: 'maplibre-pixi'
  /** Data, selection, hover, style or label admission changed. Never called for a pan. No camera in the snapshot. */
  syncScene(snapshot: SceneRendererSnapshot, changes: SceneChangeSet): void
  /** The only per-frame entry: world-root matrix, visible set, billboard anchors, zoom-band re-key. */
  setView(view: ViewTransform): void
  setDraft(draft: DraftPresentation | null): void
  dispose(): void | PromiseLike<void>
}
