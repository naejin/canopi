import { describe, expect, it } from 'vitest'
import { computeLayout, groupActionsBySpecies } from '../canvas/timeline-renderer'
import type { TimelineAction } from '../types/design'

function makeAction(overrides: Partial<TimelineAction> = {}): TimelineAction {
  return {
    id: 'a1',
    action_type: 'planting',
    description: 'Test',
    start_date: '2026-01-01',
    end_date: '2026-02-01',
    recurrence: null,
    plants: null,
    zone: null,
    depends_on: null,
    completed: false,
    order: 0,
    ...overrides,
  }
}

describe('computeLayout', () => {
  it('assigns non-overlapping actions to the same sub-lane', () => {
    const rows = groupActionsBySpecies([
      makeAction({ id: 'a1', start_date: '2026-01-01', end_date: '2026-02-01' }),
      makeAction({ id: 'a2', start_date: '2026-03-01', end_date: '2026-04-01' }),
    ])
    const layout = computeLayout(rows)
    expect(layout.get('a1')!.subLane).toBe(0)
    expect(layout.get('a2')!.subLane).toBe(0)
    expect(layout.get('a1')!.totalSubLanes).toBe(1)
  })

  it('stacks overlapping actions into separate sub-lanes', () => {
    const rows = groupActionsBySpecies([
      makeAction({ id: 'a1', start_date: '2026-01-01', end_date: '2026-03-01' }),
      makeAction({ id: 'a2', start_date: '2026-02-01', end_date: '2026-04-01' }),
    ])
    const layout = computeLayout(rows)
    expect(layout.get('a1')!.subLane).toBe(0)
    expect(layout.get('a2')!.subLane).toBe(1)
    expect(layout.get('a1')!.totalSubLanes).toBe(2)
  })

  it('dateless actions do not block lanes for subsequent actions', () => {
    const rows = groupActionsBySpecies([
      makeAction({ id: 'a1', start_date: '2026-01-01', end_date: '2026-02-01' }),
      makeAction({ id: 'dateless', start_date: null, end_date: null }),
      makeAction({ id: 'a3', start_date: '2026-03-01', end_date: '2026-04-01' }),
    ])
    const layout = computeLayout(rows)
    // dateless sorts last (Infinity), a3 should reuse lane 0 not be forced to a new lane
    expect(layout.get('a1')!.subLane).toBe(0)
    expect(layout.get('a3')!.subLane).toBe(0)
    // dateless gets its own lane but doesn't permanently block it
    expect(layout.get('dateless')!.totalSubLanes).toBeLessThanOrEqual(2)
  })
})
