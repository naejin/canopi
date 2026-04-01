import { beforeEach, describe, expect, it } from 'vitest'
import { currentConsortiums, highlightedConsortium } from '../state/canvas'
import { currentDesign, nonCanvasRevision } from '../state/design'
import { deleteConsortium, upsertConsortium } from '../state/consortium-actions'

beforeEach(() => {
  nonCanvasRevision.value = 0
  highlightedConsortium.value = null
  currentConsortiums.value = []
  currentDesign.value = {
    version: 1,
    name: 'test',
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: {},
    layers: [],
    plants: [
      {
        id: 'plant-1',
        canonical_name: 'malus-domestica',
        common_name: 'Apple',
        color: null,
        position: { x: 0, y: 0 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: null,
      },
    ],
    zones: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    created_at: '',
    updated_at: '',
  }
})

describe('consortium actions', () => {
  it('adds and mirrors a consortium through the action boundary', () => {
    upsertConsortium({
      id: 'consortium-1',
      name: 'Orchard guild',
      plant_ids: ['plant-1'],
      notes: 'Supports pollinators',
    })

    expect(currentDesign.value?.consortiums).toHaveLength(1)
    expect(currentConsortiums.value).toHaveLength(1)
    expect(nonCanvasRevision.value).toBe(1)
  })

  it('updates an existing consortium in place', () => {
    upsertConsortium({
      id: 'consortium-1',
      name: 'Orchard guild',
      plant_ids: ['plant-1'],
      notes: null,
    })

    upsertConsortium({
      id: 'consortium-1',
      name: 'Updated guild',
      plant_ids: ['plant-1'],
      notes: 'Updated',
    })

    expect(currentDesign.value?.consortiums[0]?.name).toBe('Updated guild')
    expect(nonCanvasRevision.value).toBe(2)
  })

  it('deletes a consortium and clears highlight state', () => {
    upsertConsortium({
      id: 'consortium-1',
      name: 'Orchard guild',
      plant_ids: ['plant-1'],
      notes: null,
    })
    highlightedConsortium.value = 'consortium-1'

    deleteConsortium('consortium-1')

    expect(currentDesign.value?.consortiums).toEqual([])
    expect(currentConsortiums.value).toEqual([])
    expect(highlightedConsortium.value).toBe(null)
  })
})
