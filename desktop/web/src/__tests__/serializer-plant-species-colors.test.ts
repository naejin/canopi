import { beforeEach, describe, expect, it } from 'vitest'
import { SceneCanvasRuntime } from '../canvas/runtime/scene-runtime'
import { plantSpeciesColors } from '../state/canvas'
import type { CanopiFile } from '../types/design'

function makeDoc(): CanopiFile {
  return {
    version: 1,
    name: 'Test',
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
    extra: {},
  }
}

describe('serializer species color defaults', () => {
  beforeEach(() => {
    plantSpeciesColors.value = {}
  })

  it('persists document species color defaults into the canonical scene payload', () => {
    const runtime = new SceneCanvasRuntime()
    runtime.loadDocument(makeDoc())
    runtime.setPlantColorForSpecies('Malus domestica', '#C44230')

    const file = runtime.serializeDocument({ name: 'Test' }, makeDoc())

    expect(file.plant_species_colors).toEqual({ 'Malus domestica': '#C44230' })
  })
})
