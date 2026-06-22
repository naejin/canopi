import { describe, expect, it } from 'vitest'
import type { CanopiFile } from '../../../types/design'
import { consortiumTarget, speciesBudgetTarget, speciesTarget } from '../../../target'
import {
  SceneStore,
  createDefaultScenePersistedState,
  createDefaultSceneSessionState,
  serializeScenePersistedState,
} from './store'

describe('scene store', () => {
  it('hydrates and serializes CanopiFile data without crossing the session boundary', () => {
    const file: CanopiFile = {
      version: 2,
      name: 'Demo',
      description: 'sample',
      location: {
        lat: 48.8566,
        lon: 2.3522,
        altitude_m: 35,
      },
      north_bearing_deg: 12,
      plant_species_colors: {
        oak: '#228833',
      },
      plant_species_symbols: {
        'Quercus robur': 'tree',
      },
      layers: [
        { name: 'base', visible: true, locked: false, opacity: 1 },
      ],
      plants: [
        {
          id: 'plant-1',
          locked: false,
          canonical_name: 'Quercus robur',
          common_name: 'English oak',
          color: '#228833',
          symbol: 'square',
          pinned_name: false,
          position: { x: 12, y: 18 },
          rotation: 45,
          scale: 1.2,
          notes: 'heritage tree',
          planted_date: '2025-04-01',
          quantity: 1,
        },
      ],
      zones: [
        {
          name: 'zone-a',
          locked: false,
          zone_type: 'rect',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 8 },
            { x: 0, y: 8 },
          ],
          rotation: 0,
          fill_color: '#ddeeff',
          notes: null,
        },
      ],
      annotations: [],
      consortiums: [{ target: consortiumTarget('Quercus robur'), stratum: 'high', start_phase: 0, end_phase: 3 }],
      groups: [
        {
          id: 'group-1',
          locked: false,
          name: 'grouped',
          members: [{ kind: 'plant', id: 'plant-1' }],
        },
      ],
      timeline: [{ id: 't1', action_type: 'planting', description: 'Plant oak', start_date: '2026-04-01', end_date: '2026-04-02', recurrence: null, targets: [speciesTarget('Quercus robur')], depends_on: [], completed: false, order: 0 }],
      budget: [{ target: speciesBudgetTarget('Quercus robur'), category: 'plants', description: 'Quercus robur', quantity: 1, unit_cost: 25, currency: 'EUR' }],
      budget_currency: 'EUR',
      created_at: '2026-04-01T10:00:00.000Z',
      updated_at: '2026-04-01T12:00:00.000Z',
      extra: {
        guides: [{ id: 'guide-1', axis: 'h', position: 42 }],
      },
    }

    const store = SceneStore.fromCanopi(file, {
      selectedEntityIds: new Set(['plant-1']),
      activeLayerName: 'plants',
      plantSizeMode: 'canopy',
      plantColorByAttr: 'flower',
    })

    expect(store.session.selectedEntityIds.has('plant-1')).toBe(true)
    expect(store.session.activeLayerName).toBe('plants')
    expect(store.session.plantSizeMode).toBe('canopy')
    expect(store.session.plantColorByAttr).toBe('flower')
    expect(store.persisted.plants[0]).toMatchObject({
      stratum: null,
      canopySpreadM: 1.2,
      scale: 1.2,
    })

    store.updateSession((draft) => {
      draft.hoveredEntityId = 'zone-a'
      draft.documentRevision = 3
      draft.plantSizeMode = 'default'
      draft.plantColorByAttr = 'stratum'
    })

    expect(store.session.hoveredEntityId).toBe('zone-a')
    expect(store.session.documentRevision).toBe(3)
    expect(store.session.plantSizeMode).toBe('default')
    expect(store.session.plantColorByAttr).toBe('stratum')

    // toCanopiFile serializes canvas-entity fields; non-canvas sections
    // (consortiums, timeline, budget) are emitted as empty placeholders —
    // even when the input file had non-empty values. This proves the codec
    // does not accidentally leak document-store data through the scene path.
    const roundTripped = store.toCanopiFile({ now: new Date(file.updated_at) })
    expect(roundTripped.plants).toEqual(file.plants)
    expect(roundTripped.zones).toEqual(file.zones)
    expect(roundTripped.annotations).toEqual(file.annotations)
    expect(roundTripped.groups).toEqual(file.groups)
    expect(roundTripped.layers).toEqual(file.layers)
    expect(roundTripped.plant_species_colors).toEqual(file.plant_species_colors)
    expect(roundTripped.plant_species_symbols).toEqual(file.plant_species_symbols)
    expect(roundTripped.extra).toEqual({ guides: file.extra?.guides })
    expect(roundTripped.name).toBe('Untitled')
    expect(roundTripped.description).toBeNull()
    expect(roundTripped.location).toBeNull()
    expect(roundTripped.north_bearing_deg).toBe(0)
    expect(roundTripped.version).toBe(4)
    // Non-canvas sections must be empty placeholders, NOT the input values
    expect(roundTripped.consortiums).toEqual([])
    expect(roundTripped.timeline).toEqual([])
    expect(roundTripped.budget).toEqual([])
  })

  it('creates a usable default scene state', () => {
    const persisted = createDefaultScenePersistedState(new Date('2026-04-02T00:00:00.000Z'))
    const session = createDefaultSceneSessionState()

    expect(persisted.layers).toHaveLength(7)
    expect(persisted.plantSpeciesSymbols).toEqual({})
    expect(persisted.layers.map((layer: { name: string; visible: boolean }) => [layer.name, layer.visible])).toEqual([
      ['base', true],
      ['contours', false],
      ['climate', false],
      ['zones', true],
      ['water', false],
      ['plants', true],
      ['annotations', true],
    ])
    expect(persisted.plants).toHaveLength(0)
    expect(session.selectedEntityIds.size).toBe(0)
    expect(session.activeLayerName).toBe('zones')
    expect(session.plantSizeMode).toBe('default')
    expect(session.plantColorByAttr).toBe(null)
    expect(serializeScenePersistedState(persisted, { now: new Date('2026-04-02T00:00:00.000Z') }).version).toBe(4)
  })

  it('hydrates and serializes embedded Design Object lock state', () => {
    const file: CanopiFile = {
      version: 2,
      name: 'Locked objects',
      description: null,
      location: null,
      north_bearing_deg: 0,
      plant_species_colors: {},
      layers: [],
      plants: [
        {
          id: 'plant-1',
          locked: true,
          canonical_name: 'Quercus robur',
          common_name: null,
          color: null,
          position: { x: 1, y: 2 },
          rotation: null,
          scale: null,
          notes: null,
          planted_date: null,
          quantity: null,
        },
      ],
      zones: [
        {
          name: 'zone-1',
          zone_type: 'polygon',
          points: [{ x: 0, y: 0 }],
          rotation: 0,
          fill_color: null,
          notes: null,
          locked: true,
        },
      ],
      annotations: [
        {
          id: 'annotation-1',
          annotation_type: 'text',
          position: { x: 3, y: 4 },
          text: 'Note',
          font_size: 16,
          rotation: null,
          locked: true,
        },
      ],
      consortiums: [],
      groups: [
        {
          id: 'group-1',
          name: null,
          locked: true,
          members: [{ kind: 'plant', id: 'plant-1' }],
        },
      ],
      timeline: [],
      budget: [],
      budget_currency: 'EUR',
      created_at: '2026-04-01T10:00:00.000Z',
      updated_at: '2026-04-01T12:00:00.000Z',
      extra: {},
    }

    const serialized = SceneStore.fromCanopi(file).toCanopiFile({ now: new Date(file.updated_at) })

    expect(serialized.plants[0]?.locked).toBe(true)
    expect(serialized.zones[0]?.locked).toBe(true)
    expect(serialized.annotations[0]?.locked).toBe(true)
    expect(serialized.groups[0]?.locked).toBe(true)
  })

  it('hydrates and serializes shaped Zone orientation', () => {
    const file = {
      version: 2,
      name: 'Oriented zones',
      description: null,
      location: null,
      north_bearing_deg: 0,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [
        {
          name: 'zone-1',
          locked: false,
          zone_type: 'rect',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 5 },
            { x: 0, y: 5 },
          ],
          rotation: 35,
          fill_color: null,
          notes: null,
        },
      ],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      budget_currency: 'EUR',
      created_at: '2026-04-01T10:00:00.000Z',
      updated_at: '2026-04-01T12:00:00.000Z',
      extra: {},
    } as CanopiFile

    const store = SceneStore.fromCanopi(file)

    expect(store.persisted.zones[0]?.rotationDeg).toBe(35)
    expect(store.toCanopiFile({ now: new Date(file.updated_at) }).zones[0]?.rotation).toBe(35)
  })

  it('serializes runtime plant presentation metadata back into the existing placed-plant fields only', () => {
    const file: CanopiFile = {
      version: 2,
      name: 'Demo',
      description: null,
      location: null,
      north_bearing_deg: 0,
      plant_species_colors: {},
      layers: [],
      plants: [
        {
          id: 'plant-1',
          locked: false,
          canonical_name: 'Quercus robur',
          common_name: 'English oak',
          color: null,
          pinned_name: false,
          position: { x: 12, y: 18 },
          rotation: null,
          scale: 1.2,
          notes: null,
          planted_date: null,
          quantity: null,
        },
      ],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      budget_currency: 'EUR',
      created_at: '2026-04-01T10:00:00.000Z',
      updated_at: '2026-04-01T12:00:00.000Z',
      extra: {},
    }

    const store = SceneStore.fromCanopi(file)

    store.updatePersisted((draft) => {
      draft.plants[0]!.stratum = 'high'
      draft.plants[0]!.canopySpreadM = 2.4
    })

    const serialized = store.toCanopiFile({ now: new Date(file.updated_at) })

    expect(serialized.plants[0]).toEqual({
      ...file.plants[0],
      scale: 2.4,
    })
    expect(serialized.plants[0]).not.toHaveProperty('stratum')
    expect(serialized.plants[0]).not.toHaveProperty('canopySpreadM')
  })

  it('serializes extra metadata under the extra key', () => {
    const persisted = createDefaultScenePersistedState(new Date('2026-04-02T00:00:00.000Z'))
    persisted.guides = [{ id: 'g-1', axis: 'h', position: 10 }]

    const file = serializeScenePersistedState(persisted, { now: new Date('2026-04-02T00:00:00.000Z') })

    expect(file.extra).toEqual({
      guides: [{ id: 'g-1', axis: 'h', position: 10 }],
    })
    expect('guides' in file).toBe(false)
  })
})
