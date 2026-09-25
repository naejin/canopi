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
        position: { lon: 'east', lat: 20 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
      }],
    })

    expect(() => decodeCanopiDesign(input)).toThrow(
      '$.plants[0].position.lon: expected a finite number',
    )
  })

  it.each([
    { version: undefined, displayed: 1 },
    { version: 1, displayed: 1 },
    { version: 5, displayed: 5 },
    { version: 6, displayed: 6 },
    { version: 8, displayed: 8 },
  ])('rejects unsupported old, missing, or future version $displayed', ({ version, displayed }) => {
    const input = currentDesign()
    if (version === undefined) delete input.version
    else input.version = version

    expect(() => decodeCanopiDesign(input)).toThrow(
      `$.version: unsupported Canopi Design version ${displayed}; current version is 7`,
    )
    expectKind(() => decodeCanopiDesign(input), 'unsupported_version')
  })

  it.each([0, 1.5, Number.NaN])('rejects invalid version %s', (version) => {
    expect(() => decodeCanopiDesign(currentDesign({ version }))).toThrow(
      '$.version: expected a positive integer',
    )
  })

  it('admits a v7 Design with lon/lat positions', () => {
    const decoded = decodeCanopiDesign(currentDesign({
      plants: [plant('plant-1', 'Malus domestica')],
      zones: [{ name: 'Bed', zone_type: 'polygon', points: [{ lon: 2.35, lat: 48.85 }, { lon: 2.351, lat: 48.851 }] }],
    }))

    expect(decoded.version).toBe(7)
    expect(decoded.plants[0]!.position).toEqual({ lon: 13.0001, lat: 23.0002 })
    expect(decoded.zones[0]!.points).toEqual([{ lon: 2.35, lat: 48.85 }, { lon: 2.351, lat: 48.851 }])
  })

  it.each(['location', 'north_bearing_deg', 'spatial_frame'])('rejects obsolete root authority %s', (key) => {
    const input = currentDesign({ [key]: null })
    expect(() => decodeCanopiDesign(input)).toThrow(
      `$.${key}: obsolete root field; v7 stores lon/lat on each design object`,
    )
    expectKind(() => decodeCanopiDesign(input), 'invalid_document')
  })

  it.each([
    {
      position: { lon: 180.0001, lat: 0 },
      message: '$.plants[0].position.lon: expected a number less than or equal to 180',
    },
    {
      position: { lon: -180.0001, lat: 0 },
      message: '$.plants[0].position.lon: expected a number greater than or equal to -180',
    },
    {
      position: { lon: 0, lat: 85.0511287798067 },
      message: '$.plants[0].position.lat: expected a number less than or equal to 85.0511287798066',
    },
    {
      position: { lon: 0, lat: -85.0511287798067 },
      message: '$.plants[0].position.lat: expected a number greater than or equal to -85.0511287798066',
    },
    {
      position: { lon: 0, lat: Number.POSITIVE_INFINITY },
      message: '$.plants[0].position.lat: expected a finite number',
    },
  ])('rejects out-of-range lon/lat $message', ({ position, message }) => {
    const input = currentDesign({
      plants: [{ ...plant('plant-1', 'Malus domestica'), position }],
    })
    expect(() => decodeCanopiDesign(input)).toThrow(message)
    expectKind(() => decodeCanopiDesign(input), 'invalid_document')
  })

  it('rejects local-metre {x, y} positions', () => {
    const input = currentDesign({
      plants: [{ ...plant('plant-1', 'Malus domestica'), position: { x: 10, y: 20 } }],
    })
    expect(() => decodeCanopiDesign(input)).toThrow(/^\$\.plants\[0\]\.position\.(lon|lat): missing required value$/)
    expectKind(() => decodeCanopiDesign(input), 'invalid_document')
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

function expectKind(run: () => unknown, kind: CanopiDesignIngestionError['kind']): void {
  try {
    run()
    expect.fail(`expected ${kind}`)
  } catch (error) {
    expect(error).toBeInstanceOf(CanopiDesignIngestionError)
    expect((error as CanopiDesignIngestionError).kind).toBe(kind)
  }
}

function plant(id: string, canonicalName: string): Record<string, unknown> {
  return {
    id,
    canonical_name: canonicalName,
    position: { lon: 13.0001, lat: 23.0002 },
  }
}

function currentDesign(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 7,
    name: 'Garden',
    description: null,
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
