// canvas/runtime/view/bearing-tween.ts  (pure step function; the clock is injected)
//
// Owns the driver-run eases (ADR 0016: key turns, resets, snaps to north, eases to a camera): ease-out cubic along the shortest
// arc to an absolute bearing about an anchor, plus, for a 'set'/'ease' move, the centre and zoom eased towards their targets. Each
// step starts from the LIVE camera, so a pan or zoom made during the tween composes with it instead of cancelling it. The driver
// constrains every step at its bearing.

import { geoToMercator, mercatorToGeo } from '../../projection'
import { rotateCameraAround } from './camera-math'
import { normaliseBearing, shortestArc } from './navigation-policy'
import type { GeoPoint, ScreenPoint, ViewCamera, ViewScreen } from './types'

export interface BearingTween {
  readonly targetBearingDeg: number
  readonly anchorPx: ScreenPoint | 'centre'
  /** The camera for time t, computed from the LIVE camera (so pans and zooms during the tween compose). */
  step(live: ViewCamera, screen: ViewScreen, nowMs: number): { readonly camera: ViewCamera; readonly done: boolean }
}

/**
 * The centre moves by the eased share of the way from `from` to `centerTarget` since the previous step (in Mercator), and the
 * zoom likewise; so a pan or zoom made between steps is kept, and an undisturbed tween ends exactly on its targets.
 */
export function startBearingTween(from: ViewCamera, move: { readonly bearingDeg: number; readonly anchorPx: ScreenPoint | 'centre'; readonly durationMs: number; readonly centerTarget?: GeoPoint; readonly zoomTarget?: number }, nowMs: number): BearingTween {
  const startMs = nowMs
  const durationMs = Math.max(0, move.durationMs)
  const startBearing = from.bearingDeg
  const arc = shortestArc(from.bearingDeg, move.bearingDeg)
  const targetBearingDeg = normaliseBearing(move.bearingDeg)
  const centreFrom = geoToMercator(from.center.lon, from.center.lat)
  const centreTo = move.centerTarget ? geoToMercator(move.centerTarget.lon, move.centerTarget.lat) : null
  const { zoomTarget, centerTarget } = move
  let previous = { camera: from, eased: 0 }

  return {
    targetBearingDeg,
    anchorPx: move.anchorPx,
    step(live, screen, stepMs) {
      const progress = durationMs > 0 ? Math.min(1, Math.max(0, (stepMs - startMs) / durationMs)) : 1
      const done = progress >= 1
      const eased = done ? 1 : 1 - (1 - progress) ** 3

      let center = live.center
      let zoom = live.zoom
      if (centreTo || zoomTarget !== undefined) {
        const undisturbed = live.center.lon === previous.camera.center.lon
          && live.center.lat === previous.camera.center.lat
          && live.zoom === previous.camera.zoom
        if (done && undisturbed) {
          center = centerTarget ?? live.center
          zoom = zoomTarget ?? live.zoom
        } else {
          const share = eased - previous.eased
          if (centreTo) {
            const liveCentre = geoToMercator(live.center.lon, live.center.lat)
            const { lng, lat } = mercatorToGeo(
              liveCentre.x + (centreTo.x - centreFrom.x) * share,
              liveCentre.y + (centreTo.y - centreFrom.y) * share,
            )
            center = { lon: lng, lat }
          }
          if (zoomTarget !== undefined) zoom = live.zoom + (zoomTarget - from.zoom) * share
        }
      }

      const bearing = done ? targetBearingDeg : normaliseBearing(startBearing + arc * eased)
      const moved = center === live.center && zoom === live.zoom
        ? live
        : { center, zoom, bearingDeg: live.bearingDeg, pitchDeg: 0 as const }
      const camera = rotateCameraAround(moved, screen, move.anchorPx, bearing)
      previous = { camera, eased }
      return { camera, done }
    },
  }
}
