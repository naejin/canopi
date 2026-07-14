import type { CameraController } from '../camera'
import { createMeasurementGuideDraftMeasurements } from '../measurement-guides'
import type { CanvasDesignObjectSelectionModel } from '../runtime'
import type { SceneMeasurementGuideEntity, ScenePoint, SceneStateReader } from '../scene'
import type { SceneEditCoordinator, SceneEditTransaction } from '../scene-runtime/transactions'
import { runCanvasRuntimeCleanups } from '../cleanup'
import type { SceneToolPointerDrag, SceneToolPointerEvent } from './tool-adapter'
import { createZoneMeasurementOverlay, type ZoneMeasurementOverlayController } from './zone-measurement-overlay'

interface MeasurementGuideControlPointOptions {
  readonly container: HTMLElement
  readonly camera: CameraController
  readonly getSceneStore: () => SceneStateReader
  readonly getSelection: () => CanvasDesignObjectSelectionModel
  readonly sceneEdits: SceneEditCoordinator
  readonly applySnapping: (point: ScenePoint) => ScenePoint
  readonly render: (kind: 'scene' | 'viewport') => void
  readonly refreshSelectionDependent: () => void
  readonly beginDragPresentation: () => void
  readonly endDragPresentation: () => void
}

export interface MeasurementGuideControlPointController {
  readonly dragActive: boolean
  refresh(enabled: boolean): void
  hide(): void
  pointerDown(context: MeasurementGuideControlPointPointerDownContext): SceneToolPointerDrag | null
  cancelActiveDrag(): boolean
  contains(target: EventTarget | null): boolean
  dispose(): void
}

interface MeasurementGuideControlPointPointerDownContext {
  readonly event: PointerEvent
  readonly rawWorld: ScenePoint
}

interface MeasurementGuideControlPoint {
  readonly id: string
  readonly guideId: string
  readonly index: 0 | 1
  readonly world: ScenePoint
}

interface ActiveMeasurementGuideControlPointDrag {
  readonly tx: SceneEditTransaction
  readonly guideId: string
  readonly controlPoint: MeasurementGuideControlPoint
  readonly startGuide: SceneMeasurementGuideEntity
  readonly startScreen: ScenePoint
  changed: boolean
  movedPastDragThreshold: boolean
}

const CONTROL_POINT_HIT_SIZE_PX = 20
const CONTROL_POINT_MARK_SIZE_PX = 8
const CONTROL_POINT_Z_INDEX = 29
const CONTROL_POINT_DRAG_THRESHOLD_PX = 2
const MIN_MEASUREMENT_GUIDE_LENGTH_M = 0.5

export function createMeasurementGuideControlPoints(
  options: MeasurementGuideControlPointOptions,
): MeasurementGuideControlPointController {
  const root = document.createElement('div')
  root.dataset.measurementGuideControlPoints = 'true'
  root.style.cssText = [
    'position: absolute',
    'inset: 0',
    `z-index: ${CONTROL_POINT_Z_INDEX}`,
    'display: none',
    'pointer-events: none',
  ].join(';')
  let measurements: ZoneMeasurementOverlayController
  try {
    options.container.appendChild(root)
    measurements = createZoneMeasurementOverlay(options.container)
  } catch (error) {
    root.remove()
    throw error
  }
  let activeDrag: ActiveMeasurementGuideControlPointDrag | null = null
  let controlPoints = new Map<string, MeasurementGuideControlPoint>()

  function refresh(enabled: boolean): void {
    if (!enabled) {
      hide()
      return
    }

    const guide = eligibleSelectedGuide()
    if (!guide) {
      hide()
      return
    }

    const nextControlPoints = createControlPointsForGuide(guide)
    controlPoints = new Map(nextControlPoints.map((point) => [point.id, point]))
    root.replaceChildren(...nextControlPoints.map(createControlPointElement))
    root.style.display = 'block'
  }

  function hide(): void {
    root.replaceChildren()
    controlPoints = new Map()
    root.style.display = 'none'
  }

  function pointerDown({ event, rawWorld }: MeasurementGuideControlPointPointerDownContext): SceneToolPointerDrag | null {
    if (event.button !== 0) return null
    const element = closestControlPointElement(event.target)
    const controlPoint = element ? controlPoints.get(element.dataset.measurementGuideControlPoint ?? '') : null
    if (!controlPoint) return null

    const guide = eligibleSelectedGuide()
    if (!guide || guide.id !== controlPoint.guideId) return null

    event.preventDefault()
    event.stopPropagation()
    activeDrag = {
      tx: options.sceneEdits.begin('interaction-measurement-guide-control-point'),
      guideId: guide.id,
      controlPoint,
      startGuide: cloneMeasurementGuide(guide),
      startScreen: options.camera.worldToScreen(rawWorld),
      changed: false,
      movedPastDragThreshold: false,
    }
    root.dataset.measurementGuideControlPointActive = 'true'
    options.beginDragPresentation()

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
      measurements.hide()
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
        delete root.dataset.measurementGuideControlPointActive
        finishDragPresentation()
      }
    }
  }

  function cancelActiveDrag(): boolean {
    const drag = activeDrag
    if (!drag) return false
    let transactionFinished = false
    try {
      drag.tx.abort()
      transactionFinished = true
    } finally {
      if (transactionFinished) {
        activeDrag = null
        delete root.dataset.measurementGuideControlPointActive
      }
      try {
        measurements.hide()
      } finally {
        try {
          options.render('scene')
        } finally {
          finishDragPresentation()
        }
      }
    }
    return true
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
    const nextGuide = reshapeMeasurementGuide(drag.startGuide, drag.controlPoint.index, snapped)
    if (!nextGuide) return
    drag.changed = drag.changed || !measurementGuidesEqual(drag.startGuide, nextGuide)
    drag.tx.mutate((draft) => {
      draft.measurementGuides = (draft.measurementGuides ?? []).map((guide) => (
        guide.id === drag.guideId ? nextGuide : guide
      ))
    })
    measurements.update(
      createMeasurementGuideDraftMeasurements(nextGuide.start, nextGuide.end),
      options.camera,
    )
    options.render('scene')
    options.refreshSelectionDependent()
  }

  function eligibleSelectedGuide(): SceneMeasurementGuideEntity | null {
    const selection = options.getSelection()
    if (
      selection.editableTargets.length !== 1
      || (selection.lockedTargets?.length ?? 0) > 0
      || selection.blockedTargets.length > 0
    ) return null
    const target = selection.editableTargets[0]
    if (target?.kind !== 'measurement-guide') return null
    return (options.getSceneStore().persisted.measurementGuides ?? [])
      .find((guide) => guide.id === target.id) ?? null
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
        () => measurements.dispose(),
        () => root.remove(),
      ], 'Measurement Guide Control Point disposal failed')
    },
  }

  function createControlPointElement(point: MeasurementGuideControlPoint): HTMLElement {
    const screen = options.camera.worldToScreen(point.world)
    const handle = document.createElement('div')
    handle.dataset.measurementGuideControlPoint = point.id
    handle.dataset.measurementGuideControlPointIndex = String(point.index)
    handle.dataset.measurementGuideControlPointScreenX = String(screen.x)
    handle.dataset.measurementGuideControlPointScreenY = String(screen.y)
    handle.setAttribute('role', 'button')
    handle.setAttribute('aria-label', `Measurement Guide endpoint ${point.index + 1}`)
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
}

function createControlPointsForGuide(guide: SceneMeasurementGuideEntity): MeasurementGuideControlPoint[] {
  return [
    {
      id: `${guide.id}:start`,
      guideId: guide.id,
      index: 0,
      world: guide.start,
    },
    {
      id: `${guide.id}:end`,
      guideId: guide.id,
      index: 1,
      world: guide.end,
    },
  ]
}

function reshapeMeasurementGuide(
  guide: SceneMeasurementGuideEntity,
  endpointIndex: 0 | 1,
  point: ScenePoint,
): SceneMeasurementGuideEntity | null {
  const nextGuide = endpointIndex === 0
    ? { ...guide, start: { ...point } }
    : { ...guide, end: { ...point } }
  if (measurementGuideLength(nextGuide) < MIN_MEASUREMENT_GUIDE_LENGTH_M) return null
  return nextGuide
}

function measurementGuideLength(guide: SceneMeasurementGuideEntity): number {
  return Math.hypot(guide.end.x - guide.start.x, guide.end.y - guide.start.y)
}

function measurementGuidesEqual(left: SceneMeasurementGuideEntity, right: SceneMeasurementGuideEntity): boolean {
  return left.start.x === right.start.x
    && left.start.y === right.start.y
    && left.end.x === right.end.x
    && left.end.y === right.end.y
}

function cloneMeasurementGuide(guide: SceneMeasurementGuideEntity): SceneMeasurementGuideEntity {
  return {
    ...guide,
    start: { ...guide.start },
    end: { ...guide.end },
  }
}

function screenDistance(a: ScenePoint, b: ScenePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function closestControlPointElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest<HTMLElement>('[data-measurement-guide-control-point]')
}
