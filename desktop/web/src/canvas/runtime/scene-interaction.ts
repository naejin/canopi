import { getCanvasTool } from '../session-state'
import { gridInterval, snapToGrid } from '../grid'
import { snapToGuides } from '../guides'
import type {
  ScenePoint,
  SceneStateReader,
} from './scene'
import { resolveSceneObjectGroupMembers, sceneObjectGroupMemberLayerName } from './scene'
import type { CameraController } from './camera'
import type { PlantPresentationContext } from './plant-presentation'
import type { SpeciesCacheEntry } from './species-cache'
import { hitTestTopLevel, hitTestVisibleTopLevel, type TopLevelTarget } from './interaction/hit-testing'
import { createHoverTooltip, type HoverTooltipController } from './interaction/hover-tooltip'
import {
  createInteractionPreview,
  hideInteractionPreview,
  showInteractionPreview,
} from './interaction/overlay-ui'
import { allowsNativeContextMenuTarget, cursorForTool, isEditableTarget } from './interaction/pointer-utils'
import {
  appendPlantStampSourceToDraft,
} from './interaction/tool-actions'
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
import { getDesignObjectSelectionModel } from './scene-runtime/selection'
import type {
  SceneCommandAdmission,
  SceneEditCoordinator,
  SettledSceneReader,
} from './scene-runtime/transactions'
import {
  createSelectionActionToolbar,
  type SelectionActionToolbarController,
} from './interaction/selection-action-toolbar'
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
  type ZoneControlPointController,
} from './interaction/zone-control-points'
import {
  createMeasurementGuideControlPoints,
  type MeasurementGuideControlPointController,
} from './interaction/measurement-guide-control-points'
import type { CanvasDesignObjectSelectionModel, CanvasSceneEditCommandSurface } from './runtime'
import {
  createLockedObjectAffordance,
  type LockedObjectAffordanceController,
} from './interaction/locked-object-affordance'
import {
  getLockedSceneDesignObjectIds,
  isDirectSceneDesignObjectLocked,
  isSceneDesignObjectLocked,
  setSceneDesignObjectLocks,
} from './scene/locks'
import type { ScenePersistedState } from './scene'
import {
  runCanvasRuntimeCleanups,
  throwCanvasRuntimeCleanupErrors,
} from './cleanup'

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

export interface SceneInteractionSessionDeps {
  container: HTMLElement
  getSceneStore: () => SceneStateReader
  camera: CameraController
  getSpeciesCache: () => ReadonlyMap<string, SpeciesCacheEntry>
  getPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  getSelection: () => ReadonlySet<string>
  setSelection: (ids: Iterable<string>) => void
  clearSelection: () => void
  sceneEdits: SceneEditCoordinator
  commandAdmission: SceneCommandAdmission
  settledReader: SettledSceneReader
  getDesignObjectSelection: () => CanvasDesignObjectSelectionModel
  selectionCommands: Pick<
    CanvasSceneEditCommandSurface,
    | 'copy'
    | 'pasteAt'
    | 'canPaste'
    | 'duplicateSelected'
    | 'toggleSelectedPlantNamePins'
    | 'deleteSelected'
    | 'bringToFront'
    | 'sendToBack'
    | 'selectSameSpecies'
    | 'lockSelected'
    | 'unlockSelected'
    | 'groupSelected'
    | 'ungroupSelected'
  >
  contextualCommands?: {
    readonly saveSelectionAsObjectStamp?: () => void
  }
  setTool: (name: string) => void
  render: (kind: 'scene' | 'viewport') => void
  readSnapToGridEnabled: () => boolean
  readSnapToGuidesEnabled: () => boolean
  readPlantSpacingIntervalMeters: () => number
  commitPlantSpacingIntervalMeters: (meters: number) => void
  setHoveredEntityId: (id: string | null) => void
  getLocalizedCommonNames: () => ReadonlyMap<string, string | null>
  notifyTransientHistoryChange?: () => void
}

export interface SceneInteractionSession {
  setTool(name: string): void
  prepareForDocumentReplacement(): void
  refreshMeasurements(): void
  canUndoTransientHistory(): boolean
  canRedoTransientHistory(): boolean
  undoTransientHistory(): boolean
  redoTransientHistory(): boolean
  dispose(): void
}

export function createSceneInteractionSession(
  deps: SceneInteractionSessionDeps,
): SceneInteractionSession {
  return new DefaultSceneInteractionSession(deps)
}

class DefaultSceneInteractionSession implements SceneInteractionSession {
  private readonly _preview: HTMLDivElement
  private readonly _tooltip: HoverTooltipController
  private readonly _toolRegistry: SceneToolRegistry
  private readonly _sharedGestures: SceneInteractionSharedGestures
  private readonly _annotationEditor: AnnotationInlineEditorController
  private readonly _selectionToolbar: SelectionActionToolbarController
  private readonly _contextMenu: CanvasContextMenuController
  private readonly _rotationHandle: SelectionRotationHandleController
  private readonly _zoneControlPoints: ZoneControlPointController
  private readonly _measurementGuideControlPoints: MeasurementGuideControlPointController
  private readonly _lockedAffordance: LockedObjectAffordanceController
  private _tool: InteractionTool = 'select'
  private _pointerGesture: SceneInteractionPointerGesture | null = null
  private _toolPointerDrag: SceneToolPointerDrag | null = null
  private _spaceHeld = false
  private _attached = false
  private _disposed = false
  private _transientCancellationPending = false
  private _designObjectDragPresentationSuppressed = false
  private _pendingInteractionHostFocusFrame: number | null = null

  constructor(private readonly _deps: SceneInteractionSessionDeps) {
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
        readPlantSpacingIntervalMeters: this._deps.readPlantSpacingIntervalMeters,
        commitPlantSpacingIntervalMeters: this._deps.commitPlantSpacingIntervalMeters,
        switchTool: (name) => this._switchTool(name),
        applySnapping: (point) => this._applySnapping(point),
        getContainerRect: () => this._currentContainerRect(),
        notifyTransientHistoryChange: () => this._deps.notifyTransientHistoryChange?.(),
      }), disposeSceneToolRegistry)
      this._annotationEditor = own(createAnnotationInlineEditor({
        container: this._deps.container,
        camera: this._deps.camera,
        getSceneStore: this._deps.getSceneStore,
        sceneEdits: this._deps.sceneEdits,
        canEditAnnotation: (annotationId) => this._canEditAnnotation(annotationId),
        refreshSelectionDependent: () => this._refreshSelectionDependentMeasurements(),
      }), (editor) => editor.dispose())
      this._sharedGestures = own(createSceneInteractionSharedGestures({
        container: this._deps.container,
        preview: this._preview,
        camera: this._deps.camera,
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
      this._selectionToolbar = own(createSelectionActionToolbar({
        container: this._deps.container,
        camera: this._deps.camera,
        getSelection: this._deps.getDesignObjectSelection,
        commands: this._deps.selectionCommands,
        saveSelectionAsObjectStamp: this._deps.contextualCommands?.saveSelectionAsObjectStamp,
      }), (toolbar) => toolbar.dispose())
      this._contextMenu = own(createCanvasContextMenu({
        container: this._deps.container,
        commands: this._deps.selectionCommands,
        getSelection: this._deps.getDesignObjectSelection,
        saveSelectionAsObjectStamp: this._deps.contextualCommands?.saveSelectionAsObjectStamp,
      }), (menu) => menu.dispose())
      this._rotationHandle = own(createSelectionRotationHandle({
        container: this._deps.container,
        camera: this._deps.camera,
        getSceneStore: this._deps.getSceneStore,
        getSelection: this._deps.getDesignObjectSelection,
        sceneEdits: this._deps.sceneEdits,
        render: this._deps.render,
        refreshSelectionDependent: () => this._refreshSelectionDependentMeasurements(),
      }), (handle) => handle.dispose())
      this._zoneControlPoints = own(createZoneControlPoints({
        container: this._deps.container,
        camera: this._deps.camera,
        getSceneStore: this._deps.getSceneStore,
        getSelection: this._deps.getDesignObjectSelection,
        sceneEdits: this._deps.sceneEdits,
        applySnapping: (point) => this._applySnapping(point),
        render: this._deps.render,
        refreshSelectionDependent: () => this._refreshSelectionDependentMeasurements(),
        beginDragPresentation: () => this._beginDesignObjectDragPresentation(),
        endDragPresentation: () => this._endDesignObjectDragPresentation(),
      }), (controlPoints) => controlPoints.dispose())
      this._measurementGuideControlPoints = own(createMeasurementGuideControlPoints({
        container: this._deps.container,
        camera: this._deps.camera,
        getSceneStore: this._deps.getSceneStore,
        getSelection: this._deps.getDesignObjectSelection,
        sceneEdits: this._deps.sceneEdits,
        applySnapping: (point) => this._applySnapping(point),
        render: this._deps.render,
        refreshSelectionDependent: () => this._refreshSelectionDependentMeasurements(),
        beginDragPresentation: () => this._beginDesignObjectDragPresentation(),
        endDragPresentation: () => this._endDesignObjectDragPresentation(),
      }), (controlPoints) => controlPoints.dispose())
      this._lockedAffordance = own(createLockedObjectAffordance({
        container: this._deps.container,
        onUnlock: (id) => this._unlockLockedObject(id),
      }), (affordance) => affordance.dispose())
      this.setTool(getCanvasTool())
      this._attach()
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
      nextAdapter = this._toolRegistry.select(name)
      if (changingTool) {
        nextActivationAttempted = true
        nextAdapter?.onActivate?.()
      }
      this._deps.container.style.cursor = cursorForTool(name)
      this._refreshSelectionDependentMeasurements()
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
      this._toolRegistry.select(previousTool)
      this._deps.container.style.cursor = previousCursor
      if (previousDeactivationAttempted) attempt(() => previousAdapter?.onActivate?.())
      attempt(() => this._refreshSelectionDependentMeasurements())
      throwCanvasRuntimeCleanupErrors(errors, 'Scene Interaction tool transition failed')
    }
  }

  prepareForDocumentReplacement(): void {
    if (this._disposed) return
    this._designObjectDragPresentationSuppressed = false
    runCanvasRuntimeCleanups([
      () => this._cancelPendingInteractionHostFocus(),
      () => this._annotationEditor.cancel(),
      () => this._cancelTransientInteraction({ releaseSpace: true }),
      () => this._contextMenu.hide(),
      () => hideInteractionPreview(this._preview),
      () => clearSavedObjectStampGhosts(this._preview),
      () => this._selectionToolbar.hide(),
      () => this._rotationHandle.hide(),
      () => this._zoneControlPoints.hide(),
      () => this._measurementGuideControlPoints.hide(),
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

    attempt(() => this._detach())
    attempt(() => this._cancelPendingInteractionHostFocus())
    attempt(() => this._cancelTransientInteraction())
    attempt(() => this._activeToolAdapter()?.onDeactivate?.())
    attempt(() => this._selectionToolbar.dispose())
    attempt(() => this._contextMenu.dispose())
    attempt(() => this._rotationHandle.dispose())
    attempt(() => this._zoneControlPoints.dispose())
    attempt(() => this._measurementGuideControlPoints.dispose())
    attempt(() => this._lockedAffordance.dispose())
    attempt(() => this._annotationEditor.dispose())
    attempt(() => this._sharedGestures.dispose())
    attempt(() => this._forEachUniqueToolHook('dispose', (dispose) => attempt(dispose)))
    attempt(() => this._preview.remove())
    attempt(() => this._tooltip.dispose())
    attempt(() => this._deps.setHoveredEntityId(null))

    throwCanvasRuntimeCleanupErrors(errors, 'Scene Interaction Session disposal failed')
  }

  refreshMeasurements(): void {
    if (this._disposed) return
    this._refreshViewportDependentMeasurements()
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

  private readonly _onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) return
    if (this._pointerGesture && this._pointerGesture.pointerId !== event.pointerId) return
    if (this._retryPendingTransientCancellation(event)) return
    if (this._contextMenu.contains(event.target)) return
    this._contextMenu.hide()
    if (this._annotationEditor.contains(event.target)) return
    if (this._selectionToolbar.contains(event.target)) return
    if (this._lockedAffordance.contains(event.target)) return

    this._runAdmittedSceneEvent(event, () => {
      this._pointerDownWhenSettled(event)
    }, { resumePending: true })
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

    if (event.button === 0 && this._rotationHandle.contains(event.target)) {
      const rotationDrag = this._rotationHandle.pointerDown({ event, rawWorld: world })
      if (rotationDrag) this._toolPointerDrag = rotationDrag
      else this._clearPointerGesture()
      return
    }

    if (event.button === 0 && this._zoneControlPoints.contains(event.target)) {
      const zoneControlPointDrag = this._zoneControlPoints.pointerDown({ event, rawWorld: world })
      if (zoneControlPointDrag) this._toolPointerDrag = zoneControlPointDrag
      else this._clearPointerGesture()
      return
    }

    if (event.button === 0 && this._measurementGuideControlPoints.contains(event.target)) {
      const guideControlPointDrag = this._measurementGuideControlPoints.pointerDown({ event, rawWorld: world })
      if (guideControlPointDrag) this._toolPointerDrag = guideControlPointDrag
      else this._clearPointerGesture()
      return
    }

    if (this._sharedGestures.beginPan({
      event,
      screen,
      world,
      tool: this._tool,
      spaceHeld: this._spaceHeld,
    })) return

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
      spaceHeld: this._spaceHeld,
    })
  }

  private readonly _onPointerLeave = (): void => {
    this._clearPassiveHoverPresentation()
  }

  private _updateHover(event: PointerEvent): void {
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
    )
    if (hit) {
      this._deps.setHoveredEntityId(hit.id)
    }
    this._syncLockedObjectAffordance(hit, screen, this._deps.getSceneStore().persisted)

    if (hit?.kind === 'plant') {
      const plant = this._deps.getSceneStore().persisted.plants.find((p) => p.id === hit.id)
      if (plant) {
        const commonName = this._deps.getLocalizedCommonNames().get(plant.canonicalName) ?? plant.commonName
        this._tooltip.show(screen.x, screen.y, commonName, plant.canonicalName)
      }
    } else {
      if (!hit) this._deps.setHoveredEntityId(null)
      this._tooltip.hide()
    }
  }

  private readonly _onPointerMove = (event: PointerEvent): void => {
    if (!this._pointerGesture) {
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

  private readonly _onPointerUp = (event: PointerEvent): void => {
    if (this._retryPendingTransientCancellation(event)) return
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

  private readonly _onPointerCancel = (event: PointerEvent): void => {
    if (this._retryPendingTransientCancellation(event)) return
    if (!this._pointerGesture || this._pointerGesture.pointerId !== event.pointerId) return
    this._cancelInterruptedInteraction()
  }

  private readonly _onWindowBlur = (): void => {
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

  private readonly _onWheel = (event: WheelEvent): void => {
    if (this._retryPendingTransientCancellation(event)) return
    event.preventDefault()
    const screen = this._screenPoint(event)
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
    this._deps.camera.zoomAroundScreenPoint(screen, factor)
    this._deps.render('viewport')
    this._refreshViewportDependentMeasurements()
  }

  private readonly _onContextMenu = (event: MouseEvent): void => {
    if (this._retryPendingTransientCancellation(event)) return
    if (allowsNativeContextMenuTarget(event.target)) return
    event.preventDefault()
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
    const selection = this._retargetContextMenuSelection(world)
    this._contextMenu.show(selection ? { screen, world, selection } : { screen, world })
  }

  private readonly _onDragOver = (event: DragEvent): void => {
    if (this._retryPendingTransientCancellation(event)) return
    event.preventDefault()
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

  private readonly _onDragLeave = (): void => {
    hideInteractionPreview(this._preview)
    clearSavedObjectStampGhosts(this._preview)
  }

  private readonly _onDrop = (event: DragEvent): void => {
    event.preventDefault()
    hideInteractionPreview(this._preview)
    clearSavedObjectStampGhosts(this._preview)
    if (this._retryPendingTransientCancellation(event)) return
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
      if (placedPlantId) tx.setSelection([placedPlantId])
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
    )
    if (!hit) return visibleHit ? disabledContextMenuSelection() : null
    if (isContextMenuTargetStructurallyBlocked(scene, hit)) return disabledContextMenuSelection()
    if (this._deps.getSelection().has(hit.id)) return null
    this._deps.setSelection(new Set([hit.id]))
    this._deps.render('scene')
    this._refreshSelectionDependentMeasurements()
    return null
  }

  private readonly _onKeyDown = (event: KeyboardEvent): void => {
    if (this._retryPendingTransientCancellation(event)) return
    if (
      !this._pointerGesture
      && isKeyboardInteractiveEventTarget(event.target)
    ) return
    if (this._activeToolAdapter()?.keyDown?.(event) ?? false) return
    if (event.key === 'Escape' && this._pointerGesture) {
      event.preventDefault()
      this._cancelInterruptedInteraction()
      return
    }

    if (this._beginSelectedAnnotationTextEditFromKeyboard(event)) return

    if (
      event.code !== 'Space'
      || this._spaceHeld
      || isEditableTarget(event.target)
      || (this._activeToolAdapter()?.shouldSuppressSharedKeyboard?.(event) ?? false)
    ) return
    event.preventDefault()
    this._spaceHeld = true
    if (!this._toolPointerDrag && this._tool !== 'hand') {
      this._deps.container.style.cursor = 'grab'
    }
  }

  private readonly _onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Space') return
    this._spaceHeld = false
    if (!this._sharedGestures.panning) {
      this._deps.container.style.cursor = cursorForTool(this._tool)
    }
  }

  private _cancelTransientInteraction(options: SceneInteractionCancellationOptions = {}): void {
    this._clearPointerGesture()
    if (options.releaseSpace) this._spaceHeld = false
    const activeAdapter = this._activeToolAdapter()
    try {
      runCanvasRuntimeCleanups([
        () => this._sharedGestures.cancel(),
        () => this._rotationHandle.cancelActiveDrag(),
        () => this._zoneControlPoints.cancelActiveDrag(),
        () => this._measurementGuideControlPoints.cancelActiveDrag(),
        () => activeAdapter?.cancelTransient?.(options),
        () => this._deps.setHoveredEntityId(null),
        () => this._tooltip.hide(),
        () => this._lockedAffordance.hide(),
        () => {
          this._deps.container.style.cursor = cursorForTool(this._tool)
        },
      ], 'Scene Interaction cancellation failed')
      this._transientCancellationPending = false
    } catch (error) {
      this._transientCancellationPending = this._hasActiveSceneEdit()
      throw error
    }
  }

  private _refreshViewportDependentMeasurements(): void {
    this._annotationEditor.refresh()
    if (this._activeToolAdapter()?.refreshViewportDependent?.() === true) {
      this._zoneControlPoints.refresh(this._canShowSelectAffordances())
      this._measurementGuideControlPoints.refresh(this._canShowSelectAffordances())
      if (this._canShowSelectAffordances()) {
        this._rotationHandle.refresh()
        this._selectionToolbar.refresh()
      } else {
        this._rotationHandle.hide()
        this._selectionToolbar.hide()
      }
      return
    }

    this._refreshSelectionDependentMeasurements()
  }

  private _refreshSelectionDependentMeasurements(): void {
    this._annotationEditor.refresh()
    this._forEachUniqueToolHook('refreshSelectionDependent', (refresh) => refresh())
    const canShowSelectAffordances = this._canShowSelectAffordances()
    this._zoneControlPoints.refresh(canShowSelectAffordances)
    this._measurementGuideControlPoints.refresh(canShowSelectAffordances)
    if (this._designObjectDragPresentationSuppressed || !canShowSelectAffordances) {
      this._rotationHandle.hide()
      this._selectionToolbar.hide()
      return
    }
    this._rotationHandle.refresh()
    this._selectionToolbar.refresh()
  }

  private _canShowSelectAffordances(): boolean {
    return this._tool === 'select'
      && !this._transientCancellationPending
      && !this._hasActiveSceneEdit()
      && !this._annotationEditor.hasActiveEditor()
  }

  private _beginDesignObjectDragPresentation(): void {
    this._designObjectDragPresentationSuppressed = true
    this._rotationHandle.hide()
    this._selectionToolbar.hide()
    this._clearPassiveHoverPresentation()
  }

  private _endDesignObjectDragPresentation(): void {
    if (!this._designObjectDragPresentationSuppressed) return
    this._designObjectDragPresentationSuppressed = false
    this._refreshSelectionDependentMeasurements()
  }

  private _clearPassiveHoverPresentation(): void {
    this._deps.setHoveredEntityId(null)
    this._tooltip.hide()
    this._lockedAffordance.hide()
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

  private _switchTool(name: string): void {
    this._deps.setTool(name)
    if (this._tool !== name) this.setTool(name)
  }

  private _focusInteractionHost(): void {
    if (!this._deps.container.hasAttribute('tabindex')) {
      this._deps.container.tabIndex = -1
    }
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

  private _beginSelectedAnnotationTextEditFromKeyboard(event: KeyboardEvent): boolean {
    if (this._tool !== 'select') return false
    if (event.key !== 'Enter' && event.key !== 'F2') return false
    if (!isCanvasKeyboardShortcutTarget(event.target, this._deps.container)) return false
    if (isEditableTarget(event.target)) return false
    if (this._activeToolAdapter()?.shouldSuppressSharedKeyboard?.(event) ?? false) return false

    const selection = this._deps.getDesignObjectSelection()
    if (
      selection.editableTargets.length !== 1
      || (selection.lockedTargets?.length ?? 0) > 0
      || (selection.blockedTargets?.length ?? 0) > 0
    ) return false

    const target = selection.editableTargets[0]
    if (target?.kind !== 'annotation') return false
    if (!this._beginAnnotationTextEdit(target.id)) return false

    event.preventDefault()
    event.stopPropagation()
    return true
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
      new Set([annotationId]),
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
    if (!getLockedSceneDesignObjectIds(scene).has(hit.id)) {
      this._lockedAffordance.hide()
      return
    }
    this._lockedAffordance.show({
      id: hit.id,
      screenX: screen.x,
      screenY: screen.y,
    })
  }

  private _unlockLockedObject(id: string): void {
    this._deps.sceneEdits.run('unlock-design-object', (tx) => {
      tx.mutate((draft) => setSceneDesignObjectLocks(draft, [id], false))
    }, { onCommitted: () => this._lockedAffordance.hide() })
  }

  private _activeToolAdapter(): SceneToolAdapter | null {
    return this._toolRegistry.activeAdapter
  }

  private _isOwnedOverlayPointerTarget(target: EventTarget | null): boolean {
    return this._annotationEditor.contains(target)
      || this._selectionToolbar.contains(target)
      || this._contextMenu.contains(target)
      || this._rotationHandle.contains(target)
      || this._zoneControlPoints.contains(target)
      || this._measurementGuideControlPoints.contains(target)
      || this._lockedAffordance.contains(target)
      || (this._activeToolAdapter()?.shouldIgnorePointerEvent?.(target) ?? false)
  }

  private _hasActiveSceneEdit(): boolean {
    return this._sharedGestures.editActive
      || this._rotationHandle.dragActive
      || this._zoneControlPoints.dragActive
      || this._measurementGuideControlPoints.dragActive
      || (this._activeToolAdapter()?.hasActiveSceneEdit?.() ?? false)
  }

  private _forEachUniqueToolHook(
    hook: 'refreshSelectionDependent' | 'dispose',
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
    this._pointerGesture = null
    this._toolPointerDrag = null
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

  private _attach(): void {
    if (this._attached || this._disposed) return
    const container = this._deps.container
    try {
      container.addEventListener('pointerdown', this._onPointerDown, { capture: true })
      container.addEventListener('pointerleave', this._onPointerLeave)
      window.addEventListener('pointermove', this._onPointerMove, { capture: true })
      window.addEventListener('pointerup', this._onPointerUp, { capture: true })
      window.addEventListener('pointercancel', this._onPointerCancel, { capture: true })
      window.addEventListener('keydown', this._onKeyDown, { capture: true })
      window.addEventListener('keyup', this._onKeyUp)
      window.addEventListener('blur', this._onWindowBlur)
      container.addEventListener('contextmenu', this._onContextMenu)
      container.addEventListener('wheel', this._onWheel, { passive: false })
      container.addEventListener('dragover', this._onDragOver)
      container.addEventListener('dragleave', this._onDragLeave)
      container.addEventListener('drop', this._onDrop)
      this._attached = true
    } catch (error) {
      this._attached = true
      try {
        this._detach()
      } catch {
        // Preserve the listener-installation failure after attempting every removal.
      }
      throw error
    }
  }

  private _detach(): void {
    if (!this._attached) return
    this._attached = false
    const container = this._deps.container
    runCanvasRuntimeCleanups([
      () => container.removeEventListener('pointerdown', this._onPointerDown, { capture: true }),
      () => container.removeEventListener('pointerleave', this._onPointerLeave),
      () => window.removeEventListener('pointermove', this._onPointerMove, { capture: true }),
      () => window.removeEventListener('pointerup', this._onPointerUp, { capture: true }),
      () => window.removeEventListener('pointercancel', this._onPointerCancel, { capture: true }),
      () => window.removeEventListener('keydown', this._onKeyDown, { capture: true }),
      () => window.removeEventListener('keyup', this._onKeyUp),
      () => window.removeEventListener('blur', this._onWindowBlur),
      () => container.removeEventListener('contextmenu', this._onContextMenu),
      () => container.removeEventListener('wheel', this._onWheel),
      () => container.removeEventListener('dragover', this._onDragOver),
      () => container.removeEventListener('dragleave', this._onDragLeave),
      () => container.removeEventListener('drop', this._onDrop),
    ], 'Scene Interaction listener removal failed')
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
  return isSceneDesignObjectLocked(scene, target.id)
    && !isDirectSceneDesignObjectLocked(scene, target.id)
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

function isCanvasKeyboardShortcutTarget(target: EventTarget | null, container: HTMLElement): boolean {
  if (target === window) return true
  if (!(target instanceof Node)) return false
  if (!container.contains(target)) return false
  const element = target instanceof HTMLElement ? target : target.parentElement
  if (!element) return false
  if (isKeyboardInteractiveElement(element)) return false
  return true
}

function isKeyboardInteractiveEventTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement
    ? target
    : target instanceof Node
      ? target.parentElement
      : null
  return element ? isKeyboardInteractiveElement(element) : false
}

function isKeyboardInteractiveElement(element: HTMLElement): boolean {
  return element.closest([
    'button',
    'a[href]',
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[role="button"]',
    '[role="menu"]',
    '[role="dialog"]',
    'dialog',
  ].join(',')) !== null
}
