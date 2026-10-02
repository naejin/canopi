import { describe, expect, it } from 'vitest'

import { createTestView } from '../../__tests__/support/test-view'
import {
  createMeasurementGuidePresentation,
  MEASUREMENT_GUIDE_LABEL_CLEARANCE_PX,
  MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX,
  MEASUREMENT_GUIDE_LABEL_OFFSET_PX,
  measurementGuideLabelPoseIn,
} from './measurement-guides'
import type { SceneMeasurementGuideEntity, ScenePoint } from './scene'

describe('createMeasurementGuidePresentation', () => {
  it('places labels centered, parallel, upright, and clear of the guide line', () => {
    const expectedCenterOffset = MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX / 2 + MEASUREMENT_GUIDE_LABEL_CLEARANCE_PX
    expect(MEASUREMENT_GUIDE_LABEL_OFFSET_PX).toBe(expectedCenterOffset)

    const cases: Array<{
      name: string
      start: ScenePoint
      end: ScenePoint
      midpointWorld: ScenePoint
      rotationRad: number
      labelScreenPoint: ScenePoint
    }> = [
      {
        name: 'horizontal',
        start: { x: 0, y: 0 },
        end: { x: 40, y: 0 },
        midpointWorld: { x: 20, y: 0 },
        rotationRad: 0,
        labelScreenPoint: { x: 20, y: -expectedCenterOffset },
      },
      {
        name: 'vertical',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 40 },
        midpointWorld: { x: 0, y: 20 },
        rotationRad: Math.PI / 2,
        labelScreenPoint: { x: expectedCenterOffset, y: 20 },
      },
      {
        name: 'diagonal',
        start: { x: 0, y: 0 },
        end: { x: 40, y: 40 },
        midpointWorld: { x: 20, y: 20 },
        rotationRad: Math.PI / 4,
        labelScreenPoint: {
          x: 20 + Math.SQRT1_2 * expectedCenterOffset,
          y: 20 - Math.SQRT1_2 * expectedCenterOffset,
        },
      },
      {
        name: 'reversed-angle',
        start: { x: 40, y: 0 },
        end: { x: 0, y: 40 },
        midpointWorld: { x: 20, y: 20 },
        rotationRad: -Math.PI / 4,
        labelScreenPoint: {
          x: 20 - Math.SQRT1_2 * expectedCenterOffset,
          y: 20 - Math.SQRT1_2 * expectedCenterOffset,
        },
      },
    ]

    // The label positions come from the frame: a bearing-0 view at 1 px/m with the plane origin at the screen origin.
    const view = createTestView({ viewport: { x: 0, y: 0, scale: 1 } })
    for (const testCase of cases) {
      const guide = measurementGuide(testCase.start, testCase.end)
      const presentation = createMeasurementGuidePresentation(guide)
      const label = measurementGuideLabelPoseIn(guide, view.view())
      expect(presentation, testCase.name).not.toBeNull()
      expect(presentation?.midpointWorld.x, testCase.name).toBeCloseTo(testCase.midpointWorld.x)
      expect(presentation?.midpointWorld.y, testCase.name).toBeCloseTo(testCase.midpointWorld.y)
      expect(label.rotationRad, testCase.name).toBeCloseTo(testCase.rotationRad)
      expect(Math.abs(label.rotationRad), testCase.name).toBeLessThanOrEqual(Math.PI / 2)
      expect(label.point.x, testCase.name).toBeCloseTo(testCase.labelScreenPoint.x)
      expect(label.point.y, testCase.name).toBeCloseTo(testCase.labelScreenPoint.y)

      const labelDelta = Math.hypot(
        label.point.x - testCase.midpointWorld.x,
        label.point.y - testCase.midpointWorld.y,
      )
      expect(labelDelta, testCase.name).toBeCloseTo(MEASUREMENT_GUIDE_LABEL_OFFSET_PX)
    }
    view.dispose()
  })
})

function measurementGuide(start: ScenePoint, end: ScenePoint): SceneMeasurementGuideEntity {
  return {
    kind: 'measurement-guide',
    id: 'guide-1',
    locked: false,
    start,
    end,
  }
}
