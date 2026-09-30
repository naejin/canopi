// canvas/runtime/tools/tool.ts  (the tool contract; with interaction-types.ts, where tool implementations get their shared types)
// Every import below is `import type`, each from the module that defines the type, never from a barrel (scene/index.ts):
//   ../interaction-types.ts: ToolId, PointerKind, CancelReason, ToolHandleId, CanvasDropPayload (§1.2a)
//   ./draft.ts: DraftPresentation, SelectionPreview, ToolHandle
//   ../view/types.ts: WorldPoint, WorldVector, WorldQuad
//   ../scene/types.ts: ScenePersistedState, ScenePlantEntity, SceneLayerEntity
//   ../scene/design-object-targets.ts: SceneDesignObjectTarget, SceneDesignObjectSelection
//   ../scene-runtime/transactions.ts: SceneEditCoordinator
//   ../scene-runtime/arrangement-placement.ts: SceneArrangementTemplate
//   ../runtime.ts: CanvasDesignObjectSelectionModel
//   ../../session-state.ts: CanvasToolGuidance
//   ../../plant-stamp-source.ts: PlantStampSourceInput; ../../saved-object-stamp-payload.ts: SavedObjectStampPayload
// P5 allows all of them (it forbids view/** values, not type-only view/types.ts, and names none of the others). P5c holds
// because no listed module reaches maplibre-gl, pixi.js or src/maplibre/**, even through type-only edges, which
// forbid-transitive-imports follows: checked at 0f05d927 by walking source-facts.ts's graph from each existing module;
// view/types.ts, draft.ts and interaction-types.ts are seams files: draft.ts imports only view/types.ts, interaction-types.ts
// and GhostEntity from this file (type-only both ways, no runtime cycle), and interaction-types.ts only the two clean
// drag-payload modules above. Tool implementations
// import these types from tool.ts, draft.ts or the same defining modules. Any later type import must keep P5c true.

import type { CancelReason, CanvasDropPayload, PointerKind, ToolHandleId, ToolId } from '../interaction-types'
import type { DraftPresentation, SelectionPreview, ToolHandle } from './draft'
import type { WorldPoint, WorldQuad, WorldVector } from '../view/types'
import type { ScenePersistedState, ScenePlantEntity, SceneLayerEntity } from '../scene/types'
import type { SceneDesignObjectSelection, SceneDesignObjectTarget } from '../scene/design-object-targets'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import type { SceneArrangementTemplate } from '../scene-runtime/arrangement-placement'
import type { CanvasDesignObjectSelectionModel } from '../runtime'
import type { CanvasToolGuidance } from '../../session-state'
import type { PlantStampSourceInput } from '../../plant-stamp-source'
import type { SavedObjectStampPayload } from '../../saved-object-stamp-payload'

/** Modifiers by meaning, resolved per platform and per phase by the ToolHost. */
export interface ToolModifiers {
  /** Toggle into the selection: Shift, or mod (Cmd on Mac, Ctrl elsewhere). */
  readonly additive: boolean
  /** Remove from the selection: Alt (phase 2). */
  readonly subtractive: boolean
  /** Shift. Every phase: Polygon and Plant a row 45° steps; the rotate handle's 15° steps from the press angle. Phase 2 adds square/circle for Rectangle and Ellipse and 45° screen steps for Line and Measure. */
  readonly constrain: boolean
  /** Alt, reserved (unused). */
  readonly fromCentre: boolean
  /** Plant a row only. LEGACY/ROTATION: Shift. Phase 2: mod held during the drag. */
  readonly noSnap: boolean
}

export interface ToolPoint {
  readonly world: WorldPoint       // raw plane metres
  /** world after the tool's constraint (CanvasTool.constraint, Shift): 'direction' turns origin → point to the step and keeps the length; 'rotation-delta' turns the point about the pivot so the angle since the press is a step multiple. Equals world when none applies. */
  readonly constrained: WorldPoint
  /** Grid and guides on world axes (user). Order per §2.3: LEGACY and ROTATION keep today's (Polygon snaps, then constrains; a Plant a row Shift is also no-snap); V2 constrains, then snaps the length along the ray. Equals constrained when snap is off, noSnap is held or the constraint is 'rotation-delta'. */
  readonly snapped: WorldPoint
  readonly modifiers: ToolModifiers
  readonly pointer: PointerKind
}

/** What a hit query returns: a design object, or a part of one. */
export type HitTarget =
  | { readonly kind: 'object'; readonly target: SceneDesignObjectTarget }                          // scene/design-object-targets.ts
  | { readonly kind: 'zone-edge'; readonly zoneId: string; readonly edgeIndex: number; readonly distancePx: number }
  | { readonly kind: 'guide'; readonly guideId: string }
export interface HitFilter {
  readonly kinds?: readonly SceneDesignObjectTarget['kind'][]
  readonly includeLocked?: boolean                 // default false: locked objects are hit only for "select and show Unlock"
  readonly toleranceScreenPx?: number              // converted through metresPerPixelAt
}
/** The cached selection read model: today's CanvasDesignObjectSelectionModel (canvas/runtime/runtime.ts:48), unchanged. */
export type SelectionReadModel = CanvasDesignObjectSelectionModel
/** Layer names as stored (SceneLayerEntity.name): 'plants', 'zones', 'annotations', 'measurements', …
 *  Stays `string` in the seams (SceneLayerEntity.name is `string`, scene/types.ts:15; the seams do not edit scene/types.ts). Narrowing it to the known names is a later, optional change. */
export type SceneLayerKind = SceneLayerEntity['name']
/**
 * A preview of what a placement would create, drawn with the draft by the scene's own drawing code (plan 0D1 "Ghosts").
 * The entities are already where a click would put them: the tool builds the plant as a click would (today plantEntityFromStampSource)
 * and applies the stamp's offset and held rotation to the template (today objectStampEntities and rotateStampEntities).
 * `anchor` and `rotationDeg` describe the pick for tests and guidance; the renderer never re-applies them.
 * A plant ghost is the plant's mark only: the Place plants mature-width ring, its label and the nearest-plant guide are ellipse, label and polyline shapes.
 * mark 'symbol' (default) draws the plant's symbol; 'dot' draws Plant a row's look: a filled disc in the plant's display colour with a 2 px
 * border of the same colour, radius half the plant's world AABB (today plant-spacing-overlay.ts:158-181; Plant a row emits its row ghosts
 * with 'dot' at opacity 0.35). Colours come from the scene's plant presentation, never a raw colour in the draft. `sizeFrom` is the point
 * whose plant presentation gives a 'dot' its radius: Plant a row passes its source plant's position, so every disc in the row has the
 * source's size, as today (plant-spacing-tool.ts:423-427); without it the ghost's own position is used.
 * Object and saved-stamp ghosts draw zones and plants at 0.62 and notes at 0.68 today: the tool emits the notes as a second 'objects'
 * ghost at 0.68 (the draft layer multiplies by each note's own marker and text opacity).
 */
export type GhostEntity =
  | { readonly kind: 'plant'; readonly plant: ScenePlantEntity; readonly mark?: 'symbol' | 'dot'; readonly sizeFrom?: WorldPoint }
  | { readonly kind: 'objects'; readonly anchor: WorldPoint; readonly rotationDeg: number; readonly template: SceneArrangementTemplate }  // stamp pick, saved stamp
export interface TextEntryRequest {
  readonly anchor: WorldPoint
  readonly rotationDeg: number                     // stored note rotation; the host draws the textarea at rotationDeg − bearing
  readonly initialText: string
  readonly placeholderKey: string
  readonly kind: 'note' | 'spacing-field'
}

export type ToolGesture =
  | { readonly kind: 'hover'; readonly point: ToolPoint; readonly hit: HitTarget | null }
  | { readonly kind: 'hover-end' }
  | { readonly kind: 'press'; readonly point: ToolPoint; readonly hit: HitTarget | null; readonly clickCount: number }
  | { readonly kind: 'tap'; readonly point: ToolPoint; readonly hit: HitTarget | null; readonly clickCount: number }
  | { readonly kind: 'drag-start' | 'drag-move' | 'drag-end'; readonly point: ToolPoint; readonly start: ToolPoint; readonly startHit: HitTarget | null }
  | { readonly kind: 'handle-drag'; readonly phase: 'start' | 'move' | 'end'; readonly handle: ToolHandleId; readonly point: ToolPoint; readonly start: ToolPoint }
  | { readonly kind: 'drop'; readonly phase: 'over' | 'leave' | 'drop'; readonly point: ToolPoint; readonly payload: CanvasDropPayload }
  | { readonly kind: 'cancel'; readonly reason: CancelReason }

export type ToolCommand =
  | { readonly kind: 'escape' }                                    // only when the tool's Esc layer is top
  | { readonly kind: 'confirm' }                                   // Enter (polygon: finish)
  | { readonly kind: 'remove-last' }                               // Backspace
  | { readonly kind: 'rotate-held'; readonly stepDeg: 15 | -15 }   // [ ] while a stamp is held
  | { readonly kind: 'place-at'; readonly world: WorldPoint }      // context menu "Place plants here"
  | { readonly kind: 'finish-shape' }                              // context menu "Finish shape" during a polygon draft
  | { readonly kind: 'delete-handle' }                             // Delete on a focused or selected zone corner (phase 2)
  | { readonly kind: 'edit-text' }                                 // Enter / F2 on one selected note
  | { readonly kind: 'undo-transient' } | { readonly kind: 'redo-transient' }

export type ToolReply = 'handled' | 'pass'

/** Read-only view queries: everything a tool may know about the camera. */
export interface ToolView {
  readonly bearingDeg: number
  readonly mode: 'site' | 'overview'
  metresPerPixelAt(p: WorldPoint): number
  screenDistance(a: WorldPoint, b: WorldPoint): number
  screenAxesInWorld(at?: WorldPoint): { readonly right: WorldVector; readonly down: WorldVector }
  /** Screen-aligned rectangle from two world corners: rotationDeg = normaliseBearing(bearing). Shift's square and circle use `square`. */
  screenAlignedRect(a: WorldPoint, b: WorldPoint, options?: { readonly square?: boolean; readonly fromCentre?: boolean }):
    { readonly center: WorldPoint; readonly width: number; readonly height: number; readonly rotationDeg: number }
}
// Angle constraints are not a ToolView query: the host applies them (CanvasTool.constraint), so ToolPoint.snapped is always right.

/** Read-only scene queries, backed by a spatial index rebuilt per scene revision. */
export interface ToolScene {
  readonly persisted: Readonly<ScenePersistedState>
  hitAt(world: WorldPoint, filter?: HitFilter): HitTarget | null
  hitInQuad(quad: WorldQuad, filter?: HitFilter): readonly HitTarget[]
  nearestPlant(world: WorldPoint, excluding?: ReadonlySet<string>): { readonly plant: ScenePlantEntity; readonly distanceM: number } | null
  isLayerOpenForCreation(layer: SceneLayerKind): boolean
  selection(): SceneDesignObjectSelection
  selectionModel(): SelectionReadModel         // cached by (scene revision, selection revision)
}

/** The only way a tool changes anything. */
export interface ToolEffects {
  readonly edits: SceneEditCoordinator                      // unchanged transaction API (begin/run/mutate/setSelection/commit/abort)
  setDraft(draft: DraftPresentation | null): void           // world-space; drawn by the renderer
  setSelectionPreview(preview: SelectionPreview | null): void
  setHandles(handles: readonly ToolHandle[]): void          // DOM handle layer; hit by the source
  setGuidance(guidance: Partial<CanvasToolGuidance> | null): void
  setCursor(cursor: 'default' | 'crosshair' | 'copy' | 'move' | 'not-allowed' | 'rotate' | 'grab' | 'grabbing'): void
  requestTool(id: ToolId): void
  requestTextEntry(request: TextEntryRequest): Promise<string | null>   // the host owns the textarea
  requestMenu(at: WorldPoint | 'selection'): void
  requestFocus(target: 'map' | 'tool-card-field'): void     // ToolHostDeps.focus (CanvasFocusPort, §1.6), implemented by the FocusOwner
}

export interface ToolSettingsPort {
  plantSpacingIntervalM(): number
  commitPlantSpacingIntervalM(metres: number): void
}

export interface ToolContext {
  readonly view: ToolView
  readonly scene: ToolScene
  readonly effects: ToolEffects
  readonly settings: ToolSettingsPort
  readonly translate: (key: string, options?: Readonly<Record<string, unknown>>) => string
}

export interface CanvasTool {
  readonly id: ToolId
  readonly dragSlopPx?: number                    // per-tool threshold (Plant a row: 4), sent through `configure`
  readonly preservesTransientOnNavigate?: boolean // polygon draft survives pans
  /**
   * The constraint for the next point while Shift (modifiers.constrain) is held, or null. 'direction': the last polygon
   * corner, the row source, the line or guide start; the host turns origin → point to stepDeg against the screen axes
   * (identical to world axes at bearing 0) and keeps the length. 'rotation-delta': the rotate handle; the angle turned
   * about the pivot since startDeg rounds to stepDeg (relative steps, as today, bearing-independent). Order with
   * snapping: §2.3.
   */
  constraint?(): ToolConstraint | null
  activate(ctx: ToolContext, source: ToolSource | null): void
  /** A new source arrives while armed (species picked again, saved stamp changed). */
  sourceChanged?(source: ToolSource | null): void
  gesture(g: ToolGesture): ToolReply
  command(c: ToolCommand): ToolReply
  /** Scene or selection changed outside the tool (undo, remote edit); drafts were already re-projected. */
  sceneChanged?(): void
  /** True while the tool holds something Esc should drop first (draft, pick, row source). */
  hasTransient(): boolean
  /** Esc hint for the tool card, read by describeEscape. */
  escapeHint(): 'drop-transient' | 'leave-tool' | 'clear-selection' | null
  cancelTransient(reason: 'escape' | 'tool-change' | 'document-replaced' | 'navigate'): void
  /** Transient history (polygon corners), read by ToolHost.transientHistory; the tool acts on the undo-transient and redo-transient commands. */
  canUndoTransient?(): boolean
  canRedoTransient?(): boolean
  deactivate(reason: 'switch' | 'document-replaced' | 'dispose'): void
}

export type ToolConstraint =
  | { readonly kind: 'direction'; readonly origin: WorldPoint; readonly stepDeg: 45 }
  | { readonly kind: 'rotation-delta'; readonly pivot: WorldPoint; readonly startDeg: number; readonly stepDeg: 15 }

/** Arming payloads that today arrive through module-level signals. */
export type ToolSource =
  | { readonly kind: 'species'; readonly species: PlantStampSourceInput }
  | { readonly kind: 'saved-stamp'; readonly stamp: SavedObjectStampPayload }
