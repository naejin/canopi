import { beforeEach, describe, expect, it } from 'vitest'
import { currentDesign, nonCanvasRevision } from '../state/design'
import { upsertConsortiumEntry, deleteConsortiumEntry, moveConsortiumEntry } from '../state/consortium-actions'

beforeEach(() => {
  nonCanvasRevision.value = 0
  currentDesign.value = {
    version: 1,
    name: 'test',
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: {},
    layers: [],
    plants: [{
      id: 'plant-1',
      canonical_name: 'Quercus robur',
      common_name: 'English oak',
      color: null,
      position: { x: 0, y: 0 },
      rotation: null,
      scale: null,
      notes: null,
      planted_date: null,
      quantity: null,
    }],
    zones: [],
    timeline: [],
    budget: [],
    created_at: '',
    updated_at: '',
  }
})

describe('consortium actions', () => {
  it('upserts a new consortium entry', () => {
    upsertConsortiumEntry({ canonical_name: 'Quercus robur', stratum: 'high', start_phase: 0, end_phase: 3 })

    expect(currentDesign.value?.consortiums).toHaveLength(1)
    expect(nonCanvasRevision.value).toBe(1)
  })

  it('updates existing entry by canonical_name', () => {
    upsertConsortiumEntry({ canonical_name: 'Quercus robur', stratum: 'high', start_phase: 0, end_phase: 3 })
    upsertConsortiumEntry({ canonical_name: 'Quercus robur', stratum: 'medium', start_phase: 0, end_phase: 3 })

    expect(currentDesign.value?.consortiums).toHaveLength(1)
    expect(currentDesign.value!.consortiums![0]!.stratum).toBe('medium')
    expect(nonCanvasRevision.value).toBe(2)
  })

  it('deletes an entry by canonical_name', () => {
    upsertConsortiumEntry({ canonical_name: 'Quercus robur', stratum: 'high', start_phase: 0, end_phase: 3 })
    deleteConsortiumEntry('Quercus robur')

    expect(currentDesign.value?.consortiums).toHaveLength(0)
    expect(nonCanvasRevision.value).toBe(2)
  })

  it('moves an entry to a new stratum and phase range', () => {
    upsertConsortiumEntry({ canonical_name: 'Quercus robur', stratum: 'high', start_phase: 0, end_phase: 3 })
    moveConsortiumEntry('Quercus robur', { stratum: 'medium', startPhase: 2, endPhase: 5 })

    const entry = currentDesign.value?.consortiums?.[0]
    expect(entry?.stratum).toBe('medium')
    expect(entry?.start_phase).toBe(2)
    expect(entry?.end_phase).toBe(5)
  })

  it('preserves existing stratum when stratum is omitted', () => {
    upsertConsortiumEntry({ canonical_name: 'Quercus robur', stratum: 'high', start_phase: 0, end_phase: 3 })
    moveConsortiumEntry('Quercus robur', { startPhase: 1, endPhase: 4 })

    expect(currentDesign.value!.consortiums![0]!.stratum).toBe('high')
  })

  it('respects markDirty: false option', () => {
    upsertConsortiumEntry({ canonical_name: 'Quercus robur', stratum: 'high', start_phase: 0, end_phase: 3 }, { markDirty: false })

    expect(nonCanvasRevision.value).toBe(0)
  })
})
