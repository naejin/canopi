// ---------------------------------------------------------------------------
// Shared scale-bar metrics for screen-space overlay rendering.
// The bar is drawn in the HTML overlay layer, but these constants are also
// consumed by the DOM legend so both reserve the same bottom band.
// ---------------------------------------------------------------------------

const NICE_DISTANCES = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
const TARGET_PX = 120

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

  let bestDist = NICE_DISTANCES[0]!
  for (const d of NICE_DISTANCES) {
    if (d * safeScale <= TARGET_PX * 1.5) {
      bestDist = d
    } else {
      break
    }
  }

  return {
    barScreenPx: bestDist * safeScale,
    label: _formatDist(bestDist),
  }
}

function _formatDist(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(0)} km`
  if (meters < 1) return `${(meters * 100).toFixed(0)} cm`
  return `${meters % 1 === 0 ? meters.toFixed(0) : meters.toFixed(1)} m`
}
