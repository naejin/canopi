import { beforeEach, describe, expect, it } from 'vitest'
import { currentDesign, nonCanvasRevision } from '../state/design'
import { upsertConsortiumEntry, deleteConsortiumEntry, moveConsortiumEntry, reorderConsortiumEntry } from '../state/consortium-actions'
import { consortiumTarget, getConsortiumCanonicalName } from '../panel-targets'
import type { Consortium } from '../types/design'

function consortium(canonicalName: string, overrides: Partial<Omit<Consortium, 'target'>> = {}): Consortium {
  return {
    target: consortiumTarget(canonicalName),
    stratum: 'high',
    start_phase: 0,
    end_phase: 3,
    ...overrides,
  }
}

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

describe('consortium actions', () => {
  it('upserts a new consortium entry', () => {
    upsertConsortiumEntry(consortium('Quercus robur'))

    expect(currentDesign.value?.consortiums).toHaveLength(1)
    expect(nonCanvasRevision.value).toBe(1)
  })

  it('updates existing entry by canonical_name', () => {
    upsertConsortiumEntry(consortium('Quercus robur'))
    upsertConsortiumEntry(consortium('Quercus robur', { stratum: 'medium' }))

    expect(currentDesign.value?.consortiums).toHaveLength(1)
    expect(currentDesign.value!.consortiums[0]!.stratum).toBe('medium')
    expect(nonCanvasRevision.value).toBe(2)
  })

  it('deletes an entry by canonical_name', () => {
    upsertConsortiumEntry(consortium('Quercus robur'))
    deleteConsortiumEntry('Quercus robur')

    expect(currentDesign.value?.consortiums).toHaveLength(0)
    expect(nonCanvasRevision.value).toBe(2)
  })

  it('moves an entry to a new stratum and phase range', () => {
    upsertConsortiumEntry(consortium('Quercus robur'))
    moveConsortiumEntry('Quercus robur', { stratum: 'medium', startPhase: 2, endPhase: 5 })

    const entry = currentDesign.value!.consortiums[0]!
    expect(entry.stratum).toBe('medium')
    expect(entry.start_phase).toBe(2)
    expect(entry.end_phase).toBe(5)
  })

  it('preserves existing stratum when stratum is omitted', () => {
    upsertConsortiumEntry(consortium('Quercus robur'))
    moveConsortiumEntry('Quercus robur', { startPhase: 1, endPhase: 4 })

    expect(currentDesign.value!.consortiums[0]!.stratum).toBe('high')
  })

  it('respects markDirty: false option', () => {
    upsertConsortiumEntry(consortium('Quercus robur'), { markDirty: false })

    expect(nonCanvasRevision.value).toBe(0)
  })

  it('upsertConsortiumEntry is a no-op when values unchanged', () => {
    const entry = consortium('Quercus robur')
    upsertConsortiumEntry(entry)
    nonCanvasRevision.value = 0

    upsertConsortiumEntry(entry)
    expect(nonCanvasRevision.value).toBe(0)
  })

  it('moveConsortiumEntry is a no-op when canonical_name not found', () => {
    upsertConsortiumEntry(consortium('Quercus robur'))
    nonCanvasRevision.value = 0
    moveConsortiumEntry('Nonexistent', { stratum: 'medium', startPhase: 1, endPhase: 4 })

    expect(nonCanvasRevision.value).toBe(0)
  })

  it('moveConsortiumEntry is a no-op when values unchanged', () => {
    upsertConsortiumEntry(consortium('Quercus robur'))
    nonCanvasRevision.value = 0
    moveConsortiumEntry('Quercus robur', { stratum: 'high', startPhase: 0, endPhase: 3 })

    expect(nonCanvasRevision.value).toBe(0)
  })

  it('moveConsortiumEntry respects markDirty: false', () => {
    upsertConsortiumEntry(consortium('Quercus robur'))
    nonCanvasRevision.value = 0
    moveConsortiumEntry('Quercus robur', { stratum: 'medium', startPhase: 1, endPhase: 4 }, { markDirty: false })

    expect(nonCanvasRevision.value).toBe(0)
    expect(currentDesign.value!.consortiums[0]!.stratum).toBe('medium')
  })

  it('deleteConsortiumEntry is a no-op when canonical_name not found', () => {
    upsertConsortiumEntry(consortium('Quercus robur'))
    nonCanvasRevision.value = 0
    deleteConsortiumEntry('Nonexistent')

    expect(nonCanvasRevision.value).toBe(0)
    expect(currentDesign.value!.consortiums).toHaveLength(1)
  })
})

describe('reorderConsortiumEntry', () => {
  beforeEach(() => {
    upsertConsortiumEntry(consortium('Acer campestre', { start_phase: 0, end_phase: 2 }))
    upsertConsortiumEntry(consortium('Betula pendula'))
    upsertConsortiumEntry(consortium('Corylus avellana', { stratum: 'medium', start_phase: 1, end_phase: 4 }))
    nonCanvasRevision.value = 0
  })

  it('moves an entry from index 0 to index 2', () => {
    reorderConsortiumEntry('Acer campestre', 2)

    const names = currentDesign.value!.consortiums.map(getConsortiumCanonicalName)
    expect(names).toEqual(['Betula pendula', 'Corylus avellana', 'Acer campestre'])
    expect(nonCanvasRevision.value).toBe(1)
  })

  it('moves an entry from index 2 to index 0', () => {
    reorderConsortiumEntry('Corylus avellana', 0)

    const names = currentDesign.value!.consortiums.map(getConsortiumCanonicalName)
    expect(names).toEqual(['Corylus avellana', 'Acer campestre', 'Betula pendula'])
  })

  it('is a no-op when entry not found', () => {
    reorderConsortiumEntry('Nonexistent species', 1)

    const names = currentDesign.value!.consortiums.map(getConsortiumCanonicalName)
    expect(names).toEqual(['Acer campestre', 'Betula pendula', 'Corylus avellana'])
    expect(nonCanvasRevision.value).toBe(0)
  })

  it('is a no-op when target index equals current index', () => {
    reorderConsortiumEntry('Betula pendula', 1)

    const names = currentDesign.value!.consortiums.map(getConsortiumCanonicalName)
    expect(names).toEqual(['Acer campestre', 'Betula pendula', 'Corylus avellana'])
    expect(nonCanvasRevision.value).toBe(0)
  })

  it('respects markDirty: false option', () => {
    reorderConsortiumEntry('Acer campestre', 2, { markDirty: false })

    expect(nonCanvasRevision.value).toBe(0)
    const names = currentDesign.value!.consortiums.map(getConsortiumCanonicalName)
    expect(names).toEqual(['Betula pendula', 'Corylus avellana', 'Acer campestre'])
  })
})
