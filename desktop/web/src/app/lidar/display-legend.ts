import { unitSuffix } from './item-types'

/**
 * Legend ramps for the upstream renderer's built-in colormaps.
 *
 * Stops are `colorize()` of the pinned `cog-tiler-wasm@0.4.0` at i/(n-1), with
 * as many stops (9, 17 or 65) as keep the gradient's straight-line blend within
 * 8/255 of the map between them, so a legend shows the colours the map draws
 * (held by display-legend.test.ts). A legend never measures anything: numeric
 * values come from native inspection.
 */
const RAMPS: Readonly<Record<string, readonly string[]>> = {
  schwarzwald: [
    '#aeefd5', '#b0f2cd', '#b1f4c1', '#b2f6b5', '#bbf7b2', '#c8f9b2', '#d8fab2', '#eafcb2',
    '#f7fcb2', '#eff4a3', '#cfe888', '#b2dc72', '#8dce5b', '#68c047', '#48b437', '#29a62c',
    '#17992f', '#0c8b37', '#0b823f', '#2c853d', '#448c3b', '#619436', '#7b9b31', '#8da02d',
    '#a4a627', '#beae21', '#d3b21a', '#ebb50f', '#f6ad04', '#ec9802', '#de7c02', '#d36402',
    '#c44f02', '#b53b02', '#a82902', '#9a1b01', '#8d0e01', '#810500', '#790a01', '#751102',
    '#741504', '#721905', '#711d06', '#6f2108', '#6e2509', '#6c290a', '#6b2d0c', '#6b310f',
    '#723b19', '#784625', '#805133', '#885d42', '#906953', '#967561', '#9d8475', '#a3938c',
    '#a7a19d', '#adacac', '#b5b4b5', '#bdbcbd', '#c6c5c6', '#cecdce', '#d7d5d7', '#dfdddf',
    '#e9e7e9',
  ],
  greens: ['#f7fcf5', '#e3f4de', '#c5e7be', '#9fd79b', '#72c378', '#42aa5d', '#218b44', '#026c2c', '#00441b'],
  ylorrd: ['#ffffcc', '#ffeba1', '#fed775', '#fdb24d', '#fc8b3b', '#fa4e2a', '#e11b1d', '#bc0126', '#800026'],
  viridis: [
    '#440154', '#471768', '#462c79', '#414085', '#3a5189', '#33618c', '#2c718d', '#26808c',
    '#20908c', '#209f87', '#29ad7f', '#3ebb72', '#5cc862', '#82d34b', '#aadb32', '#d5e11b',
    '#fde724',
  ],
}

export function legendGradient(colormap: string, reversed: boolean): string {
  const stops = [...RAMPS[colormap]!]
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
