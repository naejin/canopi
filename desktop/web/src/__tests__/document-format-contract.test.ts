import { describe, expect, it } from 'vitest'
import { hydrateScenePersistedState, serializeScenePersistedState } from '../canvas/runtime/scene/codec'
import {
  composeDocumentForSave,
  DOCUMENT_FILE_FIELD_OWNERS,
  normalizeLoadedDocument,
} from '../app/contracts/document'
import { KNOWN_CANOPI_KEYS } from '../generated/known-canopi-keys'
import { consortiumTarget, speciesBudgetTarget, speciesTarget } from '../target'
import type { CanopiFile } from '../types/design'

const RAW_DOCUMENT = {
  version: 6,
  name: 'Format contract',
  description: null,
  spatial_frame: { anchor_longitude_deg: 2.3522, anchor_latitude_deg: 48.8566, north_bearing_deg: 9, placement_status: 'confirmed', location_metadata: { altitude_m: null } },
  plant_species_colors: {},
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
  extra: {
    preserved_from_file: 'keep-me',
  },
  created_at: '2026-04-13T00:00:00.000Z',
  updated_at: '2026-04-13T00:00:00.000Z',
  schema_extension_flag: true,
  experimental_block: {
    source: 'future-version',
    values: [1, 2, 3],
  },
} as const

const BASE_DOCUMENT: CanopiFile = {
  version: 6,
  name: 'Contract base',
  description: null,
  spatial_frame: { anchor_longitude_deg: 13, anchor_latitude_deg: 23, north_bearing_deg: 0, placement_status: 'provisional', location_metadata: { altitude_m: null } },
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
  created_at: '2026-04-13T00:00:00.000Z',
  updated_at: '2026-04-13T00:00:00.000Z',
  extra: {},
}

describe('document format contract', () => {
  it('keeps field ownership aligned with generated known file keys', () => {
    expect(Object.keys(DOCUMENT_FILE_FIELD_OWNERS)).toEqual(KNOWN_CANOPI_KEYS)
  })

  it('uses generated field ownership when composing known Design fields', () => {
    const document = {
      ...BASE_DOCUMENT,
      version: 101,
      description: 'Document-owned description',
      spatial_frame: { anchor_longitude_deg: 2, anchor_latitude_deg: 1, north_bearing_deg: 11, placement_status: 'confirmed', location_metadata: { altitude_m: 3 } },
      consortiums: [{
        target: consortiumTarget('Document species'),
        stratum: 'document',
        start_phase: 1,
        end_phase: 2,
      }],
      timeline: [{
        id: 'document-action',
        action_type: 'planting',
        description: 'Document action',
        start_date: null,
        end_date: null,
        recurrence: null,
        targets: [speciesTarget('Document species')],
        depends_on: null,
        completed: false,
        order: 0,
      }],
      budget: [{
        target: speciesBudgetTarget('Document species'),
        category: 'plants',
        description: 'Document budget',
        quantity: 2,
        unit_cost: 3,
        currency: 'USD',
      }],
      budget_currency: 'USD',
      lidar: {
        schema_version: 1,
        entries: [{
          kind: 'Source',
          id: 'document-lidar',
          visible: true,
          opacity: 0.65,
          order: 0,
          style: null,
        }],
      },
      created_at: '2026-04-13T01:00:00.000Z',
      extra: {
        future_panel_field: { source: 'document' },
        guides: [{ id: 'document-guide', axis: 'h', position: 1 }],
      },
    } satisfies CanopiFile
    const canvas = {
      ...BASE_DOCUMENT,
      version: 202,
      plant_species_colors: { 'Canvas species': '#112233' },
      plant_species_symbols: { 'Canvas species': 'tree' },
      plant_species_codes: { 'Canvas species': 'CSP' },
      layers: [{ name: 'plants', visible: true, locked: true, opacity: 0.8 }],
      plants: [{
        id: 'canvas-plant',
        canonical_name: 'Canvas species',
        common_name: null,
        color: null,
        position: { x: 10, y: 20 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      }],
      zones: [{
        name: 'Canvas zone',
        zone_type: 'polygon',
        rotation: 0,
        points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
        fill_color: null,
        notes: null,
        locked: false,
      }],
      annotations: [{
        id: 'canvas-annotation',
        annotation_type: 'text',
        position: { x: 3, y: 4 },
        text: 'Canvas annotation',
        font_size: 12,
        rotation: null,
        locked: false,
      }],
      measurement_guides: [{
        id: 'canvas-measurement-guide',
        locked: false,
        start: { x: 2, y: 3 },
        end: { x: 12, y: 3 },
      }],
      groups: [{
        id: 'canvas-group',
        locked: false,
        name: null,
        members: [{ kind: 'plant', id: 'canvas-plant' }],
      }],
      updated_at: '2026-04-13T02:00:00.000Z',
      extra: {
        guides: [{ id: 'canvas-guide', axis: 'v', position: 2 }],
      },
    } satisfies CanopiFile

    const saved = composeDocumentForSave({
      metadata: { name: 'Metadata name' },
      document,
      canvas,
    }) as unknown as Record<string, unknown>
    const documentRecord = document as unknown as Record<string, unknown>
    const canvasRecord = canvas as unknown as Record<string, unknown>
    const metadataOwned = new Set(['name', 'description', 'extra'])

    for (const key of KNOWN_CANOPI_KEYS) {
      if (metadataOwned.has(key)) continue
      const expectedSource = DOCUMENT_FILE_FIELD_OWNERS[key] === 'scene'
        ? canvasRecord
        : documentRecord
      expect(saved[key], key).toEqual(expectedSource[key])
    }

    expect(saved.name).toBe('Metadata name')
    expect(saved.description).toBe('Document-owned description')
    expect(saved.spatial_frame).toEqual(document.spatial_frame)
    expect(saved.extra).toEqual({
      future_panel_field: { source: 'document' },
      guides: [{ id: 'canvas-guide', axis: 'v', position: 2 }],
    })
  })

  it('preserves the document spatial frame unless metadata supplies a complete replacement', () => {
    const document = {
      ...BASE_DOCUMENT,
      spatial_frame: { ...BASE_DOCUMENT.spatial_frame, north_bearing_deg: 18 },
    }
    const preserved = composeDocumentForSave({
      metadata: { name: 'Existing frame' },
      document,
      canvas: BASE_DOCUMENT,
    })
    const replacement = {
      anchor_longitude_deg: -73.6,
      anchor_latitude_deg: 45.5,
      north_bearing_deg: 27,
      placement_status: 'confirmed' as const,
      location_metadata: { altitude_m: 12 },
    }
    const replaced = composeDocumentForSave({
      metadata: { name: 'Replaced frame', spatialFrame: replacement },
      document,
      canvas: BASE_DOCUMENT,
    })

    expect(preserved.spatial_frame).toEqual(document.spatial_frame)
    expect(replaced.spatial_frame).toEqual(replacement)
    expect(replaced.spatial_frame).not.toBe(replacement)
    expect(replaced.spatial_frame.location_metadata).not.toBe(replacement.location_metadata)
  })

  it('normalizes raw loaded files into extra while the scene codec keeps only scene-owned extra', () => {
    const normalized = normalizeLoadedDocument(RAW_DOCUMENT as unknown as CanopiFile)

    expect(normalized.extra).toEqual({
      preserved_from_file: 'keep-me',
      schema_extension_flag: true,
      experimental_block: {
        source: 'future-version',
        values: [1, 2, 3],
      },
    })
    expect('schema_extension_flag' in (normalized as unknown as Record<string, unknown>)).toBe(false)
    expect('experimental_block' in (normalized as unknown as Record<string, unknown>)).toBe(false)

    const now = new Date('2026-04-13T12:00:00.000Z')
    const roundTripped = serializeScenePersistedState(
      hydrateScenePersistedState(normalized),
      { now },
    )

    expect(roundTripped.extra).toEqual({})
    expect(roundTripped.updated_at).toBe(now.toISOString())
  })

  it('round-trips typed Object Group members through the scene codec without legacy group authority', () => {
    const file = {
      ...BASE_DOCUMENT,
      groups: [{
        id: 'group-1',
        locked: false,
        name: 'Guild',
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'zone', id: 'zone-1' },
          { kind: 'annotation', id: 'annotation-1' },
        ],
      }],
    } satisfies CanopiFile

    const scene = hydrateScenePersistedState(file)
    expect(scene.groups).toEqual([{
      kind: 'group',
      id: 'group-1',
      locked: false,
      name: 'Guild',
      members: [
        { kind: 'plant', id: 'plant-1' },
        { kind: 'zone', id: 'zone-1' },
        { kind: 'annotation', id: 'annotation-1' },
      ],
    }])
    expect(scene.groups[0]).not.toHaveProperty('memberIds')
    expect(scene.groups[0]).not.toHaveProperty('layer')
    expect(scene.groups[0]).not.toHaveProperty('position')
    expect(scene.groups[0]).not.toHaveProperty('rotationDeg')

    const serialized = serializeScenePersistedState(scene)
    expect(serialized.groups).toEqual([{
      id: 'group-1',
      locked: false,
      name: 'Guild',
      members: [
        { kind: 'plant', id: 'plant-1' },
        { kind: 'zone', id: 'zone-1' },
        { kind: 'annotation', id: 'annotation-1' },
      ],
    }])
    expect(serialized.groups[0]).not.toHaveProperty('member_ids')
    expect(serialized.groups[0]).not.toHaveProperty('layer')
    expect(serialized.groups[0]).not.toHaveProperty('position')
    expect(serialized.groups[0]).not.toHaveProperty('rotation')
  })

  it('defaults document-owned arrays that Rust defaults but generated TypeScript marks optional', () => {
    const normalized = normalizeLoadedDocument({
      ...RAW_DOCUMENT,
      annotations: undefined,
      consortiums: undefined,
      groups: undefined,
      timeline: undefined,
      budget: undefined,
      future_panel_field: { preserve: true },
    } as unknown as CanopiFile)

    expect(normalized.annotations).toEqual([])
    expect(normalized.consortiums).toEqual([])
    expect(normalized.groups).toEqual([])
    expect(normalized.timeline).toEqual([])
    expect(normalized.budget).toEqual([])
    expect(normalized.extra).toMatchObject({
      future_panel_field: { preserve: true },
    })
  })

  it('preserves Plant Symbol species defaults through load normalization and save composition', () => {
    const normalized = normalizeLoadedDocument({
      ...RAW_DOCUMENT,
      plant_species_symbols: {
        'Malus domestica': 'tree',
      },
    } as unknown as CanopiFile)

    expect(normalized.plant_species_symbols).toEqual({
      'Malus domestica': 'tree',
    })
    expect(normalized.extra).not.toHaveProperty('plant_species_symbols')

    const saved = composeDocumentForSave({
      metadata: { name: 'Saved symbols' },
      document: BASE_DOCUMENT,
      canvas: {
        ...BASE_DOCUMENT,
        plant_species_symbols: {
          'Malus domestica': 'tree',
          'Pyrus communis': 'round',
        },
      },
    })

    expect(saved.plant_species_symbols).toEqual({
      'Malus domestica': 'tree',
      'Pyrus communis': 'round',
    })
  })

  it('composes saves from document-owned sections and scene-owned canvas output', () => {
    const document = {
      ...BASE_DOCUMENT,
      name: 'Document copy',
      description: 'Document description',
      spatial_frame: { anchor_longitude_deg: 2.3522, anchor_latitude_deg: 48.8566, north_bearing_deg: 22, placement_status: 'confirmed', location_metadata: { altitude_m: 35 } },
      consortiums: [{
        target: consortiumTarget('Quercus robur'),
        stratum: 'high',
        start_phase: 0,
        end_phase: 3,
      }],
      timeline: [{
        id: 'task-1',
        action_type: 'mulch',
        description: 'Apply mulch',
        start_date: '2026-04-10',
        end_date: null,
        recurrence: null,
        targets: [speciesTarget('Quercus robur')],
        depends_on: null,
        completed: false,
        order: 1,
      }],
      budget: [{
        target: speciesBudgetTarget('Quercus robur'),
        category: 'plants',
        description: 'Quercus robur',
        quantity: 1,
        unit_cost: 12,
        currency: 'USD',
      }],
      budget_currency: 'USD',
      lidar: {
        schema_version: 1,
        entries: [{
          kind: 'Source',
          id: 'saved-lidar',
          visible: true,
          opacity: 0.8,
          order: 0,
          style: null,
        }],
      },
      extra: {
        guides: [{ id: 'old-guide', axis: 'h', position: 12 }],
        future_panel_field: { preserve: true },
      },
      future_top_level: 'drop-after-normalize',
    } as CanopiFile & { future_top_level: string }
    const canvas = {
      ...BASE_DOCUMENT,
      name: 'Untitled',
      plant_species_colors: { 'Quercus robur': '#228833' },
      layers: [{ name: 'plants', visible: false, locked: false, opacity: 0.5 }],
      plants: [{
        id: 'plant-1',
        canonical_name: 'Quercus robur',
        common_name: 'English oak',
        color: '#228833',
        position: { x: 10, y: 20 },
        rotation: null,
        scale: 3,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      }],
      zones: [{
        name: 'North bed',
        zone_type: 'planting',
        rotation: 0,
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
        fill_color: '#99CC66',
        notes: null,
        locked: false,
      }],
      annotations: [{
        id: 'annotation-1',
        annotation_type: 'text',
        position: { x: 5, y: 5 },
        text: 'North',
        font_size: 12,
        rotation: null,
        locked: false,
      }],
      groups: [{
        id: 'group-1',
        locked: false,
        name: 'Trees',
        members: [{ kind: 'plant', id: 'plant-1' }],
      }],
      updated_at: '2026-04-13T12:00:00.000Z',
      extra: {
        guides: [{ id: 'new-guide', axis: 'v', position: 42 }],
      },
    } satisfies CanopiFile

    const saved = composeDocumentForSave({
      metadata: {
        name: 'Saved document',
        spatialFrame: { ...document.spatial_frame, north_bearing_deg: 14 },
      },
      document,
      canvas,
    })

    expect(saved.name).toBe('Saved document')
    expect(saved.description).toBe('Document description')
    expect(saved.spatial_frame).toEqual({ ...document.spatial_frame, north_bearing_deg: 14 })
    expect(saved.created_at).toBe(document.created_at)
    expect(saved.updated_at).toBe(canvas.updated_at)
    expect(saved.consortiums).toEqual(document.consortiums)
    expect(saved.timeline).toEqual(document.timeline)
    expect(saved.budget).toEqual(document.budget)
    expect(saved.budget_currency).toBe('USD')
    expect(saved.lidar).toEqual(document.lidar)
    expect(saved.plant_species_colors).toEqual(canvas.plant_species_colors)
    expect(saved.layers).toEqual(canvas.layers)
    expect(saved.plants).toEqual(canvas.plants)
    expect(saved.zones).toEqual(canvas.zones)
    expect(saved.annotations).toEqual(canvas.annotations)
    expect(saved.groups).toEqual(canvas.groups)
    expect(saved.groups).toEqual([{
      id: 'group-1',
      locked: false,
      name: 'Trees',
      members: [{ kind: 'plant', id: 'plant-1' }],
    }])
    expect(saved.groups[0]).not.toHaveProperty('member_ids')
    expect(saved.groups[0]).not.toHaveProperty('layer')
    expect(saved.groups[0]).not.toHaveProperty('position')
    expect(saved.groups[0]).not.toHaveProperty('rotation')
    expect(saved.extra).toEqual({
      guides: [{ id: 'new-guide', axis: 'v', position: 42 }],
      future_panel_field: { preserve: true },
    })
    expect('future_top_level' in (saved as unknown as Record<string, unknown>)).toBe(false)
  })
})
