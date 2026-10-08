// app/lidar/display-range.ts
//
// Owns the ranges Cut outliers draws (canopi-f47t.42, spec §1.10 "Open item"): the 2–98 % range of one displayed
// generation, read once per display key from its display COGs in the shared raster worker lanes (`pool.ts`). One asset
// uses cog-tiler's own percentiles; a mosaic takes the same 2–98 % points (GeoLibre's `autoRangeFor` rule) of its
// assets' pooled distribution (`mosaicRange`). Never stored: a reopened Design reads it again. Until it lands, or when it
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
    return mosaicRange(statistics)
  } finally {
    client.dispose()
  }
}

/**
 * The 2–98 % range of several assets pooled. Each asset keeps its own resolution: its cumulative count is known at
 * its bin edges, its 2 % and 98 % points and its ends, and runs linearly between them. maplibre-gl-raster's
 * `mergeBandStats` rebins every asset onto 128 bins over the union instead, so one spike in one asset coarsens every
 * asset to 1/128 of the spike's span.
 */
function mosaicRange(statistics: readonly RasterBandStatistics[]): Range {
  const curves = statistics.map(cumulativeCurve)
  const total = curves.reduce((sum, curve) => sum + curve.total, 0)
  const low = Math.min(...statistics.map(({ min }) => min))
  const high = Math.max(...statistics.map(({ max }) => max))
  const quantile = (fraction: number): number => {
    let [below, above] = [low, high]
    for (let step = 0; step < 64 && below < above; step += 1) {
      const middle = (below + above) / 2
      if (curves.reduce((sum, curve) => sum + curve.at(middle), 0) < fraction * total) below = middle
      else above = middle
    }
    return above
  }
  return [quantile(0.02), quantile(0.98)]
}

interface CumulativeCurve {
  readonly total: number
  /** Values counted at or below `value`, linear between known points. */
  at(value: number): number
}

function cumulativeCurve({ min, max, percentile2, percentile98, histogram }: RasterBandStatistics): CumulativeCurve {
  const total = histogram.reduce((sum, count) => sum + count, 0)
  const span = max - min
  const points: [number, number][] = [[min, 0], [percentile2, 0.02 * total], [percentile98, 0.98 * total], [max, total]]
  // cog-tiler's bins are equal over [min, max]: values below edge k sit in bins 0..k-1.
  let below = 0
  for (let edge = 1; edge < histogram.length; edge += 1) {
    below += histogram[edge - 1]!
    points.push([min + (span * edge) / histogram.length, below])
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  for (let index = 1; index < points.length; index += 1) points[index]![1] = Math.max(points[index]![1], points[index - 1]![1])
  return {
    total,
    at(value) {
      if (value < min) return 0
      if (value >= max) return total
      // The last point at or below `value`; the first point is `min`, so there is one.
      let [index, after] = [0, points.length]
      while (after - index > 1) {
        const middle = (index + after) >> 1
        if (points[middle]![0] <= value) index = middle
        else after = middle
      }
      const [x0, y0] = points[index]!
      const [x1, y1] = points[index + 1] ?? [x0, y0]
      return x1 > x0 ? y0 + ((value - x0) / (x1 - x0)) * (y1 - y0) : y0
    },
  }
}
