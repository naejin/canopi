// @vitest-environment node
/**
 * The legend against the renderer that draws the map: the pinned
 * `cog-tiler-wasm`, its WebAssembly started in Node. An unknown colormap name
 * falls back to grey without an error, so every name the item types (or the
 * typeless fallback) return must be one the wasm compiles in, and every legend
 * ramp must show the colours `colorize()` paints at its nine stops.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { colorize, colormap_names, initSync } from 'cog-tiler-wasm/wasm'
import type { RasterQuantity } from '../../generated/contracts'
import { legendGradient } from './display-legend'
import { lidarDisplayStyle } from './display'
import { RASTER_QUANTITIES } from './item-types'

const require = createRequire(import.meta.url)
const wasmPath = join(dirname(require.resolve('cog-tiler-wasm/wasm')), 'cog_tiler_wasm_bg.wasm')

/** Every colormap a displayed item can be drawn with, in both slope units. */
function returnedColormaps(): string[] {
  const names = new Set<string>()
  for (const quantity of Object.keys(RASTER_QUANTITIES) as RasterQuantity[]) {
    for (const units of ['m', '°', '%']) {
      names.add(RASTER_QUANTITIES[quantity].style({ units, displayRange: [0, 10] }).colormap)
    }
  }
  names.add(lidarDisplayStyle({ itemType: null, units: 'm', displayRange: null }).colormap)
  return [...names].sort()
}

function hexChannels(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number]
}

/** The wasm's colour at i/8 for i = 0..8, as RGB triples. */
function wasmStops(colormap: string): [number, number, number][] {
  const pixels = Float64Array.from({ length: 9 }, (_, i) => i / 8)
  const rgba = colorize(pixels, 9, 1, 0, 1, colormap, null, false, 'linear', 1, false, 1)
  return Array.from({ length: 9 }, (_, i) => [rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!])
}

/** The legend's stops for a colormap, read back from the gradient it renders. */
function legendStops(colormap: string): [number, number, number][] {
  return (legendGradient(colormap, false).match(/#[0-9a-f]{6}/gi) ?? []).map(hexChannels)
}

beforeAll(() => {
  initSync({ module: readFileSync(wasmPath) })
})

describe('LiDAR legend ramps against the real renderer', () => {
  it('draws every returned colormap with a ramp the wasm compiles in', () => {
    const known = new Set(JSON.parse(colormap_names()) as string[])
    expect(returnedColormaps().filter((name) => !known.has(name))).toEqual([])
  })

  it.each(returnedColormaps())('shows the colours colorize() paints for %s at i/8 within ±2', (colormap) => {
    const legend = legendStops(colormap)
    const wasm = wasmStops(colormap)
    expect(legend).toHaveLength(9)
    const worst = Math.max(...legend.flatMap((rgb, i) => rgb.map((channel, c) => Math.abs(channel - wasm[i]![c]!))))
    expect(worst, `${colormap} legend ${JSON.stringify(legend)} vs wasm ${JSON.stringify(wasm)}`).toBeLessThanOrEqual(2)
  })
})
