import { describe, expect, it } from 'vitest'
import {
  buildConsortiumBars,
  hitTestBar,
  computeRowHeights,
  rowY as computeRowY,
  phaseToX,
  xToPhase,
  stratumToRow,
  LABEL_WIDTH,
} from '../canvas/consortium-renderer'
import type { ConsortiumBarLayout } from '../canvas/consortium-renderer'
import type { Consortium, PlacedPlant } from '../types/design'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createConsortium(overrides: Partial<Consortium> = {}): Consortium {
  return {
    canonical_name: 'Malus domestica',
    stratum: 'high',
    start_phase: 0,
    end_phase: 2,
    ...overrides,
  }
}

function createPlant(overrides: Partial<PlacedPlant> = {}): PlacedPlant {
  return {
    id: 'plant-1',
    canonical_name: 'Malus domestica',
    common_name: 'Apple',
    color: null,
    position: { x: 0, y: 0 },
    rotation: null,
    scale: null,
    notes: null,
    planted_date: null,
    quantity: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// buildConsortiumBars
// ---------------------------------------------------------------------------

describe('buildConsortiumBars', () => {
  it('builds bars from entries and plants', () => {
    const entries: Consortium[] = [
      createConsortium({ canonical_name: 'Malus domestica', stratum: 'high', start_phase: 0, end_phase: 3 }),
    ]
    const plants: PlacedPlant[] = [
      createPlant({ id: 'p1', canonical_name: 'Malus domestica', common_name: 'Apple' }),
      createPlant({ id: 'p2', canonical_name: 'Malus domestica', common_name: 'Apple' }),
    ]

    const bars = buildConsortiumBars(entries, plants, {})
    expect(bars).toHaveLength(1)
    expect(bars[0]!.count).toBe(2)
    expect(bars[0]!.commonName).toBe('Apple')
    // With no speciesColors provided, color falls back to stratum color for 'high' (#2E7D32)
    expect(bars[0]!.color).toBe('#2E7D32')
  })

  it('uses speciesColors over stratum fallback', () => {
    const entries: Consortium[] = [
      createConsortium({ canonical_name: 'Malus domestica', stratum: 'high' }),
    ]
    const plants: PlacedPlant[] = [
      createPlant({ canonical_name: 'Malus domestica' }),
    ]
    const speciesColors: Record<string, string> = {
      'Malus domestica': '#FF5733',
    }

    const bars = buildConsortiumBars(entries, plants, speciesColors)
    expect(bars).toHaveLength(1)
    expect(bars[0]!.color).toBe('#FF5733')
  })

  it('assigns sub-lanes for overlapping bars in same stratum', () => {
    const entries: Consortium[] = [
      createConsortium({ canonical_name: 'Malus domestica', stratum: 'medium', start_phase: 0, end_phase: 2 }),
      createConsortium({ canonical_name: 'Prunus avium', stratum: 'medium', start_phase: 0, end_phase: 2 }),
    ]
    const plants: PlacedPlant[] = [
      createPlant({ id: 'p1', canonical_name: 'Malus domestica', common_name: 'Apple' }),
      createPlant({ id: 'p2', canonical_name: 'Prunus avium', common_name: 'Cherry' }),
    ]

    const bars = buildConsortiumBars(entries, plants, {})
    expect(bars).toHaveLength(2)

    const lanes = bars.map((b) => b.subLane).sort()
    expect(lanes).toEqual([0, 1])
    // Both bars should know about the total sub-lanes
    expect(bars[0]!.totalSubLanes).toBe(2)
    expect(bars[1]!.totalSubLanes).toBe(2)
  })

  it('returns empty array for empty inputs', () => {
    const bars = buildConsortiumBars([], [], {})
    expect(bars).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// hitTestBar
// ---------------------------------------------------------------------------

describe('hitTestBar', () => {
  const totalWidth = 800
  const totalHeight = 400
  const contentWidth = totalWidth - LABEL_WIDTH

  /** Build a bar layout with known pixel coordinates for hit testing. */
  function makeBar(overrides: Partial<ConsortiumBarLayout> = {}): ConsortiumBarLayout {
    return {
      canonicalName: 'Malus domestica',
      stratum: 'high',
      startPhase: 1,
      endPhase: 3,
      subLane: 0,
      totalSubLanes: 1,
      color: '#2E7D32',
      commonName: 'Apple',
      count: 1,
      ...overrides,
    }
  }

  it('returns null when no bars exist', () => {
    const rowHeights = computeRowHeights([])
    const result = hitTestBar(200, 100, [], totalWidth, totalHeight, rowHeights)
    expect(result).toBeNull()
  })

  it('detects body hit on a bar', () => {
    const bar = makeBar({ stratum: 'high', startPhase: 1, endPhase: 3 })
    const bars = [bar]
    const rowHeights = computeRowHeights(bars)

    // Compute expected pixel coordinates
    const rowIdx = stratumToRow('high') // 1
    const ry = computeRowY(rowIdx, rowHeights)
    const rh = rowHeights[rowIdx]!
    const x1 = phaseToX(1, contentWidth)
    const x2 = phaseToX(4, contentWidth) // endPhase + 1
    const centerX = (x1 + x2) / 2
    const centerY = ry + rh / 2

    const result = hitTestBar(centerX, centerY, bars, totalWidth, totalHeight, rowHeights)
    expect(result).not.toBeNull()
    expect(result!.edge).toBe('body')
    expect(result!.canonicalName).toBe('Malus domestica')
  })

  it('detects edge hits for resize', () => {
    const bar = makeBar({ stratum: 'high', startPhase: 1, endPhase: 3 })
    const bars = [bar]
    const rowHeights = computeRowHeights(bars)

    const rowIdx = stratumToRow('high')
    const ry = computeRowY(rowIdx, rowHeights)
    const rh = rowHeights[rowIdx]!
    const x1 = phaseToX(1, contentWidth)
    const x2 = phaseToX(4, contentWidth) // endPhase + 1
    const barW = Math.max(x2 - x1, 6)
    const centerY = ry + rh / 2

    // Hit near left edge (within 6px threshold)
    const leftResult = hitTestBar(x1 + 2, centerY, bars, totalWidth, totalHeight, rowHeights)
    expect(leftResult).not.toBeNull()
    expect(leftResult!.edge).toBe('left')

    // Hit near right edge (within 6px threshold)
    const rightResult = hitTestBar(x1 + barW - 2, centerY, bars, totalWidth, totalHeight, rowHeights)
    expect(rightResult).not.toBeNull()
    expect(rightResult!.edge).toBe('right')
  })
})

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

describe('coordinate helpers', () => {
  const contentWidth = 700

  it('phaseToX and xToPhase round-trip', () => {
    for (let phase = 0; phase <= 6; phase++) {
      const x = phaseToX(phase, contentWidth)
      const recovered = xToPhase(x, contentWidth)
      expect(recovered).toBeCloseTo(phase, 2)
    }
  })

  it('stratumToRow maps known strata correctly', () => {
    expect(stratumToRow('emergent')).toBe(0)
    expect(stratumToRow('high')).toBe(1)
    expect(stratumToRow('medium')).toBe(2)
    expect(stratumToRow('low')).toBe(3)
    expect(stratumToRow('unassigned')).toBe(4)
  })

  it('stratumToRow returns unassigned index for unknown strata', () => {
    expect(stratumToRow('unknown')).toBe(4)
    expect(stratumToRow('')).toBe(4)
    expect(stratumToRow('tropical')).toBe(4)
  })
})
