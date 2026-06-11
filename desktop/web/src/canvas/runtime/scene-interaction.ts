import { getCanvasTool } from '../session-state'
import { gridInterval, snapToGrid } from '../grid'
import { snapToGuides } from '../guides'
import type {
  SceneStore,
  ScenePoint,
} from './scene'
import type { CameraController } from './camera'
import type { PlantPresentationContext } from './plant-presentation'
import type { SpeciesCacheEntry } from './species-cache'
import type { SceneViewportState } from './scene'
import { hitTestTopLevel } from './interaction/hit-testing'
import { createHoverTooltip, type HoverTooltipController } from './interaction/hover-tooltip'
import {
  createInteractionPreview,
  hideInteractionPreview,
  showInteractionPreview,
} from './interaction/overlay-ui'
import { cursorForTool, isEditableTarget } from './interaction/pointer-utils'
import {
  appendPlantStampSourceToDraft,
} from './interaction/tool-actions'
import { readPlantStampDropSource } from '../plant-stamp-source'
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
import type { SceneEditCoordinator } from './scene-runtime/transactions'

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
  private _tool: InteractionTool = 'select'

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
    this._sharedGestures = createSceneInteractionSharedGestures({
      container: this._deps.container,
      preview: this._preview,
      camera: this._deps.camera,
      getSceneStore: this._deps.getSceneStore,
      getSelection: this._deps.getSelection,
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
    this._tool = name
    this._frame.transitionTool({
      toolName: name,
      transition: (toolName) => this._tools.transitionTo(toolName, () => this._cancelTransientInteraction()),
      updateCursor: (toolName) => {
        this._deps.container.style.cursor = cursorForTool(toolName)
      },
    })
  }

  dispose(): void {
    this._frame.dispose(() => {
      this._deps.setHoveredEntityId(null)
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
    this._deps.setHoveredEntityId(null)
    this._tooltip.hide()
  }

  private _updateHover(event: PointerEvent): void {
    if (this._tools.shouldSuppressHover()) {
      this._deps.setHoveredEntityId(null)
      this._tooltip.hide()
      return
    }

    const rect = this._deps.container.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom) {
      this._deps.setHoveredEntityId(null)
      this._tooltip.hide()
      return
    }
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const world = this._deps.camera.screenToWorld(screen)
    const hit = hitTestTopLevel(
      this._deps.getSceneStore().persisted,
      world,
      this._deps.camera.viewport.scale,
      this._deps.getSpeciesCache(),
      this._deps.getPlantPresentationContext,
    )
    if (hit?.kind === 'plant') {
      this._deps.setHoveredEntityId(hit.id)
      const plant = this._deps.getSceneStore().persisted.plants.find((p) => p.id === hit.id)
      if (plant) {
        const commonName = this._deps.getLocalizedCommonNames().get(plant.canonicalName) ?? plant.commonName
        this._tooltip.show(screen.x, screen.y, commonName, plant.canonicalName)
      }
    } else {
      this._deps.setHoveredEntityId(null)
      this._tooltip.hide()
    }
  }

  private readonly _onPointerMove = (event: PointerEvent): void => {
    if (this._tools.shouldIgnorePointerEvent(event.target)) return

    if (!this._frame.hasPointerGesture()) {
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

  private readonly _onDragOver = (event: DragEvent): void => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
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

  private readonly _onKeyDown = (event: KeyboardEvent): void => {
    if (this._tools.keyDown(event)) return

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
      cancelSharedGestures: () => this._sharedGestures.cancel(),
      cancelToolTransient: (cleanupOptions) => this._tools.cancelTransient(cleanupOptions),
      clearHover: () => {
        this._deps.setHoveredEntityId(null)
        this._tooltip.hide()
      },
      resetCursor: () => {
        this._deps.container.style.cursor = cursorForTool(this._tool)
      },
    })
  }

  private _refreshViewportDependentMeasurements(): void {
    if (this._tools.refreshViewportDependent()) return

    this._refreshSelectionDependentMeasurements()
  }

  private _refreshSelectionDependentMeasurements(): void {
    this._tools.refreshSelectionDependent()
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

}
