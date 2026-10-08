// app/lidar/profile.ts
//
// Owns the Site data profile (canopi-f47t.42, spec §1.10 "Profile"; stream D builds it): the curves of every shown, ready
// elevation or height item along the finished line, sampled through `sampler.ts`, their statistics and the copied text.
// The line itself lives in `site-transients.ts`, which ends it. Commit 0 builds the hand-off from the Profile tool.

import { computed, signal, type ReadonlySignal } from '@preact/signals'
import { currentCanvasQuerySurface } from '../../canvas/session'
import { profileLine, setProfileLine, type GeoPoint } from './site-transients'

const hover = signal<GeoPoint | null>(null)

/**
 * The ground point under the chart's cursor while it is hovered or scrubbed, which the map draws as a hollow ring on the
 * line (chart to map only); null without a profile. It never rides the overlay snapshot: the Desktop map adapter's
 * `readSiteHover` feeds it to one setData.
 */
export const profileHover: ReadonlySignal<GeoPoint | null> = computed(() => profileLine.value ? hover.value : null)

/** The chart's cursor, as a ground point on the line, or null when the pointer leaves the chart. */
export function setProfileHover(point: GeoPoint | null): void {
  hover.value = point
}

/**
 * The profile hand-off (CanvasRuntimeAppAdapter.finishProfile): the Profile tool's finished line, in session-plane
 * metres, becomes the Site data profile line in WGS84; a new line replaces the old.
 */
export function finishSiteProfile(points: readonly { readonly x: number; readonly y: number }[]): void {
  const plane = currentCanvasQuerySurface.peek()?.sessionPlane.peek()
  if (plane) setProfileLine(points.map((point) => plane.toGeo(point)))
}
