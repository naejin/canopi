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
  const labelRotationRad = normalizeUprightLabelRotation(Math.atan2(screenDy, screenDx))
  const labelNormalScreen = {
    x: Math.sin(labelRotationRad),
    y: -Math.cos(labelRotationRad),
  }
  const midpointWorld = {
    x: (guide.start.x + guide.end.x) / 2,
    y: (guide.start.y + guide.end.y) / 2,
  }
  const midpointScreen = worldToScreen(midpointWorld, viewport)

  return {
    text: formatMetricDistance(lengthWorld),
    midpointWorld,
    labelScreenPoint: {
      x: midpointScreen.x + labelNormalScreen.x * MEASUREMENT_GUIDE_LABEL_OFFSET_PX,
      y: midpointScreen.y + labelNormalScreen.y * MEASUREMENT_GUIDE_LABEL_OFFSET_PX,
    },
    labelRotationRad,
    labelOffsetPx: MEASUREMENT_GUIDE_LABEL_OFFSET_PX,
    normalWorld,
    normalScreen,
    lengthWorld,
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
