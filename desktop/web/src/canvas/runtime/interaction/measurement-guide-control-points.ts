import type { CameraController } from '../camera'
import { createMeasurementGuideDraftMeasurements } from '../measurement-guides'
import type { CanvasDesignObjectSelectionModel } from '../runtime'
import type { SceneMeasurementGuideEntity, ScenePoint, SceneStateReader } from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import {
  createControlPointOverlay,
  type ControlPointOverlayAdapter,
  type ControlPointOverlayController,
  type ControlPointOverlayPoint,
} from './control-point-overlay'
import { createZoneMeasurementOverlay } from './zone-measurement-overlay'

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

export type MeasurementGuideControlPointController = ControlPointOverlayController

interface MeasurementGuideControlPoint extends ControlPointOverlayPoint {
  readonly guideId: string
  readonly index: 0 | 1
}

const MIN_MEASUREMENT_GUIDE_LENGTH_M = 0.5

export function createMeasurementGuideControlPoints(
  options: MeasurementGuideControlPointOptions,
): MeasurementGuideControlPointController {
  const adapter: ControlPointOverlayAdapter<
    SceneMeasurementGuideEntity,
    MeasurementGuideControlPoint
  > = {
    editType: 'interaction-measurement-guide-control-point',
    rootDataAttribute: 'measurementGuideControlPoints',
    activeDataAttribute: 'measurementGuideControlPointActive',
    getEligibleEntity: eligibleSelectedGuide,
    getEntityId: (guide) => guide.id,
    ownsControlPoint: (guide, point) => guide.id === point.guideId,
    cloneEntity: cloneMeasurementGuide,
    createControlPoints: createControlPointsForGuide,
    reshape: (guide, point, dragged) => reshapeMeasurementGuide(guide, point.index, dragged),
    entitiesEqual: measurementGuidesEqual,
    writeDraft(draft, guideId, nextGuide) {
      draft.measurementGuides = draft.measurementGuides.map((guide) => (
        guide.id === guideId ? nextGuide : guide
      ))
    },
    decorateHandle(handle, point, screen) {
      handle.dataset.measurementGuideControlPoint = point.id
      handle.dataset.measurementGuideControlPointIndex = String(point.index)
      handle.dataset.measurementGuideControlPointScreenX = String(screen.x)
      handle.dataset.measurementGuideControlPointScreenY = String(screen.y)
      handle.setAttribute('role', 'button')
      handle.setAttribute('aria-label', `Measurement Guide endpoint ${point.index + 1}`)
    },
    createDragPresentation() {
      const measurements = createZoneMeasurementOverlay(options.container)
      return {
        update(guide) {
          measurements.update(
            createMeasurementGuideDraftMeasurements(guide.start, guide.end),
            options.camera,
          )
        },
        hide: () => measurements.hide(),
        dispose: () => measurements.dispose(),
      }
    },
  }

  return createControlPointOverlay(options, adapter)

  function eligibleSelectedGuide(): SceneMeasurementGuideEntity | null {
    const selection = options.getSelection()
    if (
      selection.editableTargets.length !== 1
      || (selection.lockedTargets?.length ?? 0) > 0
      || selection.blockedTargets.length > 0
    ) return null
    const target = selection.editableTargets[0]
    if (target?.kind !== 'measurement-guide') return null
    return options.getSceneStore().persisted.measurementGuides
      .find((guide) => guide.id === target.id) ?? null
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
