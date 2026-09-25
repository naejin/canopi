import { describe, expect, it, vi } from 'vitest'
import type { CanopiFile } from '../../../types/design'
import { CURRENT_CANOPI_FILE_VERSION } from '../../../generated/canopi-design-format'
import { geoAt } from '../../../__tests__/support/geo-design'
import { consortiumTarget, speciesBudgetTarget, speciesTarget } from '../../../target'
import {
  SceneStore,
  createDefaultScenePersistedState,
  createDefaultSceneSessionState,
  serializeScenePersistedState,
} from './store'
import { createSceneGeoFrame } from './geo-frame'

const TEST_FRAME_ORIGIN = { lon: 13, lat: 23 }

describe('scene store', () => {
  it('projects guides and current physical extent without cloning the full scene', () => {
    const store = new SceneStore()
    store.updatePersisted((draft) => {
      draft.guides.push({ id: 'guide', axis: 'h', position: 7 })
      draft.annotations.push({ kind: 'annotation', id: 'a', locked: false,
        annotationType: 'text', position: { x: 3, y: 4 }, text: 'Note', fontSize: 12, rotationDeg: 0 })
    })
    const read = vi.spyOn(store, 'persisted', 'get')
    try {
      expect(store.physicalExtentMeters).toBe(5)
      const guides = store.guides
      guides[0]!.position = 99
      expect(store.guides[0]!.position).toBe(7)
      store.updatePersisted((draft) => { draft.annotations[0]!.position = { x: 6, y: 8 } })
      expect(store.physicalExtentMeters).toBe(10)
      expect(read).not.toHaveBeenCalled()
    } finally { read.mockRestore() }
  })

  it('keeps camera viewport state out of Scene Session state', () => {
    expect(new SceneStore().session).not.toHaveProperty('viewport')
  })

  it('owns committed persisted drafts after the mutator returns', () => {
    const store = new SceneStore()
    let mutateEscapedGuide = (): void => {}

    store.updatePersisted((draft) => {
      const guide = { id: 'guide-1', axis: 'h' as const, position: 10 }
      draft.guides.push(guide)
      mutateEscapedGuide = () => {
        guide.position = 99
      }
    })

    mutateEscapedGuide()

    expect(store.persisted.guides).toEqual([
      { id: 'guide-1', axis: 'h', position: 10 },
    ])
  })

  it('owns committed session drafts after the mutator returns', () => {
    const store = new SceneStore()
    let mutateEscapedSelection = (): void => {}

    store.updateSession((draft) => {
      const selectedTargets = [{ kind: 'plant' as const, id: 'plant-1' }]
      draft.selectedTargets = selectedTargets
      mutateEscapedSelection = () => {
        selectedTargets.push({ kind: 'plant', id: 'plant-2' })
      }
    })

    mutateEscapedSelection()

    expect(store.session.selectedTargets).toEqual([{ kind: 'plant', id: 'plant-1' }])
  })

  it('owns typed selection targets and preserves first-seen typed order', () => {
    const store = new SceneStore()
    const plantTarget = { kind: 'plant' as const, id: 'shared-id' }
    const zoneTarget = { kind: 'zone' as const, id: 'shared-id' }

    store.setSelection([
      plantTarget,
      zoneTarget,
      { kind: 'plant', id: 'shared-id' },
    ])
    plantTarget.id = 'mutated-input'
    zoneTarget.id = 'mutated-input'

    const escapedSnapshot = store.session.selectedTargets
    ;(escapedSnapshot[0] as { id: string }).id = 'mutated-snapshot'
    ;(escapedSnapshot[1] as { id: string }).id = 'mutated-snapshot'

    expect(store.session.selectedTargets).toEqual([
      { kind: 'plant', id: 'shared-id' },
      { kind: 'zone', id: 'shared-id' },
    ])
  })

  it('hydrates and serializes CanopiFile data without crossing the session boundary', () => {
    const file: CanopiFile = {
      version: CURRENT_CANOPI_FILE_VERSION,
      name: 'Demo',
      description: 'sample',
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
          position: geoAt(12, 18),
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
            geoAt(0, 0),
            geoAt(10, 0),
            geoAt(10, 8),
            geoAt(0, 8),
          ],
          rotation: 0,
          fill_color: '#ddeeff',
          notes: null,
        },
      ],
      annotations: [],
      measurement_guides: [{
        id: 'measurement-guide-1',
        locked: false,
        start: geoAt(1, 1),
        end: geoAt(4, 1),
      }],
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
        guides: [{ id: 'guide-1', axis: 'h', lat: 22.9996 }],
      },
    }

    const store = SceneStore.fromCanopi(file, {
      selectedTargets: [{ kind: 'plant', id: 'plant-1' }],
    })

    expect(store.session.selectedTargets).toContainEqual({ kind: 'plant', id: 'plant-1' })
    expect(store.session).not.toHaveProperty('activeEntityId')
    expect(store.session).not.toHaveProperty('activeLayerName')
    expect(store.persisted.plants[0]).toMatchObject({
      stratum: null,
      canopySpreadM: 1.2,
    })

    store.updateSession((draft) => {
      draft.hoveredTarget = { kind: 'zone', id: 'zone-a' }
      draft.documentRevision = 3
    })

    expect(store.session.hoveredTarget).toEqual({ kind: 'zone', id: 'zone-a' })
    expect(store.session.documentRevision).toBe(3)

    // toCanopiFile serializes canvas-entity fields; non-canvas sections
    // (consortiums, timeline, budget) are emitted as empty placeholders —
    // even when the input file had non-empty values. This proves the codec
    // does not accidentally leak document-store data through the scene path.
    const roundTripped = store.toCanopiFile({ now: new Date(file.updated_at) })
    expect(roundTripped.plants).toEqual(file.plants)
    expect(roundTripped.zones).toEqual(file.zones)
    expect(roundTripped.annotations).toEqual(file.annotations)
    expect(roundTripped.measurement_guides).toEqual(file.measurement_guides)
    expect(roundTripped.groups).toEqual(file.groups)
    expect(roundTripped.layers).toEqual(file.layers)
    expect(roundTripped.plant_species_colors).toEqual(file.plant_species_colors)
    expect(roundTripped.plant_species_symbols).toEqual(file.plant_species_symbols)
    expect(roundTripped.extra).toEqual({ guides: file.extra?.guides })
    expect(roundTripped.name).toBe('Untitled')
    expect(roundTripped.description).toBeNull()
    expect(roundTripped).not.toHaveProperty('spatial_frame')
    expect(roundTripped.version).toBe(CURRENT_CANOPI_FILE_VERSION)
    // Non-canvas sections must be empty placeholders, NOT the input values
    expect(roundTripped.consortiums).toEqual([])
    expect(roundTripped.timeline).toEqual([])
    expect(roundTripped.budget).toEqual([])
  })

  it('creates a usable default scene state', () => {
    const persisted = createDefaultScenePersistedState(new Date('2026-04-02T00:00:00.000Z'))
    const secondPersisted = createDefaultScenePersistedState(new Date('2026-04-02T00:00:00.000Z'))
    const session = createDefaultSceneSessionState()
    const firstLayer = persisted.layers[0]
    const secondLayer = secondPersisted.layers[0]
    if (!firstLayer || !secondLayer) throw new Error('canonical layer catalog is empty')

    expect(persisted.layers).toHaveLength(8)
    expect(firstLayer).not.toBe(secondLayer)
    expect(persisted.plantSpeciesSymbols).toEqual({})
    expect(persisted.layers.map((layer: { name: string; visible: boolean }) => [layer.name, layer.visible])).toEqual([
      ['base', true],
      ['contours', false],
      ['climate', false],
      ['zones', true],
      ['water', false],
      ['plants', true],
      ['measurement-guides', true],
      ['annotations', true],
    ])
    firstLayer.visible = false
    expect(secondLayer.visible).toBe(true)
    expect(persisted.plants).toHaveLength(0)
    expect(persisted.measurementGuides).toEqual([])
    expect(session.selectedTargets).toEqual([])
    expect(session).not.toHaveProperty('activeEntityId')
    expect(session).not.toHaveProperty('activeLayerName')
    expect(serializeScenePersistedState(persisted, createSceneGeoFrame(TEST_FRAME_ORIGIN), { now: new Date('2026-04-02T00:00:00.000Z') }).version).toBe(CURRENT_CANOPI_FILE_VERSION)
  })

  it('normalizes and round-trips a Design without Measurement Guides', () => {
    const file = serializeScenePersistedState(createDefaultScenePersistedState(), createSceneGeoFrame(TEST_FRAME_ORIGIN))
    delete file.measurement_guides

    const store = SceneStore.fromCanopi(file)
    expect(store.persisted.measurementGuides).toEqual([])

    const normalizedFile = store.toCanopiFile()
    expect(normalizedFile.measurement_guides).toEqual([])

    const reloadedStore = SceneStore.fromCanopi(normalizedFile)
    expect(reloadedStore.persisted.measurementGuides).toEqual([])
  })

  it('hydrates and serializes embedded Design Object lock state', () => {
    const file: CanopiFile = {
      version: CURRENT_CANOPI_FILE_VERSION,
      name: 'Locked objects',
      description: null,
      plant_species_colors: {},
      layers: [],
      plants: [
        {
          id: 'plant-1',
          locked: true,
          canonical_name: 'Quercus robur',
          common_name: null,
          color: null,
          position: geoAt(1, 2),
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
          points: [geoAt(0, 0)],
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
          position: geoAt(3, 4),
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
      version: CURRENT_CANOPI_FILE_VERSION,
      name: 'Oriented zones',
      description: null,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [
        {
          name: 'zone-1',
          locked: false,
          zone_type: 'rect',
          points: [
            geoAt(0, 0),
            geoAt(10, 0),
            geoAt(10, 5),
            geoAt(0, 5),
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
      version: CURRENT_CANOPI_FILE_VERSION,
      name: 'Demo',
      description: null,
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
          position: geoAt(12, 18),
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
    persisted.guides = [{ id: 'g-1', axis: 'h', position: 0 }, { id: 'g-2', axis: 'v', position: 0 }]

    const file = serializeScenePersistedState(persisted, createSceneGeoFrame(TEST_FRAME_ORIGIN), {
      now: new Date('2026-04-02T00:00:00.000Z'),
    })

    expect(file.extra).toEqual({
      guides: [{ id: 'g-1', axis: 'h', lat: 23 }, { id: 'g-2', axis: 'v', lon: 13 }],
    })
    expect('guides' in file).toBe(false)
  })
})
