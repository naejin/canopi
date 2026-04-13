import { describe, expect, it } from 'vitest'
import { hydrateScenePersistedState, serializeScenePersistedState } from '../canvas/runtime/scene/codec'
import { normalizeLoadedDocument } from '../app/contracts/document'
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

describe('document format contract', () => {
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

    const now = new Date('2026-04-13T12:00:00.000Z')
    const roundTripped = serializeScenePersistedState(
      hydrateScenePersistedState(normalized),
      { now },
    )

    expect(roundTripped.extra).toEqual({})
    expect(roundTripped.updated_at).toBe(now.toISOString())
  })
})
