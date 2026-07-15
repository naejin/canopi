// @vitest-environment node

import { createRequire } from 'node:module'
import {
  createDuckDB,
  NODE_RUNTIME,
  VoidLogger,
  type DuckDBBundles,
} from '@duckdb/duckdb-wasm/blocking'
import { describe, expect, it } from 'vitest'
import { createEmptySpeciesFilter } from '../app/plant-browser'
import { createDuckDbReducedSpeciesCatalogReader } from '../web/duckdb-wasm-catalog'
import { validWebCatalogManifest } from './fixtures/web-catalog-manifest'

const SPECIES_PARQUET = "read_parquet('species/species-0000.parquet')"
const FRENCH_NAMES_PARQUET = "read_parquet('names/names-fr.parquet')"
const IMAGES_PARQUET = "read_parquet('images/images-0000.parquet')"

describe('DuckDB-WASM Species Catalog executable SQL', () => {
  it('executes detail hydration and locale-name ordering in real DuckDB-WASM', async () => {
    const duckdb = await createExecutableDuckDb()
    const reader = createDuckDbReducedSpeciesCatalogReader({
      catalogBaseUrl: new URL('https://catalog.example.test/canopi-catalog/'),
      fetchJson: async () => validWebCatalogManifest(),
      createDatabase: async () => duckdb,
    })

    try {
      await expect(reader.getSpeciesDetail('Malus domestica', 'fr')).resolves.toMatchObject({
        canonical_name: 'Malus domestica',
        common_name: 'A',
        common_names: ['A', 'a', 'Á', '𐀀', 'zz'],
        image: {
          url: 'https://images.example.test/apple.jpg',
        },
      })

      const request = {
        text: 'ar',
        filters: createEmptySpeciesFilter(),
        cursor: null,
        limit: 1,
        sort: 'Relevance' as const,
        locale: 'fr',
        include_total: false,
      }
      const firstPage = await reader.searchSpecies(request, new Set())
      const secondPage = await reader.searchSpecies({
        ...request,
        cursor: firstPage.next_cursor,
      }, new Set())
      const thirdPage = await reader.searchSpecies({
        ...request,
        cursor: secondPage.next_cursor,
      }, new Set())

      expect(firstPage.items.map((item) => item.canonical_name)).toEqual(['Prunus armeniaca'])
      expect(firstPage.next_cursor).toBe('offset:1')
      expect(secondPage.items.map((item) => item.canonical_name)).toEqual(['Ar alpha'])
      expect(secondPage.next_cursor).toBe('offset:2')
      expect(thirdPage.items.map((item) => item.canonical_name)).toEqual(['Ar beta'])
      expect(thirdPage.next_cursor).toBeNull()
      expect([firstPage, secondPage, thirdPage].map((page) => page.total_estimate)).toEqual([0, 0, 0])
    } finally {
      await reader.dispose()
    }
  })
})

async function createExecutableDuckDb() {
  const require = createRequire(import.meta.url)
  const bundles: DuckDBBundles = {
    mvp: {
      mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'),
      mainWorker: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js'),
    },
    eh: {
      mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm'),
      mainWorker: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js'),
    },
  }
  const bindings = await createDuckDB(bundles, new VoidLogger(), NODE_RUNTIME)
  await bindings.instantiate(() => {})
  bindings.open({})
  const connection = bindings.connect()

  return {
    connect: () => ({
      query: (sql: string) => connection.query(withInlineCatalogFixtures(sql)),
      close: () => connection.close(),
    }),
    registerFileURL: () => {},
    terminate: () => bindings.reset(),
  }
}

function withInlineCatalogFixtures(sql: string): string {
  return sql
    .split(SPECIES_PARQUET).join(SPECIES_VALUES)
    .split(FRENCH_NAMES_PARQUET).join(FRENCH_NAME_VALUES)
    .split(IMAGES_PARQUET).join(IMAGE_VALUES)
}

const SPECIES_VALUES = `(
  SELECT * FROM (VALUES
    (
      'species-apple'::VARCHAR,
      'malus-domestica'::VARCHAR,
      'Malus domestica'::VARCHAR,
      'Apple'::VARCHAR,
      'malus domestica'::VARCHAR,
      'apple'::VARCHAR,
      '["Temperate"]'::VARCHAR,
      'Tree'::VARCHAR,
      'Tree'::VARCHAR,
      '["Perennial"]'::VARCHAR
    ),
    (
      'species-apricot'::VARCHAR,
      'prunus-armeniaca'::VARCHAR,
      'Prunus armeniaca'::VARCHAR,
      'Apricot'::VARCHAR,
      'prunus armeniaca'::VARCHAR,
      'apricot'::VARCHAR,
      '["Temperate"]'::VARCHAR,
      'Tree'::VARCHAR,
      'Tree'::VARCHAR,
      '["Perennial"]'::VARCHAR
    ),
    (
      'species-ar-alpha'::VARCHAR,
      'ar-alpha'::VARCHAR,
      'Ar alpha'::VARCHAR,
      NULL::VARCHAR,
      'ar alpha'::VARCHAR,
      NULL::VARCHAR,
      '[]'::VARCHAR,
      NULL::VARCHAR,
      NULL::VARCHAR,
      '[]'::VARCHAR
    ),
    (
      'species-ar-beta'::VARCHAR,
      'ar-beta'::VARCHAR,
      'Ar beta'::VARCHAR,
      NULL::VARCHAR,
      'ar beta'::VARCHAR,
      NULL::VARCHAR,
      '[]'::VARCHAR,
      NULL::VARCHAR,
      NULL::VARCHAR,
      '[]'::VARCHAR
    )
  ) AS fixture(
    id,
    slug,
    canonical_name,
    common_name,
    normalized_canonical_name,
    normalized_common_name,
    climate_zones,
    habit,
    growth_form,
    life_cycles
  )
)`

const FRENCH_NAME_VALUES = `(
  SELECT * FROM (VALUES
    ('species-apple'::VARCHAR, 'fr'::VARCHAR, 'zz'::VARCHAR, 'zz'::VARCHAR, 'false'::VARCHAR, '0'::VARCHAR),
    ('species-apple'::VARCHAR, 'fr'::VARCHAR, '𐀀'::VARCHAR, '𐀀'::VARCHAR, 'false'::VARCHAR, '0'::VARCHAR),
    ('species-apple'::VARCHAR, 'fr'::VARCHAR, 'Á'::VARCHAR, 'a'::VARCHAR, 'false'::VARCHAR, '0'::VARCHAR),
    ('species-apple'::VARCHAR, 'fr'::VARCHAR, 'a'::VARCHAR, 'a'::VARCHAR, 'false'::VARCHAR, '0'::VARCHAR),
    ('species-apple'::VARCHAR, 'fr'::VARCHAR, 'A'::VARCHAR, 'a'::VARCHAR, 'false'::VARCHAR, '0'::VARCHAR),
    ('species-apple'::VARCHAR, 'fr'::VARCHAR, 'A'::VARCHAR, 'a'::VARCHAR, 'true'::VARCHAR, '5'::VARCHAR),
    ('species-apricot'::VARCHAR, 'fr'::VARCHAR, 'Arbre fruitier'::VARCHAR, 'arbre fruitier'::VARCHAR, 'true'::VARCHAR, '0'::VARCHAR)
  ) AS fixture(
    species_id,
    language,
    common_name,
    normalized_name,
    is_primary,
    display_order
  )
)`

const IMAGE_VALUES = `(
  SELECT * FROM (VALUES
    (
      'species-apple'::VARCHAR,
      'https://images.example.test/apple.jpg'::VARCHAR,
      NULL::VARCHAR,
      NULL::VARCHAR,
      NULL::VARCHAR,
      NULL::VARCHAR
    )
  ) AS fixture(species_id, url, source, source_page_url, credit, license)
)`
