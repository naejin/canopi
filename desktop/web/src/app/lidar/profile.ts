// app/lidar/profile.ts
//
// Owns the Site data profile (canopi-f47t.42, spec §1.10 "Profile"; stream D builds it): the curves of every shown, ready
// elevation or height item along the finished line, sampled through `sampler.ts`, their statistics and the copied text.
// The line itself lives in `site-transients.ts`, which ends it. Commit 0 builds the hand-off from the Profile tool.

import { currentCanvasQuerySurface } from '../../canvas/session'
import { setProfileLine } from './site-transients'

/**
 * The profile hand-off (CanvasRuntimeAppAdapter.finishProfile): the Profile tool's finished line, in session-plane
 * metres, becomes the Site data profile line in WGS84; a new line replaces the old.
 */
export function finishSiteProfile(points: readonly { readonly x: number; readonly y: number }[]): void {
  const plane = currentCanvasQuerySurface.peek()?.sessionPlane.peek()
  if (plane) setProfileLine(points.map((point) => plane.toGeo(point)))
}
