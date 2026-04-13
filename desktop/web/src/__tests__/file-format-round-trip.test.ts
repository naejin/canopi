import { describe, expect, it } from 'vitest'
import { hydrateScenePersistedState, serializeScenePersistedState } from '../canvas/runtime/scene/codec'
import type { CanopiFile } from '../types/design'

// Minimal fixture covering one of each entity type, with both populated and null optional fields.
// Non-canvas sections are placeholders here because the scene codec no longer owns them.
const FIXTURE: CanopiFile = {
  version: 2,
  name: 'Round-trip test',
  description: 'A test design',
  location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
  north_bearing_deg: 14,
  plant_species_colors: {
    'Quercus robur': '#228833',
    'Malus domestica': '#AA4422',
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
      position: { x: 100, y: 200 },
      rotation: 45,
      scale: 3.5,
      notes: 'Near the pond',
      planted_date: '2025-03-15',
      quantity: 1,
    },
    {
      id: 'plant-2',
      canonical_name: 'Malus domestica',
      common_name: null,
      color: null,
      position: { x: -50.5, y: 300.75 },
      rotation: null,
      scale: null,
      notes: null,
      planted_date: null,
      quantity: 3,
    },
  ],
  zones: [
    {
      name: 'Orchard',
      zone_type: 'planting',
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
      fill_color: '#99CC66',
      notes: 'Main orchard area',
    },
  ],
  annotations: [
    {
      id: 'ann-1',
      annotation_type: 'text',
      position: { x: 50, y: 50 },
      text: 'North boundary',
      font_size: 16,
      rotation: -10,
    },
  ],
  groups: [
    {
      id: 'group-1',
      name: 'Fruit trees',
      layer: 'plants',
      position: { x: 25, y: 110 },
      rotation: null,
      member_ids: ['plant-1', 'plant-2'],
    },
  ],
  consortiums: [],
  timeline: [],
  budget: [],
  created_at: '2026-01-15T10:30:00.000Z',
  updated_at: '2026-02-20T14:45:00.000Z',
  extra: { guides: [{ id: 'guide-1', axis: 'h', position: 42 }], future_feature: { nested: true, count: 42 } },
}

describe('file format round-trip', () => {
  it('canvas codec round-trips scene-owned entity fields and guide metadata', () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const serialized = serializeScenePersistedState(
      hydrateScenePersistedState(FIXTURE),
      { now },
    )

    // updated_at is regenerated from `now`; document-owned metadata is emitted as placeholders.
    expect(serialized.updated_at).toBe(now.toISOString())
    expect(serialized).toEqual({
      ...FIXTURE,
      name: 'Untitled',
      description: null,
      location: null,
      north_bearing_deg: 0,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      extra: { guides: [{ id: 'guide-1', axis: 'h', position: 42 }] },
    })
  })
})
