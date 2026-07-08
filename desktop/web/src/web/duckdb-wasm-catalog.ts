import * as duckdb from '@duckdb/duckdb-wasm'
import {
  createInMemoryReducedSpeciesCatalogReader,
  type ReducedSpeciesCatalogData,
  type ReducedSpeciesCatalogReader,
  type ReducedSpeciesImageRow,
  type ReducedSpeciesNameRow,
  type ReducedSpeciesRow,
} from './reduced-species-catalog'
import type { SpeciesCatalogDetail } from '../app/plant-browser/workbench'
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
  readonly asset_format: 'ndjson' | 'parquet'
  readonly duckdb?: {
    readonly reader?: string
  }
  readonly assets: {
    readonly species: readonly CatalogAssetEntry[]
    readonly names: Readonly<Record<string, CatalogAssetEntry>>
    readonly images: readonly CatalogAssetEntry[]
  }
}

interface DuckDbQueryTable {
  toArray(): unknown[]
}

interface DuckDbCatalogConnection {
  query(sql: string): DuckDbQueryTable | Promise<DuckDbQueryTable>
  close(): void | Promise<void>
}

interface DuckDbCatalogDatabase {
  connect(): DuckDbCatalogConnection | Promise<DuckDbCatalogConnection>
  registerFileURL(
    name: string,
    url: string,
    protocol: unknown,
    directIO: boolean,
  ): void | Promise<void>
  terminate(): void | Promise<void>
}

interface DuckDbReducedSpeciesCatalogReaderOptions {
  readonly catalogBaseUrl?: URL
  readonly fetchJson?: (url: URL) => Promise<unknown>
  readonly createDatabase?: () => Promise<DuckDbCatalogDatabase>
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

    async getSpeciesDetail(canonicalName: string, locale: string): Promise<SpeciesCatalogDetail | null> {
      return (await reader()).getSpeciesDetail(canonicalName, locale)
    },
  }
}

async function loadDuckDbCatalogReader(
  options: DuckDbReducedSpeciesCatalogReaderOptions,
): Promise<ReducedSpeciesCatalogReader> {
  const catalogBaseUrl = options.catalogBaseUrl ?? defaultCatalogBaseUrl()
  const fetchJson = options.fetchJson ?? fetchCatalogJson
  const manifest = parseManifest(await fetchJson(new URL('manifest.json', catalogBaseUrl)))
  const database = await (options.createDatabase ?? instantiateDuckDb)()
  const connection = await Promise.resolve(database.connect())

  try {
    await registerCatalogAssets(database, catalogBaseUrl, manifest)
    if (manifest.asset_format === 'parquet') {
      return new DuckDbParquetReducedSpeciesCatalogReader(
        database,
        connection,
        catalogBaseUrl,
        manifest,
      )
    }
    const catalogData = await readCatalogData(connection, manifest)
    return createInMemoryReducedSpeciesCatalogReader(catalogData)
  } catch (error) {
    await closeDuckDb(database, connection)
    throw error
  }
}

class DuckDbParquetReducedSpeciesCatalogReader implements ReducedSpeciesCatalogReader {
  private readonly registeredLocaleAssets = new Set<string>()

  constructor(
    private readonly database: DuckDbCatalogDatabase,
    private readonly connection: DuckDbCatalogConnection,
    private readonly catalogBaseUrl: URL,
    private readonly manifest: WebCatalogManifest,
  ) {}

  async searchSpecies(
    request: SpeciesSearchRequest,
    favoriteNames: ReadonlySet<string>,
  ): Promise<PaginatedResult<SpeciesListItem>> {
    await this.ensureLocaleNameAsset(request.locale)
    const offset = cursorToOffset(request.cursor)
    const limit = Math.max(0, request.limit)
    const speciesTable = readParquetSql(this.manifest.assets.species.map((asset) => asset.path))
    const namesTable = localeNamesSql(this.manifest, request.locale)
    const normalizedSearchText = normalizeSearchText(request.text)
    const rowsTable = await this.connection.query(`
      ${speciesProjectionSql({
        speciesTable,
        namesTable,
        whereSql: searchWhereSql(normalizedSearchText),
        normalizedSearchText,
      })}
      LIMIT ${limit}
      OFFSET ${offset}
    `)
    const rows = tableRows(rowsTable).map(parseSpeciesProjection)
    const totalEstimate = request.include_total
      ? await this.countSpecies(speciesTable, namesTable, normalizedSearchText)
      : 0
    const nextOffset = offset + rows.length
    const hasNextPage = request.include_total
      ? nextOffset < totalEstimate
      : rows.length === limit && limit > 0

    return {
      items: rows.map((row) => speciesProjectionToListItem(row, favoriteNames)),
      next_cursor: hasNextPage ? `offset:${nextOffset}` : null,
      total_estimate: totalEstimate,
    }
  }

  async listSpeciesByCanonicalNames(
    canonicalNames: readonly string[],
    locale: string,
    favoriteNames: ReadonlySet<string>,
  ): Promise<SpeciesListItem[]> {
    if (canonicalNames.length === 0) return []
    await this.ensureLocaleNameAsset(locale)
    const speciesTable = readParquetSql(this.manifest.assets.species.map((asset) => asset.path))
    const namesTable = localeNamesSql(this.manifest, locale)
    const rowsTable = await this.connection.query(`
      ${speciesProjectionSql({
        speciesTable,
        namesTable,
        whereSql: `WHERE s.canonical_name IN (${canonicalNames.map(quoteSqlString).join(', ')})`,
        normalizedSearchText: '',
      })}
    `)
    const rowsByName = new Map(tableRows(rowsTable).map((row) => {
      const species = parseSpeciesProjection(row)
      return [species.row.canonical_name, species]
    }))
    return canonicalNames.flatMap((canonicalName) => {
      const row = rowsByName.get(canonicalName)
      return row ? [speciesProjectionToListItem(row, favoriteNames)] : []
    })
  }

  async getFilterOptions(): Promise<FilterOptions> {
    return {
      families: [],
      growth_rates: [],
      climate_zones: [],
      habits: [],
      life_cycles: [],
      sun_tolerances: [],
      soil_tolerances: [],
    }
  }

  async getDynamicFilterOptions(
    _fields: readonly string[],
    _locale: string,
  ): Promise<DynamicFilterOptions[]> {
    return []
  }

  async getSpeciesDetail(
    _canonicalName: string,
    _locale: string,
  ): Promise<SpeciesCatalogDetail | null> {
    return null
  }

  private async countSpecies(
    speciesTable: string,
    namesTable: string,
    normalizedSearchText: string,
  ): Promise<number> {
    const countTable = await this.connection.query(`
      WITH locale_names AS (
        SELECT species_id,
               common_name,
               normalized_name
        FROM ${namesTable}
      )
      SELECT COUNT(*) AS total_count
      FROM ${speciesTable} s
      ${searchWhereSql(normalizedSearchText)}
    `)
    const countRow = tableRows(countTable)[0]
    return numberValue(countRow?.total_count)
  }

  private async ensureLocaleNameAsset(locale: string): Promise<void> {
    if (this.registeredLocaleAssets.has(locale)) return
    const asset = this.manifest.assets.names[locale]
    if (asset) {
      await this.database.registerFileURL(
        asset.path,
        new URL(asset.path, this.catalogBaseUrl).toString(),
        duckdb.DuckDBDataProtocol.HTTP,
        false,
      )
    }
    this.registeredLocaleAssets.add(locale)
  }
}

async function closeDuckDb(
  database: DuckDbCatalogDatabase,
  connection: DuckDbCatalogConnection,
): Promise<void> {
  try {
    await connection.close()
  } finally {
    await database.terminate()
  }
}

async function instantiateDuckDb(): Promise<DuckDbCatalogDatabase> {
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
  database: DuckDbCatalogDatabase,
  catalogBaseUrl: URL,
  manifest: WebCatalogManifest,
): Promise<void> {
  const assets = [
    ...manifest.assets.species,
    ...(manifest.asset_format === 'parquet' ? [] : Object.values(manifest.assets.names)),
    ...(manifest.asset_format === 'parquet' ? [] : manifest.assets.images),
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
  connection: DuckDbCatalogConnection,
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

function readParquetSql(paths: readonly string[]): string {
  if (paths.length === 0) return '(SELECT * FROM (SELECT NULL) WHERE FALSE)'
  if (paths.length === 1) return `read_parquet(${quoteSqlString(paths[0] ?? '')})`
  return `read_parquet([${paths.map(quoteSqlString).join(', ')}])`
}

function localeNamesSql(manifest: WebCatalogManifest, locale: string): string {
  const asset = manifest.assets.names[locale]
  return asset ? readParquetSql([asset.path]) : emptyLocaleNamesSql()
}

function emptyLocaleNamesSql(): string {
  return `(
    SELECT NULL::VARCHAR AS species_id,
           NULL::VARCHAR AS common_name,
           NULL::VARCHAR AS normalized_name,
           NULL::VARCHAR AS is_primary,
           NULL::VARCHAR AS display_order
    WHERE FALSE
  )`
}

function speciesProjectionSql({
  speciesTable,
  namesTable,
  whereSql,
  normalizedSearchText,
}: {
  readonly speciesTable: string
  readonly namesTable: string
  readonly whereSql: string
  readonly normalizedSearchText: string
}): string {
  const matchPredicate = normalizedSearchText
    ? `normalized_name LIKE ${quoteSqlString(`%${normalizedSearchText}%`)}`
    : 'FALSE'
  return `
    WITH locale_names AS (
      SELECT species_id,
             common_name,
             normalized_name,
             is_primary,
             display_order
      FROM ${namesTable}
    ),
    primary_names AS (
      SELECT species_id,
             common_name
      FROM (
        SELECT species_id,
               common_name,
               ROW_NUMBER() OVER (
                 PARTITION BY species_id
                 ORDER BY TRY_CAST(display_order AS INTEGER),
                          CASE WHEN CAST(is_primary AS VARCHAR) IN ('true', '1') THEN 0 ELSE 1 END,
                          LENGTH(common_name),
                          common_name
               ) AS rank
        FROM locale_names
      )
      WHERE rank = 1
    ),
    matched_names AS (
      SELECT species_id,
             common_name
      FROM (
        SELECT species_id,
               common_name,
               ROW_NUMBER() OVER (
                 PARTITION BY species_id
                 ORDER BY TRY_CAST(display_order AS INTEGER),
                          CASE WHEN CAST(is_primary AS VARCHAR) IN ('true', '1') THEN 0 ELSE 1 END,
                          LENGTH(common_name),
                          common_name
               ) AS rank
        FROM locale_names
        WHERE ${matchPredicate}
      )
      WHERE rank = 1
    )
    SELECT s.id,
           s.slug,
           s.canonical_name,
           s.common_name,
           primary_names.common_name AS localized_common_name,
           matched_names.common_name AS matched_common_name,
           s.climate_zones,
           s.habit,
           s.growth_form,
           s.life_cycles
    FROM ${speciesTable} s
    LEFT JOIN primary_names ON primary_names.species_id = s.id
    LEFT JOIN matched_names ON matched_names.species_id = s.id
    ${whereSql}
    ORDER BY s.canonical_name, s.id
  `
}

function searchWhereSql(normalizedSearchText: string): string {
  if (!normalizedSearchText) return ''
  const pattern = quoteSqlString(`%${normalizedSearchText}%`)
  return `
    WHERE LOWER(s.canonical_name) LIKE ${pattern}
       OR LOWER(COALESCE(s.common_name, '')) LIKE ${pattern}
       OR EXISTS (
         SELECT 1
         FROM locale_names search_names
         WHERE search_names.species_id = s.id
           AND search_names.normalized_name LIKE ${pattern}
       )
  `
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
    display_order: numberValue(row.display_order),
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

interface SpeciesProjection {
  readonly row: ReducedSpeciesRow
  readonly localizedCommonName: string | null
  readonly matchedCommonName: string | null
}

function parseSpeciesProjection(row: Record<string, unknown>): SpeciesProjection {
  return {
    row: parseSpeciesRow(row),
    localizedCommonName: nullableString(row.localized_common_name),
    matchedCommonName: nullableString(row.matched_common_name),
  }
}

function parseManifest(value: unknown): WebCatalogManifest {
  if (
    !isRecord(value) ||
    (value.asset_format !== 'ndjson' && value.asset_format !== 'parquet') ||
    !isRecord(value.assets)
  ) {
    throw new Error('Invalid Web Edition Species Catalog manifest.')
  }
  if (value.asset_format === 'parquet' && isRecord(value.duckdb) && value.duckdb.reader !== 'read_parquet') {
    throw new Error('Invalid Web Edition Species Catalog DuckDB reader.')
  }
  const assets = value.assets
  if (!Array.isArray(assets.species) || !isRecord(assets.names) || !Array.isArray(assets.images)) {
    throw new Error('Invalid Web Edition Species Catalog asset manifest.')
  }
  return {
    asset_format: value.asset_format,
    duckdb: isRecord(value.duckdb) ? { reader: optionalString(value.duckdb.reader) ?? undefined } : undefined,
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
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return []
    try {
      const parsed = JSON.parse(text) as unknown
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is string => typeof entry === 'string')
      }
    } catch {
      return []
    }
  }
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

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function cursorToOffset(cursor: string | null): number {
  if (cursor === null) return 0
  const match = /^offset:(\d+)$/.exec(cursor)
  return match ? Number(match[1]) : 0
}

function speciesProjectionToListItem(
  projection: SpeciesProjection,
  favoriteNames: ReadonlySet<string>,
): SpeciesListItem {
  const row = projection.row
  const commonName = projection.localizedCommonName ?? row.common_name
  return {
    canonical_name: row.canonical_name,
    slug: row.slug,
    common_name: commonName,
    common_name_2: null,
    matched_common_name: projection.matchedCommonName,
    is_name_fallback: commonName === null,
    family: null,
    genus: null,
    height_max_m: null,
    hardiness_zone_min: null,
    hardiness_zone_max: null,
    growth_rate: null,
    stratum: null,
    climate_zones: [...row.climate_zones],
    life_cycles: [...row.life_cycles],
    edibility_rating: null,
    medicinal_rating: null,
    width_max_m: null,
    is_favorite: favoriteNames.has(row.canonical_name),
  }
}

function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
