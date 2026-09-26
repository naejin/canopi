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

export function formatLegendValue(value: number, units: string): string {
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2
  return `${value.toFixed(digits)}${unitSuffix(units)}`
}
