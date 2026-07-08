import * as duckdb from '@duckdb/duckdb-wasm'
import {
  type ReducedSpeciesCatalogReader,
  type ReducedSpeciesImageRow,
  type ReducedSpeciesRow,
  type WebSupportedFilterOptionsKey,
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

interface WebSupportedFilterPredicate {
  readonly kind: 'json_array_any' | 'text_any'
  readonly columns: readonly string[]
}

interface WebSupportedFilter {
  readonly key: string
  readonly optionsKey: WebSupportedFilterOptionsKey
  readonly predicate: WebSupportedFilterPredicate
}

interface WebCatalogManifest {
  readonly asset_format: 'parquet'
  readonly duckdb?: {
    readonly reader?: string
  }
  readonly supportedFilters: readonly WebSupportedFilter[]
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

interface NormalizedSearchText {
  readonly text: string
  readonly tokens: readonly string[]
}

const EMPTY_SEARCH_TEXT: NormalizedSearchText = {
  text: '',
  tokens: [],
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

    async getSupportedFilterFields(): Promise<readonly string[]> {
      return (await reader()).getSupportedFilterFields()
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
    return new DuckDbParquetReducedSpeciesCatalogReader(
      database,
      connection,
      catalogBaseUrl,
      manifest,
    )
  } catch (error) {
    await closeDuckDb(database, connection)
    throw error
  }
}

class DuckDbParquetReducedSpeciesCatalogReader implements ReducedSpeciesCatalogReader {
  private readonly registeredLocaleAssets = new Set<string>()
  private filterOptionsPromise: Promise<FilterOptions> | null = null
  private imageAssetsRegistered = false

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
    const searchText = normalizeSearchText(request.text)
    const whereSql = speciesWhereSql({
      searchText,
      filters: request.filters,
      supportedFilters: this.manifest.supportedFilters,
    })
    const rowsTable = await this.connection.query(`
      ${speciesProjectionSql({
        speciesTable,
        namesTable,
        whereSql,
        searchText,
      })}
      LIMIT ${limit}
      OFFSET ${offset}
    `)
    const rows = tableRows(rowsTable).map(parseSpeciesProjection)
    const totalEstimate = request.include_total
      ? await this.countSpecies(speciesTable, namesTable, whereSql)
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
        searchText: EMPTY_SEARCH_TEXT,
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
    this.filterOptionsPromise ??= this.loadFilterOptions()
    return this.filterOptionsPromise
  }

  async getSupportedFilterFields(): Promise<readonly string[]> {
    return this.manifest.supportedFilters.map((filter) => filter.key)
  }

  async getDynamicFilterOptions(
    fields: readonly string[],
    _locale: string,
  ): Promise<DynamicFilterOptions[]> {
    const supportedByKey = new Map(this.manifest.supportedFilters.map((filter) => [filter.key, filter]))
    const options = await this.getFilterOptions()
    return fields.flatMap((field): DynamicFilterOptions[] => {
      const supported = supportedByKey.get(field)
      if (!supported) return []
      return [categoricalDynamicFilterOptions(field, filterOptionValues(options, supported.optionsKey))]
    })
  }

  async getSpeciesDetail(
    canonicalName: string,
    locale: string,
  ): Promise<SpeciesCatalogDetail | null> {
    await this.ensureLocaleNameAsset(locale)
    const speciesTable = readParquetSql(this.manifest.assets.species.map((asset) => asset.path))
    const namesTable = localeNamesSql(this.manifest, locale)
    const rowsTable = await this.connection.query(`
      ${speciesProjectionSql({
        speciesTable,
        namesTable,
        whereSql: `WHERE s.canonical_name = ${quoteSqlString(canonicalName)}`,
        searchText: EMPTY_SEARCH_TEXT,
      })}
      LIMIT 1
    `)
    const projection = tableRows(rowsTable).map(parseSpeciesProjection)[0]
    if (!projection) return null

    await this.ensureImageAssets()
    const image = await this.loadHeroImage(projection.row.id)
    return speciesProjectionToDetail(projection, image)
  }

  private async countSpecies(
    speciesTable: string,
    namesTable: string,
    whereSql: string,
  ): Promise<number> {
    const countTable = await this.connection.query(`
      WITH locale_names AS (
        SELECT species_id,
               normalized_name
        FROM ${namesTable}
      )
      SELECT COUNT(*) AS total_count
      FROM ${speciesTable} s
      ${whereSql}
    `)
    const countRow = tableRows(countTable)[0]
    return numberValue(countRow?.total_count)
  }

  private async loadFilterOptions(): Promise<FilterOptions> {
    const speciesTable = readParquetSql(this.manifest.assets.species.map((asset) => asset.path))
    const columns = supportedFilterColumns(this.manifest.supportedFilters)
    if (columns.length === 0) return emptyFilterOptions()
    const rowsTable = await this.connection.query(`
      SELECT ${columns.map((column) => `s.${column}`).join(', ')}
      FROM ${speciesTable} s
    `)
    const rows = tableRows(rowsTable)
    const options = emptyFilterOptions()
    for (const filter of this.manifest.supportedFilters) {
      const values = rows.flatMap((row) => valuesForSupportedFilterRow(row, filter))
      options[filter.optionsKey] = sortedUnique(values)
    }
    return options
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

  private async ensureImageAssets(): Promise<void> {
    if (this.imageAssetsRegistered) return
    await Promise.all(this.manifest.assets.images.map((asset) => (
      this.database.registerFileURL(
        asset.path,
        new URL(asset.path, this.catalogBaseUrl).toString(),
        duckdb.DuckDBDataProtocol.HTTP,
        false,
      )
    )))
    this.imageAssetsRegistered = true
  }

  private async loadHeroImage(speciesId: string): Promise<ReducedSpeciesImageRow | null> {
    const imagesTable = this.manifest.assets.images.length > 0
      ? readParquetSql(this.manifest.assets.images.map((asset) => asset.path))
      : emptyImagesSql()
    const imageTable = await this.connection.query(`
      WITH web_species_images AS (
        SELECT species_id,
               url,
               source,
               source_page_url,
               credit,
               license
        FROM ${imagesTable}
      )
      SELECT species_id,
             url,
             source,
             source_page_url,
             credit,
             license
      FROM web_species_images
      WHERE species_id = ${quoteSqlString(speciesId)}
      LIMIT 1
    `)
    return tableRows(imageTable).map(parseImageRow)[0] ?? null
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

function emptyImagesSql(): string {
  return `(
    SELECT NULL::VARCHAR AS species_id,
           NULL::VARCHAR AS url,
           NULL::VARCHAR AS source,
           NULL::VARCHAR AS source_page_url,
           NULL::VARCHAR AS credit,
           NULL::VARCHAR AS license
    WHERE FALSE
  )`
}

function speciesProjectionSql({
  speciesTable,
  namesTable,
  whereSql,
  searchText,
}: {
  readonly speciesTable: string
  readonly namesTable: string
  readonly whereSql: string
  readonly searchText: NormalizedSearchText
}): string {
  const matchPredicate = searchText.text
    ? nameMatchCondition('normalized_name', searchText)
    : 'FALSE'
  const matchedNameTier = activeSearchNameTierSql('normalized_name', searchText)
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
             common_name,
             normalized_name,
             display_order
      FROM (
        SELECT species_id,
               common_name,
               normalized_name,
               display_order,
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
             common_name,
             match_tier
      FROM (
        SELECT species_id,
               common_name,
               ${matchedNameTier} AS match_tier,
               ROW_NUMBER() OVER (
                 PARTITION BY species_id
                 ORDER BY ${matchedNameTier},
                          TRY_CAST(display_order AS INTEGER),
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
    ${speciesOrderBySql(searchText)}
  `
}

function speciesWhereSql({
  searchText,
  filters,
  supportedFilters,
}: {
  readonly searchText: NormalizedSearchText
  readonly filters: SpeciesSearchRequest['filters']
  readonly supportedFilters: readonly WebSupportedFilter[]
}): string {
  const predicates = [
    searchPredicateSql(searchText),
    ...supportedFilters.flatMap((filter) => {
      const values = stringFilterValues(filters[filter.key as keyof typeof filters])
      return values.length === 0 ? [] : [supportedFilterPredicateSql(filter, values)]
    }),
  ].filter((predicate) => predicate.length > 0)

  return predicates.length > 0 ? `WHERE ${predicates.join('\n  AND ')}` : ''
}

function searchPredicateSql(searchText: NormalizedSearchText): string {
  if (!searchText.text) return ''
  return `
    (
       ${nameMatchCondition('LOWER(s.canonical_name)', searchText)}
       OR ${nameMatchCondition("LOWER(COALESCE(s.common_name, ''))", searchText)}
       OR EXISTS (
         SELECT 1
         FROM locale_names search_names
         WHERE search_names.species_id = s.id
           AND ${nameMatchCondition('search_names.normalized_name', searchText)}
       )
    )
  `
}

function speciesOrderBySql(searchText: NormalizedSearchText): string {
  if (!searchText.text) return 'ORDER BY s.canonical_name, s.id'
  const primaryName = 'primary_names.normalized_name'
  return `ORDER BY CASE
      WHEN ${primaryName} = ${quoteSqlString(searchText.text)} THEN 0
      WHEN ${primaryName} LIKE ${quoteLikePrefixPattern(searchText.text)} ESCAPE '\\' THEN 1
      WHEN ${allTokenContainsCondition(primaryName, searchText)} THEN 2
      WHEN matched_names.species_id IS NOT NULL THEN 3
      WHEN ${nameMatchCondition('LOWER(s.canonical_name)', searchText)} THEN 4
      ELSE 5
    END,
    COALESCE(matched_names.match_tier, 2147483647),
    TRY_CAST(primary_names.display_order AS INTEGER),
    COALESCE(LENGTH(primary_names.common_name), 2147483647),
    s.canonical_name,
    s.id`
}

function activeSearchNameTierSql(column: string, searchText: NormalizedSearchText): string {
  if (!searchText.text) return '2147483647'
  return `CASE
    WHEN ${column} = ${quoteSqlString(searchText.text)} THEN 0
    WHEN ${column} LIKE ${quoteLikePrefixPattern(searchText.text)} ESCAPE '\\' THEN 1
    WHEN ${allTokenContainsCondition(column, searchText)} THEN 2
    ELSE 3
  END`
}

function nameMatchCondition(column: string, searchText: NormalizedSearchText): string {
  const containsSearchText = `${column} LIKE ${quoteLikeContainsPattern(searchText.text)} ESCAPE '\\'`
  if (searchText.tokens.length <= 1) return `(${containsSearchText})`
  return `(${containsSearchText}
       OR ${allTokenContainsCondition(column, searchText)})`
}

function allTokenContainsCondition(column: string, searchText: NormalizedSearchText): string {
  if (searchText.tokens.length === 0) return 'FALSE'
  return searchText.tokens
    .map((token) => `${column} LIKE ${quoteLikeContainsPattern(token)} ESCAPE '\\'`)
    .join(' AND ')
}

function supportedFilterPredicateSql(
  filter: WebSupportedFilter,
  values: readonly string[],
): string {
  switch (filter.predicate.kind) {
    case 'json_array_any':
      return `(${filter.predicate.columns.flatMap((column) => (
        values.map((value) => (
          `CAST(s.${column} AS VARCHAR) LIKE ${quoteSqlString(jsonArrayLikePattern(value))} ESCAPE '\\'`
        ))
      )).join(' OR ')})`
    case 'text_any':
      return `(${filter.predicate.columns.map((column) => (
        `COALESCE(s.${column}, '') IN (${values.map(quoteSqlString).join(', ')})`
      )).join(' OR ')})`
  }
}

function jsonArrayLikePattern(value: string): string {
  return `%${escapeLikeLiteral(JSON.stringify(value))}%`
}

function escapeLikeLiteral(value: string): string {
  return value
    .split('\\').join('\\\\')
    .split('%').join('\\%')
    .split('_').join('\\_')
}

function stringFilterValues(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []
}

function quoteSqlString(value: string): string {
  return `'${value.split("'").join("''")}'`
}

function quoteLikeContainsPattern(value: string): string {
  return quoteSqlString(`%${escapeLikeLiteral(value)}%`)
}

function quoteLikePrefixPattern(value: string): string {
  return quoteSqlString(`${escapeLikeLiteral(value)}%`)
}

function emptyFilterOptions(): FilterOptions {
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

function supportedFilterColumns(filters: readonly WebSupportedFilter[]): string[] {
  return sortedUnique(filters.flatMap((filter) => filter.predicate.columns))
}

function valuesForSupportedFilterRow(
  row: Record<string, unknown>,
  filter: WebSupportedFilter,
): string[] {
  switch (filter.predicate.kind) {
    case 'json_array_any':
      return filter.predicate.columns.flatMap((column) => stringArray(row[column]))
    case 'text_any':
      return filter.predicate.columns.flatMap((column) => compact([nullableString(row[column])]))
  }
}

function filterOptionValues(
  options: FilterOptions,
  key: WebSupportedFilterOptionsKey,
): readonly string[] {
  return options[key]
}

function categoricalDynamicFilterOptions(
  field: string,
  values: readonly string[],
): DynamicFilterOptions {
  return {
    field,
    field_type: 'categorical',
    values: values.map((value) => ({ value, label: value })),
    range: null,
  }
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
    value.asset_format !== 'parquet' ||
    !isRecord(value.assets)
  ) {
    throw new Error('Invalid Web Edition Species Catalog manifest: production Web catalogs must use Parquet assets.')
  }
  if (isRecord(value.duckdb) && value.duckdb.reader !== 'read_parquet') {
    throw new Error('Invalid Web Edition Species Catalog DuckDB reader.')
  }
  const assets = value.assets
  if (!Array.isArray(assets.species) || !isRecord(assets.names) || !Array.isArray(assets.images)) {
    throw new Error('Invalid Web Edition Species Catalog asset manifest.')
  }
  return {
    asset_format: value.asset_format,
    duckdb: isRecord(value.duckdb) ? { reader: optionalString(value.duckdb.reader) ?? undefined } : undefined,
    supportedFilters: Array.isArray(value.supported_filters)
      ? value.supported_filters.map(parseSupportedFilter)
      : [],
    assets: {
      species: assets.species.map(parseAssetEntry),
      names: Object.fromEntries(
        Object.entries(assets.names).map(([locale, entry]) => [locale, parseAssetEntry(entry)]),
      ),
      images: assets.images.map(parseAssetEntry),
    },
  }
}

function parseSupportedFilter(value: unknown): WebSupportedFilter {
  if (!isRecord(value) || typeof value.key !== 'string') {
    throw new Error('Invalid Web Edition Species Catalog supported filter.')
  }
  if (typeof value.options_key !== 'string' || !isSupportedFilterOptionsKey(value.options_key)) {
    throw new Error(`Invalid Web Edition Species Catalog supported filter options key for ${value.key}.`)
  }
  if (!isRecord(value.predicate) || !Array.isArray(value.predicate.columns)) {
    throw new Error(`Invalid Web Edition Species Catalog supported filter predicate for ${value.key}.`)
  }
  if (value.predicate.kind !== 'json_array_any' && value.predicate.kind !== 'text_any') {
    throw new Error(`Invalid Web Edition Species Catalog supported filter predicate kind for ${value.key}.`)
  }
  const columns = value.predicate.columns.map(parseSafeSqlColumn)
  if (columns.length === 0) {
    throw new Error(`Invalid Web Edition Species Catalog supported filter columns for ${value.key}.`)
  }
  return {
    key: value.key,
    optionsKey: value.options_key,
    predicate: {
      kind: value.predicate.kind,
      columns,
    },
  }
}

function isSupportedFilterOptionsKey(value: string): value is WebSupportedFilterOptionsKey {
  return [
    'climate_zones',
    'habits',
    'life_cycles',
    'sun_tolerances',
    'soil_tolerances',
    'growth_rates',
  ].includes(value)
}

function parseSafeSqlColumn(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error('Invalid Web Edition Species Catalog supported filter column.')
  }
  return value
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

function speciesProjectionToDetail(
  projection: SpeciesProjection,
  image: ReducedSpeciesImageRow | null,
): SpeciesCatalogDetail {
  const row = projection.row
  const commonName = projection.localizedCommonName ?? row.common_name
  return {
    canonical_name: row.canonical_name,
    common_name: commonName,
    common_names: [...new Set([commonName].filter((name): name is string => name !== null))],
    climate_zones: [...row.climate_zones],
    habit: row.habit,
    growth_form: row.growth_form,
    life_cycles: [...row.life_cycles],
    image: image === null
      ? null
      : {
          url: image.url,
          source: image.source,
          source_page_url: image.source_page_url,
          credit: image.credit,
          license: image.license,
        },
  }
}

function normalizeSearchText(text: string): NormalizedSearchText {
  const normalized = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
  const tokens = [...new Set(
    Array.from(normalized.matchAll(/[\p{Letter}\p{Number}_]+/gu), (match) => match[0]),
  )]
  return tokens.length === 0
    ? EMPTY_SEARCH_TEXT
    : {
        text: tokens.join(' '),
        tokens,
      }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
    .sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }))
}

function compact(values: readonly (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
