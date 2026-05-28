# Database And Plant Catalog

Use this guide when changing SQLite schema contracts, plant search, filters, species detail projection, translations, or canopi-data imports.

## Schema Contract

- `scripts/schema-contract.json` maps canopi-data export columns to canopi-core.db columns.
- `prepare-db.py` reads from the contract. Update the contract when canopi-data changes column names.
- Runtime schema validation lives in `desktop/src/db/schema_contract.rs`.
- Startup warns on schema drift but does not block app startup.
- Plant DB schema version is `PRAGMA user_version = 8` for the current core DB.
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
- Count and list predicates should share the same planner path.
- Fixed `SpeciesFilter` predicates with bespoke or schema-backed behavior belong in `query_builder/species_catalog_filters.rs`.
- `query_builder/filters.rs` should route fixed request fields to the Species Catalog Filter adapter and keep dynamic `extra` filters isolated behind allowlisted column validation.
- `SpeciesFilter.life_cycle` remains a fixed request field, but its predicate routes through the Species Catalog Filter adapter and maps to boolean DB columns such as `is_annual`, `is_biennial`, and `is_perennial`.
- Soil filtering uses boolean tolerance columns, not a `species_soil_types` table.
- Dynamic filter fields must be validated through allowlisted column metadata.
- Cursor pagination typed values must use numeric SQLite values for numeric sort fields, not text.

## Adding A Filterable Species Field

1. Add the backend column allowlist entry.
2. Classify the filter kind as numeric, boolean, categorical, or text where the query builder expects it.
3. Update generated/registry frontend metadata.
4. Add `filters.field.<key>` labels to all 11 locale files.
5. If the field appears in detail UI, update `PlantDetailCard`/detail components and `plantDetail.*` i18n keys.
6. Add focused backend and frontend tests for filtering behavior.

## FTS5 Search

- `species_search_fts` has weighted columns: canonical name, common names, family/genus, uses text, and other text.
- Use the full FTS table name in `MATCH`, not an alias.
- Strip all FTS metacharacters before building MATCH queries.
- Empty sanitized query means skip FTS.
- `total_estimate` comes from count; visible rows come from list. If UI shows a new count with old rows during debounce, investigate frontend committed-result lifecycle first.

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
