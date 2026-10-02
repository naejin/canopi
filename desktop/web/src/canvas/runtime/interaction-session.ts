// canvas/runtime/interaction-session.ts
//
// Owns the canvas's interaction session (spec §1.2–1.4, ADRs 0017 and 0018): it composes DomInputSource → normalise →
// recognise → InputRouter → ToolHost, with the keyboard port on the source's legacy key sink, and prepares the map host
// as a keyboard stop. Every tool and every drop runs on the host (spec §1.4, "Drops"). The session keeps today's
// SceneInteractionSession members: setOverviewMode is a mode override fed to the recogniser's configure and the host's
// frames, refreshMeasurements reaches ToolHost.sceneChanged(). It builds the host's chrome (chrome/: the handle layer,
// the text entry, the plant tooltip and the Unlock affordance, whose Unlock it runs), bridges the plant and saved-stamp
// read models to the armed tool, reads the snapping settings per point, calls ToolHost.rawPress for every raw press on
// the map host, ToolHost.released() after a release that ended no press of the tool's and ToolHost.interrupted() after a
// window blur, follows a placed drop (the saved stamp's drag source, the map's focus on the next frame), owns the
// navigation cursor, and passes on no draft or handles while a story is presented. Ruler presses reach the source
// beside the map: the session finds the pressed ruler's overlay (chrome/rulers.ts) and runs today's ruler drag under
// any tool (its cursor, its end on a blur, its guide at the release), whatever the host does with the input.

import { computed, effect, signal, type ReadonlySignal } from '@preact/signals'
import { readPlantStampSource, clearPlantStampSource } from '../plant-stamp-source'
import {
  clearSavedObjectStampDragSource,
  clearSavedObjectStampSource,
  readSavedObjectStampSource,
} from '../saved-object-stamp-source'
import type { SessionPlane } from '../session-plane'
import { getCanvasTool, IDLE_CANVAS_TOOL_GUIDANCE, type CanvasToolGuidance } from '../session-state'
import type {
  CanvasContextMenuCommands,
  CanvasFocusPort,
  CanvasRuntimeContextMenuAdapter,
  CanvasRuntimeTranslator,
  CanvasScrollWheelSetting,
} from './app-adapter'
import type { WorkspaceCameraFrameReader, WorkspaceCameraNavigation } from './camera'
import { createHandleLayer, type HandleLayer } from './chrome/handle-layer'
import { createHoverTooltip, type HoverTooltipController } from './chrome/hover-tooltip'
import { createLockedAffordance, type LockedAffordanceController } from './chrome/locked-affordance'
import { pressRuler, type RulerPress } from './chrome/rulers'
import { createTextEntryHost, type TextEntryHost } from './chrome/text-entry-host'
import { runCanvasRuntimeCleanups, throwCanvasRuntimeCleanupErrors } from './cleanup'
import { CURRENT_BINDINGS } from './input/bindings'
import { createDomInputSource, outcomeEffects } from './input/dom-input-source'
import type { Gesture } from './input/gestures'
import { createInputRouter } from './input/input-router'
import { detectPlatform, type InputPlatform } from './input/platform'
import type { AdapterEffect, RawInput, RecogniserConfig, RecogniserState, TargetClass } from './input/raw-input'
import { initialRecogniserState, recognise } from './input/recognise'
import { DEFAULT_THRESHOLDS } from './input/thresholds'
import type { GestureOutcome, InputRouterDeps, ToolHost, ToolHostDeps } from './interaction-ports'
import type { Modifiers, ToolId } from './interaction-types'
import { isSceneLayerOpenForCreation, type SceneCreationLayerName } from './interaction/layer-guards'
import { createCanvasKeyboardPort } from './keyboard-port'
import type { PlantPresentationContext } from './plant-presentation'
import type { SceneRendererV2 } from './renderers/scene-types'
import type {
  CanvasDesignObjectSelectionModel,
  CanvasKeyboardPort,
  CanvasPlantRowSpacingField,
  CanvasSceneEditCommandSurface,
} from './runtime'
import type { SceneDesignObjectSelection, SceneDesignObjectTarget, ScenePoint, SceneStateReader } from './scene'
import { setSceneDesignObjectLocks } from './scene/locks'
import type { SceneCommandAdmission, SceneEditCoordinator, SettledSceneReader } from './scene-runtime/transactions'
import type { SpeciesCacheEntry } from './species-cache'
import { createContextMenuPort, createToolHost, createToolScene } from './tools/tool-host'
import type { ViewNavigation } from './view/navigation'
import type { ScreenPoint, ViewFrame, ViewFrameSource, WorldPoint } from './view/types'

/** Attributes the session sets on the map host and restores when it ends. */
const HOST_ATTRIBUTES = ['tabindex', 'role', 'aria-label', 'aria-describedby'] as const
const STORY_PRESENTING_ATTRIBUTE = 'data-story-presenting'
const NO_MODIFIERS: Modifiers = Object.freeze({ shift: false, ctrl: false, alt: false, meta: false })
const NO_DROP: readonly AdapterEffect[] = Object.freeze([{ kind: 'drop-effect', dropEffect: 'none' }])
/** An actual drop (not a dragover or dragleave) prevents the browser's own drop (recognise.ts), unconditionally; a
 *  throwing route must not skip it, or the browser's default drop runs (today's pre-0B _onDrop prevented it before
 *  routing). A dragover's prevent-default stays tied to its outcome (REFUSED_DRAGOVER leaves it unprevented). */
const PREVENT_DEFAULT: readonly AdapterEffect[] = Object.freeze([{ kind: 'prevent-default' }])
/** The host's types, read through it (P5b: this module imports nothing else from tools/). */
type DraftPresentation = Parameters<ToolHostDeps['renderer']['setDraft']>[0]
type ToolSource = Parameters<ToolHost['setTool']>[1]
type HandleList = Parameters<ToolHostDeps['chrome']['setHandles']>[0]
type HandleId = Parameters<ToolHostDeps['chrome']['setHandles']>[1]
type PassiveHoverAt = NonNullable<Parameters<ToolHostDeps['chrome']['setTooltip']>[0]>

const NO_DRAFTS: Pick<SceneRendererV2, 'setDraft'> = Object.freeze({
  setDraft() {},
})
const NO_HANDLES: HandleList = Object.freeze([])

let descriptionSequence = 0

/** The session's dependencies: today's, which the host and the chrome run on, then the pipeline's own. */
export interface SceneInteractionSessionDeps {
  container: HTMLElement
  getSceneStore: () => SceneStateReader
  camera: WorkspaceCameraFrameReader
  cameraNavigation: Pick<WorkspaceCameraNavigation, 'panBy' | 'zoomAroundScreenPoint'>
  getSpeciesCache: () => ReadonlyMap<string, SpeciesCacheEntry>
  getPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  getSelection: () => SceneDesignObjectSelection
  setSelection: (targets: Iterable<SceneDesignObjectTarget>) => void
  clearSelection: () => void
  sceneEdits: SceneEditCoordinator
  commandAdmission: SceneCommandAdmission
  settledReader: SettledSceneReader
  /**
   * Numeric inspection hook, absent unless a surface is inspecting.
   *
   * Returning `true` claims the left click, which is what suspends drawing and
   * selection for the duration of inspection. It is consulted *after* shared
   * pan and the UI overlays, so pan/zoom and every control keep working while
   * inspecting — the contract requires navigation to survive inspection, and
   * the alternative (a second gesture owner) is what it forbids.
   */
  tryInspectAt?: (world: ScenePoint) => boolean
  getDesignObjectSelection: () => CanvasDesignObjectSelectionModel
  selectionCommands: CanvasContextMenuCommands
  contextualCommands?: {
    readonly saveSelectionAsObjectStamp?: () => void
  }
  /** Renders the right-click menu; absent in a detached runtime. */
  contextMenu?: CanvasRuntimeContextMenuAdapter
  setTool: (name: string) => void
  render: (kind: 'scene' | 'viewport') => void
  readSnapToGridEnabled: () => boolean
  readSnapToGuidesEnabled: () => boolean
  /** Settings › Keyboard › Single-key shortcuts; on when absent. */
  readSingleKeyShortcuts?: () => boolean
  /** Settings › Canvas › Scroll wheel; `zoom` when absent. Pinch and Ctrl wheel zoom either way. */
  readScrollWheel?: () => CanvasScrollWheelSetting
  readPlantSpacingIntervalMeters: () => number
  commitPlantSpacingIntervalMeters: (meters: number) => void
  translate: CanvasRuntimeTranslator
  setHoveredTarget: (target: SceneDesignObjectTarget | null) => void
  getLocalizedCommonNames: () => ReadonlyMap<string, string | null>
  notifyTransientHistoryChange?: () => void
  /** Mirrors the active tool's gesture and stamp state for the tool card. */
  publishToolGuidance?: (guidance: CanvasToolGuidance) => void
  /** The arrow keys' nudges, through the runtime's scene-edit commands. */
  nudge?: Pick<CanvasSceneEditCommandSurface, 'nudgeSelected' | 'endNudge'>
  /** The view's frames (scene-runtime/construction.ts); absent, the camera shim's own driver host's, as the split suites build it. */
  readonly frames?: ViewFrameSource
  /** The view's navigation (turn to an edge, key zoom and north); absent, the camera shim's. */
  readonly viewNavigation?: ViewNavigation
  /** The mounted renderer's draft sink (scene-runtime.ts, over the render scheduler); absent, drafts go nowhere. */
  readonly renderer?: Pick<SceneRendererV2, 'setDraft'>
  /** The app's focus port (CanvasRuntimeAppAdapter.focus); absent, the session focuses the map host itself, as today. */
  readonly focus?: CanvasFocusPort
  /** Injected for tests; detected from the browser otherwise (0C moves the call to the platform modules). */
  readonly platform?: InputPlatform
}

export interface SceneInteractionSession {
  /** The tool the session has armed now (after a failed switch: the one it kept or fell back to). */
  readonly tool: ToolId

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
  /** ToolHost.subscribePointerWorld: the pointer's world point over the map, null when it leaves (the inspection lens). The
   *  session drops the point of a move made with any button held (its raw buttonMask), as today's lens skipped it. */
  subscribePointerWorld(listener: (point: WorldPoint | null) => void): () => void
  dispose(): void
}

export function createSceneInteractionSession(deps: SceneInteractionSessionDeps): SceneInteractionSession {
  return new DefaultSceneInteractionSession(deps)
}

class DefaultSceneInteractionSession implements SceneInteractionSession {
  readonly keyboard: CanvasKeyboardPort
  readonly plantRowSpacing: CanvasPlantRowSpacingField = {
    input: (text) => this._spacing(() => {
      this._toolHost.command({ kind: 'spacing-input', text })
    }),
    commit: (text) => this._spacing(() => {
      this._toolHost.command({ kind: 'spacing-input', text })
      this._toolHost.command({ kind: 'spacing-commit', via: 'enter' })
    }),
    blur: (text) => this._spacing(() => {
      this._toolHost.command({ kind: 'spacing-input', text })
      this._toolHost.command({ kind: 'spacing-commit', via: 'blur' })
    }),
    cancel: () => this._spacing(() => {
      this._toolHost.command({ kind: 'spacing-cancel' })
    }),
  }

  private readonly _config: RecogniserConfig
  private readonly _tool = signal<ToolId>(getCanvasTool() as ToolId)
  private readonly _overview = signal(false)
  private readonly _frames: ModeOverridingFrames
  private readonly _hostKeys: InteractionHostController
  private readonly _focus: CanvasFocusPort
  private readonly _handleLayer: HandleLayer
  private readonly _textEntry: TextEntryHost
  private readonly _tooltip: HoverTooltipController
  private readonly _lockedAffordance: LockedAffordanceController
  private readonly _toolHost: ToolHost
  private readonly _menu: ReturnType<typeof createContextMenuPort>
  private readonly _port: ReturnType<typeof createCanvasKeyboardPort>
  private readonly _navigation: InputRouterDeps['navigation'] & Pick<ViewNavigation, 'zoomIn' | 'zoomOut' | 'resetNorth' | 'rotateBy'>
  private readonly _router: ReturnType<typeof createInputRouter>
  private readonly _source: ReturnType<typeof createDomInputSource>
  private readonly _renderer: Pick<SceneRendererV2, 'setDraft'>
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
  private _handles: HandleList = NO_HANDLES
  private _activeHandle: HandleId = null
  /** The ruler pressed now, and its pointer: today's ruler drag, whose guide the session lands at the release. */
  private _rulerPress: RulerPress | null = null
  private _rulerPointer: number | null = null
  private _storyPresented = false
  /** Routing a move made with a button held: its hover reaches the host and the tool, not the lens (today's). */
  private _buttonHeld = false
  /** Inside refreshMeasurements' ToolHost.sceneChanged(): the runtime is already redrawing. */
  private _refreshing = false
  /** The pointer of the press being routed whose capture waits for the host's admission (ToolHostDeps.capturePress). */
  private _pressCapture: number | null = null
  /** The map's focus again on the frame after a drop, once the browser's drag end has run (today's). */
  private _dropFocusFrame: number | null = null
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
    }
    this._focus = focus
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
      this._handleLayer = own(createHandleLayer({ container, frames: this._frames }), (layer) => layer.dispose())
      this._textEntry = own(createTextEntryHost({
        container,
        frames: this._frames,
        translate: _deps.translate,
        focus,
      }), (entry) => entry.dispose())
      this._tooltip = own(createHoverTooltip(container), (tooltip) => tooltip.dispose())
      this._lockedAffordance = own(createLockedAffordance({
        container,
        translate: _deps.translate,
        onUnlock: (target) => this._unlock(target),
      }), (affordance) => affordance.dispose())
      const scene = createToolScene({
        store: liveStoreReader(_deps),
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
        },
        // The runtime's scene render asks the session to refresh (refreshMeasurements → sceneChanged): a redraw the host
        // requests from inside that refresh is the one already under way.
        invalidate: () => {
          if (!this._refreshing) _deps.render('scene')
        },
        chrome: {
          setHandles: (handles, active) => this._setHandles(handles, active),
          setCursor: (cursor) => {
            this._toolCursor = cursor
            this._applyCursor()
          },
          requestTextEntry: (request, submit, onCancel) => this._textEntry.open(request, submit, onCancel),
          closeTextEntry: () => this._textEntry.close(),
          submitUnfocusedTextEntry: () => this._textEntry.submitUnfocused(),
          isTextEntryOpen: () => this._textEntry.isOpen(),
          setTooltip: (tooltip) => this._showTooltip(tooltip),
          setLockedAffordance: (affordance) => this._showLockedAffordance(affordance),
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
        nudge: {
          nudgeSelected: (delta) => nudge?.nudgeSelected(delta) ?? false,
          endNudge: (options) => {
            if (options) nudge?.endNudge(options)
            else nudge?.endNudge()
          },
        },
        timers: { ...timers, clock },
        hover: (target) => _deps.setHoveredTarget(target),
        inspect: _deps.tryInspectAt,
        capturePress: (pointerId) => this._capturePress(pointerId),
        transientHistoryChanged: () => _deps.notifyTransientHistoryChange?.(),
        dropped: (kind) => this._dropped(kind),
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
          pointerSessionLive: () => this._pointerSessionLive(),
          overview: () => this._overview.peek(),
          spaceHeld: () => this._spaceHeld,
          keyState: (state) => this._setKeyState(state.space, state.mods),
          escapeGesture: () => this._escapeGesture(),
          requestTool: (id) => this._switchTool(id),
          clearSelection: () => {
            _deps.clearSelection()
            _deps.render('scene')
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
        listensToRulers: true,
      })
      this._stopWatchingSources = own(this._watchToolSources(), (stop) => stop())
      this._storyObserver = own(this._observeStoryPresentation(), (observer) => observer?.disconnect())
      this.setTool(this._tool.peek())
      this._handInitialSource()
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

  /**
   * Arms a tool on the host. A failure leaves the host on Select (its own rollback, not the tool left: that tool is
   * already deactivated, and reactivating it risks the same failure) and still ends the live presses, as today's setTool
   * had cleared the pointer gesture before the step that failed.
   */
  get tool(): ToolId {
    return this._tool.peek()
  }

  setTool(name: string): void {
    if (this._disposed) return
    const id = name as ToolId
    const previous = this._tool.peek()
    this._tool.value = id
    this._navigationCursor = null
    try {
      this._toolHost.setTool(id, toolSourceFor(id))
    } catch (error) {
      // The host's own rollback only runs once activation starts; a failure before that (cancelling the tool left) leaves
      // the host on `previous`, unchanged. Either way, activeToolIsSelect() names the host's real tool.
      const fellBackToSelect = this._toolHost.activeToolIsSelect()
      this._tool.value = fellBackToSelect ? 'select' : previous
      this._endPressesAfterFailedSwitch()
      // A fallback deactivates the tool left (unlike a re-arm of the same `previous`): its pick must not outlive it.
      if (fellBackToSelect && previous !== 'select') clearToolSource(previous)
      throw error
    }
    // The tool left drops its pick once it is deactivated, as today's tools did (the next tool never hears it).
    if (previous !== id) clearToolSource(previous)
    // The live presses belong to the tool left: they end on the host's path, which releases their capture.
    this._configure()
  }

  setOverviewMode(enabled: boolean): void {
    if (this._disposed || this._overview.peek() === enabled) return
    this._overview.value = enabled
    // The host hears the mode on a 'tools' frame (today's overview transition for a registered tool).
    this._frames.modeChanged()
    this._configure()
    if (!enabled) return
    this._releaseSpace()
    this._menu.close()
  }

  prepareForDocumentReplacement(): void {
    if (this._disposed) return
    const tool = this._tool.peek()
    runCanvasRuntimeCleanups([
      () => this._cancelDropFocus(),
      () => this._toolHost.prepareForDocumentReplacement(),
      () => this._escapeGesture(),
      () => clearToolSource(tool),
    ], 'Scene Interaction document replacement preparation failed')
  }

  refreshMeasurements(): void {
    if (this._disposed || this._refreshing) return
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
    this._lockedAffordance.refreshTranslations()
    this._toolHost.refreshTranslations()
  }

  canUndoTransientHistory(): boolean {
    return !this._disposed && this._toolHost.transientHistory.canUndo()
  }

  canRedoTransientHistory(): boolean {
    return !this._disposed && this._toolHost.transientHistory.canRedo()
  }

  undoTransientHistory(): boolean {
    return !this._disposed && this._toolHost.transientHistory.undo()
  }

  redoTransientHistory(): boolean {
    return !this._disposed && this._toolHost.transientHistory.redo()
  }

  subscribePointerWorld(listener: (point: WorldPoint | null) => void): () => void {
    // The held-button rule is the session's, not the host's: today's lens skipped every move made with a button held (a
    // press off the map, or a right press, dragged across it; a pen's barrel or eraser too).
    return this._toolHost.subscribePointerWorld((point) => {
      if (point && this._buttonHeld) return
      listener(point)
    })
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
    attempt(() => this._endRulerPress())
    attempt(() => this._storyObserver?.disconnect())
    attempt(() => this._stopWatchingSources())
    attempt(() => clearToolSource(tool))
    attempt(() => this._cancelDropFocus())
    attempt(() => this._toolHost.dispose())
    attempt(() => this._lockedAffordance.dispose())
    attempt(() => this._tooltip.dispose())
    attempt(() => this._textEntry.dispose())
    attempt(() => this._handleLayer.dispose())
    attempt(() => this._hostKeys.dispose())
    throwCanvasRuntimeCleanupErrors(errors, 'Scene Interaction Session disposal failed')
  }

  // ── Routing ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private _receive(input: RawInput): void {
    if (this._disposed) return
    // Every bit the pointer reports, a pen's barrel or eraser that LEGACY ignores as a press included, as today's lens read it.
    this._buttonHeld = input.kind === 'move' && input.buttonMask !== 0
    try {
      this._dispatch(input)
    } finally {
      this._buttonHeld = false
    }
  }

  private _dispatch(input: RawInput): void {
    const event = this._source.currentEvent()
    switch (input.kind) {
      case 'drop':
        this._routeDrop(input)
        return
      case 'focus-out':
        this._toolHost.endNudgeSeries(true)
        return
      case 'down':
        // A ruler sits beside the map host: its press is no press on the map (today's host listener never heard it).
        if (input.target.kind === 'ruler') this._pressRuler(input.id, event)
        else this._toolHost.rawPress(input.role === 'auxiliary' ? 'middle' : input.role, input.target, input.id)
        break
      case 'wheel':
        this._syncPointingDevice()
        break
      case 'cancel':
        // Today's ruler heard the blur itself: its drag ends with no guide, however the tool's blur fails.
        if (input.id === 'all') this._endRulerPress()
        break
      default:
        break
    }
    if (input.kind !== 'cancel' || input.id !== 'all') {
      this._route(input)
      return
    }
    // The rest of today's blur (Space, the keys, the host's interruption) runs even when the tool's blur fails.
    runCanvasRuntimeCleanups([
      () => this._route(input),
      () => this._interrupted(),
    ], 'Scene Interaction window blur failed')
  }

  /**
   * The host's path, then today's ruler drag, which heard its own mousemove and mouseup: the drag cursor follows the
   * pointer and the guide lands at the release whatever the tool did with the event, failure included.
   */
  private _route(input: RawInput): void {
    try {
      this._routeToHost(input)
    } finally {
      if (input.kind === 'move' && input.id === this._rulerPointer) this._rulerPress?.drag()
      if (input.kind === 'up' && input.id === this._rulerPointer) this._releaseRuler(input.at)
    }
  }

  /** The input: recognised, routed, and the recogniser's and the host's effects applied to the event. */
  private _routeToHost(input: RawInput): void {
    const result = recognise(this._recogniser, input, this._config)
    this._recogniser = result.state
    const wheel = input.kind === 'wheel'
    if (wheel) {
      // Today's _onWheel prevented a wheel the map takes, and closed the canvas menu, before it moved the camera: a zoom
      // or pan that fails still keeps the page from zooming or scrolling.
      this._source.apply(result.effects)
      if (result.effects.length > 0) this._menu.close()
    }
    // A press the host hears takes its capture once admitted, before the tool (ToolHostDeps.capturePress), as today's
    // order; a pan's press, which the host never hears, takes it with the rest. The effects before the held capture (the
    // release of the same pointer's session whose up was lost) apply first, so they cannot undo the new press's capture.
    const pressed = input.kind === 'down'
      && result.gestures.some((gesture) => gesture.kind === 'press' && gesture.id === input.id)
      ? input.id
      : null
    const heldAt = pressed === null
      ? -1
      : result.effects.findIndex((effect) => effect.kind === 'capture' && effect.pointerId === pressed)
    const heldCapture = heldAt >= 0
    const effects = heldCapture ? result.effects.slice(heldAt + 1) : result.effects
    if (heldCapture) this._source.apply(result.effects.slice(0, heldAt))
    let outcome: GestureOutcome = {}
    this._pressCapture = heldCapture ? pressed : null
    try {
      for (const gesture of result.gestures) {
        this._followNavigation(gesture)
        outcome = mergeOutcomes(outcome, this._router.route(gesture))
      }
    } finally {
      this._pressCapture = null
    }
    this._source.apply(outcomeEffects(wheel ? [] : effects, outcome))
    if (outcome.rejectSession && input.kind === 'down') {
      const rejected = recognise(this._recogniser, { kind: 'reject', t: input.t, id: input.id }, this._config)
      this._recogniser = rejected.state
      this._source.apply(rejected.effects)
    }
    if (this._releasesOutsideTool(input, result.gestures)) this._toolHost.released()
  }

  /**
   * Whether this input ended no press of the tool's, so today's window pointerup (or a pan's pointercancel or lost
   * capture) would have run the cancellation (ToolHost.released): the up, cancel or Esc that ends a pointer pan, or an up
   * with no press of the map's at all. Today's exceptions hold for the latter: nothing while another pointer's press is
   * live, in overview (the recogniser swallows the up), or over the note editor, a handle or the Unlock affordance. The
   * host handles the tap or drag-end of a ruler drag or of a press the tool never heard itself.
   */
  private _releasesOutsideTool(input: RawInput, gestures: readonly Gesture[]): boolean {
    if (gestures.some(endsPointerPan)) return input.kind === 'up' || (input.kind === 'cancel' && input.id !== 'all')
    if (input.kind !== 'up' || gestures.length > 0) return false
    if (this._recogniser.sessions.size > 0 || this._overview.peek()) return false
    return !isOwnedOverlay(input.target)
  }

  /** Raw input that does not come from an event (configure, key state, Esc), routed as an event's would be. */
  private _feed(input: RawInput): readonly Gesture[] {
    const result = recognise(this._recogniser, input, this._config)
    this._recogniser = result.state
    for (const gesture of result.gestures) {
      this._followNavigation(gesture)
      this._router.route(gesture)
    }
    this._source.apply(result.effects.filter((effect) => effect.kind === 'release-capture'))
    return result.gestures
  }

  /**
   * A panel drag over the map, routed to the host's drop route. A dragover whose route throws answers 'none' as well as
   * the source's quarantine, as today's rejected dragover did (and, unlike a drop, stays un-prevented: a failed dragover
   * refuses the drop target, as a never-prevented one does). A drop's own prevent-default (recognise.ts, unconditional
   * for an actual drop) must reach the event even when the route throws, or the browser's own drop runs, pasting the
   * payload into whatever has focus (spec §1.4 "Drops"); the single fault rule still rethrows.
   */
  private _routeDrop(input: Extract<RawInput, { kind: 'drop' }>): void {
    try {
      this._routeToHost(input)
    } catch (error) {
      if (input.phase === 'over') this._source.apply(NO_DROP)
      else if (input.phase === 'drop') this._source.apply(PREVENT_DEFAULT)
      throw error
    }
  }

  /**
   * After the host placed a drop (ToolHostDeps.dropped): a saved stamp's drag source is spent (the panel's dragend clears
   * it too), and the map takes focus again on the next frame, after the browser's drag end, as today's drop did. A window
   * blur, a document replacement and the session's end drop that focus.
   */
  private _dropped(kind: 'species' | 'saved-stamp'): void {
    if (this._disposed) return
    if (kind === 'saved-stamp') clearSavedObjectStampDragSource()
    this._cancelDropFocus()
    this._dropFocusFrame = window.requestAnimationFrame(() => {
      this._dropFocusFrame = null
      this._focus.focusMap('tool-requested')
    })
  }

  private _cancelDropFocus(): void {
    if (this._dropFocusFrame === null) return
    window.cancelAnimationFrame(this._dropFocusFrame)
    this._dropFocusFrame = null
  }

  // ── Rulers ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /** A press on a ruler: its overlay's port for this press, found from the element under the pointer (the drag starts). */
  private _pressRuler(pointerId: number, event: Event | null): void {
    this._endRulerPress()
    this._rulerPress = pressRuler(event?.target ?? null)
    this._rulerPointer = this._rulerPress ? pointerId : null
  }

  /**
   * Today's ruler drag at its release: the cursor comes back, then the guide lands where the pointer let go, only while
   * north is up (spec §4.6), under any tool.
   */
  private _releaseRuler(at: ScreenPoint): void {
    const press = this._rulerPress
    this._rulerPress = null
    this._rulerPointer = null
    if (!press) return
    press.end()
    if (this._frames.viewFrame.peek().view.northUp) press.createGuideAt(press.axis, at)
  }

  private _endRulerPress(): void {
    const press = this._rulerPress
    this._rulerPress = null
    this._rulerPointer = null
    press?.end()
  }

  /** After a window blur has reached the recogniser (Space released, live sessions ended) and the armed tool's path, even
   *  when that path failed. */
  private _interrupted(): void {
    this._spaceHeld = false
    this._port.releaseKeys()
    this._cancelDropFocus()
    this._setNavigationCursor(null)
    this._toolHost.interrupted()
  }

  private _pointerSessionLive(): boolean {
    return this._recogniser.sessions.size > 0 || this._toolHost.hasLiveGesture()
  }

  /** Esc with a pointer session live: the recogniser cancels it; a pan it ends runs today's cancellation (released). */
  private _escapeGesture(): void {
    const gestures = this._feed({ kind: 'escape', t: Date.now() })
    this._spaceHeld = false
    this._setNavigationCursor(this._panning ? 'grabbing' : null)
    if (gestures.some(endsPointerPan)) this._toolHost.released()
  }

  private _configure(): void {
    this._feed(this._configureInput())
  }

  private _configureInput(): RawInput {
    return {
      kind: 'configure',
      t: Date.now(),
      context: {
        tool: this._tool.peek(),
        mode: this._overview.peek() ? 'overview' : 'site',
        pointingDevice: this._pointingDevice,
        dragSlopPx: this._toolHost.activeToolDragSlopPx() ?? undefined,
      },
    }
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

  /**
   * After a failed switch the recogniser still ends its live sessions, with their captures and pans (today's cancellation
   * had cleared the pointer gesture before the step that failed). The tool's own cancel was the host's setTool, whose
   * failure it left pending: it is not retried here.
   */
  private _endPressesAfterFailedSwitch(): void {
    const result = recognise(this._recogniser, this._configureInput(), this._config)
    this._recogniser = result.state
    for (const gesture of result.gestures) this._followNavigation(gesture)
    this._source.apply(result.effects.filter((effect) => effect.kind === 'release-capture'))
    this._applyCursor()
  }

  /** ToolHostDeps.capturePress: applies the press's held-back capture; false when the press ended while it was taken. */
  private _capturePress(pointerId: number): boolean {
    if (this._pressCapture === pointerId) {
      this._pressCapture = null
      this._source.apply([{ kind: 'capture', pointerId }])
    }
    return this._recogniser.sessions.has(pointerId)
  }

  // ── Keys, the navigation cursor and camera moves ───────────────────────────────────────────────────────────────

  private _setKeyState(space: boolean, mods: Modifiers): void {
    this._spaceHeld = space
    this._feed({ kind: 'key-state', t: Date.now(), space, mods })
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
    if (!this._toolHost) return
    this._deps.container.style.cursor = this._navigationCursor ?? this._toolCursor ?? 'default'
  }

  /** A pan or zoom through today's camera navigation: the viewport render and today's refresh when the camera moved. */
  private _afterCameraMove(move: () => void): void {
    const before = this._deps.camera.snapshot.peek().revision
    move()
    if (this._deps.camera.snapshot.peek().revision === before) return
    this._deps.render('viewport')
  }

  // ── The host's chrome, and drafts and handles while a story is presented ─────────────────────────────────────────

  private _setDraft(draft: DraftPresentation | null): void {
    this._draft = draft
    this._renderer.setDraft(this._storyPresented ? null : draft)
  }

  private _setHandles(handles: HandleList, active: HandleId): void {
    this._handles = handles
    this._activeHandle = active
    if (!this._storyPresented) this._handleLayer.setHandles(handles, active)
  }

  /** The plant tooltip names the hovered plant as today: its localised common name, else the stored one, and its species. */
  private _showTooltip(tooltip: PassiveHoverAt | null): void {
    const plant = tooltip?.target.kind === 'plant'
      ? this._deps.getSceneStore().persisted.plants.find((entry) => entry.id === tooltip.target.id)
      : undefined
    if (!tooltip || !plant) {
      this._tooltip.hide()
      return
    }
    const commonName = this._deps.getLocalizedCommonNames().get(plant.canonicalName) ?? plant.commonName
    this._tooltip.show(tooltip.at.x, tooltip.at.y, commonName, plant.canonicalName)
  }

  private _showLockedAffordance(affordance: PassiveHoverAt | null): void {
    if (!affordance) {
      this._lockedAffordance.hide()
      return
    }
    this._lockedAffordance.show({ target: affordance.target, screenX: affordance.at.x, screenY: affordance.at.y })
  }

  /** The Unlock affordance's button: today's unlock edit, after which the affordance goes. */
  private _unlock(target: SceneDesignObjectTarget): void {
    this._deps.sceneEdits.run('unlock-design-object', (tx) => {
      tx.mutate((draft) => setSceneDesignObjectLocks(draft, [target], false))
    }, { onCommitted: () => this._lockedAffordance.hide() })
  }

  /**
   * Today's CSS hid the DOM previews, the rotation handle and the control points while a story is presented
   * (html[data-story-presenting]); the draft and the handles follow it.
   */
  private _observeStoryPresentation(): MutationObserver | null {
    if (typeof MutationObserver === 'undefined') return null
    const observer = new MutationObserver(() => {
      const presented = isStoryPresented()
      if (presented === this._storyPresented || this._disposed) return
      this._storyPresented = presented
      this._renderer.setDraft(presented ? null : this._draft)
      if (presented) this._handleLayer.setHandles(NO_HANDLES, null)
      else this._handleLayer.setHandles(this._handles, this._activeHandle)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [STORY_PRESENTING_ATTRIBUTE] })
    return observer
  }

  // ── The plant and saved-stamp read models ──────────────────────────────────────────────────────────────────────

  /**
   * Place plants or the saved-stamp tool hears a new source while armed: the plant source after a microtask,
   * inside the settled admission (a pick from the chooser leaves its own update first), the saved stamp at once.
   */
  private _watchToolSources(): () => void {
    let plant = readPlantStampSource()
    let saved = readSavedObjectStampSource()
    const stopPlant = effect(() => {
      const next = readPlantStampSource()
      if (next === plant) return
      plant = next
      if (this._tool.peek() !== 'plant-stamp') return
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
      if (this._tool.peek() !== 'saved-object-stamp') return
      this._toolHost.sourceChanged(toolSourceFor('saved-object-stamp'))
    })
    return () => {
      stopPlant()
      stopSaved()
    }
  }

  /**
   * The host activated the first tool with no source, and the watchers start from the picks already made: a stamp tool
   * armed with a pick when the map mounts (or mounts again) hears it now, as today's tools read it live.
   */
  private _handInitialSource(): void {
    const tool = this._tool.peek()
    const source = toolSourceFor(tool)
    if (source) this._toolHost.sourceChanged(source)
  }

  private _spacing(run: () => void): void {
    if (!this._disposed) run()
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

  const host: InteractionHostController = {
    refreshTranslations,
    dispose() {
      description.remove()
      for (const [name, value] of previous) {
        if (value === null) container.removeAttribute(name)
        else container.setAttribute(name, value)
      }
    },
  }
  try {
    container.appendChild(description)
    container.tabIndex = 0
    container.setAttribute('role', 'application')
    container.setAttribute('aria-describedby', description.id)
    refreshTranslations()
  } catch (error) {
    // The session never owns a host whose name failed to translate: it is restored here.
    host.dispose()
    throw error
  }
  return host
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

/** Leaving a stamp tool (or ending the session) drops its pick, as today's tools did on deactivation. */
function clearToolSource(tool: ToolId): void {
  if (tool === 'plant-stamp') clearPlantStampSource()
  else if (tool === 'saved-object-stamp') clearSavedObjectStampSource()
}

/** The end of a pan that a pointer drove (middle, Space, overview, the Pan tool), not a wheel's. */
function endsPointerPan(gesture: Gesture): boolean {
  return gesture.kind === 'pan' && gesture.phase === 'end' && gesture.source !== 'wheel'
}

/** The note editor, a handle or the Unlock affordance: today's owned overlays, over which a release ran no cleanup. */
function isOwnedOverlay(target: TargetClass): boolean {
  if (target.kind === 'owned-chrome') return target.lockedAffordance === true
  return target.kind === 'owned-text' || target.kind === 'handle'
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
