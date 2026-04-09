import { describe, expect, it } from 'vitest'
import { hydrateScenePersistedState, serializeScenePersistedState } from '../canvas/runtime/scene/codec'
import type { CanopiFile } from '../types/design'

const FIXTURE: CanopiFile = {
  version: 2,
  name: 'Round-trip test',
  description: 'A test design with all entity types',
  location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
  north_bearing_deg: 14,
  plant_species_colors: {
    'Quercus robur': '#228833',
    'Malus domestica': '#AA4422',
  },
  layers: [
    { name: 'base', visible: true, locked: false, opacity: 1 },
    { name: 'contours', visible: false, locked: true, opacity: 0.5 },
    { name: 'climate', visible: false, locked: false, opacity: 1 },
    { name: 'zones', visible: true, locked: false, opacity: 0.8 },
    { name: 'water', visible: false, locked: false, opacity: 1 },
    { name: 'plants', visible: true, locked: false, opacity: 1 },
    { name: 'annotations', visible: true, locked: false, opacity: 0.9 },
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
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
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
  consortiums: [
    {
      target: { kind: 'species', canonical_name: 'Quercus robur' },
      stratum: 'high',
      start_phase: 0,
      end_phase: 3,
    },
  ],
  timeline: [
    {
      id: 'task-1',
      action_type: 'mulch',
      description: 'Apply mulch',
      start_date: '2026-04-10',
      end_date: null,
      recurrence: null,
      targets: [{ kind: 'species', canonical_name: 'Quercus robur' }],
      depends_on: null,
      completed: false,
      order: 1,
    },
  ],
  budget: [
    {
      target: { kind: 'species', canonical_name: 'Quercus robur' },
      category: 'plants',
      description: 'Quercus robur',
      quantity: 1,
      unit_cost: 12,
      currency: 'EUR',
    },
  ],
  created_at: '2026-01-15T10:30:00.000Z',
  updated_at: '2026-02-20T14:45:00.000Z',
  extra: { future_feature: { nested: true, count: 42 } },
}

describe('file format round-trip', () => {
  it('canvas codec round-trips all entity types', () => {
    const hydrated = hydrateScenePersistedState(FIXTURE)
    const serialized = serializeScenePersistedState(hydrated, {
      now: new Date('2026-04-09T12:00:00.000Z'),
    })

    // Plants
    expect(serialized.plants).toHaveLength(2)
    const p1 = serialized.plants[0]!
    expect(p1.id).toBe('plant-1')
    expect(p1.canonical_name).toBe('Quercus robur')
    expect(p1.common_name).toBe('English Oak')
    expect(p1.color).toBe('#228833')
    expect(p1.position).toEqual({ x: 100, y: 200 })
    expect(p1.rotation).toBe(45)
    expect(p1.scale).toBe(3.5)
    expect(p1.notes).toBe('Near the pond')
    expect(p1.planted_date).toBe('2025-03-15')
    expect(p1.quantity).toBe(1)

    const p2 = serialized.plants[1]!
    expect(p2.common_name).toBeNull()
    expect(p2.color).toBeNull()
    expect(p2.position).toEqual({ x: -50.5, y: 300.75 })
    expect(p2.rotation).toBeNull()
    expect(p2.scale).toBeNull()
    expect(p2.notes).toBeNull()
    expect(p2.planted_date).toBeNull()
    expect(p2.quantity).toBe(3)

    // Zones
    expect(serialized.zones).toHaveLength(1)
    const z = serialized.zones[0]!
    expect(z.name).toBe('Orchard')
    expect(z.zone_type).toBe('planting')
    expect(z.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ])
    expect(z.fill_color).toBe('#99CC66')
    expect(z.notes).toBe('Main orchard area')

    // Annotations
    expect(serialized.annotations).toHaveLength(1)
    const a = serialized.annotations[0]!
    expect(a.id).toBe('ann-1')
    expect(a.annotation_type).toBe('text')
    expect(a.position).toEqual({ x: 50, y: 50 })
    expect(a.text).toBe('North boundary')
    expect(a.font_size).toBe(16)
    expect(a.rotation).toBe(-10)

    // Groups
    expect(serialized.groups).toHaveLength(1)
    const g = serialized.groups[0]!
    expect(g.id).toBe('group-1')
    expect(g.name).toBe('Fruit trees')
    expect(g.layer).toBe('plants')
    expect(g.position).toEqual({ x: 25, y: 110 })
    expect(g.rotation).toBeNull()
    expect(g.member_ids).toEqual(['plant-1', 'plant-2'])

    // Layers
    expect(serialized.layers).toHaveLength(7)
    expect(serialized.layers[0]).toEqual({ name: 'base', visible: true, locked: false, opacity: 1 })
    expect(serialized.layers[1]).toEqual({ name: 'contours', visible: false, locked: true, opacity: 0.5 })
    expect(serialized.layers[3]).toEqual({ name: 'zones', visible: true, locked: false, opacity: 0.8 })
    expect(serialized.layers[6]).toEqual({ name: 'annotations', visible: true, locked: false, opacity: 0.9 })

    // Location (with null altitude_m) and bearing
    expect(serialized.location).toEqual({ lat: 48.8566, lon: 2.3522, altitude_m: null })
    expect(serialized.north_bearing_deg).toBe(14)

    // Metadata scalars
    expect(serialized.name).toBe('Round-trip test')
    expect(serialized.description).toBe('A test design with all entity types')

    // Plant species colors
    expect(serialized.plant_species_colors).toEqual({
      'Quercus robur': '#228833',
      'Malus domestica': '#AA4422',
    })

    // Version
    expect(serialized.version).toBe(2)

    // created_at preserved, updated_at regenerated
    expect(serialized.created_at).toBe('2026-01-15T10:30:00.000Z')
    expect(serialized.updated_at).toBe('2026-04-09T12:00:00.000Z')
    expect(serialized.updated_at).not.toBe(FIXTURE.updated_at)

    // Extra unknown fields preserved with nested structure
    expect(serialized.extra).toEqual({ future_feature: { nested: true, count: 42 } })

    // Non-canvas sections are empty placeholders (codec contract)
    expect(serialized.consortiums).toEqual([])
    expect(serialized.timeline).toEqual([])
    expect(serialized.budget).toEqual([])
  })

})
