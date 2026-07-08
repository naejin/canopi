import { describe, expect, it, vi } from 'vitest'
import { createEmptySpeciesFilter } from '../app/plant-browser'
import { createDuckDbReducedSpeciesCatalogReader } from '../web/duckdb-wasm-catalog'
import type { SpeciesSearchRequest } from '../types/species'

describe('DuckDB-WASM reduced Species Catalog reader', () => {
  it('browses Species from Parquet assets and keeps DuckDB alive for reuse', async () => {
    const queries: string[] = []
    const connection = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql)
        if (/COUNT/i.test(sql)) {
          return table([{ total_count: 3 }])
        }
        return table([
          {
            id: 'species-apple',
            slug: 'malus-domestica',
            canonical_name: 'Malus domestica',
            common_name: 'Apple',
            climate_zones: '["Temperate"]',
            habit: 'Tree',
            growth_form: 'Tree',
            life_cycles: '["Perennial"]',
          },
        ])
      }),
      close: vi.fn(async () => {}),
    }
    const database = {
      connect: vi.fn(async () => connection),
      registerFileURL: vi.fn(async () => {}),
      terminate: vi.fn(async () => {}),
    }
    const reader = createDuckDbReducedSpeciesCatalogReader({
      catalogBaseUrl: new URL('https://cdn.example.test/app/canopi-catalog/'),
      fetchJson: async () => ({
        asset_format: 'parquet',
        duckdb: { reader: 'read_parquet' },
        assets: {
          species: [{ path: 'species/species-0000.parquet' }],
          names: {},
          images: [],
        },
      }),
      createDatabase: async () => database,
    })

    const page = await reader.searchSpecies(searchRequest({
      include_total: true,
      limit: 1,
    }), new Set(['Malus domestica']))

    expect(database.registerFileURL).toHaveBeenCalledWith(
      'species/species-0000.parquet',
      'https://cdn.example.test/app/canopi-catalog/species/species-0000.parquet',
      expect.anything(),
      false,
    )
    expect(queries.some((sql) => sql.includes('read_parquet'))).toBe(true)
    expect(queries.join('\n')).toContain('LIMIT 1')
    expect(page).toEqual({
      items: [
        expect.objectContaining({
          canonical_name: 'Malus domestica',
          common_name: 'Apple',
          climate_zones: ['Temperate'],
          life_cycles: ['Perennial'],
          is_favorite: true,
        }),
      ],
      next_cursor: 'offset:1',
      total_estimate: 3,
    })
    expect(connection.close).not.toHaveBeenCalled()
    expect(database.terminate).not.toHaveBeenCalled()
  })

  it('rejects legacy NDJSON catalog manifests in the production Web reader', async () => {
    const createDatabase = vi.fn(async () => ({
      connect: vi.fn(async () => ({
        query: vi.fn(async () => table([])),
        close: vi.fn(async () => {}),
      })),
      registerFileURL: vi.fn(async () => {}),
      terminate: vi.fn(async () => {}),
    }))
    const reader = createDuckDbReducedSpeciesCatalogReader({
      catalogBaseUrl: new URL('https://cdn.example.test/app/canopi-catalog/'),
      fetchJson: async () => ({
        asset_format: 'ndjson',
        assets: {
          species: [{ path: 'species/species-0000.jsonl' }],
          names: {},
          images: [],
        },
      }),
      createDatabase,
    })

    await expect(reader.searchSpecies(searchRequest(), new Set())).rejects.toThrow(/Parquet/i)
    expect(createDatabase).not.toHaveBeenCalled()
  })

  it('uses only the active locale name shard for localized display and matching', async () => {
    const queries: string[] = []
    const connection = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql)
        return table([
          {
            id: 'species-apple',
            slug: 'malus-domestica',
            canonical_name: 'Malus domestica',
            common_name: 'Apple',
            localized_common_name: 'Pommier',
            matched_common_name: 'Pommier',
            climate_zones: '["Temperate"]',
            habit: 'Tree',
            growth_form: 'Tree',
            life_cycles: '["Perennial"]',
          },
        ])
      }),
      close: vi.fn(async () => {}),
    }
    const database = {
      connect: vi.fn(async () => connection),
      registerFileURL: vi.fn(async () => {}),
      terminate: vi.fn(async () => {}),
    }
    const reader = createDuckDbReducedSpeciesCatalogReader({
      catalogBaseUrl: new URL('https://cdn.example.test/app/canopi-catalog/'),
      fetchJson: async () => ({
        asset_format: 'parquet',
        duckdb: { reader: 'read_parquet' },
        assets: {
          species: [{ path: 'species/species-0000.parquet' }],
          names: {
            en: { path: 'names/names-en.parquet' },
            fr: { path: 'names/names-fr.parquet' },
          },
          images: [],
        },
      }),
      createDatabase: async () => database,
    })

    const page = await reader.searchSpecies(searchRequest({
      text: 'pomm',
      locale: 'fr',
      limit: 10,
    }), new Set())

    expect(database.registerFileURL).toHaveBeenCalledWith(
      'names/names-fr.parquet',
      'https://cdn.example.test/app/canopi-catalog/names/names-fr.parquet',
      expect.anything(),
      false,
    )
    expect(database.registerFileURL).not.toHaveBeenCalledWith(
      'names/names-en.parquet',
      expect.anything(),
      expect.anything(),
      false,
    )
    expect(queries.join('\n')).toContain("read_parquet('names/names-fr.parquet')")
    expect(queries.join('\n')).toContain('normalized_name')
    expect(page.items[0]).toMatchObject({
      canonical_name: 'Malus domestica',
      common_name: 'Pommier',
      matched_common_name: 'Pommier',
    })
  })

  it('projects supported filters and applies them to Parquet searches', async () => {
    const queries: string[] = []
    const connection = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql)
        if (sql.includes('SELECT s.climate_zones')) {
          return table([
            {
              climate_zones: '["Temperate","Boreal"]',
              habit: 'Tree',
              growth_form: 'Woody',
              life_cycles: '["Perennial"]',
            },
            {
              climate_zones: '["Mediterranean"]',
              habit: 'Herbaceous',
              growth_form: 'Forb',
              life_cycles: '["Annual"]',
            },
          ])
        }
        return table([
          {
            id: 'species-apple',
            slug: 'malus-domestica',
            canonical_name: 'Malus domestica',
            common_name: 'Apple',
            climate_zones: '["Temperate"]',
            habit: 'Tree',
            growth_form: 'Tree',
            life_cycles: '["Perennial"]',
          },
        ])
      }),
      close: vi.fn(async () => {}),
    }
    const reader = createDuckDbReducedSpeciesCatalogReader({
      catalogBaseUrl: new URL('https://cdn.example.test/app/canopi-catalog/'),
      fetchJson: async () => ({
        asset_format: 'parquet',
        duckdb: { reader: 'read_parquet' },
        supported_filters: [
          {
            key: 'climate_zones',
            options_key: 'climate_zones',
            predicate: { kind: 'json_array_any', columns: ['climate_zones'] },
          },
          {
            key: 'habit',
            options_key: 'habits',
            predicate: { kind: 'text_any', columns: ['habit', 'growth_form'] },
          },
          {
            key: 'life_cycle',
            options_key: 'life_cycles',
            predicate: { kind: 'json_array_any', columns: ['life_cycles'] },
          },
        ],
        assets: {
          species: [{ path: 'species/species-0000.parquet' }],
          names: {},
          images: [],
        },
      }),
      createDatabase: async () => ({
        connect: vi.fn(async () => connection),
        registerFileURL: vi.fn(async () => {}),
        terminate: vi.fn(async () => {}),
      }),
    })

    await expect(reader.getSupportedFilterFields()).resolves.toEqual([
      'climate_zones',
      'habit',
      'life_cycle',
    ])
    await expect(reader.getFilterOptions()).resolves.toMatchObject({
      climate_zones: ['Boreal', 'Mediterranean', 'Temperate'],
      habits: ['Forb', 'Herbaceous', 'Tree', 'Woody'],
      life_cycles: ['Annual', 'Perennial'],
      sun_tolerances: [],
    })

    await reader.searchSpecies(searchRequest({
      filters: {
        ...createEmptySpeciesFilter(),
        climate_zones: ['Temperate'],
        habit: ['Tree'],
        life_cycle: ['Perennial'],
        woody: true,
      },
    }), new Set())

    const searchSql = queries.at(-1) ?? ''
    expect(searchSql).toContain(`CAST(s.climate_zones AS VARCHAR) LIKE '%"Temperate"%'`)
    expect(searchSql).toContain(`COALESCE(s.habit, '') IN ('Tree')`)
    expect(searchSql).toContain(`COALESCE(s.growth_form, '') IN ('Tree')`)
    expect(searchSql).toContain(`CAST(s.life_cycles AS VARCHAR) LIKE '%"Perennial"%'`)
    expect(searchSql).not.toContain('woody')
  })

  it('hydrates reduced Species detail and one hero image from Parquet assets', async () => {
    const queries: string[] = []
    const connection = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql)
        if (sql.includes('web_species_images')) {
          return table([
            {
              species_id: 'species-apple',
              url: 'https://images.example.test/apple.jpg',
              source: 'Wikimedia Commons',
              source_page_url: 'https://commons.example.test/apple',
              credit: 'Jane Gardener',
              license: 'CC BY-SA 4.0',
            },
          ])
        }
        return table([
          {
            id: 'species-apple',
            slug: 'malus-domestica',
            canonical_name: 'Malus domestica',
            common_name: 'Apple',
            localized_common_name: 'Pommier',
            matched_common_name: null,
            climate_zones: '["Temperate"]',
            habit: 'Tree',
            growth_form: 'Tree',
            life_cycles: '["Perennial"]',
          },
        ])
      }),
      close: vi.fn(async () => {}),
    }
    const database = {
      connect: vi.fn(async () => connection),
      registerFileURL: vi.fn(async () => {}),
      terminate: vi.fn(async () => {}),
    }
    const reader = createDuckDbReducedSpeciesCatalogReader({
      catalogBaseUrl: new URL('https://cdn.example.test/app/canopi-catalog/'),
      fetchJson: async () => ({
        asset_format: 'parquet',
        duckdb: { reader: 'read_parquet' },
        assets: {
          species: [{ path: 'species/species-0000.parquet' }],
          names: { fr: { path: 'names/names-fr.parquet' } },
          images: [{ path: 'images/images-0000.parquet' }],
        },
      }),
      createDatabase: async () => database,
    })

    const detail = await reader.getSpeciesDetail('Malus domestica', 'fr')

    expect(database.registerFileURL).toHaveBeenCalledWith(
      'images/images-0000.parquet',
      'https://cdn.example.test/app/canopi-catalog/images/images-0000.parquet',
      expect.anything(),
      false,
    )
    expect(queries.join('\n')).toContain("read_parquet('images/images-0000.parquet')")
    expect(detail).toEqual({
      canonical_name: 'Malus domestica',
      common_name: 'Pommier',
      common_names: ['Pommier'],
      climate_zones: ['Temperate'],
      habit: 'Tree',
      growth_form: 'Tree',
      life_cycles: ['Perennial'],
      image: {
        url: 'https://images.example.test/apple.jpg',
        source: 'Wikimedia Commons',
        source_page_url: 'https://commons.example.test/apple',
        credit: 'Jane Gardener',
        license: 'CC BY-SA 4.0',
      },
    })
    expect(detail).not.toHaveProperty('height_max_m')
    expect(detail).not.toHaveProperty('hardiness_zone_min')
    expect(detail).not.toHaveProperty('stratum')
    expect(detail).not.toHaveProperty('edibility_rating')
  })

  it('hydrates reduced Species detail when image metadata is absent', async () => {
    const connection = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('web_species_images')) return table([])
        return table([
          {
            id: 'species-apple',
            slug: 'malus-domestica',
            canonical_name: 'Malus domestica',
            common_name: 'Apple',
            localized_common_name: null,
            matched_common_name: null,
            climate_zones: '["Temperate"]',
            habit: 'Tree',
            growth_form: 'Tree',
            life_cycles: '["Perennial"]',
          },
        ])
      }),
      close: vi.fn(async () => {}),
    }
    const reader = createDuckDbReducedSpeciesCatalogReader({
      catalogBaseUrl: new URL('https://cdn.example.test/app/canopi-catalog/'),
      fetchJson: async () => ({
        asset_format: 'parquet',
        duckdb: { reader: 'read_parquet' },
        assets: {
          species: [{ path: 'species/species-0000.parquet' }],
          names: {},
          images: [],
        },
      }),
      createDatabase: async () => ({
        connect: vi.fn(async () => connection),
        registerFileURL: vi.fn(async () => {}),
        terminate: vi.fn(async () => {}),
      }),
    })

    await expect(reader.getSpeciesDetail('Malus domestica', 'fr')).resolves.toMatchObject({
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      common_names: ['Apple'],
      image: null,
    })
  })
})

function searchRequest(overrides: Partial<SpeciesSearchRequest> = {}): SpeciesSearchRequest {
  return {
    text: '',
    filters: createEmptySpeciesFilter(),
    cursor: null,
    limit: 50,
    sort: 'Name',
    locale: 'en',
    include_total: false,
    ...overrides,
  }
}

function table(rows: readonly Record<string, unknown>[]): { toArray(): unknown[] } {
  return {
    toArray: () => [...rows],
  }
}
