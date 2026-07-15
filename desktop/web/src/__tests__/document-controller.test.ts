import { beforeEach, describe, expect, it } from 'vitest'
import {
  editCurrentDesign,
  editDesignArray,
  reconcileCurrentDesign,
} from '../app/design-edit'
import { speciesBudgetTarget } from '../target'
import {
  designSessionFixture,
  currentDesign,
  nonCanvasRevision,
} from './support/design-session-state'

beforeEach(() => {
  designSessionFixture.nonCanvasRevision = 0
  designSessionFixture.file = {
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
    created_at: '',
    updated_at: '',
    extra: {},
  }
})

describe('Design Edit core', () => {
  it('skips dirty revision when mutation returns the same design', () => {
    const design = currentDesign.value!

    const next = editCurrentDesign((current) => current)

    expect(next).toBe(design)
    expect(nonCanvasRevision.value).toBe(0)
  })

  it('reconciles derived Design content without recording user intent', () => {
    reconcileCurrentDesign((design) => ({ ...design, name: 'updated' }))

    expect(currentDesign.value?.name).toBe('updated')
    expect(nonCanvasRevision.value).toBe(0)
  })

  it('avoids dirty revision for no-op array updates', () => {
    editDesignArray('timeline', (timeline) => timeline)

    expect(nonCanvasRevision.value).toBe(0)
  })

  it('records user intent for changed array updates', () => {
    editDesignArray('budget', () => [{
      target: speciesBudgetTarget('Quercus robur'),
      category: 'plants',
      description: 'Quercus robur',
      quantity: 1,
      unit_cost: 42,
      currency: 'EUR',
    }])

    expect(currentDesign.value?.budget).toHaveLength(1)
    expect(nonCanvasRevision.value).toBe(1)
  })
})
