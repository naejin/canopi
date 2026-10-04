// Scale-bar metrics for the zoom group: a round ground distance whose bar
// fits the target width at the current scale.

const TARGET_PX = 100
const MAX_BAR_PX = TARGET_PX * 1.25

export interface ScaleBarDisplay {
  readonly barScreenPx: number
  /** The ground distance the bar spans, in metres. */
  readonly meters: number
}

/** `scale` is CSS pixels per ground metre, positive and finite on a validated camera. */
export function getScaleBarDisplay(scale: number): ScaleBarDisplay {
  const meters = niceDistanceAtMost(MAX_BAR_PX / scale)
  return { barScreenPx: meters * scale, meters }
}

function niceDistanceAtMost(maximum: number): number {
  const exponent = Math.floor(Math.log10(maximum))
  const power = 10 ** exponent
  const normalized = maximum / power
  const coefficient = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1
  return coefficient * power
}
