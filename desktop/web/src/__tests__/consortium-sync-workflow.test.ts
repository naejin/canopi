import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { currentDesign, nonCanvasRevision } from '../state/design'
import { sceneEntityRevision } from '../state/canvas'
import { currentCanvasSession } from '../canvas/session'
import { installConsortiumSync, disposeConsortiumSync } from '../state/consortium-sync-workflow'
import type { CanopiFile, PlacedPlant } from '../types/design'

function makeDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 1,
    name: 'test',
    description: null,
    location: null,
    north_bearing_deg: 0,
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
    ...overrides,
  }
}

function makePlant(canonical_name: string): PlacedPlant {
  return {
    id: `plant-${canonical_name}`,
    canonical_name,
    common_name: null,
    color: null,
    position: { x: 0, y: 0 },
    rotation: null,
    scale: null,
    notes: null,
    planted_date: null,
    quantity: null,
  }
}

function mockSession(plants: PlacedPlant[]) {
  return {
    getPlacedPlants: () => plants,
  } as any
}

describe('consortium-sync-workflow', () => {
  beforeEach(() => {
    nonCanvasRevision.value = 0
    sceneEntityRevision.value = 0
    currentDesign.value = null
    ;(currentCanvasSession as any).value = null
  })

  afterEach(() => {
    disposeConsortiumSync()
  })

  it('adds consortium entries for new plant species', () => {
    const plants = [makePlant('Quercus robur'), makePlant('Acer campestre')]
    currentDesign.value = makeDesign()
    ;(currentCanvasSession as any).value = mockSession(plants)

    installConsortiumSync()
    sceneEntityRevision.value += 1

    const consortiums = currentDesign.value!.consortiums
    expect(consortiums).toHaveLength(2)
    expect(consortiums.map((c) => c.canonical_name).sort()).toEqual(['Acer campestre', 'Quercus robur'])
    expect(consortiums[0]!.stratum).toBe('unassigned')
  })

  it('removes orphan consortium entries when species are deleted', () => {
    currentDesign.value = makeDesign({
      consortiums: [
        { canonical_name: 'Quercus robur', stratum: 'high', start_phase: 0, end_phase: 3 },
        { canonical_name: 'Acer campestre', stratum: 'medium', start_phase: 0, end_phase: 2 },
      ],
    })
    // Only Quercus remains on canvas
    ;(currentCanvasSession as any).value = mockSession([makePlant('Quercus robur')])

    installConsortiumSync()
    sceneEntityRevision.value += 1

    const consortiums = currentDesign.value!.consortiums
    expect(consortiums).toHaveLength(1)
    expect(consortiums[0]!.canonical_name).toBe('Quercus robur')
  })

  it('does not increment nonCanvasRevision (markDirty: false)', () => {
    currentDesign.value = makeDesign()
    ;(currentCanvasSession as any).value = mockSession([makePlant('Quercus robur')])

    installConsortiumSync()
    sceneEntityRevision.value += 1

    expect(nonCanvasRevision.value).toBe(0)
  })

  it('is a no-op when plant set has not changed', () => {
    const plants = [makePlant('Quercus robur')]
    currentDesign.value = makeDesign({
      consortiums: [{ canonical_name: 'Quercus robur', stratum: 'high', start_phase: 0, end_phase: 3 }],
    })
    ;(currentCanvasSession as any).value = mockSession(plants)

    installConsortiumSync()
    // First tick — names match existing consortiums
    sceneEntityRevision.value += 1
    const snapshotAfterFirst = currentDesign.value

    // Second tick — no change
    sceneEntityRevision.value += 1
    expect(currentDesign.value).toBe(snapshotAfterFirst)
  })

  it('disposes cleanly without errors', () => {
    installConsortiumSync()
    expect(() => disposeConsortiumSync()).not.toThrow()
    // Double dispose is safe
    expect(() => disposeConsortiumSync()).not.toThrow()
  })
})
