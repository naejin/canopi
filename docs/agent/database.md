# Database And Plant Catalog

Use this guide when changing SQLite schema contracts, plant search, filters, species detail projection, translations, or canopi-data imports.

## Schema Contract

- `scripts/schema-contract.json` maps canopi-data export columns to canopi-core.db columns.
- `prepare-db.py` reads from the contract. Update the contract when canopi-data changes column names.
- Runtime schema validation lives in `desktop/src/db/schema_contract.rs`.
- Startup warns on schema drift but does not block app startup.
- Plant DB schema version is `PRAGMA user_version = 10` for the current core DB.
- canopi-data export schema version is tracked in the contract.
- Species table name is `species`.
- `prepare-db.py` builds `species` with `CREATE TABLE AS`; keep `idx_species_id` in the schema contract because search hydration joins ranked ids back through `species.id`.
- User DB migrations also use `PRAGMA user_version`; check before adding migrations.

## User DB Personal Libraries

- The user DB is separate from the bundled plant DB. It stores local app data such as settings, favorites, recently viewed Species, Recent Designs, and personal libraries that should survive normal app updates.
- Design Notebook organization belongs in the user DB as a personal library of saved Design references, not in the plant DB, settings JSON, or `.canopi` Design save composition. Use incremental user DB migrations with dedicated tables for saved Design references, Notebook Sections, section membership, manual ordering, and timestamps.
- Design Notebook references point to saved `.canopi` paths only. Listing should share Recent Design path-availability semantics: prune references whose paths are definitely stale, hide ambiguous or permission-blocked paths for the current read without deleting them, and never delete user Notebook Sections as a side effect of file availability checks.
- Saved Object Stamps belong in the user DB, not in the plant DB and not in the settings JSON blob. Add an incremental user DB migration for a dedicated table rather than extending plant catalog schema or `.canopi` Design save composition.
- Saved Object Stamp rows should support stable identity, user-owned name, persisted manual order, timestamps, and an opaque normalized payload JSON for the visible canvas arrangement. Use prepared statements and keep library CRUD in focused user DB/service modules.
- Manual Saved Object Stamp ordering should update explicit order fields in the user DB. Do not rely on recently used ordering, and do not reorder stamps as a side effect of placement.
- Saved Object Stamp import/export uses `.canopi` files for portability, but imported/exported stamp files are not Recent Designs and should not be recorded through recent-file database helpers.

## Schema Update Checklist

When canopi-data removes or adds columns, update atomically:

1. `scripts/schema-contract.json`: bump schema version, min export schema version, and columns.
2. `desktop/src/db/schema_contract.rs`: bump expected plant schema version.
3. `common-types/src/species.rs`: update shared structs.
4. `desktop/src/services/species_catalog_read/detail_projection.rs` and `detail_row_map.rs`: update projection columns and row mapping order.
5. Backend test fixtures.
6. `scripts/prepare-db.py`: update search index generation if FTS columns change.
7. Frontend generated bindings if shared types changed.

## Query Builder And Filters

- Plant detail query shape, selected columns, row-mapping contract, and projected text translation have one projection owner: `services/species_catalog_read/detail_projection.rs`.
- Detail row mapping reads projected columns by name so projection order can change without remapping every field.
- Search plans own count/list query construction and cursor semantics.
- Species Catalog read projections own caller-oriented SQL shape, row mapping, parameter placeholders, and localized Common Name hydration before a workflow interprets the facts.
- `services/species_catalog_read/list_projection.rs` owns `SpeciesListItem` row mapping by projected column name. Search rows and canonical-name hydration for favorites/recently viewed must share this mapper so Common Name display, secondary names, fallback flags, and favorite-state defaults remain consistent.
- Species Catalog search has one structured request contract: `common-types/src/species.rs` `SpeciesSearchRequest`. Tauri command arguments may stay flat for IPC compatibility, but commands, services, plant DB search, and query planning should adapt to that request object instead of growing parallel argument lists.
- Species Catalog search planning is split by seam under `desktop/src/db/query_builder/`: `text.rs` owns FTS/Common Name normalization, `relevance.rs` owns Common Name ranking tiers and token joins, `predicates.rs` owns shared FTS/filter WHERE assembly, `pagination.rs` owns keyset/offset cursor behavior, and `projection.rs` owns reusable list row SELECT/Common Name join SQL fragments.
- `query_builder/sql.rs` owns SQL parameter placeholder allocation. Query-builder modules should bind values through `SqlBuilder` instead of hand-numbering placeholders with `params.len() + 1`.
- Count and list predicates should share the same planner path.
- `common-types/plant-filter-fields.json` owns both dynamic filter fields and the fixed `SpeciesFilter` catalog.
- Strip-field UI behavior can be schema-defined with `strip_choice` and `active_array_chip` on categorical strip fields; regenerate bindings instead of duplicating strip or chip metadata in frontend adapters.
- Fixed `SpeciesFilter` predicates with bespoke or schema-backed behavior belong in the JSON `fixed_filters` catalog; regenerate bindings instead of hand-editing generated Rust or TypeScript metadata.
- `query_builder/species_catalog_filters.rs` is the Species Catalog Filter adapter: it consumes generated fixed-filter predicates and owns SQL assembly with prepared parameters.
- Fixed Species Catalog Filter SQL dispatch iterates generated fixed-filter behaviors. The flat `SpeciesFilter` request-value adapter is generated into `desktop/src/db/plant_filter_fields.rs`; keep its generated-behavior tests current when adding fixed fields.
- `query_builder/filters.rs` should route fixed request fields to the Species Catalog Filter adapter and keep dynamic `extra` filters isolated behind allowlisted column validation.
- `SpeciesFilter.life_cycle` remains a fixed request field, but its predicate routes through generated fixed-filter behavior and maps to boolean DB columns such as `is_annual`, `is_biennial`, and `is_perennial`.
- Soil filtering uses boolean tolerance columns, not a `species_soil_types` table.
- Dynamic filter fields must be validated through allowlisted column metadata.
- Cursor pagination typed values must use numeric SQLite values for numeric sort fields, not text.

## Adding A Filterable Species Field

1. Add dynamic fields to `common-types/plant-filter-fields.json` `fields`, or add top-level `SpeciesFilter` fields to `fixed_filters` with their predicate and UI behavior.
2. For dynamic DB columns, declare the allowlisted `sql_column`; for fixed filters, choose the generated predicate kind instead of adding hard-coded SQL constants.
3. For categorical strip fields, declare `strip_choice` and `active_array_chip` in `fields` when the strip and active-chip UI should be schema-driven.
4. Regenerate generated Rust and TypeScript metadata with `cd desktop/web && npm run gen:types`.
5. Add `filters.field.<key>` labels to all 11 locale files for new dynamic fields, plus any fixed-filter UI labels referenced by the catalog.
6. If the field appears in detail UI, update `PlantDetailCard`/detail components and `plantDetail.*` i18n keys.
7. Add focused backend and frontend tests for filtering behavior.

## FTS5 Search

- `species_search_fts` has weighted columns: canonical name, common names, family/genus, uses text, and other text.
- `species_search_common_name_tokens` stores normalized Common Name tokens by species and language; generated `species_search_name_entries` and `species_search_name_entry_tokens` store selected-language Common Name rows plus `__canonical__` and `__taxonomy__` rows for fast active search. Runtime relevance uses the generated entry index when present and falls back to FTS for older DB assets.
- Query-side Common Name tokenization must stay aligned with `scripts/prepare-db.py` `common_name_tokens()`: split on Unicode word tokens, fold diacritics/case, and only plan token-table joins for relevance-ordered pages.
- Use the full FTS table name in `MATCH`, not an alias.
- Strip all FTS metacharacters before building MATCH queries.
- Empty sanitized query means skip FTS.
- Relevance text searches rank selected-language Common Name matches before BM25: exact displayed Common Name first, then displayed Common Names whose tokens start with the query tokens, then displayed Common Names that contain the query tokens later, then Matched Common Names from selected-language alternates, then `bm25(species_search_fts, 8, 10, 5, 1, 1)` for Canonical Name, family, genus, and broader text matches. Do not use English Common Names as ranking or display fallback when another UI language is selected.
- `total_estimate` comes from count; visible rows come from list. If UI shows a new count with old rows during debounce, investigate frontend committed-result lifecycle first.
- The Species Catalog Workbench may pass `include_total=false` for active text searches to keep first-page latency low; pagination must rely on `next_cursor`, not `total_estimate`.
- The Species Catalog Workbench treats two normalized text characters as the first active backend search; one-character text is a frontend short-query state. Preserve this UX unless there is an explicit product decision to change it.
- Active Species Catalog Search must not put broad SQLite work on a synchronous invoke path. Long-running first-page list queries should run behind an async/background boundary with stale-result handling and a way to cancel or interrupt obsolete searches so newer input is not queued behind a shared plant DB read.
- Short-prefix relevance optimization should preserve selected-language Common Name behavior. Prefer staging selected-language displayed and matched Common Name tiers before weaker Canonical Name, family, genus, or broader text matches instead of raising the minimum query length or reintroducing English Common Name fallback.
- Run the manual Species Catalog latency harness with `cargo test -p canopi-desktop services::species_catalog_read::search::tests::bundled_species_search_latency_harness_reports_list_and_count_timings -- --ignored --nocapture`.
- The harness opens `desktop/resources/canopi-core.db` by default, or `CANOPI_PLANT_DB_PATH` when set, and reports first-page list latency separately from total-count latency.
- Keep two-character broad-prefix cases such as `en-ap`, `fr-me`, and `fr-po` in any search-performance regression coverage because they exercise the first real user-visible active search.

## Translations

- `translated_values` is a wide table with language columns, not a normalized table.
- UI supports 11 languages; the DB may carry additional language columns for future use.
- `translate_value()` maps locale to a column via allowlist.
- Only fields with entries in `translated_values` are translated. Verify coverage before assuming.
- canopi-data translations are primary. `schema-contract.json` supplements gaps.
- Schema-contract translation keys must match DB values exactly, including case.
- Composite value translation treats comma-space-separated values as canonical while accepting legacy slash-separated composites.

## Common Names

- Common name lookup order is selected-language `best_common_names`, then selected-language `species_common_names`, then `species.common_name` only when the selected language is English.
- `best_common_names` uses `is_primary`, then shortest non-canonical fallback.
- `get_locale_best_common_name` returns locale-specific best name without fallback.
- Search list rows include secondary names for disambiguation and may include a selected-language Matched Common Name to explain an active text search match.
- Cross-workflow backend callers should share Species Catalog read behavior through `desktop/src/services/species_catalog_read.rs` and its projection modules instead of reaching directly into `plant_db` lookup helpers from unrelated services.
- Site Adaptation compatibility and replacement reads belong behind `desktop/src/services/species_catalog_read/{compatibility,replacement,common_names}.rs`. Site Adaptation owns hardiness compatibility interpretation and response shaping; it should not own Species Catalog SQL, placeholder assembly, table names, localized Common Name lookup, or Species Catalog storage test fixtures.

## canopi-data Export

- canopi-data exports live under `~/projects/canopi-data/data/exports/canopi-export-YYYY-MM-DD.db`.
- Use the latest dated export unless the bead specifies another export.
- The canopi-data changelog lives at `~/projects/canopi-data/data/exports/changelog.md`.
- Regenerate with `python3 scripts/prepare-db.py --export-path ~/projects/canopi-data/data/exports/<latest>.db`.
- Omitting `--export-path` auto-discovers the latest export.
- Stop the Tauri app before regenerating; finalization can hit DB locks.
- There is no `sqlite3` CLI on this system by default. Use Python `sqlite3` for DB inspection.

## Image Cache And Network

- `image_cache.rs` exposes path-only cache hits and fetch/cache misses.
- Cache hits should not reread image bytes when the caller only needs a path.
- Misses are single-flight per cache path and publish via temp-file plus rename.
- Cache LRU target is 500MB under the app data image-cache directory.
- Use `convertFileSrc()` on frontend paths returned by Rust.
- Do not reintroduce base64 image IPC.
