import { describe, expect, it } from 'vitest'
import {
  MANUAL_TARGET,
  NONE_TARGET,
  getBudgetHoverTarget,
  getTimelineHoverTargets,
  speciesBudgetTarget,
  speciesTarget,
} from '../panel-targets'
import type { BudgetItem, TimelineAction } from '../types/design'

function makeAction(overrides: Partial<TimelineAction> = {}): TimelineAction {
  return {
    id: 'task-1',
    action_type: 'planting',
    description: 'Plant apple',
    start_date: '2026-04-10',
    end_date: null,
    recurrence: null,
    targets: [MANUAL_TARGET],
    depends_on: null,
    completed: false,
    order: 0,
    ...overrides,
  }
}

function makeBudgetItem(overrides: Partial<BudgetItem> = {}): BudgetItem {
  return {
    target: speciesBudgetTarget('Malus domestica'),
    category: 'plants',
    description: 'Malus domestica',
    quantity: 0,
    unit_cost: 5,
    currency: 'EUR',
    ...overrides,
  }
}

describe('panel target hover helpers', () => {
  it('returns timeline action targets as-is for hover', () => {
    const targets = [speciesTarget('Malus domestica'), MANUAL_TARGET, NONE_TARGET]
    const action = makeAction({ targets })

    expect(getTimelineHoverTargets(action)).toBe(targets)
  })

  it('prefers the existing budget item target for hover', () => {
    const target = { kind: 'placed_plant', plant_id: 'plant-1' } as const
    const item = makeBudgetItem({ target })

    expect(getBudgetHoverTarget(item, 'Malus domestica')).toBe(target)
  })

  it('falls back to a species budget target for grouped plant rows without budget items', () => {
    expect(getBudgetHoverTarget(null, 'Malus domestica')).toEqual(speciesBudgetTarget('Malus domestica'))
  })
})
