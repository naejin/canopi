import { computeSelectionRect } from '../operations'
import { getCanvasTool } from '../session-state'
import { gridInterval, snapToGrid } from '../grid'
import { snapToGuides } from '../guides'
import { guides } from '../scene-metadata-state'
import type {
  SceneStore,
  ScenePoint,
} from './scene'
import { isSceneDesignObjectLocked } from './scene'
import type { CameraController } from './camera'
import type { PlantPresentationContext } from './plant-presentation'
import type { SpeciesCacheEntry } from './species-cache'
import type { SceneViewportState } from './scene'
import {
  applySceneDragDeltaToDraft,
  captureSceneDragState,
  createSceneDragState,
  resetSceneDragState,
} from './interaction/drag-ops'
import { hitTestTopLevel, queryRectTopLevel } from './interaction/hit-testing'
import { createHoverTooltip, type HoverTooltipController } from './interaction/hover-tooltip'
import {
  createInteractionPreview,
  hideInteractionPreview,
  showInteractionPreview,
} from './interaction/overlay-ui'
import { cursorForTool, hasAdditiveModifier, isEditableTarget } from './interaction/pointer-utils'
import {
  appendPlantStampSourceToDraft,
} from './interaction/tool-actions'
import { readPlantStampDropSource } from '../plant-stamp-source'
import {
  createSceneToolModules,
  type SceneToolModules,
} from './interaction/tool-modules'
import type {
  SceneToolPointerDrag,
} from './interaction/tool-adapter'
import type { SceneEditCoordinator, SceneEditTransaction } from './scene-runtime/transactions'

type InteractionTool = 'select' | 'hand' | 'rectangle' | 'text' | 'plant-stamp' | 'object-stamp' | 'plant-spacing' | string
type InteractionMode = 'idle' | 'panning' | 'dragging' | 'band' | 'tool-drag'
type ToolPointerDrag = SceneToolPointerDrag

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
}

export class SceneInteractionController {
  private readonly _preview: HTMLDivElement
  private readonly _tooltip: HoverTooltipController
  private readonly _tools: SceneToolModules
  private _tool: InteractionTool = 'select'
  private _mode: InteractionMode = 'idle'
  private _toolDrag: ToolPointerDrag | null = null
  private _pointerId: number | null = null
  private _startScreen: ScenePoint | null = null
  private _startWorld: ScenePoint | null = null
  private _dragEdit: SceneEditTransaction | null = null
  private readonly _dragState = createSceneDragState()
  private _bandAdditive = false
  private _spaceHeld = false
  /** Original position of the hit entity — snap reference for drag. */
  private _dragSnapRef: ScenePoint | null = null
  private _lastDragDelta: ScenePoint = { x: 0, y: 0 }
  /** Cached container rect captured on pointerdown — avoids forced reflow at 60fps during drag. */
  private _cachedContainerRect: DOMRect | null = null

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
      getContainerRect: () => this._cachedContainerRect ?? this._deps.container.getBoundingClientRect(),
    })
    this.setTool(getCanvasTool())
    this._attach()
  }

  setTool(name: string): void {
    this._tool = name
    this._tools.transitionTo(name, () => this._cancelTransientInteraction())
    this._deps.container.style.cursor = cursorForTool(name)
  }

  dispose(): void {
    this._detach()
    this._deps.setHoveredEntityId(null)
    this._tools.dispose()
    this._preview.remove()
    this._tooltip.dispose()
  }

  refreshMeasurements(): void {
    this._refreshViewportDependentMeasurements()
  }

  private _attach(): void {
    this._deps.container.addEventListener('pointerdown', this._onPointerDown)
    this._deps.container.addEventListener('pointerleave', this._onPointerLeave)
    window.addEventListener('pointermove', this._onPointerMove)
    window.addEventListener('pointerup', this._onPointerUp)
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    this._deps.container.addEventListener('wheel', this._onWheel, { passive: false })
    this._deps.container.addEventListener('dragover', this._onDragOver)
    this._deps.container.addEventListener('dragleave', this._onDragLeave)
    this._deps.container.addEventListener('drop', this._onDrop)
  }

  private _detach(): void {
    this._deps.container.removeEventListener('pointerdown', this._onPointerDown)
    this._deps.container.removeEventListener('pointerleave', this._onPointerLeave)
    window.removeEventListener('pointermove', this._onPointerMove)
    window.removeEventListener('pointerup', this._onPointerUp)
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    this._deps.container.removeEventListener('wheel', this._onWheel)
    this._deps.container.removeEventListener('dragover', this._onDragOver)
    this._deps.container.removeEventListener('dragleave', this._onDragLeave)
    this._deps.container.removeEventListener('drop', this._onDrop)
  }

  private readonly _onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) return
    if (this._tools.shouldIgnorePointerEvent(event.target)) return

    this._cachedContainerRect = this._deps.container.getBoundingClientRect()
    const screen = this._screenPoint(event)
    const world = this._deps.camera.screenToWorld(screen)
    this._pointerId = event.pointerId
    this._startScreen = screen
    this._startWorld = world

    if (event.button === 1 || this._tool === 'hand' || this._spaceHeld) {
      event.preventDefault()
      this._mode = 'panning'
      this._deps.container.style.cursor = 'grabbing'
      return
    }

    if (this._tools.pointerDown({
      event,
      screen,
      rawWorld: world,
      beginDrag: (drag) => this._beginToolPointerDrag(drag),
      clearPointerGesture: () => this._clearToolPointerGesture(),
    })) {
      return
    }

    const scene = this._deps.getSceneStore().persisted
    const rawHit = hitTestTopLevel(
      scene,
      world,
      this._deps.camera.viewport.scale,
      this._deps.getSpeciesCache(),
      this._deps.getPlantPresentationContext,
    )
    const hit = rawHit && !isSceneDesignObjectLocked(scene, rawHit.id) ? rawHit : null
    const additive = hasAdditiveModifier(event)

    if (!hit) {
      this._mode = 'band'
      this._bandAdditive = additive
      if (!additive) {
        this._deps.clearSelection()
        this._deps.render('scene')
      }
      showInteractionPreview(this._preview, 'band', screen, screen)
      return
    }

    const currentSelection = new Set(this._deps.getSelection())
    if (additive) {
      if (currentSelection.has(hit.id)) currentSelection.delete(hit.id)
      else currentSelection.add(hit.id)
      this._deps.setSelection(currentSelection)
      this._deps.render('scene')
      return
    }

    if (!currentSelection.has(hit.id)) {
      currentSelection.clear()
      currentSelection.add(hit.id)
      this._deps.setSelection(currentSelection)
      this._deps.render('scene')
    }

    this._mode = 'dragging'
    this._bandAdditive = false
    this._dragEdit = this._deps.sceneEdits.begin('interaction-drag')
    captureSceneDragState(this._dragState, scene, this._deps.getSelection())
    this._dragSnapRef =
      this._dragState.plantStarts.get(hit.id) ??
      this._dragState.annotationStarts.get(hit.id) ??
      this._dragState.groupStarts.get(hit.id) ??
      this._dragState.zoneStarts.get(hit.id)?.[0] ?? null
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

    if (this._pointerId === null) {
      const screen = this._screenPoint(event)
      const rawWorld = this._deps.camera.screenToWorld(screen)
      if (this._tools.pointerMoveWithoutCapture({ event, screen, rawWorld })) return
      this._updateHover(event)
      return
    }
    if (event.pointerId !== this._pointerId) return
    if (!this._startScreen || !this._startWorld) return

    const screen = this._screenPoint(event)
    const rawWorld = this._deps.camera.screenToWorld(screen)

    if (this._mode === 'panning') {
      this._deps.setViewport(this._deps.camera.panBy({
        x: screen.x - this._startScreen.x,
        y: screen.y - this._startScreen.y,
      }))
      this._startScreen = screen
      this._deps.render('viewport')
      this._refreshViewportDependentMeasurements()
      return
    }

    if (this._mode === 'tool-drag' && this._toolDrag) {
      this._toolDrag.update({ event, screen, rawWorld })
      return
    }

    if (this._mode === 'idle' && this._tools.pointerMoveWithCapture({
      event,
      screen,
      rawWorld,
      startScreen: this._startScreen,
      startWorld: this._startWorld,
      beginDrag: (drag) => this._beginToolPointerDrag(drag),
      clearPointerGesture: () => this._clearToolPointerGesture(),
    })) {
      return
    }

    if (this._mode === 'dragging') {
      const delta = this._computeDragDelta(rawWorld)
      if (Math.abs(delta.x - this._lastDragDelta.x) < 0.0001
        && Math.abs(delta.y - this._lastDragDelta.y) < 0.0001) return
      this._lastDragDelta = delta
      this._dragEdit?.mutate((draft) => {
        applySceneDragDeltaToDraft(draft, this._dragState, delta)
      })
      this._deps.render('scene')
      this._refreshSelectionDependentMeasurements()
      return
    }

    if (this._mode === 'band') {
      showInteractionPreview(this._preview, 'band', this._startScreen, screen)
      return
    }
  }

  private readonly _onPointerUp = (event: PointerEvent): void => {
    if (this._pointerId === null && this._tools.shouldIgnorePointerUpWithoutCapture()) return
    if (this._pointerId !== null && event.pointerId !== this._pointerId) return
    const screen = this._screenPoint(event)
    const rawWorld = this._deps.camera.screenToWorld(screen)
    const shouldPreserveActiveDraft = this._mode === 'panning'
      && this._tools.shouldPreserveTransientOnPan()

    if (this._mode === 'dragging' && this._dragEdit) {
      const moved = Math.abs(this._lastDragDelta.x) > 0.001
        || Math.abs(this._lastDragDelta.y) > 0.001
      if (moved) {
        this._dragEdit.commit({ invalidate: 'scene' })
      } else {
        this._dragEdit.abort()
        this._deps.render('scene')
      }
    }

    if (this._mode === 'band' && this._startWorld) {
      const rect = computeSelectionRect(this._startWorld, rawWorld)
      const scene = this._deps.getSceneStore().persisted
      const current = this._bandAdditive
        ? new Set(this._deps.getSelection())
        : new Set<string>()
      for (const target of queryRectTopLevel(
        scene,
        rect,
        this._deps.camera.viewport.scale,
        this._deps.getSpeciesCache(),
        this._deps.getPlantPresentationContext,
      )) {
        if (isSceneDesignObjectLocked(scene, target.id)) continue
        current.add(target.id)
      }
      this._deps.setSelection(current)
      this._deps.render('scene')
    }

    if (this._mode === 'tool-drag' && this._toolDrag) {
      this._toolDrag.commit({ event, screen, rawWorld })
    }

    this._cancelTransientInteraction({ preserveActiveDraft: shouldPreserveActiveDraft })
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

  private _screenPoint(event: Pick<MouseEvent, 'clientX' | 'clientY'>): ScenePoint {
    const rect = this._cachedContainerRect ?? this._deps.container.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  private readonly _onKeyDown = (event: KeyboardEvent): void => {
    if (this._tools.keyDown(event)) return

    if (
      event.code !== 'Space'
      || this._spaceHeld
      || isEditableTarget(event.target)
      || this._tools.shouldSuppressSharedKeyboard(event)
    ) return
    event.preventDefault()
    this._spaceHeld = true
    if (this._mode === 'idle' && this._tool !== 'hand') {
      this._deps.container.style.cursor = 'grab'
    }
  }

  private readonly _onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Space') return
    this._spaceHeld = false
    if (this._mode !== 'panning') {
      this._deps.container.style.cursor = cursorForTool(this._tool)
    }
  }

  private _cancelTransientInteraction(options: { preserveActiveDraft?: boolean } = {}): void {
    this._mode = 'idle'
    this._toolDrag = null
    this._pointerId = null
    this._startScreen = null
    this._startWorld = null
    this._dragEdit?.abort()
    this._dragEdit = null
    this._dragSnapRef = null
    this._lastDragDelta = { x: 0, y: 0 }
    this._cachedContainerRect = null
    resetSceneDragState(this._dragState)
    this._bandAdditive = false
    this._tools.cancelTransient(options)
    hideInteractionPreview(this._preview)
    this._deps.container.style.cursor = cursorForTool(this._tool)
  }

  private _beginToolPointerDrag(drag: ToolPointerDrag): void {
    this._mode = 'tool-drag'
    this._toolDrag = drag
  }

  private _clearToolPointerGesture(): void {
    this._pointerId = null
    this._startScreen = null
    this._startWorld = null
    this._cachedContainerRect = null
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

    if (this._deps.readSnapToGuidesEnabled() && guides.value.length > 0) {
      next = snapToGuides(next.x, next.y, this._deps.camera.viewport.scale)
    }

    return next
  }

  /**
   * Compute the snap-adjusted drag delta. Applies snapping to the hit entity's
   * candidate position (original + raw delta), then derives the actual delta
   * from that. This guarantees the dragged entity lands on grid/guide positions.
   */
  private _computeDragDelta(rawWorld: ScenePoint): ScenePoint {
    const rawDelta = {
      x: rawWorld.x - this._startWorld!.x,
      y: rawWorld.y - this._startWorld!.y,
    }
    if (!this._dragSnapRef) return rawDelta
    const candidate = {
      x: this._dragSnapRef.x + rawDelta.x,
      y: this._dragSnapRef.y + rawDelta.y,
    }
    const snapped = this._applySnapping(candidate)
    return {
      x: snapped.x - this._dragSnapRef.x,
      y: snapped.y - this._dragSnapRef.y,
    }
  }

  private _switchTool(name: string): void {
    this._deps.setTool(name)
    if (this._tool !== name) this.setTool(name)
  }

}
