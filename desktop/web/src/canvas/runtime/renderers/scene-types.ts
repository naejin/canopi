import type { SpeciesFocus } from '../species-key'
import type { SceneDesignObjectTarget, ScenePersistedState } from '../scene'
import type { DraftPresentation } from '../tools/draft'
import type { ViewTransform } from '../view/types'
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

/**
 * The workspace map's editing aids (spec §1.5): the grid, drawn in the world root under every billboard. Its interval
 * follows the scale through `canvas/grid.ts`'s `gridInterval`, the lattice snapping uses; its ink follows the map backdrop.
 */
export interface SceneEditingAids {
  readonly grid: { readonly ink: string; readonly majorInk: string }
}

export interface SceneRendererSnapshot {
  readonly speciesFocus: SpeciesFocus
  readonly scene: ScenePersistedState
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
  /** Labels a saved view's snapshot draws; absent, the workspace's plant display decides. */
  readonly plantLabels?: PlantLabelMode
  /** Set only for the workspace map; absent, nothing is drawn (thumbnails, the overview, a presented story, the lens). */
  readonly editingAids?: SceneEditingAids
}

interface SceneRendererContext {
  readonly container: HTMLElement
}

/** The one scene renderer the runtime mounts (ADR 0004): there is no selection or fallback. */
export interface SceneRendererDefinition {
  readonly id: string
  initialize(context: SceneRendererContext): SceneRenderer | PromiseLike<SceneRenderer>
}

export interface SceneChangeSet {
  readonly scene: boolean                                   // document revision
  readonly selection: boolean
  readonly hover: readonly SceneDesignObjectTarget[]        // old and new hover target only: a two-node restyle
  readonly style: boolean                                   // theme, backdrop, plant display settings
  readonly labels: boolean                                  // label admission recomputed (each scale change; from phase R, settle or band change)
}

/**
 * The mounted scene renderer (spec §1.5). MapLibre owns the drawing surface, its size and its frame loop, so the renderer
 * receives retained scene data through `syncScene` and the camera through `setView`, and nothing else.
 */
export interface SceneRenderer {
  readonly id: 'maplibre-pixi'
  /** Data, selection, hover, style or label admission changed. Never called for a pan. No camera in the snapshot. */
  syncScene(snapshot: SceneRendererSnapshot, changes: SceneChangeSet): void
  /** The only per-frame entry: world-root matrix, visible set, billboard anchors, zoom-band re-key. */
  setView(view: ViewTransform): void
  setDraft(draft: DraftPresentation | null): void
  dispose(): void | PromiseLike<void>
}
