import { describe, expect, it } from 'vitest'

import {
  createMeasurementGuidePresentation,
  MEASUREMENT_GUIDE_LABEL_CLEARANCE_PX,
  MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX,
  MEASUREMENT_GUIDE_LABEL_OFFSET_PX,
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

    for (const testCase of cases) {
      const presentation = createMeasurementGuidePresentation(measurementGuide(testCase.start, testCase.end), {
        x: 0,
        y: 0,
        scale: 1,
      })
      expect(presentation, testCase.name).not.toBeNull()
      expect(presentation?.midpointWorld.x, testCase.name).toBeCloseTo(testCase.midpointWorld.x)
      expect(presentation?.midpointWorld.y, testCase.name).toBeCloseTo(testCase.midpointWorld.y)
      expect(presentation?.labelRotationRad, testCase.name).toBeCloseTo(testCase.rotationRad)
      expect(Math.abs(presentation?.labelRotationRad ?? Number.POSITIVE_INFINITY), testCase.name)
        .toBeLessThanOrEqual(Math.PI / 2)
      expect(presentation?.labelScreenPoint.x, testCase.name).toBeCloseTo(testCase.labelScreenPoint.x)
      expect(presentation?.labelScreenPoint.y, testCase.name).toBeCloseTo(testCase.labelScreenPoint.y)

      const labelDelta = Math.hypot(
        (presentation?.labelScreenPoint.x ?? 0) - testCase.midpointWorld.x,
        (presentation?.labelScreenPoint.y ?? 0) - testCase.midpointWorld.y,
      )
      expect(labelDelta, testCase.name).toBeCloseTo(MEASUREMENT_GUIDE_LABEL_OFFSET_PX)
    }
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
