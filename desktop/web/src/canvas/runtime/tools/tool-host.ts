// canvas/runtime/tools/tool-host.ts
//
// Owns the ToolHost (spec §1.4, ADR 0018), the only code that builds ToolGestures. It converts the recogniser's screen
// gestures to world points at event time, resolves modifiers (§2.3), applies the active tool's constraint and the grid
// and guide snapping, and runs the interceptors (admission, handles, the inspection probe) before the tool; every raw
// press first commits the nudge series and, as today's pointerdown, closes the menu and moves focus to the map. A drag
// starts at the press's world point, and every camera frame re-emits the live drag or the resting pointer, which a
// pointer pan moves (plan §1, exception 1). It holds re-origin while a press, a tool transient or the text entry is
// open, and a plane change with no pointer resting on the map hides the tool's draft until the next hover, so no tool
// re-projects a world point it keeps (spec §4.19). The text entry's state is the chrome's, read live. It owns the passive hover, the selection decorations, the arrow-nudge series, transient history and the Esc
// queries, and merges the tool's draft with its decorations and the drop preview for the renderer. One drop route
// serves every tool (spec §1.4 "Drops"): a species drop places a plant with Place plants' placement, a saved stamp with
// the saved stamp's, then arms Select. Tools are plain objects listed in tools/registry.ts, which lists every tool id.
// The module re-exports createToolScene and builds the context-menu port, so interaction-session.ts imports nothing else
// from tools/ (P5b).

import { untracked } from '@preact/signals'
import { CanvasRuntimeCleanupError, runCanvasRuntimeCleanups } from '../cleanup'
import type { Gesture, MenuSource, PressTarget } from '../input/gestures'
import type { TargetClass } from '../input/raw-input'
import { createCanvasContextMenu } from '../interaction/canvas-context-menu'
import type { ContextMenuPort, GestureOutcome, PointerWorld, ToolHost, ToolHostDeps } from '../interaction-ports'
import type { CancelReason, CanvasDropPayload, Modifiers, PointerKind, ToolHandleId, ToolId } from '../interaction-types'
import type { CanvasDesignObjectSelectionModel } from '../runtime'
import {
  includesSceneDesignObjectTarget,
  type SceneDesignObjectTarget,
} from '../scene/design-object-targets'
import { isSceneTargetLayerLocked } from '../scene/group-members'
import { isDirectSceneDesignObjectLocked, isSceneDesignObjectLocked } from '../scene/locks'
import type { ScenePersistedState } from '../scene/types'
import { EMPTY_SELECTION_MODEL } from '../scene-runtime/selection'
import type { SceneEditCoordinator, SceneEditRunOptions, SceneEditTransaction } from '../scene-runtime/transactions'
import type { ScreenPoint, ViewFrame, ViewScreen, ViewTransform, WorldPoint } from '../view/types'
import { applyToolConstraint, type ScreenAxes } from './constraints'
import type { DraftPresentation, DraftShape, ToolHandle } from './draft'
import { measureLabelShapes, selectedZoneMeasurementLabels, type EdgeDots } from './measure-labels'
import { zoneEdgeSegment } from './hit-testing'
import { placePlantFromSpecies } from './plant-stamp'
import { TOOL_REGISTRY } from './registry'
import { placeSavedObjectStamp, savedObjectStampGhostShapes } from './saved-object-stamp'
import { bandDraft } from './select/band'
import { ROTATE_HANDLE_ID } from './select/rotate-handle'
import { selectionScreenHull } from './select/selection-hull'
import { snapAlongRay, snapWorldPoint, type SnapSettings } from './snapping'
import type {
  CanvasTool,
  HitTarget,
  ToolCommand,
  ToolContext,
  ToolEffects,
  ToolModifiers,
  ToolPoint,
  ToolReply,
  ToolScene,
  ToolSource,
  ToolView,
} from './tool'

export { createToolScene } from './spatial-index'

const NOTHING: GestureOutcome = Object.freeze({})
const QUARANTINE: GestureOutcome = Object.freeze({ quarantine: true })
/** A press the scene refused: quarantined, and its recogniser session ends with no gesture. */
const REFUSED_PRESS: GestureOutcome = Object.freeze({ quarantine: true, rejectSession: true })
/** A press the inspection probe sampled: nothing else happens until the next press. */
const CLAIMED_PRESS: GestureOutcome = Object.freeze({ rejectSession: true })
const DROP_COPY: GestureOutcome = Object.freeze({ dropEffect: 'copy' })
const DROP_NONE: GestureOutcome = Object.freeze({ dropEffect: 'none' })
/** A dragover in overview or while the scene is busy: refused. */
const REFUSED_DRAGOVER: GestureOutcome = Object.freeze({ quarantine: true, dropEffect: 'none' })
/** A species drag's cue: a band box from the pointer, this many CSS px right and down. */
const DROP_CUE_PX = 12
const NO_HANDLES: readonly ToolHandle[] = Object.freeze([])
const NO_SNAP: SnapSettings = Object.freeze({ grid: false })
/** How near a zone's edge a pointer menu offers "Turn view to this edge" (spec §4.16): a mouse 8 px, a long press 22 px
 *  (half a 44 px finger target, ADR 0010). The keyboard menu has no point. */
const MENU_EDGE_TOLERANCE_PX: Partial<Record<MenuSource, number>> = Object.freeze({
  mouse: 8,
  'long-press': 22,
})
/** Arrow-key nudge steps, in session-plane metres. */
const NUDGE_STEP_M = 0.1
const NUDGE_LARGE_STEP_M = 1
/** A pause this long ends a nudge series, so its edit commits. */
const NUDGE_SERIES_IDLE_MS = 800
/** The tools whose points Shift constrains (spec §2.3); of the handles, only the rotate handle (U36). */
const SHIFT_CONSTRAINS: ReadonlySet<ToolId> = new Set<ToolId>([
  'polygon', 'plant-spacing', 'line', 'measurement-guide', 'rectangle', 'ellipse',
])
/** The drawing tools whose draft chips replace the selected zone's. */
const ZONE_DRAFT_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['line', 'rectangle', 'ellipse', 'polygon'])

/** A press the host routed, from press to release or cancel. */
interface LiveGesture {
  readonly id: number
  readonly kind: 'tool' | 'handle'
  readonly pointer: PointerKind
  /** The press as a world point, converted once at the press, so the drag start stays on the ground (plan §1, exception 1). */
  start: ToolPoint
  readonly startHit: HitTarget | null
  readonly handle: ToolHandleId | null
  /** Where the pointer last was, re-emitted on a camera frame while the drag is live. */
  lastScreen: ScreenPoint
  lastMods: Modifiers
  dragging: boolean
  /** True once the tool changed the scene through its open Scene Edit during this press. */
  mutated: boolean
}

/** Where the pointer rests on the map: the last hover, or where a press was released, moved by a pointer pan (notePointer).
 *  Re-emitted on a camera frame while it is on the map; null with the pointer off the map or its place unknown (after a
 *  window blur or a document replacement). */
interface StillPointer {
  readonly screen: ScreenPoint
  readonly mods: Modifiers
  readonly pointer: PointerKind
}

type CancelTransientReason = Parameters<CanvasTool['cancelTransient']>[0]

/** The menu controller's (createCanvasContextMenu) options, plus what open() rebuilds the menu's selection from. */
export type ContextMenuPortOptions = Parameters<typeof createCanvasContextMenu>[0] & {
  /** The ToolScene the host hits with: a hit on a locked layer or through a locked group gets the disabled menu. */
  readonly scene: ToolScene
  /** The selection model once the host has retargeted the selection (querySurface.getDesignObjectSelection). */
  readonly selectionModel: () => CanvasDesignObjectSelectionModel
}

/**
 * ToolHostDeps.menu over the menu controller. The host hits and retargets the selection first; open() then rebuilds
 * one of three menu states: the selection's menu from the keyboard, the empty-map menu, and a right-clicked object's menu
 * (an already selected zone's fill counts as the zone), disabled when the object is on a locked layer or locked through
 * its group (contextMenuTargetAt). A
 * pointer menu carries the host's "Turn view to this edge" onto the app's request. A menu opened during the host's
 * re-origin hold (U39) kept the selection: an object hit gets the kept selection's menu, or the empty map's with none.
 */
export function createContextMenuPort(options: ContextMenuPortOptions): ContextMenuPort {
  const { scene, selectionModel, ...controllerOptions } = options
  // The controller follows every close of the app's menu through its request's `closed`.
  const controller = createCanvasContextMenu(controllerOptions)

  return {
    open(request) {
      const held = request.holdsSelectionDeletes ? { holdsSelectionDeletes: true as const } : {}
      const finish = request.finishShape ? { finishShape: request.finishShape } : {}
      if (request.at === 'selection') {
        const selection = selectionModel()
        controller.openFromKeyboard(selection, selectionScreenHull(scene, selection, controllerOptions.view()), {
          ...finish,
          ...held,
        })
        return
      }
      const screen = request.screen ?? controllerOptions.view().worldToScreen(request.at)
      const { visible, target } = contextMenuTargetAt(scene, request.at)
      const selection = target ? selectionModel() : null
      const kept = request.holdsSelectionDeletes && selection
        && selection.editableTargets.length + selection.lockedTargets.length === 0 ? null : selection
      controller.openAtPointer(
        screen,
        kept ?? (visible && !target ? EMPTY_SELECTION_MODEL : null),
        {
          ...finish,
          ...(request.turnViewToEdge ? { turnViewToEdge: request.turnViewToEdge } : {}),
          ...held,
        },
      )
    },
    close: () => controller.close(),
    isOpen: () => controller.isOpen(),
  }
}

export function createToolHost(deps: ToolHostDeps): ToolHost {
  const pointerListeners = new Set<(point: PointerWorld | null) => void>()
  /** Transactions a tool began and has not committed or aborted: its Scene Edit is open. */
  const openEdits = new Set<SceneEditTransaction>()

  let disposed = false
  let currentId: ToolId = deps.toolState.active.peek()
  /** Armed at the end of construction and never cleared: the registry is total, so every id is a tool. */
  let activeTool!: CanvasTool
  let activeSource: ToolSource | null = null
  let toolDraft: DraftPresentation | null = null
  let toolHandles: readonly ToolHandle[] = NO_HANDLES
  /** The handle the tool marks active (Select's selected corner). */
  let toolActiveHandle: ToolHandleId | null = null
  let toolGuidance: Parameters<ToolEffects['setGuidance']>[0] = null
  let live: LiveGesture | null = null
  let lastHover: StillPointer | null = null
  /** The pointer kind that last hovered, pressed or long-pressed the map, from the platform's until then
   *  (ToolContext.pointer): a tool armed later, or a selection made off the map, sizes its handles for it. */
  let pointerKind: PointerKind = deps.initialPointer
  /** Under Text, the raw press found the note's entry open: its focus move committed the note, and the press places
   *  nothing. */
  let pressCommitsNote = false
  /** The tool's draft is hidden until the pointer next hovers or presses over the map: a panel drag passed over the map, whose
   *  drop preview replaces it (a dragover takes the draft's place and a pointer move gives it back), or a
   *  re-origin with no pointer resting on the map moved the plane under the world points it was drawn at (spec §4.19). */
  let draftHidden = false
  /** What a drop would place, while a panel drag is over the map: a species' band cue or a saved stamp's ghosts. */
  let dropPreview: readonly DraftShape[] | null = null
  let nudging = false
  let nudgeTimer: number | null = null
  let callDepth = 0
  /** A fault is being handled: a tool call that throws during it is not handled again. */
  let faulting = false
  /** An activation, or any step of arming a tool, threw during the outermost call: its fault arms Select. */
  let selectOnFault = false
  let invalidateNeeded = false
  let planeRevision = frame().view.planeRevision
  let mode = frame().mode
  let publishedToolDraft: DraftPresentation | null = null
  let publishedDropPreview: readonly DraftShape[] | null = null
  let publishedDecorations = ''
  let publishedHandles: readonly ToolHandle[] = NO_HANDLES
  let publishedActiveHandle: ToolHandleId | null = null
  let publishedGuidance: string | null = null

  function frame(): ViewFrame {
    return deps.frames.viewFrame.peek()
  }

  const view: ToolView = {
    /** In [0, 360) by the ViewCamera contract, so a tool can store it as a rotation (a note, a saved stamp's pick). */
    get bearingDeg() {
      return frame().view.camera.bearingDeg
    },
    get mode() {
      return frame().mode
    },
    metresPerPixelAt: (p) => frame().view.metresPerPixelAt(p),
    screenDistance: (a, b) => frame().view.screenDistance(a, b),
    screenAxesInWorld: () => frame().view.screenAxesInWorld(),
    screenAlignedRect: (a, b, options) => screenAlignedRect(frame().view, a, b, options),
  }

  // ── Tool calls ────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Every call into the tool: afterwards transient history bumps, and drafts, handles, guidance and redraws are flushed.
   * Calls run untracked: the runtime refreshes the session from inside its camera-frame effect, which must not come to
   * depend on what the tool reads, nor re-run on the transient-history revision the call bumps. The outermost call that
   * throws runs the fault rule (fault).
   */
  function callTool<T>(run: () => T): T {
    return untracked(() => {
      callDepth += 1
      try {
        return run()
      } catch (error) {
        if (callDepth === 1 && !faulting) throw fault(error)
        throw error
      } finally {
        callDepth -= 1
        if (callDepth === 0) {
          selectOnFault = false
          afterToolCall()
        }
      }
    })
  }

  /**
   * The fault rule (spec §1.4 "Faults"), at the outermost tool call only, once: the open edits are aborted, the live press
   * ends, the text entry closes and a fresh instance of the current tool is armed (Select if arming threw). The faulted
   * instance hears no deactivate. A re-arm that throws arms a fresh Select, and a failure during the re-arm is not handled
   * again. Returns the call's error, or it with the recovery's own failures.
   */
  function fault(error: unknown): unknown {
    faulting = true
    const id = selectOnFault ? 'select' : currentId
    live = null
    const errors: unknown[] = [error]
    for (const step of [abortOpenEdits, closeTextEntry, () => rearm(id)]) {
      try {
        step()
      } catch (failure) {
        errors.push(failure)
      }
    }
    faulting = false
    return errors.length === 1 ? error : new CanvasRuntimeCleanupError('A tool call failed, and so did its recovery', errors)
  }

  function rearm(id: ToolId): void {
    if (disposed) return
    try {
      activate(id, id === currentId ? activeSource : null)
    } catch (failure) {
      if (id !== 'select') {
        activate('select', null)
        followArmedTool()
      }
      throw failure
    }
  }

  /** A fault outside setTool armed Select: the session's tool signal follows it through the tool-request path, so the rail
   *  and the card name the tool that runs (B6). setTool's own caller names its fallback itself. */
  function followArmedTool(): void {
    if (deps.toolState.active.peek() !== currentId) deps.toolState.set(currentId)
  }

  function afterToolCall(): void {
    deps.transientHistoryChanged()
    flush()
  }

  /** A change made outside a tool call (a deferred commit, a host selection write) is flushed at once. */
  function changed(): void {
    invalidateNeeded = true
    if (callDepth === 0) flush()
  }

  function flush(): void {
    if (disposed) return
    publishDraft()
    publishHandles()
    publishGuidance()
    if (!invalidateNeeded) return
    invalidateNeeded = false
    deps.invalidate()
  }

  function contextFor(tool: CanvasTool): ToolContext {
    const owns = (): boolean => activeTool === tool && !disposed
    const effects: ToolEffects = {
      edits: trackedEdits(),
      setSelection(targets) {
        if (!owns()) return
        deps.setSelection(targets)
        changed()
      },
      setDraft(draft) {
        if (!owns()) return
        toolDraft = draft
        changed()
      },
      setHandles(handles, active = null) {
        // The same handles again (a refresh after a camera frame or a scene change) change nothing and redraw nothing.
        if (!owns() || (sameHandles(toolHandles, handles) && active === toolActiveHandle)) return
        toolHandles = handles
        toolActiveHandle = active
        changed()
      },
      setGuidance(guidance) {
        if (!owns()) return
        toolGuidance = guidance
        if (callDepth === 0) publishGuidance()
      },
      requestTool(id) {
        if (owns()) requestTool(id)
      },
      requestTextEntry(request, submit, onCancel) {
        if (!owns()) return
        deps.chrome.requestTextEntry(request, (text) => {
          const reply = callTool(() => submit(text))
          // A closed entry shows Select's handles again at once, and ends
          // its re-origin hold as a tool call does.
          if (reply === 'close' && deps.chrome.isTextEntryOpen()) {
            deps.chrome.closeTextEntry()
            afterToolCall()
          }
          return reply
        }, () => {
          // The entry's own Esc closed it: the tool follows, as a tool call, which also ends the entry's re-origin hold.
          if (owns()) callTool(() => onCancel?.())
        })
      },
      closeTextEntry() {
        if (owns()) closeTextEntry()
      },
      requestFocus() {
        if (owns()) deps.focus.focusMap()
      },
    }
    return {
      view,
      scene: deps.scene,
      effects,
      settings: deps.settings,
      snap: (point) => snap(point, false),
      focusedHandle: () => deps.chrome.focusedHandle(),
      pointer: () => pointerKind,
      translate: deps.translate,
    }
  }

  /** The tool's transactions, watched: an open one's mutation redraws after the call, and a commit's callback settles. */
  function trackedEdits(): SceneEditCoordinator {
    return {
      run(type, edit, options) {
        return deps.edits.run(type, (tx) => edit(watchTransaction(tx, false)), settlingCommit(options))
      },
      begin(type, options) {
        const tx = deps.edits.begin(type, settlingCommit(options))
        openEdits.add(tx)
        return watchTransaction(tx, true)
      },
    }
  }

  function watchTransaction(tx: SceneEditTransaction, open: boolean): SceneEditTransaction {
    return {
      mutate(edit) {
        tx.mutate(edit)
        if (!open) return
        invalidateNeeded = true
        if (live) live.mutated = true
      },
      setSelection: (targets) => tx.setSelection(targets),
      commit() {
        const committed = tx.commit()
        openEdits.delete(tx)
        return committed
      },
      abort() {
        tx.abort()
        openEdits.delete(tx)
        // The scene is back as it was before the edit: redraw it.
        if (open) invalidateNeeded = true
      },
      get changed() {
        return tx.changed
      },
    }
  }

  /** A commit's onCommitted may run later (a deferred commit): transient history bumps after it all the same. */
  function settlingCommit<T extends Pick<SceneEditRunOptions, 'onCommitted'>>(options: T | undefined): T | undefined {
    const onCommitted = options?.onCommitted
    if (!options || !onCommitted) return options
    return {
      ...options,
      onCommitted: () => {
        try {
          onCommitted()
        } finally {
          if (callDepth === 0 && !disposed) afterToolCall()
        }
      },
    } as T
  }

  function hasActiveSceneEdit(): boolean {
    return openEdits.size > 0
  }

  // ── Points ────────────────────────────────────────────────────────────────────────────────────────────────────────

  function snap(point: WorldPoint, noSnap: boolean): WorldPoint {
    return snapWorldPoint(point, noSnap ? NO_SNAP : deps.snapping(), frame().view.pixelsPerMetre)
  }

  /** Modifiers by meaning (spec §2.3), read from the event that carries them, with no platform dependency. */
  function resolveModifiers(mods: Modifiers, handle: ToolHandleId | null): ToolModifiers {
    return {
      additive: mods.shift || mods.ctrl || mods.meta,
      subtractive: mods.alt,
      constrain: mods.shift && (handle === ROTATE_HANDLE_ID || SHIFT_CONSTRAINS.has(currentId)),
      noSnap: (mods.ctrl || mods.meta) && currentId === 'plant-spacing',
    }
  }

  /** The tool's point at a screen point of the current frame. */
  function pointAt(screen: ScreenPoint, mods: Modifiers, pointer: PointerKind, handle: ToolHandleId | null = null): ToolPoint {
    const view = frame().view
    const at = activeTool.clampsToView ? clampToScreen(screen, view.screen) : screen
    return resolvePoint(view.screenToWorld(at), mods, pointer, handle)
  }

  function resolvePoint(world: WorldPoint, mods: Modifiers, pointer: PointerKind, handle: ToolHandleId | null): ToolPoint {
    const modifiers = resolveModifiers(mods, handle)
    const free = snap(world, modifiers.noSnap)
    const constraint = modifiers.constrain ? activeTool.constraint?.() ?? null : null
    if (!constraint) return { world, free, constrained: world, snapped: free, modifiers, pointer }
    // Shift's steps turn against the screen axes (spec §4.7), which are the world's at bearing 0, bit for bit.
    const axes: ScreenAxes = frame().view.screenAxesInWorld()
    const constrained = applyToolConstraint(constraint, world, axes)
    if (constraint.kind === 'rotation-delta') {
      return { world, free, constrained, snapped: constrained, modifiers, pointer }
    }
    // One order for every tool: the constraint, then the length along its ray rounded to the grid's interval.
    const snapped = snapAlongRay(constraint.origin, constrained, modifiers.noSnap ? NO_SNAP : deps.snapping(), frame().view.pixelsPerMetre)
    return { world, free, constrained, snapped, modifiers, pointer }
  }

  function hitAt(world: WorldPoint): HitTarget | null {
    return deps.scene.hitAt(world)
  }

  // ── Drafts, handles, guidance, cursor ────────────────────────────────────────────────────────────────────────────

  /** The tool's draft, the drop preview and the host's decorations, merged for the renderer. */
  function publishDraft(): void {
    const shownToolDraft = draftHidden ? null : toolDraft
    const decorations = decorationShapes()
    const key = decorations.length > 0 ? JSON.stringify(decorations) : ''
    if (shownToolDraft === publishedToolDraft && dropPreview === publishedDropPreview && key === publishedDecorations) return
    publishedToolDraft = shownToolDraft
    publishedDropPreview = dropPreview
    publishedDecorations = key
    const shapes = [...(shownToolDraft?.shapes ?? []), ...(dropPreview ?? []), ...decorations]
    deps.renderer.setDraft(shapes.length > 0 ? { shapes } : null)
  }

  /**
   * The selection decorations the host draws whatever tool is armed: the single selected zone's W/H, edge and area chips
   * (as before v2, at a4c86d39, the zone tool drew them under every tool). They hide while the armed Line, Rectangle, Ellipse or Polygon
   * draft carries measure labels.
   */
  function decorationShapes(): DraftShape[] {
    if (zoneDraftHidesChips()) return []
    const selection = deps.scene.selection()
    const labels = selectedZoneMeasurementLabels(deps.scene.persisted, selection)
    if (labels.length === 0) return []
    const view = frame().view
    return measureLabelShapes(labels, (a, b) => view.screenDistance(a, b), shownEdgeDots(selection[0]!.id, view))
  }

  /** The selected polygon's edges whose midpoint dots show now, so their chips sit beside them (U38). */
  function shownEdgeDots(zoneId: string, view: ViewTransform): EdgeDots | undefined {
    const prefix = `edge-mid:${zoneId}:`
    const edges = new Set(shownHandles().flatMap((handle) =>
      handle.glyph === 'midpoint' && handle.id.startsWith(prefix) ? [Number(handle.id.slice(prefix.length))] : []))
    const zone = edges.size > 0 ? deps.scene.persisted.zones.find((entry) => entry.id === zoneId) : undefined
    return zone ? { corners: zone.points, edges, screenAxes: view.screenAxesInWorld() } : undefined
  }

  function zoneDraftHidesChips(): boolean {
    if (!ZONE_DRAFT_TOOLS.has(currentId)) return false
    return toolDraft?.shapes.some((shape) =>
      shape.kind === 'label' && (shape.tone === 'measure' || shape.tone === 'measure-quiet')) ?? false
  }

  function publishHandles(): void {
    const handles = shownHandles()
    const active = live?.kind === 'handle' ? live.handle : handles === NO_HANDLES ? null : toolActiveHandle
    if (handles === publishedHandles && active === publishedActiveHandle) return
    publishedHandles = handles
    publishedActiveHandle = active
    deps.chrome.setHandles(handles, active)
  }

  /**
   * Select's handles show only while its affordances may: in site mode, with the text entry closed and no Scene Edit
   * open. A handle's own press keeps them until its edit first changes the scene: a handle drag hides them at its first
   * update.
   */
  function shownHandles(): readonly ToolHandle[] {
    if (currentId !== 'select') return toolHandles
    const affordancesShown = frame().mode === 'site'
      && !deps.chrome.isTextEntryOpen()
      && (!hasActiveSceneEdit() || (live?.kind === 'handle' && !live.mutated))
    return affordancesShown ? toolHandles : NO_HANDLES
  }

  function publishGuidance(): void {
    if (disposed) return
    const guidance = {
      gesture: toolGuidance?.gesture ?? hasActiveSceneEdit(),
      stamp: toolGuidance?.stamp ?? null,
      stampRotationDeg: toolGuidance?.stampRotationDeg ?? null,
      promptSpecies: toolGuidance?.promptSpecies ?? false,
      plantRow: toolGuidance?.plantRow ?? null,
    }
    const key = JSON.stringify(guidance)
    if (key === publishedGuidance) return
    publishedGuidance = key
    deps.guidance(guidance)
  }

  function resetCursor(): void {
    deps.chrome.setCursor(cursorForTool(currentId))
  }

  // ── Passive hover and the pointer's world point ─────────────────────────────────────────────────────────────────

  function publishPointer(point: PointerWorld | null): void {
    for (const listener of [...pointerListeners]) listener(point)
  }

  /** The pointer's world point at a screen point on the map; none off it. */
  function publishPointerAt(at: ScreenPoint, pointer: PointerKind): void {
    if (insideScreen(at, frame().view.screen)) publishPointer({ world: frame().view.screenToWorld(at), screen: at, pointerKind: pointer })
  }

  function clearPassiveHover(): void {
    deps.hover(null)
    deps.chrome.setTooltip(null)
  }

  /** The passive hover: the restyle (a directly locked object shows the locked hover stroke) and the plant tooltip. */
  function passiveHover(world: WorldPoint, at: ScreenPoint): void {
    const visible = objectTarget(deps.scene.hitAt(world, { includeLocked: true }))
    deps.hover(visible)
    deps.chrome.setTooltip(visible?.kind === 'plant' ? { target: visible, at } : null)
  }

  /** The tool's hover, then the passive hover unless the tool handled it. */
  function deliverHover(tool: CanvasTool, at: ScreenPoint, mods: Modifiers, pointer: PointerKind): void {
    if (toolHover(tool, at, mods, pointer) === 'handled') clearPassiveHover()
    else passiveHoverAt(at)
  }

  function toolHover(tool: CanvasTool, at: ScreenPoint, mods: Modifiers, pointer: PointerKind): ToolReply {
    const point = pointAt(at, mods, pointer)
    return callTool(() => tool.gesture({ kind: 'hover', point, hit: hitAt(point.world) }))
  }

  // ── Gestures ──────────────────────────────────────────────────────────────────────────────────────────────────────

  function hover(g: Extract<Gesture, { kind: 'hover' }>): GestureOutcome {
    // The lens hears only moves over the map: not over the canvas's own chrome (buttons, inputs, textareas,
    // contenteditable and [data-preserve-overlays]), nor off the map.
    if (g.target.kind === 'surface') publishPointerAt(g.at, g.pointer)
    // The pointer is back over the map after a panel drag: the tool's draft shows again.
    showDraftAfterDrop()
    const tool = activeTool
    if (frame().mode === 'overview') {
      lastHover = null
      clearPassiveHover()
      return NOTHING
    }
    lastHover = insideScreen(g.at, frame().view.screen) ? { screen: g.at, mods: g.mods, pointer: g.pointer } : null
    deliverHover(tool, g.at, g.mods, g.pointer)
    return NOTHING
  }

  /** The tool's draft, hidden since a panel drag passed over the map or a re-origin, shows again. */
  function showDraftAfterDrop(): void {
    if (!draftHidden) return
    draftHidden = false
    changed()
  }

  function hideDraftUntilHover(): void {
    if (draftHidden) return
    draftHidden = true
    changed()
  }

  function hoverEnd(): GestureOutcome {
    publishPointer(null)
    lastHover = null
    const tool = activeTool
    clearPassiveHover()
    callTool(() => tool.gesture({ kind: 'hover-end' }))
    return NOTHING
  }

  /**
   * Every raw pointerdown on the map host, reported by the session before it routes the press:
   * any button commits the nudge series. An admitted press of any button outside the text entry, with no live press from
   * another pointer, also closes the menu and moves focus to the map, so an open text entry commits before the press
   * reaches the tool (focusMap) and a right-drag pan or a still right-click closes it; a click inside the entry keeps it
   * open. A right press closes an open menu, and its still release opens the next one, so a double right-click replaces
   * the menu (spec §3.1). While Text is armed a primary press that so commits
   * the entry places nothing: no tool hears it, as the Text field takes that click (spec §3.2); under another tool the
   * press goes on. A press on the live press's own pointer (its up was lost) counts. The host knows only its own
   * live press: a pan lives in the recogniser, which ignores a second pointer anyway.
   */
  function rawPress(button: 'primary' | 'secondary' | 'middle', target: TargetClass, pointerId?: number): void {
    if (disposed) return
    pressCommitsNote = false
    endNudgeSeries(true)
    if (live && live.id !== pointerId) return
    if (target.kind === 'owned-text') return
    // Runs only while the Scene is settled; a refused raw press does nothing, and the press that follows asks again.
    deps.admission.runWhenSettled(() => {
      deps.menu.close()
      // Today's Text took the click that found its note field open to commit the note, and placed nothing (spec §3.2).
      pressCommitsNote = button === 'primary' && currentId === 'text' && deps.chrome.isTextEntryOpen()
      focusMap()
      return true
    }, false)
  }

  function press(g: Extract<Gesture, { kind: 'press' }>): GestureOutcome {
    const commitsNote = pressCommitsNote
    pressCommitsNote = false
    // A pen or a finger reaches the map with no hover after a panel drag: its press shows the tool's draft again.
    showDraftAfterDrop()
    if (live) cancelLive('pointercancel')
    // The pointer is pressed now: a frame re-emits its drag, not the hover before it.
    lastHover = null
    // An overview press pans in the recogniser and never reaches the host (U36); nothing here samples or edits.
    if (frame().mode === 'overview') return NOTHING
    let claimed = false
    const admitted = deps.admission.runWhenSettled(() => {
      claimed = pressWhenSettled(g, commitsNote)
      return true
    }, false)
    if (!admitted) return REFUSED_PRESS
    return claimed ? CLAIMED_PRESS : NOTHING
  }

  /** Today's _pointerDownWhenSettled, in order: the press's capture, handles, the probe, the tool. Focus moved at the raw
   *  press (rawPress), so an open text entry has committed. A capture lost while it is taken (a synchronous lostpointercapture)
   *  ended the press: nothing else happens, as today's check after capture. A press that committed a new note (`commitsNote`)
   *  ends where today's Text adapter took it: the tool hears none of it, nor its drag or release. */
  function pressWhenSettled(g: Extract<Gesture, { kind: 'press' }>, commitsNote: boolean): boolean {
    const tool = activeTool
    if (!deps.capturePress(g.id)) return true
    const handle = g.target.kind === 'handle' ? g.target.id : null
    const point = pointAt(g.at, g.mods, g.pointer, handle)
    if (handle) {
      live = liveGesture(g, 'handle', point, null)
      publishHandles()
      callTool(() => tool.gesture({ kind: 'handle-drag', phase: 'start', handle, point, start: point, clickCount: g.clickCount }))
      clearPassiveHoverForEdit()
      return false
    }
    // Inspection owns the plain primary press, after handles and the pan check and before the tool; a Pan-tool press
    // never samples (spec §3.8, fixture J10).
    if (currentId !== 'hand' && deps.inspect?.(point.world)) return true
    if (commitsNote) return false
    const hit = hitAt(point.world)
    live = liveGesture(g, 'tool', point, hit)
    callTool(() => tool.gesture({ kind: 'press', point, hit, clickCount: g.clickCount }))
    clearPassiveHoverForEdit()
    return false
  }

  /** A press that opened a Scene Edit (a move or a handle drag) clears the passive hover, as today's drag presentation did. */
  function clearPassiveHoverForEdit(): void {
    if (hasActiveSceneEdit()) clearPassiveHover()
  }

  function liveGesture(
    g: Extract<Gesture, { kind: 'press' }>,
    kind: LiveGesture['kind'],
    start: ToolPoint,
    startHit: HitTarget | null,
  ): LiveGesture {
    const target: PressTarget = g.target
    return {
      id: g.id,
      kind,
      pointer: g.pointer,
      start,
      startHit,
      handle: target.kind === 'handle' ? target.id : null,
      lastScreen: g.at,
      lastMods: g.mods,
      dragging: false,
      mutated: false,
    }
  }

  function drag(
    g: Extract<Gesture, { kind: 'drag-start' | 'drag-move' | 'drag-end' }>,
  ): GestureOutcome {
    const gesture = live
    if (!gesture) {
      // The drag of a press the tool never heard (a new note's committing click): its release is none of the tool's.
      if (g.kind === 'drag-end') releasedOutsideTool()
      return NOTHING
    }
    if (gesture.id !== g.id) return NOTHING
    gesture.dragging = true
    gesture.lastScreen = g.at
    // A modifier change applies at the next move (A17): the release commits with the modifiers its last preview drew.
    if (g.kind !== 'drag-end') gesture.lastMods = g.mods
    const tool = activeTool
    if (g.kind !== 'drag-end') {
      deliverDrag(tool, gesture, g.kind)
      return NOTHING
    }
    return release(tool, () => {
      try {
        deliverDrag(tool, gesture, 'drag-end')
      } finally {
        endLive({ screen: g.at, mods: g.mods, pointer: gesture.pointer })
      }
    })
  }

  /**
   * A tool's release: at once, or inside the scene's admission while the tool's settledRelease() answers true (Select's
   * band: today's requiresSettledPointerUp). A refused settled release cancels the tool, as today's refused pointerup
   * cancelled the transient interaction, and is quarantined.
   */
  function release(tool: CanvasTool, finish: () => void): GestureOutcome {
    if (!tool.settledRelease?.()) {
      finish()
      return NOTHING
    }
    const admitted = deps.admission.runWhenSettled(() => {
      finish()
      return true
    }, false)
    if (admitted) return NOTHING
    cancelTransientInteraction('tool-change')
    return QUARANTINE
  }

  /**
   * The drag at its last screen point, converted through the current frame; its start is the press's world point. A
   * camera frame's re-emit runs no passive hover (`reemit`).
   */
  function deliverDrag(tool: CanvasTool, gesture: LiveGesture, kind: 'drag-start' | 'drag-move' | 'drag-end', passive = true): void {
    const point = pointAt(gesture.lastScreen, gesture.lastMods, gesture.pointer, gesture.handle)
    if (kind === 'drag-end') live = null
    const start = gesture.start
    if (gesture.kind === 'handle') {
      const phase = kind === 'drag-end' ? 'end' : 'move'
      callTool(() => tool.gesture({ kind: 'handle-drag', phase, handle: gesture.handle!, point, start }))
    } else {
      const reply = callTool(() => tool.gesture({ kind, point, start, startHit: gesture.startHit }))
      // A move the tool passes is none of its press's (Plant a row's missed press, a stamp with nothing held, a polygon
      // press that added no corner): it is a hover with the button down, as today's press that cleared its gesture left
      // the next moves to _updateHover. A tool that keeps its press answers 'handled' (ToolReply).
      if (passive && kind !== 'drag-end' && reply === 'pass') passiveHoverAt(gesture.lastScreen)
    }
  }

  /** The passive hover at a screen point, cleared off the map. */
  function passiveHoverAt(at: ScreenPoint): void {
    if (insideScreen(at, frame().view.screen)) passiveHover(frame().view.screenToWorld(at), at)
    else clearPassiveHover()
  }

  function tap(g: Extract<Gesture, { kind: 'tap' }>): GestureOutcome {
    const gesture = live
    // A finger never hovers: its tap publishes the pointer at the resolved press, the down point, as a mouse's hover before
    // its press did (A16); not on a handle, as a hover there publishes none. A finger's drag or pair publishes nothing.
    if (g.pointer === 'touch' && gesture?.kind !== 'handle') publishPointerAt(g.at, g.pointer)
    if (!gesture) {
      // A press the tool never heard (a new note's committing click): its release is none of the tool's.
      releasedOutsideTool()
      return NOTHING
    }
    if (gesture.id !== g.id) return NOTHING
    const tool = activeTool
    return release(tool, () => {
      live = null
      try {
        if (gesture.kind === 'handle') {
          // A handle tap ends where it was pressed (A9): the jitter within the slop moves, turns or reshapes nothing.
          callTool(() => tool.gesture({
            kind: 'handle-drag', phase: 'end', handle: gesture.handle!, point: gesture.start, start: gesture.start,
          }))
        } else {
          const point = pointAt(g.at, g.mods, g.pointer)
          callTool(() => tool.gesture({ kind: 'tap', point, hit: hitAt(point.world), clickCount: g.clickCount }))
        }
      } finally {
        endLive({ screen: g.at, mods: g.mods, pointer: g.pointer })
      }
    })
  }

  // ── Drops ────────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The one drop route, whatever tool is armed (today's _onDragOver, _onDragLeave and _onDrop): a dragover answers 'copy'
   * or 'none' and shows the drop preview, a drop places its payload, a dragleave clears the preview. Any dragover hides the
   * tool's draft (a stamp's pick ghost), as today's dragover took over the one preview element the ghost shared; dragleave
   * and drop leave it hidden, and the next hover or press over the map brings it back.
   */
  function drop(g: Extract<Gesture, { kind: 'drop' }>): GestureOutcome {
    switch (g.phase) {
      case 'over': return dragOver(g.at, g.payload)
      case 'drop': return dropAt(g.at, g.payload)
      case 'leave':
        setDropPreview(null)
        return NOTHING
    }
  }

  /**
   * Today's _onDragOver: in overview or while the scene is busy the dragover is refused ('none', quarantined);
   * otherwise its effect comes from the payload kind and the open layers, read when settled. Every refusal and every
   * 'none' clears the preview.
   */
  function dragOver(at: ScreenPoint, payload: CanvasDropPayload): GestureOutcome {
    hideDraftUntilHover()
    if (frame().mode === 'overview') return refuseDragOver()
    let preview: readonly DraftShape[] | null | undefined
    try {
      // undefined: the scene was too busy to read.
      preview = deps.settled.readWhenSettled<readonly DraftShape[] | null | undefined>(
        () => dropPreviewAt(at, payload),
        undefined,
      )
    } catch (error) {
      setDropPreview(null)
      throw error
    }
    if (preview === undefined) return refuseDragOver()
    setDropPreview(preview)
    return preview ? DROP_COPY : DROP_NONE
  }

  function refuseDragOver(): GestureOutcome {
    setDropPreview(null)
    return REFUSED_DRAGOVER
  }

  /**
   * What a drop at `at` would place, drawn as the drop preview; null when it would place nothing. A species shows today's
   * cue, a box from the pointer drawn as the band select's draft (its data is unreadable until the drop); a saved stamp
   * shows its ghosts with the anchor at the snapped point (today's previewSavedObjectStampAt), turned by the bearing as
   * its drop is.
   */
  function dropPreviewAt(at: ScreenPoint, payload: CanvasDropPayload): readonly DraftShape[] | null {
    const transform = frame().view
    const world = transform.screenToWorld(at)
    if (payload.kind === 'saved-stamp') {
      return savedObjectStampGhostShapes(deps.scene, payload.stamp, snap(world, false), view.bearingDeg)
    }
    if (payload.kind !== 'species' || !deps.scene.isLayerOpenForCreation('plants')) return null
    const corner = transform.screenToWorld({ x: at.x + DROP_CUE_PX, y: at.y + DROP_CUE_PX })
    return bandDraft(view, { start: world, additive: false }, corner).shapes
  }

  /**
   * Today's _onDrop: the preview clears; in overview, or while the scene does not admit it, the drop is quarantined.
   */
  function dropAt(at: ScreenPoint, payload: CanvasDropPayload): GestureOutcome {
    setDropPreview(null)
    if (frame().mode === 'overview') return QUARANTINE
    const admitted = deps.admission.runWhenSettled(() => {
      placeDrop(at, payload)
      return true
    }, false)
    return admitted ? NOTHING : QUARANTINE
  }

  /** Today's _dropWhenSettled: the payload at the snapped point, as one Scene Edit that selects what it placed. A saved
   *  stamp is turned by the bearing, so it lands level with the screen as a click of the stamp tool places it (spec §4.7). */
  function placeDrop(at: ScreenPoint, payload: CanvasDropPayload): void {
    const point = snap(frame().view.screenToWorld(at), false)
    if (payload.kind === 'saved-stamp') {
      placeSavedObjectStamp(deps.edits, deps.scene, payload.stamp, point, {
        rotationDeg: view.bearingDeg,
        onCommitted: () => dropped('saved-stamp'),
      })
    } else if (payload.kind === 'species' && payload.species) {
      const target = { edits: deps.edits, scene: deps.scene }
      placePlantFromSpecies(target, payload.species, point, 'interaction-drop', () => dropped('species'))
    }
  }

  /** Once a drop's edit commits: Select, the map's focus, then the session's follow-up (ToolHostDeps.dropped), as today. */
  function dropped(kind: 'species' | 'saved-stamp'): void {
    if (disposed) return
    requestTool('select')
    deps.focus.focusMap()
    deps.dropped(kind)
  }

  function setDropPreview(shapes: readonly DraftShape[] | null): void {
    if (shapes === null && dropPreview === null) return
    dropPreview = shapes
    changed()
  }

  function cancel(g: Extract<Gesture, { kind: 'cancel' }>): GestureOutcome {
    if (!live) return NOTHING
    callTool(() => {
      cancelLive(g.reason)
      clearPassiveHover()
      resetCursor()
    })
    return NOTHING
  }

  /**
   * After a press ends: today's pointerup clears the passive hover and resets the cursor to the tool's. A mouse or pen
   * rests where it was released, so the next camera frame re-emits a hover there (plan §1, exception 1); a lifted finger
   * leaves nothing under it.
   */
  function endLive(released: StillPointer | null = null): void {
    live = null
    lastHover = released
      && released.pointer !== 'touch'
      && frame().mode === 'site'
      && insideScreen(released.screen, frame().view.screen)
      ? released
      : null
    clearPassiveHover()
    resetCursor()
    flush()
  }

  function cancelLive(reason: CancelReason): void {
    const gesture = live
    if (!gesture) return
    live = null
    const tool = activeTool
    callTool(() => tool.gesture({ kind: 'cancel', reason }))
  }

  // ── Cancellation and interruption ────────────────────────────────────────────────────────────────────────────────

  function abortOpenEdits(): void {
    for (const tx of [...openEdits]) {
      openEdits.delete(tx)
      try {
        tx.abort()
      } finally {
        invalidateNeeded = true
      }
    }
  }

  /**
   * Today's _cancelTransientInteraction: the series, the live press, the drop preview (today's one preview element), the
   * passive hover, the tool's transient, the cursor. One tool call: a failure of any step faults once, after them all.
   */
  function cancelTransientInteraction(reason: CancelTransientReason): void {
    callTool(() => {
      const tool = activeTool
      runCanvasRuntimeCleanups([
        () => endNudgeSeries(true),
        () => cancelLive(reason === 'navigate' ? 'blur' : 'tool-change'),
        () => setDropPreview(null),
        () => clearPassiveHover(),
        () => tool.cancelTransient(reason),
        () => resetCursor(),
      ], 'Tool host cancellation failed')
    })
  }

  /**
   * Today's pointerup cleanup after a release that ended no press of the tool's (ToolHost.released): the end or cancel of
   * a pointer pan, a right-click release, a release off the map, a press the tool never heard. The series
   * commits, the drop preview and the passive hover clear, the tool's cancelTransient('navigate') runs, as after a pan
   * (Polygon keeps a draft with corners and drops a redo-only history; a stamp hides its ghost until the next hover), and
   * the cursor returns to the tool's. A press of the tool's that is still live ends on its own release instead.
   */
  function releasedOutsideTool(): void {
    if (live) return
    cancelTransientInteraction('navigate')
  }

  /** A press or a menu moves focus to the map, which commits an open text entry as today's explicit commit did: one that
   *  holds focus on the blur this causes, one whose blur commit was refused (it no longer holds focus) by its submit. */
  function focusMap(): void {
    const entryOpen = deps.chrome.isTextEntryOpen()
    if (entryOpen) deps.chrome.submitUnfocusedTextEntry()
    deps.focus.focusMap()
    // Select's handles, hidden while the entry was open, follow at once.
    if (entryOpen) flush()
  }

  function closeTextEntry(): void {
    if (deps.chrome.isTextEntryOpen()) deps.chrome.closeTextEntry()
  }

  /** Entering overview commits and closes an open text entry (one whose commit is refused is discarded through its
   *  opener's cancel, so the tool resets), and drops the menu and every transient. */
  function enterOverview(): void {
    lastHover = null
    setDropPreview(null)
    runCanvasRuntimeCleanups([
      () => {
        if (!deps.chrome.isTextEntryOpen()) return
        focusMap()
        if (deps.chrome.isTextEntryOpen()) deps.chrome.cancelTextEntry()
      },
      () => cancelTransientInteraction('overview'),
      () => deps.menu.close(),
    ], 'Tool host overview transition failed')
  }

  // ── Frames and planes ────────────────────────────────────────────────────────────────────────────────────────────

  function onFrame(next: ViewFrame): void {
    if (disposed) return
    // A plane change (a re-origin, which waits while a press, a transient or the text entry holds it) leaves a ghost's
    // world point in the old plane: no tool re-projects it. Under a still pointer on the map the re-emitted hover below
    // redraws it in the new plane; with none it hides until the next hover.
    if (next.view.planeRevision !== planeRevision) {
      planeRevision = next.view.planeRevision
      if (!restingPointer()) hideDraftUntilHover()
    }
    if (next.mode !== mode) {
      mode = next.mode
      if (mode === 'overview') enterOverview()
    }
    refreshAtPointer(activeTool)
    flush()
  }

  /**
   * The live drag or the last hover is re-emitted from its screen point, so a draft, a ghost or a preview stays on the
   * ground under a still pointer (plan §1, exception 1). With the pointer off the map the tool rebuilds its
   * scale-dependent draft instead, as today's refreshViewportDependent did on every camera change.
   */
  function refreshAtPointer(tool: CanvasTool): void {
    if (!reemit(tool) && tool.viewChanged) callTool(() => tool.viewChanged!())
  }

  /**
   * Re-emits the live drag or the resting pointer to the tool only; false when nothing is under a still pointer on the
   * map. The hover stays put while the map moves (U44, Q3 D): the ring, a note's revealed text or a guide's chip stays
   * on its object until the next pointer move, so a pan frame does no hover sync, and the tooltip hides, also under a
   * press that has not dragged yet.
   */
  function reemit(tool: CanvasTool): boolean {
    if (frame().mode !== 'site') return false
    const gesture = live
    if (gesture) {
      if (!gesture.dragging) {
        deps.chrome.setTooltip(null)
        return false
      }
      deliverDrag(tool, gesture, 'drag-move', false)
    } else {
      const still = restingPointer()
      if (!still) return false
      toolHover(tool, still.screen, still.mods, still.pointer)
    }
    deps.chrome.setTooltip(null)
    return true
  }

  /** A live press, a tool transient or an open text entry: re-origin waits, and the selection's deletes are held (U39). */
  function holdsReorigin(): boolean {
    return live !== null || activeTool.hasTransient() || deps.chrome.isTextEntryOpen()
  }

  /** The last hover while it rests on the map in site mode; a pointer pan may have carried it past the map's edge. */
  function restingPointer(): StillPointer | null {
    const still = lastHover
    return frame().mode === 'site' && still && insideScreen(still.screen, frame().view.screen) ? still : null
  }

  // ── Menus ────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Hit, retarget the selection to the object under the pointer (history-free), then open the menu, with "Finish shape"
   *  when the armed tool can finish its draft and "Turn view to this edge" when the pointer is on a zone's edge. During the
   *  re-origin hold (`held`, U39) the selection is kept and the menu disables Cut and Delete. */
  function openMenuAt(at: ScreenPoint, source: MenuSource, held: boolean): void {
    const world = frame().view.screenToWorld(at)
    const { target } = contextMenuTargetAt(deps.scene, world)
    if (!held && target && !includesSceneDesignObjectTarget(deps.scene.selection(), target)) {
      deps.setSelection([target])
      notifySceneChanged()
    }
    const turnViewToEdge = edgeTurnAt(world, source)
    deps.menu.open({
      at: world,
      screen: at,
      ...toolMenuEntries(held),
      ...(turnViewToEdge ? { turnViewToEdge } : {}),
    })
  }

  /** The entries every menu, pointer or keyboard, takes from the armed tool and the hold: "Finish shape" while the tool
   *  can finish its draft, and holdsSelectionDeletes during the re-origin hold (U39). */
  function toolMenuEntries(held: boolean): { readonly finishShape?: () => void; readonly holdsSelectionDeletes?: true } {
    return {
      ...(activeTool.canFinish?.() ? { finishShape: finishShapeOf(activeTool) } : {}),
      ...(held ? { holdsSelectionDeletes: true as const } : {}),
    }
  }

  /** "Finish shape" (spec §3.2): the draft's Enter, while the tool that offered it is still armed. */
  function finishShapeOf(tool: CanvasTool): () => void {
    return () => {
      if (disposed || activeTool !== tool) return
      deps.admission.runWhenSettled(() => callTool(() => tool.command({ kind: 'confirm' })), 'pass' as ToolReply)
    }
  }

  /**
   * "Turn view to this edge" (spec §4.16): the nearest polygon, rectangle or line zone edge within the source's
   * tolerance, locked zones included, turned level on screen by the smaller angle. Pointer menus only: the keyboard
   * menu has no point (the keyboard turns the view with Shift ← and Shift →).
   */
  function edgeTurnAt(world: WorldPoint, source: MenuSource): (() => void) | null {
    const tolerancePx = MENU_EDGE_TOLERANCE_PX[source]
    if (tolerancePx === undefined) return null
    const hit = deps.scene.hitAt(world, { toleranceScreenPx: tolerancePx })
    if (hit?.kind !== 'zone-edge') return null
    const zone = deps.scene.persisted.zones.find((entry) => entry.id === hit.zoneId)
    const edge = zone ? zoneEdgeSegment(zone, hit.edgeIndex) : null
    if (!edge) return null
    const [a, b] = [{ x: edge[0].x, y: edge[0].y }, { x: edge[1].x, y: edge[1].y }]
    return () => {
      if (!disposed) deps.navigation.turnToEdge(a, b)
    }
  }

  function notifySceneChanged(): void {
    const tool = activeTool
    if (tool.sceneChanged) callTool(() => tool.sceneChanged!())
    changed()
  }

  // ── Arming ───────────────────────────────────────────────────────────────────────────────────────────────────────

  function requestTool(id: ToolId): void {
    deps.toolState.set(id)
    if (currentId !== id) setTool(id, null)
  }

  function activate(id: ToolId, source: ToolSource | null): void {
    currentId = id
    activeSource = source
    draftHidden = false
    toolDraft = null
    toolHandles = NO_HANDLES
    toolActiveHandle = null
    toolGuidance = null
    publishedGuidance = null
    const tool = TOOL_REGISTRY[id]()
    activeTool = tool
    callTool(() => {
      try {
        tool.activate(contextFor(tool), source)
      } catch (error) {
        selectOnFault = true
        throw error
      }
    })
    resetCursor()
  }

  /** One tool call: any throw while arming, the tool left's cancellation included, arms a fresh Select (spec §1.4 "Faults"). */
  function setTool(id: ToolId, source: ToolSource | null): void {
    if (disposed) return
    callTool(() => {
      try {
        const changing = id !== currentId
        if (changing) closeTextEntry()
        cancelTransientInteraction('tool-change')
        if (!changing) return
        activeTool.deactivate('switch')
        activate(id, source)
      } catch (error) {
        selectOnFault = true
        throw error
      }
    })
  }

  // ── Nudges ───────────────────────────────────────────────────────────────────────────────────────────────────────

  function endNudgeSeries(commit: boolean): void {
    if (nudgeTimer !== null) {
      deps.timers.clear(nudgeTimer)
      nudgeTimer = null
    }
    if (!nudging) return
    nudging = false
    if (commit) deps.nudge.endNudge()
    else deps.nudge.endNudge({ abort: true })
    notifySceneChanged()
  }

  function nudge(direction: ScreenPoint, large: boolean): 'handled' | 'refused' | 'pass' {
    if (disposed || currentId !== 'select' || live || frame().mode === 'overview') return 'pass'
    if (deps.scene.selection().length === 0) return 'pass'
    const { right, down } = frame().view.screenAxesInWorld()
    const step = large ? NUDGE_LARGE_STEP_M : NUDGE_STEP_M
    const delta = {
      x: (right.x * direction.x + down.x * direction.y) * step + 0,
      y: (right.y * direction.x + down.y * direction.y) * step + 0,
    }
    if (!deps.nudge.nudgeSelected(delta)) return 'refused'
    nudging = true
    if (nudgeTimer !== null) deps.timers.clear(nudgeTimer)
    nudgeTimer = deps.timers.set(deps.timers.clock() + NUDGE_SERIES_IDLE_MS, () => {
      nudgeTimer = null
      endNudgeSeries(true)
    })
    notifySceneChanged()
    return 'handled'
  }

  // ── Transient history ───────────────────────────────────────────────────────────────────────────────────────────

  function stepTransientHistory(kind: 'undo-transient' | 'redo-transient'): boolean {
    const tool = activeTool
    if (disposed) return false
    const available = kind === 'undo-transient' ? tool.canUndoTransient?.() : tool.canRedoTransient?.()
    if (!available) return false
    return callTool(() => tool.command({ kind })) === 'handled'
  }

  function placeAt(world: WorldPoint): ToolReply {
    if (frame().mode === 'overview') return 'pass'
    return deps.admission.runWhenSettled(() => {
      if (currentId !== 'plant-stamp') requestTool('plant-stamp')
      const tool = activeTool
      if (currentId !== 'plant-stamp') return 'pass'
      return callTool(() => tool.command({ kind: 'place-at', world: snap(world, false) }))
    }, 'pass' as ToolReply)
  }

  // ── The host ─────────────────────────────────────────────────────────────────────────────────────────────────────

  const unsubscribeFrames = deps.frames.onViewFrame('tools', onFrame)
  activate(currentId, null)

  return {
    gesture(g: Gesture): GestureOutcome {
      if (disposed) return NOTHING
      if (g.kind === 'hover' || g.kind === 'press') pointerKind = g.pointer
      switch (g.kind) {
        case 'hover': return hover(g)
        case 'hover-end': return hoverEnd()
        case 'press': return press(g)
        case 'tap': return tap(g)
        case 'drag-start':
        case 'drag-move':
        case 'drag-end': return drag(g)
        case 'cancel': return cancel(g)
        case 'drop': return drop(g)
        // Navigation never reaches the host.
        default: return NOTHING
      }
    },
    command(c: ToolCommand): ToolReply {
      if (disposed) return 'pass'
      if (c.kind === 'undo-transient' || c.kind === 'redo-transient') {
        return stepTransientHistory(c.kind) ? 'handled' : 'pass'
      }
      if (c.kind === 'place-at') return placeAt(c.world)
      const tool = activeTool
      return deps.admission.runWhenSettled(() => callTool(() => tool.command(c)), 'pass' as ToolReply)
    },
    menuAt(at: ScreenPoint | 'selection', source: MenuSource): GestureOutcome {
      if (disposed) return NOTHING
      // A long press reaches the host as no press: the finger sizes the handles of the selection the menu retargets.
      if (source === 'long-press') pointerKind = 'touch'
      // A menu commits the nudge series first, or its open Scene Edit would quarantine the menu: a mouse menu's right
      // press has already committed it (rawPress); a keyboard menu has no press, and today its key committed the series.
      endNudgeSeries(true)
      if (frame().mode === 'overview') return NOTHING
      let duringEdit = false
      const admitted = deps.admission.runWhenSettled(() => {
        // A menu during a Scene Edit is swallowed (today's _showContextMenuWhenSettled).
        if (hasActiveSceneEdit()) {
          duringEdit = true
          return true
        }
        if (deps.chrome.isTextEntryOpen()) focusMap()
        // A press, a tool transient or an entry its commit left open keeps the selection and its deletes (U39).
        const held = holdsReorigin()
        if (at === 'selection') deps.menu.open({ at, screen: null, ...toolMenuEntries(held) })
        else openMenuAt(at, source, held)
        return true
      }, false)
      return !admitted || duringEdit ? QUARANTINE : NOTHING
    },
    setTool,
    sourceChanged(source: ToolSource | null): void {
      if (disposed) return
      activeSource = source
      const tool = activeTool
      if (tool.sourceChanged) callTool(() => tool.sourceChanged!(source))
    },
    rawPress,
    notePointer(screen: ScreenPoint): void {
      if (disposed) return
      // A pan with nothing resting on the map starts nothing. Otherwise the resting pointer moves and is re-emitted at
      // once, and again on each camera frame: the router pans before it notes the pointer, and the driver publishes the
      // pan's frame synchronously, so a draft or a ghost ends under the pointer whichever comes first.
      if (lastHover) {
        lastHover = { ...lastHover, screen }
        reemit(activeTool)
        flush()
      }
    },
    sceneChanged(): void {
      if (!disposed) notifySceneChanged()
    },
    textEntryOpen: () => !disposed && deps.chrome.isTextEntryOpen(),
    holdsReorigin: () => !disposed && holdsReorigin(),
    hasLiveGesture: () => live !== null,
    activeToolHasEscapeTransient: () => activeTool.hasTransient() && !activeTool.escapeLeaves,
    activeToolIsSelect: () => currentId === 'select',
    nudge,
    hasNudgeSeries: () => nudging,
    endNudgeSeries(commit: boolean): void {
      if (!disposed) endNudgeSeries(commit)
    },
    released(): void {
      if (!disposed) releasedOutsideTool()
    },
    interrupted(): void {
      if (disposed) return
      // After a window blur the pointer may be anywhere: nothing is re-emitted until it hovers the map again.
      lastHover = null
      cancelTransientInteraction('navigate')
    },
    transientHistory: {
      canUndo: () => activeTool.canUndoTransient?.() ?? false,
      canRedo: () => activeTool.canRedoTransient?.() ?? false,
      undo: () => stepTransientHistory('undo-transient'),
      redo: () => stepTransientHistory('redo-transient'),
    },
    prepareForDocumentReplacement(): void {
      if (disposed) return
      lastHover = null
      runCanvasRuntimeCleanups([
        () => closeTextEntry(),
        () => cancelTransientInteraction('document-replaced'),
        () => deps.menu.close(),
        () => {
          try {
            const tool = activeTool
            callTool(() => tool.deactivate('document-replaced'))
            activate(currentId, null)
          } finally {
            followArmedTool()
          }
        },
      ], 'Tool host document replacement preparation failed')
    },
    refreshTranslations(): void {
      if (disposed) return
      publishedGuidance = null
      publishedHandles = NO_HANDLES
      publishedActiveHandle = null
      // Tools translate through ctx.translate when they build a draft or handles, and the scene's localised plant names
      // changed: the tool rebuilds as after a scene change and at the still pointer as on a camera frame (today's
      // refreshTranslations hooks refreshed the Place plants preview and the rotation handle).
      const tool = activeTool
      if (tool.sceneChanged) callTool(() => tool.sceneChanged!())
      refreshAtPointer(tool)
      flush()
    },
    subscribePointerWorld(listener) {
      pointerListeners.add(listener)
      return () => {
        pointerListeners.delete(listener)
      }
    },
    dispose(): void {
      if (disposed) return
      const tool = activeTool
      // From here no tool owns its effects, and a fault aborts the open edits but arms nothing.
      disposed = true
      runCanvasRuntimeCleanups([
        () => unsubscribeFrames(),
        () => endNudgeSeries(true),
        () => cancelLive('tool-change'),
        () => tool.cancelTransient('tool-change'),
        () => tool.deactivate('dispose'),
        // The host is the menu's only opener: an open menu would hold commands for a disposed runtime.
        () => deps.menu.close(),
        () => clearPassiveHover(),
        () => {
          pointerListeners.clear()
          if (publishedToolDraft || publishedDropPreview || publishedDecorations) deps.renderer.setDraft(null)
          if (publishedHandles.length > 0) deps.chrome.setHandles(NO_HANDLES, null)
          deps.guidance(null)
        },
      ], 'Tool host disposal failed')
    },
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The cursor of each tool (as before v2, at a4c86d39, pointer-utils.ts cursorForTool); no tool sets its own. */
function cursorForTool(tool: ToolId): string {
  switch (tool) {
    case 'hand': return 'grab'
    case 'text': return 'text'
    case 'line':
    case 'measurement-guide':
    case 'rectangle':
    case 'ellipse':
    case 'polygon':
    case 'plant-stamp':
    case 'object-stamp':
    case 'plant-spacing': return 'crosshair'
    default: return 'default'
  }
}

function sameHandles(a: readonly ToolHandle[], b: readonly ToolHandle[]): boolean {
  return a === b || (a.length === b.length && JSON.stringify(a) === JSON.stringify(b))
}

function insideScreen(at: ScreenPoint, screen: ViewScreen): boolean {
  return at.x >= 0 && at.y >= 0 && at.x <= screen.width && at.y <= screen.height
}

function clampToScreen(at: ScreenPoint, screen: ViewScreen): ScreenPoint {
  return {
    x: Math.min(Math.max(at.x, 0), screen.width),
    y: Math.min(Math.max(at.y, 0), screen.height),
  }
}

/** A screen-aligned rectangle from two world corners (ToolView.screenAlignedRect). */
function screenAlignedRect(
  view: ViewTransform,
  a: WorldPoint,
  b: WorldPoint,
  options: { readonly square?: boolean } = {},
): { readonly center: WorldPoint; readonly width: number; readonly height: number; readonly rotationDeg: number } {
  const { right, down } = view.screenAxesInWorld()
  let across = (b.x - a.x) * right.x + (b.y - a.y) * right.y
  let along = (b.x - a.x) * down.x + (b.y - a.y) * down.y
  if (options.square) {
    const side = Math.max(Math.abs(across), Math.abs(along))
    across = (across < 0 ? -1 : 1) * side
    along = (along < 0 ? -1 : 1) * side
  }
  const rotationDeg = view.camera.bearingDeg
  return {
    center: {
      x: a.x + (right.x * across + down.x * along) / 2,
      y: a.y + (right.y * across + down.y * along) / 2,
    },
    width: Math.abs(across),
    height: Math.abs(along),
    rotationDeg,
  }
}

function objectTarget(hit: HitTarget | null): SceneDesignObjectTarget | null {
  return hit?.kind === 'object' ? hit.target : null
}

/**
 * What a menu at `world` acts on (today's _retargetContextMenuSelection): `target` is the object to retarget the selection
 * to; with none, a `visible` hit (on a locked layer, or locked through its group) gets the disabled menu, and the empty map
 * gets the map's.
 */
function contextMenuTargetAt(
  scene: ToolScene,
  world: WorldPoint,
): { readonly visible: SceneDesignObjectTarget | null; readonly target: SceneDesignObjectTarget | null } {
  const persisted = scene.persisted
  const visible = objectTarget(scene.hitAt(world, { includeLocked: true }))
  if (visible && isContextMenuTargetStructurallyBlocked(persisted, visible)) return { visible, target: null }
  const hit = objectTarget(scene.hitAt(world, { fill: 'selected' }))
  if (!hit || isContextMenuTargetStructurallyBlocked(persisted, hit)) return { visible, target: null }
  return { visible: visible ?? hit, target: hit }
}

function isContextMenuTargetStructurallyBlocked(scene: ScenePersistedState, target: SceneDesignObjectTarget): boolean {
  if (isSceneTargetLayerLocked(scene, target)) return true
  return isSceneDesignObjectLocked(scene, target) && !isDirectSceneDesignObjectLocked(scene, target)
}
