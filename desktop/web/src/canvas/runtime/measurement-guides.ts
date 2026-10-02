import { worldToScreen } from './annotation-layout'
import type { SceneMeasurementGuideEntity, ScenePoint, SceneViewportState } from './scene'
import { formatMetricDistance, type ZoneMeasurementLabel } from './zone-measurements'

export const MEASUREMENT_GUIDE_DASH_PX = 6
export const MEASUREMENT_GUIDE_GAP_PX = 4
export const MEASUREMENT_GUIDE_TICK_HALF_PX = 5
export const MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX = 11
export const MEASUREMENT_GUIDE_LABEL_CLEARANCE_PX = 4
export const MEASUREMENT_GUIDE_LABEL_OFFSET_PX =
  MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX / 2 + MEASUREMENT_GUIDE_LABEL_CLEARANCE_PX

export interface MeasurementGuidePresentation {
  readonly text: string
  readonly midpointWorld: ScenePoint
  readonly labelScreenPoint: ScenePoint
  readonly labelRotationRad: number
  readonly labelOffsetPx: number
  readonly normalWorld: ScenePoint
  readonly normalScreen: ScenePoint
  readonly lengthWorld: number
}

export function createMeasurementGuidePresentation(
  guide: SceneMeasurementGuideEntity,
  viewport: SceneViewportState,
): MeasurementGuidePresentation | null {
  const dx = guide.end.x - guide.start.x
  const dy = guide.end.y - guide.start.y
  const lengthWorld = Math.hypot(dx, dy)
  if (lengthWorld < 0.5) return null

  const normalWorld = {
    x: dy / lengthWorld,
    y: -dx / lengthWorld,
  }
  const screenStart = worldToScreen(guide.start, viewport)
  const screenEnd = worldToScreen(guide.end, viewport)
  const screenDx = screenEnd.x - screenStart.x
  const screenDy = screenEnd.y - screenStart.y
  const screenLength = Math.max(Math.hypot(screenDx, screenDy), 0.001)
  const normalScreen = {
    x: screenDy / screenLength,
    y: -screenDx / screenLength,
  }
  const midpointWorld = {
    x: (guide.start.x + guide.end.x) / 2,
    y: (guide.start.y + guide.end.y) / 2,
  }
  const label = measurementGuideLabelPose(screenStart, screenEnd, worldToScreen(midpointWorld, viewport))

  return {
    text: formatMetricDistance(lengthWorld),
    midpointWorld,
    labelScreenPoint: label.point,
    labelRotationRad: label.rotationRad,
    labelOffsetPx: MEASUREMENT_GUIDE_LABEL_OFFSET_PX,
    normalWorld,
    normalScreen,
    lengthWorld,
  }
}

/**
 * A guide's label from the guide's projected ends and midpoint, in any view: parallel to the guide, turned to read
 * upright, and offset to the side the upright text faces.
 */
export function measurementGuideLabelPose(
  screenStart: ScenePoint,
  screenEnd: ScenePoint,
  screenMidpoint: ScenePoint,
): { readonly point: ScenePoint; readonly rotationRad: number } {
  const rotationRad = normalizeUprightLabelRotation(Math.atan2(screenEnd.y - screenStart.y, screenEnd.x - screenStart.x))
  return {
    point: {
      x: screenMidpoint.x + Math.sin(rotationRad) * MEASUREMENT_GUIDE_LABEL_OFFSET_PX,
      y: screenMidpoint.y - Math.cos(rotationRad) * MEASUREMENT_GUIDE_LABEL_OFFSET_PX,
    },
    rotationRad,
  }
}

function normalizeUprightLabelRotation(angleRad: number): number {
  if (angleRad > Math.PI / 2) return angleRad - Math.PI
  if (angleRad < -Math.PI / 2) return angleRad + Math.PI
  return angleRad
}

export function createMeasurementGuideDraftMeasurements(
  start: ScenePoint,
  end: ScenePoint,
): ZoneMeasurementLabel[] {
  const lengthWorld = Math.hypot(end.x - start.x, end.y - start.y)
  if (lengthWorld < 0.5) return []

  return [{
    id: 'measurement-guide-length',
    kind: 'dimension',
    text: formatMetricDistance(lengthWorld),
    worldPosition: {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    },
  }]
}
