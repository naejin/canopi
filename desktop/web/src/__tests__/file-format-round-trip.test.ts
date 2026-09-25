import { encodeCanopiDesign } from '../app/contracts/canopi-design-wire'
import { describe, expect, it } from 'vitest'
import { decodeCanopiDesign } from '../app/contracts/design-ingestion'
import { hydrateSceneFromDesign, serializeScenePersistedState } from '../canvas/runtime/scene/codec'
import { CURRENT_CANOPI_FILE_VERSION } from '../generated/canopi-design-format'
import type { CanopiFile } from '../types/design'
import { geoAt } from './support/geo-design'

// Minimal fixture covering one of each entity type, with both populated and null optional fields.
// Non-canvas sections are placeholders here because the scene codec no longer owns them.
const FIXTURE: CanopiFile = {
  version: 7,
  name: 'Round-trip test',
  description: 'A test design',
  plant_species_colors: {
    'Quercus robur': '#228833',
    'Malus domestica': '#AA4422',
  },
  plant_species_codes: { 'Malus domestica': 'MDO', 'Quercus robur': 'QRO' },
  plant_species_symbols: {
    'Quercus robur': 'tree',
    'Malus domestica': 'climber',
  },
  layers: [
    { name: 'base', visible: true, locked: false, opacity: 1 },
    { name: 'contours', visible: false, locked: true, opacity: 0.5 },
  ],
  plants: [
    {
      id: 'plant-1',
      canonical_name: 'Quercus robur',
      common_name: 'English Oak',
      color: '#228833',
      symbol: 'square',
      pinned_name: false,
      position: geoAt(100, 200),
      rotation: 45,
      scale: 3.5,
      notes: 'Near the pond',
      planted_date: '2025-03-15',
      quantity: 1,
      locked: false,
    },
    {
      id: 'plant-2',
      canonical_name: 'Malus domestica',
      common_name: null,
      color: null,
      pinned_name: false,
      position: geoAt(-50.5, 300.75),
      rotation: null,
      scale: null,
      notes: null,
      planted_date: null,
      quantity: 3,
      locked: false,
    },
  ],
  zones: [
    {
      name: 'Orchard',
      zone_type: 'planting',
      rotation: 0,
      points: [geoAt(0, 0), geoAt(100, 0), geoAt(100, 100)],
      fill_color: '#99CC66',
      notes: 'Main orchard area',
      locked: false,
    },
  ],
  annotations: [
    {
      id: 'ann-1',
      annotation_type: 'text',
      position: geoAt(50, 50),
      text: 'North boundary',
      font_size: 16,
      rotation: -10,
      locked: false,
    },
  ],
  measurement_guides: [
    {
      id: 'measurement-guide-1',
      locked: false,
      start: geoAt(-10, 5),
      end: geoAt(25, 5),
    },
  ],
  groups: [
    {
      id: 'group-1',
      locked: false,
      name: 'Fruit trees',
      members: [
        { kind: 'plant', id: 'plant-1' },
        { kind: 'plant', id: 'plant-2' },
      ],
    },
  ],
  consortiums: [],
  timeline: [],
  budget: [],
  budget_currency: 'EUR',
  created_at: '2026-01-15T10:30:00.000Z',
  updated_at: '2026-02-20T14:45:00.000Z',
  extra: { guides: [{ id: 'guide-1', axis: 'h', lat: 23.0004 }, { id: 'guide-2', axis: 'v', lon: 12.9997 }], future_feature: { nested: true, count: 42 } },
}

describe('file format round-trip', () => {
  it('canvas codec round-trips scene-owned entity fields and guide metadata', () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const hydrated = hydrateSceneFromDesign(FIXTURE)
    const serialized = serializeScenePersistedState(hydrated.persisted, hydrated.geo, { now })

    // updated_at is regenerated from `now`; document-owned metadata is emitted as placeholders.
    // Unchanged lon/lat positions are written back verbatim.
    expect(serialized.updated_at).toBe(now.toISOString())
    expect(serialized).toEqual({
      ...FIXTURE,
      version: 7,
      name: 'Untitled',
      description: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      extra: { guides: [{ id: 'guide-1', axis: 'h', lat: 23.0004 }, { id: 'guide-2', axis: 'v', lon: 12.9997 }] },
    })
    expect(serialized).not.toHaveProperty('spatial_frame')
  })

  it('round-trips a serialized v7 Design through JSON and the Design decoder', () => {
    expect(CURRENT_CANOPI_FILE_VERSION).toBe(7)
    const hydrated = hydrateSceneFromDesign(FIXTURE)
    const serialized = serializeScenePersistedState(hydrated.persisted, hydrated.geo, {
      now: new Date('2026-04-09T12:00:00.000Z'),
    })

    const decoded = decodeCanopiDesign(JSON.parse(JSON.stringify(encodeCanopiDesign(serialized))))

    expect(decoded.version).toBe(7)
    expect(decoded.plants.map((plant) => plant.position)).toEqual(FIXTURE.plants.map((plant) => plant.position))
    expect(decoded.zones).toEqual(serialized.zones)
    expect(decoded.annotations).toEqual(serialized.annotations)
    expect(decoded.measurement_guides).toEqual(serialized.measurement_guides)

    const rehydrated = hydrateSceneFromDesign(decoded)
    expect(rehydrated.persisted.plants.map((plant) => plant.position))
      .toEqual(hydrated.persisted.plants.map((plant) => plant.position))
  })
})
