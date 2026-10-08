import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RasterBandStatistics } from '../maplibre/raster-display/protocol'

/** A fake pool: statistics answered per URL when the test says so. */
const answers = new Map<string, (value: RasterBandStatistics | null) => void>()
const asked: string[] = []
let clients = 0
vi.mock('../maplibre/raster-display/pool', () => ({
  rasterWorkerPool: () => ({
    acquire: () => {
      clients += 1
      return {
        statistics: (url: string) => {
          asked.push(url)
          return new Promise<RasterBandStatistics | null>((resolve, reject) => {
            answers.set(url, (value) => (value === undefined ? reject(new Error('lane failed')) : resolve(value)))
          })
        },
        dispose: () => { clients -= 1 },
      }
    },
  }),
}))

const { cutOutlierRange, requestCutOutlierRange, resetCutOutlierRanges } = await import('../app/lidar/display-range')

function stats(min: number, max: number, percentile2: number, percentile98: number): RasterBandStatistics {
  // 128 equal bins (cog-tiler's and maplibre-gl-raster's count), so the merged 2–98 % range is predictable.
  return { min, max, percentile2, percentile98, histogram: Array.from({ length: 128 }, () => 10) }
}

/** cog-tiler's statistics of these values (`statistics.js`): exact 2 % and 98 % points, 128 equal bins over [min, max]. */
function statsOf(values: readonly number[]): RasterBandStatistics {
  const sorted = [...values].sort((a, b) => a - b)
  const [min, max] = [sorted[0]!, sorted.at(-1)!]
  const span = max - min || 1
  const histogram = Array.from({ length: 128 }, () => 0)
  for (const value of sorted) histogram[Math.min(127, Math.floor(((value - min) / span) * 128))]! += 1
  const at = (percent: number) => sorted[Math.min(sorted.length - 1, Math.floor((percent / 100) * sorted.length))]!
  return { min, max, percentile2: at(2), percentile98: at(98), histogram }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Cut outliers ranges', () => {
  beforeEach(() => {
    resetCutOutlierRanges()
    answers.clear()
    asked.length = 0
  })

  it('reads one asset\'s 2–98 % range once per generation key, and releases its pool client', async () => {
    expect(cutOutlierRange('Source/a/g1')).toBeNull()
    requestCutOutlierRange('Source/a/g1', ['a.tif'])
    requestCutOutlierRange('Source/a/g1', ['a.tif'])
    expect(asked).toEqual(['a.tif'])
    answers.get('a.tif')!(stats(100, 140, 102.5, 137.25))
    await settle()
    expect(cutOutlierRange('Source/a/g1')).toEqual([102.5, 137.25])
    expect(clients).toBe(0)
    requestCutOutlierRange('Source/a/g1', ['a.tif'])
    expect(asked).toEqual(['a.tif'])
    // A new generation is a new key: read again.
    requestCutOutlierRange('Source/a/g2', ['a2.tif'])
    expect(asked).toEqual(['a.tif', 'a2.tif'])
    answers.get('a2.tif')!(stats(100, 141, 102, 138))
    await settle()
    expect(cutOutlierRange('Source/a/g2')).toEqual([102, 138])
  })

  it('merges a mosaic\'s assets before taking the 2–98 % range', async () => {
    requestCutOutlierRange('Source/m/g1', ['west.tif', 'east.tif'])
    await settle()
    answers.get('west.tif')!(stats(0, 100, 2, 98))
    await settle()
    answers.get('east.tif')!(stats(100, 200, 102, 198))
    await vi.waitFor(() => expect(cutOutlierRange('Source/m/g1')).not.toBeNull())
    const [low, high] = cutOutlierRange('Source/m/g1')!
    // Two equal halves of 0–200: the 2 % and 98 % points sit near 4 and 196.
    expect(low).toBeGreaterThan(0)
    expect(low).toBeLessThan(10)
    expect(high).toBeGreaterThan(190)
    expect(high).toBeLessThan(200)
  })

  it('gives a mosaic with one outlier spike the range one COG of the same data would get', async () => {
    // 300–340 m on both assets, one 10 000 m spike in the second: one COG of all of it cuts at about 300.8 and 339.2.
    const terrain = Array.from({ length: 50_000 }, (_, index) => 300 + (40 * index) / 49_999)
    const spiked = [...terrain.slice(1), 10_000]
    const whole = statsOf([...terrain, ...spiked])
    requestCutOutlierRange('Source/s/g1', ['west.tif', 'east.tif'])
    answers.get('west.tif')!(statsOf(terrain))
    answers.get('east.tif')!(statsOf(spiked))
    await vi.waitFor(() => expect(cutOutlierRange('Source/s/g1')).not.toBeNull())
    const [low, high] = cutOutlierRange('Source/s/g1')!
    expect(Math.abs(low - whole.percentile2)).toBeLessThan(0.5)
    expect(Math.abs(high - whole.percentile98)).toBeLessThan(0.5)
  })

  it('keeps the data range for an asset with no valid pixel, and does not ask again', async () => {
    requestCutOutlierRange('Source/e/g1', ['empty.tif'])
    answers.get('empty.tif')!(null)
    await settle()
    expect(cutOutlierRange('Source/e/g1')).toBeNull()
    requestCutOutlierRange('Source/e/g1', ['empty.tif'])
    expect(asked).toEqual(['empty.tif'])
    expect(clients).toBe(0)
  })

  it('reads a mosaic asset whose read failed again, keeping the assets that answered', async () => {
    requestCutOutlierRange('Source/m/g1', ['west.tif', 'east.tif'])
    answers.get('west.tif')!(stats(0, 100, 2, 98))
    answers.get('east.tif')!(undefined as never)
    await vi.waitFor(() => expect(asked).toEqual(['west.tif', 'east.tif', 'east.tif']))
    answers.get('east.tif')!(stats(100, 200, 102, 198))
    await vi.waitFor(() => expect(cutOutlierRange('Source/m/g1')).not.toBeNull())
    expect(clients).toBe(0)
  })

  // The display effect asks again on every Design edit and descriptor poll: a key that keeps failing must not reread the
  // whole mosaic in the lanes each time.
  it('after three failed reads keeps the data range for the session, and only a reset reads it again', async () => {
    requestCutOutlierRange('Source/f/g1', ['west.tif', 'failing.tif'])
    answers.get('west.tif')!(stats(0, 100, 2, 98))
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await vi.waitFor(() => expect(asked.filter((url) => url === 'failing.tif')).toHaveLength(attempt))
      answers.get('failing.tif')!(undefined as never)
    }
    await settle()
    expect(cutOutlierRange('Source/f/g1')).toBeNull()
    expect(clients).toBe(0)
    for (let run = 0; run < 5; run += 1) requestCutOutlierRange('Source/f/g1', ['west.tif', 'failing.tif'])
    expect(asked).toEqual(['west.tif', 'failing.tif', 'failing.tif', 'failing.tif'])
    resetCutOutlierRanges()
    requestCutOutlierRange('Source/f/g1', ['west.tif', 'failing.tif'])
    expect(asked.filter((url) => url === 'failing.tif')).toHaveLength(4)
  })

  it('drops an answer that lands after a reset', async () => {
    requestCutOutlierRange('Source/a/g1', ['a.tif'])
    resetCutOutlierRanges()
    answers.get('a.tif')!(stats(100, 140, 102.5, 137.25))
    await settle()
    expect(cutOutlierRange('Source/a/g1')).toBeNull()
  })
})
