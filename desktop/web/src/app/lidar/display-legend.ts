import { unitSuffix } from './item-types'

/**
 * Legend ramps for the upstream renderer's built-in colormaps.
 *
 * Stops sample the matplotlib ramps `cog-tiler-wasm@0.4.0` compiles in, so a
 * legend shows the colours the map draws. A legend never measures anything:
 * numeric values come from native inspection.
 */
const RAMPS: Readonly<Record<string, readonly string[]>> = {
  terrain: ['#333399', '#0294fa', '#01cc66', '#80e680', '#fefe98', '#bfa982', '#80605c', '#d9cfcd', '#ffffff'],
  viridis: ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'],
  magma: ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55064', '#fb8761', '#fec287', '#fcfdbf'],
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
