import { describe, it, expect, beforeEach } from 'vitest'
import { currentDesign } from '../state/design'
import { setBudgetCurrency, setPlantBudgetPrice } from '../state/budget-actions'
import type { CanopiFile } from '../types/design'

function makeDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 1,
    name: 'test',
    description: null,
    location: null,
    north_bearing_deg: null,
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('setBudgetCurrency', () => {
  beforeEach(() => {
    currentDesign.value = null
  })

  it('sets budget_currency and updates all item currencies', () => {
    currentDesign.value = makeDesign({
      budget_currency: 'EUR',
      budget: [
        { category: 'plants', description: 'Malus domestica', quantity: 0, unit_cost: 5, currency: 'EUR' },
        { category: 'plants', description: 'Prunus avium', quantity: 0, unit_cost: 3, currency: 'EUR' },
      ],
    })

    setBudgetCurrency('USD')

    const design = currentDesign.value!
    const budget = design.budget!
    expect(design.budget_currency).toBe('USD')
    expect(budget[0]!.currency).toBe('USD')
    expect(budget[1]!.currency).toBe('USD')
  })

  it('sets budget_currency on a design with no budget items', () => {
    currentDesign.value = makeDesign()

    setBudgetCurrency('GBP')

    expect(currentDesign.value!.budget_currency).toBe('GBP')
    expect(currentDesign.value!.budget).toEqual([])
  })

  it('does not convert unit costs', () => {
    currentDesign.value = makeDesign({
      budget: [
        { category: 'plants', description: 'Malus domestica', quantity: 0, unit_cost: 5, currency: 'EUR' },
      ],
    })

    setBudgetCurrency('USD')

    expect(currentDesign.value!.budget![0]!.unit_cost).toBe(5)
  })

  it('is a no-op when no design is loaded', () => {
    currentDesign.value = null
    expect(() => setBudgetCurrency('USD')).not.toThrow()
    expect(currentDesign.value).toBeNull()
  })
})

describe('setPlantBudgetPrice', () => {
  beforeEach(() => {
    currentDesign.value = null
  })

  it('upserts a plant budget item using document currency', () => {
    currentDesign.value = makeDesign({ budget_currency: 'USD' })

    setPlantBudgetPrice('Malus domestica', 7.5)

    const budget = currentDesign.value!.budget!
    expect(budget).toHaveLength(1)
    expect(budget[0]!.description).toBe('Malus domestica')
    expect(budget[0]!.unit_cost).toBe(7.5)
    expect(budget[0]!.currency).toBe('USD')
  })

  it('defaults to EUR and sets budget_currency when absent', () => {
    currentDesign.value = makeDesign()

    setPlantBudgetPrice('Malus domestica', 5)

    expect(currentDesign.value!.budget![0]!.currency).toBe('EUR')
    expect(currentDesign.value!.budget_currency).toBe('EUR')
  })

  it('updates an existing item', () => {
    currentDesign.value = makeDesign({
      budget: [
        { category: 'plants', description: 'Malus domestica', quantity: 0, unit_cost: 5, currency: 'EUR' },
      ],
    })

    setPlantBudgetPrice('Malus domestica', 10)

    const budget = currentDesign.value!.budget!
    expect(budget).toHaveLength(1)
    expect(budget[0]!.unit_cost).toBe(10)
  })

  it('preserves existing quantity when updating price', () => {
    currentDesign.value = makeDesign({
      budget: [
        { category: 'plants', description: 'Malus domestica', quantity: 3, unit_cost: 5, currency: 'EUR' },
      ],
    })

    setPlantBudgetPrice('Malus domestica', 10)

    expect(currentDesign.value!.budget![0]!.quantity).toBe(3)
    expect(currentDesign.value!.budget![0]!.unit_cost).toBe(10)
  })

  it('clamps negative prices to zero', () => {
    currentDesign.value = makeDesign()
    setPlantBudgetPrice('Malus domestica', -5)
    expect(currentDesign.value!.budget![0]!.unit_cost).toBe(0)
  })

  it('clamps NaN prices to zero', () => {
    currentDesign.value = makeDesign()
    setPlantBudgetPrice('Malus domestica', NaN)
    expect(currentDesign.value!.budget![0]!.unit_cost).toBe(0)
  })

  it('clamps Infinity prices to zero', () => {
    currentDesign.value = makeDesign()
    setPlantBudgetPrice('Malus domestica', Infinity)
    expect(currentDesign.value!.budget![0]!.unit_cost).toBe(0)
  })
})
