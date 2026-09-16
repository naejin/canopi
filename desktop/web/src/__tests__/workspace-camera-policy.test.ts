import { describe, expect, it } from 'vitest'
import { singleWorldEffectiveMinimumZoom } from '../canvas/workspace-camera-policy'

describe('workspace camera policy', () => {
  it('accounts for both viewport axes and Design bearing in the single-world minimum', () => {
    expect(singleWorldEffectiveMinimumZoom(1024, 400)).toBe(1)
    expect(singleWorldEffectiveMinimumZoom(400, 1024)).toBe(1)
    expect(singleWorldEffectiveMinimumZoom(1024, 400, 90)).toBeCloseTo(1)
    expect(singleWorldEffectiveMinimumZoom(1024, 800, 45)).toBeGreaterThan(1)
  })

  it('retains the configured minimum for invalid or smaller viewports', () => {
    expect(singleWorldEffectiveMinimumZoom(400, 300, 0, 0)).toBe(0)
    expect(singleWorldEffectiveMinimumZoom(Number.NaN, 300, 0, 2)).toBe(2)
  })
})
