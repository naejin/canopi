import { computeSelectionRect } from '../operations'
import { getCanvasTool } from '../session-state'
import {
  gridSize,
  guides,
  lockedObjectIds,
  plantStampSpecies,
  snapToGridEnabled,
  snapToGuidesEnabled,
} from '../../state/canvas'
import { snapToGrid } from '../grid'
import { snapToGuides } from '../guides'
import type { SceneStore, ScenePoint } from './scene'
import type { CameraController } from './camera'
import type { SceneCommandSnapshot } from './scene-commands'
import type { PlantPresentationContext } from './plant-presentation'
import type { SpeciesCacheEntry } from './species-cache'
import {
  applySceneDragDelta,
  captureSceneDragState,
  createSceneDragState,
  resetSceneDragState,
} from './interaction/drag-ops'
import { hitTestTopLevel, queryRectTopLevel } from './interaction/hit-testing'
import {
  createInteractionPreview,
  hideInteractionPreview,
  showInteractionPreview,
} from './interaction/overlay-ui'
import { cursorForTool, hasAdditiveModifier, isEditableTarget } from './interaction/pointer-utils'
import {
  appendDroppedPlant,
  appendRectangleZone,
  appendStampedPlant,
  appendTextAnnotation,
  parsePlantDropPayload,
} from './interaction/tool-actions'

type InteractionTool = 'select' | 'hand' | 'rectangle' | 'text' | 'plant-stamp' | string

export interface SceneInteractionDeps {
  container: HTMLElement
  getSceneStore: () => SceneStore
  camera: CameraController
  getSpeciesCache: () => ReadonlyMap<string, SpeciesCacheEntry>
  getPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  getSelection: () => ReadonlySet<string>
  setSelection: (ids: Iterable<string>) => void
  clearSelection: () => void
  setTool: (name: string) => void
  render: (kind: 'scene' | 'viewport') => void
  markDirty: (before: SceneCommandSnapshot) => void
}

export class SceneInteractionController {
  private readonly _preview: HTMLDivElement
  private _tool: InteractionTool = 'select'
  private _mode: 'idle' | 'panning' | 'dragging' | 'band' | 'rectangle' = 'idle'
  private _pointerId: number | null = null
  private _startScreen: ScenePoint | null = null
  private _startWorld: ScenePoint | null = null
  private _beforeSnapshot: SceneCommandSnapshot | null = null
  private readonly _dragState = createSceneDragState()
  private _bandAdditive = false
  private _textarea: HTMLTextAreaElement | null = null
  private _textWorldPosition: ScenePoint | null = null
  private _spaceHeld = false

  constructor(private readonly _deps: SceneInteractionDeps) {
    this._preview = createInteractionPreview(this._deps.container)
    this.setTool(getCanvasTool())
    this._attach()
  }

  setTool(name: string): void {
    const previousTool = this._tool
    this._tool = name
    if (previousTool === 'plant-stamp' && name !== 'plant-stamp') {
      plantStampSpecies.value = null
    }
    if (previousTool === 'text' && name !== 'text') {
      this._removeTextarea()
    }
    this._cancelTransientInteraction()
    this._deps.container.style.cursor = cursorForTool(name)
  }

  dispose(): void {
    this._detach()
    this._removeTextarea()
    this._preview.remove()
  }

  private _attach(): void {
    this._deps.container.addEventListener('pointerdown', this._onPointerDown)
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

    if (this._tool === 'plant-stamp') {
      this._placePlantFromStamp(this._applySnapping(world))
      return
    }

    if (this._tool === 'rectangle') {
      event.preventDefault()
      this._mode = 'rectangle'
      showInteractionPreview(this._preview, 'rectangle', screen, screen)
      return
    }

    if (this._tool === 'text') {
      event.preventDefault()
      this._handleTextPointerDown(world)
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
    const hit = rawHit && !lockedObjectIds.value.has(rawHit.id) ? rawHit : null
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
    this._beforeSnapshot = this._captureSnapshot()
    captureSceneDragState(this._dragState, scene, this._deps.getSelection())
  }

  private readonly _onPointerMove = (event: PointerEvent): void => {
    if (this._pointerId !== null && event.pointerId !== this._pointerId) return
    if (!this._startScreen || !this._startWorld) return

    const screen = this._screenPoint(event)
    const rawWorld = this._deps.camera.screenToWorld(screen)
    const world = this._applySnapping(rawWorld)

    if (this._mode === 'panning') {
      this._deps.getSceneStore().setViewport(this._deps.camera.panBy({
        x: screen.x - this._startScreen.x,
        y: screen.y - this._startScreen.y,
      }))
      this._startScreen = screen
      this._deps.render('viewport')
      return
    }

    if (this._mode === 'dragging') {
      const delta = {
        x: world.x - this._startWorld.x,
        y: world.y - this._startWorld.y,
      }
      applySceneDragDelta(this._deps.getSceneStore(), this._dragState, delta)
      this._deps.render('scene')
      return
    }

    if (this._mode === 'band' || this._mode === 'rectangle') {
      showInteractionPreview(
        this._preview,
        this._mode === 'rectangle' ? 'rectangle' : 'band',
        this._startScreen,
        screen,
      )
    }
  }

  private readonly _onPointerUp = (event: PointerEvent): void => {
    if (this._pointerId !== null && event.pointerId !== this._pointerId) return
    const screen = this._screenPoint(event)
    const rawWorld = this._deps.camera.screenToWorld(screen)
    const world = this._applySnapping(rawWorld)

    if (this._mode === 'dragging' && this._beforeSnapshot && this._startWorld) {
      const moved = Math.abs(world.x - this._startWorld.x) > 0.001 || Math.abs(world.y - this._startWorld.y) > 0.001
      if (moved) {
        this._deps.markDirty(this._beforeSnapshot)
      } else {
        this._restoreBeforeSnapshot()
      }
      this._deps.render('scene')
    }

    if (this._mode === 'band' && this._startWorld) {
      const rect = computeSelectionRect(this._startWorld, world)
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
        if (lockedObjectIds.value.has(target.id)) continue
        current.add(target.id)
      }
      this._deps.setSelection(current)
      this._deps.render('scene')
    }

    if (this._mode === 'rectangle' && this._startWorld) {
      const rect = computeSelectionRect(this._startWorld, world)
      if (rect.width >= 0.5 && rect.height >= 0.5) {
        const before = this._captureSnapshot()
        const zoneName = appendRectangleZone(this._deps.getSceneStore(), rect)
        if (zoneName) {
          this._deps.setSelection([zoneName])
        }
        this._deps.markDirty(before)
        this._deps.render('scene')
      }
    }

    this._cancelTransientInteraction()
  }

  private readonly _onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const screen = this._screenPoint(event)
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
    this._deps.getSceneStore().setViewport(this._deps.camera.zoomAroundScreenPoint(screen, factor))
    this._deps.render('viewport')
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
    const payload = parsePlantDropPayload(event)
    if (!payload) return
    const before = this._captureSnapshot()
    const world = this._applySnapping(this._deps.camera.screenToWorld(this._screenPoint(event)))
    appendDroppedPlant(this._deps.getSceneStore(), payload, world)
    this._deps.markDirty(before)
    this._deps.render('scene')
  }

  private _screenPoint(event: Pick<MouseEvent, 'clientX' | 'clientY'>): ScenePoint {
    const rect = this._deps.container.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  private readonly _onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' || this._spaceHeld || isEditableTarget(event.target) || this._textarea) return
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

  private _cancelTransientInteraction(): void {
    this._mode = 'idle'
    this._pointerId = null
    this._startScreen = null
    this._startWorld = null
    this._beforeSnapshot = null
    resetSceneDragState(this._dragState)
    this._bandAdditive = false
    hideInteractionPreview(this._preview)
    this._deps.container.style.cursor = cursorForTool(this._tool)
  }

  private _applySnapping(point: ScenePoint): ScenePoint {
    let next = point

    if (snapToGridEnabled.value) {
      next = snapToGrid(next.x, next.y, gridSize.value)
    }

    if (snapToGuidesEnabled.value && guides.value.length > 0) {
      next = snapToGuides(next.x, next.y, this._deps.camera.viewport.scale)
    }

    return next
  }

  private _restoreBeforeSnapshot(): void {
    if (!this._beforeSnapshot) return
    this._deps.getSceneStore().restoreSnapshot({
      persisted: this._beforeSnapshot.persisted,
      session: this._beforeSnapshot.session,
    })
    this._deps.setSelection(this._beforeSnapshot.session.selectedEntityIds)
  }

  private _placePlantFromStamp(world: ScenePoint): void {
    const species = plantStampSpecies.value
    if (!species) return
    const before = this._captureSnapshot()
    appendStampedPlant(this._deps.getSceneStore(), species, world)
    this._deps.markDirty(before)
    this._deps.render('scene')
  }

  private _handleTextPointerDown(world: ScenePoint): void {
    if (this._textarea) {
      this._commitText()
      return
    }
    this._textWorldPosition = world
    this._spawnTextarea(world)
  }

  private _spawnTextarea(world: ScenePoint): void {
    const textarea = document.createElement('textarea')
    const screen = this._deps.camera.worldToScreen(world)
    this._textarea = textarea

    Object.assign(textarea.style, {
      position: 'absolute',
      left: `${screen.x}px`,
      top: `${screen.y}px`,
      minWidth: '120px',
      minHeight: '24px',
      padding: '2px 4px',
      background: '#ffffff',
      border: '1px solid #5a73a0',
      borderRadius: '4px',
      outline: 'none',
      resize: 'none',
      overflow: 'hidden',
      fontFamily: 'Inter, sans-serif',
      fontSize: '16px',
      lineHeight: '1.4',
      color: '#1a1a1a',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      zIndex: '3',
      whiteSpace: 'pre',
    })

    this._deps.container.appendChild(textarea)
    requestAnimationFrame(() => {
      if (this._textarea !== textarea) return
      textarea.focus()
      textarea.addEventListener('input', () => {
        textarea.style.height = 'auto'
        textarea.style.height = `${textarea.scrollHeight}px`
      })
      textarea.addEventListener('blur', () => {
        requestAnimationFrame(() => {
          if (this._textarea === textarea) this._commitText()
        })
      })
    })
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        this._removeTextarea()
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        this._commitText()
      }
    })
  }

  private _commitText(): void {
    const textarea = this._textarea
    const position = this._textWorldPosition
    if (!textarea || !position) {
      this._removeTextarea()
      return
    }

    const text = textarea.value.trim()
    this._removeTextarea()
    if (!text) return

    const before = this._captureSnapshot()
    const nextId = appendTextAnnotation(this._deps.getSceneStore(), position, text)
    this._deps.setSelection([nextId])
    this._deps.markDirty(before)
    this._deps.render('scene')
  }

  private _removeTextarea(): void {
    this._textarea?.remove()
    this._textarea = null
    this._textWorldPosition = null
  }

  private _captureSnapshot(): SceneCommandSnapshot {
    const snapshot = this._deps.getSceneStore().snapshot()
    return {
      persisted: snapshot.persisted,
      session: snapshot.session,
      lockedIds: new Set(lockedObjectIds.value),
    }
  }
}
