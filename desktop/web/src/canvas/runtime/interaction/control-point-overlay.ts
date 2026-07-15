import { runCanvasRuntimeCleanups, throwCanvasRuntimeCleanupErrors } from '../cleanup'
import type { CameraController } from '../camera'
import type { ScenePersistedState, ScenePoint } from '../scene'
import type { SceneEditCoordinator, SceneEditTransaction } from '../scene-runtime/transactions'
import type { SceneToolPointerDrag, SceneToolPointerEvent } from './tool-adapter'

export interface ControlPointOverlayPoint {
  readonly id: string
  readonly world: ScenePoint
}

export interface ControlPointOverlayDragPresentation<TEntity> {
  update(entity: TEntity): void
  hide(): void
  dispose(): void
}

export interface ControlPointOverlayAdapter<
  TEntity,
  TPoint extends ControlPointOverlayPoint,
> {
  readonly editType: string
  readonly rootDataAttribute: string
  readonly activeDataAttribute: string
  getEligibleEntity(): TEntity | null
  getEntityId(entity: TEntity): string
  ownsControlPoint(entity: TEntity, point: TPoint): boolean
  cloneEntity(entity: TEntity): TEntity
  createControlPoints(entity: TEntity): readonly TPoint[]
  reshape(entity: TEntity, point: TPoint, dragged: ScenePoint): TEntity | null
  entitiesEqual(left: TEntity, right: TEntity): boolean
  writeDraft(draft: ScenePersistedState, entityId: string, entity: TEntity): void
  decorateHandle(handle: HTMLElement, point: TPoint, screen: ScenePoint): void
  createDragPresentation?(): ControlPointOverlayDragPresentation<TEntity>
}

export interface ControlPointOverlayOptions {
  readonly container: HTMLElement
  readonly camera: CameraController
  readonly sceneEdits: SceneEditCoordinator
  readonly applySnapping: (point: ScenePoint) => ScenePoint
  readonly render: (kind: 'scene' | 'viewport') => void
  readonly refreshSelectionDependent: () => void
  readonly beginDragPresentation: () => void
  readonly endDragPresentation: () => void
}

export interface ControlPointOverlayController {
  readonly dragActive: boolean
  refresh(enabled: boolean): void
  hide(): void
  pointerDown(context: ControlPointOverlayPointerDownContext): SceneToolPointerDrag | null
  cancelActiveDrag(): boolean
  contains(target: EventTarget | null): boolean
  dispose(): void
}

interface ControlPointOverlayPointerDownContext {
  readonly event: PointerEvent
  readonly rawWorld: ScenePoint
}

interface ActiveControlPointDrag<TEntity, TPoint> {
  readonly tx: SceneEditTransaction
  readonly entityId: string
  readonly controlPoint: TPoint
  readonly startEntity: TEntity
  readonly startScreen: ScenePoint
  changed: boolean
  movedPastDragThreshold: boolean
}

const CONTROL_POINT_HIT_SIZE_PX = 20
const CONTROL_POINT_MARK_SIZE_PX = 8
const CONTROL_POINT_Z_INDEX = 29
const CONTROL_POINT_DRAG_THRESHOLD_PX = 2

export function createControlPointOverlay<
  TEntity,
  TPoint extends ControlPointOverlayPoint,
>(
  options: ControlPointOverlayOptions,
  adapter: ControlPointOverlayAdapter<TEntity, TPoint>,
): ControlPointOverlayController {
  const root = document.createElement('div')
  root.dataset.controlPointOverlay = 'true'
  root.dataset[adapter.rootDataAttribute] = 'true'
  root.style.cssText = [
    'position: absolute',
    'inset: 0',
    `z-index: ${CONTROL_POINT_Z_INDEX}`,
    'display: none',
    'pointer-events: none',
  ].join(';')

  let dragPresentation: ControlPointOverlayDragPresentation<TEntity> | null = null
  try {
    options.container.appendChild(root)
    dragPresentation = adapter.createDragPresentation?.() ?? null
  } catch (error) {
    const errors: unknown[] = [error]
    try {
      dragPresentation?.dispose()
    } catch (disposeError) {
      errors.push(disposeError)
    }
    root.remove()
    throwCanvasRuntimeCleanupErrors(errors, 'Control Point Overlay construction failed')
  }

  let activeDrag: ActiveControlPointDrag<TEntity, TPoint> | null = null
  let controlPoints = new Map<string, TPoint>()

  function refresh(enabled: boolean): void {
    if (!enabled) {
      hide()
      return
    }

    const entity = adapter.getEligibleEntity()
    if (!entity) {
      hide()
      return
    }

    const nextControlPoints = adapter.createControlPoints(entity)
    if (nextControlPoints.length === 0) {
      hide()
      return
    }

    let handles: HTMLElement[]
    try {
      handles = nextControlPoints.map(createControlPointElement)
    } catch (error) {
      hide()
      throw error
    }
    controlPoints = new Map(nextControlPoints.map((point) => [point.id, point]))
    root.replaceChildren(...handles)
    root.style.display = 'block'
  }

  function hide(): void {
    root.replaceChildren()
    controlPoints = new Map()
    root.style.display = 'none'
  }

  function pointerDown({ event, rawWorld }: ControlPointOverlayPointerDownContext): SceneToolPointerDrag | null {
    if (event.button !== 0) return null
    const element = closestControlPointElement(event.target)
    const pointId = element?.dataset.controlPointOverlayHandle
    const controlPoint = pointId ? controlPoints.get(pointId) : null
    if (!controlPoint) return null

    const entity = adapter.getEligibleEntity()
    if (!entity || !adapter.ownsControlPoint(entity, controlPoint)) return null

    const startEntity = adapter.cloneEntity(entity)
    const entityId = adapter.getEntityId(entity)
    const transaction = options.sceneEdits.begin(adapter.editType)
    event.preventDefault()
    event.stopPropagation()
    activeDrag = {
      tx: transaction,
      entityId,
      controlPoint,
      startEntity,
      startScreen: options.camera.worldToScreen(rawWorld),
      changed: false,
      movedPastDragThreshold: false,
    }
    markDragActive()
    try {
      options.beginDragPresentation()
    } catch (error) {
      rollbackDragSetup(error)
    }

    return {
      update: updateDrag,
      commit: commitDrag,
    }
  }

  function updateDrag(context: SceneToolPointerEvent): void {
    const drag = activeDrag
    if (!drag) return
    if (
      !drag.movedPastDragThreshold
      && screenDistance(drag.startScreen, context.screen) <= CONTROL_POINT_DRAG_THRESHOLD_PX
    ) return
    drag.movedPastDragThreshold = true
    applyActiveDrag(context.rawWorld)
  }

  function commitDrag(context: SceneToolPointerEvent): void {
    const drag = activeDrag
    if (!drag) return
    const movedPastDragThreshold = drag.movedPastDragThreshold
      || screenDistance(drag.startScreen, context.screen) > CONTROL_POINT_DRAG_THRESHOLD_PX
    if (movedPastDragThreshold) applyActiveDrag(context.rawWorld)
    let transactionFinished = false
    try {
      dragPresentation?.hide()
      if (drag.changed && drag.tx.changed) {
        drag.tx.commit({ invalidate: 'scene' })
        transactionFinished = true
      } else {
        drag.tx.abort()
        transactionFinished = true
        options.render('scene')
      }
    } finally {
      if (transactionFinished) {
        activeDrag = null
        clearDragActiveMark()
        finishDragPresentation()
      }
    }
  }

  function cancelActiveDrag(): boolean {
    const drag = activeDrag
    if (!drag) return false
    const errors: unknown[] = []
    let transactionFinished = false
    try {
      drag.tx.abort()
      transactionFinished = true
    } catch (error) {
      errors.push(error)
    }
    if (transactionFinished) activeDrag = null
    clearDragActiveMark()
    for (const cleanup of [
      () => dragPresentation?.hide(),
      () => options.render('scene'),
      finishDragPresentation,
    ]) {
      try {
        cleanup()
      } catch (error) {
        errors.push(error)
      }
    }
    throwCanvasRuntimeCleanupErrors(errors, 'Control Point Overlay cancellation failed')
    return true
  }

  function rollbackDragSetup(setupError: unknown): never {
    const errors: unknown[] = [setupError]
    const drag = activeDrag
    let transactionFinished = false
    try {
      drag?.tx.abort()
      transactionFinished = true
    } catch (error) {
      errors.push(error)
    }
    if (transactionFinished) activeDrag = null
    clearDragActiveMark()
    for (const cleanup of [
      () => dragPresentation?.hide(),
      finishDragPresentation,
    ]) {
      try {
        cleanup()
      } catch (error) {
        errors.push(error)
      }
    }
    throwCanvasRuntimeCleanupErrors(errors, 'Control Point Overlay drag setup failed')
    throw setupError
  }

  function finishDragPresentation(): void {
    try {
      options.endDragPresentation()
    } finally {
      options.refreshSelectionDependent()
    }
  }

  function applyActiveDrag(rawWorld: ScenePoint): void {
    const drag = activeDrag
    if (!drag) return
    const snapped = options.applySnapping(rawWorld)
    const nextEntity = adapter.reshape(drag.startEntity, drag.controlPoint, snapped)
    if (!nextEntity) return
    drag.changed = drag.changed || !adapter.entitiesEqual(drag.startEntity, nextEntity)
    drag.tx.mutate((draft) => adapter.writeDraft(draft, drag.entityId, nextEntity))
    dragPresentation?.update(nextEntity)
    options.render('scene')
    options.refreshSelectionDependent()
  }

  function markDragActive(): void {
    root.dataset.controlPointOverlayActive = 'true'
    root.dataset[adapter.activeDataAttribute] = 'true'
  }

  function clearDragActiveMark(): void {
    delete root.dataset.controlPointOverlayActive
    delete root.dataset[adapter.activeDataAttribute]
  }

  function closestControlPointElement(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null
    const element = target.closest<HTMLElement>('[data-control-point-overlay-handle]')
    return element && root.contains(element) ? element : null
  }

  function createControlPointElement(point: TPoint): HTMLElement {
    const screen = options.camera.worldToScreen(point.world)
    const handle = document.createElement('div')
    handle.dataset.controlPointOverlayHandle = point.id
    handle.style.cssText = [
      'position: absolute',
      `left: ${screen.x - CONTROL_POINT_HIT_SIZE_PX / 2}px`,
      `top: ${screen.y - CONTROL_POINT_HIT_SIZE_PX / 2}px`,
      `width: ${CONTROL_POINT_HIT_SIZE_PX}px`,
      `height: ${CONTROL_POINT_HIT_SIZE_PX}px`,
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'box-sizing: border-box',
      'border: 0',
      'border-radius: var(--radius-full)',
      'background: transparent',
      'cursor: grab',
      'pointer-events: auto',
      'touch-action: none',
      'user-select: none',
    ].join(';')
    adapter.decorateHandle(handle, point, screen)

    const mark = document.createElement('span')
    mark.style.cssText = [
      `width: ${CONTROL_POINT_MARK_SIZE_PX}px`,
      `height: ${CONTROL_POINT_MARK_SIZE_PX}px`,
      'display: block',
      'border: 2px solid var(--color-surface)',
      'border-radius: var(--radius-full)',
      'background: var(--color-primary)',
      'box-sizing: border-box',
    ].join(';')
    handle.appendChild(mark)
    handle.addEventListener('pointerenter', () => {
      mark.style.transform = 'scale(1.35)'
    })
    handle.addEventListener('pointerleave', () => {
      mark.style.transform = ''
    })
    return handle
  }

  return {
    get dragActive() {
      return activeDrag !== null
    },
    refresh,
    hide,
    pointerDown,
    cancelActiveDrag,
    contains(target) {
      return target instanceof Node && root.contains(target)
    },
    dispose() {
      runCanvasRuntimeCleanups([
        () => cancelActiveDrag(),
        () => dragPresentation?.dispose(),
        () => root.remove(),
      ], 'Control Point Overlay disposal failed')
    },
  }
}

function screenDistance(a: ScenePoint, b: ScenePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}
