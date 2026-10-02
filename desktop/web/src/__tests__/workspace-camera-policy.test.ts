import { describe, expect, it } from 'vitest'
import { mapZoomToStageScale, stageScaleToMapZoom } from '../canvas/projection'
import {
  createWorkspaceCameraPolicy,
  isWorkspaceOverviewScale,
  singleWorldEffectiveMinimumZoom,
} from '../canvas/workspace-camera-policy'

describe('workspace camera policy', () => {
  it('uses the larger viewport axis in the single-world minimum', () => {
    expect(singleWorldEffectiveMinimumZoom(1024, 400)).toBe(1)
    expect(singleWorldEffectiveMinimumZoom(400, 1024)).toBe(1)
    expect(singleWorldEffectiveMinimumZoom(2048, 800)).toBe(2)
  })

  it('retains the configured minimum for invalid or smaller viewports', () => {
    expect(singleWorldEffectiveMinimumZoom(400, 300, 0)).toBe(0)
    expect(singleWorldEffectiveMinimumZoom(Number.NaN, 300, 2)).toBe(2)
  })

  it('a scale placed at exactly the overview threshold is not overview, though it reads back a hair under', () => {
    const policy = createWorkspaceCameraPolicy()
    const readBack = mapZoomToStageScale(stageScaleToMapZoom(policy.overviewScaleThreshold, 52.52), 52.52)
    expect(readBack).toBeLessThan(policy.overviewScaleThreshold)
    expect(isWorkspaceOverviewScale(readBack, policy)).toBe(false)
    expect(isWorkspaceOverviewScale(policy.overviewScaleThreshold * 0.999, policy)).toBe(true)
    expect(isWorkspaceOverviewScale(Number.NaN, policy)).toBe(false)
  })
})
