// canvas/runtime/scene-interaction.ts
//
// The legacy bridge (0B-2 to the end of 0B, plan §4 0B, spec §1.4 "The legacy bridge"): today's interaction session, which
// interaction-session.ts runs for every tool not yet listed in tools/registry.ts. It owns no listener: the session hands it
// the DOM event the DOM input source is handling (DomInputSource.currentEvent()), and it runs today's handlers on it with
// the SceneToolAdapter hooks of the tools still in interaction/tool-modules.ts, and Select, Pan, the chrome and drops
// through shared-gestures.ts. Its pointer capture goes through the source (which forwards the capture's loss), its keys
// are keyboard-port.ts's (the hooks below are the steps a bridged tool keeps), and the arrow-nudge series is the
// ToolHost's. While a registered tool is armed it idles: no adapter, no Select affordances, no passive hover, no guidance.
// It also lends the ToolHost its tooltip, Unlock affordance and note editor (the session's 0B-2 chrome adapter).
// The main agent deletes it at the end of 0B; the session is re-exported here for the suites that import it from here.

import { getDesignObjectSelectionModel } from './scene-runtime/selection'
import { gridInterval, snapToGrid } from '../grid'
import { snapToGuides } from '../guides'
import type { SceneDesignObjectTarget, ScenePoint } from './scene'
import {
  includesSceneDesignObjectTarget,
  resolveSceneObjectGroupMembers,
  sceneObjectGroupMemberLayerName,
} from './scene'
import { hitTestTopLevel, hitTestVisibleTopLevel, type TopLevelTarget } from './tools/hit-testing'
import { createHoverTooltip, type HoverTooltipController } from './interaction/hover-tooltip'
import {
  createInteractionPreview,
  hideInteractionPreview,
  showInteractionPreview,
} from './interaction/overlay-ui'
import { cursorForTool } from './interaction/pointer-utils'
import { allowsNativeContextMenuTarget } from './input/dom-input-source'
import {
  appendPlantStampSourceToDraft,
} from './tools/tool-actions'
import { isSceneLayerOpenForCreation } from './interaction/layer-guards'
import { hasPlantStampDragData, readPlantStampDropSource } from '../plant-stamp-source'
import {
  clearSavedObjectStampDragSource,
  hasSavedObjectStampDragData,
  readSavedObjectStampDragPreviewSource,
  readSavedObjectStampDropSource,
} from '../saved-object-stamp-source'
import {
  clearSavedObjectStampGhosts,
  placeSavedObjectStampAt,
  previewSavedObjectStampAt,
} from './interaction/saved-object-stamp-tool'
import {
  createSceneToolRegistry,
  type SceneToolRegistry,
} from './interaction/tool-modules'
import type {
  SceneToolAdapter,
  SceneToolPointerDrag,
  SceneToolTransientOptions,
} from './interaction/tool-adapter'
import {
  createSceneInteractionSharedGestures,
  type SceneInteractionSharedGestures,
} from './interaction/shared-gestures'
import {
  createAnnotationInlineEditor,
  type AnnotationInlineEditorController,
} from './interaction/annotation-inline-editor'
import {
  createCanvasContextMenu,
  type CanvasContextMenuController,
} from './interaction/canvas-context-menu'
import {
  createSelectionRotationHandle,
  type SelectionRotationHandleController,
} from './interaction/selection-rotation-handle'
import {
  createZoneControlPoints,
} from './interaction/zone-control-points'
import {
  createMeasurementGuideControlPoints,
} from './interaction/measurement-guide-control-points'
import type { ControlPointOverlayController } from './interaction/control-point-overlay'
import type { CanvasDesignObjectSelectionModel, CanvasPlantRowSpacingField } from './runtime'
import {
  createLockedObjectAffordance,
  type LockedObjectAffordanceController,
} from './interaction/locked-object-affordance'
import {
  isDirectSceneDesignObjectLocked,
  isSceneDesignObjectLocked,
  setSceneDesignObjectLocks,
} from './scene/locks'
import type { ScenePersistedState } from './scene'
import { IDLE_CANVAS_TOOL_GUIDANCE } from '../session-state'
import {
  runCanvasRuntimeCleanups,
  throwCanvasRuntimeCleanupErrors,
} from './cleanup'
import type { LegacyKeyBridge } from './keyboard-port'
import type { SceneInteractionSessionDeps } from './interaction-session'

export {
  createSceneInteractionSession,
  type SceneInteractionSession,
  type SceneInteractionSessionDeps,
} from './interaction-session'

/** A keyboard-opened menu ignores the contextmenu event the same key press sends. */
const KEYBOARD_CONTEXT_MENU_ECHO_MS = 500

type InteractionTool = 'select' | 'hand' | 'rectangle' | 'text' | 'plant-stamp' | 'object-stamp' | 'plant-spacing' | string

interface SceneInteractionPointerGesture {
  readonly pointerId: number
  readonly startScreen: ScenePoint
  readonly startWorld: ScenePoint
  readonly containerRect: DOMRect
}

interface SceneInteractionCancellationOptions extends SceneToolTransientOptions {
  readonly releaseSpace?: boolean
}

/**
 * What the bridge runs on: the session's dependencies (interaction-session.ts declares them, today's and the pipeline's),
 * less the pipeline's own.
 */
export type LegacyInteractionBridgeDeps = Omit<
  SceneInteractionSessionDeps,
  'frames' | 'viewNavigation' | 'renderer' | 'focus' | 'sceneRevision' | 'platform'
>

/** What the interaction session lends the bridge: the pipeline's state that today's session kept itself. */
export interface LegacyInteractionBridgeHooks {
  /** Pointer capture through the DOM input source, which forwards the capture's loss (lost-capture) back here. */
  readonly pointerCapture: { capture(pointerId: number): void; release(pointerId: number): void }
  /** The ToolHost's arrow-nudge series: the bridge ends it where today's session ended its own. */
  endNudgeSeries(options?: { readonly abort?: boolean }): void
  /** When the keyboard last opened the canvas menu (event time), for the contextmenu echo. */
  lastKeyboardMenuAt(): number | null
  /** Space held for panning (the session's key state, which the keyboard port sets). */
  readonly space: { held(): boolean; release(): void }
  /** True while the tool runs on the ToolHost: the bridge idles. */
  isRegistered(tool: string): boolean
  /** Arms a tool through the session (the runtime's setTool, then the session), as today's _switchTool did. */
  switchTool(name: string): void
}

/** The bridge the interaction session drives. */
export interface LegacyInteractionBridge extends LegacyKeyBridge {
  readonly plantRowSpacing: CanvasPlantRowSpacingField
  setTool(name: string): void
  setOverviewMode(enabled: boolean): void
  prepareForDocumentReplacement(): void
  /** Today's refreshMeasurements: the viewport-dependent refresh after a camera change. */
  refreshMeasurements(): void
  /** After the selection or the scene changed (a nudge, a series end). */
  refreshSelectionDependent(): void
  refreshTranslations(): void
  canUndoTransientHistory(): boolean
  canRedoTransientHistory(): boolean
  undoTransientHistory(): boolean
  redoTransientHistory(): boolean
  dispose(): void

  // Today's handlers, given the DOM event being handled.
  pointerDown(event: PointerEvent): void
  pointerMove(event: PointerEvent): void
  pointerUp(event: PointerEvent): void
  pointerCancel(event: PointerEvent): void
  lostPointerCapture(event: PointerEvent): void
  pointerLeave(): void
  windowBlur(): void
  wheel(event: WheelEvent): void
  contextMenu(event: MouseEvent): void
  dragOver(event: DragEvent): void
  dragLeave(): void
  drop(event: DragEvent): void

  /** A pointer press or pan is live (today's _pointerGesture). */
  hasPointerGesture(): boolean
  /** Space went down or up: today's grab cursor, or the tool's again once no pan is live. */
  spaceChanged(held: boolean): void
  /** The rAF focus after a drop is dropped (a window blur). */
  cancelPendingFocus(): void

  // The ToolHost's chrome until D1's chrome/*.ts (0B-3): one element each.
  isTextEntryOpen(): boolean
  setTooltip(tooltip: { readonly target: SceneDesignObjectTarget; readonly at: ScenePoint } | null): void
  setLockedAffordance(affordance: { readonly target: SceneDesignObjectTarget; readonly at: ScenePoint } | null): void
  closeMenu(): void
}

export function createLegacyInteractionBridge(
  deps: LegacyInteractionBridgeDeps,
  hooks: LegacyInteractionBridgeHooks,
): LegacyInteractionBridge {
  return new DefaultLegacyInteractionBridge(deps, hooks)
}

class DefaultLegacyInteractionBridge implements LegacyInteractionBridge {
  private readonly _preview: HTMLDivElement
  private readonly _tooltip: HoverTooltipController
  private readonly _toolRegistry: SceneToolRegistry
  private readonly _sharedGestures: SceneInteractionSharedGestures
  private readonly _annotationEditor: AnnotationInlineEditorController
  private readonly _contextMenu: CanvasContextMenuController
  private readonly _rotationHandle: SelectionRotationHandleController
  private readonly _controlPointOverlays: readonly ControlPointOverlayController[]
  private readonly _lockedAffordance: LockedObjectAffordanceController
  private _tool: InteractionTool = 'select'
  private _pointerGesture: SceneInteractionPointerGesture | null = null
  private _toolPointerDrag: SceneToolPointerDrag | null = null
  private _disposed = false
  private _transientCancellationPending = false
  private _designObjectDragPresentationSuppressed = false
  private _pendingInteractionHostFocusFrame: number | null = null
  private _overviewMode = false
  readonly plantRowSpacing: CanvasPlantRowSpacingField = {
    input: (text) => this._runSpacingField((field) => field.input(text)),
    commit: (text) => this._runSpacingField((field) => field.commit(text)),
    blur: (text) => this._runSpacingField((field) => field.blur(text)),
    cancel: () => this._runSpacingField((field) => field.cancel()),
  }

  constructor(
    private readonly _deps: LegacyInteractionBridgeDeps,
    private readonly _hooks: LegacyInteractionBridgeHooks,
  ) {
    const rollback: Array<() => void> = []
    const own = <T>(resource: T, dispose: (resource: T) => void): T => {
      rollback.push(() => dispose(resource))
      return resource
    }

    try {
      this._preview = own(
        createInteractionPreview(this._deps.container),
        (preview) => preview.remove(),
      )
      this._tooltip = own(
        createHoverTooltip(this._deps.container),
        (tooltip) => tooltip.dispose(),
      )
      this._toolRegistry = own(createSceneToolRegistry({
        container: this._deps.container,
        preview: this._preview,
        camera: this._deps.camera,
        sceneEdits: this._deps.sceneEdits,
        getSceneStore: this._deps.getSceneStore,
        getSelection: this._deps.getSelection,
        clearSelection: this._deps.clearSelection,
        render: this._deps.render,
        getSpeciesCache: this._deps.getSpeciesCache,
        getPlantPresentationContext: this._deps.getPlantPresentationContext,
        getLocalizedCommonNames: this._deps.getLocalizedCommonNames,
        translate: this._deps.translate,
        switchTool: (name) => this._switchTool(name),
        focusHost: () => this._focusInteractionHost(),
        applySnapping: (point) => this._applySnapping(point),
        notifyTransientHistoryChange: () => this._deps.notifyTransientHistoryChange?.(),
        notifyGuidanceChange: () => this._publishToolGuidance(),
      }), disposeSceneToolRegistry)
      this._annotationEditor = own(createAnnotationInlineEditor({
        container: this._deps.container,
        camera: this._deps.camera,
        getSceneStore: this._deps.getSceneStore,
        sceneEdits: this._deps.sceneEdits,
        canEditAnnotation: (annotationId) => this._canEditAnnotation(annotationId),
        focusHost: () => this._focusInteractionHost(),
        translate: this._deps.translate,
        refreshSelectionDependent: () => this._refreshSelectionDependentMeasurements(),
      }), (editor) => editor.dispose())
      this._sharedGestures = own(createSceneInteractionSharedGestures({
        container: this._deps.container,
        preview: this._preview,
        camera: this._deps.camera,
        cameraNavigation: this._deps.cameraNavigation,
        getSceneStore: this._deps.getSceneStore,
        getSelection: this._deps.getSelection,
        getDesignObjectSelection: this._deps.getDesignObjectSelection,
        setSelection: this._deps.setSelection,
        clearSelection: this._deps.clearSelection,
        sceneEdits: this._deps.sceneEdits,
        render: this._deps.render,
        getSpeciesCache: this._deps.getSpeciesCache,
        getPlantPresentationContext: this._deps.getPlantPresentationContext,
        applySnapping: (point) => this._applySnapping(point),
        refreshViewportDependent: () => this._refreshViewportDependentMeasurements(),
        refreshSelectionDependent: () => this._refreshSelectionDependentMeasurements(),
        beginDesignObjectDragPresentation: () => this._beginDesignObjectDragPresentation(),
        endDesignObjectDragPresentation: () => this._endDesignObjectDragPresentation(),
        beginAnnotationTextEdit: (annotationId) => this._beginAnnotationTextEdit(annotationId),
      }), (gestures) => gestures.dispose())
      this._contextMenu = own(createCanvasContextMenu({
        container: this._deps.container,
        camera: this._deps.camera,
        adapter: this._deps.contextMenu,
        commands: this._deps.selectionCommands,
        saveSelectionAsObjectStamp: this._deps.contextualCommands?.saveSelectionAsObjectStamp,
        placePlantsAt: (world) => this._placePlantsAt(world),
        returnFocus: () => this._focusInteractionHost(),
      }), (menu) => menu.dispose())
      this._rotationHandle = own(createSelectionRotationHandle({
        container: this._deps.container,
        camera: this._deps.camera,
        getSceneStore: this._deps.getSceneStore,
        getSelection: this._deps.getDesignObjectSelection,
        sceneEdits: this._deps.sceneEdits,
        render: this._deps.render,
        translate: this._deps.translate,
        refreshSelectionDependent: () => this._refreshSelectionDependentMeasurements(),
      }), (handle) => handle.dispose())
      const controlPointOverlayOptions = {
        container: this._deps.container,
        camera: this._deps.camera,
        getSceneStore: this._deps.getSceneStore,
        getSelection: this._deps.getDesignObjectSelection,
        sceneEdits: this._deps.sceneEdits,
        applySnapping: (point: ScenePoint) => this._applySnapping(point),
        render: this._deps.render,
        refreshSelectionDependent: () => this._refreshSelectionDependentMeasurements(),
        beginDragPresentation: () => this._beginDesignObjectDragPresentation(),
        endDragPresentation: () => this._endDesignObjectDragPresentation(),
      }
      this._controlPointOverlays = [
        own(
          createZoneControlPoints(controlPointOverlayOptions),
          (controlPoints) => controlPoints.dispose(),
        ),
        own(
          createMeasurementGuideControlPoints(controlPointOverlayOptions),
          (controlPoints) => controlPoints.dispose(),
        ),
      ]
      this._lockedAffordance = own(createLockedObjectAffordance({
        container: this._deps.container,
        translate: this._deps.translate,
        onUnlock: (target) => this._unlockLockedObject(target),
      }), (affordance) => affordance.dispose())
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
    const previousTool = this._tool
    const changingTool = this._tool !== name
    if (changingTool) this._annotationEditor.cancel()

    const previousAdapter = this._activeToolAdapter()
    this._cancelTransientInteraction()
    const previousCursor = this._deps.container.style.cursor
    let previousDeactivationAttempted = false
    let nextAdapter: SceneToolAdapter | null = null
    let nextActivationAttempted = false
    try {
      if (changingTool) {
        previousDeactivationAttempted = true
        previousAdapter?.onDeactivate?.()
      }

      this._tool = name
      // A tool the ToolHost runs holds no legacy adapter here: the bridge idles.
      nextAdapter = this._toolRegistry.select(this._idle() ? '' : name)
      if (changingTool) {
        nextActivationAttempted = true
        nextAdapter?.onActivate?.()
      }
      if (!this._idle()) this._deps.container.style.cursor = cursorForTool(name)
      this._refreshSelectionDependentMeasurements()
      this._publishToolGuidance()
    } catch (error) {
      const errors: unknown[] = [error]
      const attempt = (rollback: () => void): void => {
        try {
          rollback()
        } catch (rollbackError) {
          errors.push(rollbackError)
        }
      }

      if (nextActivationAttempted) attempt(() => nextAdapter?.onDeactivate?.())
      this._tool = previousTool
      this._toolRegistry.select(this._idle() ? '' : previousTool)
      this._deps.container.style.cursor = previousCursor
      if (previousDeactivationAttempted) attempt(() => previousAdapter?.onActivate?.())
      attempt(() => this._refreshSelectionDependentMeasurements())
      throwCanvasRuntimeCleanupErrors(errors, 'Scene Interaction tool transition failed')
    }
  }

  setOverviewMode(enabled: boolean): void {
    if (this._disposed || this._overviewMode === enabled) return
    this._overviewMode = enabled
    if (!enabled) {
      this._refreshSelectionDependentMeasurements()
      return
    }
    this._designObjectDragPresentationSuppressed = false
    runCanvasRuntimeCleanups([
      () => this._annotationEditor.cancel(),
      () => this._cancelTransientInteraction({ releaseSpace: true }),
      () => this._contextMenu.close(),
      () => hideInteractionPreview(this._preview),
      () => clearSavedObjectStampGhosts(this._preview),
      () => this._rotationHandle.hide(),
      ...this._controlPointOverlays.map((overlay) => () => overlay.hide()),
      () => this._clearPassiveHoverPresentation(),
    ], 'Scene Interaction overview transition failed')
  }

  prepareForDocumentReplacement(): void {
    if (this._disposed) return
    this._designObjectDragPresentationSuppressed = false
    runCanvasRuntimeCleanups([
      () => this._cancelPendingInteractionHostFocus(),
      () => this._annotationEditor.cancel(),
      () => this._cancelTransientInteraction({ releaseSpace: true }),
      () => this._contextMenu.close(),
      () => hideInteractionPreview(this._preview),
      () => clearSavedObjectStampGhosts(this._preview),
      () => this._rotationHandle.hide(),
      ...this._controlPointOverlays.map((overlay) => () => overlay.hide()),
      () => this._clearPassiveHoverPresentation(),
    ], 'Scene Interaction document replacement preparation failed')
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

    attempt(() => this._cancelPendingInteractionHostFocus())
    attempt(() => this._cancelTransientInteraction())
    attempt(() => this._activeToolAdapter()?.onDeactivate?.())
    attempt(() => this._contextMenu.dispose())
    attempt(() => this._rotationHandle.dispose())
    for (const overlay of this._controlPointOverlays) attempt(() => overlay.dispose())
    attempt(() => this._lockedAffordance.dispose())
    attempt(() => this._annotationEditor.dispose())
    attempt(() => this._sharedGestures.dispose())
    attempt(() => this._forEachUniqueToolHook('dispose', (dispose) => attempt(dispose)))
    attempt(() => this._preview.remove())
    attempt(() => this._tooltip.dispose())
    attempt(() => this._deps.setHoveredTarget(null))
    attempt(() => this._deps.publishToolGuidance?.(IDLE_CANVAS_TOOL_GUIDANCE))

    throwCanvasRuntimeCleanupErrors(errors, 'Scene Interaction Session disposal failed')
  }

  refreshMeasurements(): void {
    if (this._disposed) return
    this._refreshViewportDependentMeasurements()
  }

  refreshSelectionDependent(): void {
    if (this._disposed) return
    this._refreshSelectionDependentMeasurements()
  }

  refreshTranslations(): void {
    if (this._disposed) return
    this._rotationHandle.refreshTranslations()
    this._lockedAffordance.refreshTranslations()
    this._forEachUniqueToolHook('refreshTranslations', (refresh) => refresh())
  }

  canUndoTransientHistory(): boolean {
    if (this._disposed) return false
    return this._activeToolAdapter()?.canUndoTransientHistory?.() ?? false
  }

  canRedoTransientHistory(): boolean {
    if (this._disposed) return false
    return this._activeToolAdapter()?.canRedoTransientHistory?.() ?? false
  }

  undoTransientHistory(): boolean {
    if (this._disposed) return false
    return this._activeToolAdapter()?.undoTransientHistory?.() ?? false
  }

  redoTransientHistory(): boolean {
    if (this._disposed) return false
    return this._activeToolAdapter()?.redoTransientHistory?.() ?? false
  }

  hasPointerGesture(): boolean {
    return this._pointerGesture !== null
  }

  spaceChanged(held: boolean): void {
    if (held) {
      if (this._overviewMode || (!this._toolPointerDrag && this._tool !== 'hand')) {
        this._deps.container.style.cursor = 'grab'
      }
      return
    }
    if (!this._sharedGestures.panning) {
      this._deps.container.style.cursor = cursorForTool(this._tool)
    }
  }

  cancelPendingFocus(): void {
    this._cancelPendingInteractionHostFocus()
  }

  isTextEntryOpen(): boolean {
    return this._annotationEditor.hasActiveEditor()
  }

  setTooltip(tooltip: { readonly target: SceneDesignObjectTarget; readonly at: ScenePoint } | null): void {
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

  setLockedAffordance(affordance: { readonly target: SceneDesignObjectTarget; readonly at: ScenePoint } | null): void {
    if (!affordance) {
      this._lockedAffordance.hide()
      return
    }
    this._lockedAffordance.show({ target: affordance.target, screenX: affordance.at.x, screenY: affordance.at.y })
  }

  closeMenu(): void {
    this._contextMenu.close()
  }

  // ── Keys the bridged tool keeps (keyboard-port.ts runs today's order) ─────────────────────────────────────────────

  retryPendingCancellation(event: KeyboardEvent): boolean {
    return this._retryPendingTransientCancellation(event)
  }

  cancelInterrupted(): void {
    this._cancelInterruptedInteraction()
  }

  hasActiveSceneEdit(): boolean {
    return this._hasActiveSceneEdit()
  }

  openMenuFromKeyboard(event: KeyboardEvent): void {
    this._runAdmittedSceneEvent(event, () => {
      if (this._annotationEditor.hasActiveEditor()) this._annotationEditor.commit()
      this._contextMenu.openFromKeyboard(this._deps.getDesignObjectSelection())
    }, { resumePending: true })
  }

  toolKeyDown(event: KeyboardEvent): boolean {
    return this._activeToolAdapter()?.keyDown?.(event) ?? false
  }

  suppressesSharedKeyboard(event: KeyboardEvent): boolean {
    return this._activeToolAdapter()?.shouldSuppressSharedKeyboard?.(event) ?? false
  }

  /** Enter or F2 with one editable note selected (the port checked the key, the tool and the target). */
  editSelectedNote(): boolean {
    const selection = this._deps.getDesignObjectSelection()
    if (
      selection.editableTargets.length !== 1
      || (selection.lockedTargets?.length ?? 0) > 0
      || (selection.blockedTargets?.length ?? 0) > 0
    ) return false

    const target = selection.editableTargets[0]
    if (target?.kind !== 'annotation') return false
    return this._beginAnnotationTextEdit(target.id)
  }

  publishGuidance(): void {
    this._publishToolGuidance()
  }

  // ── Today's handlers ────────────────────────────────────────────────────────────────────────────────────────────

  pointerDown(event: PointerEvent): void {
    this._endNudge()
    if (event.button !== 0 && event.button !== 1) return
    if (this._pointerGesture && this._pointerGesture.pointerId !== event.pointerId) return
    if (this._retryPendingTransientCancellation(event)) return
    this._contextMenu.close()
    if (this._annotationEditor.contains(event.target)) return
    if (this._lockedAffordance.contains(event.target)) return

    try {
      this._runAdmittedSceneEvent(event, () => {
        this._pointerDownWhenSettled(event)
      }, { resumePending: true })
    } finally {
      this._publishToolGuidance()
    }
  }

  private _pointerDownWhenSettled(event: PointerEvent): void {
    if (this._annotationEditor.hasActiveEditor()) this._annotationEditor.commit()
    if (this._activeToolAdapter()?.shouldIgnorePointerEvent?.(event.target) ?? false) return

    this._claimInteractionPointerDown(event)

    const containerRect = this._deps.container.getBoundingClientRect()
    const screen = this._screenPoint(event, containerRect)
    const world = this._deps.camera.screenToWorld(screen)
    this._pointerGesture = {
      pointerId: event.pointerId,
      startScreen: screen,
      startWorld: world,
      containerRect,
    }
    this._toolPointerDrag = null
    // Publish the gesture before capture: a browser may synchronously report loss.
    this._hooks.pointerCapture.capture(event.pointerId)
    if (this._pointerGesture?.pointerId !== event.pointerId) return

    if (this._overviewMode) {
      this._sharedGestures.beginPan({
        event,
        screen,
        world,
        tool: 'hand',
        spaceHeld: true,
      })
      return
    }

    if (event.button === 0 && this._rotationHandle.contains(event.target)) {
      const rotationDrag = this._rotationHandle.pointerDown({ event, rawWorld: world })
      if (rotationDrag) this._toolPointerDrag = rotationDrag
      else this._clearPointerGesture()
      return
    }

    if (event.button === 0) {
      for (const overlay of this._controlPointOverlays) {
        if (!overlay.contains(event.target)) continue
        const controlPointDrag = overlay.pointerDown({ event, rawWorld: world })
        if (controlPointDrag) this._toolPointerDrag = controlPointDrag
        else this._clearPointerGesture()
        return
      }
    }

    if (this._sharedGestures.beginPan({
      event,
      screen,
      world,
      tool: this._tool,
      spaceHeld: this._hooks.space.held(),
    })) return

    // Inspection owns the plain left click while it is active, so drawing and
    // selection stay suspended without a second gesture owner.
    if (event.button === 0 && this._deps.tryInspectAt?.(world)) {
      this._clearPointerGesture()
      return
    }

    if (this._activeToolAdapter()?.pointerDown?.({
      event,
      screen,
      rawWorld: world,
      beginDrag: (drag) => {
        this._toolPointerDrag = drag
      },
      clearPointerGesture: () => this._clearPointerGesture(),
    }) ?? false) {
      return
    }

    this._sharedGestures.beginSelectionGesture({
      event,
      screen,
      world,
      tool: this._tool,
      spaceHeld: this._hooks.space.held(),
    })
  }

  pointerLeave(): void {
    this._clearPassiveHoverPresentation()
  }

  private _updateHover(event: PointerEvent): void {
    if (this._overviewMode) {
      this._clearPassiveHoverPresentation()
      return
    }
    if (this._activeToolAdapter()?.shouldSuppressHover?.() ?? false) {
      this._clearPassiveHoverPresentation()
      return
    }

    const rect = this._deps.container.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom) {
      this._clearPassiveHoverPresentation()
      return
    }
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const world = this._deps.camera.screenToWorld(screen)
    const hit = hitTestVisibleTopLevel(
      this._deps.getSceneStore().persisted,
      world,
      this._deps.camera.viewport.scale,
      this._deps.getSpeciesCache(),
      this._deps.getPlantPresentationContext,
      this._deps.getSelection(),
      this._deps.getSceneStore().session.hoveredTarget,
    )
    this._deps.setHoveredTarget(hit)
    this._syncLockedObjectAffordance(hit, screen, this._deps.getSceneStore().persisted)

    if (hit?.kind === 'plant') {
      const plant = this._deps.getSceneStore().persisted.plants.find((p) => p.id === hit.id)
      if (plant) {
        const commonName = this._deps.getLocalizedCommonNames().get(plant.canonicalName) ?? plant.commonName
        this._tooltip.show(screen.x, screen.y, commonName, plant.canonicalName)
      }
    } else {
      this._tooltip.hide()
    }
  }

  pointerMove(event: PointerEvent): void {
    try {
      this._handlePointerMove(event)
    } finally {
      // A tool's live figures (Plant a row's count) follow the pointer; equal guidance publishes nothing.
      this._publishToolGuidance()
    }
  }

  private _handlePointerMove(event: PointerEvent): void {
    if (!this._pointerGesture) {
      if (this._overviewMode) return
      if (this._isOwnedOverlayPointerTarget(event.target)) return

      const screen = this._screenPoint(event)
      const rawWorld = this._deps.camera.screenToWorld(screen)
      if (this._activeToolAdapter()?.pointerMoveWithoutCapture?.({ event, screen, rawWorld }) ?? false) return
      this._updateHover(event)
      return
    }
    const pointerGesture = this._pointerGesture
    if (pointerGesture.pointerId !== event.pointerId) return

    const screen = this._screenPoint(event)
    const rawWorld = this._deps.camera.screenToWorld(screen)

    if (this._sharedGestures.active && this._sharedGestures.pointerMove({ screen, rawWorld })) return

    const toolDrag = this._toolPointerDrag
    if (toolDrag) {
      toolDrag.update({ event, screen, rawWorld })
      return
    }

    if (this._activeToolAdapter()?.pointerMoveWithCapture?.({
      event,
      screen,
      rawWorld,
      startScreen: pointerGesture.startScreen,
      startWorld: pointerGesture.startWorld,
      beginDrag: (drag) => {
        this._toolPointerDrag = drag
      },
      clearPointerGesture: () => this._clearPointerGesture(),
    }) ?? false) {
      return
    }
  }

  pointerUp(event: PointerEvent): void {
    if (this._retryPendingTransientCancellation(event)) return
    if (this._overviewMode && !this._pointerGesture) {
      this._quarantineUnsettledSceneEvent(event)
      return
    }
    const hasPointerGesture = this._pointerGesture !== null
    if (!hasPointerGesture && this._isOwnedOverlayPointerTarget(event.target)) return
    if (!hasPointerGesture && (this._activeToolAdapter()?.shouldIgnorePointerUpWithoutCapture?.() ?? false)) return
    if (this._pointerGesture && this._pointerGesture.pointerId !== event.pointerId) return

    if (this._sharedGestures.requiresSettledPointerUp) {
      const admitted = this._runAdmittedSceneEvent(event, () => {
        this._finishPointerUp(event)
      }, { resumePending: true })
      if (!admitted) {
        try {
          this._cancelTransientInteraction()
        } finally {
          this._refreshViewportDependentMeasurements()
        }
      }
      return
    }

    this._finishPointerUp(event)
  }

  private _finishPointerUp(event: PointerEvent): void {
    const screen = this._screenPoint(event)
    const rawWorld = this._deps.camera.screenToWorld(screen)

    try {
      this._finishPointerUpGesture(event, screen, rawWorld)
    } finally {
      this._publishToolGuidance()
    }
  }

  private _finishPointerUpGesture(event: PointerEvent, screen: ScenePoint, rawWorld: ScenePoint): void {
    try {
      let preserveActiveDraft = false
      try {
        this._toolPointerDrag?.commit({ event, screen, rawWorld })
        const sharedResult = this._sharedGestures.pointerUp({
          screen,
          rawWorld,
          preserveActiveDraft: this._activeToolAdapter()?.shouldPreserveTransientOnPan?.() ?? false,
        })
        preserveActiveDraft = sharedResult.preserveActiveDraft
      } finally {
        try {
          this._cancelTransientInteraction({ preserveActiveDraft })
        } finally {
          this._refreshViewportDependentMeasurements()
        }
      }
    } catch (error) {
      this._quarantineUnsettledSceneEvent(event)
      throw error
    }
  }

  pointerCancel(event: PointerEvent): void {
    if (this._retryPendingTransientCancellation(event)) return
    if (!this._pointerGesture || this._pointerGesture.pointerId !== event.pointerId) return
    this._cancelInterruptedInteraction()
  }

  /** The source forwards only the loss of a capture it holds or is acquiring (it fences a release's own loss). */
  lostPointerCapture(event: PointerEvent): void {
    const pointerGesture = this._pointerGesture
    if (!pointerGesture || pointerGesture.pointerId !== event.pointerId) return
    this._cancelInterruptedInteraction()
  }

  windowBlur(): void {
    this._cancelPendingInteractionHostFocus()
    this._cancelInterruptedInteraction()
  }

  private _cancelInterruptedInteraction(): void {
    try {
      this._cancelTransientInteraction({
        preserveActiveDraft: this._activeToolAdapter()?.shouldPreserveTransientOnPan?.() ?? false,
        releaseSpace: true,
      })
    } finally {
      this._refreshViewportDependentMeasurements()
    }
  }

  wheel(event: WheelEvent): void {
    if (allowsNativeContextMenuTarget(event.target) || this._isOwnedOverlayPointerTarget(event.target)) return
    if (this._retryPendingTransientCancellation(event)) return
    event.preventDefault()
    this._contextMenu.close()
    const screen = this._screenPoint(event)
    const mode = event.deltaMode
    const size = this._deps.camera.screenSize
    const deltaX = event.deltaX * (mode === 1 ? 16 : mode === 2 ? size.width : 1)
    const deltaY = event.deltaY * (mode === 1 ? 16 : mode === 2 ? size.height : 1)
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return
    const beforeRevision = this._deps.camera.snapshot.peek().revision
    const scrollPans = (this._deps.readScrollWheel?.() ?? 'zoom') === 'pan'
    // A pinch arrives as Ctrl wheel and zooms whatever the setting says.
    if (event.ctrlKey || event.metaKey || (!scrollPans && !event.shiftKey)) {
      const factor = Math.exp(Math.max(-1, Math.min(1, -deltaY * 0.002)))
      this._deps.cameraNavigation.zoomAroundScreenPoint(screen, factor)
    } else if (scrollPans && event.shiftKey && deltaX === 0) {
      // A mouse wheel has one axis: Shift turns its scroll sideways.
      this._deps.cameraNavigation.panBy({ x: -deltaY, y: 0 })
    } else {
      this._deps.cameraNavigation.panBy({ x: -deltaX, y: -deltaY })
    }
    if (this._deps.camera.snapshot.peek().revision === beforeRevision) return
    this._deps.render('viewport')
    this._refreshViewportDependentMeasurements()
  }

  contextMenu(event: MouseEvent): void {
    if (this._retryPendingTransientCancellation(event)) return
    if (allowsNativeContextMenuTarget(event.target)) return
    event.preventDefault()
    if (this._overviewMode) return
    // The Menu key already opened the menu from keydown; its trailing event has no pointer.
    const keyboardMenuAt = this._hooks.lastKeyboardMenuAt()
    if (keyboardMenuAt !== null && event.timeStamp - keyboardMenuAt < KEYBOARD_CONTEXT_MENU_ECHO_MS) return
    this._runAdmittedSceneEvent(event, () => {
      this._showContextMenuWhenSettled(event)
    }, { resumePending: true })
  }

  private _showContextMenuWhenSettled(event: MouseEvent): void {
    if (this._hasActiveSceneEdit()) {
      event.stopImmediatePropagation()
      return
    }
    if (this._annotationEditor.hasActiveEditor()) this._annotationEditor.commit()
    const screen = this._screenPoint(event)
    const world = this._deps.camera.screenToWorld(screen)
    this._contextMenu.openAtPointer(screen, this._retargetContextMenuSelection(world))
  }

  dragOver(event: DragEvent): void {
    if (this._retryPendingTransientCancellation(event)) return
    event.preventDefault()
    if (this._overviewMode) {
      this._rejectDragOver(event)
      return
    }
    let admitted: boolean
    try {
      admitted = this._deps.settledReader.readWhenSettled(() => {
        this._dragOverWhenSettled(event)
        return true
      }, false)
    } catch (error) {
      this._rejectDragOver(event)
      throw error
    }
    if (admitted) return
    this._rejectDragOver(event)
  }

  private _rejectDragOver(event: DragEvent): void {
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    hideInteractionPreview(this._preview)
    clearSavedObjectStampGhosts(this._preview)
    this._quarantineUnsettledSceneEvent(event)
  }

  private _dragOverWhenSettled(event: DragEvent): void {
    if (hasSavedObjectStampDragData(event.dataTransfer)) {
      const source = readSavedObjectStampDragPreviewSource(event.dataTransfer)
      const canDropStamp = source !== null
        && previewSavedObjectStampAt(this._savedObjectStampPlacementContext(), source, this._dragEventWorld(event))
      if (event.dataTransfer) event.dataTransfer.dropEffect = canDropStamp ? 'copy' : 'none'
      if (!canDropStamp) clearSavedObjectStampGhosts(this._preview)
      return
    }

    const canDropPlant = hasPlantStampDragData(event.dataTransfer)
      && isSceneLayerOpenForCreation(this._deps.getSceneStore().persisted, 'plants')
    if (event.dataTransfer) event.dataTransfer.dropEffect = canDropPlant ? 'copy' : 'none'
    if (!canDropPlant) {
      hideInteractionPreview(this._preview)
      return
    }
    const screen = this._screenPoint(event)
    showInteractionPreview(this._preview, 'band', screen, {
      x: screen.x + 12,
      y: screen.y + 12,
    })
  }

  dragLeave(): void {
    hideInteractionPreview(this._preview)
    clearSavedObjectStampGhosts(this._preview)
  }

  drop(event: DragEvent): void {
    event.preventDefault()
    hideInteractionPreview(this._preview)
    clearSavedObjectStampGhosts(this._preview)
    if (this._retryPendingTransientCancellation(event)) return
    if (this._overviewMode) {
      this._quarantineUnsettledSceneEvent(event)
      return
    }
    this._runAdmittedSceneEvent(event, () => this._dropWhenSettled(event), {
      resumePending: true,
    })
  }

  private _dropWhenSettled(event: DragEvent): void {
    const savedObjectStampSource = readSavedObjectStampDropSource(event)
    if (savedObjectStampSource) {
      placeSavedObjectStampAt(
        this._savedObjectStampPlacementContext(),
        savedObjectStampSource,
        this._dragEventWorld(event),
        () => {
          clearSavedObjectStampDragSource()
          this._switchTool('select')
          this._activateInteractionHostAfterDrop()
        },
      )
      return
    }

    const source = readPlantStampDropSource(event)
    if (!source) return
    if (!isSceneLayerOpenForCreation(this._deps.getSceneStore().persisted, 'plants')) return
    const world = this._applySnapping(this._deps.camera.screenToWorld(this._screenPoint(event)))
    let placedPlantId: string | null = null
    this._deps.sceneEdits.run('interaction-drop', (tx) => {
      tx.mutate((draft) => {
        placedPlantId = appendPlantStampSourceToDraft(draft, source, world)
      })
      if (placedPlantId) tx.setSelection([{ kind: 'plant', id: placedPlantId }])
    }, {
      onCommitted: () => {
        this._switchTool('select')
        this._activateInteractionHostAfterDrop()
      },
    })
  }

  private _savedObjectStampPlacementContext() {
    return {
      preview: this._preview,
      camera: this._deps.camera,
      getSceneStore: this._deps.getSceneStore,
      getPlantPresentationContext: this._deps.getPlantPresentationContext,
      sceneEdits: this._deps.sceneEdits,
      applySnapping: (point: ScenePoint) => this._applySnapping(point),
    }
  }

  private _dragEventWorld(event: DragEvent): ScenePoint {
    return this._deps.camera.screenToWorld(this._screenPoint(event))
  }

  private _screenPoint(
    event: Pick<MouseEvent, 'clientX' | 'clientY'>,
    rect = this._currentContainerRect(),
  ): ScenePoint {
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  /**
   * The selection a right-click acts on: the object under the pointer (selected
   * first when it was not), a disabled selection for a locked or hidden hit, or
   * `null` for the empty map.
   */
  private _retargetContextMenuSelection(world: ScenePoint): CanvasDesignObjectSelectionModel | null {
    const scene = this._deps.getSceneStore().persisted
    const viewportScale = this._deps.camera.viewport.scale
    const speciesCache = this._deps.getSpeciesCache()
    const getPlantContext = this._deps.getPlantPresentationContext
    const visibleHit = hitTestVisibleTopLevel(
      scene,
      world,
      viewportScale,
      speciesCache,
      getPlantContext,
      this._deps.getSelection(),
      this._deps.getSceneStore().session.hoveredTarget,
    )
    if (visibleHit && isContextMenuTargetStructurallyBlocked(scene, visibleHit)) {
      return disabledContextMenuSelection()
    }
    const hit = hitTestTopLevel(
      scene,
      world,
      viewportScale,
      speciesCache,
      getPlantContext,
      this._deps.getSelection(),
      this._deps.getSceneStore().session.hoveredTarget,
    )
    if (!hit) return visibleHit ? disabledContextMenuSelection() : null
    if (isContextMenuTargetStructurallyBlocked(scene, hit)) return disabledContextMenuSelection()
    if (!includesSceneDesignObjectTarget(this._deps.getSelection(), hit)) {
      this._deps.setSelection([hit])
      this._deps.render('scene')
      this._refreshSelectionDependentMeasurements()
    }
    return this._deps.getDesignObjectSelection()
  }

  /** The ToolHost owns the series; ending it refreshes the selection-dependent chrome (the session's nudge wrapper). */
  private _endNudge(options?: { readonly abort?: boolean }): void {
    this._hooks.endNudgeSeries(options)
  }

  private _cancelTransientInteraction(options: SceneInteractionCancellationOptions = {}): void {
    this._endNudge()
    this._clearPointerGesture()
    if (options.releaseSpace) this._hooks.space.release()
    const activeAdapter = this._activeToolAdapter()
    try {
      runCanvasRuntimeCleanups([
        () => this._sharedGestures.cancel(),
        () => this._rotationHandle.cancelActiveDrag(),
        ...this._controlPointOverlays.map((overlay) => () => overlay.cancelActiveDrag()),
        () => activeAdapter?.cancelTransient?.(options),
        () => this._deps.setHoveredTarget(null),
        () => this._tooltip.hide(),
        () => this._lockedAffordance.hide(),
        () => {
          if (!this._idle()) this._deps.container.style.cursor = cursorForTool(this._tool)
        },
      ], 'Scene Interaction cancellation failed')
      this._transientCancellationPending = false
    } catch (error) {
      this._transientCancellationPending = this._hasActiveSceneEdit()
      throw error
    } finally {
      this._publishToolGuidance()
    }
  }

  private _runSpacingField(run: (field: CanvasPlantRowSpacingField) => void): void {
    if (this._disposed) return
    const field = this._activeToolAdapter()?.spacingField
    if (!field) return
    try {
      run(field)
    } finally {
      this._publishToolGuidance()
    }
  }

  private _publishToolGuidance(): void {
    const publish = this._deps.publishToolGuidance
    // A registered tool's guidance is the ToolHost's.
    if (!publish || this._disposed || !this._toolRegistry || this._idle()) return
    const adapter = this._activeToolAdapter()
    const described = adapter?.describeGuidance?.() ?? {}
    publish({
      gesture: described.gesture ?? adapter?.hasActiveSceneEdit?.() ?? false,
      stamp: described.stamp ?? null,
      stampRotationDeg: described.stampRotationDeg ?? null,
      promptSpecies: described.promptSpecies ?? false,
      plantRow: described.plantRow ?? null,
    })
  }

  private _refreshViewportDependentMeasurements(): void {
    this._annotationEditor.refresh()
    if (this._activeToolAdapter()?.refreshViewportDependent?.() === true) {
      for (const overlay of this._controlPointOverlays) {
        overlay.refresh(this._canShowSelectAffordances())
      }
      if (this._canShowSelectAffordances()) {
        this._rotationHandle.refresh()
      } else {
        this._rotationHandle.hide()
      }
      return
    }

    this._refreshSelectionDependentMeasurements()
  }

  private _refreshSelectionDependentMeasurements(): void {
    this._annotationEditor.refresh()
    this._forEachUniqueToolHook('refreshSelectionDependent', (refresh) => refresh())
    const canShowSelectAffordances = this._canShowSelectAffordances()
    for (const overlay of this._controlPointOverlays) overlay.refresh(canShowSelectAffordances)
    if (this._designObjectDragPresentationSuppressed || !canShowSelectAffordances) {
      this._rotationHandle.hide()
      return
    }
    this._rotationHandle.refresh()
  }

  private _canShowSelectAffordances(): boolean {
    return this._tool === 'select'
      && !this._idle()
      && !this._overviewMode
      && !this._transientCancellationPending
      && !this._hasActiveSceneEdit()
      && !this._annotationEditor.hasActiveEditor()
  }

  /** A registered tool is armed: the ToolHost runs it and the bridge holds nothing. */
  private _idle(): boolean {
    return this._hooks.isRegistered(this._tool)
  }

  private _beginDesignObjectDragPresentation(): void {
    this._designObjectDragPresentationSuppressed = true
    this._rotationHandle.hide()
    this._clearPassiveHoverPresentation()
  }

  private _endDesignObjectDragPresentation(): void {
    if (!this._designObjectDragPresentationSuppressed) return
    this._designObjectDragPresentationSuppressed = false
    this._refreshSelectionDependentMeasurements()
  }

  private _clearPassiveHoverPresentation(): void {
    this._deps.setHoveredTarget(null)
    this._tooltip.hide()
    this._lockedAffordance.hide()
    this._activeToolAdapter()?.clearHoverPreview?.()
  }

  /** Snap a world-space point to grid and/or guides. Used for placement (stamp, text). */
  private _applySnapping(point: ScenePoint): ScenePoint {
    let next = point

    if (this._deps.readSnapToGridEnabled()) {
      next = snapToGrid(next.x, next.y, gridInterval(this._deps.camera.viewport.scale).interval)
    }

    const guides = this._deps.getSceneStore().persisted.guides
    if (this._deps.readSnapToGuidesEnabled() && guides.length > 0) {
      next = snapToGuides(next.x, next.y, this._deps.camera.viewport.scale, guides)
    }

    return next
  }

  /** Place plants here: arms Place plants, then places at `world` (now, or after a species is chosen). */
  private _placePlantsAt(world: ScenePoint): void {
    if (this._disposed || this._overviewMode) return
    this._deps.commandAdmission.runWhenSettled(() => {
      this._switchTool('plant-stamp')
      this._toolRegistry.activeAdapter?.placeAt?.(world)
    }, undefined, { resumePending: true })
    this._publishToolGuidance()
  }

  private _switchTool(name: string): void {
    this._hooks.switchTool(name)
  }

  private _focusInteractionHost(): void {
    this._deps.container.focus({ preventScroll: true })
  }

  private _claimInteractionPointerDown(event: PointerEvent): void {
    if (event.cancelable) event.preventDefault()
    this._focusInteractionHost()
  }

  private _quarantineUnsettledSceneEvent(event: Event): void {
    if (event.cancelable) event.preventDefault()
    event.stopImmediatePropagation()
  }

  private _runAdmittedSceneEvent(
    event: Event,
    operation: () => void,
    options: { resumePending?: boolean } = {},
  ): boolean {
    try {
      const admitted = this._deps.commandAdmission.runWhenSettled(() => {
        operation()
        return true
      }, false, options)
      if (!admitted) this._quarantineUnsettledSceneEvent(event)
      return admitted
    } catch (error) {
      this._quarantineUnsettledSceneEvent(event)
      throw error
    }
  }

  private _activateInteractionHostAfterDrop(): void {
    this._focusInteractionHost()
    this._cancelPendingInteractionHostFocus()
    this._pendingInteractionHostFocusFrame = window.requestAnimationFrame(() => {
      this._pendingInteractionHostFocusFrame = null
      this._focusInteractionHost()
    })
  }

  private _cancelPendingInteractionHostFocus(): void {
    if (this._pendingInteractionHostFocusFrame === null) return
    window.cancelAnimationFrame(this._pendingInteractionHostFocusFrame)
    this._pendingInteractionHostFocusFrame = null
  }

  private _beginAnnotationTextEdit(annotationId: string): boolean {
    const started = this._annotationEditor.start(annotationId)
    if (started) this._refreshSelectionDependentMeasurements()
    return started
  }

  private _canEditAnnotation(annotationId: string): boolean {
    const viewportScale = this._deps.camera.viewport.scale
    const selection = getDesignObjectSelectionModel(
      this._deps.getSceneStore().persisted,
      [{ kind: 'annotation', id: annotationId }],
      {
        annotationViewportScale: viewportScale,
        plantContext: this._deps.getPlantPresentationContext(viewportScale),
      },
    )
    return selection.editableTargets.length === 1
      && selection.editableTargets[0]?.kind === 'annotation'
      && selection.editableTargets[0].id === annotationId
      && selection.lockedTargets.length === 0
      && selection.blockedTargets.length === 0
  }

  private _syncLockedObjectAffordance(
    hit: TopLevelTarget | null,
    screen: ScenePoint,
    scene: ScenePersistedState,
  ): void {
    if (!hit || isTargetLayerLocked(scene, hit)) {
      this._lockedAffordance.hide()
      return
    }
    if (!isDirectSceneDesignObjectLocked(scene, hit)) {
      this._lockedAffordance.hide()
      return
    }
    this._lockedAffordance.show({
      target: hit,
      screenX: screen.x,
      screenY: screen.y,
    })
  }

  private _unlockLockedObject(target: SceneDesignObjectTarget): void {
    this._deps.sceneEdits.run('unlock-design-object', (tx) => {
      tx.mutate((draft) => setSceneDesignObjectLocks(draft, [target], false))
    }, { onCommitted: () => this._lockedAffordance.hide() })
  }

  private _activeToolAdapter(): SceneToolAdapter | null {
    return this._toolRegistry.activeAdapter
  }

  private _isOwnedOverlayPointerTarget(target: EventTarget | null): boolean {
    return this._annotationEditor.contains(target)
      || this._rotationHandle.contains(target)
      || this._controlPointOverlays.some((overlay) => overlay.contains(target))
      || this._lockedAffordance.contains(target)
      || (this._activeToolAdapter()?.shouldIgnorePointerEvent?.(target) ?? false)
  }

  private _hasActiveSceneEdit(): boolean {
    return this._sharedGestures.editActive
      || this._rotationHandle.dragActive
      || this._controlPointOverlays.some((overlay) => overlay.dragActive)
      || (this._activeToolAdapter()?.hasActiveSceneEdit?.() ?? false)
  }

  private _forEachUniqueToolHook(
    hook: 'refreshSelectionDependent' | 'refreshTranslations' | 'dispose',
    visit: (callback: () => void) => void,
  ): void {
    const callbacks = new Set<() => void>()
    this._toolRegistry.forEachAdapter((adapter) => {
      const callback = adapter[hook]
      if (callback) callbacks.add(callback)
    })
    for (const callback of callbacks) visit(callback)
  }

  private _currentContainerRect(): DOMRect {
    return this._pointerGesture?.containerRect ?? this._deps.container.getBoundingClientRect()
  }

  private _clearPointerGesture(): void {
    const pointerGesture = this._pointerGesture
    this._pointerGesture = null
    this._toolPointerDrag = null
    // The source clears its ownership before it releases: a loss dispatched by the release is stale by design.
    if (pointerGesture) this._hooks.pointerCapture.release(pointerGesture.pointerId)
  }

  private _retryPendingTransientCancellation(event: Event): boolean {
    if (!this._transientCancellationPending) return false
    if (event.cancelable) event.preventDefault()
    event.stopImmediatePropagation()
    try {
      this._cancelTransientInteraction({ releaseSpace: true })
    } finally {
      this._refreshViewportDependentMeasurements()
    }
    return true
  }
}

function disposeSceneToolRegistry(registry: SceneToolRegistry): void {
  const disposers = new Set<() => void>()
  registry.forEachAdapter((adapter) => {
    if (adapter.dispose) disposers.add(adapter.dispose)
  })
  runCanvasRuntimeCleanups([...disposers], 'Scene tool registry disposal failed')
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

function isContextMenuTargetStructurallyBlocked(scene: ScenePersistedState, target: TopLevelTarget): boolean {
  if (isTargetLayerLocked(scene, target)) return true
  return isSceneDesignObjectLocked(scene, target)
    && !isDirectSceneDesignObjectLocked(scene, target)
}

function isTargetLayerLocked(scene: ScenePersistedState, target: TopLevelTarget): boolean {
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
