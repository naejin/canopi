# Phase 1 — Plant Database

## Context

Phase 0 (Scaffold & Shell) is complete: Tauri v2 + Preact app with activity bar, panels, i18n (6 langs), themes, command palette, keyboard shortcuts, and user DB. Phase 1 makes the app useful by wiring up the 175K-species plant database with search, filtering, and browsing. This is the first feature phase — users will be able to search, filter, browse, and bookmark plants.

**Data source**: `/home/daylon/projects/canopi-data/data/exports/canopi-export-2026-03-12.db` (413MB, 175,484 species, 167 columns, 942K common names in 5 languages, 108K relationships, 55K uses)

### Canopi Plugin Usage

The `canopi@canopi-team` plugin provides skills, agents, and hooks that must be used throughout Phase 1:

**Skills** (invoke before writing code in each domain):
- `/canopi-db` — Before any DB queries, schema, FTS5, pagination, prepare-db work
- `/canopi-rust` — Before any Rust code: IPC commands, Tauri setup, state, serde, Cargo.toml
- `/canopi-ux` — Before any UI component, panel, layout, interaction, CSS Module work
- `/canopi-i18n` — Before adding strings to locale files, common name display, CJK handling

**Agents** (spawn for implementation work):
- `canopi-backend-dev` (Sonnet) — Spawn for Rust modules, IPC commands, DB queries (sub-phases 1a-1c)
- `canopi-frontend-dev` (Sonnet) — Spawn for Preact components, signals state, CSS Modules (sub-phases 1d-1f)
- `canopi-reviewer` (Opus) — Spawn for code review after completing each sub-phase

**Hooks** (automatic enforcement):
- `guard-packages.sh` — Blocks banned packages on install
- Convention guard — Scans writes/edits for violations (react imports, string SQL, etc.)
- Retro suggestion — Prompts `/canopi-retro` at session end

## Data Model Corrections

The architecture draft has several inaccuracies vs the actual export DB. These must be addressed:

1. **Table name**: `species` (not `silver_species`)
2. **`nitrogen_fixation`**: TEXT values (High/Low/Medium/No/None/Yes), not boolean — fix `SpeciesDetail.nitrogen_fixation` from `Option<bool>` to `Option<String>`
3. **`stratum`**: Exists but sparse (780/175K species) — usable for filtering but most results will be NULL
4. **Sun tolerance columns exist**: `tolerates_full_sun`, `tolerates_semi_shade`, `tolerates_full_shade` (INTEGER 0/1/NULL)
5. **`species_soil_types`**: Separate table (22K rows), not inline columns — filter requires JOIN/subquery
6. **`translated_values`**: All non-English columns are NULL — prepare-db must populate translations
7. **Common names**: 5 languages (en/fr/es/pt/it), no zh — Chinese deferred
8. **`rusqlite` feature**: Currently `bundled` — needs `bundled-full` for FTS5 support

---

## Sub-Phase 1a: Data Pipeline (`prepare-db.py`)

**Invoke first**: `/canopi-db` (FTS5 patterns, tiered DB strategy, prepare-db conventions)
**Context7 queries**: None (Python + sqlite3 stdlib, no external library APIs)
**Agent**: `canopi-backend-dev` for implementation
**Depends on**: Nothing

### Files to Create
- `scripts/prepare-db.py`
- `desktop/resources/` (directory)
- Output: `desktop/resources/canopi-core.db`

### What It Does
1. Opens export DB, creates `canopi-core.db` with ~45 essential columns from `species` (identity, dimensions, climate, growth, tolerances, ratings, text fields)
2. Copies supporting tables verbatim: `species_common_names`, `species_relationships`, `species_uses`, `species_soil_types`, `synonym_lookup`, `translated_values`
3. Adds `value_zh TEXT` column to `translated_values` (NULL for now)
4. Creates FTS5 virtual table with `content='species'` directive so rowid maps directly to species table:
   ```sql
   CREATE VIRTUAL TABLE species_fts USING fts5(
       canonical_name, common_name, family, genus,
       edible_uses, medicinal_uses, other_uses,
       content='species', content_rowid='rowid',
       tokenize='unicode61 remove_diacritics 2'
   );
   INSERT INTO species_fts(species_fts) VALUES('rebuild');
   ```
   **Critical coupling**: Sub-phase 1b's query builder joins via `JOIN species s ON s.rowid = species_fts.rowid` — the `content='species'` directive here makes this work.
5. Creates `common_names_fts` for multilingual common name search (same content-table pattern with `content='species_common_names'`)
6. Creates B-tree indexes on all filter columns + foreign key columns
7. Populates French/Spanish/Portuguese/Italian translations for the ~25 most user-facing categorical values (growth_rate, life_cycle, nitrogen_fixation, deciduous_evergreen, drought_tolerance)
8. Filters out orphaned relationships (where `related_species_slug` not in species table)
9. VACUUM + ANALYZE, copies to `desktop/resources/canopi-core.db`

### Verification
```bash
python3 scripts/prepare-db.py
# Verify file exists and is 150-250MB
ls -lh desktop/resources/canopi-core.db
# Spot-check FTS5
python3 -c "import sqlite3; c=sqlite3.connect('desktop/resources/canopi-core.db'); print(c.execute(\"SELECT canonical_name FROM species_fts WHERE species_fts MATCH 'lavender' LIMIT 5\").fetchall())"
```

---

## Sub-Phase 1b: Rust DB Module (PlantDb + Query Builder)

**Invoke first**: `/canopi-rust` (IPC patterns, Mutex usage, error mapping), `/canopi-db` (query patterns, prepared statements)
**Context7 queries before writing code**:
- `mcp__context7__resolve-library-id` → `rusqlite` → then `query-docs` for: FTS5 with bundled-full feature, `Connection::open_with_flags`, `OpenFlags::SQLITE_OPEN_READ_ONLY`, prepared statement params, `rusqlite::types::Value` enum, `params_from_iter`
- `mcp__context7__resolve-library-id` → `tauri` → then `query-docs` for: `app.path().resolve_resource()` (loading bundled resources), managed state pattern, `tauri.conf.json` resources config
**Agent**: `canopi-backend-dev` for implementation
**Depends on**: 1a

### Files to Create
- `desktop/src/db/plant_db.rs` — PlantDb query functions
- `desktop/src/db/query_builder.rs` — Composable FTS5 + filter SQL builder

### Files to Modify
- `desktop/src/db/mod.rs` — Add `PlantDb(Mutex<Connection>)`, new modules
- `desktop/src/lib.rs` — Open core DB in `setup()`, manage `PlantDb` state
- `desktop/Cargo.toml` — Change `rusqlite` feature from `bundled` to `bundled-full`
- `desktop/tauri.conf.json` — Add `"resources": ["resources/canopi-core.db"]` to bundle config
- `common-types/src/species.rs` — Fix type mismatches: change `nitrogen_fixation` from `Option<bool>` to `Option<String>`, change `uses` from `Vec<String>` to `Vec<SpeciesUse>`, add `soil_types: Vec<String>` to `SpeciesDetail`, add `slug`/`edibility_rating`/`medicinal_rating`/`is_favorite` to `SpeciesListItem`, add `SpeciesUse` struct, add `Sort` enum with variants `{ Name, Family, Height, Hardiness, GrowthRate, Relevance }`, expand `FilterOptions` with `life_cycles`, `sun_tolerances`, `soil_types`

### Key Design Decisions

**PlantDb uses `Mutex<Connection>`** (not `Arc<Connection>` from the arch draft): `rusqlite::Connection` is `!Sync`, so `Arc<Connection>` would require `unsafe impl Sync`. `Mutex` is sound and the nanosecond lock cost is negligible for a desktop app. Matches the existing `UserDb` pattern.

**Query builder** handles 3 modes:
1. Text-only (FTS5 MATCH)
2. Filters-only (structured WHERE)
3. Combined (FTS5 JOIN + WHERE)

Params collected as `Vec<rusqlite::types::Value>` (owned). Cursor-based pagination encodes sort key + `canonical_name` tiebreaker as base64 JSON. Every sort order appends `ORDER BY <sort_col>, canonical_name` and the cursor WHERE clause uses row-value comparison: `WHERE (sort_col, canonical_name) > (?cursor_sort, ?cursor_name)` (SQLite 3.15+ supports this; bundled-full guarantees it).

**Core DB opened read-only** in setup with `OpenFlags::SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX`:
```rust
conn.execute_batch("
    PRAGMA mmap_size=268435456;
    PRAGMA cache_size=-64000;
")?;
```
Do NOT set `PRAGMA query_only=true` — it breaks FTS5 queries (FTS5 updates internal shadow tables even on reads). Do NOT set `PRAGMA journal_mode=WAL` — it's a no-op/error on read-only connections. The `SQLITE_OPEN_READ_ONLY` flag alone prevents writes.

**Core DB startup failure**: If `resolve_resource("canopi-core.db")` fails or the DB is corrupt, show a user-visible error dialog via `tauri_plugin_dialog` before exiting — do NOT hard-panic. Consider lazy opening on first IPC call as an alternative.

**Common name resolution**: LEFT JOIN `species_common_names` with locale parameter, fallback to `species.common_name` (English). The index `idx_common_names_species_lang ON species_common_names(species_id, language)` (created in 1a) ensures this join is fast.

### Verification
```bash
cargo check --workspace
cargo tauri dev  # Should start without panicking
```

---

## Sub-Phase 1c: IPC Commands

**Invoke first**: `/canopi-rust` (IPC command patterns, State extraction, generate_handler)
**Context7 queries before writing code**:
- `query-docs` on Tauri library for: `#[tauri::command]` with multiple `State<'_>` params, `tauri::generate_handler!` macro syntax, command return types and error serialization
**Agent**: `canopi-backend-dev` for implementation
**Depends on**: 1b

### Files to Modify
- `desktop/src/commands/species.rs` — Implement `search_species`, add `get_species_detail`, `get_species_relationships`, `get_filter_options`
- `desktop/src/commands/mod.rs` — Add `favorites` module
- `desktop/src/lib.rs` — Register new commands in `generate_handler!`
- `desktop/src/db/user_db.rs` — Refactor to incremental migration pattern: run v0→v1 (`init.sql`) then v1→v2 (`v2_recently_viewed.sql`) sequentially. Each migration checks `if version < N` and sets `user_version = N` after running. This ensures users upgrading from v0 get both migrations in one startup.
- `desktop/migrations/init.sql` — Keep as-is (v1)

### Files to Create
- `desktop/migrations/v2_recently_viewed.sql` — ONLY `recently_viewed` table + cleanup trigger. Do NOT recreate `favorites` table (already exists in v1 `init.sql`).
- `desktop/src/commands/favorites.rs` — `toggle_favorite`, `get_favorites`, `get_recently_viewed`

### IPC Command Signatures
```rust
search_species(plant_db, user_db, text, filters, cursor, limit, sort, locale) → PaginatedResult<SpeciesListItem>
get_species_detail(plant_db, user_db, canonical_name, locale) → SpeciesDetail  // also records recently_viewed
get_species_relationships(plant_db, canonical_name) → Vec<Relationship>
get_filter_options(plant_db) → FilterOptions
toggle_favorite(user_db, canonical_name) → bool
get_favorites(user_db, plant_db, locale) → Vec<SpeciesListItem>
get_recently_viewed(user_db, plant_db, locale, limit) → Vec<SpeciesListItem>
```

**Lock ordering**: Lock and release each DB independently, never hold both simultaneously. The order depends on the command's data flow:
- `search_species`: Lock PlantDb → query species → release → Lock UserDb → check favorites → release
- `get_favorites` / `get_recently_viewed`: Lock UserDb → get canonical_name list → release → Lock PlantDb → hydrate SpeciesListItem fields → release
- `get_species_detail`: Lock PlantDb → fetch detail → release → Lock UserDb → record recently_viewed → release

The key invariant is: never hold both locks at the same time. The acquisition order varies by command and that's fine — deadlocks only occur with nested locks.

### Verification
```bash
cargo check --workspace
cargo tauri dev
# In browser console:
# invoke('search_species', { text: 'lavender', filters: {}, limit: 10, sort: 'relevance', locale: 'en' })
# invoke('get_filter_options', {})
```

---

## Sub-Phase 1d: Frontend IPC Layer + State

**Invoke first**: `/canopi-ux` (signal patterns, state module conventions)
**Context7 queries before writing code**:
- `mcp__context7__resolve-library-id` → `preact` → then `query-docs` for: `@preact/signals` API (`signal`, `computed`, `effect`, `batch`), `useSignalEffect` hook
- `mcp__context7__resolve-library-id` → `tauri` → then `query-docs` for: `@tauri-apps/api/core` `invoke()` function signature, TypeScript type patterns for IPC
**Agent**: `canopi-frontend-dev` for implementation
**Depends on**: 1c

### Files to Create
- `desktop/web/src/types/species.ts` — TS interfaces matching Rust types. All `Option<T>` fields in Rust MUST be `T | null` in TS (not optional `T?`). Keep manually in sync with `common-types/src/species.rs` until tauri-specta is unblocked.
- `desktop/web/src/ipc/species.ts` — Typed `invoke()` wrappers for all species commands
- `desktop/web/src/ipc/favorites.ts` — Typed `invoke()` wrappers for favorites commands
- `desktop/web/src/state/plant-db.ts` — All plant DB signals + search logic. Key requirements:
  - **Signals**: searchText, activeFilters, sortField, searchResults, nextCursor, totalEstimate, isSearching, searchError (`signal<string | null>`), filterOptions, viewMode, selectedSpecies, recentlyViewed
  - **Favorites**: Use `signal<string[]>` (NOT `Set<string>`) — `@preact/signals` only detects `.value` reassignment, not in-place Set mutations. Toggle by creating a new array: `favoriteNames.value = [...favoriteNames.value, name]` or `.filter(n => n !== name)`.
  - **Race condition guard**: Increment a `searchGeneration` counter on every new search/filter/sort change. After `await invoke(...)` resolves, check if generation still matches — discard stale results if not.
  - **Filter/sort reset**: On any filter, sort, or text change, immediately `batch(() => { searchResults.value = []; nextCursor.value = null; searchError.value = null; isSearching.value = true; })` before the debounced IPC call.
  - **HMR safety**: Module-level `effect()` for debounced search MUST store its disposer and clean up via `import.meta.hot?.dispose()` (follow existing pattern in `i18n/index.ts`).
  - **Debounced search**: 300ms debounce on text/filter/sort changes.

### Verification
```bash
cd desktop/web && npx tsc --noEmit
```

---

## Sub-Phase 1e: Plant DB Panel UI

**Invoke first**: `/canopi-ux` (component structure, CSS Modules, a11y, empty states), `/canopi-i18n` (adding keys to all 6 locale files)
**Context7 queries before writing code**:
- `mcp__context7__resolve-library-id` → `@tanstack/virtual` → then `query-docs` for: `Virtualizer` class constructor, `getVirtualItems()`, `getTotalSize()`, imperative API usage (not React hooks), scroll element binding, dynamic sizing
- `mcp__context7__resolve-library-id` → `preact` → then `query-docs` for: `useRef`, `useEffect` cleanup patterns, JSX event types (`onInput`, `onDragStart`), `draggable` attribute
**Agent**: `canopi-frontend-dev` for implementation
**Depends on**: 1d

### Files to Create
- `desktop/web/src/components/plant-db/SearchBar.tsx` — Debounced input + result count + clear button
- `desktop/web/src/components/plant-db/FilterSidebar.tsx` — Collapsible filter sections
- `desktop/web/src/components/plant-db/FilterSection.tsx` — Accordion filter group (checkboxes, range, toggle)
- `desktop/web/src/components/plant-db/ResultsList.tsx` — Virtual-scrolled list with infinite scroll
- `desktop/web/src/components/plant-db/PlantRow.tsx` — Single row: drag handle, botanical name, common name, key stats, favorite star
- `desktop/web/src/components/plant-db/PlantCard.tsx` — Card/grid view item
- `desktop/web/src/components/plant-db/ViewModeToggle.tsx` — List/card/table toggle
- `desktop/web/src/components/plant-db/SortSelect.tsx` — Sort dropdown
- `desktop/web/src/components/plant-db/PlantDb.module.css` — All styles

### Files to Modify
- `desktop/web/src/components/panels/PlantDbPanel.tsx` — Complete rewrite: compose SearchBar + FilterSidebar + ResultsList
- `desktop/web/package.json` — Add `@tanstack/virtual-core` dependency
- All 6 locale JSON files — Add ~30 new `plantDb.*` keys (filters, sort, view modes, etc.)

### Layout
```
+------------------+--------------------------------------+
| Filter Sidebar   | SearchBar + ViewModeToggle + Sort    |
| (collapsible,    |--------------------------------------|
|  ~240px)         | Virtual-scrolled results             |
|                  | (PlantRow / PlantCard / Table)       |
| Hardiness [5-9]  |                                     |
| Sun [x]Full      | row: drag | *Lavandula* | star      |
|     [x]Semi      |       Lavender | Lamiaceae          |
| Growth [x]Fast   |       Zone 5-9 | H: 0.3-0.6m       |
| ...              | ...                                  |
+------------------+--------------------------------------+
```

**Virtual scrolling**: Use `@tanstack/virtual-core` Virtualizer class (framework-agnostic, imperative API — perfect for Preact). Row height ~72px, overscan 10. **Important**: The raw `Virtualizer` constructor requires manually supplying `observeElementRect` and `observeElementOffset` functions — import them from `@tanstack/virtual-core`. Do NOT copy React adapter examples that use hooks (`useVirtualizer`).

**Signal subscriptions in components**: Use `useSignalEffect` (NOT `useEffect`) when subscribing to signals inside components — per CLAUDE.md. This applies to `ResultsList.tsx` (reading `searchResults`, `isSearching`), `FilterSidebar.tsx` (reading `filterOptions`, `activeFilters`), etc.

**Infinite scroll**: When last 5 items visible + `nextCursor` non-null, fetch next page and append to results. Must respect the generation counter from `plant-db.ts`.

**Drag handle**: `draggable="true"`, `onDragStart` sets `text/plain` (NOT `application/json` — unsupported MIME type in WebView) with `JSON.stringify({ canonical_name, common_name })` for Phase 2 canvas drop.

**Error states**: Display `searchError` signal content in `ResultsList` when non-null. Show retry button. `PlantDetailCard` (1f) must also handle load errors since it's reused in Phase 2.

### Verification
```bash
cd desktop/web && npm run build  # No TS errors
cargo tauri dev
# Search "lavender" → results appear after 300ms
# Toggle filters → results update
# Scroll down → infinite scroll loads more
# Switch view modes, change sort
```

---

## Sub-Phase 1f: PlantDetailCard + Favorites + Recently Viewed

**Invoke first**: `/canopi-ux` (card component patterns, reusable component design), `/canopi-i18n` (adding ~25 detail keys to all 6 locale files)
**Context7 queries**: None needed (building on patterns established in 1d/1e)
**Agent**: `canopi-frontend-dev` for implementation
**Depends on**: 1e

### Files to Create
- `desktop/web/src/components/plant-detail/PlantDetailCard.tsx` — Full detail view (dimensions, tolerances, uses, cultivation, ecology, relationships)
- `desktop/web/src/components/plant-detail/RelationshipList.tsx` — Companion/antagonist list
- `desktop/web/src/components/plant-detail/UsesSection.tsx` — Edible/medicinal/other uses
- `desktop/web/src/components/plant-detail/AttributeGrid.tsx` — Key-value attribute display
- `desktop/web/src/components/plant-detail/PlantDetail.module.css` — All detail styles

### Files to Modify
- `desktop/web/src/components/panels/PlantDbPanel.tsx` — Wire detail card (click result → show detail, back button to return)
- All 6 locale JSON files — Add ~25 new `plantDetail.*` keys

**PlantDetailCard is reusable**: accepts `canonicalName` prop, loads via IPC. Will be used again in Phase 2 (canvas right panel when clicking a placed plant). Must handle load errors gracefully (show error message + retry button).

**Scroll position preservation**: When opening PlantDetailCard, hide the results list via CSS (`display: none`) rather than unmounting it — this preserves the Virtualizer scroll position and DOM state. Use a `selectedCanonicalName` signal: when non-null, show detail card; when null, show results list. Both are always mounted, only one is visible.

**Favorites**: Star toggle in both PlantRow and PlantDetailCard. Calls `toggle_favorite` IPC, updates `favoriteNames` signal (replace array, not mutate).

**Recently viewed**: Automatic — `get_species_detail` IPC records the view. "Recently viewed" section accessible via filter sidebar or tab.

### Verification
```bash
cargo tauri dev
# Click a plant → detail card shows all sections
# Star/unstar → persists across panel switches and app restart
# Open several plants → recently viewed list updates
# Switch locale → common names and categorical values update
# Back button → returns to results (scroll position preserved)
```

---

## Dependency Graph

```
1a: prepare-db.py
 ↓
1b: Rust DB Module
 ↓
1c: IPC Commands
 ↓
1d: Frontend IPC + State
 ↓
1e: Plant DB Panel UI
 ↓
1f: PlantDetailCard + Favorites + Recently Viewed
```

## End-to-End Verification

After all sub-phases:
1. `cargo check --workspace` — compiles clean
2. `cd desktop/web && npx tsc --noEmit` — no type errors
3. `cd desktop/web && npm run build` — builds successfully
4. `cargo tauri dev` — app launches, plant DB panel functional
5. Search + filter + sort + virtual scroll + infinite scroll all work
6. Plant detail card shows all data sections with locale-aware common names
7. Favorites persist in user.db across restarts

## Post-Implementation (Canopi Plugin)

1. Spawn `canopi-reviewer` agent for code review (backend + frontend in parallel)
2. Fix all issues found, re-review until convergence
3. Run `/craft` for production-grade review
4. Run `/canopi-retro` at session end to capture learnings back into skills
