import { describe, expect, it } from 'vitest'
import type { CanopiFile } from '../types/design'
import { createLiveTestCanvasRuntimeHost } from './support/live-canvas-runtime'

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
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
    extra: {},
  }
}

describe('serializer species color defaults', () => {
  it('persists document species color defaults into the canonical scene payload', () => {
    const host = createLiveTestCanvasRuntimeHost()
    const { commands, documents } = host.surfaces

    try {
      documents.loadDocument(makeDoc())
      commands.plantPresentation.setPlantColorForSpecies('Malus domestica', '#C44230')

      const file = documents.serializeDocument({ name: 'Test' }, makeDoc())

      expect(file.plant_species_colors).toEqual({ 'Malus domestica': '#C44230' })
    } finally {
      host.destroy()
    }
  })
})
