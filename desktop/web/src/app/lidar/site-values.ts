// app/lidar/site-values.ts
//
// Owns the values Site data rows show (canopi-f47t.42, spec §1.10, §3.8; stream C builds them): while the panel is open,
// each shown, ready row's value under the pointer over the map, otherwise at the pin, sampled only through `sampler.ts`.
// Touch never hovers, so touch reads values through the pin. An eye toggle, a new generation or a list change re-samples
// at once. Rows are read in list order (front first), so the first batch answers the rows the user sees first.

import { computed, effect, signal, type ReadonlySignal } from '@preact/signals'
import { currentCanvasQuerySurface } from '../../canvas/session'
import type { LidarSampleTarget } from '../../generated/contracts'
import { activePanel, sidePanel } from '../shell/state'
import { readCurrentLidarPresentation } from './library-store'
import { siteSampler } from './sampler'
import { pin, setPin, type GeoPoint } from './site-transients'

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

/** Values are read only while Site data is the open side panel over the Canvas, in site mode (as site-transients.ts). */
const reading = computed(() =>
  activePanel.value === 'canvas'
  && sidePanel.value === 'site-data'
  && currentCanvasQuerySurface.value?.view.mode.value !== 'overview')

/** The mouse or pen over the map, in WGS84; null off the map. Touch never hovers. */
const pointer = signal<GeoPoint | null>(null)

effect(() => {
  const surface = currentCanvasQuerySurface.value
  pointer.value = null
  if (!surface) return
  return surface.subscribePointerWorld((point) => {
    if (point?.pointerKind === 'touch') return
    const plane = surface.sessionPlane.peek()
    const geo = point && plane ? plane.toGeo(point.world) : null
    pointer.value = geo && Number.isFinite(geo.lon) && Number.isFinite(geo.lat) ? { lon: geo.lon, lat: geo.lat } : null
  })
})

let askedKey: string | null = null

/**
 * The rows being read since reading last started; null while nothing is read. A batch lands only into the reading it
 * was asked in, and only for rows still read, so a late answer never brings values back after reading stopped or a row
 * was hidden. A new point keeps the reading, so the running key's later batches still land (sampler.ts).
 */
let read: { ids: ReadonlySet<string> } | null = null

function stopReading(): void {
  askedKey = null
  read = null
  values.value = null
}

// One request per change of the point or of the rows to read: an eye, a new generation, an added, removed or reordered
// item. The sampler keeps one in flight and drops what a newer key replaced.
effect(() => {
  if (!reading.value) {
    stopReading()
    return
  }
  const hovered = pointer.value
  const at = hovered ? 'pointer' : 'pin'
  const point = hovered ?? pin.value
  // The presentation lists back to front; the panel and the batches go front first.
  const rows = readCurrentLidarPresentation()
    .filter((item) => item.shown && item.availability === 'present' && item.state === 'Ready' && item.generationId !== null)
    .reverse()
  if (!point || rows.length === 0) {
    stopReading()
    return
  }
  const targets: LidarSampleTarget[] = rows.map((row) => ({
    kind: row.kind,
    entity_id: row.id,
    expected_generation_id: row.generationId!,
  }))
  const key = JSON.stringify([at, point.lon, point.lat, targets])
  if (key === askedKey) return
  askedKey = key
  const ids = new Set(rows.map((row) => row.id))
  if (read) read.ids = ids
  else read = { ids }
  const asked = read
  void siteSampler.request('values', key, targets, [[point.lon, point.lat]], (first, series) => {
    if (read !== asked) return
    // Rows a later batch answers keep their last value until it lands; rows no longer read are dropped.
    const merged = new Map([...(values.peek()?.rows ?? [])].filter(([id]) => asked.ids.has(id)))
    series.forEach((answer, index) => {
      const id = rows[first + index]!.id
      if (!asked.ids.has(id)) return
      if ('Values' in answer) {
        const value = answer.Values.values[0]
        merged.set(id, value === null || value === undefined ? { kind: 'no-data' } : { kind: 'value', value })
      } else {
        // A moved or missing head shows no value; the next snapshot re-aims the row.
        merged.delete(id)
      }
    })
    values.value = { at, rows: merged }
  }).catch(() => {
    // A failed read shows no new values; the next point or row change asks again.
    askedKey = null
  })
})
/**
 * The pin hand-off (CanvasRuntimeAppAdapter.pinAt): a tap no tool uses, in session-plane metres, pinned as the WGS84
 * point the canvas drew there, so a re-origin never moves it.
 */
export function pinSiteDataPoint(point: { readonly x: number; readonly y: number }): void {
  const plane = currentCanvasQuerySurface.peek()?.sessionPlane.peek()
  if (plane) setPin(plane.toGeo(point))
}
