// Scale-bar metrics for the zoom group: a round ground distance whose bar
// fits the target width at the current scale.

const TARGET_PX = 100
const MAX_BAR_PX = TARGET_PX * 1.25

export interface ScaleBarDisplay {
  readonly barScreenPx: number
  /** The ground distance the bar spans, in metres. */
  readonly meters: number
}

/** `scale` is CSS pixels per ground metre. */
export function getScaleBarDisplay(scale: number): ScaleBarDisplay {
  const safeScale = scale > 0 ? scale : 1
  const meters = niceDistanceAtMost(MAX_BAR_PX / safeScale)
  return { barScreenPx: meters * safeScale, meters }
}

function niceDistanceAtMost(maximum: number): number {
  if (!Number.isFinite(maximum) || maximum <= 0) return 0.5
  const exponent = Math.floor(Math.log10(maximum))
  const power = 10 ** exponent
  const normalized = maximum / power
  const coefficient = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1
  return coefficient * power
}
