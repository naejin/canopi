import { describe, expect, it } from 'vitest'
import {
  hydrateSceneFromDesign,
  SceneStore,
  serializeScenePersistedState,
} from '../canvas/runtime/scene'
import {
  createEllipticalZoneMeasurements,
  createRectangularZoneMeasurements,
} from '../canvas/runtime/zone-measurements'
import { createSessionPlane } from '../canvas/session-plane'
import { CURRENT_CANOPI_FILE_VERSION } from '../generated/canopi-design-format'
import type { CanopiFile } from '../types/design'
import { geoAt } from './support/geo-design'

const ORIGIN = { lon: 2.294481, lat: 48.858370 }

function v7Design(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: CURRENT_CANOPI_FILE_VERSION,
    name: 'Geo garden',
    description: null,
    plant_species_colors: {},
    plant_species_symbols: {},
    plant_species_codes: {},
    layers: [{ name: 'plants', visible: true, locked: false, opacity: 1 }],
    plants: [
      plant('p1', { lon: 2.2944812345678, lat: 48.8583701234567 }),
      plant('p2', { lon: 2.29452, lat: 48.85831 }),
      plant('p3', { lon: 2.2946, lat: 48.8584 }),
    ],
    zones: [
      {
        name: 'bed', locked: false, zone_type: 'rect',
        points: [
          { lon: 2.29440, lat: 48.85845 },
          { lon: 2.29450, lat: 48.85845 },
          { lon: 2.29450, lat: 48.85838 },
          { lon: 2.29440, lat: 48.85838 },
        ],
        rotation: 30, fill_color: null, notes: null,
      },
      {
        name: 'pond', locked: false, zone_type: 'ellipse',
        points: [{ lon: 2.29455, lat: 48.85842 }, { lon: 2.29462, lat: 48.85836 }],
        rotation: 0, fill_color: null, notes: null,
      },
    ],
    annotations: [{
      id: 'n1', locked: false, annotation_type: 'text',
      position: { lon: 2.29447, lat: 48.85833 },
      text: 'Well', font_size: 14, rotation: null,
    }],
    measurement_guides: [{
      id: 'g1', locked: false,
      start: { lon: 2.29441, lat: 48.85832 },
      end: { lon: 2.29458, lat: 48.85832 },
    }],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-09-25T00:00:00.000Z',
    updated_at: '2026-09-25T00:00:00.000Z',
    extra: { guides: [{ id: 'r1', axis: 'h', lat: 48.8584 }, { id: 'r2', axis: 'v', lon: 2.2945 }] },
    ...overrides,
  }
}

function plant(id: string, position: { lon: number; lat: number }): CanopiFile['plants'][number] {
  return {
    id, locked: false, canonical_name: 'Malus domestica', common_name: null, color: null,
    pinned_name: false, position, rotation: null, scale: null, notes: null, planted_date: null, quantity: null,
  }
}

const SCENE_FIELDS = ['plants', 'zones', 'annotations', 'measurement_guides', 'extra'] as const

function sceneFields(file: CanopiFile): string {
  return JSON.stringify(SCENE_FIELDS.map((key) => file[key]))
}

describe('geolocated design codec', () => {
  it('writes every loaded position back byte-identically when nothing changed', () => {
    const file = v7Design()
    const store = new SceneStore(file)
    expect(sceneFields(store.toCanopiFile())).toBe(sceneFields(file))
  })

  it('centres the session plane on the objects', () => {
    const { geo, persisted } = hydrateSceneFromDesign(v7Design())
    const xs = persisted.plants.map((p) => p.position.x)
    expect(Math.abs(geo.plane.origin.lon - 2.29451)).toBeLessThan(0.0001)
    expect(Math.min(...xs)).toBeLessThan(0)
    expect(Math.max(...xs)).toBeGreaterThan(0)
  })

  it('rewrites only the edited plant, rounded to 1e-9 degree', () => {
    const file = v7Design()
    const store = new SceneStore(file)
    store.updatePersisted((draft) => {
      draft.plants[0]!.position = { x: draft.plants[0]!.position.x + 1.25, y: draft.plants[0]!.position.y }
    })
    const saved = store.toCanopiFile()
    expect(saved.plants[1]).toEqual(file.plants[1])
    expect(saved.plants[2]).toEqual(file.plants[2])
    expect(saved.zones).toEqual(file.zones)
    const moved = saved.plants[0]!.position
    expect(moved).not.toEqual(file.plants[0]!.position)
    expect(Math.round(moved.lon * 1e9) / 1e9).toBe(moved.lon)
    expect(Math.round(moved.lat * 1e9) / 1e9).toBe(moved.lat)
    const plane = createSessionPlane(file.plants[0]!.position)
    const shift = plane.toPlane(moved)
    expect(shift.x).toBeCloseTo(1.25, 3)
    expect(Math.abs(shift.y)).toBeLessThan(1e-3)
  })

  it('keeps every stored lon/lat unchanged across a re-origin beyond 10 km', () => {
    const file = v7Design()
    const store = new SceneStore(file)
    const farCentre = store.sessionPlane.toGeo({ x: 12_000, y: -3_000 })
    store.commitReorigin(store.beginReorigin(farCentre))
    expect(store.sessionPlane.origin).toEqual(farCentre)
    expect(Math.abs(store.persisted.plants[0]!.position.x + 12_000)).toBeLessThan(100)
    expect(sceneFields(store.toCanopiFile())).toBe(sceneFields(file))
    store.commitReorigin(store.beginReorigin(file.plants[1]!.position))
    expect(sceneFields(store.toCanopiFile())).toBe(sceneFields(file))
  })

  it('stores ellipses as opposite unrotated bounding-box corners', () => {
    const file = v7Design()
    const { persisted, geo } = hydrateSceneFromDesign(file)
    const pond = persisted.zones.find((zone) => zone.name === 'pond')!
    const [first, second] = file.zones[1]!.points.map((point) => geo.plane.toPlane(point))
    expect(pond.points[0]!.x).toBeCloseTo((first!.x + second!.x) / 2, 9)
    expect(pond.points[1]!.x).toBeCloseTo((second!.x - first!.x) / 2, 9)
    expect(pond.points[1]!.y).toBeCloseTo((second!.y - first!.y) / 2, 9)
  })

  it('stores ruler guides as a latitude or a longitude', () => {
    const { persisted, geo } = hydrateSceneFromDesign(v7Design())
    const horizontal = persisted.guides.find((guide) => guide.axis === 'h')!
    const vertical = persisted.guides.find((guide) => guide.axis === 'v')!
    expect(geo.plane.toGeo({ x: 0, y: horizontal.position }).lat).toBeCloseTo(48.8584, 10)
    expect(geo.plane.toGeo({ x: vertical.position, y: 0 }).lon).toBeCloseTo(2.2945, 10)
  })

  it('writes new objects with rounded lon/lat', () => {
    const store = new SceneStore(undefined, {}, ORIGIN)
    store.updatePersisted((draft) => {
      draft.annotations.push({
        kind: 'annotation', id: 'fresh', locked: false, annotationType: 'text',
        position: { x: 3.3333333, y: -7.7777777 }, text: 'New', fontSize: 12, rotationDeg: null,
      })
    })
    const position = store.toCanopiFile().annotations[0]!.position
    expect(String(position.lon).split('.')[1]!.length).toBeLessThanOrEqual(9)
    expect(String(position.lat).split('.')[1]!.length).toBeLessThanOrEqual(9)
    expect(createSessionPlane(ORIGIN).toPlane(position).x).toBeCloseTo(3.3333333, 3)
  })

  it('keeps zone measurements of a metre fixture after conversion to v7', () => {
    // A former metre fixture authored around 45°N, converted by the test-only helper.
    const origin = { lon: 5.72, lat: 45.18 }
    const rect = [{ x: 0, y: 0 }, { x: 12.5, y: 0 }, { x: 12.5, y: 8 }, { x: 0, y: 8 }]
    const file = v7Design({
      plants: [],
      annotations: [],
      measurement_guides: [],
      extra: {},
      zones: [
        {
          name: 'rect', locked: false, zone_type: 'rect', rotation: 0, fill_color: null, notes: null,
          points: rect.map((point) => geoAt(point.x, point.y, origin)),
        },
        {
          name: 'ellipse', locked: false, zone_type: 'ellipse', rotation: 0, fill_color: null, notes: null,
          points: [geoAt(20, 0, origin), geoAt(26, 4, origin)],
        },
      ],
    })
    const zones = hydrateSceneFromDesign(file).persisted.zones
    const labels = (items: { text: string }[]) => items.map((item) => item.text)
    expect(labels(createRectangularZoneMeasurements(zones[0]!.points)))
      .toEqual(labels(createRectangularZoneMeasurements(rect)))
    expect(labels(createEllipticalZoneMeasurements(zones[1]!.points[0]!, zones[1]!.points[1]!)))
      .toEqual(labels(createEllipticalZoneMeasurements({ x: 23, y: 2 }, { x: 3, y: 2 })))
  })

  it('serializes with an explicit frame so saved content never depends on hidden state', () => {
    const { persisted, geo } = hydrateSceneFromDesign(v7Design())
    const saved = serializeScenePersistedState(persisted, geo)
    expect(saved.version).toBe(7)
    expect('spatial_frame' in saved).toBe(false)
  })
})
