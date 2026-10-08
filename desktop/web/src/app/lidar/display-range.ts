// app/lidar/display-range.ts
//
// Owns the ranges Cut outliers draws (canopi-f47t.42, spec §1.10 "Open item"): the 2–98 % range of one displayed
// generation, read once per display key from its display COGs in the shared raster worker lanes (`pool.ts`). One asset
// uses cog-tiler's own percentiles; a mosaic merges its assets' histograms with maplibre-gl-raster's `mergeBandStats`
// and takes `autoRangeFor` (GeoLibre's rule). Never stored: a reopened Design reads it again. Until it lands, or when it
// cannot be read, the entry draws its data range. An asset whose read fails (a lane restart, an asset error) is read
// again up to `READ_ATTEMPTS` times; past that the key is forgotten, so a later request reads it again.

import { signal } from '@preact/signals'
import { rasterWorkerPool } from '../../maplibre/raster-display/pool'
import type { RasterBandStatistics } from '../../maplibre/raster-display/protocol'

type Range = readonly [number, number]

const MAX_ENTRIES = 256
const READ_ATTEMPTS = 3

const ranges = signal<ReadonlyMap<string, Range>>(new Map())
/** Keys asked for, answered or not, so a key is read once. */
const asked = new Set<string>()
let owner = 0

/** The 2–98 % range of one displayed generation (`displayKey`), or null until it is known. */
export function cutOutlierRange(key: string): Range | null {
  return ranges.value.get(key) ?? null
}

/** Reads the 2–98 % range of one displayed generation from its display COGs, once per key. */
export function requestCutOutlierRange(key: string, urls: readonly string[]): void {
  if (asked.has(key) || urls.length === 0) return
  asked.add(key)
  const generation = owner
  void readRange(urls).then((range) => {
    if (generation !== owner || !range) return
    const next = new Map(ranges.value)
    next.set(key, range)
    while (next.size > MAX_ENTRIES) next.delete(next.keys().next().value!)
    ranges.value = next
  }, () => {
    if (generation === owner) asked.delete(key)
  })
}

/** Forgets every range and drops answers still on their way (the display store's dispose). */
export function resetCutOutlierRanges(): void {
  owner += 1
  asked.clear()
  ranges.value = new Map()
}

async function readRange(urls: readonly string[]): Promise<Range | null> {
  const client = rasterWorkerPool().acquire()
  try {
    const assets = [...new Set(urls)]
    const read = new Map<string, RasterBandStatistics | null>()
    for (let attempt = 1; read.size < assets.length; attempt += 1) {
      const pending = assets.filter((url) => !read.has(url))
      const settled = await Promise.allSettled(pending.map((url) => client.statistics(url)))
      settled.forEach((result, index) => { if (result.status === 'fulfilled') read.set(pending[index]!, result.value) })
      if (read.size < assets.length && attempt === READ_ATTEMPTS) throw new Error('Cut outliers could not read every asset')
    }
    const statistics = [...read.values()].filter((entry): entry is RasterBandStatistics => entry !== null)
    if (statistics.length === 0) return null
    if (statistics.length === 1) return [statistics[0]!.percentile2, statistics[0]!.percentile98]
    const { autoRangeFor, mergeBandStats } = await import('maplibre-gl-raster')
    const merged = mergeBandStats(statistics.map(({ min, max, histogram }) => ({ min, max, histogram: [...histogram] })))
    return merged ? autoRangeFor(merged) : null
  } finally {
    client.dispose()
  }
}
