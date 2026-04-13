import { beforeEach, describe, expect, it } from 'vitest'
import { mutateCurrentDesign, updateDesignArray } from '../app/document/controller'
import { speciesBudgetTarget } from '../panel-targets'
import { currentDesign, nonCanvasRevision } from '../state/design'

beforeEach(() => {
  nonCanvasRevision.value = 0
  currentDesign.value = {
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
    created_at: '',
    updated_at: '',
    extra: {},
  }
})

describe('document controller', () => {
  it('skips dirty revision when mutation returns the same design', () => {
    const design = currentDesign.value!

    const next = mutateCurrentDesign((current) => current)

    expect(next).toBe(design)
    expect(nonCanvasRevision.value).toBe(0)
  })

  it('supports markDirty: false for whole-design updates', () => {
    mutateCurrentDesign((design) => ({ ...design, name: 'updated' }), { markDirty: false })

    expect(currentDesign.value?.name).toBe('updated')
    expect(nonCanvasRevision.value).toBe(0)
  })

  it('avoids dirty revision for no-op array updates', () => {
    updateDesignArray('timeline', (timeline) => timeline)

    expect(nonCanvasRevision.value).toBe(0)
  })

  it('supports markDirty: false for array updates', () => {
    updateDesignArray('budget', () => [{
      target: speciesBudgetTarget('Quercus robur'),
      category: 'plants',
      description: 'Quercus robur',
      quantity: 1,
      unit_cost: 42,
      currency: 'EUR',
    }], { markDirty: false })

    expect(currentDesign.value?.budget).toHaveLength(1)
    expect(nonCanvasRevision.value).toBe(0)
  })
})
