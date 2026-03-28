import { signal, computed, effect, batch } from '@preact/signals';
import { locale } from './app';
import { searchSpecies, getFilterOptions, getDynamicFilterOptions } from '../ipc/species';
import { toggleFavorite, getFavorites, getRecentlyViewed } from '../ipc/favorites';
import type { SpeciesListItem, SpeciesFilter, FilterOptions, Sort } from '../types/species';
import type { DynamicFilter, FilterOp, DynamicFilterOptions } from '../types/species';

// ── Search state ──────────────────────────────────────────────────────────────

export const searchText = signal('');
export const activeFilters = signal<SpeciesFilter>({
  hardiness_min: null,
  hardiness_max: null,
  height_min: null,
  height_max: null,
  sun_tolerances: null,
  soil_tolerances: null,
  growth_rate: null,
  life_cycle: null,
  edible: null,
  edibility_min: null,
  nitrogen_fixer: null,
  stratum: null,
  family: null,
  extra: null,
});
export const sortField = signal<Sort>('Name');
export const searchResults = signal<SpeciesListItem[]>([]);
export const nextCursor = signal<string | null>(null);
export const totalEstimate = signal(0);
export const isSearching = signal(false);
export const searchError = signal<string | null>(null);

// ── Filter options (loaded once) ─────────────────────────────────────────────

export const filterOptions = signal<FilterOptions | null>(null);

// ── Dynamic "More Filters" state ────────────────────────────────────────────
export const extraFilters = signal<DynamicFilter[]>([]);
export const dynamicOptionsCache = signal<Record<string, DynamicFilterOptions>>({});

// ── View state ────────────────────────────────────────────────────────────────

export type ViewMode = 'list' | 'card';
export const viewMode = signal<ViewMode>('list');
export const selectedCanonicalName = signal<string | null>(null);

// ── Favorites — string[] so signal detects reassignment ──────────────────────

export const favoriteNames = signal<string[]>([]);

// ── Recently viewed ───────────────────────────────────────────────────────────

export const recentlyViewed = signal<SpeciesListItem[]>([]);

// ── Derived ───────────────────────────────────────────────────────────────────

export const hasActiveFilters = computed(() => {
  const f = activeFilters.value;
  return (
    f.hardiness_min !== null ||
    f.hardiness_max !== null ||
    f.height_min !== null ||
    f.height_max !== null ||
    (f.sun_tolerances !== null && f.sun_tolerances.length > 0) ||
    (f.soil_tolerances !== null && f.soil_tolerances.length > 0) ||
    (f.growth_rate !== null && f.growth_rate.length > 0) ||
    (f.life_cycle !== null && f.life_cycle.length > 0) ||
    f.edible !== null ||
    f.edibility_min !== null ||
    f.nitrogen_fixer !== null ||
    (f.stratum !== null && f.stratum.length > 0) ||
    f.family !== null ||
    (f.extra !== null && f.extra.length > 0) ||
    extraFilters.value.length > 0
  );
});

export const hasExtraFilters = computed(() => extraFilters.value.length > 0);

export const activeFilterCount = computed(() => {
  const f = activeFilters.value;
  let count = 0;
  if (f.hardiness_min !== null || f.hardiness_max !== null) count++;
  if (f.sun_tolerances !== null && f.sun_tolerances.length > 0) count++;
  if (f.stratum !== null && f.stratum.length > 0) count++;
  if (f.edibility_min !== null) count++;
  if (f.height_min !== null || f.height_max !== null) count++;
  if (f.nitrogen_fixer !== null) count++;
  count += extraFilters.value.length;
  return count;
});

// ── Race-condition guard ──────────────────────────────────────────────────────

let searchGeneration = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// ── Merge extra filters into SpeciesFilter for IPC calls ─────────────────────

function mergedFilters(): SpeciesFilter {
  const f = activeFilters.value;
  const extras = extraFilters.value;
  if (extras.length === 0) return f;
  const existing = f.extra ?? [];
  return { ...f, extra: [...existing, ...extras] };
}

// ── Internal search executor ─────────────────────────────────────────────────

async function executeSearch(generation: number): Promise<void> {
  try {
    const result = await searchSpecies(
      searchText.value,
      mergedFilters(),
      null,
      50,
      sortField.value,
      locale.value,
    );

    // Discard stale result if a newer search superseded this one
    if (generation !== searchGeneration) return;

    batch(() => {
      searchResults.value = result.items;
      nextCursor.value = result.next_cursor;
      totalEstimate.value = result.total_estimate;
      isSearching.value = false;
      searchError.value = null;
    });
  } catch (err) {
    if (generation !== searchGeneration) return;
    batch(() => {
      isSearching.value = false;
      searchError.value = err instanceof Error ? err.message : String(err);
    });
  }
}

// ── Search trigger (debounced for text, instant for filters/sort/locale) ─────

function scheduleSearch(debounceMs: number): void {
  searchGeneration += 1;
  const generation = searchGeneration;

  // Don't clear results during debounce — keep showing previous results
  // until new ones arrive. Only reset cursor and mark as searching.
  batch(() => {
    nextCursor.value = null;
    searchError.value = null;
    isSearching.value = true;
  });

  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }

  if (debounceMs <= 0) {
    debounceTimer = null;
    void executeSearch(generation);
  } else {
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void executeSearch(generation);
    }, debounceMs);
  }
}

// ── Module-level effects: separate text (debounced) from filters (instant) ───

let lastText = searchText.peek();

const disposeSearchEffect = effect(() => {
  const text = searchText.value;
  void activeFilters.value;
  void extraFilters.value;
  void sortField.value;
  void locale.value;

  // Text typing gets 150ms debounce; filter/sort/locale changes are instant
  const textChanged = text !== lastText;
  lastText = text;
  scheduleSearch(textChanged ? 150 : 0);
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeSearchEffect();
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  });
}

// ── Public actions ────────────────────────────────────────────────────────────

/** Force a fresh search — used when the initial search may have failed due to IPC not being ready. */
export function retrySearch(): void {
  scheduleSearch(0)
}

/** Load the next page using the current cursor (infinite scroll). */
export async function loadNextPage(): Promise<void> {
  const cursor = nextCursor.value;
  if (cursor === null || isSearching.value) return;

  const generation = searchGeneration;
  isSearching.value = true;

  try {
    const result = await searchSpecies(
      searchText.value,
      mergedFilters(),
      cursor,
      50,
      sortField.value,
      locale.value,
    );

    if (generation !== searchGeneration) return;

    batch(() => {
      searchResults.value = [...searchResults.value, ...result.items];
      nextCursor.value = result.next_cursor;
      totalEstimate.value = result.total_estimate;
      isSearching.value = false;
    });
  } catch (err) {
    if (generation !== searchGeneration) return;
    batch(() => {
      isSearching.value = false;
      searchError.value = err instanceof Error ? err.message : String(err);
    });
  }
}

/** Load filter options once on first panel mount. */
export async function loadFilterOptions(): Promise<void> {
  if (filterOptions.value !== null) return;
  try {
    filterOptions.value = await getFilterOptions();
  } catch {
    // Non-fatal — filters will just be empty
  }
}

/** Patch active filters — shared by FilterStrip and ActiveChips. */
export function patchFilters(patch: Partial<SpeciesFilter>): void {
  activeFilters.value = { ...activeFilters.value, ...patch };
}

/** Toggle a favorite and keep favoriteNames in sync. */
export async function toggleFavoriteAction(canonicalName: string): Promise<void> {
  try {
    const nowFavorite = await toggleFavorite(canonicalName);
    if (nowFavorite) {
      favoriteNames.value = [...favoriteNames.value, canonicalName];
    } else {
      favoriteNames.value = favoriteNames.value.filter((n) => n !== canonicalName);
    }
    // Reflect the change in the current result list
    searchResults.value = searchResults.value.map((item) =>
      item.canonical_name === canonicalName
        ? { ...item, is_favorite: nowFavorite }
        : item,
    );
  } catch {
    // Non-fatal — UI stays as-is
  }
}

/** Load favorites and recently viewed for the current locale. */
export async function loadSidebarLists(): Promise<void> {
  const loc = locale.value;
  try {
    const [favs, recent] = await Promise.all([
      getFavorites(loc),
      getRecentlyViewed(loc, 50),
    ]);
    favoriteNames.value = favs.map((f) => f.canonical_name);
    recentlyViewed.value = recent;
  } catch {
    // Non-fatal
  }
}

/** Add or update a dynamic filter. */
export function addExtraFilter(field: string, op: FilterOp, values: string[]): void {
  const current = extraFilters.value;
  const without = current.filter((f) => f.field !== field);
  extraFilters.value = [...without, { field, op, values }];
}

/** Remove a dynamic filter by field name. */
export function removeExtraFilter(field: string): void {
  extraFilters.value = extraFilters.value.filter((f) => f.field !== field);
}

/** Load dynamic filter options for a set of fields (with caching). */
export async function loadDynamicOptions(fields: string[]): Promise<void> {
  const cache = dynamicOptionsCache.value;
  const uncached = fields.filter((f) => !cache[f]);
  if (uncached.length === 0) return;
  try {
    const options = await getDynamicFilterOptions(uncached, locale.value);
    const next = { ...dynamicOptionsCache.value };
    for (const opt of options) {
      next[opt.field] = opt;
    }
    dynamicOptionsCache.value = next;
  } catch {
    // Non-fatal — dynamic options will just be unavailable
  }
}

/** Clear all active filters. */
export function clearFilters(): void {
  activeFilters.value = {
    hardiness_min: null,
    hardiness_max: null,
    height_min: null,
    height_max: null,
    sun_tolerances: null,
    soil_tolerances: null,
    growth_rate: null,
    life_cycle: null,
    edible: null,
    edibility_min: null,
    nitrogen_fixer: null,
    stratum: null,
    family: null,
    extra: null,
  };
  extraFilters.value = [];
}
