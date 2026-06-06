import { consortiumTarget } from '../../target'
import type { Consortium } from '../../types/design'

export interface SuccessionPhaseDefinition {
  readonly key: string
  readonly labelKey: string
  readonly durationKey: string
}

export const CONSORTIUM_SUCCESSION_PHASES: readonly SuccessionPhaseDefinition[] = [
  { key: 'placenta1', labelKey: 'canvas.consortium.phase_placenta1', durationKey: 'canvas.consortium.duration_90d' },
  { key: 'placenta2', labelKey: 'canvas.consortium.phase_placenta2', durationKey: 'canvas.consortium.duration_180d' },
  { key: 'placenta3', labelKey: 'canvas.consortium.phase_placenta3', durationKey: 'canvas.consortium.duration_5y' },
  { key: 'secondaire1', labelKey: 'canvas.consortium.phase_secondaire1', durationKey: 'canvas.consortium.duration_10y' },
  { key: 'secondaire2', labelKey: 'canvas.consortium.phase_secondaire2', durationKey: 'canvas.consortium.duration_20y' },
  { key: 'secondaire3', labelKey: 'canvas.consortium.phase_secondaire3', durationKey: 'canvas.consortium.duration_40y' },
  { key: 'climax', labelKey: 'canvas.consortium.phase_climax', durationKey: 'canvas.consortium.duration_60y' },
] as const

export const CONSORTIUM_STRATA = ['emergent', 'high', 'medium', 'low', 'unassigned'] as const

export const DEFAULT_CONSORTIUM_STRATUM: string = CONSORTIUM_STRATA[CONSORTIUM_STRATA.length - 1]!
export const DEFAULT_CONSORTIUM_START_PHASE = 0
export const DEFAULT_CONSORTIUM_END_PHASE = 2

export const SUCCESSION_PHASE_COUNT = CONSORTIUM_SUCCESSION_PHASES.length
export const LAST_SUCCESSION_PHASE_INDEX = SUCCESSION_PHASE_COUNT - 1
export const SUCCESSION_PHASE_BOUNDARY_COUNT = SUCCESSION_PHASE_COUNT
export const CONSORTIUM_STRATUM_COUNT = CONSORTIUM_STRATA.length
export const DEFAULT_CONSORTIUM_STRATUM_ROW = CONSORTIUM_STRATUM_COUNT - 1

export function clampSuccessionPhaseIndex(phase: number): number {
  return Math.max(0, Math.min(LAST_SUCCESSION_PHASE_INDEX, phase))
}

export function clampSuccessionPhaseBoundary(phase: number): number {
  return Math.max(0, Math.min(SUCCESSION_PHASE_BOUNDARY_COUNT, phase))
}

export function stratumToRow(stratum: string): number {
  const index = (CONSORTIUM_STRATA as readonly string[]).indexOf(stratum)
  return index === -1 ? DEFAULT_CONSORTIUM_STRATUM_ROW : index
}

export function stratumAtRow(rowIndex: number): string {
  const clamped = Math.max(0, Math.min(DEFAULT_CONSORTIUM_STRATUM_ROW, rowIndex))
  return CONSORTIUM_STRATA[clamped] ?? DEFAULT_CONSORTIUM_STRATUM
}

export function createDefaultConsortiumEntry(canonicalName: string): Consortium {
  return {
    target: consortiumTarget(canonicalName),
    stratum: DEFAULT_CONSORTIUM_STRATUM,
    start_phase: DEFAULT_CONSORTIUM_START_PHASE,
    end_phase: DEFAULT_CONSORTIUM_END_PHASE,
  }
}
