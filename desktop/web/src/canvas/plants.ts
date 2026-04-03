import { DEFAULT_PLANT_COLOR } from './plant-colors'

// Re-export for canvas-internal consumers (display-modes.ts)
export { STRATUM_I18N_KEY } from '../types/constants'

// Strata color map — keyed by RAW DB values (lowercase).
const STRATA_COLORS: Record<string, string> = {
  'emergent':     '#1B5E20',
  'high':         '#2E7D32',
  'low':          '#388E3C',
  'medium':       '#558B2F',
}

// All plant circles use a fixed screen-pixel radius for maximum readability.
export const CIRCLE_SCREEN_PX = 8       // radius in screen pixels — consistent for all plants

export function getStratumColor(stratum: string | null): string {
  if (!stratum) return DEFAULT_PLANT_COLOR
  return STRATA_COLORS[stratum] ?? DEFAULT_PLANT_COLOR
}

// LOD thresholds — based on how many screen pixels a 1m world unit occupies
export type PlantLOD = 'dot' | 'icon' | 'icon+label'

export function getPlantLOD(stageScale: number): PlantLOD {
  // stageScale = pixels per meter
  // At 5+ px/m: icon+label (zoomed in close — labels readable without overlap)
  // At 0.5–5 px/m: icon only (labels would overlap at normal zoom)
  // At <0.5 px/m: dots only (far out overview)
  if (stageScale < 0.5) return 'dot'
  if (stageScale < 5) return 'icon'
  return 'icon+label'
}
