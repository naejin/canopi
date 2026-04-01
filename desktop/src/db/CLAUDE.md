# Database & SQLite

## Schema & Contract
- **Plant DB schema contract**: `scripts/schema-contract.json` maps canopi-data export columns to canopi-core.db columns. `prepare-db.py` reads from this contract, not hardcoded lists. When canopi-data changes column names, update the contract — not the Rust code
- **Plant detail query has one projection owner**: `detail.rs` owns a single ordered species-detail projection with cursor-based row mapping and contract-driven SQL generation. When adding/removing plant-detail fields, update that projection owner, the mapper, and the contract tests in the same patch instead of editing scattered `row.get(...)` sites
- **`schema_contract.rs` module**: Runtime schema validation — checks `user_version`, expected table presence, and column counts at startup. Warns on drift but does not block startup
- **Schema version**: `PRAGMA user_version = 5` in canopi-core.db. Rust backend warns if outside the shared expected version at startup. Export schema version 8 (`min_export_schema_version` in contract). Version is validated at startup via `schema_contract.rs`
- **Species table name**: `species` (NOT `silver_species` as in the architecture draft)
- **Migration versioning**: User DB uses `PRAGMA user_version` — check before adding migrations
- **Contract drift is test-owned, not runtime-fatal**: Keep plant DB startup in warn-and-continue mode, but add/update automated contract checks whenever the detail projection, schema version, or contract-managed translation fields change

## Column Conventions
- **Life cycle / nitrogen columns are booleans**: `is_annual`/`is_biennial`/`is_perennial` (not `life_cycle`), `nitrogen_fixer` (not `nitrogen_fixation`). Filter UI keeps `life_cycle: string[]` for OR-semantics, mapped to boolean columns in `query_builder.rs`
- **`species_soil_types` removed (schema v7)**: Soil filtering uses boolean tolerance columns (`tolerates_light_soil`, `tolerates_medium_soil`, `tolerates_heavy_soil`, `well_drained`, `heavy_clay`). `SpeciesFilter.soil_tolerances` maps to these columns in `query_builder.rs`
- **Stratum DB values are lowercase**: DB stores `"emergent"`, `"high"`, `"low"`, `"medium"` — NOT `"Emergent"`, `"High canopy"`. The `STRATA_COLORS` map in `plants.ts` uses raw DB keys. Display labels come from `STRATUM_I18N_KEY` -> `t()`. Never hardcode display-case stratum strings in color maps or comparisons
- **`SpeciesListItem.family/genus` are `Option<String>`**: DB columns are nullable. Non-optional `String` causes silent row drops in search and hard errors in favorites hydration
- **`species_common_names` has `is_primary` and `source` columns**: `is_primary=1` marks the preferred common name per species+language. Source is typically `wikidata`, `plantatlas`, `pfaf`, or `unknown`
- **Schema evolution field splits**: `invasive_potential` split into `invasive_potential` + `biogeographic_status`; `seed_dormancy_type` split into `seed_dormancy_type` + `seed_dormancy_depth` + `serotinous` (boolean). `habit` narrowed from 11 to 3 values. `flower_color` separator changed from `/` to comma-space. Split fields have translations managed via `schema-contract.json`
- **Ellenberg indicators are filterable**: 6 numeric Ellenberg columns (`ellenberg_light`, `ellenberg_moisture`, `ellenberg_ph`, `ellenberg_nitrogen`, `ellenberg_salinity`, `ellenberg_temperature`) are exposed as numeric range filters via `is_numeric_field()` in `filters.rs`
- **`ellenberg_inferences` table skipped**: 468K rows of ML-predicted Ellenberg values (v8 export). Not contracted — using observed values only from the 6 `ellenberg_*` columns on the species table

## rusqlite
- **`db::acquire()` helper**: All Mutex lock acquisition uses `acquire(&db.0, "PlantDb")` from `db/mod.rs` — recovers from poison with `tracing::warn`. Do not use inline `lock().unwrap_or_else(|e| e.into_inner())` in commands
- **rusqlite feature**: Use `bundled-full` (not `bundled`) — enables FTS5 full-text search
- **Plant DB PRAGMAs**: On read-only connections, do NOT set `journal_mode=WAL` or `query_only=true`. Only `mmap_size` and `cache_size`
- **Plant DB degraded mode**: If missing/corrupt, `lib.rs` falls back to in-memory DB. Frontend short-circuits all species IPC calls when degraded
- **`resolve_species_id()` helper**: Use `plant_db::resolve_species_id(conn, canonical_name)` for canonical->UUID lookup. Don't copy the inline pattern — it existed in 3 places before extraction
- **Cursor pagination typed values**: Height/Hardiness sort values must be pushed as `Value::Real`/`Value::Integer`, not `Value::Text`. SQLite type affinity makes text-vs-numeric comparisons silently wrong

## FTS5 Full-Text Search
- **FTS5 weighted columns**: `species_search_fts` has 5 columns: `canonical_name`, `common_names`, `family_genus`, `uses_text`, `other_text`. Ranked via `bm25(species_search_fts, 10, 8, 5, 1, 1)`. Built in `prepare-db.py build_search_index()`
- **FTS5 MATCH syntax**: Always use full table name (`species_search_fts MATCH ?1`), never an alias
- **FTS5 sanitization**: Strip ALL metacharacters `"()*+-^:\` — not just quotes. Empty after sanitization -> skip FTS

## Translations
- **`translated_values` table is wide format**: 22 language columns (`value_en`, `value_fr`, `value_es`, `value_pt`, `value_it`, `value_zh`, `value_de`, `value_ja`, `value_ko`, `value_nl`, `value_ru`, `value_fi`, `value_cs`, `value_pl`, `value_sv`, `value_da`, `value_ca`, `value_uk`, `value_hr`, `value_hu`). App UI supports 11 languages; extra 11 carried in DB for future expansion. NOT a normalized table with `language`/`translated` columns. `translate_value()` in `plant_db.rs` maps locale to column name via allowlist
- **`translated_values` coverage**: Only fields WITH entries in this table get translated. Check `SELECT DISTINCT field_name FROM translated_values` before assuming a field is translatable. Missing fields need entries added to `schema-contract.json` translations section + DB population
- **`translated_values` has two sources**: (1) rows copied from the canopi-data export, (2) rows inserted/updated by `populate_translations()` from `schema-contract.json`. Contract entries override export entries for the same `(field_name, value_en)` pair. Adding a new translatable field requires adding it to the contract's `translations` section, then regenerating the DB
- **Translation ownership**: canopi-data's `translated_values` table is the primary source for field value translations. The app's `schema-contract.json` translations section only supplements gaps. Check `SELECT DISTINCT field_name FROM translated_values` in the export before adding contract translations — if canopi-data already covers a field, don't duplicate in the contract
- **translated_values pipeline order**: Export translations are copied first, then `populate_translations()` fills or overrides contract-managed app fields from `schema-contract.json` (including normalized fields like `active_growth_period`, `bloom_period`, `flower_color`, `habit` and split fields like `biogeographic_status` / `seed_dormancy_depth`). Order matters
- **Adding translations**: Two steps required — (1) add entries to `schema-contract.json` `translations` section, (2) run `populate_translations()` from prepare-db.py or use python to INSERT directly into both `desktop/resources/canopi-core.db` and `target/debug/resources/canopi-core.db`. The contract alone doesn't update the running DB
- **Schema-contract translation keys must match actual DB values exactly (case-sensitive)**: Always verify with `SELECT DISTINCT <column> FROM species` before adding/changing keys in `schema-contract.json`. The canopi-data Python enum case does not necessarily match the export DB case (e.g., enum has lowercase `"tree"` but export produces Title Case `"Tree"`)
- **DB hot-patching**: Can INSERT/UPDATE `translated_values` in the running app's DB files — changes visible on next IPC call without app restart. Rust-side code changes require restart
- **Composite value translation**: `translate_composite_value()` in `lookup.rs` treats comma-space-separated values (e.g., `"Blue, Purple"`) as canonical, but still accepts legacy slash-separated composites (e.g., `"Blue/Purple"`). It translates each part via `translate_value()` and rejoins with the matching display separator. Used in `filters.rs` (filter options) and `detail.rs` (detail card)

## Common Names
- **Common name lookup order**: `best_common_names` -> `species_common_names` -> `species.common_name`. Both `get_common_name` (single) and `get_common_names_batch` (batch) follow this order. Always use `best_common_names` first — `species_common_names` has gaps (e.g., no French entries for many species)
- **`best_common_names` selection**: Uses `is_primary` flag from `species_common_names` (preferred), falls back to shortest non-canonical name. `prepare-db.py` uses `ROW_NUMBER()` with `is_primary DESC, LENGTH ASC`
- **`best_common_names` returns one name per locale**: Uses `is_primary` flag to select the best name (e.g., "Mais" for Zea mays in French, not "Ble d'Inde"). `species_common_names` has multiple names per species — multiple-name display planned for 3.3b

## Species Uses
- **`species_uses` descriptions are translatable**: `translated_values` has `use:*` prefixed field names (e.g., `use:edible_uses`). Map `use_category` "edible uses" -> field "use:edible_uses" via `category.replace(' ', '_')`. Query must use `SELECT DISTINCT` — the table has massive row duplication from prepare-db.py joins

## Filter-to-Column Mapping
- **Filter-to-column mapping**: `SpeciesFilter.life_cycle: Vec<String>` maps to boolean columns via `query_builder.rs` (e.g. `"Annual"` -> `is_annual = 1`). This preserves OR-semantics in the UI while the DB uses boolean columns. Don't change the filter type — change the query mapping

## canopi-data Export
- **canopi-data export location**: `~/projects/canopi-data/data/exports/canopi-export-YYYY-MM-DD.db` — use the latest dated file
- **canopi-data changelog**: `~/projects/canopi-data/data/exports/changelog.md` documents breaking/non-breaking changes per export. Check this before regenerating the plant DB with a new export
- **Regenerate plant DB**: `python3 scripts/prepare-db.py --export-path ~/projects/canopi-data/data/exports/<latest>.db` (outputs to `desktop/resources/canopi-core.db`). Omit `--export-path` to auto-discover latest export
- **`prepare-db.py` fails if Tauri app is running**: The `PRAGMA journal_mode=DELETE` at finalization hits a lock. Stop the app before regenerating, or ignore the error — the DB is already built, just not optimized
- **CI bundled DB**: Release builds download `canopi-core.db` from the `canopi-core-db` GitHub release tag (env vars `CANOPI_CORE_DB_RELEASE_TAG` / `CANOPI_CORE_DB_ASSET_NAME` in `build.yml`). Lint/test jobs set `CANOPI_SKIP_BUNDLED_DB=1` to compile without it

## Image Cache & Network
- **Image cache**: `image_cache.rs` — `fetch_and_cache_bytes()` returns raw bytes (no redundant `fs::read`). Uses `AtomicU64` tracked size to skip dir scans. LRU eviction at 500MB. Cache dir: `~/.local/share/com.canopi.app/image-cache/`. All downloads have 10s timeout + 10MB size limit via `ureq` config
- **Network hardening convention**: All `ureq` calls must set `timeout_global` and response size limits. Image cache is the reference pattern. Geocoding uses 5s timeout
