import { describe, expect, it, vi } from 'vitest'
import { deriveV2SharedMapSceneViewport } from '../experiments/v2-shared-map-scene/camera-transform'

const anchor = { lat: 0, lon: 0 }

function pinnedProject(points: readonly { x: number; y: number }[]) {
  let index = 0
  return vi.fn(() => points[index++ % points.length]!)
}

describe('deriveV2SharedMapSceneViewport', () => {
  it('derives the existing viewport from pinned MapLibre CSS-pixel points', () => {
    const result = deriveV2SharedMapSceneViewport({
      project: pinnedProject([{ x: 120, y: 80 }, { x: 124, y: 80 }, { x: 120, y: 84 }]),
      anchor,
      northBearingDeg: 0,
      pitchDeg: 0,
    })

    expect(result).toEqual({
      accepted: true,
      viewport: { x: 120, y: 80, scale: 4 },
      axisResidualPx: 0,
      maximumScreenResidualPx: 0,
    })
  })

  it('refuses pitch and non-affine local axes', () => {
    const pitched = deriveV2SharedMapSceneViewport({
      project: pinnedProject([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }]),
      anchor,
      northBearingDeg: 0,
      pitchDeg: 1,
    })
    const skewed = deriveV2SharedMapSceneViewport({
      project: pinnedProject([{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 2 }]),
      anchor,
      northBearingDeg: 0,
      pitchDeg: 0,
    })

    expect(pitched).toEqual({ accepted: false, reason: 'pitched-camera' })
    expect(skewed).toEqual({ accepted: false, reason: 'rotated-or-skewed-axes' })
  })

  it('uses CSS pixels, so device-pixel ratio cannot change the viewport', () => {
    const points = [{ x: 12, y: 25 }, { x: 15, y: 25 }, { x: 12, y: 28 }] as const
    const atOne = deriveV2SharedMapSceneViewport({ project: pinnedProject(points), anchor, northBearingDeg: 0, pitchDeg: 0 })
    const atTwo = deriveV2SharedMapSceneViewport({ project: pinnedProject(points), anchor, northBearingDeg: 0, pitchDeg: 0 })

    expect(atTwo).toEqual(atOne)
  })

  it('tracks pinned pan and zoom projection changes', () => {
    const before = deriveV2SharedMapSceneViewport({
      project: pinnedProject([{ x: 10, y: 20 }, { x: 12, y: 20 }, { x: 10, y: 22 }]),
      anchor,
      northBearingDeg: 0,
      pitchDeg: 0,
    })
    const after = deriveV2SharedMapSceneViewport({
      project: pinnedProject([{ x: 40, y: 60 }, { x: 46, y: 60 }, { x: 40, y: 66 }]),
      anchor,
      northBearingDeg: 0,
      pitchDeg: 0,
    })

    expect(before).toMatchObject({ accepted: true, viewport: { x: 10, y: 20, scale: 2 } })
    expect(after).toMatchObject({ accepted: true, viewport: { x: 40, y: 60, scale: 6 } })
  })

  it('bounds the discarded affine residual over the qualified local extent', () => {
    const accepted = deriveV2SharedMapSceneViewport({
      project: pinnedProject([{ x: 0, y: 0 }, { x: 2, y: 0.00001 }, { x: 0, y: 2 }]),
      anchor,
      northBearingDeg: 0,
      pitchDeg: 0,
      maximumWorldExtentMeters: 10_000,
    })
    const refused = deriveV2SharedMapSceneViewport({
      project: pinnedProject([{ x: 0, y: 0 }, { x: 2, y: 0.00011 }, { x: 0, y: 2 }]),
      anchor,
      northBearingDeg: 0,
      pitchDeg: 0,
      maximumWorldExtentMeters: 10_000,
    })

    expect(accepted.accepted && accepted.maximumScreenResidualPx).toBeCloseTo(0.1, 6)
    expect(refused).toEqual({ accepted: false, reason: 'rotated-or-skewed-axes' })
  })
})
