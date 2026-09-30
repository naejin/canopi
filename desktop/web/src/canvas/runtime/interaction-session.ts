// canvas/runtime/interaction-session.ts
//
// Owns the canvas's interaction session (spec §1.2–1.4, ADRs 0017 and 0018): it composes DomInputSource → normalise →
// recognise → InputRouter → ToolHost, with the keyboard port on the source's legacy key sink, and prepares the map host as
// a keyboard stop. Through 0B it also runs the legacy bridge (scene-interaction.ts) for every tool not yet listed in
// tools/registry.ts: the armed tool's input goes to the host when ToolHost.isRegistered says so and to the bridge
// otherwise, with the DOM event the source is handling (spec §1.4, "The legacy bridge"); the bridge's recogniser session
// follows along so its hovers still reach the host for the lens. Drops stay on the bridge until 0B-4. The session keeps
// today's SceneInteractionSession members: setOverviewMode is a mode override fed to the recogniser's configure and the
// host's frames, refreshMeasurements reaches ToolHost.sceneChanged(). It lends the host its 0B-2 chrome (the bridge's
// tooltip, Unlock affordance and note editor), bridges the plant and saved-stamp read models to a registered tool, reads
// the snapping settings per point, calls ToolHost.rawPress for every raw press on the map host and ToolHost.interrupted()
// after a window blur, owns the navigation cursor, and passes on no draft while a story is presented.

import { computed, effect, signal, type ReadonlySignal } from '@preact/signals'
import { readPlantStampSource, clearPlantStampSource } from '../plant-stamp-source'
import { clearSavedObjectStampSource, readSavedObjectStampSource } from '../saved-object-stamp-source'
import type { SessionPlane } from '../session-plane'
import { getCanvasTool, IDLE_CANVAS_TOOL_GUIDANCE } from '../session-state'
import type { CanvasFocusPort, CanvasRuntimeTranslator } from './app-adapter'
import { runCanvasRuntimeCleanups, throwCanvasRuntimeCleanupErrors } from './cleanup'
import { CURRENT_BINDINGS } from './input/bindings'
import { createDomInputSource, outcomeEffects } from './input/dom-input-source'
import type { Gesture } from './input/gestures'
import { createInputRouter } from './input/input-router'
import { detectPlatform, type InputPlatform } from './input/platform'
import type { AdapterEffect, RawInput, RecogniserConfig, RecogniserState } from './input/raw-input'
import { initialRecogniserState, recognise } from './input/recognise'
import { DEFAULT_THRESHOLDS } from './input/thresholds'
import type { GestureOutcome, InputRouterDeps, ToolHost, ToolHostDeps } from './interaction-ports'
import type { Modifiers, ToolId } from './interaction-types'
import { isSceneLayerOpenForCreation, type SceneCreationLayerName } from './interaction/layer-guards'
import { createCanvasKeyboardPort } from './keyboard-port'
import type { SceneRendererV2 } from './renderers/scene-types'
import type { CanvasKeyboardPort, CanvasPlantRowSpacingField } from './runtime'
import type { SceneStateReader } from './scene/store'
import {
  createLegacyInteractionBridge,
  type LegacyInteractionBridge,
  type LegacyInteractionBridgeDeps,
} from './scene-interaction'
import { createContextMenuPort, createToolHost, createToolScene } from './tools/tool-host'
import type { ViewNavigation } from './view/navigation'
import type { ViewFrame, ViewFrameSource, WorldPoint } from './view/types'

/** Attributes the session sets on the map host and restores when it ends. */
const HOST_ATTRIBUTES = ['tabindex', 'role', 'aria-label', 'aria-describedby'] as const
const STORY_PRESENTING_ATTRIBUTE = 'data-story-presenting'
const NO_MODIFIERS: Modifiers = Object.freeze({ shift: false, ctrl: false, alt: false, meta: false })
const QUARANTINE: readonly AdapterEffect[] = Object.freeze([{ kind: 'prevent-default' }, { kind: 'stop-propagation' }])
/** The host's types, read through it (P5b: this module imports nothing else from tools/). */
type DraftPresentation = Parameters<ToolHostDeps['renderer']['setDraft']>[0]
type ToolSource = Parameters<ToolHost['setTool']>[1]

const NO_DRAFTS: Pick<SceneRendererV2, 'setDraft' | 'setSelectionPreview'> = Object.freeze({
  setDraft() {},
  setSelectionPreview() {},
})

let descriptionSequence = 0

export interface SceneInteractionSessionDeps extends LegacyInteractionBridgeDeps {
  /** The view's frames (scene-runtime/construction.ts); absent, the camera shim's own driver host's, as the split suites build it. */
  readonly frames?: ViewFrameSource
  /** The view's navigation (turn to an edge, key zoom and north); absent, the camera shim's. */
  readonly viewNavigation?: ViewNavigation
  /** The mounted renderer's draft sink (scene-runtime.ts, over the render scheduler); absent, drafts go nowhere. */
  readonly renderer?: Pick<SceneRendererV2, 'setDraft' | 'setSelectionPreview'>
  /** The app's focus port (CanvasRuntimeAppAdapter.focus); absent, the session focuses the map host itself, as today. */
  readonly focus?: CanvasFocusPort
  /** Unread in 0B (ToolSceneSource.sceneRevision: nothing is cached yet). */
  readonly sceneRevision?: ReadonlySignal<number>
  /** Injected for tests; detected from the browser otherwise (0C moves the call to the platform modules). */
  readonly platform?: InputPlatform
}

export interface SceneInteractionSession {
  setTool(name: string): void
  /** Plant a row's spacing field in the tool card; does nothing under another tool. */
  readonly plantRowSpacing: CanvasPlantRowSpacingField
  setOverviewMode(enabled: boolean): void
  prepareForDocumentReplacement(): void
  refreshMeasurements(): void
  refreshTranslations(): void
  canUndoTransientHistory(): boolean
  canRedoTransientHistory(): boolean
  undoTransientHistory(): boolean
  redoTransientHistory(): boolean
  /** The canvas's key handling (spec §1.2a), fed by the DOM input source's legacy key sink until 0C. */
  readonly keyboard: CanvasKeyboardPort
  /** ToolHost.subscribePointerWorld: the pointer's world point over the map, null when it leaves (the inspection lens). */
  subscribePointerWorld(listener: (point: WorldPoint | null) => void): () => void
  dispose(): void
}

export function createSceneInteractionSession(deps: SceneInteractionSessionDeps): SceneInteractionSession {
  return new DefaultSceneInteractionSession(deps)
}

class DefaultSceneInteractionSession implements SceneInteractionSession {
  readonly keyboard: CanvasKeyboardPort
  readonly plantRowSpacing: CanvasPlantRowSpacingField = {
    input: (text) => this._spacing(
      (field) => field.input(text),
      () => { this._toolHost.command({ kind: 'spacing-input', text }) },
    ),
    commit: (text) => this._spacing(
      (field) => field.commit(text),
      () => {
        this._toolHost.command({ kind: 'spacing-input', text })
        this._toolHost.command({ kind: 'spacing-commit', via: 'enter' })
      },
    ),
    blur: (text) => this._spacing(
      (field) => field.blur(text),
      () => {
        this._toolHost.command({ kind: 'spacing-input', text })
        this._toolHost.command({ kind: 'spacing-commit', via: 'blur' })
      },
    ),
    cancel: () => this._spacing(
      (field) => field.cancel(),
      () => { this._toolHost.command({ kind: 'spacing-cancel' }) },
    ),
  }

  private readonly _config: RecogniserConfig
  private readonly _tool = signal<ToolId>(getCanvasTool() as ToolId)
  private readonly _overview = signal(false)
  private readonly _frames: ModeOverridingFrames
  private readonly _hostKeys: InteractionHostController
  private readonly _bridge: LegacyInteractionBridge
  private readonly _toolHost: ToolHost
  private readonly _menu: ReturnType<typeof createContextMenuPort>
  private readonly _port: ReturnType<typeof createCanvasKeyboardPort>
  private readonly _navigation: InputRouterDeps['navigation'] & Pick<ViewNavigation, 'zoomIn' | 'zoomOut' | 'resetNorth' | 'rotateBy'>
  private readonly _router: ReturnType<typeof createInputRouter>
  private readonly _source: ReturnType<typeof createDomInputSource>
  private readonly _renderer: Pick<SceneRendererV2, 'setDraft' | 'setSelectionPreview'>
  private readonly _detachSource: () => void
  private readonly _stopWatchingSources: () => void
  private readonly _storyObserver: MutationObserver | null
  private _recogniser: RecogniserState = initialRecogniserState()
  private _pointingDevice: 'mouse' | 'trackpad'
  private _spaceHeld = false
  private _panning = false
  private _navigationCursor: 'grab' | 'grabbing' | null = null
  private _toolCursor: string | null = null
  private _draft: DraftPresentation | null = null
  private _storyPresented = false
  /** Inside refreshMeasurements' ToolHost.sceneChanged(): the runtime is already redrawing. */
  private _refreshing = false
  private _disposed = false

  constructor(private readonly _deps: SceneInteractionSessionDeps) {
    const platform = _deps.platform ?? detectPlatform(navigator, window as unknown as { readonly GestureEvent?: unknown })
    this._config = { platform, bindings: CURRENT_BINDINGS, thresholds: DEFAULT_THRESHOLDS }
    this._pointingDevice = this._readPointingDevice()
    const view = viewOf(_deps)
    this._frames = overrideMode(view.frames, this._overview)
    this._renderer = _deps.renderer ?? NO_DRAFTS
    this._storyPresented = isStoryPresented()
    const container = _deps.container
    const clock = () => Date.now()
    const timers = {
      set: (atMs: number, callback: () => void): number => window.setTimeout(callback, Math.max(0, atMs - clock())),
      clear: (id: number): void => window.clearTimeout(id),
    }
    const focus: CanvasFocusPort = _deps.focus ?? {
      focusMap: () => container.focus({ preventScroll: true }),
      // The tool card asks for its own field today (the Plant a row guidance's focus request).
      focusToolCardField: () => {},
    }
    this._navigation = {
      panByPx: (delta) => this._afterCameraMove(() => _deps.cameraNavigation.panBy(delta)),
      zoomAroundPx: (anchor, factor) => this._afterCameraMove(() => _deps.cameraNavigation.zoomAroundScreenPoint(anchor, factor)),
      beginRotation: (pivot) => view.navigation.beginRotation(pivot),
      zoomIn: () => this._afterCameraMove(() => view.navigation.zoomIn()),
      zoomOut: () => this._afterCameraMove(() => view.navigation.zoomOut()),
      resetNorth: () => view.navigation.resetNorth(),
      rotateBy: (direction) => view.navigation.rotateBy(direction),
    }

    const rollback: Array<() => void> = []
    const own = <T>(resource: T, dispose: (resource: T) => void): T => {
      rollback.push(() => dispose(resource))
      return resource
    }
    try {
      this._hostKeys = own(prepareInteractionHost(container, _deps.translate), (host) => host.dispose())
      this._bridge = own(createLegacyInteractionBridge(_deps, {
        pointerCapture: {
          capture: (pointerId) => this._source.apply([{ kind: 'capture', pointerId }]),
          release: (pointerId) => this._source.apply([{ kind: 'release-capture', pointerId }]),
        },
        endNudgeSeries: (options) => this._toolHost.endNudgeSeries(!options?.abort),
        lastKeyboardMenuAt: () => this._port.lastKeyboardMenuAt(),
        space: {
          held: () => this._spaceHeld,
          release: () => this._releaseSpace(),
        },
        isRegistered: (tool) => this._toolHost?.isRegistered(tool as ToolId) ?? false,
        switchTool: (name) => this._switchTool(name),
      }), (bridge) => bridge.dispose())
      const scene = createToolScene({
        store: liveStoreReader(_deps),
        sceneRevision: _deps.sceneRevision ?? signal(0),
        selection: _deps.getSelection,
        isLayerOpenForCreation: (layer) =>
          isSceneLayerOpenForCreation(_deps.getSceneStore().persisted, layer as SceneCreationLayerName),
        pixelsPerMetre: () => this._frames.viewFrame.peek().view.pixelsPerMetre,
        speciesCache: _deps.getSpeciesCache,
        plantContext: _deps.getPlantPresentationContext,
        selectionModel: _deps.getDesignObjectSelection,
      })
      this._menu = own(createContextMenuPort({
        container,
        camera: _deps.camera,
        adapter: _deps.contextMenu,
        commands: _deps.selectionCommands,
        saveSelectionAsObjectStamp: _deps.contextualCommands?.saveSelectionAsObjectStamp,
        placePlantsAt: (world) => { this._toolHost.command({ kind: 'place-at', world }) },
        returnFocus: () => focus.focusMap('tool-requested'),
        scene,
        selectionModel: _deps.getDesignObjectSelection,
      }), (menu) => menu.close())
      const nudge = _deps.nudge
      const hostDeps: ToolHostDeps = {
        frames: this._frames,
        scene,
        edits: _deps.sceneEdits,
        admission: _deps.commandAdmission,
        settled: _deps.settledReader,
        setSelection: (targets) => _deps.setSelection(targets),
        plane: (): SessionPlane => _deps.getSceneStore().sessionPlane,
        renderer: {
          setDraft: (draft) => this._setDraft(draft),
          setSelectionPreview: (preview) => this._renderer.setSelectionPreview(preview),
        },
        // The runtime's scene render asks the session to refresh (refreshMeasurements → sceneChanged): a redraw the host
        // requests from inside that refresh is the one already under way.
        invalidate: () => {
          if (!this._refreshing) _deps.render('scene')
        },
        chrome: {
          // No handle layer before D1's 0B-3 (only Select and Text call it); a presented story shows none then either.
          setHandles: () => {},
          setCursor: (cursor) => {
            this._toolCursor = cursor
            this._applyCursor()
          },
          requestTextEntry: () => {},
          closeTextEntry: () => {},
          isTextEntryOpen: () => this._bridge.isTextEntryOpen(),
          setTooltip: (tooltip) => this._bridge.setTooltip(tooltip),
          setLockedAffordance: (affordance) => this._bridge.setLockedAffordance(affordance),
        },
        menu: this._menu,
        focus,
        guidance: (guidance) => _deps.publishToolGuidance?.(guidance ? { ...IDLE_CANVAS_TOOL_GUIDANCE, ...guidance } : IDLE_CANVAS_TOOL_GUIDANCE),
        toolState: { active: this._tool, set: (id) => this._switchTool(id) },
        settings: {
          plantSpacingIntervalM: _deps.readPlantSpacingIntervalMeters,
          commitPlantSpacingIntervalM: _deps.commitPlantSpacingIntervalMeters,
        },
        snapping: () => ({ grid: _deps.readSnapToGridEnabled(), guides: _deps.readSnapToGuidesEnabled() }),
        translate: _deps.translate as ToolHostDeps['translate'],
        bindings: () => CURRENT_BINDINGS,
        platform,
        navigation: { turnToEdge: (a, b) => view.navigation.turnToEdge(a, b) },
        nudge: {
          // The series belongs to the host; the bridge's selection-dependent chrome follows each step, as today.
          nudgeSelected: (delta) => {
            const moved = nudge?.nudgeSelected(delta) ?? false
            if (moved) this._bridge.refreshSelectionDependent()
            return moved
          },
          endNudge: (options) => {
            if (options) nudge?.endNudge(options)
            else nudge?.endNudge()
            this._bridge.refreshSelectionDependent()
          },
        },
        timers: { ...timers, clock },
        hover: (target) => _deps.setHoveredTarget(target),
        inspect: _deps.tryInspectAt,
        transientHistoryChanged: () => _deps.notifyTransientHistoryChange?.(),
      }
      this._toolHost = own(createToolHost(hostDeps), (host) => host.dispose())
      this._router = createInputRouter({ navigation: this._navigation, toolHost: this._toolHost })
      this._port = createCanvasKeyboardPort({
        host: container,
        toolHost: this._toolHost,
        hasSelection: () => _deps.getSelection().length > 0,
        navigation: this._navigation,
        frames: this._frames,
        legacy: {
          bridge: this._bridge,
          pointerSessionLive: () => this._pointerSessionLive(),
          overview: () => this._overview.peek(),
          spaceHeld: () => this._spaceHeld,
          keyState: (state) => this._setKeyState(state.space, state.mods),
          escapeGesture: () => this._escapeGesture(),
          requestTool: (id) => this._switchTool(id),
          clearSelection: () => {
            _deps.clearSelection()
            _deps.render('scene')
            this._bridge.refreshSelectionDependent()
            this._toolHost.sceneChanged()
          },
          readSingleKeyShortcuts: () => _deps.readSingleKeyShortcuts?.() ?? true,
        },
      })
      this.keyboard = this._port
      this._source = createDomInputSource({
        host: container,
        platform,
        bindings: () => CURRENT_BINDINGS,
        keys: {
          physicalCtrl: () => this._port.physicalCtrl(),
          lastKeyboardMenuAt: () => this._port.lastKeyboardMenuAt(),
        },
        clock,
        timers,
        legacyKeys: {
          keydown: (event) => this._port.keydown(event),
          keyup: (event) => this._port.keyup(event),
        },
      })
      this._stopWatchingSources = own(this._watchToolSources(), (stop) => stop())
      this._storyObserver = own(this._observeStoryPresentation(), (observer) => observer?.disconnect())
      this.setTool(this._tool.peek())
      this._detachSource = this._source.attach((input) => this._receive(input))
      rollback.length = 0
    } catch (error) {
      for (const cleanup of rollback.reverse()) {
        try {
          cleanup()
        } catch {
          // Preserve the construction failure after best-effort resource cleanup.
        }
      }
      throw error
    }
  }

  setTool(name: string): void {
    if (this._disposed) return
    const id = name as ToolId
    const previous = this._tool.peek()
    if (previous !== id && this._toolHost.isRegistered(previous)) clearToolSource(previous)
    this._tool.value = id
    try {
      this._bridge.setTool(name)
    } catch (error) {
      this._tool.value = previous
      throw error
    }
    this._toolHost.setTool(id, this._toolHost.isRegistered(id) ? toolSourceFor(id) : null)
    if (!this._registered()) this._navigationCursor = null
    this._configure()
  }

  setOverviewMode(enabled: boolean): void {
    if (this._disposed || this._overview.peek() === enabled) return
    this._overview.value = enabled
    // The host hears the mode on a 'tools' frame (today's overview transition for a registered tool).
    this._frames.modeChanged()
    this._configure()
    runCanvasRuntimeCleanups([
      () => this._bridge.setOverviewMode(enabled),
      () => {
        if (!enabled) return
        this._releaseSpace()
        this._menu.close()
      },
    ], 'Scene Interaction overview transition failed')
  }

  prepareForDocumentReplacement(): void {
    if (this._disposed) return
    const tool = this._tool.peek()
    runCanvasRuntimeCleanups([
      () => this._bridge.prepareForDocumentReplacement(),
      () => this._toolHost.prepareForDocumentReplacement(),
      () => this._escapeGesture(),
      () => {
        if (this._toolHost.isRegistered(tool)) clearToolSource(tool)
      },
    ], 'Scene Interaction document replacement preparation failed')
  }

  refreshMeasurements(): void {
    if (this._disposed) return
    this._bridge.refreshMeasurements()
    if (this._refreshing) return
    this._refreshing = true
    try {
      this._toolHost.sceneChanged()
    } finally {
      this._refreshing = false
    }
  }

  refreshTranslations(): void {
    if (this._disposed) return
    this._hostKeys.refreshTranslations()
    this._bridge.refreshTranslations()
    this._toolHost.refreshTranslations()
  }

  canUndoTransientHistory(): boolean {
    if (this._disposed) return false
    return this._registered() ? this._toolHost.transientHistory.canUndo() : this._bridge.canUndoTransientHistory()
  }

  canRedoTransientHistory(): boolean {
    if (this._disposed) return false
    return this._registered() ? this._toolHost.transientHistory.canRedo() : this._bridge.canRedoTransientHistory()
  }

  undoTransientHistory(): boolean {
    if (this._disposed) return false
    return this._registered() ? this._toolHost.transientHistory.undo() : this._bridge.undoTransientHistory()
  }

  redoTransientHistory(): boolean {
    if (this._disposed) return false
    return this._registered() ? this._toolHost.transientHistory.redo() : this._bridge.redoTransientHistory()
  }

  subscribePointerWorld(listener: (point: WorldPoint | null) => void): () => void {
    return this._toolHost.subscribePointerWorld(listener)
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    const errors: unknown[] = []
    const attempt = (cleanup: () => void): void => {
      try {
        cleanup()
      } catch (error) {
        errors.push(error)
      }
    }
    const tool = this._tool.peek()
    attempt(() => this._detachSource())
    attempt(() => this._storyObserver?.disconnect())
    attempt(() => this._stopWatchingSources())
    attempt(() => {
      if (this._toolHost.isRegistered(tool)) clearToolSource(tool)
    })
    attempt(() => this._bridge.dispose())
    attempt(() => this._toolHost.dispose())
    attempt(() => this._hostKeys.dispose())
    throwCanvasRuntimeCleanupErrors(errors, 'Scene Interaction Session disposal failed')
  }

  // ── Routing ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /** A registered tool runs on the ToolHost; every other tool on the legacy bridge. */
  private _registered(): boolean {
    return this._toolHost.isRegistered(this._tool.peek())
  }

  private _receive(input: RawInput): void {
    if (this._disposed) return
    const event = this._source.currentEvent()
    switch (input.kind) {
      case 'drop':
        // The bridge serves every tool's drops until the host's drop route lands (0B-4).
        this._drop(input.phase, event)
        return
      case 'focus-out':
        this._toolHost.endNudgeSeries(true)
        return
      case 'down':
        this._toolHost.rawPress(input.role === 'auxiliary' ? 'middle' : input.role, input.target)
        break
      case 'wheel':
        this._syncPointingDevice()
        break
      default:
        break
    }
    if (this._registered()) this._routeToHost(input)
    else this._routeToBridge(input, event)
    if (input.kind === 'cancel' && input.id === 'all') this._interrupted()
  }

  /** A registered tool's input: recognised, routed, and the recogniser's and the host's effects applied to the event. */
  private _routeToHost(input: RawInput): void {
    if (this._toolHost.retryPendingCancellation()) {
      // Today's app-wide swallow while a failed cancellation is pending; the retry ended every live gesture.
      const fenced = recognise(this._recogniser, { kind: 'escape', t: input.t }, this._config)
      this._recogniser = fenced.state
      this._source.apply([...QUARANTINE, ...fenced.effects.filter((effect) => effect.kind === 'release-capture')])
      return
    }
    const result = recognise(this._recogniser, input, this._config)
    this._recogniser = result.state
    let outcome: GestureOutcome = {}
    for (const gesture of result.gestures) {
      this._followNavigation(gesture)
      outcome = mergeOutcomes(outcome, this._router.route(gesture))
    }
    // A wheel the map takes closes the canvas menu (today's).
    if (input.kind === 'wheel' && result.effects.length > 0) this._menu.close()
    this._source.apply(outcomeEffects(result.effects, outcome))
    if (outcome.rejectSession && input.kind === 'down') {
      const rejected = recognise(this._recogniser, { kind: 'reject', t: input.t, id: input.id }, this._config)
      this._recogniser = rejected.state
      this._source.apply(rejected.effects)
    }
  }

  /**
   * A bridged tool's input runs today's handler on the DOM event, which applies its own effects. The recogniser follows
   * along so its sessions and keys stay true; the host hears only its hovers, to publish the pointer's world point.
   */
  private _routeToBridge(input: RawInput, event: Event | null): void {
    const result = recognise(this._recogniser, input, this._config)
    this._recogniser = result.state
    const bridge = this._bridge
    switch (input.kind) {
      case 'down':
        if (event) bridge.pointerDown(event as PointerEvent)
        break
      case 'move':
        if (event) bridge.pointerMove(event as PointerEvent)
        break
      case 'up':
        if (event) bridge.pointerUp(event as PointerEvent)
        break
      case 'cancel':
        if (input.reason === 'blur') bridge.windowBlur()
        else if (!event) break
        else if (input.reason === 'lost-capture') bridge.lostPointerCapture(event as PointerEvent)
        else bridge.pointerCancel(event as PointerEvent)
        break
      case 'leave':
        bridge.pointerLeave()
        break
      case 'wheel':
        if (event) bridge.wheel(event as WheelEvent)
        break
      case 'native-contextmenu':
        if (event) bridge.contextMenu(event as MouseEvent)
        break
      default:
        break
    }
    for (const gesture of result.gestures) {
      if (gesture.kind === 'hover' || gesture.kind === 'hover-end') this._toolHost.gesture(gesture)
    }
  }

  /** Raw input that does not come from an event (configure, key state, Esc): routed as the armed tool's input would be. */
  private _feed(input: RawInput): void {
    if (this._registered()) {
      const result = recognise(this._recogniser, input, this._config)
      this._recogniser = result.state
      for (const gesture of result.gestures) {
        this._followNavigation(gesture)
        this._router.route(gesture)
      }
      this._source.apply(result.effects.filter((effect) => effect.kind === 'release-capture'))
      return
    }
    this._recogniser = recognise(this._recogniser, input, this._config).state
  }

  private _drop(phase: 'over' | 'leave' | 'drop', event: Event | null): void {
    if (!event) return
    if (phase === 'over') this._bridge.dragOver(event as DragEvent)
    else if (phase === 'leave') this._bridge.dragLeave()
    else this._bridge.drop(event as DragEvent)
  }

  /** After a window blur has reached the recogniser (Space released, live sessions ended) and the armed tool's path. */
  private _interrupted(): void {
    this._spaceHeld = false
    this._port.releaseKeys()
    if (this._registered()) {
      this._bridge.cancelPendingFocus()
      this._setNavigationCursor(null)
    }
    this._toolHost.interrupted()
  }

  private _pointerSessionLive(): boolean {
    return this._registered()
      ? this._recogniser.sessions.size > 0 || this._toolHost.hasLiveGesture()
      : this._bridge.hasPointerGesture()
  }

  private _escapeGesture(): void {
    this._feed({ kind: 'escape', t: Date.now() })
    this._spaceHeld = false
    if (this._registered()) this._setNavigationCursor(this._panning ? 'grabbing' : null)
  }

  private _configure(): void {
    this._feed({
      kind: 'configure',
      t: Date.now(),
      context: {
        tool: this._tool.peek(),
        mode: this._overview.peek() ? 'overview' : 'site',
        pointingDevice: this._pointingDevice,
        dragSlopPx: this._toolHost.activeToolDragSlopPx() ?? undefined,
      },
    })
  }

  /** Settings › Canvas › Scroll wheel, read before each wheel as today: 'pan' is the trackpad setting. */
  private _syncPointingDevice(): void {
    const next = this._readPointingDevice()
    if (next === this._pointingDevice) return
    this._pointingDevice = next
    this._configure()
  }

  private _readPointingDevice(): 'mouse' | 'trackpad' {
    return (this._deps.readScrollWheel?.() ?? 'zoom') === 'pan' ? 'trackpad' : 'mouse'
  }

  /** Arms a tool as a tool's own request does: the runtime's setTool first, then the session if it did not follow. */
  private _switchTool(name: string): void {
    this._deps.setTool(name)
    if (this._tool.peek() !== name) this.setTool(name)
  }

  // ── Keys, the navigation cursor and camera moves ───────────────────────────────────────────────────────────────

  private _setKeyState(space: boolean, mods: Modifiers): void {
    this._spaceHeld = space
    this._feed({ kind: 'key-state', t: Date.now(), space, mods })
    if (!this._registered()) {
      this._bridge.spaceChanged(space)
      return
    }
    if (space) {
      // Today's grab: always in overview; otherwise not during a press, nor with the Pan tool's own grab.
      if (this._overview.peek() || (!this._toolHost.hasLiveGesture() && this._tool.peek() !== 'hand')) {
        this._setNavigationCursor(this._panning ? 'grabbing' : 'grab')
      }
    } else if (!this._panning) {
      this._setNavigationCursor(null)
    }
  }

  private _releaseSpace(): void {
    if (!this._spaceHeld) return
    this._spaceHeld = false
    this._recogniser = recognise(this._recogniser, { kind: 'key-state', t: Date.now(), space: false, mods: NO_MODIFIERS }, this._config).state
  }

  /** A pointer pan shows 'grabbing' until it ends; then the tool's cursor comes back (today's cancel). */
  private _followNavigation(gesture: Gesture): void {
    if (gesture.kind !== 'pan' || gesture.source === 'wheel') return
    if (gesture.phase === 'start') {
      this._panning = true
      this._setNavigationCursor('grabbing')
    } else if (gesture.phase === 'end') {
      this._panning = false
      this._setNavigationCursor(null)
    }
  }

  private _setNavigationCursor(cursor: 'grab' | 'grabbing' | null): void {
    this._navigationCursor = cursor
    this._applyCursor()
  }

  private _applyCursor(): void {
    // The host sets its first tool's cursor while it is being built; the session's setTool applies it right after.
    if (!this._toolHost || !this._registered()) return
    this._deps.container.style.cursor = this._navigationCursor ?? this._toolCursor ?? 'default'
  }

  /** A pan or zoom through today's camera navigation: the viewport render and today's refresh when the camera moved. */
  private _afterCameraMove(move: () => void): void {
    const before = this._deps.camera.snapshot.peek().revision
    move()
    if (this._deps.camera.snapshot.peek().revision === before) return
    this._deps.render('viewport')
    this._bridge.refreshMeasurements()
  }

  // ── Drafts while a story is presented ───────────────────────────────────────────────────────────────────────────

  private _setDraft(draft: DraftPresentation | null): void {
    this._draft = draft
    this._renderer.setDraft(this._storyPresented ? null : draft)
  }

  /** Today's CSS hid the DOM previews while a story is presented (html[data-story-presenting]); the draft follows it. */
  private _observeStoryPresentation(): MutationObserver | null {
    if (typeof MutationObserver === 'undefined') return null
    const observer = new MutationObserver(() => {
      const presented = isStoryPresented()
      if (presented === this._storyPresented || this._disposed) return
      this._storyPresented = presented
      this._renderer.setDraft(presented ? null : this._draft)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [STORY_PRESENTING_ATTRIBUTE] })
    return observer
  }

  // ── The plant and saved-stamp read models ──────────────────────────────────────────────────────────────────────

  /**
   * A registered Place plants or saved-stamp tool hears a new source while armed: the plant source after a microtask,
   * inside the settled admission (a pick from the chooser leaves its own update first), the saved stamp at once.
   */
  private _watchToolSources(): () => void {
    let plant = readPlantStampSource()
    let saved = readSavedObjectStampSource()
    const stopPlant = effect(() => {
      const next = readPlantStampSource()
      if (next === plant) return
      plant = next
      if (this._tool.peek() !== 'plant-stamp' || !this._toolHost.isRegistered('plant-stamp')) return
      queueMicrotask(() => {
        if (this._disposed || this._tool.peek() !== 'plant-stamp') return
        this._deps.commandAdmission.runWhenSettled(
          () => this._toolHost.sourceChanged(toolSourceFor('plant-stamp')),
          undefined,
          { resumePending: true },
        )
      })
    })
    const stopSaved = effect(() => {
      const next = readSavedObjectStampSource()
      if (next === saved) return
      saved = next
      if (this._tool.peek() !== 'saved-object-stamp' || !this._toolHost.isRegistered('saved-object-stamp')) return
      this._toolHost.sourceChanged(toolSourceFor('saved-object-stamp'))
    })
    return () => {
      stopPlant()
      stopSaved()
    }
  }

  private _spacing(bridged: (field: CanvasPlantRowSpacingField) => void, registered: () => void): void {
    if (this._disposed) return
    if (this._registered()) registered()
    else bridged(this._bridge.plantRowSpacing)
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────

interface InteractionHostController {
  refreshTranslations(): void
  dispose(): void
}

/**
 * Makes the map host a keyboard stop: in the Tab order, named, and described
 * by its keys, so a keyboard user can reach the tool keys, Shift F10 and the
 * Esc chain. `role="application"` hands every key to the map while it has
 * focus, which is what single-key tools need.
 */
function prepareInteractionHost(
  container: HTMLElement,
  translate: CanvasRuntimeTranslator,
): InteractionHostController {
  const previous = HOST_ATTRIBUTES.map((name) => [name, container.getAttribute(name)] as const)
  const description = document.createElement('div')
  description.id = `canopi-map-keys-${++descriptionSequence}`
  description.hidden = true
  description.dataset.mapKeysDescription = 'true'

  function refreshTranslations(): void {
    container.setAttribute('aria-label', translate('canvas.map.label'))
    description.textContent = translate('canvas.map.description')
  }

  container.appendChild(description)
  container.tabIndex = 0
  container.setAttribute('role', 'application')
  container.setAttribute('aria-describedby', description.id)
  refreshTranslations()

  return {
    refreshTranslations,
    dispose() {
      description.remove()
      for (const [name, value] of previous) {
        if (value === null) container.removeAttribute(name)
        else container.setAttribute(name, value)
      }
    },
  }
}

/** The view the camera shim wraps, when the runtime does not pass its own (the split suites' CameraController). */
function viewOf(deps: SceneInteractionSessionDeps): { readonly frames: ViewFrameSource; readonly navigation: ViewNavigation } {
  const shim = deps.camera as Partial<{ readonly host: { readonly frames: ViewFrameSource }; readonly viewNavigation: ViewNavigation }>
  const frames = deps.frames ?? shim.host?.frames
  const navigation = deps.viewNavigation ?? shim.viewNavigation
  if (!frames || !navigation) throw new Error('The interaction session needs the view\'s frames and navigation')
  return { frames, navigation }
}

interface ModeOverridingFrames extends ViewFrameSource {
  /** The override changed: the 'tools' listeners hear the current frame at once. */
  modeChanged(): void
}

/** The view's frames with the session's mode (today's setOverviewMode), which the host reads through 0B. */
function overrideMode(frames: ViewFrameSource, overview: ReadonlySignal<boolean>): ModeOverridingFrames {
  const withMode = (frame: ViewFrame, inOverview: boolean): ViewFrame => {
    const mode = inOverview ? 'overview' : 'site'
    return frame.mode === mode ? frame : { ...frame, mode }
  }
  const viewFrame = computed(() => withMode(frames.viewFrame.value, overview.value))
  const settledViewFrame = computed(() => withMode(frames.settledViewFrame.value, overview.value))
  const toolListeners = new Set<(frame: ViewFrame) => void>()
  return {
    viewFrame,
    settledViewFrame,
    onViewFrame(phase, listener) {
      const stop = frames.onViewFrame(phase, (frame) => listener(withMode(frame, overview.peek())))
      if (phase !== 'tools') return stop
      toolListeners.add(listener)
      return () => {
        stop()
        toolListeners.delete(listener)
      }
    },
    modeChanged() {
      const frame = viewFrame.peek()
      for (const listener of [...toolListeners]) listener(frame)
    },
  }
}

/** The scene store the deps name, read live (a hydration replaces nothing here, but the fixture may swap stores). */
function liveStoreReader(deps: SceneInteractionSessionDeps): SceneStateReader {
  return {
    get persisted() { return deps.getSceneStore().persisted },
    get session() { return deps.getSceneStore().session },
    get guides() { return deps.getSceneStore().guides },
    get physicalExtentMeters() { return deps.getSceneStore().physicalExtentMeters },
    get sessionPlane() { return deps.getSceneStore().sessionPlane },
    get sessionPlaneSignal() { return deps.getSceneStore().sessionPlaneSignal },
  }
}

function toolSourceFor(tool: ToolId): ToolSource | null {
  if (tool === 'plant-stamp') {
    const species = readPlantStampSource()
    return species ? { kind: 'species', species } : null
  }
  if (tool === 'saved-object-stamp') {
    const stamp = readSavedObjectStampSource()
    return stamp ? { kind: 'saved-stamp', stamp } : null
  }
  return null
}

/** Leaving a registered stamp tool (or ending the session) drops its pick, as today's tools did on deactivation. */
function clearToolSource(tool: ToolId): void {
  if (tool === 'plant-stamp') clearPlantStampSource()
  else if (tool === 'saved-object-stamp') clearSavedObjectStampSource()
}

function mergeOutcomes(a: GestureOutcome, b: GestureOutcome): GestureOutcome {
  if (!b.quarantine && !b.rejectSession && !b.dropEffect) return a
  return {
    quarantine: a.quarantine || b.quarantine || undefined,
    rejectSession: a.rejectSession || b.rejectSession || undefined,
    dropEffect: b.dropEffect ?? a.dropEffect,
  }
}

function isStoryPresented(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute(STORY_PRESENTING_ATTRIBUTE)
}
