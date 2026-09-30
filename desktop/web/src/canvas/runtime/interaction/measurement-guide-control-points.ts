import type { WorkspaceCameraFrameReader } from '../camera'
import { createMeasurementGuideDraftMeasurements } from '../measurement-guides'
import type { CanvasDesignObjectSelectionModel } from '../runtime'
import type { SceneMeasurementGuideEntity, ScenePoint, SceneStateReader } from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import {
  createControlPointOverlay,
  type ControlPointOverlayAdapter,
  type ControlPointOverlayController,
} from './control-point-overlay'
import { createZoneMeasurementOverlay } from './zone-measurement-overlay'
import {
  cloneMeasurementGuide,
  draggableGuide,
  guideEnds,
  measurementGuidesEqual,
  reshapeMeasurementGuide,
  type GuideEnd,
} from '../tools/select/guide-ends'

// The legacy bridge's guide end points (0B, until scene-interaction.ts goes): the geometry is Select's
// (tools/select/guide-ends.ts), which the ToolHost runs; the bridge holds these only while Select is unregistered.

interface MeasurementGuideControlPointOptions {
  readonly container: HTMLElement
  readonly camera: WorkspaceCameraFrameReader
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

export function createMeasurementGuideControlPoints(
  options: MeasurementGuideControlPointOptions,
): MeasurementGuideControlPointController {
  const adapter: ControlPointOverlayAdapter<
    SceneMeasurementGuideEntity,
    GuideEnd
  > = {
    editType: 'interaction-measurement-guide-control-point',
    rootDataAttribute: 'measurementGuideControlPoints',
    activeDataAttribute: 'measurementGuideControlPointActive',
    getEligibleEntity: () => draggableGuide(options.getSceneStore().persisted, options.getSelection()),
    getEntityId: (guide) => guide.id,
    ownsControlPoint: (guide, point) => guide.id === point.guideId,
    cloneEntity: cloneMeasurementGuide,
    createControlPoints: guideEnds,
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
}
