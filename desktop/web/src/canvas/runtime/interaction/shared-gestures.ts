import { computeSelectionRect } from '../../operations'
import type { CameraController } from '../camera'
import type { PlantPresentationContext } from '../plant-presentation'
import type { CanvasDesignObjectSelectionModel } from '../runtime'
import type {
  SceneDesignObjectSelection,
  SceneDesignObjectTarget,
  ScenePoint,
  SceneStateReader,
} from '../scene'
import {
  isDirectSceneDesignObjectLocked,
  isSceneDesignObjectLocked,
  normalizeSceneDesignObjectTargets,
  sceneTargetKey,
} from '../scene'
import {
  applySpeciesSelection,
  getSelectablePlantIdsForSpecies,
} from '../scene-runtime/species-selection'
import type { SceneEditCoordinator, SceneEditTransaction } from '../scene-runtime/transactions'
import type { SpeciesCacheEntry } from '../species-cache'
import {
  runCanvasRuntimeCleanups,
  throwCanvasRuntimeCleanupErrors,
} from '../cleanup'
import {
  applySceneDragDeltaToDraft,
  captureSceneDragState,
  createSceneDragState,
  resetSceneDragState,
} from './drag-ops'
import { hitTestTopLevel, queryRectTopLevel, type TopLevelTarget } from './hit-testing'
import { showInteractionPreview, hideInteractionPreview } from './overlay-ui'
import {
  createPlantDragDistanceOverlay,
  type PlantDragDistanceOverlayController,
} from './plant-drag-distance-overlay'
import { hasAdditiveModifier } from './pointer-utils'

type SharedGestureMode = 'idle' | 'panning' | 'dragging' | 'band'

const DOUBLE_CLICK_INTERVAL_MS = 500
const DOUBLE_CLICK_DISTANCE_PX = 6

export interface SceneInteractionSharedGestureContext {
  readonly container: HTMLElement
  readonly preview: HTMLDivElement
  readonly camera: CameraController
  readonly getSceneStore: () => SceneStateReader
  readonly getSpeciesCache: () => ReadonlyMap<string, SpeciesCacheEntry>
  readonly getPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  readonly getSelection: () => SceneDesignObjectSelection
  readonly getDesignObjectSelection: () => CanvasDesignObjectSelectionModel
  readonly setSelection: (targets: Iterable<SceneDesignObjectTarget>) => void
  readonly clearSelection: () => void
  readonly sceneEdits: SceneEditCoordinator
  readonly render: (kind: 'scene' | 'viewport') => void
  readonly applySnapping: (point: ScenePoint) => ScenePoint
  readonly refreshViewportDependent: () => void
  readonly refreshSelectionDependent: () => void
  readonly beginDesignObjectDragPresentation: () => void
  readonly endDesignObjectDragPresentation: () => void
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
  readonly screen: ScenePoint
  readonly rawWorld: ScenePoint
  readonly preserveActiveDraft: boolean
}

export interface SharedGesturePointerUpResult {
  readonly preserveActiveDraft: boolean
}

export interface SceneInteractionSharedGestures {
  readonly active: boolean
  readonly editActive: boolean
  readonly requiresSettledPointerUp: boolean
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
  private activeClickTarget: TopLevelTarget | null = null
  private activeClickScreen: ScenePoint | null = null
  private activeClickAdditive = false
  private dragPresentationActive = false
  private lastClick: {
    readonly target: TopLevelTarget
    readonly screen: ScenePoint
    readonly timeStamp: number
  } | null = null
  private readonly distanceOverlay: PlantDragDistanceOverlayController

  constructor(private readonly context: SceneInteractionSharedGestureContext) {
    this.distanceOverlay = createPlantDragDistanceOverlay(context.container)
  }

  get active(): boolean {
    return this.mode !== 'idle'
  }

  get editActive(): boolean {
    return this.dragEdit !== null
  }

  get requiresSettledPointerUp(): boolean {
    return this.mode === 'band'
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
    this.activeClickTarget = null
    this.activeClickScreen = null
    this.activeClickAdditive = false
    const scene = this.context.getSceneStore().persisted
    const rawHit = hitTestTopLevel(
      scene,
      world,
      this.context.camera.viewport.scale,
      this.context.getSpeciesCache(),
      this.context.getPlantPresentationContext,
    )
    const lockedHit = rawHit && isDirectSceneDesignObjectLocked(scene, rawHit) ? rawHit : null
    const hit = rawHit && (!isSceneDesignObjectLocked(scene, rawHit) || lockedHit) ? rawHit : null
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
      this.context.setSelection(additive
        ? toggleSelectionTarget(this.context.getSelection(), lockedHit)
        : [lockedHit])
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

    const recognizedAnnotationDoubleClick = tool === 'select'
      && event.button === 0
      && !additive
      && hit.kind === 'annotation'
      && (
        event.detail >= 2
        || this.isRecognizedDoubleClick(hit, screen)
      )
    if (recognizedAnnotationDoubleClick) {
      this.lastClick = null
      this.context.setSelection([hit])
      this.context.render('scene')
      this.context.refreshSelectionDependent()
      this.context.beginAnnotationTextEdit(hit.id)
      return true
    }

    const currentSelection = this.context.getSelection()
    if (additive) {
      this.context.setSelection(toggleSelectionTarget(currentSelection, hit))
      this.context.render('scene')
      return true
    }

    if (!selectionHasTarget(currentSelection, hit)) {
      this.context.setSelection([hit])
      this.context.render('scene')
    }

    this.mode = 'dragging'
    this.bandAdditive = false
    this.dragEdit = this.context.sceneEdits.begin('interaction-drag')
    captureSceneDragState(this.dragState, scene, this.context.getDesignObjectSelection().editableTargets)
    this.dragSnapRef = dragStartForTarget(this.dragState, hit) ?? firstCapturedDragStart(this.dragState)
    this.activeDraggedPlantId = hit.kind === 'plant' && this.dragState.plantStarts.has(hit.id)
      ? hit.id
      : null
    this.activeClickTarget = hit
    this.activeClickScreen = screen
    this.activeClickAdditive = additive
    this.dragPresentationActive = true
    this.context.beginDesignObjectDragPresentation()
    this.distanceOverlay.hide()
    return true
  }

  pointerMove({ screen, rawWorld }: SharedGesturePointerMoveContext): boolean {
    if (this.mode === 'panning' && this.startScreen) {
      this.context.camera.panBy({
        x: screen.x - this.startScreen.x,
        y: screen.y - this.startScreen.y,
      })
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

  pointerUp({ screen, rawWorld, preserveActiveDraft }: SharedGesturePointerUpContext): SharedGesturePointerUpResult {
    const preserve = this.mode === 'panning' && preserveActiveDraft
    let recordedClickCandidate = false

    if (this.mode === 'dragging' && this.dragEdit) {
      const moved = Math.abs(this.lastDragDelta.x) > 0.001
        || Math.abs(this.lastDragDelta.y) > 0.001
      if (moved) this.dragEdit.commit({ invalidate: 'scene' })
      else {
        this.dragEdit.abort()
        this.context.render('scene')
        this.recordClickCandidate()
        recordedClickCandidate = true
      }
      if (moved) this.lastClick = null
      this.dragEdit = null
      this.activeDraggedPlantId = null
      try {
        this.distanceOverlay.hide()
      } finally {
        this.endDragPresentation()
      }
    }

    if (this.mode === 'band' && this.startWorld && this.startScreen && distance(this.startScreen, screen) > 2) {
      const rect = computeSelectionRect(this.startWorld, rawWorld)
      const scene = this.context.getSceneStore().persisted
      const current = this.bandAdditive
        ? new Map(this.context.getSelection().map((target) => [sceneTargetKey(target), target]))
        : new Map<string, SceneDesignObjectTarget>()
      for (const target of queryRectTopLevel(
        scene,
        rect,
        this.context.camera.viewport.scale,
        this.context.getSpeciesCache(),
        this.context.getPlantPresentationContext,
      )) {
        if (isSceneDesignObjectLocked(scene, target)) continue
        current.set(sceneTargetKey(target), target)
      }
      this.context.setSelection(current.values())
      this.context.render('scene')
    }

    if (!recordedClickCandidate) this.lastClick = null
    return { preserveActiveDraft: preserve }
  }

  cancel(): void {
    const errors: unknown[] = []
    const attempt = (cleanup: () => void): void => {
      try {
        cleanup()
      } catch (error) {
        errors.push(error)
      }
    }
    const wasDragging = this.mode === 'dragging'
    const edit = this.dragEdit
    let transactionFinished = edit === null
    if (edit) {
      attempt(() => {
        edit.abort()
        if (this.dragEdit === edit) this.dragEdit = null
        transactionFinished = true
      })
    }

    if (transactionFinished) {
      this.mode = 'idle'
      this.startScreen = null
      this.startWorld = null
      this.dragSnapRef = null
      this.lastDragDelta = { x: 0, y: 0 }
      this.activeDraggedPlantId = null
      this.activeClickTarget = null
      this.activeClickScreen = null
      this.activeClickAdditive = false
      resetSceneDragState(this.dragState)
      this.bandAdditive = false
    }
    attempt(() => hideInteractionPreview(this.context.preview))
    attempt(() => this.distanceOverlay.hide())
    if (wasDragging && transactionFinished) attempt(() => this.context.render('scene'))
    attempt(() => this.endDragPresentation())
    throwCanvasRuntimeCleanupErrors(errors, 'Shared Scene Interaction cancellation failed')
  }

  dispose(): void {
    runCanvasRuntimeCleanups([
      () => this.cancel(),
      () => this.distanceOverlay.dispose(),
    ], 'Shared Scene Interaction disposal failed')
  }

  private endDragPresentation(): void {
    if (!this.dragPresentationActive) return
    this.context.endDesignObjectDragPresentation()
    this.dragPresentationActive = false
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

  private isRecognizedDoubleClick(target: TopLevelTarget, screen: ScenePoint): boolean {
    const previous = this.lastClick
    if (!previous) return false
    if (previous.target.kind !== target.kind || previous.target.id !== target.id) return false
    if (performance.now() - previous.timeStamp > DOUBLE_CLICK_INTERVAL_MS) return false
    return Math.hypot(previous.screen.x - screen.x, previous.screen.y - screen.y) <= DOUBLE_CLICK_DISTANCE_PX
  }

  private recordClickCandidate(): void {
    if (!this.activeClickTarget || !this.activeClickScreen || this.activeClickAdditive) {
      this.lastClick = null
      return
    }
    this.lastClick = {
      target: this.activeClickTarget,
      screen: this.activeClickScreen,
      timeStamp: performance.now(),
    }
  }
}

function distance(a: ScenePoint, b: ScenePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function selectionHasTarget(
  selection: SceneDesignObjectSelection,
  target: SceneDesignObjectTarget,
): boolean {
  const key = sceneTargetKey(target)
  return selection.some((candidate) => sceneTargetKey(candidate) === key)
}

function toggleSelectionTarget(
  selection: SceneDesignObjectSelection,
  target: SceneDesignObjectTarget,
): SceneDesignObjectTarget[] {
  const next = new Map(selection.map((candidate) => [sceneTargetKey(candidate), candidate]))
  const key = sceneTargetKey(target)
  if (next.has(key)) next.delete(key)
  else next.set(key, target)
  return normalizeSceneDesignObjectTargets(next.values())
}

function dragStartForTarget(
  state: ReturnType<typeof createSceneDragState>,
  target: SceneDesignObjectTarget,
): ScenePoint | null {
  if (target.kind === 'plant') return state.plantStarts.get(target.id) ?? null
  if (target.kind === 'annotation') return state.annotationStarts.get(target.id) ?? null
  if (target.kind === 'measurement-guide') {
    return state.measurementGuideStarts.get(target.id)?.start ?? null
  }
  if (target.kind === 'zone') return state.zoneStarts.get(target.id)?.[0] ?? null
  return null
}

function firstCapturedDragStart(
  state: ReturnType<typeof createSceneDragState>,
): ScenePoint | null {
  return state.plantStarts.values().next().value
    ?? state.annotationStarts.values().next().value
    ?? state.measurementGuideStarts.values().next().value?.start
    ?? state.zoneStarts.values().next().value?.[0]
    ?? null
}
