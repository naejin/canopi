import type { WorkspaceCameraFrameReader } from '../camera'
import type { CanvasDesignObjectSelectionModel } from '../runtime'
import type { ScenePoint, SceneStateReader, SceneZoneEntity } from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import {
  cloneZone,
  reshapableZone,
  reshapeZone,
  zoneControlPoints,
  zonesEqual,
  type ZoneControlPoint,
} from '../tools/select/reshape'
import {
  createControlPointOverlay,
  type ControlPointOverlayAdapter,
  type ControlPointOverlayController,
} from './control-point-overlay'

// The legacy bridge's zone control points (0B, until scene-interaction.ts goes): the geometry is Select's
// (tools/select/reshape.ts), which the ToolHost runs; the bridge holds these only while Select is unregistered.

interface ZoneControlPointOptions {
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

export type ZoneControlPointController = ControlPointOverlayController

export function createZoneControlPoints(
  options: ZoneControlPointOptions,
): ZoneControlPointController {
  const adapter: ControlPointOverlayAdapter<SceneZoneEntity, ZoneControlPoint> = {
    editType: 'interaction-zone-control-point',
    rootDataAttribute: 'zoneControlPoints',
    activeDataAttribute: 'zoneControlPointActive',
    getEligibleEntity: () => reshapableZone(options.getSceneStore().persisted, options.getSelection()),
    getEntityId: (zone) => zone.id,
    ownsControlPoint: (zone, point) => zone.id === point.zoneId,
    cloneEntity: cloneZone,
    createControlPoints: zoneControlPoints,
    reshape: reshapeZone,
    entitiesEqual: zonesEqual,
    writeDraft(draft, zoneId, nextZone) {
      draft.zones = draft.zones.map((zone) => zone.id === zoneId ? nextZone : zone)
    },
    decorateHandle(handle, point, screen) {
      handle.dataset.zoneControlPoint = point.id
      handle.dataset.zoneControlPointKind = point.kind
      handle.dataset.zoneControlPointIndex = String(point.index)
      handle.dataset.zoneControlPointScreenX = String(screen.x)
      handle.dataset.zoneControlPointScreenY = String(screen.y)
      handle.setAttribute('role', 'button')
      handle.setAttribute('aria-label', `Zone control point ${point.index + 1}`)
    },
  }

  return createControlPointOverlay(options, adapter)
}
