import { computeSelectionRect } from '../../operations'
import type { CameraController } from '../camera'
import type { PlantPresentationContext } from '../plant-presentation'
import type { CanvasDesignObjectSelectionModel } from '../runtime'
import type { ScenePoint, SceneStore } from '../scene'
import { isDirectSceneDesignObjectLocked, isSceneDesignObjectLocked } from '../scene'
import {
  applySpeciesSelection,
  getSelectablePlantIdsForSpecies,
} from '../scene-runtime/species-selection'
import type { SceneEditCoordinator, SceneEditTransaction } from '../scene-runtime/transactions'
import type { SpeciesCacheEntry } from '../species-cache'
import {
  applySceneDragDeltaToDraft,
  captureSceneDragState,
  createSceneDragState,
  resetSceneDragState,
} from './drag-ops'
import { hitTestTopLevel, queryRectTopLevel } from './hit-testing'
import { showInteractionPreview, hideInteractionPreview } from './overlay-ui'
import {
  createPlantDragDistanceOverlay,
  type PlantDragDistanceOverlayController,
} from './plant-drag-distance-overlay'
import { hasAdditiveModifier } from './pointer-utils'

type SharedGestureMode = 'idle' | 'panning' | 'dragging' | 'band'

export interface SceneInteractionSharedGestureContext {
  readonly container: HTMLElement
  readonly preview: HTMLDivElement
  readonly camera: CameraController
  readonly getSceneStore: () => SceneStore
  readonly getSpeciesCache: () => ReadonlyMap<string, SpeciesCacheEntry>
  readonly getPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  readonly getSelection: () => ReadonlySet<string>
  readonly getDesignObjectSelection: () => CanvasDesignObjectSelectionModel
  readonly setSelection: (ids: Iterable<string>) => void
  readonly clearSelection: () => void
  readonly sceneEdits: SceneEditCoordinator
  readonly setViewport: (viewport: ReturnType<CameraController['panBy']>) => void
  readonly render: (kind: 'scene' | 'viewport') => void
  readonly applySnapping: (point: ScenePoint) => ScenePoint
  readonly refreshViewportDependent: () => void
  readonly refreshSelectionDependent: () => void
  readonly beginAnnotationTextEdit: (annotationId: string) => boolean
}

export interface SharedGesturePointerDownContext {
  readonly event: PointerEvent
  readonly screen: ScenePoint
  readonly world: ScenePoint
  readonly tool: string
  readonly spaceHeld: boolean
}

export interface SharedGesturePointerMoveContext {
  readonly screen: ScenePoint
  readonly rawWorld: ScenePoint
}

export interface SharedGesturePointerUpContext {
  readonly rawWorld: ScenePoint
  readonly preserveActiveDraft: boolean
}

export interface SharedGesturePointerUpResult {
  readonly preserveActiveDraft: boolean
}

export interface SceneInteractionSharedGestures {
  readonly active: boolean
  readonly panning: boolean
  beginPan(context: SharedGesturePointerDownContext): boolean
  beginSelectionGesture(context: SharedGesturePointerDownContext): boolean
  pointerMove(context: SharedGesturePointerMoveContext): boolean
  pointerUp(context: SharedGesturePointerUpContext): SharedGesturePointerUpResult
  cancel(): void
  dispose(): void
}

export function createSceneInteractionSharedGestures(
  context: SceneInteractionSharedGestureContext,
): SceneInteractionSharedGestures {
  return new DefaultSceneInteractionSharedGestures(context)
}

class DefaultSceneInteractionSharedGestures implements SceneInteractionSharedGestures {
  private mode: SharedGestureMode = 'idle'
  private startScreen: ScenePoint | null = null
  private startWorld: ScenePoint | null = null
  private dragEdit: SceneEditTransaction | null = null
  private readonly dragState = createSceneDragState()
  private bandAdditive = false
  private dragSnapRef: ScenePoint | null = null
  private lastDragDelta: ScenePoint = { x: 0, y: 0 }
  private activeDraggedPlantId: string | null = null
  private readonly distanceOverlay: PlantDragDistanceOverlayController

  constructor(private readonly context: SceneInteractionSharedGestureContext) {
    this.distanceOverlay = createPlantDragDistanceOverlay(context.container)
  }

  get active(): boolean {
    return this.mode !== 'idle'
  }

  get panning(): boolean {
    return this.mode === 'panning'
  }

  beginPan({ event, screen, world, tool, spaceHeld }: SharedGesturePointerDownContext): boolean {
    if (event.button !== 1 && tool !== 'hand' && !spaceHeld) return false
    event.preventDefault()
    this.mode = 'panning'
    this.startScreen = screen
    this.startWorld = world
    this.context.container.style.cursor = 'grabbing'
    return true
  }

  beginSelectionGesture({ event, screen, world, tool }: SharedGesturePointerDownContext): boolean {
    this.startScreen = screen
    this.startWorld = world
    const scene = this.context.getSceneStore().persisted
    const rawHit = hitTestTopLevel(
      scene,
      world,
      this.context.camera.viewport.scale,
      this.context.getSpeciesCache(),
      this.context.getPlantPresentationContext,
    )
    const lockedHit = rawHit && isDirectSceneDesignObjectLocked(scene, rawHit.id) ? rawHit : null
    const hit = rawHit && (!isSceneDesignObjectLocked(scene, rawHit.id) || lockedHit) ? rawHit : null
    const additive = hasAdditiveModifier(event)

    if (!hit) {
      this.mode = 'band'
      this.bandAdditive = additive
      if (!additive) {
        this.context.clearSelection()
        this.context.render('scene')
      }
      showInteractionPreview(this.context.preview, 'band', screen, screen)
      return true
    }

    if (lockedHit) {
      const currentSelection = new Set(this.context.getSelection())
      if (additive) {
        if (currentSelection.has(lockedHit.id)) currentSelection.delete(lockedHit.id)
        else currentSelection.add(lockedHit.id)
      } else {
        currentSelection.clear()
        currentSelection.add(lockedHit.id)
      }
      this.context.setSelection(currentSelection)
      this.context.render('scene')
      this.context.refreshSelectionDependent()
      return true
    }

    if (tool === 'select' && event.detail >= 2 && hit.kind === 'plant') {
      const plant = scene.plants.find((entry) => entry.id === hit.id)
      if (!plant) return true
      const speciesPlantIds = getSelectablePlantIdsForSpecies(scene, plant.canonicalName)
      if (speciesPlantIds.length === 0) return true
      this.context.setSelection(applySpeciesSelection(
        this.context.getSelection(),
        speciesPlantIds,
        additive,
      ))
      this.context.render('scene')
      this.context.refreshSelectionDependent()
      return true
    }

    if (tool === 'select' && event.detail >= 2 && hit.kind === 'annotation') {
      this.context.setSelection([hit.id])
      this.context.render('scene')
      this.context.refreshSelectionDependent()
      this.context.beginAnnotationTextEdit(hit.id)
      return true
    }

    const currentSelection = new Set(this.context.getSelection())
    if (additive) {
      if (currentSelection.has(hit.id)) currentSelection.delete(hit.id)
      else currentSelection.add(hit.id)
      this.context.setSelection(currentSelection)
      this.context.render('scene')
      return true
    }

    if (!currentSelection.has(hit.id)) {
      currentSelection.clear()
      currentSelection.add(hit.id)
      this.context.setSelection(currentSelection)
      this.context.render('scene')
    }

    this.mode = 'dragging'
    this.bandAdditive = false
    this.dragEdit = this.context.sceneEdits.begin('interaction-drag')
    captureSceneDragState(this.dragState, scene, editableSelectionIds(this.context.getDesignObjectSelection()))
    this.dragSnapRef =
      this.dragState.plantStarts.get(hit.id) ??
      this.dragState.annotationStarts.get(hit.id) ??
      this.dragState.groupStarts.get(hit.id) ??
      this.dragState.zoneStarts.get(hit.id)?.[0] ?? null
    this.activeDraggedPlantId = this.dragState.plantStarts.has(hit.id) ? hit.id : null
    this.distanceOverlay.hide()
    return true
  }

  pointerMove({ screen, rawWorld }: SharedGesturePointerMoveContext): boolean {
    if (this.mode === 'panning' && this.startScreen) {
      this.context.setViewport(this.context.camera.panBy({
        x: screen.x - this.startScreen.x,
        y: screen.y - this.startScreen.y,
      }))
      this.startScreen = screen
      this.context.render('viewport')
      this.context.refreshViewportDependent()
      return true
    }

    if (this.mode === 'dragging') {
      const delta = this.computeDragDelta(rawWorld)
      if (Math.abs(delta.x - this.lastDragDelta.x) < 0.0001
        && Math.abs(delta.y - this.lastDragDelta.y) < 0.0001) return true
      this.lastDragDelta = delta
      this.dragEdit?.mutate((draft) => {
        applySceneDragDeltaToDraft(draft, this.dragState, delta)
      })
      this.distanceOverlay.update({
        scene: this.context.getSceneStore().persisted,
        activePlantId: this.activeDraggedPlantId,
        draggedPlantIds: new Set(this.dragState.plantStarts.keys()),
        camera: this.context.camera,
      })
      this.context.render('scene')
      this.context.refreshSelectionDependent()
      return true
    }

    if (this.mode === 'band' && this.startScreen) {
      showInteractionPreview(this.context.preview, 'band', this.startScreen, screen)
      return true
    }

    return false
  }

  pointerUp({ rawWorld, preserveActiveDraft }: SharedGesturePointerUpContext): SharedGesturePointerUpResult {
    const preserve = this.mode === 'panning' && preserveActiveDraft

    if (this.mode === 'dragging' && this.dragEdit) {
      const moved = Math.abs(this.lastDragDelta.x) > 0.001
        || Math.abs(this.lastDragDelta.y) > 0.001
      if (moved) this.dragEdit.commit({ invalidate: 'scene' })
      else {
        this.dragEdit.abort()
        this.context.render('scene')
      }
      this.dragEdit = null
      this.distanceOverlay.hide()
      this.activeDraggedPlantId = null
    }

    if (this.mode === 'band' && this.startWorld) {
      const rect = computeSelectionRect(this.startWorld, rawWorld)
      const scene = this.context.getSceneStore().persisted
      const current = this.bandAdditive
        ? new Set(this.context.getSelection())
        : new Set<string>()
      for (const target of queryRectTopLevel(
        scene,
        rect,
        this.context.camera.viewport.scale,
        this.context.getSpeciesCache(),
        this.context.getPlantPresentationContext,
      )) {
        if (isSceneDesignObjectLocked(scene, target.id)) continue
        current.add(target.id)
      }
      this.context.setSelection(current)
      this.context.render('scene')
    }

    return { preserveActiveDraft: preserve }
  }

  cancel(): void {
    this.mode = 'idle'
    this.startScreen = null
    this.startWorld = null
    this.dragEdit?.abort()
    this.dragEdit = null
    this.dragSnapRef = null
    this.lastDragDelta = { x: 0, y: 0 }
    this.activeDraggedPlantId = null
    resetSceneDragState(this.dragState)
    this.bandAdditive = false
    hideInteractionPreview(this.context.preview)
    this.distanceOverlay.hide()
  }

  dispose(): void {
    this.cancel()
    this.distanceOverlay.dispose()
  }

  private computeDragDelta(rawWorld: ScenePoint): ScenePoint {
    const rawDelta = {
      x: rawWorld.x - this.startWorld!.x,
      y: rawWorld.y - this.startWorld!.y,
    }
    if (!this.dragSnapRef) return rawDelta
    const candidate = {
      x: this.dragSnapRef.x + rawDelta.x,
      y: this.dragSnapRef.y + rawDelta.y,
    }
    const snapped = this.context.applySnapping(candidate)
    return {
      x: snapped.x - this.dragSnapRef.x,
      y: snapped.y - this.dragSnapRef.y,
    }
  }
}

function editableSelectionIds(selection: CanvasDesignObjectSelectionModel): Set<string> {
  return new Set(selection.editableTargets.map((target) => target.id))
}
