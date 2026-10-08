// @vitest-environment node
/**
 * The legend against the renderer that draws the map: the pinned
 * `cog-tiler-wasm`, its WebAssembly started in Node. An unknown colormap name
 * falls back to grey without an error, so every name the item types (or the
 * typeless fallback) return must be one the wasm compiles in, and every legend
 * ramp must show the colours `colorize()` paints at its stops and between them,
 * where the CSS gradient blends in a straight line.
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

/** The wasm's colour at each position in 0..1, as RGB triples. */
function wasmColours(colormap: string, positions: readonly number[]): [number, number, number][] {
  const rgba = colorize(Float64Array.from(positions), positions.length, 1, 0, 1, colormap, null, false, 'linear', 1, false, 1)
  return positions.map((_, i) => [rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!])
}

/** The legend's stops for a colormap, read back from the gradient it renders. */
function legendStops(colormap: string): [number, number, number][] {
  return (legendGradient(colormap, false).match(/#[0-9a-f]{6}/gi) ?? []).map(hexChannels)
}

/** The legend's colour at a position: the straight-line blend of its evenly spaced stops. */
function legendColour(stops: readonly [number, number, number][], position: number): [number, number, number] {
  const scaled = position * (stops.length - 1)
  const below = Math.min(stops.length - 2, Math.floor(scaled))
  const share = scaled - below
  return stops[below]!.map((channel, c) => channel * (1 - share) + stops[below + 1]![c]! * share) as [number, number, number]
}

function worstGap(legend: readonly [number, number, number][], wasm: readonly [number, number, number][]): number {
  return Math.max(...legend.flatMap((rgb, i) => rgb.map((channel, c) => Math.abs(channel - wasm[i]![c]!))))
}

/** 1025 positions, so every stop of a 9-, 17-, 33- or 65-stop ramp is among them. */
const FINE = Array.from({ length: 1025 }, (_, k) => k / 1024)

beforeAll(() => {
  initSync({ module: readFileSync(wasmPath) })
})

describe('LiDAR legend ramps against the real renderer', () => {
  it('draws every returned colormap with a ramp the wasm compiles in', () => {
    const known = new Set(JSON.parse(colormap_names()) as string[])
    expect(returnedColormaps().filter((name) => !known.has(name))).toEqual([])
  })

  it.each(returnedColormaps())('shows the colours colorize() paints for %s at its stops within ±2', (colormap) => {
    const legend = legendStops(colormap)
    expect(legend.length).toBeGreaterThanOrEqual(2)
    const wasm = wasmColours(colormap, legend.map((_, i) => i / (legend.length - 1)))
    expect(worstGap(legend, wasm), `${colormap} legend ${JSON.stringify(legend)} vs wasm ${JSON.stringify(wasm)}`).toBeLessThanOrEqual(2)
  })

  it.each(returnedColormaps())('blends to within ±8 of colorize() between the stops of %s', (colormap) => {
    const stops = legendStops(colormap)
    const legend = FINE.map((position) => legendColour(stops, position))
    const wasm = wasmColours(colormap, FINE)
    const gaps = legend.map((rgb, k) => worstGap([rgb], [wasm[k]!]))
    const at = gaps.indexOf(Math.max(...gaps))
    expect(gaps[at], `${colormap} at ${FINE[at]}: legend ${legend[at]!.map(Math.round)} vs wasm ${wasm[at]}`).toBeLessThanOrEqual(8)
  })
})
