import * as duckdb from '@duckdb/duckdb-wasm'
import {
  createInMemoryReducedSpeciesCatalogReader,
  type ReducedSpeciesCatalogData,
  type ReducedSpeciesCatalogReader,
  type ReducedSpeciesImageRow,
  type ReducedSpeciesNameRow,
  type ReducedSpeciesRow,
} from './reduced-species-catalog'
import type {
  DynamicFilterOptions,
  FilterOptions,
  PaginatedResult,
  SpeciesListItem,
  SpeciesSearchRequest,
} from '../types/species'

interface CatalogAssetEntry {
  readonly path: string
}

interface WebCatalogManifest {
  readonly asset_format: string
  readonly assets: {
    readonly species: readonly CatalogAssetEntry[]
    readonly names: Readonly<Record<string, CatalogAssetEntry>>
    readonly images: readonly CatalogAssetEntry[]
  }
}

interface DuckDbReducedSpeciesCatalogReaderOptions {
  readonly catalogBaseUrl?: URL
  readonly fetchJson?: (url: URL) => Promise<unknown>
}

export function createDuckDbReducedSpeciesCatalogReader(
  options: DuckDbReducedSpeciesCatalogReaderOptions = {},
): ReducedSpeciesCatalogReader {
  let readerPromise: Promise<ReducedSpeciesCatalogReader> | null = null

  async function reader(): Promise<ReducedSpeciesCatalogReader> {
    readerPromise ??= loadDuckDbCatalogReader(options)
    return readerPromise
  }

  return {
    async searchSpecies(
      request: SpeciesSearchRequest,
      favoriteNames: ReadonlySet<string>,
    ): Promise<PaginatedResult<SpeciesListItem>> {
      return (await reader()).searchSpecies(request, favoriteNames)
    },

    async listSpeciesByCanonicalNames(
      canonicalNames: readonly string[],
      locale: string,
      favoriteNames: ReadonlySet<string>,
    ): Promise<SpeciesListItem[]> {
      return (await reader()).listSpeciesByCanonicalNames(canonicalNames, locale, favoriteNames)
    },

    async getFilterOptions(): Promise<FilterOptions> {
      return (await reader()).getFilterOptions()
    },

    async getDynamicFilterOptions(
      fields: readonly string[],
      locale: string,
    ): Promise<DynamicFilterOptions[]> {
      return (await reader()).getDynamicFilterOptions(fields, locale)
    },
  }
}

async function loadDuckDbCatalogReader(
  options: DuckDbReducedSpeciesCatalogReaderOptions,
): Promise<ReducedSpeciesCatalogReader> {
  const catalogBaseUrl = options.catalogBaseUrl ?? defaultCatalogBaseUrl()
  const fetchJson = options.fetchJson ?? fetchCatalogJson
  const manifest = parseManifest(await fetchJson(new URL('manifest.json', catalogBaseUrl)))
  const database = await instantiateDuckDb()
  const connection = await database.connect()

  try {
    await registerCatalogAssets(database, catalogBaseUrl, manifest)
    const catalogData = await readCatalogData(connection, manifest)
    return createInMemoryReducedSpeciesCatalogReader(catalogData)
  } finally {
    await connection.close()
    await database.terminate()
  }
}

async function instantiateDuckDb(): Promise<duckdb.AsyncDuckDB> {
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles())
  if (bundle.mainWorker === null) {
    throw new Error('DuckDB-WASM did not provide a browser worker bundle.')
  }

  const workerUrl = URL.createObjectURL(new Blob([
    `importScripts(${JSON.stringify(bundle.mainWorker)});`,
  ], { type: 'text/javascript' }))

  try {
    const worker = new Worker(workerUrl)
    const database = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker)
    await database.instantiate(bundle.mainModule, bundle.pthreadWorker)
    return database
  } finally {
    URL.revokeObjectURL(workerUrl)
  }
}

async function registerCatalogAssets(
  database: duckdb.AsyncDuckDB,
  catalogBaseUrl: URL,
  manifest: WebCatalogManifest,
): Promise<void> {
  const assets = [
    ...manifest.assets.species,
    ...Object.values(manifest.assets.names),
    ...manifest.assets.images,
  ]
  await Promise.all(assets.map((asset) => (
    database.registerFileURL(
      asset.path,
      new URL(asset.path, catalogBaseUrl).toString(),
      duckdb.DuckDBDataProtocol.HTTP,
      false,
    )
  )))
}

async function readCatalogData(
  connection: duckdb.AsyncDuckDBConnection,
  manifest: WebCatalogManifest,
): Promise<ReducedSpeciesCatalogData> {
  const speciesTable = await connection.query(readNdjsonSql(
    manifest.assets.species.map((asset) => asset.path),
  ))
  const namesTable = await connection.query(readNdjsonSql(
    Object.values(manifest.assets.names).map((asset) => asset.path),
  ))
  const imagesTable = await connection.query(readNdjsonSql(
    manifest.assets.images.map((asset) => asset.path),
  ))

  return {
    species: tableRows(speciesTable).map(parseSpeciesRow),
    names: tableRows(namesTable).map(parseNameRow),
    images: tableRows(imagesTable).map(parseImageRow),
  }
}

function readNdjsonSql(paths: readonly string[]): string {
  if (paths.length === 0) return 'SELECT * FROM (SELECT NULL) WHERE FALSE'
  if (paths.length === 1) return `SELECT * FROM read_ndjson_auto(${quoteSqlString(paths[0] ?? '')})`
  return `SELECT * FROM read_ndjson_auto([${paths.map(quoteSqlString).join(', ')}])`
}

function quoteSqlString(value: string): string {
  return `'${value.split("'").join("''")}'`
}

function tableRows(table: { toArray(): unknown[] }): readonly Record<string, unknown>[] {
  return table.toArray().flatMap((row) => {
    if (!isRecord(row)) return []
    if ('toJSON' in row && typeof row.toJSON === 'function') {
      const json = row.toJSON() as unknown
      return isRecord(json) ? [json] : []
    }
    return [row]
  })
}

function parseSpeciesRow(row: Record<string, unknown>): ReducedSpeciesRow {
  return {
    id: requiredString(row.id, 'species.id'),
    slug: requiredString(row.slug, 'species.slug'),
    canonical_name: requiredString(row.canonical_name, 'species.canonical_name'),
    common_name: nullableString(row.common_name),
    climate_zones: stringArray(row.climate_zones),
    habit: nullableString(row.habit),
    growth_form: nullableString(row.growth_form),
    life_cycles: stringArray(row.life_cycles),
  }
}

function parseNameRow(row: Record<string, unknown>): ReducedSpeciesNameRow {
  return {
    species_id: requiredString(row.species_id, 'name.species_id'),
    language: requiredString(row.language, 'name.language'),
    common_name: requiredString(row.common_name, 'name.common_name'),
    normalized_name: requiredString(row.normalized_name, 'name.normalized_name'),
    is_primary: booleanValue(row.is_primary),
  }
}

function parseImageRow(row: Record<string, unknown>): ReducedSpeciesImageRow {
  return {
    species_id: requiredString(row.species_id, 'image.species_id'),
    url: requiredString(row.url, 'image.url'),
    source: nullableString(row.source),
    source_page_url: nullableString(row.source_page_url),
    credit: nullableString(row.credit),
    license: nullableString(row.license),
  }
}

function parseManifest(value: unknown): WebCatalogManifest {
  if (!isRecord(value) || value.asset_format !== 'ndjson' || !isRecord(value.assets)) {
    throw new Error('Invalid Web Edition Species Catalog manifest.')
  }
  const assets = value.assets
  if (!Array.isArray(assets.species) || !isRecord(assets.names) || !Array.isArray(assets.images)) {
    throw new Error('Invalid Web Edition Species Catalog asset manifest.')
  }
  return {
    asset_format: value.asset_format,
    assets: {
      species: assets.species.map(parseAssetEntry),
      names: Object.fromEntries(
        Object.entries(assets.names).map(([locale, entry]) => [locale, parseAssetEntry(entry)]),
      ),
      images: assets.images.map(parseAssetEntry),
    },
  }
}

function parseAssetEntry(value: unknown): CatalogAssetEntry {
  if (!isRecord(value) || typeof value.path !== 'string' || value.path.trim().length === 0) {
    throw new Error('Invalid Web Edition Species Catalog asset entry.')
  }
  return { path: value.path }
}

async function fetchCatalogJson(url: URL): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch Web Edition Species Catalog asset ${url.pathname}: ${response.status}`)
  }
  return response.json() as Promise<unknown>
}

function defaultCatalogBaseUrl(): URL {
  return new URL('canopi-catalog/', new URL(import.meta.env.BASE_URL, globalThis.location.href))
}

function requiredString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value
  throw new Error(`Invalid Web Edition Species Catalog row: ${field} is required.`)
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string')
  if (isRecord(value) && 'toArray' in value && typeof value.toArray === 'function') {
    const array = value.toArray() as unknown
    return Array.isArray(array)
      ? array.filter((entry): entry is string => typeof entry === 'string')
      : []
  }
  return []
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === 'true'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
