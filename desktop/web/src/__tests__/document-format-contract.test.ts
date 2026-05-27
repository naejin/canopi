import { describe, expect, it } from 'vitest'
import { hydrateScenePersistedState, serializeScenePersistedState } from '../canvas/runtime/scene/codec'
import {
  composeDocumentForSave,
  DOCUMENT_FILE_FIELD_OWNERS,
  normalizeLoadedDocument,
} from '../app/contracts/document'
import { KNOWN_CANOPI_KEYS } from '../generated/known-canopi-keys'
import { consortiumTarget, speciesBudgetTarget, speciesTarget } from '../panel-targets'
import type { CanopiFile } from '../types/design'

const RAW_DOCUMENT = {
  version: 2,
  name: 'Format contract',
  description: null,
  location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
  north_bearing_deg: 9,
  plant_species_colors: {},
  layers: [],
  plants: [],
  zones: [],
  annotations: [],
  consortiums: [],
  groups: [],
  timeline: [],
  budget: [],
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
  version: 2,
  name: 'Contract base',
  description: null,
  location: null,
  north_bearing_deg: 0,
  plant_species_colors: {},
  layers: [],
  plants: [],
  zones: [],
  annotations: [],
  consortiums: [],
  groups: [],
  timeline: [],
  budget: [],
  created_at: '2026-04-13T00:00:00.000Z',
  updated_at: '2026-04-13T00:00:00.000Z',
  extra: {},
}

describe('document format contract', () => {
  it('keeps field ownership aligned with generated known file keys', () => {
    expect(Object.keys(DOCUMENT_FILE_FIELD_OWNERS)).toEqual(KNOWN_CANOPI_KEYS)
  })

  it('normalizes raw loaded files while preserving unknown top-level fields', () => {
    const normalized = normalizeLoadedDocument(RAW_DOCUMENT as unknown as CanopiFile)

    expect(normalized.extra).toEqual({
      preserved_from_file: 'keep-me',
    })
    expect(normalized as unknown as Record<string, unknown>).toMatchObject({
      schema_extension_flag: true,
      experimental_block: {
        source: 'future-version',
        values: [1, 2, 3],
      },
    })

    const now = new Date('2026-04-13T12:00:00.000Z')
    const roundTripped = serializeScenePersistedState(
      hydrateScenePersistedState(normalized),
      { now },
    )

    expect(roundTripped.extra).toEqual({})
    expect(roundTripped.updated_at).toBe(now.toISOString())
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
    expect(normalized.extra).toEqual({
      preserved_from_file: 'keep-me',
    })
    expect(normalized as unknown as Record<string, unknown>).toMatchObject({
      future_panel_field: { preserve: true },
    })
  })

  it('composes saves from document-owned sections and scene-owned canvas output', () => {
    const document = {
      ...BASE_DOCUMENT,
      name: 'Document copy',
      description: 'Document description',
      location: { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
      north_bearing_deg: 22,
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
      extra: {
        guides: [{ id: 'old-guide', axis: 'h', position: 12 }],
        future_panel_field: { preserve: true },
      },
      future_top_level: 'preserve-after-normalize',
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
      }],
      zones: [{
        name: 'North bed',
        zone_type: 'planting',
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
        fill_color: '#99CC66',
        notes: null,
      }],
      annotations: [{
        id: 'annotation-1',
        annotation_type: 'text',
        position: { x: 5, y: 5 },
        text: 'North',
        font_size: 12,
        rotation: null,
      }],
      groups: [{
        id: 'group-1',
        name: 'Trees',
        layer: 'plants',
        position: { x: 10, y: 20 },
        rotation: null,
        member_ids: ['plant-1'],
      }],
      updated_at: '2026-04-13T12:00:00.000Z',
      extra: {
        guides: [{ id: 'new-guide', axis: 'v', position: 42 }],
      },
    } satisfies CanopiFile

    const saved = composeDocumentForSave({
      metadata: { name: 'Saved document', northBearingDeg: 14 },
      document,
      canvas,
    })

    expect(saved.name).toBe('Saved document')
    expect(saved.description).toBe('Document description')
    expect(saved.location).toEqual({ lat: 48.8566, lon: 2.3522, altitude_m: 35 })
    expect(saved.north_bearing_deg).toBe(14)
    expect(saved.created_at).toBe(document.created_at)
    expect(saved.updated_at).toBe(canvas.updated_at)
    expect(saved.consortiums).toEqual(document.consortiums)
    expect(saved.timeline).toEqual(document.timeline)
    expect(saved.budget).toEqual(document.budget)
    expect(saved.budget_currency).toBe('USD')
    expect(saved.plant_species_colors).toEqual(canvas.plant_species_colors)
    expect(saved.layers).toEqual(canvas.layers)
    expect(saved.plants).toEqual(canvas.plants)
    expect(saved.zones).toEqual(canvas.zones)
    expect(saved.annotations).toEqual(canvas.annotations)
    expect(saved.groups).toEqual(canvas.groups)
    expect(saved.extra).toEqual({
      guides: [{ id: 'new-guide', axis: 'v', position: 42 }],
      future_panel_field: { preserve: true },
    })
    expect(saved as unknown as Record<string, unknown>).toMatchObject({
      future_top_level: 'preserve-after-normalize',
    })
  })
})
