// canvas/runtime/tools/tool-host.ts
//
// Owns the ToolHost (spec §1.4, ADR 0018), the only code that builds ToolGestures. It converts the recogniser's screen
// gestures to world points at event time, resolves modifiers (§2.3), applies the active tool's constraint and the grid
// and guide snapping, and runs the interceptors (admission, handles, the inspection probe) before the tool; every raw
// press first commits the nudge series and, as today's pointerdown, closes the menu and moves focus to the map. A drag
// starts at the press's world point, and every camera frame re-emits the live drag or the resting pointer, which a
// pointer pan moves (plan §1, exception 1). The text entry's state is the chrome's, read live. It owns the passive
// hover, the selection decorations, the arrow-nudge series, transient history and the Esc queries, and merges the
// tool's draft with its decorations and the drop preview for the renderer. One drop route serves every tool (spec §1.4
// "Drops"): a species drop places a plant with Place plants' placement, a saved stamp with the saved stamp's, then arms
// Select. Tools are plain objects listed in tools/registry.ts, which lists every tool; an id it does not list arms none.
// The module re-exports createToolScene and builds the context-menu port, so interaction-session.ts imports nothing else
// from tools/ (P5b).

import { signal, untracked } from '@preact/signals'
import { runCanvasRuntimeCleanups } from '../cleanup'
import type { Gesture, MenuSource, PressTarget } from '../input/gestures'
import type { TargetClass } from '../input/raw-input'
import { createCanvasContextMenu } from '../interaction/canvas-context-menu'
import type { ContextMenuPort, GestureOutcome, ToolHost, ToolHostDeps } from '../interaction-ports'
import type { CancelReason, CanvasDropPayload, Modifiers, PointerKind, ToolHandleId, ToolId } from '../interaction-types'
import type { CanvasDesignObjectSelectionModel } from '../runtime'
import {
  includesSceneDesignObjectTarget,
  type SceneDesignObjectTarget,
} from '../scene/design-object-targets'
import { resolveSceneObjectGroupMembers, sceneObjectGroupMemberLayerName } from '../scene/group-members'
import { isDirectSceneDesignObjectLocked, isSceneDesignObjectLocked } from '../scene/locks'
import type { ScenePersistedState } from '../scene/types'
import type { SceneEditCoordinator, SceneEditRunOptions, SceneEditTransaction } from '../scene-runtime/transactions'
import { normaliseBearing } from '../view/navigation-policy'
import type { ScreenPoint, ViewFrame, ViewScreen, ViewTransform, WorldPoint } from '../view/types'
import { applyToolConstraint, type ScreenAxes } from './constraints'
import type { DraftPresentation, DraftShape, ToolHandle } from './draft'
import { measureLabelShapes, selectedZoneMeasurementLabels } from './measure-labels'
import { placePlantFromSpecies } from './plant-stamp'
import { TOOL_REGISTRY } from './registry'
import { placeSavedObjectStamp, savedObjectStampGhostShapes } from './saved-object-stamp'
import { bandDraft } from './select/band'
import { snapWorldPoint, type SnapSettings } from './snapping'
import type {
  CanvasTool,
  HitTarget,
  TextEntryRequest,
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
/** A press the inspection probe sampled: nothing else happens until the next press (today's _clearPointerGesture). */
const CLAIMED_PRESS: GestureOutcome = Object.freeze({ rejectSession: true })
const DROP_COPY: GestureOutcome = Object.freeze({ dropEffect: 'copy' })
const DROP_NONE: GestureOutcome = Object.freeze({ dropEffect: 'none' })
/** A dragover in overview or while the scene is busy: today's rejected dragover. */
const REFUSED_DRAGOVER: GestureOutcome = Object.freeze({ quarantine: true, dropEffect: 'none' })
/** A species drag's cue: today's band box from the pointer, this many CSS px right and down. */
const DROP_CUE_PX = 12
const NO_HANDLES: readonly ToolHandle[] = Object.freeze([])
const NO_SNAP: SnapSettings = Object.freeze({ grid: false, guides: false })
/** Constraints turn against the world axes before phase 1 (spec §2.3); the screen axes from phase 1 are the same at bearing 0. */
const WORLD_AXES: ScreenAxes = Object.freeze({
  right: Object.freeze({ x: 1, y: 0 }),
  down: Object.freeze({ x: 0, y: 1 }),
})
/** Arrow-key nudge steps, in session-plane metres. */
const NUDGE_STEP_M = 0.1
const NUDGE_LARGE_STEP_M = 1
/** A pause this long ends a nudge series, so its edit commits. */
const NUDGE_SERIES_IDLE_MS = 800
/** The drawing tools whose draft chips replace the selected zone's (today both shared one overlay). */
const ZONE_DRAFT_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['line', 'rectangle', 'ellipse', 'polygon'])

/** A press the host routed, from press to release or cancel (today's _pointerGesture). */
interface LiveGesture {
  readonly id: number
  readonly kind: 'tool' | 'handle' | 'ruler'
  readonly pointer: PointerKind
  /** The press as a world point, converted once at the press, so the drag start stays on the ground (plan §1, exception 1).
   *  Null for a ruler press, whose drag and guide are the interaction session's. */
  start: ToolPoint | null
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
 *  window blur, a document replacement or an id that arms no tool). */
interface StillPointer {
  readonly screen: ScreenPoint
  readonly mods: Modifiers
  readonly pointer: PointerKind
}

type CancelTransientReason = Parameters<CanvasTool['cancelTransient']>[0]

/** Today's createCanvasContextMenu options, plus what open() rebuilds the menu's selection from. */
export type ContextMenuPortOptions = Parameters<typeof createCanvasContextMenu>[0] & {
  /** The ToolScene the host hits with: a hit on a locked layer or through a locked group gets the disabled menu. */
  readonly scene: ToolScene
  /** The selection model once the host has retargeted the selection (querySurface.getDesignObjectSelection). */
  readonly selectionModel: () => CanvasDesignObjectSelectionModel
}

/**
 * ToolHostDeps.menu over today's controller. The host hits and retargets the selection first; open() then rebuilds
 * today's three menu states: the selection's menu from the keyboard, the empty-map menu, and a right-clicked object's menu,
 * disabled when the object is on a locked layer or locked through its group (today's _retargetContextMenuSelection).
 */
export function createContextMenuPort(options: ContextMenuPortOptions): ContextMenuPort {
  const { scene, selectionModel, ...controllerOptions } = options
  // The controller follows every close of the app's menu through its request's `closed`.
  const controller = createCanvasContextMenu(controllerOptions)

  return {
    open(request) {
      if (request.at === 'selection') {
        controller.openFromKeyboard(selectionModel())
        return
      }
      const screen = request.screen ?? controllerOptions.camera.worldToScreen(request.at)
      const { visible, target } = contextMenuTargetAt(scene, request.at)
      controller.openAtPointer(screen, target ? selectionModel() : visible ? disabledContextMenuSelection() : null)
    },
    close: () => controller.close(),
    isOpen: () => controller.isOpen(),
  }
}

export function createToolHost(deps: ToolHostDeps): ToolHost {
  const transientRevision = signal(0)
  const pointerListeners = new Set<(point: WorldPoint | null) => void>()
  /** Transactions a tool began and has not committed or aborted: its Scene Edit is open. */
  const openEdits = new Set<SceneEditTransaction>()

  let disposed = false
  let currentId: ToolId = deps.toolState.active.peek()
  let activeTool: CanvasTool | null = null
  let activeSource: ToolSource | null = null
  let toolDraft: DraftPresentation | null = null
  let toolHandles: readonly ToolHandle[] = NO_HANDLES
  let toolGuidance: Parameters<ToolEffects['setGuidance']>[0] = null
  let toolCursor: string | null = null
  let live: LiveGesture | null = null
  let lastHover: StillPointer | null = null
  /** The mode of the text entry a tool last asked for, read only while the chrome reports an entry open: each tool asks for
   *  one mode (Text 'create', Select 'edit'), and a tool change closes the entry. */
  let textEntryMode: TextEntryRequest['mode'] | null = null
  /** The raw press found a new note's entry open: its focus move committed the note, and the press places nothing. */
  let pressCommitsNote = false
  /** A panel drag passed over the map: its drop preview replaces the tool's draft until the pointer next hovers or presses
   *  over the map (today's one preview element, which a dragover took over and a pointermove gave back). */
  let draftHiddenForDrop = false
  /** What a drop would place, while a panel drag is over the map: a species' band cue or a saved stamp's ghosts. */
  let dropPreview: readonly DraftShape[] | null = null
  let nudging = false
  let nudgeTimer: number | null = null
  let callDepth = 0
  let invalidateNeeded = false
  let plane = deps.plane()
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
    get bearingDeg() {
      return frame().view.camera.bearingDeg
    },
    get mode() {
      return frame().mode
    },
    metresPerPixelAt: (p) => frame().view.metresPerPixelAt(p),
    screenDistance: (a, b) => frame().view.screenDistance(a, b),
    screenAxesInWorld: (at) => frame().view.screenAxesInWorld(at),
    screenAlignedRect: (a, b, options) => screenAlignedRect(frame().view, a, b, options),
  }

  // ── Tool calls ────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Every call into the tool: afterwards transient history bumps, and drafts, handles, guidance and redraws are flushed.
   * Calls run untracked: the runtime refreshes the session from inside its camera-frame effect, which must not come to
   * depend on what the tool reads, nor re-run on the transient-history revision the call bumps.
   */
  function callTool<T>(run: () => T): T {
    return untracked(() => {
      callDepth += 1
      try {
        return run()
      } finally {
        callDepth -= 1
        if (callDepth === 0) afterToolCall()
      }
    })
  }

  function afterToolCall(): void {
    // A write that reads nothing: a deferred commit may settle inside a caller's effect.
    transientRevision.value = transientRevision.peek() + 1
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
      setHandles(handles) {
        // The same handles again (a refresh after a camera frame or a scene change) change nothing and redraw nothing.
        if (!owns() || sameHandles(toolHandles, handles)) return
        toolHandles = handles
        changed()
      },
      setGuidance(guidance) {
        if (!owns()) return
        toolGuidance = guidance
        if (callDepth === 0) publishGuidance()
      },
      setCursor(cursor) {
        if (!owns()) return
        toolCursor = cursor
        deps.chrome.setCursor(cursor)
      },
      requestTool(id) {
        if (owns()) requestTool(id)
      },
      requestTextEntry(request, submit, onCancel) {
        if (!owns()) return
        textEntryMode = request.mode
        deps.chrome.requestTextEntry(request, (text) => {
          const reply = callTool(() => submit(text))
          // A closed entry shows Select's handles again at once (today's editor refreshed them after its commit).
          if (reply === 'close' && deps.chrome.isTextEntryOpen()) {
            deps.chrome.closeTextEntry()
            flush()
          }
          return reply
        }, onCancel && (() => {
          // The entry's own Esc closed it: the tool follows, as a tool call.
          if (owns()) callTool(onCancel)
        }))
      },
      closeTextEntry() {
        if (owns()) closeTextEntry()
      },
      requestFocus() {
        if (owns()) deps.focus.focusMap('tool-requested')
      },
    }
    return {
      view,
      scene: deps.scene,
      effects,
      settings: deps.settings,
      snap: (point) => snap(point, false),
      now: () => deps.timers.clock(),
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
      commit(options) {
        const committed = tx.commit(options)
        openEdits.delete(tx)
        return committed
      },
      abort() {
        tx.abort()
        openEdits.delete(tx)
        // The scene is back as it was before the edit: redraw it, as today's tools rendered after an abort.
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
    return snapWorldPoint(point, noSnap ? NO_SNAP : deps.snapping(), frame().view.pixelsPerMetre, deps.scene.persisted.guides)
  }

  /** Modifiers by meaning (spec §2.3, the LEGACY and ROTATION column; phase 2 adds the V2 column). */
  function resolveModifiers(mods: Modifiers, handleDrag: boolean): ToolModifiers {
    const shiftConstrains = currentId === 'polygon' || currentId === 'plant-spacing' || handleDrag
    return {
      additive: mods.shift || mods.ctrl || mods.meta,
      subtractive: false,
      constrain: mods.shift && shiftConstrains,
      fromCentre: false,
      noSnap: mods.shift && currentId === 'plant-spacing',
    }
  }

  /** The tool's point at a screen point of the current frame, or null where the screen has no ground. */
  function pointAt(screen: ScreenPoint, mods: Modifiers, pointer: PointerKind, handleDrag = false): ToolPoint | null {
    const view = frame().view
    const at = activeTool?.clampsToView ? clampToScreen(screen, view.screen) : screen
    const world = view.screenToWorld(at)
    return world ? resolvePoint(world, mods, pointer, handleDrag) : null
  }

  function resolvePoint(world: WorldPoint, mods: Modifiers, pointer: PointerKind, handleDrag: boolean): ToolPoint {
    const modifiers = resolveModifiers(mods, handleDrag)
    const free = snap(world, modifiers.noSnap)
    const constraint = modifiers.constrain ? activeTool?.constraint?.() ?? null : null
    if (!constraint) return { world, free, constrained: world, snapped: free, modifiers, pointer }
    const constrained = applyToolConstraint(constraint, world, WORLD_AXES)
    if (constraint.kind === 'rotation-delta') {
      return { world, free, constrained, snapped: constrained, modifiers, pointer }
    }
    // Today's order, keyed by tool id: Polygon snaps, then constrains, so a Shift corner may be off the grid
    // (today's (a4c86d39) zone-drawing-tool.ts:226); Plant a row constrains the raw point, and its Shift is also no-snap.
    const snapped = currentId === 'polygon'
      ? applyToolConstraint(constraint, free, WORLD_AXES)
      : snap(constrained, modifiers.noSnap)
    return { world, free, constrained, snapped, modifiers, pointer }
  }

  function hitAt(world: WorldPoint): HitTarget | null {
    return deps.scene.hitAt(world)
  }

  // ── Drafts, handles, guidance, cursor ────────────────────────────────────────────────────────────────────────────

  /** The tool's draft, the drop preview and the host's decorations, merged for the renderer. */
  function publishDraft(): void {
    const shownToolDraft = activeTool && !draftHiddenForDrop ? toolDraft : null
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
   * (today's (a4c86d39) zone tool drew them under every tool). They hide while the armed Line, Rectangle, Ellipse or Polygon
   * draft carries measure labels.
   */
  function decorationShapes(): DraftShape[] {
    if (zoneDraftHidesChips()) return []
    const labels = selectedZoneMeasurementLabels(deps.scene.persisted, deps.scene.selection())
    return labels.length > 0 ? measureLabelShapes(labels, (a, b) => frame().view.screenDistance(a, b)) : []
  }

  function zoneDraftHidesChips(): boolean {
    if (!activeTool || !ZONE_DRAFT_TOOLS.has(currentId)) return false
    return toolDraft?.shapes.some((shape) =>
      shape.kind === 'label' && (shape.tone === 'measure' || shape.tone === 'measure-quiet')) ?? false
  }

  function publishHandles(): void {
    const handles = shownHandles()
    const active = live?.kind === 'handle' ? live.handle : null
    if (handles === publishedHandles && active === publishedActiveHandle) return
    publishedHandles = handles
    publishedActiveHandle = active
    deps.chrome.setHandles(handles, active)
  }

  /**
   * Select's handles show only while its affordances may (today's _canShowSelectAffordances): in site mode, with the
   * text entry closed and no Scene Edit open. A handle's own press keeps them until its edit first changes the scene,
   * as today's handle hid them at its drag's first update.
   */
  function shownHandles(): readonly ToolHandle[] {
    if (!activeTool) return NO_HANDLES
    if (currentId !== 'select') return toolHandles
    const affordancesShown = frame().mode === 'site'
      && !deps.chrome.isTextEntryOpen()
      && (!hasActiveSceneEdit() || (live?.kind === 'handle' && !live.mutated))
    return affordancesShown ? toolHandles : NO_HANDLES
  }

  function publishGuidance(): void {
    if (!activeTool || disposed) return
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
    if (activeTool) deps.chrome.setCursor(toolCursor ?? cursorForTool(currentId))
  }

  // ── Passive hover and the pointer's world point ─────────────────────────────────────────────────────────────────

  function publishPointer(point: WorldPoint | null): void {
    for (const listener of [...pointerListeners]) listener(point)
  }

  function clearPassiveHover(): void {
    deps.hover(null)
    deps.chrome.setTooltip(null)
    deps.chrome.setLockedAffordance(null)
  }

  /** Today's _updateHover: the restyle, the plant tooltip and the Unlock affordance for a directly locked object. */
  function passiveHover(world: WorldPoint, at: ScreenPoint): void {
    const visible = objectTarget(deps.scene.hitAt(world, { includeLocked: true }))
    const scene = deps.scene.persisted
    deps.hover(visible)
    deps.chrome.setLockedAffordance(
      visible && !isTargetLayerLocked(scene, visible) && isDirectSceneDesignObjectLocked(scene, visible)
        ? { target: visible, at }
        : null,
    )
    deps.chrome.setTooltip(visible?.kind === 'plant' ? { target: visible, at } : null)
  }

  /** The tool's hover, then the passive hover unless the tool handled it. */
  function deliverHover(tool: CanvasTool, at: ScreenPoint, mods: Modifiers, pointer: PointerKind): void {
    const point = pointAt(at, mods, pointer)
    if (!point) {
      clearPassiveHover()
      return
    }
    const reply = callTool(() => tool.gesture({ kind: 'hover', point, hit: hitAt(point.world) }))
    if (reply === 'handled') clearPassiveHover()
    else passiveHoverAt(at)
  }

  // ── Gestures ──────────────────────────────────────────────────────────────────────────────────────────────────────

  function hover(g: Extract<Gesture, { kind: 'hover' }>): GestureOutcome {
    // The lens hears only moves over the map: not over the canvas's own chrome or a ruler, nor off the map (today's lens
    // skips buttons, inputs, textareas, contenteditable and [data-preserve-overlays], and hears no move off the host).
    if (g.target.kind === 'surface') {
      const world = frame().view.screenToWorld(g.at)
      if (world && insideScreen(g.at, frame().view.screen)) publishPointer(world)
    }
    // The pointer is back over the map after a panel drag: the tool's draft shows again, as today's next pointermove
    // redrew it.
    showDraftAfterDrop()
    const tool = activeTool
    if (!tool) return NOTHING
    if (frame().mode === 'overview') {
      lastHover = null
      clearPassiveHover()
      return NOTHING
    }
    lastHover = insideScreen(g.at, frame().view.screen) ? { screen: g.at, mods: g.mods, pointer: g.pointer } : null
    deliverHover(tool, g.at, g.mods, g.pointer)
    return NOTHING
  }

  /** The tool's draft, hidden since a panel drag passed over the map, shows again. */
  function showDraftAfterDrop(): void {
    if (!draftHiddenForDrop) return
    draftHiddenForDrop = false
    changed()
  }

  function hoverEnd(): GestureOutcome {
    publishPointer(null)
    lastHover = null
    const tool = activeTool
    if (!tool) return NOTHING
    clearPassiveHover()
    callTool(() => tool.gesture({ kind: 'hover-end' }))
    return NOTHING
  }

  /**
   * Every raw pointerdown on the map host, reported by the session before it routes the press (today's _onPointerDown):
   * any button commits the nudge series. An admitted primary or middle press outside the text entry and the Unlock
   * affordance, with no live press from another pointer, also closes the menu and moves focus
   * to the map, so an open text entry commits before the press reaches the tool (focusMap); a click inside the entry keeps
   * it open. A primary press that so commits a new note's entry ('create') places nothing: no tool hears it, as today's Text
   * field took that click (spec §3.2); an in-place editor's ('edit') press goes on, as today's. A press on the live press's
   * own pointer (its up was lost) counts, as today's. The host knows only its own live press: a pan
   * lives in the recogniser, which ignores a second pointer anyway.
   */
  function rawPress(button: 'primary' | 'secondary' | 'middle', target: TargetClass, pointerId?: number): void {
    if (disposed) return
    pressCommitsNote = false
    endNudgeSeries(true)
    if (!activeTool || button === 'secondary') return
    if (live && live.id !== pointerId) return
    if (target.kind === 'owned-text' || (target.kind === 'owned-chrome' && target.lockedAffordance)) return
    // Admission without resuming a pending edit: the press that follows resumes it, once, as today's one admission did.
    deps.admission.runWhenSettled(() => {
      deps.menu.close()
      // Today's Text took the click that found its note field open to commit the note, and placed nothing (spec §3.2).
      pressCommitsNote = button === 'primary' && openTextEntryMode() === 'create'
      focusMap()
      return true
    }, false)
  }

  function press(g: Extract<Gesture, { kind: 'press' }>): GestureOutcome {
    const commitsNote = pressCommitsNote
    pressCommitsNote = false
    // A pen or a finger reaches the map with no hover after a panel drag: its press shows the tool's draft again.
    if (g.target.kind !== 'ruler') showDraftAfterDrop()
    if (!activeTool) return NOTHING
    if (live) cancelLive('pointercancel')
    // The pointer is pressed now: a frame re-emits its drag, not the hover before it.
    lastHover = null
    if (g.target.kind === 'ruler') {
      // The session runs the ruler drag and lands its guide, outside the scene's admission as today; the tool hears none of it.
      live = liveGesture(g, 'ruler', null, null)
      return NOTHING
    }
    // Under LEGACY an overview press pans in the recogniser and never reaches the host; nothing here samples or edits.
    if (frame().mode === 'overview') return NOTHING
    let claimed = false
    const admitted = deps.admission.runWhenSettled(() => {
      claimed = pressWhenSettled(g, commitsNote)
      return true
    }, false, { resumePending: true })
    if (!admitted) return REFUSED_PRESS
    return claimed ? CLAIMED_PRESS : NOTHING
  }

  /** Today's _pointerDownWhenSettled, in order: the press's capture, handles, the probe, the tool. Focus moved at the raw
   *  press (rawPress), so an open text entry has committed. A capture lost while it is taken (a synchronous lostpointercapture)
   *  ended the press: nothing else happens, as today's check after capture. A press that committed a new note (`commitsNote`)
   *  ends where today's Text adapter took it: the tool hears none of it, nor its drag or release. */
  function pressWhenSettled(g: Extract<Gesture, { kind: 'press' }>, commitsNote: boolean): boolean {
    const tool = activeTool
    if (!tool) return false
    if (!deps.capturePress(g.id)) return true
    const handleDrag = g.target.kind === 'handle'
    const point = pointAt(g.at, g.mods, g.pointer, handleDrag)
    if (!point) return true
    if (g.target.kind === 'handle') {
      const handle = g.target.id
      live = liveGesture(g, 'handle', point, null)
      cancelOnFailure(() => {
        publishHandles()
        callTool(() => tool.gesture({ kind: 'handle-drag', phase: 'start', handle, point, start: point }))
        clearPassiveHoverForEdit()
      })
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
    start: ToolPoint | null,
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
    gesture.lastMods = g.mods
    const tool = activeTool
    if (gesture.kind === 'ruler' || !tool) {
      // A ruler drag's cursor and guide are the session's (its RulerPress): the map keeps the tool's cursor, as today.
      if (g.kind === 'drag-end') {
        endLive()
        releasedOutsideTool()
      }
      return NOTHING
    }
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
      cancelOnFailure(finish)
      return NOTHING
    }
    const admitted = deps.admission.runWhenSettled(() => {
      cancelOnFailure(finish)
      return true
    }, false, { resumePending: true })
    if (admitted) return NOTHING
    cancelTransientInteraction('tool-change')
    return QUARANTINE
  }

  /**
   * A release whose tool call throws runs the cancellation at once, as today's pointerup ran it in its finally, so the
   * tool's Scene Edit closes at the release; so does a handle press whose start or presentation throws once the drag has
   * opened its Scene Edit, as today's control points rolled back a drag whose presentation failed (rollbackDragSetup), so
   * the next press is admitted. A cancellation that fails too still leaves no edit open (guardCancellation aborts it).
   * The gesture's error is the one reported.
   */
  function cancelOnFailure(run: () => void): void {
    try {
      run()
    } catch (error) {
      try {
        cancelTransientInteraction('tool-change')
      } catch {
        // guardCancellation has already aborted the open edit; the gesture's failure is reported.
      }
      throw error
    }
  }

  /** The drag at its last screen point, converted through the current frame; its start is the press's world point. */
  function deliverDrag(tool: CanvasTool, gesture: LiveGesture, kind: 'drag-start' | 'drag-move' | 'drag-end'): void {
    const point = pointAt(gesture.lastScreen, gesture.lastMods, gesture.pointer, gesture.kind === 'handle')
    if (!point) {
      // No ground under the pointer: the drag is cancelled.
      cancelLive('pointercancel')
      return
    }
    if (kind === 'drag-end') live = null
    const start = gesture.start!
    if (gesture.kind === 'handle') {
      const phase = kind === 'drag-end' ? 'end' : 'move'
      callTool(() => tool.gesture({ kind: 'handle-drag', phase, handle: gesture.handle!, point, start }))
    } else {
      const reply = callTool(() => tool.gesture({ kind, point, start, startHit: gesture.startHit }))
      // A move the tool passes is none of its press's (Plant a row's missed press, a stamp with nothing held, a polygon
      // press that added no corner): it is a hover with the button down, as today's press that cleared its gesture left
      // the next moves to _updateHover. A tool that keeps its press answers 'handled' (ToolReply).
      if (kind !== 'drag-end' && reply === 'pass') passiveHoverAt(gesture.lastScreen)
    }
  }

  /** The passive hover at a screen point, cleared off the map. */
  function passiveHoverAt(at: ScreenPoint): void {
    const world = frame().view.screenToWorld(at)
    if (world && insideScreen(at, frame().view.screen)) passiveHover(world, at)
    else clearPassiveHover()
  }

  function tap(g: Extract<Gesture, { kind: 'tap' }>): GestureOutcome {
    const gesture = live
    if (!gesture) {
      // A press the tool never heard (a new note's committing click, no tool armed): its release is none of the tool's.
      releasedOutsideTool()
      return NOTHING
    }
    if (gesture.id !== g.id) return NOTHING
    const tool = activeTool
    if (gesture.kind === 'ruler' || !tool) {
      endLive()
      releasedOutsideTool()
      return NOTHING
    }
    return release(tool, () => {
      live = null
      try {
        const point = pointAt(g.at, g.mods, g.pointer, gesture.kind === 'handle')
        if (!point) return
        if (gesture.kind === 'handle') {
          callTool(() => tool.gesture({ kind: 'handle-drag', phase: 'end', handle: gesture.handle!, point, start: gesture.start! }))
        } else {
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
    if (!draftHiddenForDrop) {
      draftHiddenForDrop = true
      changed()
    }
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
   * shows its ghosts with the anchor at the snapped point (today's previewSavedObjectStampAt).
   */
  function dropPreviewAt(at: ScreenPoint, payload: CanvasDropPayload): readonly DraftShape[] | null {
    const transform = frame().view
    const world = transform.screenToWorld(at)
    if (!world) return null
    if (payload.kind === 'saved-stamp') return savedObjectStampGhostShapes(deps.scene, payload.stamp, snap(world, false))
    if (payload.kind !== 'species' || !deps.scene.isLayerOpenForCreation('plants')) return null
    const corner = transform.screenToWorld({ x: at.x + DROP_CUE_PX, y: at.y + DROP_CUE_PX })
    return corner ? bandDraft(view, { start: world, additive: false }, corner).shapes : null
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
    }, false, { resumePending: true })
    return admitted ? NOTHING : QUARANTINE
  }

  /** Today's _dropWhenSettled: the payload at the snapped point, as one Scene Edit that selects what it placed. */
  function placeDrop(at: ScreenPoint, payload: CanvasDropPayload): void {
    const world = frame().view.screenToWorld(at)
    if (!world) return
    const point = snap(world, false)
    if (payload.kind === 'saved-stamp') {
      placeSavedObjectStamp(deps.edits, deps.scene, payload.stamp, point, { onCommitted: () => dropped('saved-stamp') })
    } else if (payload.kind === 'species' && payload.species) {
      const target = { edits: deps.edits, scene: deps.scene }
      placePlantFromSpecies(target, payload.species, point, 'interaction-drop', () => dropped('species'))
    }
  }

  /** Once a drop's edit commits: Select, the map's focus, then the session's follow-up (ToolHostDeps.dropped), as today. */
  function dropped(kind: 'species' | 'saved-stamp'): void {
    if (disposed) return
    requestTool('select')
    deps.focus.focusMap('tool-requested')
    deps.dropped(kind)
  }

  function setDropPreview(shapes: readonly DraftShape[] | null): void {
    if (shapes === null && dropPreview === null) return
    dropPreview = shapes
    changed()
  }

  function cancel(g: Extract<Gesture, { kind: 'cancel' }>): GestureOutcome {
    if (!live) return NOTHING
    guardCancellation(() => {
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
      && activeTool
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
    if (gesture.kind === 'ruler' || !tool) {
      resetCursor()
      return
    }
    callTool(() => tool.gesture({ kind: 'cancel', reason }))
  }

  // ── Cancellation and interruption ────────────────────────────────────────────────────────────────────────────────

  /** Runs a cancellation; a failure while a Scene Edit is still open leaves it pending, retried before the next event. */
  /** A cancellation that fails leaves no edit open: whatever `run` left behind is aborted before its error reaches the
   *  caller, so the scene is clean and the next press is admitted with nothing to retry. */
  function guardCancellation(run: () => void): void {
    try {
      run()
    } catch (error) {
      abortOpenEdits()
      throw error
    } finally {
      flush()
    }
  }

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
   * passive hover, the tool's transient, the cursor.
   */
  function cancelTransientInteraction(reason: CancelTransientReason): void {
    guardCancellation(() => {
      const tool = activeTool
      runCanvasRuntimeCleanups([
        () => endNudgeSeries(true),
        () => cancelLive(reason === 'navigate' ? 'blur' : 'tool-change'),
        () => setDropPreview(null),
        // With no tool armed there is no hover, transient or tool cursor to clear.
        ...(tool
          ? [
              () => clearPassiveHover(),
              () => {
                callTool(() => tool.cancelTransient(reason))
              },
              () => resetCursor(),
            ]
          : []),
      ], 'Tool host cancellation failed')
    })
  }

  /**
   * Today's pointerup cleanup after a release that ended no press of the tool's (ToolHost.released): the end or cancel of
   * a pointer pan, a right-click release, a release off the map, a ruler drag's, a press the tool never heard. The series
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
    deps.focus.focusMap(entryOpen ? 'text-entry-closed' : 'tool-requested')
    // Select's handles, hidden while the entry was open, follow at once.
    if (entryOpen) flush()
  }

  function closeTextEntry(): void {
    if (deps.chrome.isTextEntryOpen()) deps.chrome.closeTextEntry()
  }

  function openTextEntryMode(): TextEntryRequest['mode'] | null {
    return deps.chrome.isTextEntryOpen() ? textEntryMode : null
  }

  /** Entering overview drops what today's setOverviewMode(true) dropped: an in-place editor ('edit'), the menu and every
   *  transient. A new note's entry ('create') stays, as today's new-note field did: the next press commits it. */
  function enterOverview(): void {
    lastHover = null
    setDropPreview(null)
    if (!activeTool) return
    runCanvasRuntimeCleanups([
      () => {
        if (openTextEntryMode() !== 'create') closeTextEntry()
      },
      () => cancelTransientInteraction('overview'),
      () => deps.menu.close(),
    ], 'Tool host overview transition failed')
  }

  // ── Frames and planes ────────────────────────────────────────────────────────────────────────────────────────────

  /** A re-origin (the plane's identity changed): retained world points move through lon/lat. */
  function syncPlane(): void {
    const next = deps.plane()
    if (next === plane) return
    const previous = plane
    plane = next
    const reproject = (point: WorldPoint): WorldPoint => {
      const moved = next.toPlane(previous.toGeo(point))
      return { x: moved.x, y: moved.y }
    }
    const start = live?.start
    if (live && start) {
      live.start = {
        ...start,
        world: reproject(start.world),
        free: reproject(start.free),
        constrained: reproject(start.constrained),
        snapped: reproject(start.snapped),
      }
    }
    const tool = activeTool
    if (tool?.planeChanged) callTool(() => tool.planeChanged!(reproject))
  }

  function onFrame(next: ViewFrame): void {
    if (disposed) return
    syncPlane()
    if (next.mode !== mode) {
      mode = next.mode
      if (mode === 'overview') enterOverview()
    }
    const tool = activeTool
    if (tool) refreshAtPointer(tool)
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

  /** Re-emits the live drag or the resting pointer; false when nothing is under a still pointer on the map. */
  function reemit(tool: CanvasTool): boolean {
    if (frame().mode !== 'site') return false
    const gesture = live
    if (gesture) {
      if (gesture.kind === 'ruler' || !gesture.dragging) return false
      deliverDrag(tool, gesture, 'drag-move')
      return true
    }
    const still = lastHover
    // A pointer pan may have carried the resting pointer past the map's edge.
    if (!still || !insideScreen(still.screen, frame().view.screen)) return false
    deliverHover(tool, still.screen, still.mods, still.pointer)
    return true
  }

  // ── Menus ────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Hit, retarget the selection to the object under the pointer (history-free), then open the menu. */
  function openMenuAt(at: ScreenPoint, source: MenuSource): void {
    const world = frame().view.screenToWorld(at)
    if (!world) return
    const { visible, target } = contextMenuTargetAt(deps.scene, world)
    if (target && !includesSceneDesignObjectTarget(deps.scene.selection(), target)) {
      deps.setSelection([target])
      notifySceneChanged()
    }
    deps.menu.open({ at: world, source, screen: at, hit: visible ? { kind: 'object', target: visible } : null })
  }

  function notifySceneChanged(): void {
    const tool = activeTool
    if (tool?.sceneChanged) callTool(() => tool.sceneChanged!())
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
    draftHiddenForDrop = false
    toolDraft = null
    toolHandles = NO_HANDLES
    toolGuidance = null
    toolCursor = null
    publishedGuidance = null
    const factory = TOOL_REGISTRY[id]
    const tool = factory ? factory() : null
    activeTool = tool
    if (!tool) {
      // No tool hears the pointer, so the host forgets where it rests.
      lastHover = null
      flush()
      return
    }
    callTool(() => tool.activate(contextFor(tool), source))
    resetCursor()
  }

  function setTool(id: ToolId, source: ToolSource | null): void {
    if (disposed) return
    const changing = id !== currentId
    if (changing) closeTextEntry()
    cancelTransientInteraction('tool-change')
    if (!changing) return
    const previous = activeTool
    const previousId = currentId
    const previousSource = activeSource
    if (previous) callTool(() => previous.deactivate('switch'))
    try {
      activate(id, source)
    } catch (error) {
      // A tool whose activation throws leaves Select armed, not the tool left: that tool is already deactivated, and
      // reactivating it risks the same failure (or a stale pick). Select is the one tool every mode falls back to, except
      // when Select's own activation is what just failed: there is no further fallback, so the tool before it is armed
      // again, as before.
      runCanvasRuntimeCleanups([
        () => activeTool?.deactivate('switch'),
        () => {
          if (id !== 'select') {
            activate('select', null)
          } else {
            currentId = previousId
            activeSource = previousSource
            activeTool = previous
            if (previous) callTool(() => previous.activate(contextFor(previous), previousSource))
          }
        },
      ], 'Tool host activation rollback failed')
      throw error
    }
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
    if (!tool || disposed) return false
    const available = kind === 'undo-transient' ? tool.canUndoTransient?.() : tool.canRedoTransient?.()
    if (!available) return false
    return callTool(() => tool.command({ kind })) === 'handled'
  }

  function placeAt(world: WorldPoint): ToolReply {
    if (frame().mode === 'overview') return 'pass'
    return deps.admission.runWhenSettled(() => {
      if (currentId !== 'plant-stamp') requestTool('plant-stamp')
      const tool = activeTool
      if (!tool || currentId !== 'plant-stamp') return 'pass'
      return callTool(() => tool.command({ kind: 'place-at', world: snap(world, false) }))
    }, 'pass' as ToolReply, { resumePending: true })
  }

  // ── The host ─────────────────────────────────────────────────────────────────────────────────────────────────────

  const unsubscribeFrames = deps.frames.onViewFrame('tools', onFrame)
  activate(currentId, null)

  return {
    gesture(g: Gesture): GestureOutcome {
      if (disposed) return NOTHING
      syncPlane()
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
      if (!tool) return 'pass'
      return deps.admission.runWhenSettled(() => callTool(() => tool.command(c)), 'pass' as ToolReply, { resumePending: true })
    },
    menuAt(at: ScreenPoint | 'selection', source: MenuSource): GestureOutcome {
      if (disposed) return NOTHING
      // A menu commits the nudge series first, or its open Scene Edit would quarantine the menu: a mouse menu's right
      // press has already committed it (rawPress); a keyboard menu has no press, and today its key committed the series.
      endNudgeSeries(true)
      if (!activeTool || frame().mode === 'overview') return NOTHING
      let duringEdit = false
      const admitted = deps.admission.runWhenSettled(() => {
        // A menu during a Scene Edit is swallowed (today's _showContextMenuWhenSettled).
        if (hasActiveSceneEdit()) {
          duringEdit = true
          return true
        }
        if (deps.chrome.isTextEntryOpen()) focusMap()
        if (at === 'selection') deps.menu.open({ at, source, screen: null, hit: null })
        else openMenuAt(at, source)
        return true
      }, false, { resumePending: true })
      return !admitted || duringEdit ? QUARANTINE : NOTHING
    },
    setTool,
    sourceChanged(source: ToolSource | null): void {
      if (disposed) return
      activeSource = source
      const tool = activeTool
      if (tool?.sourceChanged) callTool(() => tool.sourceChanged!(source))
    },
    activeTool: deps.toolState.active,
    activeToolDragSlopPx: () => activeTool?.dragSlopPx ?? null,
    rawPress,
    notePointer(screen: ScreenPoint | null): void {
      if (disposed) return
      // Emits nothing: the next camera frame re-emits at the moved point, where the ground followed the pointer, so a
      // ghost keeps its world point under it (today's). A pan with nothing resting on the map starts nothing.
      if (!screen) lastHover = null
      else if (lastHover) lastHover = { ...lastHover, screen }
    },
    sceneChanged(): void {
      if (!disposed) notifySceneChanged()
    },
    openTextEntryMode: () => (disposed ? null : openTextEntryMode()),
    hasLiveGesture: () => live !== null,
    activeToolHasTransient: () => activeTool?.hasTransient() ?? false,
    activeToolIsSelect: () => currentId === 'select',
    escapeHint: () => activeTool?.escapeHint() ?? null,
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
      if (!activeTool) return
      cancelTransientInteraction('navigate')
    },
    transientHistory: {
      revision: transientRevision,
      canUndo: () => activeTool?.canUndoTransient?.() ?? false,
      canRedo: () => activeTool?.canRedoTransient?.() ?? false,
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
          const tool = activeTool
          if (!tool) return
          callTool(() => tool.deactivate('document-replaced'))
          activate(currentId, null)
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
      if (tool) {
        if (tool.sceneChanged) callTool(() => tool.sceneChanged!())
        refreshAtPointer(tool)
      }
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
      runCanvasRuntimeCleanups([
        () => unsubscribeFrames(),
        () => endNudgeSeries(true),
        () => cancelLive('tool-change'),
        () => tool?.cancelTransient('tool-change'),
        () => tool?.deactivate('dispose'),
        // The host is the menu's only opener: an open menu would hold commands for a disposed runtime.
        () => deps.menu.close(),
        () => {
          if (tool) clearPassiveHover()
        },
        () => {
          disposed = true
          activeTool = null
          pointerListeners.clear()
          if (publishedToolDraft || publishedDropPreview || publishedDecorations) deps.renderer.setDraft(null)
          if (publishedHandles.length > 0) deps.chrome.setHandles(NO_HANDLES, null)
          if (tool) deps.guidance(null)
        },
      ], 'Tool host disposal failed')
      disposed = true
    },
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Today's cursors per tool (today's (a4c86d39) pointer-utils.ts cursorForTool); a tool may set its own through
 * ToolEffects.setCursor.
 */
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
  options: { readonly square?: boolean; readonly fromCentre?: boolean } = {},
): { readonly center: WorldPoint; readonly width: number; readonly height: number; readonly rotationDeg: number } {
  const { right, down } = view.screenAxesInWorld()
  let across = (b.x - a.x) * right.x + (b.y - a.y) * right.y
  let along = (b.x - a.x) * down.x + (b.y - a.y) * down.y
  if (options.square) {
    const side = Math.max(Math.abs(across), Math.abs(along))
    across = (across < 0 ? -1 : 1) * side
    along = (along < 0 ? -1 : 1) * side
  }
  const rotationDeg = normaliseBearing(view.camera.bearingDeg)
  if (options.fromCentre) {
    return { center: a, width: Math.abs(across) * 2, height: Math.abs(along) * 2, rotationDeg }
  }
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
  const hit = objectTarget(scene.hitAt(world))
  if (!hit || isContextMenuTargetStructurallyBlocked(persisted, hit)) return { visible, target: null }
  return { visible: visible ?? hit, target: hit }
}

function disabledContextMenuSelection(): CanvasDesignObjectSelectionModel {
  return {
    editableTargets: [],
    lockedTargets: [],
    blockedTargets: [],
    bounds: null,
    sameSpeciesReferenceCanonicalName: null,
  }
}

function isContextMenuTargetStructurallyBlocked(scene: ScenePersistedState, target: SceneDesignObjectTarget): boolean {
  if (isTargetLayerLocked(scene, target)) return true
  return isSceneDesignObjectLocked(scene, target) && !isDirectSceneDesignObjectLocked(scene, target)
}

function isTargetLayerLocked(scene: ScenePersistedState, target: SceneDesignObjectTarget): boolean {
  const layerNames = target.kind === 'plant'
    ? ['plants']
    : target.kind === 'zone'
      ? ['zones']
      : target.kind === 'annotation'
        ? ['annotations']
        : target.kind === 'measurement-guide'
          ? ['measurement-guides']
          : groupLayerNames(scene, target.id)
  return layerNames.some((layerName) => scene.layers.find((layer) => layer.name === layerName)?.locked === true)
}

function groupLayerNames(scene: ScenePersistedState, groupId: string): string[] {
  const group = scene.groups.find((entry) => entry.id === groupId)
  if (!group) return []
  return [...new Set(resolveSceneObjectGroupMembers(scene, group).map(sceneObjectGroupMemberLayerName))]
}
