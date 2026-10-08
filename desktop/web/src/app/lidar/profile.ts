// app/lidar/profile.ts
//
// Owns the Site data profile (canopi-f47t.42, spec §1.10 "Profile"; stream D builds it): the curves of every shown, ready
// elevation or height item along the finished line, sampled through `sampler.ts`, their statistics and the copied text.
// The line itself lives in `site-transients.ts`, which ends it. Commit 0 builds the hand-off from the Profile tool.

import { computed, signal, type ReadonlySignal } from '@preact/signals'
import { currentCanvasQuerySurface } from '../../canvas/session'
import { armCanvasTool } from '../keyboard/arming'
import { selectPanel, sidePanel } from '../shell/state'
import { profileRole } from './item-types'
import { readCurrentLidarPresentation } from './library-store'
import { profileLine, setProfileLine, type GeoPoint } from './site-transients'

/**
 * Whether Profile can be armed: some shown, ready elevation or height item (U49 Q31); otherwise the Site data toolbar's
 * Profile and the palette command are disabled with "Show an elevation or height layer to draw a profile".
 */
export const profileAvailable: ReadonlySignal<boolean> = computed(() => readCurrentLidarPresentation().some((item) =>
  item.shown && item.availability === 'present' && item.state === 'Ready'
  && item.itemType !== null && profileRole(item.itemType) !== null))

/**
 * Arms Profile from the Site data toolbar ('panel') or the palette, with Site data open beside the map, so the finished
 * line has a panel to show its chart in.
 */
export function armProfile(from: 'panel' | 'palette'): void {
  armCanvasTool('profile', { from })
  if (sidePanel.peek() !== 'site-data') selectPanel('site-data')
}

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
