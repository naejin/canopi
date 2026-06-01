import { computeSelectionRect } from '../operations'
import { getCanvasTool } from '../session-state'
import {
  snapToGridEnabled,
  snapToGuidesEnabled,
} from '../../app/canvas-settings/signals'
import { plantStampSpecies } from '../plant-tool-state'
import { gridInterval, snapToGrid } from '../grid'
import { snapToGuides } from '../guides'
import { guides } from '../scene-metadata-state'
import { lockedObjectIds } from '../runtime-mirror-state'
import type { SceneAnnotationEntity, ScenePlantEntity, SceneStore, ScenePoint, SceneZoneEntity } from './scene'
import type { CameraController } from './camera'
import { getAnnotationWorldBounds } from './annotation-layout'
import { getPlantWorldBounds, type PlantPresentationContext } from './plant-presentation'
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
import {
  createPolygonDraftOverlay,
  type PolygonDraftOverlayController,
} from './interaction/polygon-draft-overlay'
import {
  createZoneMeasurementOverlay,
  type ZoneMeasurementOverlayController,
} from './interaction/zone-measurement-overlay'
import { cursorForTool, hasAdditiveModifier, isEditableTarget } from './interaction/pointer-utils'
import {
  appendEllipseZoneToDraft,
  appendDroppedPlantToDraft,
  appendPolygonZoneToDraft,
  appendRectangleZoneToDraft,
  appendTextAnnotationToDraft,
  parsePlantDropPayload,
} from './interaction/tool-actions'
import {
  createEllipticalZoneMeasurements,
  createEllipticalZoneMeasurementsFromRect,
  createPolygonalZoneDraftMeasurements,
  createPolygonalZoneMeasurements,
  createRectangularZoneMeasurements,
  createRectangularZoneMeasurementsFromRect,
} from './zone-measurements'
import type { SceneEditCoordinator, SceneEditTransaction } from './scene-runtime/transactions'
import { createUuid } from '../../utils/ids'

type InteractionTool = 'select' | 'hand' | 'rectangle' | 'text' | 'plant-stamp' | 'object-stamp' | string

interface ObjectStampPlantSource {
  kind: 'plant'
  sourceId: string
  plant: ScenePlantEntity
  anchorWorld: ScenePoint
}

interface ObjectStampZoneSource {
  kind: 'zone'
  sourceId: string
  zone: SceneZoneEntity
  anchorWorld: ScenePoint
}

interface ObjectStampAnnotationSource {
  kind: 'annotation'
  sourceId: string
  annotation: SceneAnnotationEntity
  anchorWorld: ScenePoint
}

type ObjectStampSource = ObjectStampPlantSource | ObjectStampZoneSource | ObjectStampAnnotationSource

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
  setHoveredEntityId: (id: string | null) => void
  getLocalizedCommonNames: () => ReadonlyMap<string, string | null>
}

export class SceneInteractionController {
  private readonly _preview: HTMLDivElement
  private readonly _tooltip: HoverTooltipController
  private readonly _polygonDraftOverlay: PolygonDraftOverlayController
  private readonly _zoneMeasurements: ZoneMeasurementOverlayController
  private _tool: InteractionTool = 'select'
  private _mode: 'idle' | 'panning' | 'dragging' | 'band' | 'rectangle' | 'ellipse' = 'idle'
  private _pointerId: number | null = null
  private _startScreen: ScenePoint | null = null
  private _startWorld: ScenePoint | null = null
  private _dragEdit: SceneEditTransaction | null = null
  private readonly _dragState = createSceneDragState()
  private _bandAdditive = false
  private _textarea: HTMLTextAreaElement | null = null
  private _textWorldPosition: ScenePoint | null = null
  private _polygonDraftVertices: ScenePoint[] = []
  private _polygonActiveWorld: ScenePoint | null = null
  private _objectStampSource: ObjectStampSource | null = null
  private _spaceHeld = false
  /** Original position of the hit entity — snap reference for drag. */
  private _dragSnapRef: ScenePoint | null = null
  private _lastDragDelta: ScenePoint = { x: 0, y: 0 }
  /** Cached container rect captured on pointerdown — avoids forced reflow at 60fps during drag. */
  private _cachedContainerRect: DOMRect | null = null

  constructor(private readonly _deps: SceneInteractionDeps) {
    this._preview = createInteractionPreview(this._deps.container)
    this._tooltip = createHoverTooltip(this._deps.container)
    this._polygonDraftOverlay = createPolygonDraftOverlay(this._deps.container)
    this._zoneMeasurements = createZoneMeasurementOverlay(this._deps.container)
    this.setTool(getCanvasTool())
    this._attach()
  }

  setTool(name: string): void {
    const previousTool = this._tool
    this._tool = name
    if (previousTool === 'plant-stamp' && name !== 'plant-stamp') {
      plantStampSpecies.value = null
    }
    if (previousTool === 'object-stamp' && name !== 'object-stamp') {
      this._clearObjectStampSource()
    }
    if (previousTool === 'text' && name !== 'text') {
      this._removeTextarea()
    }
    this._cancelTransientInteraction()
    this._deps.container.style.cursor = cursorForTool(name)
  }

  dispose(): void {
    this._detach()
    this._deps.setHoveredEntityId(null)
    this._removeTextarea()
    this._preview.remove()
    this._polygonDraftOverlay.dispose()
    this._zoneMeasurements.dispose()
    this._tooltip.dispose()
  }

  refreshMeasurements(): void {
    this._refreshSelectedZoneMeasurements()
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

    if (this._tool === 'plant-stamp') {
      this._placePlantFromStamp(this._applySnapping(world))
      return
    }

    if (this._tool === 'object-stamp') {
      event.preventDefault()
      this._handleObjectStampPointerDown(world)
      return
    }

    if (this._tool === 'rectangle') {
      event.preventDefault()
      this._beginBoxZoneDrawing('rectangle', world)
      return
    }

    if (this._tool === 'ellipse') {
      event.preventDefault()
      this._beginBoxZoneDrawing('ellipse', world)
      return
    }

    if (this._tool === 'polygon') {
      event.preventDefault()
      this._handlePolygonPointerDown(world)
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
    if (this._tool === 'polygon' && this._polygonDraftVertices.length > 0 && this._pointerId === null) {
      const screen = this._screenPoint(event)
      this._polygonActiveWorld = this._applySnapping(this._deps.camera.screenToWorld(screen))
      this._polygonDraftOverlay.update(this._polygonDraftVertices, this._polygonActiveWorld, this._deps.camera)
      this._updateDraftPolygonMeasurements()
      return
    }

    if (this._tool === 'object-stamp' && this._objectStampSource && this._pointerId === null) {
      const screen = this._screenPoint(event)
      this._updateObjectStampPreview(this._applySnapping(this._deps.camera.screenToWorld(screen)))
      return
    }

    if (this._pointerId === null) {
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

    if (this._mode === 'dragging') {
      const delta = this._computeDragDelta(rawWorld)
      if (Math.abs(delta.x - this._lastDragDelta.x) < 0.0001
        && Math.abs(delta.y - this._lastDragDelta.y) < 0.0001) return
      this._lastDragDelta = delta
      this._dragEdit?.mutate((draft) => {
        applySceneDragDeltaToDraft(draft, this._dragState, delta)
      })
      this._deps.render('scene')
      this._refreshSelectedZoneMeasurements()
      return
    }

    if (this._mode === 'band' || this._mode === 'rectangle' || this._mode === 'ellipse') {
      const isBoxZone = this._mode === 'rectangle' || this._mode === 'ellipse'
      const endWorld = isBoxZone ? this._applySnapping(rawWorld) : rawWorld
      const endScreen = isBoxZone
        ? this._deps.camera.worldToScreen(endWorld)
        : screen
      showInteractionPreview(
        this._preview,
        isBoxZone ? this._mode : 'band',
        this._startScreen,
        endScreen,
      )
      if (this._mode === 'rectangle') {
        this._updateDraftRectangleMeasurements(this._startWorld, endWorld)
      } else if (this._mode === 'ellipse') {
        this._updateDraftEllipseMeasurements(this._startWorld, endWorld)
      }
    }
  }

  private readonly _onPointerUp = (event: PointerEvent): void => {
    if (this._tool === 'polygon' && this._pointerId === null && this._polygonDraftVertices.length > 0) return
    if (this._pointerId !== null && event.pointerId !== this._pointerId) return
    const screen = this._screenPoint(event)
    const rawWorld = this._deps.camera.screenToWorld(screen)
    const shouldPreservePolygonDraft = this._mode === 'panning' && this._polygonDraftVertices.length > 0

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
        if (lockedObjectIds.value.has(target.id)) continue
        current.add(target.id)
      }
      this._deps.setSelection(current)
      this._deps.render('scene')
    }

    if (this._mode === 'rectangle' && this._startWorld) {
      const rect = computeSelectionRect(this._startWorld, this._applySnapping(rawWorld))
      if (rect.width >= 0.5 && rect.height >= 0.5) {
        this._deps.sceneEdits.run('interaction-rectangle', (tx) => {
          let zoneName: string | null = null
          tx.mutate((draft) => {
            zoneName = appendRectangleZoneToDraft(draft, rect)
          })
          if (zoneName) tx.setSelection([zoneName])
        })
      }
    }

    if (this._mode === 'ellipse' && this._startWorld) {
      const rect = computeSelectionRect(this._startWorld, this._applySnapping(rawWorld))
      if (rect.width >= 0.5 && rect.height >= 0.5) {
        this._deps.sceneEdits.run('interaction-ellipse', (tx) => {
          let zoneName: string | null = null
          tx.mutate((draft) => {
            zoneName = appendEllipseZoneToDraft(draft, rect)
          })
          if (zoneName) tx.setSelection([zoneName])
        })
      }
    }

    this._cancelTransientInteraction({ preservePolygonDraft: shouldPreservePolygonDraft })
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
    const payload = parsePlantDropPayload(event)
    if (!payload) return
    const world = this._applySnapping(this._deps.camera.screenToWorld(this._screenPoint(event)))
    this._deps.sceneEdits.run('interaction-drop', (tx) => {
      tx.mutate((draft) => {
        appendDroppedPlantToDraft(draft, payload, world)
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
    if (this._tool === 'polygon' && this._polygonDraftVertices.length > 0 && !isEditableTarget(event.target)) {
      if (event.key === 'Escape') {
        event.preventDefault()
        this._cancelPolygonDraft()
        return
      }
      if (event.key === 'Backspace') {
        event.preventDefault()
        this._removeLastPolygonVertex()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        this._commitPolygonDraft()
        return
      }
    }

    if (this._tool === 'object-stamp' && !isEditableTarget(event.target) && event.key === 'Escape') {
      event.preventDefault()
      this._switchTool('select')
      return
    }

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

  private _cancelTransientInteraction(options: { preservePolygonDraft?: boolean } = {}): void {
    this._mode = 'idle'
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
    if (!options.preservePolygonDraft) this._cancelPolygonDraft()
    hideInteractionPreview(this._preview)
    this._deps.container.style.cursor = cursorForTool(this._tool)
  }

  private _beginBoxZoneDrawing(mode: 'rectangle' | 'ellipse', world: ScenePoint): void {
    const snappedWorld = this._applySnapping(world)
    const snappedScreen = this._deps.camera.worldToScreen(snappedWorld)
    this._startWorld = snappedWorld
    this._startScreen = snappedScreen
    this._mode = mode
    showInteractionPreview(this._preview, mode, snappedScreen, snappedScreen)
  }

  private _handlePolygonPointerDown(world: ScenePoint): void {
    const point = this._applySnapping(world)
    this._mode = 'idle'
    this._pointerId = null
    this._startScreen = null
    this._startWorld = null
    this._cachedContainerRect = null
    this._zoneMeasurements.hide()

    if (this._shouldClosePolygonAt(point)) {
      this._commitPolygonDraft()
      return
    }

    const last = this._polygonDraftVertices[this._polygonDraftVertices.length - 1]
    if (last && pointsEqual(last, point)) {
      this._polygonActiveWorld = point
      this._polygonDraftOverlay.update(this._polygonDraftVertices, this._polygonActiveWorld, this._deps.camera)
      this._updateDraftPolygonMeasurements()
      return
    }

    if (this._polygonDraftVertices.length === 0 && this._deps.getSelection().size > 0) {
      this._deps.clearSelection()
      this._deps.render('scene')
    }
    this._polygonDraftVertices = [...this._polygonDraftVertices, point]
    this._polygonActiveWorld = point
    this._polygonDraftOverlay.update(this._polygonDraftVertices, this._polygonActiveWorld, this._deps.camera)
    this._updateDraftPolygonMeasurements()
  }

  private _shouldClosePolygonAt(point: ScenePoint): boolean {
    if (this._polygonDraftVertices.length < 3) return false
    const first = this._polygonDraftVertices[0]!
    const firstScreen = this._deps.camera.worldToScreen(first)
    const pointScreen = this._deps.camera.worldToScreen(point)
    return Math.hypot(pointScreen.x - firstScreen.x, pointScreen.y - firstScreen.y) <= 8
  }

  private _commitPolygonDraft(): void {
    if (this._polygonDraftVertices.length < 3) return
    const committed = this._deps.sceneEdits.run('interaction-polygon', (tx) => {
      let zoneName: string | null = null
      tx.mutate((draft) => {
        zoneName = appendPolygonZoneToDraft(draft, this._polygonDraftVertices)
      })
      if (zoneName) tx.setSelection([zoneName])
    })
    if (committed) {
      this._cancelPolygonDraft()
      this._refreshSelectedZoneMeasurements()
    }
  }

  private _removeLastPolygonVertex(): void {
    this._polygonDraftVertices = this._polygonDraftVertices.slice(0, -1)
    if (this._polygonDraftVertices.length === 0) {
      this._cancelPolygonDraft()
      return
    }
    this._polygonDraftOverlay.update(this._polygonDraftVertices, this._polygonActiveWorld, this._deps.camera)
    this._updateDraftPolygonMeasurements()
  }

  private _cancelPolygonDraft(): void {
    const hadDraft = this._polygonDraftVertices.length > 0 || this._polygonActiveWorld !== null
    this._polygonDraftVertices = []
    this._polygonActiveWorld = null
    this._polygonDraftOverlay.hide()
    if (hadDraft) this._zoneMeasurements.hide()
  }

  private _updateDraftRectangleMeasurements(startWorld: ScenePoint, endWorld: ScenePoint): void {
    const rect = computeSelectionRect(startWorld, endWorld)
    this._zoneMeasurements.update(
      createRectangularZoneMeasurementsFromRect(rect),
      this._deps.camera,
    )
  }

  private _updateDraftEllipseMeasurements(startWorld: ScenePoint, endWorld: ScenePoint): void {
    const rect = computeSelectionRect(startWorld, endWorld)
    this._zoneMeasurements.update(
      createEllipticalZoneMeasurementsFromRect(rect),
      this._deps.camera,
    )
  }

  private _updateDraftPolygonMeasurements(): void {
    this._zoneMeasurements.update(
      createPolygonalZoneDraftMeasurements(this._polygonDraftVertices, this._polygonActiveWorld),
      this._deps.camera,
    )
  }

  private _refreshViewportDependentMeasurements(): void {
    if (this._polygonDraftVertices.length > 0) {
      this._polygonDraftOverlay.update(this._polygonDraftVertices, this._polygonActiveWorld, this._deps.camera)
      this._updateDraftPolygonMeasurements()
      return
    }

    this._refreshSelectedZoneMeasurements()
  }

  private _refreshSelectedZoneMeasurements(): void {
    const selection = Array.from(this._deps.getSelection())
    if (selection.length !== 1) {
      this._zoneMeasurements.hide()
      return
    }

    const selectedId = selection[0]!
    const scene = this._deps.getSceneStore().persisted
    const zonesLayer = scene.layers.find((entry) => entry.name === 'zones')
    if (zonesLayer?.visible === false) {
      this._zoneMeasurements.hide()
      return
    }
    if (scene.groups.some((group) => group.id === selectedId || group.memberIds.includes(selectedId))) {
      this._zoneMeasurements.hide()
      return
    }

    const zone = scene.zones.find((entry) => entry.name === selectedId)
    if (!zone) {
      this._zoneMeasurements.hide()
      return
    }

    if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
      this._zoneMeasurements.update(
        createEllipticalZoneMeasurements(zone.points[0]!, zone.points[1]!),
        this._deps.camera,
      )
      return
    }

    if (zone.zoneType === 'polygon') {
      this._zoneMeasurements.update(
        createPolygonalZoneMeasurements(zone.points),
        this._deps.camera,
      )
      return
    }

    if (zone.zoneType !== 'rect') {
      this._zoneMeasurements.hide()
      return
    }

    this._zoneMeasurements.update(
      createRectangularZoneMeasurements(zone.points),
      this._deps.camera,
    )
  }

  /** Snap a world-space point to grid and/or guides. Used for placement (stamp, text). */
  private _applySnapping(point: ScenePoint): ScenePoint {
    let next = point

    if (snapToGridEnabled.value) {
      next = snapToGrid(next.x, next.y, gridInterval(this._deps.camera.viewport.scale).interval)
    }

    if (snapToGuidesEnabled.value && guides.value.length > 0) {
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

  private _placePlantFromStamp(world: ScenePoint): void {
    const species = plantStampSpecies.value
    if (!species) return
    this._deps.sceneEdits.run('interaction-stamp-plant', (tx) => {
      tx.mutate((draft) => {
        appendDroppedPlantToDraft(draft, species, world)
      })
    })
  }

  private _handleObjectStampPointerDown(world: ScenePoint): void {
    if (!this._objectStampSource) {
      this._sampleObjectStampSource(world)
      this._pointerId = null
      this._startScreen = null
      this._startWorld = null
      this._cachedContainerRect = null
      return
    }

    this._placeObjectStamp(this._applySnapping(world))
    this._pointerId = null
    this._startScreen = null
    this._startWorld = null
    this._cachedContainerRect = null
  }

  private _sampleObjectStampSource(world: ScenePoint): void {
    const scene = this._deps.getSceneStore().persisted
    const hit = hitTestTopLevel(
      scene,
      world,
      this._deps.camera.viewport.scale,
      this._deps.getSpeciesCache(),
      this._deps.getPlantPresentationContext,
    )
    if (!hit || lockedObjectIds.value.has(hit.id)) return

    if (hit.kind === 'plant') {
      const plant = scene.plants.find((entry) => entry.id === hit.id)
      if (!plant) return

      this._objectStampSource = {
        kind: 'plant',
        sourceId: plant.id,
        plant: clonePlantForObjectStamp(plant),
        anchorWorld: { ...world },
      }
      this._updateObjectStampPreview(world)
      return
    }

    if (hit.kind === 'zone') {
      const zone = scene.zones.find((entry) => entry.name === hit.id)
      if (!zone) return

      this._objectStampSource = {
        kind: 'zone',
        sourceId: zone.name,
        zone: cloneZoneForObjectStamp(zone),
        anchorWorld: { ...world },
      }
      this._updateObjectStampPreview(world)
      return
    }

    if (hit.kind === 'annotation') {
      const annotation = scene.annotations.find((entry) => entry.id === hit.id)
      if (!annotation) return

      this._objectStampSource = {
        kind: 'annotation',
        sourceId: annotation.id,
        annotation: cloneAnnotationForObjectStamp(annotation),
        anchorWorld: { ...world },
      }
      this._updateObjectStampPreview(world)
    }
  }

  private _placeObjectStamp(anchorWorld: ScenePoint): void {
    const source = this._objectStampSource
    if (!source || !this._canUseObjectStampSource(source)) return
    const delta = objectStampDelta(source, anchorWorld)

    if (source.kind === 'plant') {
      let nextId = ''
      const committed = this._deps.sceneEdits.run('interaction-object-stamp', (tx) => {
        tx.mutate((draft) => {
          const clone = clonePlantForObjectStamp(source.plant)
          clone.id = createUuid()
          clone.position = translatePoint(source.plant.position, delta)
          draft.plants = [...draft.plants, clone]
          nextId = clone.id
        })
        if (nextId) tx.setSelection([nextId])
      })
      if (committed) this._updateObjectStampPreview(anchorWorld)
      return
    }

    if (source.kind === 'zone') {
      let nextId = ''
      const committed = this._deps.sceneEdits.run('interaction-object-stamp', (tx) => {
        tx.mutate((draft) => {
          const clone = cloneZoneForObjectStamp(source.zone)
          clone.name = uniqueZoneName(source.zone.name, new Set(draft.zones.map((zone) => zone.name)))
          clone.points = translateZonePoints(source.zone, delta)
          draft.zones = [...draft.zones, clone]
          nextId = clone.name
        })
        if (nextId) tx.setSelection([nextId])
      })
      if (committed) this._updateObjectStampPreview(anchorWorld)
      return
    }

    if (source.kind === 'annotation') {
      let nextId = ''
      const committed = this._deps.sceneEdits.run('interaction-object-stamp', (tx) => {
        tx.mutate((draft) => {
          const clone = cloneAnnotationForObjectStamp(source.annotation)
          clone.id = createUuid()
          clone.position = translatePoint(source.annotation.position, delta)
          draft.annotations = [...draft.annotations, clone]
          nextId = clone.id
        })
        if (nextId) tx.setSelection([nextId])
      })
      if (committed) this._updateObjectStampPreview(anchorWorld)
    }
  }

  private _canUseObjectStampSource(source: ObjectStampSource): boolean {
    if (lockedObjectIds.value.has(source.sourceId)) return false
    const scene = this._deps.getSceneStore().persisted
    if (source.kind === 'plant') {
      const layer = scene.layers.find((entry) => entry.name === 'plants')
      return layer?.visible !== false && layer?.locked !== true
    }
    if (source.kind === 'zone') {
      const layer = scene.layers.find((entry) => entry.name === 'zones')
      return layer?.visible !== false && layer?.locked !== true
    }
    if (source.kind === 'annotation') {
      const layer = scene.layers.find((entry) => entry.name === 'annotations')
      return layer?.visible !== false && layer?.locked !== true
    }
    return false
  }

  private _updateObjectStampPreview(anchorWorld: ScenePoint): void {
    const source = this._objectStampSource
    if (!source) {
      hideInteractionPreview(this._preview)
      return
    }

    if (source.kind === 'plant') {
      const delta = objectStampDelta(source, anchorWorld)
      const previewPlant = clonePlantForObjectStamp(source.plant)
      previewPlant.position = translatePoint(source.plant.position, delta)
      const bounds = getPlantWorldBounds(
        previewPlant,
        this._deps.getPlantPresentationContext(this._deps.camera.viewport.scale),
      )
      showInteractionPreview(
        this._preview,
        'ellipse',
        this._deps.camera.worldToScreen({ x: bounds.x, y: bounds.y }),
        this._deps.camera.worldToScreen({
          x: bounds.x + bounds.width,
          y: bounds.y + bounds.height,
        }),
      )
      return
    }

    if (source.kind === 'zone') {
      const previewZone = cloneZoneForObjectStamp(source.zone)
      previewZone.points = translateZonePoints(source.zone, objectStampDelta(source, anchorWorld))
      const bounds = zoneWorldBounds(previewZone)
      if (!bounds) {
        hideInteractionPreview(this._preview)
        return
      }
      showInteractionPreview(
        this._preview,
        previewZone.zoneType === 'ellipse' ? 'ellipse' : 'rectangle',
        this._deps.camera.worldToScreen({ x: bounds.x, y: bounds.y }),
        this._deps.camera.worldToScreen({
          x: bounds.x + bounds.width,
          y: bounds.y + bounds.height,
        }),
      )
      return
    }

    if (source.kind === 'annotation') {
      const previewAnnotation = cloneAnnotationForObjectStamp(source.annotation)
      previewAnnotation.position = translatePoint(
        source.annotation.position,
        objectStampDelta(source, anchorWorld),
      )
      const bounds = getAnnotationWorldBounds(previewAnnotation, this._deps.camera.viewport.scale)
      showInteractionPreview(
        this._preview,
        'rectangle',
        this._deps.camera.worldToScreen({ x: bounds.x, y: bounds.y }),
        this._deps.camera.worldToScreen({
          x: bounds.x + bounds.width,
          y: bounds.y + bounds.height,
        }),
      )
    }
  }

  private _clearObjectStampSource(): void {
    this._objectStampSource = null
    hideInteractionPreview(this._preview)
  }

  private _switchTool(name: string): void {
    this._deps.setTool(name)
    if (this._tool !== name) this.setTool(name)
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
      background: 'var(--color-surface)',
      border: '1px solid var(--color-primary)',
      borderRadius: 'var(--radius-sm)',
      outline: 'none',
      resize: 'none',
      overflow: 'hidden',
      fontFamily: 'var(--font-sans, Inter, system-ui, sans-serif)',
      fontSize: 'var(--text-base)',
      lineHeight: '1.4',
      color: 'var(--color-text)',
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

    this._deps.sceneEdits.run('interaction-text', (tx) => {
      let nextId = ''
      tx.mutate((draft) => {
        nextId = appendTextAnnotationToDraft(draft, position, text)
      })
      tx.setSelection([nextId])
    })
  }

  private _removeTextarea(): void {
    this._textarea?.remove()
    this._textarea = null
    this._textWorldPosition = null
  }

}

function pointsEqual(a: ScenePoint, b: ScenePoint): boolean {
  return Math.abs(a.x - b.x) < 0.0001 && Math.abs(a.y - b.y) < 0.0001
}

function clonePlantForObjectStamp(plant: ScenePlantEntity): ScenePlantEntity {
  return {
    ...plant,
    position: { ...plant.position },
  }
}

function cloneZoneForObjectStamp(zone: SceneZoneEntity): SceneZoneEntity {
  return {
    ...zone,
    points: zone.points.map((point) => ({ ...point })),
  }
}

function cloneAnnotationForObjectStamp(annotation: SceneAnnotationEntity): SceneAnnotationEntity {
  return {
    ...annotation,
    position: { ...annotation.position },
  }
}

function objectStampDelta(source: ObjectStampSource, anchorWorld: ScenePoint): ScenePoint {
  return {
    x: anchorWorld.x - source.anchorWorld.x,
    y: anchorWorld.y - source.anchorWorld.y,
  }
}

function translatePoint(point: ScenePoint, delta: ScenePoint): ScenePoint {
  return {
    x: point.x + delta.x,
    y: point.y + delta.y,
  }
}

function translateZonePoints(zone: SceneZoneEntity, delta: ScenePoint): ScenePoint[] {
  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    return [
      translatePoint(zone.points[0]!, delta),
      { ...zone.points[1]! },
    ]
  }
  return zone.points.map((point) => translatePoint(point, delta))
}

function uniqueZoneName(baseName: string, existingNames: Set<string>): string {
  if (!existingNames.has(baseName)) return baseName
  let index = 2
  let candidate = `${baseName} copy`
  while (existingNames.has(candidate)) {
    candidate = `${baseName} copy ${index}`
    index += 1
  }
  return candidate
}

function zoneWorldBounds(zone: SceneZoneEntity): { x: number; y: number; width: number; height: number } | null {
  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const center = zone.points[0]!
    const radii = zone.points[1]!
    return {
      x: center.x - radii.x,
      y: center.y - radii.y,
      width: radii.x * 2,
      height: radii.y * 2,
    }
  }

  if (zone.points.length === 0) return null
  const xs = zone.points.map((point) => point.x)
  const ys = zone.points.map((point) => point.y)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}
