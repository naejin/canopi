import { describe, expect, it } from 'vitest'
import { admitWebCatalogManifest } from '../generated/web-catalog-artifact.mjs'
import { validWebCatalogManifest } from './fixtures/web-catalog-manifest'

describe('Web Species Catalog artifact contract', () => {
  it('admits a complete v1 manifest into a deeply immutable caller value', () => {
    const manifest = admitWebCatalogManifest(validWebCatalogManifest())

    expect(manifest.assetFormat).toBe('parquet')
    expect(manifest.supportedFilters.map((filter) => filter.key)).toEqual([
      'climate_zones',
      'habit',
      'life_cycle',
    ])
    expect(manifest.files.map((asset) => asset.path)).toEqual([
      'species/species-0000.parquet',
      'names/names-en.parquet',
      'names/names-fr.parquet',
      'names/names-es.parquet',
      'names/names-pt.parquet',
      'names/names-it.parquet',
      'names/names-zh.parquet',
      'names/names-de.parquet',
      'names/names-ja.parquet',
      'names/names-ko.parquet',
      'names/names-nl.parquet',
      'names/names-ru.parquet',
      'images/images-0000.parquet',
    ])
    expect(Object.isFrozen(manifest)).toBe(true)
    expect(Object.isFrozen(manifest.assets)).toBe(true)
    expect(Object.isFrozen(manifest.assets.names)).toBe(true)
    expect(Object.isFrozen(manifest.supportedFilters[0]?.predicate.columns)).toBe(true)
  })

  it('rejects a manifest issued by another artifact owner', () => {
    const manifest = validWebCatalogManifest()
    manifest.generated_by = 'another-catalog-producer'

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /generated_by.*canopi-web-catalog-v1/,
    )
  })

  it('rejects a manifest compiled against a stale artifact contract', () => {
    const manifest = validWebCatalogManifest()
    manifest.artifact_contract_fingerprint = '0'.repeat(64)

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /artifact_contract_fingerprint.*compiled contract/,
    )
  })

  it('rejects Species Search assets built with stale normalization semantics', () => {
    const manifest = validWebCatalogManifest()
    manifest.species_search_normalization = {
      version: 0,
      fingerprint: '0'.repeat(64),
    }

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /species_search_normalization.*expected the compiled normalization authority/,
    )
  })

  it('rejects row-schema logical type drift', () => {
    const manifest = validWebCatalogManifest()
    const schema = manifest.schema as {
      species_fields: Array<Record<string, unknown>>
    }
    schema.species_fields[0] = {
      ...schema.species_fields[0],
      logical_type: 'nullable_text',
    }

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /schema.species_fields.*compiled row schema/,
    )
  })

  it('rejects contracted locale drift', () => {
    const manifest = validWebCatalogManifest()
    manifest.locales = ['en', 'fr']

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /locales.*compiled locale order/,
    )
  })

  it('rejects supported Filter predicate drift', () => {
    const manifest = validWebCatalogManifest()
    const filters = manifest.supported_filters as Array<Record<string, unknown>>
    filters[0] = {
      ...filters[0],
      predicate: { kind: 'text_any', columns: ['climate_zones'] },
    }

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /supported_filters.*compiled Filter definitions/,
    )
  })

  it('rejects unsupported artifact versions', () => {
    const manifest = validWebCatalogManifest()
    manifest.version = 2

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /version.*expected 1/,
    )
  })

  it('rejects a non-Parquet DuckDB reader projection', () => {
    const manifest = validWebCatalogManifest()
    const duckdb = manifest.duckdb as Record<string, unknown>
    duckdb.reader = 'read_json_auto'

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /duckdb.reader.*read_parquet/,
    )
  })

  it('rejects non-Parquet artifact formats', () => {
    const manifest = validWebCatalogManifest()
    manifest.asset_format = 'ndjson'

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /asset_format.*parquet/,
    )
  })

  it('rejects artifact limits above the deployment contract', () => {
    const manifest = validWebCatalogManifest()
    const cloudflare = manifest.cloudflare_pages as Record<string, unknown>
    cloudflare.max_asset_bytes = 25 * 1024 * 1024 + 1

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /cloudflare_pages.max_asset_bytes.*26214400/,
    )
  })

  it('rejects malformed storage-contract provenance', () => {
    const manifest = validWebCatalogManifest()
    const source = manifest.source as Record<string, unknown>
    source.storage_contract_fingerprint = 'unknown'

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /source.storage_contract_fingerprint.*64 lowercase hexadecimal/,
    )
  })

  it('rejects URL-normalizing asset path escapes', () => {
    const manifest = validWebCatalogManifest()
    const assets = manifest.assets as {
      species: Array<Record<string, unknown>>
    }
    assets.species[0] = {
      ...assets.species[0],
      path: 'species/%2e%2e/outside.parquet',
    }

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /assets.species\[0\].path.*safe portable relative path/,
    )
  })

  it('rejects malformed asset integrity metadata', () => {
    const manifest = validWebCatalogManifest()
    const assets = manifest.assets as {
      images: Array<Record<string, unknown>>
    }
    assets.images[0] = { ...assets.images[0], sha256: 'not-a-digest' }

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /assets.images\[0\].sha256.*64 lowercase hexadecimal/,
    )
  })

  it('rejects assets above the manifest deployment limit', () => {
    const manifest = validWebCatalogManifest()
    const cloudflare = manifest.cloudflare_pages as { max_asset_bytes: number }
    const assets = manifest.assets as {
      images: Array<Record<string, unknown>>
    }
    cloudflare.max_asset_bytes = 9
    assets.images[0] = { ...assets.images[0], bytes: 10 }

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /assets.images\[0\].bytes.*declared asset limit 9/,
    )
  })

  it('rejects assets outside their contracted group layout', () => {
    const manifest = validWebCatalogManifest()
    const assets = manifest.assets as {
      species: Array<Record<string, unknown>>
    }
    assets.species[0] = {
      ...assets.species[0],
      path: 'species/not-a-shard.parquet',
    }

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /assets.species\[0\].path.*contracted species asset layout/,
    )
  })

  it('rejects duplicate asset paths', () => {
    const manifest = validWebCatalogManifest()
    const assets = manifest.assets as {
      species: Array<Record<string, unknown>>
    }
    assets.species.push({ ...assets.species[0] })

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /assets.species\[1\].path.*duplicate asset path/,
    )
  })

  it('rejects Common Name assets outside the contracted locale set', () => {
    const manifest = validWebCatalogManifest()
    const assets = manifest.assets as {
      names: Record<string, Record<string, unknown>>
    }
    assets.names.xx = {
      path: 'names/names-xx.parquet',
      bytes: 10,
      sha256: 'e'.repeat(64),
    }

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /assets.names.xx.*unsupported locale asset/,
    )
  })

  it('requires nonempty Species and Image asset groups', () => {
    const manifest = validWebCatalogManifest()
    const assets = manifest.assets as {
      images: Array<Record<string, unknown>>
    }
    assets.images = []

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /assets.images.*at least one asset/,
    )
  })

  it('rejects DuckDB table paths that contradict admitted assets', () => {
    const manifest = validWebCatalogManifest()
    const duckdb = manifest.duckdb as {
      tables: Record<string, unknown>
    }
    duckdb.tables.web_species = ['species/species-9999.parquet']

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /duckdb.tables.web_species.*admitted asset paths/,
    )
  })

  it('rejects unknown manifest properties', () => {
    const manifest = validWebCatalogManifest()
    manifest.uncontracted_metadata = true

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /uncontracted_metadata.*unknown property/,
    )
  })

  it('rejects unknown properties at dynamic manifest boundaries', () => {
    const manifest = validWebCatalogManifest()
    const source = manifest.source as Record<string, unknown>
    const cloudflare = manifest.cloudflare_pages as Record<string, unknown>
    const schema = manifest.schema as Record<string, unknown>
    const duckdb = manifest.duckdb as Record<string, unknown>
    const assets = manifest.assets as {
      species: Array<Record<string, unknown>>
      unexpected?: boolean
    }
    source.unexpected = true
    cloudflare.unexpected = true
    schema.unexpected = true
    duckdb.unexpected = true
    assets.unexpected = true
    assets.species[0]!.unexpected = true

    expect(() => admitWebCatalogManifest(manifest)).toThrow(
      /source\.unexpected.*cloudflare_pages\.unexpected.*schema\.unexpected.*duckdb\.unexpected.*assets\.unexpected.*assets\.species\[0\]\.unexpected/s,
    )
  })
})
