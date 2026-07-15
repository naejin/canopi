import { describe, expect, it } from 'vitest'
import { decodeCanopiDesign } from '../app/contracts/design-ingestion'

describe('Canopi Design decoder', () => {
  it('rejects malformed nested fields with an actionable path', () => {
    const input = currentDesign({
      plants: [{
        id: 'plant-1',
        locked: false,
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: null,
        symbol: null,
        pinned_name: false,
        position: { x: 'east', y: 20 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
      }],
    })

    expect(() => decodeCanopiDesign(input)).toThrow(
      '$.plants[0].position.x: expected a finite number',
    )
  })

  it('migrates version 4 measurement guides and their layer', () => {
    const input = currentDesign({
      version: 4,
      layers: [
        { name: 'plants', visible: true, locked: false, opacity: 1 },
        { name: 'annotations', visible: true, locked: false, opacity: 1 },
      ],
    })
    delete input.measurement_guides

    const decoded = decodeCanopiDesign(input)

    expect(decoded.version).toBe(5)
    expect(decoded.measurement_guides).toEqual([])
    expect(decoded.layers.map((layer) => layer.name)).toEqual([
      'plants',
      'measurement-guides',
      'annotations',
    ])
  })

  it('migrates version 3 plant name pinning without mutating the input', () => {
    const plant = {
      id: 'plant-1',
      canonical_name: 'Malus domestica',
      position: { x: 10, y: 20 },
    }
    const input = currentDesign({ version: 3, plants: [plant] })
    delete input.measurement_guides

    const decoded = decodeCanopiDesign(input)

    expect(decoded.plants[0]?.pinned_name).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(plant, 'pinned_name')).toBe(false)
  })

  it('migrates version 2 species symbols', () => {
    const input = currentDesign({ version: 2 })
    delete input.plant_species_symbols
    delete input.measurement_guides

    const decoded = decodeCanopiDesign(input)

    expect(decoded.plant_species_symbols).toEqual({})
    expect(decoded.version).toBe(5)
  })

  it('migrates version 1 timeline and budget targets', () => {
    const input = currentDesign({
      version: 1,
      plants: [{
        id: 'plant-1',
        canonical_name: 'Malus domestica',
        position: { x: 10, y: 20 },
      }],
      timeline: [{
        id: 'action-1',
        action_type: 'plant',
        description: 'Plant the guild',
        plants: [' plant-1 ', 'Pyrus communis', '', 42],
        zone: ' Orchard ',
        completed: false,
        order: 0,
      }],
      budget: [{
        category: 'plants',
        description: ' Pyrus communis ',
        quantity: 2,
        unit_cost: 12,
        currency: 'EUR',
      }],
    })
    delete input.plant_species_symbols
    delete input.measurement_guides

    const decoded = decodeCanopiDesign(input)

    expect(decoded.timeline[0]?.targets).toEqual([
      { kind: 'placed_plant', plant_id: 'plant-1' },
      { kind: 'species', canonical_name: 'Pyrus communis' },
      { kind: 'zone', zone_name: 'Orchard' },
    ])
    expect(decoded.budget[0]?.target).toEqual({
      kind: 'species',
      canonical_name: 'Pyrus communis',
    })
  })

  it('migrates and deduplicates version 1 consortium species', () => {
    const input = currentDesign({
      version: 1,
      plants: [
        legacyPlant('plant-1', 'Malus domestica'),
        legacyPlant('plant-2', 'Pyrus communis'),
      ],
      consortiums: [
        null,
        'unusable legacy entry',
        {
          canonical_name: ' Malus domestica ',
          stratum: 'canopy',
          start_phase: 0,
          end_phase: 1,
        },
        {
          plant_ids: ['plant-1', 'plant-2', 'Pyrus communis', '  Rubus idaeus  ', ''],
          plants: ['Ignored fallback'],
        },
      ],
    })
    delete input.plant_species_symbols
    delete input.measurement_guides

    const decoded = decodeCanopiDesign(input)

    expect(decoded.consortiums).toEqual([
      {
        target: { kind: 'species', canonical_name: 'Malus domestica' },
        stratum: 'canopy',
        start_phase: 0,
        end_phase: 1,
      },
      {
        target: { kind: 'species', canonical_name: 'Pyrus communis' },
        stratum: 'unassigned',
        start_phase: 0,
        end_phase: 2,
      },
      {
        target: { kind: 'species', canonical_name: 'Rubus idaeus' },
        stratum: 'unassigned',
        start_phase: 0,
        end_phase: 2,
      },
    ])
  })

  it('resolves legacy groups only when member identities are unambiguous', () => {
    const input = currentDesign({
      plants: [
        legacyPlant('plant-1', 'Malus domestica'),
        legacyPlant('shared', 'Pyrus communis'),
      ],
      zones: [legacyZone('zone-1'), legacyZone('shared')],
      annotations: [legacyAnnotation('annotation-1')],
      groups: [
        { id: 'legacy', member_ids: ['plant-1', 'zone-1', 'plant-1', 'missing'] },
        { id: 'ambiguous', member_ids: ['shared', 'annotation-1'] },
        { id: 'explicit-empty', members: [] },
        {
          id: 'explicit-deduped',
          members: [
            { kind: 'plant', id: 'plant-1' },
            { kind: 'plant', id: 'plant-1', ignored: true },
          ],
        },
      ],
    })

    const decoded = decodeCanopiDesign(input)

    expect(decoded.groups).toEqual([
      {
        id: 'legacy',
        locked: false,
        name: null,
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'zone', id: 'zone-1' },
        ],
      },
      { id: 'explicit-empty', locked: false, name: null, members: [] },
      {
        id: 'explicit-deduped',
        locked: false,
        name: null,
        members: [{ kind: 'plant', id: 'plant-1' }],
      },
    ])
  })

  it('materializes serde defaults and keeps only root unknown fields in extra', () => {
    const input = currentDesign({
      description: undefined,
      future_top_level: { enabled: true },
      extra: { preserved: 'yes' },
      zones: [{
        name: 'Orchard',
        zone_type: 'bed',
        points: [],
        future_nested: 'ignored like serde',
      }],
    })
    delete input.description

    const decoded = decodeCanopiDesign(input)

    expect(decoded.description).toBeNull()
    expect(decoded.zones[0]).toEqual({
      name: 'Orchard',
      locked: false,
      zone_type: 'bed',
      points: [],
      rotation: 0,
      fill_color: null,
      notes: null,
    })
    expect(decoded.extra).toEqual({
      preserved: 'yes',
      future_top_level: { enabled: true },
    })
    expect(input.zones).toEqual([{
      name: 'Orchard',
      zone_type: 'bed',
      points: [],
      future_nested: 'ignored like serde',
    }])
  })

  it.each([
    { version: 0, message: '$.version: expected a positive integer' },
    { version: 1.5, message: '$.version: expected a positive integer' },
    { version: 6, message: '$.version: unsupported Canopi Design version 6; current version is 5' },
  ])('rejects unsupported version $version', ({ version, message }) => {
    expect(() => decodeCanopiDesign(currentDesign({ version }))).toThrow(message)
  })

  it('treats a missing version as version 1', () => {
    const input = currentDesign()
    delete input.version

    expect(decodeCanopiDesign(input).version).toBe(5)
  })

  it('rejects malformed tagged targets at their discriminator', () => {
    const input = currentDesign({
      timeline: [{
        id: 'action-1',
        action_type: 'plant',
        description: 'Plant',
        targets: [{ kind: 'future-kind' }],
        completed: false,
        order: 0,
      }],
    })

    expect(() => decodeCanopiDesign(input)).toThrow(
      '$.timeline[0].targets[0].kind: expected one of "placed_plant", "species", "zone", "manual", "none"',
    )
  })

  it('preserves unsafe-looking root keys as data without changing prototypes', () => {
    const input = currentDesign()
    Object.defineProperty(input, '__proto__', {
      enumerable: true,
      value: { polluted: true },
    })

    const decoded = decodeCanopiDesign(input)

    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(decoded.extra)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(decoded.extra, '__proto__')).toBe(true)
    expect(decoded.extra?.['__proto__']).toEqual({ polluted: true })
  })

  it('rejects missing required root fields', () => {
    const input = currentDesign()
    delete input.name

    expect(() => decodeCanopiDesign(input)).toThrow('$.name: missing required value')
  })

  it.each([
    {
      input: () => currentDesign({
        plants: [{ ...legacyPlant('plant-1', 'Malus domestica'), quantity: 4_294_967_296 }],
      }),
      message: '$.plants[0].quantity: expected an unsigned 32-bit integer',
    },
    {
      input: () => currentDesign({
        timeline: [{
          id: 'action-1',
          action_type: 'plant',
          description: 'Plant',
          completed: false,
          order: 2_147_483_648,
        }],
      }),
      message: '$.timeline[0].order: expected a signed 32-bit integer',
    },
    {
      input: () => currentDesign({
        layers: [{ name: 'plants', visible: true, locked: false, opacity: Number.MAX_VALUE }],
      }),
      message: '$.layers[0].opacity: expected a finite 32-bit number',
    },
  ])('enforces generated Rust numeric bounds at runtime', ({ input, message }) => {
    expect(() => decodeCanopiDesign(input())).toThrow(message)
  })
})

function legacyPlant(id: string, canonicalName: string): Record<string, unknown> {
  return {
    id,
    canonical_name: canonicalName,
    position: { x: 10, y: 20 },
  }
}

function legacyZone(name: string): Record<string, unknown> {
  return {
    name,
    zone_type: 'bed',
    points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  }
}

function legacyAnnotation(id: string): Record<string, unknown> {
  return {
    id,
    annotation_type: 'text',
    position: { x: 0, y: 0 },
    text: 'Note',
    font_size: 12,
  }
}

function currentDesign(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 5,
    name: 'Garden',
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: {},
    plant_species_symbols: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    measurement_guides: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-07-15T00:00:00.000Z',
    updated_at: '2026-07-15T00:00:00.000Z',
    extra: {},
    ...overrides,
  }
}
