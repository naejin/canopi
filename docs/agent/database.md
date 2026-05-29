# Database And Plant Catalog

Use this guide when changing SQLite schema contracts, plant search, filters, species detail projection, translations, or canopi-data imports.

## Schema Contract

- `scripts/schema-contract.json` maps canopi-data export columns to canopi-core.db columns.
- `prepare-db.py` reads from the contract. Update the contract when canopi-data changes column names.
- Runtime schema validation lives in `desktop/src/db/schema_contract.rs`.
- Startup warns on schema drift but does not block app startup.
- Plant DB schema version is `PRAGMA user_version = 9` for the current core DB.
- canopi-data export schema version is tracked in the contract.
- Species table name is `species`.
- User DB migrations also use `PRAGMA user_version`; check before adding migrations.

## Schema Update Checklist

When canopi-data removes or adds columns, update atomically:

1. `scripts/schema-contract.json`: bump schema version, min export schema version, and columns.
2. `desktop/src/db/schema_contract.rs`: bump expected plant schema version.
3. `common-types/src/species.rs`: update shared structs.
4. `desktop/src/db/plant_db/detail.rs`: update projection columns and row mapping order.
5. Backend test fixtures.
6. `scripts/prepare-db.py`: update search index generation if FTS columns change.
7. Frontend generated bindings if shared types changed.

## Query Builder And Filters

- Plant detail query shape, selected columns, row-mapping contract, and projected text translation have one projection owner: `plant_db/detail_projection.rs`.
- Detail row mapping reads projected columns by name so projection order can change without remapping every field.
- Search plans own count/list query construction and cursor semantics.
- Species Catalog search planning is split by seam under `desktop/src/db/query_builder/`: `text.rs` owns FTS/Common Name normalization, `relevance.rs` owns Common Name ranking tiers and token joins, `predicates.rs` owns shared FTS/filter WHERE assembly, `pagination.rs` owns keyset/offset cursor behavior, and `projection.rs` owns list row SELECT columns.
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
- `species_search_common_name_tokens` stores normalized Common Name tokens by species and language; relevance search uses it to boost Common Name token matches before BM25.
- Query-side Common Name tokenization must stay aligned with `scripts/prepare-db.py` `common_name_tokens()`: split on Unicode word tokens, fold diacritics/case, and only plan token-table joins for relevance-ordered pages.
- Use the full FTS table name in `MATCH`, not an alias.
- Strip all FTS metacharacters before building MATCH queries.
- Empty sanitized query means skip FTS.
- Relevance text searches rank Common Name matches before BM25: active-locale exact phrase first for multi-word queries, then active-locale indexed query tokens, then fallback English exact phrase/tokens, then `bm25(species_search_fts, 8, 10, 5, 1, 1)` for canonical name, family, genus, and broader text matches.
- `total_estimate` comes from count; visible rows come from list. If UI shows a new count with old rows during debounce, investigate frontend committed-result lifecycle first.
- The Species Catalog Workbench may pass `include_total=false` for active text searches to keep first-page latency low; pagination must rely on `next_cursor`, not `total_estimate`.
- Run the manual Species Catalog latency harness with `cargo test -p canopi-desktop db::plant_db::search::tests::bundled_species_search_latency_harness_reports_list_and_count_timings -- --ignored --nocapture`.
- The harness opens `desktop/resources/canopi-core.db` by default, or `CANOPI_PLANT_DB_PATH` when set, and reports first-page list latency separately from total-count latency.

## Translations

- `translated_values` is a wide table with language columns, not a normalized table.
- UI supports 11 languages; the DB may carry additional language columns for future use.
- `translate_value()` maps locale to a column via allowlist.
- Only fields with entries in `translated_values` are translated. Verify coverage before assuming.
- canopi-data translations are primary. `schema-contract.json` supplements gaps.
- Schema-contract translation keys must match DB values exactly, including case.
- Composite value translation treats comma-space-separated values as canonical while accepting legacy slash-separated composites.

## Common Names

- Common name lookup order is `best_common_names`, then `species_common_names`, then `species.common_name`.
- `best_common_names` uses `is_primary`, then shortest non-canonical fallback.
- `get_locale_best_common_name` returns locale-specific best name without fallback.
- Search list rows include secondary names and fallback flags for disambiguation.
- Cross-workflow backend callers should share Species Catalog read behavior through `desktop/src/services/species_catalog_read.rs` instead of reaching directly into `plant_db` lookup helpers from unrelated services.

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
