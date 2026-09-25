import { describe, expect, it } from 'vitest'
import { singleWorldEffectiveMinimumZoom } from '../canvas/workspace-camera-policy'

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
})
