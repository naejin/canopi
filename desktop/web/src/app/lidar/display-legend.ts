import { unitSuffix } from './item-types'

/**
 * Legend ramps for the upstream renderer's built-in colormaps.
 *
 * Stops are `colorize()` of the pinned `cog-tiler-wasm@0.4.0` at i/8, so a
 * legend shows the colours the map draws (held by display-legend.test.ts). A
 * legend never measures anything: numeric values come from native inspection.
 */
const RAMPS: Readonly<Record<string, readonly string[]>> = {
  schwarzwald: ['#aeefd5', '#f7fcb2', '#17992f', '#a4a627', '#c44f02', '#741504', '#723b19', '#a7a19d', '#e9e7e9'],
  greens: ['#f7fcf5', '#e3f4de', '#c5e7be', '#9fd79b', '#72c378', '#42aa5d', '#218b44', '#026c2c', '#00441b'],
  ylorrd: ['#ffffcc', '#ffeba1', '#fed775', '#fdb24d', '#fc8b3b', '#fa4e2a', '#e11b1d', '#bc0126', '#800026'],
  viridis: ['#440154', '#462c79', '#3a5189', '#2c718d', '#20908c', '#29ad7f', '#5cc862', '#aadb32', '#fde724'],
}

export function legendGradient(colormap: string, reversed: boolean): string {
  const stops = [...(RAMPS[colormap] ?? RAMPS.viridis!)]
  if (reversed) stops.reverse()
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

const formatters = new Map<string, Intl.NumberFormat>()

/** A number with exactly `digits` decimals, in the interface locale's digits and separators. */
function fixed(value: number, digits: number, locale: string): string {
  const key = `${locale}:${digits}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
    formatters.set(key, formatter)
  }
  return formatter.format(value)
}

export function formatLegendValue(value: number, units: string, locale: string): string {
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2
  return `${fixed(value, digits, locale)}${unitSuffix(units)}`
}

/** A raster's cell size in metres, to centimetres below 10 m. */
export function formatRasterMetres(value: number, locale: string): string {
  return `${fixed(value, value >= 10 ? 0 : value >= 1 ? 1 : 2, locale)} m`
}

/** A raster's display range, to one decimal. */
export function formatRasterRange(range: readonly [number, number], units: string, locale: string): string {
  return `${fixed(range[0], 1, locale)} – ${fixed(range[1], 1, locale)}${unitSuffix(units)}`
}

/**
 * A sampled raster value, at a precision that does not overstate the source: the read is one
 * native pixel rather than a survey-grade observation.
 */
export function formatRasterSample(value: number, locale: string): string {
  const magnitude = Math.abs(value)
  return fixed(value, magnitude >= 1000 ? 2 : magnitude >= 1 ? 3 : 4, locale)
}
