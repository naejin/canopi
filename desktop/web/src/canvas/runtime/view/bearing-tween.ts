// canvas/runtime/view/bearing-tween.ts  (pure step function; the clock is injected)
//
// Owns the driver-run eases (ADR 0016: key turns, resets, snaps to north): ease-out cubic along the shortest arc to an
// absolute bearing about an anchor. Each step starts from the LIVE camera, so a pan or zoom made during the tween composes
// with it instead of cancelling it. The driver constrains every step at its bearing.

import { rotateCameraAround } from './camera-math'
import { normaliseBearing, shortestArc } from './navigation-policy'
import type { ScreenPoint, ViewCamera, ViewScreen } from './types'

export interface BearingTween {
  readonly targetBearingDeg: number
  readonly anchorPx: ScreenPoint | 'centre'
  /** The camera for time t, computed from the LIVE camera (so pans and zooms during the tween compose). */
  step(live: ViewCamera, screen: ViewScreen, nowMs: number): { readonly camera: ViewCamera; readonly done: boolean }
}

export function startBearingTween(from: ViewCamera, move: { readonly bearingDeg: number; readonly anchorPx: ScreenPoint | 'centre'; readonly durationMs: number }, nowMs: number): BearingTween {
  const startMs = nowMs
  const durationMs = Math.max(0, move.durationMs)
  const startBearing = from.bearingDeg
  const arc = shortestArc(from.bearingDeg, move.bearingDeg)
  const targetBearingDeg = normaliseBearing(move.bearingDeg)

  return {
    targetBearingDeg,
    anchorPx: move.anchorPx,
    step(live, screen, stepMs) {
      const progress = durationMs > 0 ? Math.min(1, Math.max(0, (stepMs - startMs) / durationMs)) : 1
      const done = progress >= 1
      const eased = done ? 1 : 1 - (1 - progress) ** 3
      const bearing = done ? targetBearingDeg : normaliseBearing(startBearing + arc * eased)
      const camera = rotateCameraAround(live, screen, move.anchorPx, bearing)
      return { camera, done }
    },
  }
}
