import { describe, it, expect, beforeEach } from 'vitest'
import {
  designSessionFixture,
  currentDesign,
} from './support/design-session-state'
import { setBudgetCurrency, setPlantBudgetPrice } from '../app/design-edit'
import type { CanopiFile } from '../types/design'
import { speciesBudgetTarget } from '../target'

function makeDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 2,
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
    budget_currency: 'EUR',
    extra: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('setBudgetCurrency', () => {
  beforeEach(() => {
    designSessionFixture.file = null
  })

  it('sets budget_currency and updates all item currencies', () => {
    designSessionFixture.file = makeDesign({
      budget_currency: 'EUR',
      budget: [
        { target: speciesBudgetTarget('Malus domestica'), category: 'plants', description: 'Malus domestica', quantity: 0, unit_cost: 5, currency: 'EUR' },
        { target: speciesBudgetTarget('Prunus avium'), category: 'plants', description: 'Prunus avium', quantity: 0, unit_cost: 3, currency: 'EUR' },
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
    designSessionFixture.file = makeDesign()

    setBudgetCurrency('GBP')

    expect(currentDesign.value!.budget_currency).toBe('GBP')
    expect(currentDesign.value!.budget).toEqual([])
  })

  it('does not convert unit costs', () => {
    designSessionFixture.file = makeDesign({
      budget: [
        { target: speciesBudgetTarget('Malus domestica'), category: 'plants', description: 'Malus domestica', quantity: 0, unit_cost: 5, currency: 'EUR' },
      ],
    })

    setBudgetCurrency('USD')

    expect(currentDesign.value!.budget![0]!.unit_cost).toBe(5)
  })

  it('is a no-op when no design is loaded', () => {
    designSessionFixture.file = null
    expect(() => setBudgetCurrency('USD')).not.toThrow()
    expect(currentDesign.value).toBeNull()
  })
})

describe('setPlantBudgetPrice', () => {
  beforeEach(() => {
    designSessionFixture.file = null
  })

  it('upserts a plant budget item using document currency', () => {
    designSessionFixture.file = makeDesign({ budget_currency: 'USD' })

    setPlantBudgetPrice('Malus domestica', 7.5)

    const budget = currentDesign.value!.budget!
    expect(budget).toHaveLength(1)
    expect(budget[0]!.description).toBe('Malus domestica')
    expect(budget[0]!.target).toEqual(speciesBudgetTarget('Malus domestica'))
    expect(budget[0]!.unit_cost).toBe(7.5)
    expect(budget[0]!.currency).toBe('USD')
  })

  it('defaults to EUR and sets budget_currency when absent', () => {
    designSessionFixture.file = makeDesign()

    setPlantBudgetPrice('Malus domestica', 5)

    expect(currentDesign.value!.budget![0]!.currency).toBe('EUR')
    expect(currentDesign.value!.budget_currency).toBe('EUR')
  })

  it('updates an existing item', () => {
    designSessionFixture.file = makeDesign({
      budget: [
        { target: speciesBudgetTarget('Malus domestica'), category: 'plants', description: 'Malus domestica', quantity: 0, unit_cost: 5, currency: 'EUR' },
      ],
    })

    setPlantBudgetPrice('Malus domestica', 10)

    const budget = currentDesign.value!.budget!
    expect(budget).toHaveLength(1)
    expect(budget[0]!.unit_cost).toBe(10)
  })

  it('does not overwrite non-plant species-targeted budget items', () => {
    designSessionFixture.file = makeDesign({
      budget: [
        { target: speciesBudgetTarget('Malus domestica'), category: 'materials', description: 'Apple stakes', quantity: 2, unit_cost: 12, currency: 'EUR' },
      ],
    })

    setPlantBudgetPrice('Malus domestica', 10)

    const budget = currentDesign.value!.budget!
    expect(budget).toHaveLength(2)
    expect(budget[0]).toMatchObject({ category: 'materials', description: 'Apple stakes', quantity: 2, unit_cost: 12 })
    expect(budget[1]).toMatchObject({ category: 'plants', description: 'Malus domestica', quantity: 0, unit_cost: 10 })
  })

  it('preserves existing quantity when updating price', () => {
    designSessionFixture.file = makeDesign({
      budget: [
        { target: speciesBudgetTarget('Malus domestica'), category: 'plants', description: 'Malus domestica', quantity: 3, unit_cost: 5, currency: 'EUR' },
      ],
    })

    setPlantBudgetPrice('Malus domestica', 10)

    expect(currentDesign.value!.budget![0]!.quantity).toBe(3)
    expect(currentDesign.value!.budget![0]!.unit_cost).toBe(10)
  })

  it('clamps negative prices to zero', () => {
    designSessionFixture.file = makeDesign()
    setPlantBudgetPrice('Malus domestica', -5)
    expect(currentDesign.value!.budget![0]!.unit_cost).toBe(0)
  })

  it('clamps NaN prices to zero', () => {
    designSessionFixture.file = makeDesign()
    setPlantBudgetPrice('Malus domestica', NaN)
    expect(currentDesign.value!.budget![0]!.unit_cost).toBe(0)
  })

  it('clamps Infinity prices to zero', () => {
    designSessionFixture.file = makeDesign()
    setPlantBudgetPrice('Malus domestica', Infinity)
    expect(currentDesign.value!.budget![0]!.unit_cost).toBe(0)
  })
})
