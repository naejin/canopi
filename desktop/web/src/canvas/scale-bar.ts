// ---------------------------------------------------------------------------
// Shared scale-bar metrics for screen-space overlay rendering.
// The bar is drawn in the HTML overlay layer, but these constants are also
// consumed by the DOM legend so both reserve the same bottom band.
// ---------------------------------------------------------------------------

const TARGET_PX = 120
const MAX_BAR_PX = TARGET_PX * 1.5

export const SCALE_BAR_MARGIN_X = 40
export const SCALE_BAR_MARGIN_Y = 16
export const SCALE_BAR_RESERVED_BOTTOM_PX = 40
export const SCALE_BAR_CANVAS_WIDTH = 240

export interface ScaleBarDisplay {
  barScreenPx: number
  label: string
}

export function getScaleBarDisplay(scale: number): ScaleBarDisplay {
  const safeScale = scale > 0 ? scale : 1
  const bestDist = niceDistanceAtMost(MAX_BAR_PX / safeScale)

  return {
    barScreenPx: bestDist * safeScale,
    label: _formatDist(bestDist),
  }
}

function niceDistanceAtMost(maximum: number): number {
  if (!Number.isFinite(maximum) || maximum <= 0) return 0.5
  const exponent = Math.floor(Math.log10(maximum))
  const power = 10 ** exponent
  const normalized = maximum / power
  const coefficient = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1
  return coefficient * power
}

function _formatDist(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(0)}km`
  if (meters < 1) return `${(meters * 100).toFixed(0)}cm`
  return `${meters % 1 === 0 ? meters.toFixed(0) : meters.toFixed(1)}m`
}
