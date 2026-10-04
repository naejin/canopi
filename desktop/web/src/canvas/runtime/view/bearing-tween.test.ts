import { describe, expect, it } from 'vitest'
import { geoToScreen, panCamera, screenToGeo } from './camera-math'
import { startBearingTween } from './bearing-tween'
import type { ViewCamera, ViewScreen } from './types'

const SCREEN: ViewScreen = { width: 800, height: 600, devicePixelRatio: 1 }
const START: ViewCamera = { center: { lon: 2.35, lat: 48.85 }, zoom: 18, bearingDeg: 350, pitchDeg: 0 }

describe('bearing tween', () => {
  it('completes at the target', () => {
    const tween = startBearingTween(START, { bearingDeg: 20, anchorPx: 'centre', durationMs: 300 }, 1000)
    expect(tween.targetBearingDeg).toBe(20)
    expect(tween.anchorPx).toBe('centre')

    const first = tween.step(START, SCREEN, 1000)
    expect(first).toEqual({ camera: START, done: false })
    const middle = tween.step(first.camera, SCREEN, 1150)
    // Ease-out cubic along the shortest arc: 350 → 20 runs through north.
    expect(middle.camera.bearingDeg).toBeCloseTo(350 + 30 * (1 - 0.5 ** 3) - 360, 9)
    expect(middle.done).toBe(false)
    const last = tween.step(middle.camera, SCREEN, 1300)
    expect(last.done).toBe(true)
    expect(last.camera).toEqual({ ...START, bearingDeg: 20 })
    expect(last.camera.center).toBe(START.center)

    const instant = startBearingTween(START, { bearingDeg: 90, anchorPx: { x: 10, y: 10 }, durationMs: 0 }, 5)
    expect(instant.step(START, SCREEN, 5).done).toBe(true)
  })

  it('keeps the ground under its anchor', () => {
    const anchor = { x: 120, y: 450 }
    const ground = screenToGeo(START, SCREEN, anchor)
    const tween = startBearingTween(START, { bearingDeg: 300, anchorPx: anchor, durationMs: 300 }, 0)
    let live = START
    for (const now of [50, 120, 300]) {
      live = tween.step(live, SCREEN, now).camera
      const screen = geoToScreen(live, SCREEN, ground)
      expect(screen.x).toBeCloseTo(anchor.x, 6)
      expect(screen.y).toBeCloseTo(anchor.y, 6)
    }
    expect(live.bearingDeg).toBe(300)
  })

  it('composes with a pan', () => {
    const tween = startBearingTween(START, { bearingDeg: 20, anchorPx: 'centre', durationMs: 300 }, 0)
    const middle = tween.step(START, SCREEN, 100).camera
    const panned = panCamera(middle, SCREEN, { x: 40, y: -25 })

    const next = tween.step(panned, SCREEN, 200).camera
    const last = tween.step(next, SCREEN, 300).camera

    expect(next.center).toBe(panned.center)
    expect(last.center).toBe(panned.center)
    expect(last.bearingDeg).toBe(20)
  })
})
