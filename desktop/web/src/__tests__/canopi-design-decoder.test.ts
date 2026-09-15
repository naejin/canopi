import { describe, expect, it } from 'vitest'
import {
  CanopiDesignIngestionError,
  decodeCanopiDesign,
} from '../app/contracts/design-ingestion'

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

  it.each([
    { version: undefined, displayed: 1 },
    { version: 1, displayed: 1 },
    { version: 5, displayed: 5 },
    { version: 7, displayed: 7 },
  ])('rejects unsupported old, missing, or future version $displayed', ({ version, displayed }) => {
    const input = currentDesign()
    if (version === undefined) delete input.version
    else input.version = version

    expect(() => decodeCanopiDesign(input)).toThrow(
      `$.version: unsupported Canopi Design version ${displayed}; current version is 6`,
    )
    try {
      decodeCanopiDesign(input)
      expect.fail('expected unsupported version')
    } catch (error) {
      expect(error).toBeInstanceOf(CanopiDesignIngestionError)
      expect((error as CanopiDesignIngestionError).kind).toBe('unsupported_version')
    }
  })

  it.each([0, 1.5, Number.NaN])('rejects invalid version %s', (version) => {
    expect(() => decodeCanopiDesign(currentDesign({ version }))).toThrow(
      '$.version: expected a positive integer',
    )
  })

  it('normalizes finite bearings without mutating the input', () => {
    const input = currentDesign({
      spatial_frame: confirmedFrame({ north_bearing_deg: -450 }),
    })

    const decoded = decodeCanopiDesign(input)

    expect(decoded.spatial_frame.north_bearing_deg).toBe(270)
    expect((input.spatial_frame as Record<string, unknown>).north_bearing_deg).toBe(-450)
  })

  it.each([
    {
      spatialFrame: confirmedFrame({ anchor_longitude_deg: 180.0001 }),
      message: '$.spatial_frame.anchor_longitude_deg: expected a number less than or equal to 180',
    },
    {
      spatialFrame: confirmedFrame({ anchor_latitude_deg: 85.0511287798067 }),
      message: '$.spatial_frame.anchor_latitude_deg: expected a number less than or equal to 85.0511287798066',
    },
    {
      spatialFrame: confirmedFrame({ anchor_latitude_deg: Number.POSITIVE_INFINITY }),
      message: '$.spatial_frame.anchor_latitude_deg: expected a finite number',
    },
    {
      spatialFrame: confirmedFrame({ location_metadata: { altitude_m: Number.NaN } }),
      message: '$.spatial_frame.location_metadata.altitude_m: expected a finite number',
    },
  ])('rejects invalid spatial-frame numbers', ({ spatialFrame, message }) => {
    expect(() => decodeCanopiDesign(currentDesign({ spatial_frame: spatialFrame }))).toThrow(message)
  })

  it('rejects invalid placement status', () => {
    expect(() => decodeCanopiDesign(currentDesign({
      spatial_frame: confirmedFrame({ placement_status: 'unknown' }),
    }))).toThrow('$.spatial_frame.placement_status: expected one of "provisional", "confirmed"')
  })

  it.each(['location', 'north_bearing_deg'])('rejects obsolete root authority %s', (key) => {
    expect(() => decodeCanopiDesign(currentDesign({ [key]: null }))).toThrow(
      '$: v6 replaces root location and north_bearing_deg with spatial_frame',
    )
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
        plants: [{ ...plant('plant-1', 'Malus domestica'), quantity: 4_294_967_296 }],
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

function confirmedFrame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    anchor_longitude_deg: 2.3522,
    anchor_latitude_deg: 48.8566,
    north_bearing_deg: 0,
    placement_status: 'confirmed',
    location_metadata: { altitude_m: 35 },
    ...overrides,
  }
}

function plant(id: string, canonicalName: string): Record<string, unknown> {
  return {
    id,
    canonical_name: canonicalName,
    position: { x: 10, y: 20 },
  }
}

function currentDesign(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 6,
    name: 'Garden',
    description: null,
    spatial_frame: {
      anchor_longitude_deg: 13,
      anchor_latitude_deg: 23,
      north_bearing_deg: 0,
      placement_status: 'provisional',
      location_metadata: { altitude_m: null },
    },
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
