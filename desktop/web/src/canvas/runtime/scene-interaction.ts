import { getCanvasTool } from '../session-state'
import { gridInterval, snapToGrid } from '../grid'
import { snapToGuides } from '../guides'
import type {
  SceneStore,
  ScenePoint,
} from './scene'
import { resolveSceneObjectGroupMembers, sceneObjectGroupMemberLayerName } from './scene'
import type { CameraController } from './camera'
import type { PlantPresentationContext } from './plant-presentation'
import type { SpeciesCacheEntry } from './species-cache'
import type { SceneViewportState } from './scene'
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
  createSceneToolModules,
  type SceneToolModules,
} from './interaction/tool-modules'
import {
  createSceneInteractionFrame,
  type SceneInteractionFrame,
  type SceneInteractionTransientCleanupOptions,
} from './interaction/frame'
import {
  createSceneInteractionSharedGestures,
  type SceneInteractionSharedGestures,
} from './interaction/shared-gestures'
import {
  createAnnotationInlineEditor,
  type AnnotationInlineEditorController,
} from './interaction/annotation-inline-editor'
import { getDesignObjectSelectionModel } from './scene-runtime/selection'
import type { SceneEditCoordinator } from './scene-runtime/transactions'
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

type InteractionTool = 'select' | 'hand' | 'rectangle' | 'text' | 'plant-stamp' | 'object-stamp' | 'plant-spacing' | string

export interface SceneInteractionDeps {
  container: HTMLElement
  getSceneStore: () => SceneStore
  camera: CameraController
  setViewport: (viewport: SceneViewportState) => void
  getSpeciesCache: () => ReadonlyMap<string, SpeciesCacheEntry>
  getPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  getSelection: () => ReadonlySet<string>
  setSelection: (ids: Iterable<string>) => void
  clearSelection: () => void
  sceneEdits: SceneEditCoordinator
  getDesignObjectSelection: () => CanvasDesignObjectSelectionModel
  selectionCommands: Pick<
    CanvasSceneEditCommandSurface,
    | 'copy'
    | 'pasteAt'
    | 'canPaste'
    | 'duplicateSelected'
    | 'deleteSelected'
    | 'bringToFront'
    | 'sendToBack'
    | 'selectSameSpecies'
    | 'lockSelected'
    | 'unlockSelected'
    | 'groupSelected'
    | 'ungroupSelected'
  >
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

export class SceneInteractionController {
  private readonly _preview: HTMLDivElement
  private readonly _tooltip: HoverTooltipController
  private readonly _tools: SceneToolModules
  private readonly _frame: SceneInteractionFrame
  private readonly _sharedGestures: SceneInteractionSharedGestures
  private readonly _annotationEditor: AnnotationInlineEditorController
  private readonly _selectionToolbar: SelectionActionToolbarController
  private readonly _contextMenu: CanvasContextMenuController
  private readonly _rotationHandle: SelectionRotationHandleController
  private readonly _zoneControlPoints: ZoneControlPointController
  private readonly _lockedAffordance: LockedObjectAffordanceController
  private _tool: InteractionTool = 'select'
  private _designObjectDragPresentationSuppressed = false

  constructor(private readonly _deps: SceneInteractionDeps) {
    this._preview = createInteractionPreview(this._deps.container)
    this._tooltip = createHoverTooltip(this._deps.container)
    this._tools = createSceneToolModules({
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
      getContainerRect: () => this._frame.currentContainerRect(),
      notifyTransientHistoryChange: () => this._deps.notifyTransientHistoryChange?.(),
    })
    this._annotationEditor = createAnnotationInlineEditor({
      container: this._deps.container,
      camera: this._deps.camera,
      getSceneStore: this._deps.getSceneStore,
      sceneEdits: this._deps.sceneEdits,
      canEditAnnotation: (annotationId) => this._canEditAnnotation(annotationId),
      refreshSelectionDependent: () => this._refreshSelectionDependentMeasurements(),
    })
    this._sharedGestures = createSceneInteractionSharedGestures({
      container: this._deps.container,
      preview: this._preview,
      camera: this._deps.camera,
      getSceneStore: this._deps.getSceneStore,
      getSelection: this._deps.getSelection,
      getDesignObjectSelection: this._deps.getDesignObjectSelection,
      setSelection: this._deps.setSelection,
      clearSelection: this._deps.clearSelection,
      sceneEdits: this._deps.sceneEdits,
      setViewport: this._deps.setViewport,
      render: this._deps.render,
      getSpeciesCache: this._deps.getSpeciesCache,
      getPlantPresentationContext: this._deps.getPlantPresentationContext,
      applySnapping: (point) => this._applySnapping(point),
      refreshViewportDependent: () => this._refreshViewportDependentMeasurements(),
      refreshSelectionDependent: () => this._refreshSelectionDependentMeasurements(),
      beginDesignObjectDragPresentation: () => this._beginDesignObjectDragPresentation(),
      endDesignObjectDragPresentation: () => this._endDesignObjectDragPresentation(),
      beginAnnotationTextEdit: (annotationId) => this._beginAnnotationTextEdit(annotationId),
    })
    this._selectionToolbar = createSelectionActionToolbar({
      container: this._deps.container,
      camera: this._deps.camera,
      getSelection: this._deps.getDesignObjectSelection,
      commands: this._deps.selectionCommands,
    })
    this._contextMenu = createCanvasContextMenu({
      container: this._deps.container,
      commands: this._deps.selectionCommands,
      getSelection: this._deps.getDesignObjectSelection,
    })
    this._rotationHandle = createSelectionRotationHandle({
      container: this._deps.container,
      camera: this._deps.camera,
      getSceneStore: this._deps.getSceneStore,
      getSelection: this._deps.getDesignObjectSelection,
      sceneEdits: this._deps.sceneEdits,
      render: this._deps.render,
      refreshSelectionDependent: () => this._refreshSelectionDependentMeasurements(),
    })
    this._zoneControlPoints = createZoneControlPoints({
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
    })
    this._lockedAffordance = createLockedObjectAffordance({
      container: this._deps.container,
      onUnlock: (id) => this._unlockLockedObject(id),
    })
    this._frame = createSceneInteractionFrame({
      container: this._deps.container,
      handlers: {
        pointerDown: this._onPointerDown,
        pointerLeave: this._onPointerLeave,
        pointerMove: this._onPointerMove,
        pointerUp: this._onPointerUp,
        keyDown: this._onKeyDown,
        keyUp: this._onKeyUp,
        contextMenu: this._onContextMenu,
        wheel: this._onWheel,
        dragOver: this._onDragOver,
        dragLeave: this._onDragLeave,
        drop: this._onDrop,
      },
    })
    this.setTool(getCanvasTool())
    this._frame.attach()
  }

  setTool(name: string): void {
    if (this._tool !== name) this._annotationEditor.cancel()
    this._tool = name
    this._frame.transitionTool({
      toolName: name,
      transition: (toolName) => this._tools.transitionTo(toolName, () => this._cancelTransientInteraction()),
      updateCursor: (toolName) => {
        this._deps.container.style.cursor = cursorForTool(toolName)
      },
    })
    this._refreshSelectionDependentMeasurements()
  }

  dispose(): void {
    this._frame.dispose(() => {
      this._deps.setHoveredEntityId(null)
      this._selectionToolbar.dispose()
      this._contextMenu.dispose()
      this._rotationHandle.dispose()
      this._zoneControlPoints.dispose()
      this._lockedAffordance.dispose()
      this._annotationEditor.dispose()
      this._sharedGestures.dispose()
      this._tools.dispose()
      this._preview.remove()
      this._tooltip.dispose()
    })
  }

  refreshMeasurements(): void {
    this._refreshViewportDependentMeasurements()
  }

  canUndoTransientHistory(): boolean {
    return this._tools.canUndoTransientHistory()
  }

  canRedoTransientHistory(): boolean {
    return this._tools.canRedoTransientHistory()
  }

  undoTransientHistory(): boolean {
    return this._tools.undoTransientHistory()
  }

  redoTransientHistory(): boolean {
    return this._tools.redoTransientHistory()
  }

  private readonly _onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) return
    this._contextMenu.hide()
    if (this._annotationEditor.contains(event.target)) return
    if (this._annotationEditor.hasActiveEditor()) this._annotationEditor.commit()
    if (this._selectionToolbar.contains(event.target)) return
    if (this._contextMenu.contains(event.target)) return
    if (this._lockedAffordance.contains(event.target)) return
    if (this._tools.shouldIgnorePointerEvent(event.target)) return

    const containerRect = this._deps.container.getBoundingClientRect()
    const screen = this._screenPoint(event, containerRect)
    const world = this._deps.camera.screenToWorld(screen)
    this._frame.startPointerGesture({
      pointerId: event.pointerId,
      startScreen: screen,
      startWorld: world,
      containerRect,
    })

    if (event.button === 0 && this._rotationHandle.contains(event.target)) {
      const rotationDrag = this._rotationHandle.pointerDown({ event, rawWorld: world })
      if (rotationDrag) this._frame.beginToolPointerDrag(rotationDrag)
      else this._frame.clearPointerGesture()
      return
    }

    if (event.button === 0 && this._zoneControlPoints.contains(event.target)) {
      const zoneControlPointDrag = this._zoneControlPoints.pointerDown({ event, rawWorld: world })
      if (zoneControlPointDrag) this._frame.beginToolPointerDrag(zoneControlPointDrag)
      else this._frame.clearPointerGesture()
      return
    }

    if (this._sharedGestures.beginPan({
      event,
      screen,
      world,
      tool: this._tool,
      spaceHeld: this._frame.isSpaceHeld(),
    })) return

    if (this._tools.pointerDown({
      event,
      screen,
      rawWorld: world,
      beginDrag: (drag) => this._frame.beginToolPointerDrag(drag),
      clearPointerGesture: () => this._frame.clearPointerGesture(),
    })) {
      return
    }

    this._sharedGestures.beginSelectionGesture({
      event,
      screen,
      world,
      tool: this._tool,
      spaceHeld: this._frame.isSpaceHeld(),
    })
  }

  private readonly _onPointerLeave = (): void => {
    this._clearPassiveHoverPresentation()
  }

  private _updateHover(event: PointerEvent): void {
    if (this._tools.shouldSuppressHover()) {
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
    if (!this._frame.hasPointerGesture()) {
      if (this._selectionToolbar.contains(event.target)) return
      if (this._contextMenu.contains(event.target)) return
      if (this._zoneControlPoints.contains(event.target)) return
      if (this._lockedAffordance.contains(event.target)) return
      if (this._tools.shouldIgnorePointerEvent(event.target)) return

      const screen = this._screenPoint(event)
      const rawWorld = this._deps.camera.screenToWorld(screen)
      if (this._tools.pointerMoveWithoutCapture({ event, screen, rawWorld })) return
      this._updateHover(event)
      return
    }
    const pointerGesture = this._frame.pointerGestureFor(event)
    if (!pointerGesture) return

    const screen = this._screenPoint(event)
    const rawWorld = this._deps.camera.screenToWorld(screen)

    if (this._sharedGestures.active && this._sharedGestures.pointerMove({ screen, rawWorld })) return

    const toolDrag = this._frame.activeToolPointerDrag()
    if (toolDrag) {
      toolDrag.update({ event, screen, rawWorld })
      return
    }

    if (this._tools.pointerMoveWithCapture({
      event,
      screen,
      rawWorld,
      startScreen: pointerGesture.startScreen,
      startWorld: pointerGesture.startWorld,
      beginDrag: (drag) => this._frame.beginToolPointerDrag(drag),
      clearPointerGesture: () => this._frame.clearPointerGesture(),
    })) {
      return
    }
  }

  private readonly _onPointerUp = (event: PointerEvent): void => {
    const hasPointerGesture = this._frame.hasPointerGesture()
    if (!hasPointerGesture && this._tools.shouldIgnorePointerUpWithoutCapture()) return
    if (hasPointerGesture && !this._frame.pointerGestureFor(event)) return
    const screen = this._screenPoint(event)
    const rawWorld = this._deps.camera.screenToWorld(screen)

    const toolDrag = this._frame.activeToolPointerDrag()
    if (toolDrag) {
      toolDrag.commit({ event, screen, rawWorld })
    }
    const sharedResult = this._sharedGestures.pointerUp({
      screen,
      rawWorld,
      preserveActiveDraft: this._tools.shouldPreserveTransientOnPan(),
    })

    this._cancelTransientInteraction({ preserveActiveDraft: sharedResult.preserveActiveDraft })
    this._refreshViewportDependentMeasurements()
  }

  private readonly _onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const screen = this._screenPoint(event)
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
    this._deps.setViewport(this._deps.camera.zoomAroundScreenPoint(screen, factor))
    this._deps.render('viewport')
    this._refreshViewportDependentMeasurements()
  }

  private readonly _onContextMenu = (event: MouseEvent): void => {
    if (allowsNativeContextMenuTarget(event.target)) return
    event.preventDefault()
    if (this._annotationEditor.hasActiveEditor()) this._annotationEditor.commit()
    const screen = this._screenPoint(event)
    const world = this._deps.camera.screenToWorld(screen)
    const selection = this._retargetContextMenuSelection(world)
    this._contextMenu.show(selection ? { screen, world, selection } : { screen, world })
  }

  private readonly _onDragOver = (event: DragEvent): void => {
    event.preventDefault()
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
  }

  private readonly _onDrop = (event: DragEvent): void => {
    event.preventDefault()
    hideInteractionPreview(this._preview)
    const source = readPlantStampDropSource(event)
    if (!source) return
    if (!isSceneLayerOpenForCreation(this._deps.getSceneStore().persisted, 'plants')) return
    const world = this._applySnapping(this._deps.camera.screenToWorld(this._screenPoint(event)))
    this._deps.sceneEdits.run('interaction-drop', (tx) => {
      tx.mutate((draft) => {
        appendPlantStampSourceToDraft(draft, source, world)
      })
    })
  }

  private _screenPoint(event: Pick<MouseEvent, 'clientX' | 'clientY'>, rect = this._frame.currentContainerRect()): ScenePoint {
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
    if (event.key === 'Escape' && this._zoneControlPoints.cancelActiveDrag()) {
      event.preventDefault()
      this._frame.clearPointerGesture()
      return
    }

    if (event.key === 'Escape' && this._rotationHandle.cancelActiveDrag()) {
      event.preventDefault()
      this._frame.clearPointerGesture()
      return
    }

    if (this._tools.keyDown(event)) return

    if (this._beginSelectedAnnotationTextEditFromKeyboard(event)) return

    if (
      event.code !== 'Space'
      || this._frame.isSpaceHeld()
      || isEditableTarget(event.target)
      || this._tools.shouldSuppressSharedKeyboard(event)
    ) return
    event.preventDefault()
    this._frame.holdSpace()
    if (!this._frame.activeToolPointerDrag() && this._tool !== 'hand') {
      this._deps.container.style.cursor = 'grab'
    }
  }

  private readonly _onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Space') return
    this._frame.releaseSpace()
    if (!this._sharedGestures.panning) {
      this._deps.container.style.cursor = cursorForTool(this._tool)
    }
  }

  private _cancelTransientInteraction(options: SceneInteractionTransientCleanupOptions = {}): void {
    this._frame.cleanupTransient(options, {
      clearPointerGesture: () => this._frame.clearPointerGesture(),
      cancelSharedGestures: () => {
        this._sharedGestures.cancel()
        this._rotationHandle.cancelActiveDrag()
        this._zoneControlPoints.cancelActiveDrag()
      },
      cancelToolTransient: (cleanupOptions) => this._tools.cancelTransient(cleanupOptions),
      clearHover: () => this._clearPassiveHoverPresentation(),
      resetCursor: () => {
        this._deps.container.style.cursor = cursorForTool(this._tool)
      },
    })
  }

  private _refreshViewportDependentMeasurements(): void {
    this._annotationEditor.refresh()
    if (this._tools.refreshViewportDependent()) {
      this._zoneControlPoints.refresh(this._canShowSelectAffordances())
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
    this._tools.refreshSelectionDependent()
    const canShowSelectAffordances = this._canShowSelectAffordances()
    this._zoneControlPoints.refresh(canShowSelectAffordances)
    if (this._designObjectDragPresentationSuppressed || !canShowSelectAffordances) {
      this._rotationHandle.hide()
      this._selectionToolbar.hide()
      return
    }
    this._rotationHandle.refresh()
    this._selectionToolbar.refresh()
  }

  private _canShowSelectAffordances(): boolean {
    return this._tool === 'select' && !this._annotationEditor.hasActiveEditor()
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

  private _beginSelectedAnnotationTextEditFromKeyboard(event: KeyboardEvent): boolean {
    if (this._tool !== 'select') return false
    if (event.key !== 'Enter' && event.key !== 'F2') return false
    if (!isCanvasKeyboardShortcutTarget(event.target, this._deps.container)) return false
    if (isEditableTarget(event.target)) return false
    if (this._tools.shouldSuppressSharedKeyboard(event)) return false

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
    const committed = this._deps.sceneEdits.run('unlock-design-object', (tx) => {
      tx.mutate((draft) => setSceneDesignObjectLocks(draft, [id], false))
    })
    if (committed) this._lockedAffordance.hide()
  }

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
