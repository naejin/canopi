# Species catalog

This guide covers the plant catalog: the Desktop SQLite plant DB, the query builder and FTS search, translations and common names, the storage contract, the Web Parquet/DuckDB-WASM catalog, and filter fields. The storage decision is [ADR 0006](../adr/0006-species-catalog-storage.md). Frontend workbench rules are in [frontend](frontend.md#workbenches-and-the-dock). Release and DB publication steps are in [native and release](native-and-release.md#bundled-plant-db).

## Shape

- Shared UI consumes the Species Catalog Workbench (`app/plant-browser/workbench.ts`, dependency-injected and free of IPC imports) through `speciesCatalogWorkbench`. The live instance comes from `#species-catalog-live`: Desktop uses `live.desktop.ts` (Tauri IPC over SQLite) and Web uses `live.browser.ts` with `browser-runtime.ts`, `web/duckdb-wasm-catalog.ts` and `web/reduced-species-catalog.ts`.
- Storage engines are adapters behind caller-oriented read projections. Shared UI never depends on SQLite or DuckDB.
- Site Adaptation (compatibility checks, replacement suggestions) is retired. Do not keep hardiness-compatibility or replacement projections.

## Storage contract

- `scripts/schema-contract.json` is the single authored source for the prepared schema version, the minimum export version, the Species Search normalization pin, the exact source-export SHA-256 (`prepared_artifact.source_export_sha256`), Species columns and affinities, copied and generated table and FTS shapes, required indexes, supplemental translations and the reduced Web projection.
- `scripts/species_catalog_contract.py` compiles it into `prepare-db`, `web-catalog` and `release` projections. It cross-validates `common-types/plant-filter-fields.json` and writes the committed Rust facts in `desktop/src/db/schema_contract_generated.rs`. Never edit that file by hand.
- A prepared DB is admitted only when `PRAGMA user_version` and the four identity values in `species_search_metadata` (schema version, prepared-contract fingerprint, normalization version, normalization fingerprint) match exactly. On mismatch the app starts, but `PlantDb` is `Corrupt` and species services are unavailable. There is no warning-only path.
- FTS column order, tokenizer options and full B-tree indexes are semantic facts. Never weaken them to name-only checks. The table is `species`. Keep `idx_species_id`, because search hydration joins ranked ids back through it.
- `common-types/species-search-normalization.json` is the cross-runtime normalization authority (NFKD, mark stripping, Letter/Number/underscore tokens, case folds, admission length, query-token selection, shared corpus). `common-types/species-search-unicode-15.json` holds its generated Unicode facts. Python (`scripts/species_search_normalization.py`), Rust (`desktop/src/db/species_search_normalization.rs`) and TypeScript (`utils/species-search-normalization.ts`) must all pass the corpus. When semantics change, bump the authority version and update the storage and Web pins.

```bash
python3 scripts/species_catalog_contract.py check              # contracts + committed Rust facts
python3 scripts/species_catalog_contract.py emit-rust --write  # refresh Rust facts after a contract change
python3 scripts/species_search_unicode_facts.py check          # pinned Unicode facts (write: refresh)
python3 scripts/species_catalog_contract.py value prepared-db-asset-name
python3 scripts/species_catalog_contract.py verify-source-export <export.db>
python3 scripts/species_catalog_contract.py verify-db --profile export|web-export|prepared <db>
```

Python tests: `python3 -m unittest scripts.test_species_search_normalization scripts.test_species_catalog_contract scripts.test_prepare_db scripts.test_web_catalog_artifact_contract scripts.test_generate_web_catalog`.

### Schema update checklist

When canopi-data adds or removes columns, update everything in one change:

1. `scripts/schema-contract.json`: versions, normalization pin, source-export SHA-256, Species and supporting facts, generated tables and FTS, indexes, and the reduced Web dependencies.
2. `python3 scripts/species_catalog_contract.py emit-rust --write`, then `check`. Commit the generated file.
3. `common-types/src/species.rs` when the caller contract changes. `desktop/src/services/species_catalog_read/detail_projection.rs` when detail reads change.
4. Fixtures and `scripts/prepare-db.py` only when preparation or search behaviour changes. `common-types/web-species-catalog-artifact.json` when the Web row schema changes.
5. Run the Python tests, `cd desktop/web && npm run gen:types`, prepare a real DB when the data is available, then run the Rust gates.

## Preparing the Desktop DB

- canopi-data exports live at `~/projects/canopi-data/data/exports/canopi-export-YYYY-MM-DD.db`, with a `changelog.md` beside them.
- `python3 scripts/prepare-db.py --export-path <pinned-export>.db` checks the export bytes against the pin and the export profile, builds a sibling staging DB, records the identity, verifies the full prepared profile, then atomically replaces `desktop/resources/canopi-core.db`. Without `--export-path` it auto-discovers the latest export and still enforces the pin.
- Missing optional columns become typed `CAST(NULL AS <type>)`. Locale columns derive from the supporting-table shape, so do not add parallel locale lists. Unused export tables (`species_relationships`, `species_distributions`, `species_text_translations`, `synonym_lookup`) are omitted.
- Stop the Tauri app before regenerating. Python's `sqlite3` works for inspection when the SQLite CLI is missing.

## Query builder and filters

- Search has one structured request, `SpeciesSearchRequest` (`common-types/src/species.rs`). `ipc/species.ts` flattens it for Tauri. Commands, services and planning adapt to the request object.
- `desktop/src/db/query_builder/` is split by seam: `text.rs` (normalized text to FTS and Common Name queries), `relevance.rs` (ranking tiers), `predicates.rs` (shared FTS and filter WHERE), `pagination.rs` and `cursor.rs` (keyset and offset), `projection.rs` (list SELECT and name joins), `filters.rs` and `species_catalog_filters.rs` (generated fixed-filter predicates) and `sql.rs` (`SqlBuilder` placeholder allocation). Never hand-number placeholders or format SQL strings.
- Count and list share one planner path. Numeric cursor values bind as numbers.
- `desktop/src/db/plant_catalog_connection.rs` admits the prepared identity and installs the SQLite normalization function. Production readers get only the sealed `PlantDbConnectionGuard`.
- `services/species_catalog_read/` owns caller projections: `detail_projection.rs` (detail SQL, columns and translation, mapped by column name), `list_projection.rs` (the `SpeciesListItem` mapper shared by search, favorites and recently viewed), plus common names, filters, media and flower colour. Unrelated services call these, not `plant_db` helpers.
- Dynamic filter columns are allowlisted. `life_cycle` maps to boolean `is_annual`, `is_biennial` and `is_perennial`. Soil uses boolean tolerance columns.

### Adding a filterable species field

1. Add a dynamic field to `common-types/plant-filter-fields.json` `fields` (with an allowlisted `sql_column`, plus `strip_choice` and `active_array_chip` for categorical strip fields), or a fixed field to `fixed_filters` with its generated predicate kind.
2. `cd desktop/web && npm run gen:types`. It fails before writing if a predicate names a missing column or an incompatible affinity. Then run `npm run check:types`.
3. Add `filters.field.<key>` (and any fixed-filter labels) to all 11 locale files.
4. If the field appears in detail, update `PlantDetailCard` and the `plantDetail.*` keys.
5. Add focused backend and frontend filter tests. Frontend rows and chips come from `plantFilterCatalog`. Never hard-code them. Web gets a filter only when the Web artifact contract adds it.

## FTS search

- `species_search_fts` has weighted columns: canonical name, common names, family/genus, uses text and other text. Use the full table name in `MATCH`. Strip FTS metacharacters, and an empty sanitized query skips FTS.
- Generated `species_search_name_entries` and `species_search_name_entry_tokens` hold selected-language Common Names plus `__canonical__` and `__taxonomy__` rows for active search. `species_search_common_name_tokens` serves the plans without that index. Query tokenization must match `prepare-db.py` `common_name_tokens()`.
- Ranking: exact displayed Common Name, then prefix, then contains-all-tokens, then selected-language alternate (Matched) Common Names, then `bm25(species_search_fts, 8, 10, 5, 1, 1)`. English names never stand in for another selected language. Browse uses Canonical Name order. There are no user sort controls.
- Admission (shared by every runtime): no normalized token browses, one token stays local as too short, and two or more tokens search with exact first-page counts omitted (`include_total=false`). Paginate with `next_cursor`, never `total_estimate`.
- Desktop search runs in the executor's `Catalog` class with generation checks, a generation-aware SQLite progress handler and interrupt-based supersession (`supersede_species_search`, a reviewed synchronous command). Deliver the interrupt while holding the cancellation mutex. Only the search that currently owns the connection is interruptible. Species Detail records Recently Viewed only after it releases the plant DB guard.
- Latency harness: `cargo test -p canopi-desktop services::species_catalog_read::search::tests::bundled_species_search_latency_harness_reports_list_and_count_timings -- --ignored --nocapture` (uses `CANOPI_PLANT_DB_PATH` or the bundled DB).

## Translations and common names

- `translated_values` is a wide table with one column per language. `translate_value()` maps the locale to a column through an allowlist. Only fields present there are translated. canopi-data translations come first, and `schema-contract.json` fills gaps with keys that must match DB values exactly, including case.
- Common Name lookup: selected-language `best_common_names`, then `species_common_names`, then `species.common_name` only for English. `display_order` is the authoritative rank. List rows carry secondary names and, during text search, the Matched Common Name.

## Web catalog

- `common-types/web-species-catalog-artifact.json` is the artifact authority: row schema, locale set, Parquet layout, supported-filter predicates, excluded detail fields and deployment limit. `scripts/generate-web-catalog.py` derives rows and writes Parquet. `desktop/web/src/generated/` holds the dependency-free admission module (regenerated by `npm run gen:types`). Check it with `npm run check:web-catalog-artifact`.
- `cd desktop/web && npm run generate:web-catalog` writes ignored Parquet shards to `desktop/web/public/canopi-catalog/`. Never commit them. Publication replaces only an empty destination or a catalog identified by its own manifest (`generated_by`), and never a repository root.
- The manifest records the artifact fingerprint, the Web storage fingerprint and the normalization identity. Browser startup and packaging reject a stale or contradictory manifest before opening DuckDB. Every asset stays under 25 MiB. NDJSON is fixture-only.
- Web scope: climate zone, habit or growth form and life cycle as filters, selected-locale Common Names, and one lazy remote hero image's metadata. Unsupported Desktop filters are absent, not disabled. Detail shows only the hero image, Canonical Name, Common Names, climate zone, habit and life cycle. Adding a filter never adds detail sections.
- `web/duckdb-wasm-catalog.ts` uses `getJsDelivrBundles()`/`selectBundle()` and never bundles raw `duckdb-*.wasm`. It keeps one lazy database and connection per reader. A failed open rolls back fully and becomes retryable. Locale, image and filter-option loads are single-flight and evict rejected promises. `browser-runtime.ts` owns the reader and workbench together and drains them on HMR disposal.
- Web search orders exact, prefix and contains matches on selected-language Common Names, then Matched names, then Canonical fallback. The source `common_name` column has no locale and is never used as a fallback.
- Failures surface as workbench error state with Retry. They never produce an empty catalog or a hidden panel.
- DuckDB tests keep one path through the real engine. Offline tests may replace only `read_parquet(...)` sources with inline relations.

## Images

- Desktop `desktop/src/image_cache.rs`: path-only hits, single-flight misses published through a temp file and rename, an LRU target of 500 MB under app data. The frontend uses `convertFileSrc()`, with no base64 image IPC. The asset protocol scope is limited to `$APPDATA/image-cache/**`.
- Web: metadata only, one lazy remote hero image, with no binaries, prefetch, proxy or native cache.

## Desktop user DB

- The user DB (`desktop/src/db/user_db.rs`, `user_db_schema.sql`, `CURRENT_USER_DB_VERSION`) is separate from the plant DB. It holds settings, favorites, recently viewed species, Recent Designs, the Design Notebook and Saved Object Stamps.
- There is one schema and no migrations. `UserDb::open` renames an older DB to `<file>.v<version>-set-aside` and starts empty. It refuses any other non-current version. A schema change edits the one file and bumps the version.
- All user DB work runs in the executor's `UserData` class, with validation and the whole transaction inside the admitted closure. Favorites and Recently Viewed lists read the index through `UserData` and hydrate rows through `Catalog`. Never hold both DB locks at once. Notebook relocation is one transaction. Stamps store an opaque normalized payload with explicit manual order.
