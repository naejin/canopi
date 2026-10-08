// app/lidar/site-values.ts
//
// Owns the values Site data rows show (canopi-f47t.42, spec §1.10, §3.8; stream C builds them): while the panel is open,
// each shown, ready row's value under the pointer over the map, otherwise at the pin, sampled only through `sampler.ts`.
// Touch never hovers, so touch reads values through the pin. An eye toggle, a new generation or a list change re-samples
// at once. Commit 0 builds the pin hand-off and gives the values their final signature.

import { signal, type ReadonlySignal } from '@preact/signals'
import { currentCanvasQuerySurface } from '../../canvas/session'
import { setPin } from './site-transients'

/** One row's value: a number in the item's own units, or no data at that point. */
export type SiteRowValue =
  | { readonly kind: 'value'; readonly value: number }
  | { readonly kind: 'no-data' }

/** The values the rows show, by entry id, and where they were read; a row with no entry shows no value. */
export interface SiteValues {
  readonly at: 'pointer' | 'pin'
  readonly rows: ReadonlyMap<string, SiteRowValue>
}

const values = signal<SiteValues | null>(null)

/** The rows' values; null while nothing is read (the panel closed, no pointer and no pin, or no row to read). */
export const siteValues: ReadonlySignal<SiteValues | null> = values

/**
 * The pin hand-off (CanvasRuntimeAppAdapter.pinAt): a tap no tool uses, in session-plane metres, pinned as the WGS84
 * point the canvas drew there, so a re-origin never moves it.
 */
export function pinSiteDataPoint(point: { readonly x: number; readonly y: number }): void {
  const plane = currentCanvasQuerySurface.peek()?.sessionPlane.peek()
  if (plane) setPin(plane.toGeo(point))
}
