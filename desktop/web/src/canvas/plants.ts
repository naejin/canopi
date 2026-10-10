import { DEFAULT_PLANT_COLOR } from './plant-colors'

// Strata color map — keyed by RAW DB values (lowercase).
const STRATA_COLORS: Record<string, string> = {
  'emergent':     '#1B5E20',
  'high':         '#2E7D32',
  'low':          '#388E3C',
  'medium':       '#558B2F',
}

export function getStratumColor(stratum: string | null): string {
  if (!stratum) return DEFAULT_PLANT_COLOR
  return STRATA_COLORS[stratum] ?? DEFAULT_PLANT_COLOR
}

/** Below 0.5 px/m (a far overview) every plant draws as a dot, whatever its symbol. */
export function isDotScale(pixelsPerMetre: number): boolean {
  return pixelsPerMetre < 0.5
}
