// maplibre/view-agreement.ts  (development and test builds only)
//
// Owns the check that the analytic ViewTransform agrees with MapLibre's own projection (ADR 0016): the only caller of
// map.unproject in the workspace, and never a source of the transform. The MapLibre camera driver loads it through a dynamic
// import inside `if (import.meta.env.DEV)`, so production bundles drop it (P12); tests import it directly.

import type { SessionPlane } from '../canvas/session-plane'
import type { ViewTransform } from '../canvas/runtime/view/types'
import type { MapLibreMapInstance } from './loader'
import { logMapError } from './redact-credentials'

/** ADR 0016: the transform and MapLibre agree within this many CSS px. */
export const VIEW_AGREEMENT_TOLERANCE_PX = 0.01
const PROBE_FRACTIONS = [0.25, 0.75] as const

/**
 * Dev and test builds: unproject the four points at 25 %/75 % of width and height, map them
 * through the built transform, and report the maximum screen error. Above 0.01 px it logs a
 * diagnostic (throws in tests). Never a source of the transform.
 */
export function assertViewAgreement(map: Pick<MapLibreMapInstance, 'unproject'>, view: ViewTransform, plane: SessionPlane):
  { readonly maxErrorPx: number } {
  const unproject = map.unproject
  if (!unproject) throw new Error('The view agreement probe needs map.unproject.')
  const { width, height } = view.screen
  let maxErrorPx = 0
  for (const across of PROBE_FRACTIONS) {
    for (const down of PROBE_FRACTIONS) {
      const probe = { x: width * across, y: height * down }
      const ground = unproject.call(map, [probe.x, probe.y])
      const onScreen = view.worldToScreen(plane.toPlane({ lon: ground.lng, lat: ground.lat }))
      const errorPx = Math.hypot(onScreen.x - probe.x, onScreen.y - probe.y)
      // NaN never passes: a probe that cannot be compared is a disagreement.
      maxErrorPx = errorPx > maxErrorPx || Number.isNaN(errorPx) ? errorPx : maxErrorPx
    }
  }
  if (!(maxErrorPx <= VIEW_AGREEMENT_TOLERANCE_PX)) {
    const message = `The view transform does not agree with MapLibre: ${maxErrorPx.toFixed(4)} px at revision ${view.revision} `
      + `(zoom ${view.camera.zoom}, bearing ${view.camera.bearingDeg}°, tolerance ${VIEW_AGREEMENT_TOLERANCE_PX} px).`
    if (import.meta.env.MODE === 'test') throw new Error(message)
    logMapError(message)
  }
  return { maxErrorPx }
}
