import { describe, expect, it } from 'vitest'
import {
  CONSORTIUM_STRATA,
  CONSORTIUM_SUCCESSION_PHASES,
  DEFAULT_CONSORTIUM_END_PHASE,
  DEFAULT_CONSORTIUM_START_PHASE,
  DEFAULT_CONSORTIUM_STRATUM,
  LAST_SUCCESSION_PHASE_INDEX,
  clampSuccessionPhaseBoundary,
  clampSuccessionPhaseIndex,
  createDefaultConsortiumEntry,
  stratumAtRow,
  stratumToRow,
} from '../app/consortium/time-model'
import { getConsortiumCanonicalName } from '../target'

describe('Consortium time model', () => {
  it('owns Succession Phase labels, durations, and index limits', () => {
    expect(CONSORTIUM_SUCCESSION_PHASES.map((phase) => phase.key)).toEqual([
      'placenta1',
      'placenta2',
      'placenta3',
      'secondaire1',
      'secondaire2',
      'secondaire3',
      'climax',
    ])
    expect(CONSORTIUM_SUCCESSION_PHASES[0]).toMatchObject({
      labelKey: 'canvas.consortium.phase_placenta1',
      durationKey: 'canvas.consortium.duration_90d',
    })
    expect(LAST_SUCCESSION_PHASE_INDEX).toBe(6)
  })

  it('clamps phase indexes and right-edge boundaries separately', () => {
    expect(clampSuccessionPhaseIndex(-1)).toBe(0)
    expect(clampSuccessionPhaseIndex(99)).toBe(LAST_SUCCESSION_PHASE_INDEX)
    expect(clampSuccessionPhaseBoundary(-1)).toBe(0)
    expect(clampSuccessionPhaseBoundary(99)).toBe(CONSORTIUM_SUCCESSION_PHASES.length)
  })

  it('owns Stratum ordering and unknown fallback', () => {
    expect(CONSORTIUM_STRATA).toEqual(['emergent', 'high', 'medium', 'low', 'unassigned'])
    expect(DEFAULT_CONSORTIUM_STRATUM).toBe('unassigned')
    expect(stratumToRow('emergent')).toBe(0)
    expect(stratumToRow('unknown')).toBe(stratumToRow(DEFAULT_CONSORTIUM_STRATUM))
    expect(stratumAtRow(-10)).toBe('emergent')
    expect(stratumAtRow(99)).toBe(DEFAULT_CONSORTIUM_STRATUM)
  })

  it('creates default Consortium entries for newly placed species', () => {
    const entry = createDefaultConsortiumEntry('Quercus robur')

    expect(getConsortiumCanonicalName(entry)).toBe('Quercus robur')
    expect(entry.stratum).toBe(DEFAULT_CONSORTIUM_STRATUM)
    expect(entry.start_phase).toBe(DEFAULT_CONSORTIUM_START_PHASE)
    expect(entry.end_phase).toBe(DEFAULT_CONSORTIUM_END_PHASE)
  })
})
