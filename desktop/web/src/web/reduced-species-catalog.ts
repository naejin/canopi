import type {
  DynamicFilterOptions,
  FilterOptions,
  PaginatedResult,
  SpeciesFilter,
  SpeciesListItem,
  SpeciesSearchRequest,
} from '../types/species'
import type { BrowserAppDataStore } from './browser-app-data'

export interface ReducedSpeciesRow {
  readonly id: string
  readonly slug: string
  readonly canonical_name: string
  readonly common_name: string | null
  readonly climate_zones: readonly string[]
  readonly habit: string | null
  readonly growth_form: string | null
  readonly life_cycles: readonly string[]
}

export interface ReducedSpeciesNameRow {
  readonly species_id: string
  readonly language: string
  readonly common_name: string
  readonly normalized_name: string
  readonly is_primary: boolean
}

export interface ReducedSpeciesImageRow {
  readonly species_id: string
  readonly url: string
  readonly source: string | null
  readonly source_page_url: string | null
  readonly credit: string | null
  readonly license: string | null
}

export interface ReducedSpeciesCatalogData {
  readonly species: readonly ReducedSpeciesRow[]
  readonly names: readonly ReducedSpeciesNameRow[]
  readonly images: readonly ReducedSpeciesImageRow[]
}

export interface ReducedSpeciesCatalogReader {
  searchSpecies(
    request: SpeciesSearchRequest,
    favoriteNames: ReadonlySet<string>,
  ): Promise<PaginatedResult<SpeciesListItem>>
  listSpeciesByCanonicalNames(
    canonicalNames: readonly string[],
    locale: string,
    favoriteNames: ReadonlySet<string>,
  ): Promise<SpeciesListItem[]>
  getFilterOptions(): Promise<FilterOptions>
  getDynamicFilterOptions(fields: readonly string[], locale: string): Promise<DynamicFilterOptions[]>
}

export interface ReducedSpeciesCatalogAdapters {
  search(request: SpeciesSearchRequest): Promise<PaginatedResult<SpeciesListItem>>
  getFilterOptions(): Promise<FilterOptions>
  loadDynamicFilterOptions(fields: string[], locale: string): Promise<DynamicFilterOptions[]>
  getFavorites(locale: string): Promise<SpeciesListItem[]>
  getRecentlyViewed(locale: string, limit: number): Promise<SpeciesListItem[]>
  toggleFavorite(canonicalName: string): Promise<boolean>
  recordRecentlyViewed(canonicalName: string, limit?: number): Promise<void>
}

interface ReducedSpeciesCatalogAdaptersOptions {
  readonly appDataStore: BrowserAppDataStore
  readonly reader: ReducedSpeciesCatalogReader
}

interface SpeciesNameIndexEntry {
  readonly primary: ReducedSpeciesNameRow | null
  readonly names: readonly ReducedSpeciesNameRow[]
}

const EMPTY_FILTER_OPTIONS: FilterOptions = {
  families: [],
  growth_rates: [],
  climate_zones: [],
  habits: [],
  life_cycles: [],
  sun_tolerances: [],
  soil_tolerances: [],
}

export function createReducedSpeciesCatalogAdapters({
  appDataStore,
  reader,
}: ReducedSpeciesCatalogAdaptersOptions): ReducedSpeciesCatalogAdapters {
  function favoriteNameSet(): ReadonlySet<string> {
    return new Set(appDataStore.listFavoriteSpecies())
  }

  return {
    search(request) {
      return reader.searchSpecies(request, favoriteNameSet())
    },

    getFilterOptions() {
      return reader.getFilterOptions()
    },

    loadDynamicFilterOptions(fields, locale) {
      return reader.getDynamicFilterOptions(fields, locale)
    },

    getFavorites(locale) {
      const names = appDataStore.listFavoriteSpecies()
      return reader.listSpeciesByCanonicalNames(names, locale, favoriteNameSet())
    },

    getRecentlyViewed(locale, limit) {
      const names = appDataStore.listRecentlyViewedSpecies().slice(0, limit)
      return reader.listSpeciesByCanonicalNames(names, locale, favoriteNameSet())
    },

    async toggleFavorite(canonicalName) {
      const current = appDataStore.listFavoriteSpecies()
      const isFavorite = current.includes(canonicalName)
      const next = isFavorite
        ? current.filter((name) => name !== canonicalName)
        : [canonicalName, ...current]
      const result = appDataStore.setFavoriteSpecies(next)
      if (!result.ok) throw new Error('Failed to persist Web Edition Species favorite.')
      return !isFavorite
    },

    async recordRecentlyViewed(canonicalName, limit = 50) {
      const result = appDataStore.recordRecentlyViewedSpecies(canonicalName, limit)
      if (!result.ok) throw new Error('Failed to persist Web Edition recently viewed Species.')
    },
  }
}

export function createInMemoryReducedSpeciesCatalogReader(
  data: ReducedSpeciesCatalogData,
): ReducedSpeciesCatalogReader {
  const species = [...data.species].sort(compareSpeciesRows)
  const speciesByCanonicalName = new Map(species.map((row) => [row.canonical_name, row]))
  const namesByLocaleAndSpecies = buildNameIndex(data.names)
  const filterOptions = buildFilterOptions(species)

  return {
    async searchSpecies(request, favoriteNames) {
      const text = normalizeSearchText(request.text)
      const offset = cursorToOffset(request.cursor)
      const matched = species.filter((row) => (
        matchesSupportedFilters(row, request.filters) &&
        matchesSearchText(row, text, namesByLocaleAndSpecies.get(request.locale)?.get(row.id))
      ))
      const page = matched.slice(offset, offset + Math.max(0, request.limit))
      const nextOffset = offset + page.length
      return {
        items: page.map((row) => toSpeciesListItem({
          row,
          locale: request.locale,
          favoriteNames,
          nameIndex: namesByLocaleAndSpecies,
          normalizedSearchText: text,
        })),
        next_cursor: nextOffset < matched.length ? `offset:${nextOffset}` : null,
        total_estimate: request.include_total ? matched.length : 0,
      }
    },

    async listSpeciesByCanonicalNames(canonicalNames, locale, favoriteNames) {
      return canonicalNames.flatMap((canonicalName) => {
        const row = speciesByCanonicalName.get(canonicalName)
        return row
          ? [toSpeciesListItem({
              row,
              locale,
              favoriteNames,
              nameIndex: namesByLocaleAndSpecies,
              normalizedSearchText: '',
            })]
          : []
      })
    },

    async getFilterOptions() {
      return filterOptions
    },

    async getDynamicFilterOptions(fields, _locale) {
      return fields.flatMap((field): DynamicFilterOptions[] => {
        if (field === 'climate_zones') {
          return [categoricalDynamicFilterOptions(field, filterOptions.climate_zones)]
        }
        if (field === 'habit' || field === 'growth_form_type') {
          return [categoricalDynamicFilterOptions(field, filterOptions.habits)]
        }
        if (field === 'life_cycle') {
          return [categoricalDynamicFilterOptions(field, filterOptions.life_cycles)]
        }
        return []
      })
    },
  }
}

function buildNameIndex(
  names: readonly ReducedSpeciesNameRow[],
): ReadonlyMap<string, ReadonlyMap<string, SpeciesNameIndexEntry>> {
  const byLocale = new Map<string, Map<string, ReducedSpeciesNameRow[]>>()
  for (const name of names) {
    const normalizedLocale = name.language.trim()
    if (!normalizedLocale) continue
    const bySpecies = byLocale.get(normalizedLocale) ?? new Map<string, ReducedSpeciesNameRow[]>()
    const speciesNames = bySpecies.get(name.species_id) ?? []
    bySpecies.set(name.species_id, [...speciesNames, name])
    byLocale.set(normalizedLocale, bySpecies)
  }

  return new Map(
    [...byLocale.entries()].map(([locale, bySpecies]) => [
      locale,
      new Map(
        [...bySpecies.entries()].map(([speciesId, speciesNames]) => {
          const sorted = [...speciesNames].sort(compareNameRows)
          return [speciesId, { primary: sorted[0] ?? null, names: sorted }]
        }),
      ),
    ]),
  )
}

function compareSpeciesRows(left: ReducedSpeciesRow, right: ReducedSpeciesRow): number {
  return left.canonical_name.localeCompare(right.canonical_name, 'en', { sensitivity: 'base' })
}

function compareNameRows(left: ReducedSpeciesNameRow, right: ReducedSpeciesNameRow): number {
  if (left.is_primary !== right.is_primary) return left.is_primary ? -1 : 1
  if (left.common_name.length !== right.common_name.length) {
    return left.common_name.length - right.common_name.length
  }
  return left.common_name.localeCompare(right.common_name, left.language, { sensitivity: 'base' })
}

function matchesSearchText(
  row: ReducedSpeciesRow,
  normalizedSearchText: string,
  localeNames: SpeciesNameIndexEntry | undefined,
): boolean {
  if (!normalizedSearchText) return true
  if (normalizeSearchText(row.canonical_name).includes(normalizedSearchText)) return true
  if (normalizeSearchText(row.common_name ?? '').includes(normalizedSearchText)) return true
  return localeNames?.names.some((name) => (
    name.normalized_name.includes(normalizedSearchText) ||
    normalizeSearchText(name.common_name).includes(normalizedSearchText)
  )) ?? false
}

function matchesSupportedFilters(row: ReducedSpeciesRow, filters: SpeciesFilter): boolean {
  return matchesAny(row.climate_zones, filters.climate_zones) &&
    matchesAny([...compact([row.habit, row.growth_form])], filters.habit) &&
    matchesAny(row.life_cycles, filters.life_cycle)
}

function matchesAny(values: readonly string[], requested: readonly string[] | null): boolean {
  if (requested === null || requested.length === 0) return true
  const valueSet = new Set(values)
  return requested.some((value) => valueSet.has(value))
}

function toSpeciesListItem({
  row,
  locale,
  favoriteNames,
  nameIndex,
  normalizedSearchText,
}: {
  readonly row: ReducedSpeciesRow
  readonly locale: string
  readonly favoriteNames: ReadonlySet<string>
  readonly nameIndex: ReadonlyMap<string, ReadonlyMap<string, SpeciesNameIndexEntry>>
  readonly normalizedSearchText: string
}): SpeciesListItem {
  const localeNames = nameIndex.get(locale)?.get(row.id)
  const matchedName = normalizedSearchText
    ? localeNames?.names.find((name) => (
        name.normalized_name.includes(normalizedSearchText) ||
        normalizeSearchText(name.common_name).includes(normalizedSearchText)
      )) ?? null
    : null
  const localizedCommonName = localeNames?.primary?.common_name ?? row.common_name

  return {
    canonical_name: row.canonical_name,
    slug: row.slug,
    common_name: localizedCommonName,
    common_name_2: null,
    matched_common_name: matchedName?.common_name ?? null,
    is_name_fallback: localizedCommonName === null,
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

function buildFilterOptions(species: readonly ReducedSpeciesRow[]): FilterOptions {
  return {
    ...EMPTY_FILTER_OPTIONS,
    climate_zones: sortedUnique(species.flatMap((row) => row.climate_zones)),
    habits: sortedUnique(species.flatMap((row) => compact([row.habit, row.growth_form]))),
    life_cycles: sortedUnique(species.flatMap((row) => row.life_cycles)),
  }
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

function cursorToOffset(cursor: string | null): number {
  if (cursor === null) return 0
  const match = /^offset:(\d+)$/.exec(cursor)
  return match ? Number(match[1]) : 0
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
    .sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }))
}

function compact(values: readonly (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim()
}
