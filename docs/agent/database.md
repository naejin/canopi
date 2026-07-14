# Database And Plant Catalog

Use this guide when changing SQLite schema contracts, plant search, filters, species detail projection, translations, or canopi-data imports.

## Schema Contract

- `scripts/schema-contract.json` is the only authored source for the prepared schema version, minimum export version, Species columns/affinities, copied supporting-table shapes, prepared-only generated table/FTS shapes, required indexes, supplemental translations, and the reduced Web storage projection.
- `scripts/species_catalog_contract.py` strictly compiles that source into typed `prepare-db`, `web-catalog`, and `release` projections. It also cross-validates `common-types/plant-filter-fields.json`, verifies local SQLite profiles, and checks or writes generated Rust facts.
- `desktop/src/db/schema_contract_generated.rs` is committed generated output included by `desktop/src/db/schema_contract.rs`. Never edit or copy its constants by hand.
- Runtime startup compares `PRAGMA user_version` with the generated expected version. Startup warns on drift but does not block app startup; build and release verification is strict.
- The prepared profile treats FTS column order, external-content/tokenizer options, and full non-partial B-tree indexes as semantic storage facts; do not weaken these to name-only checks.
- Species table name is `species`.
- `prepare-db.py` verifies the export profile before touching its output, builds in a sibling staging database, verifies the complete prepared profile, and only then atomically replaces the destination. Missing optional Species columns are projected as typed `CAST(NULL AS <contract type>)` values so the prepared table retains its contracted affinity.
- Preparation derives `translated_values` compatibility columns and inserted locale columns from the projected supporting-table shape; do not add parallel locale lists to the script.
- Keep `idx_species_id` in the schema contract because search hydration joins ranked ids back through `species.id`.
- `bindings-gen` runs the full contract check before generating Filter adapters. A syntactically valid `s.<column>` reference still fails when the contracted column is missing or has an incompatible affinity. It discovers standard Python 3 launchers on Linux/macOS and Windows; set `PYTHON` to an executable path when an explicit interpreter is required.
- User DB migrations also use `PRAGMA user_version`; check before adding migrations.

```bash
# Validate the authored storage/Filter contracts and committed Rust facts
python3 scripts/species_catalog_contract.py check

# Refresh generated Rust facts after an intentional contract change
python3 scripts/species_catalog_contract.py emit-rust --write

# Inspect authored release metadata without scraping source code
python3 scripts/species_catalog_contract.py value prepared-schema-version
python3 scripts/species_catalog_contract.py value minimum-export-schema-version

# Verify local canopi-data or prepared bundle shapes
python3 scripts/species_catalog_contract.py verify-db --profile export <export.db>
python3 scripts/species_catalog_contract.py verify-db --profile web-export <export.db>
python3 scripts/species_catalog_contract.py verify-db --profile prepared <canopi-core.db>
```

## User DB Personal Libraries

- The user DB is separate from the bundled plant DB. It stores local app data such as settings, favorites, recently viewed Species, Recent Designs, and personal libraries that should survive normal app updates.
- These user DB rules apply to the desktop app. Web Edition v1 personal app data may be browser-local storage instead of a native user DB; keep shared UI behind caller-shaped app-data APIs. See `docs/adr/0014-web-edition-browser-local-app-data.md`.
- Desktop Design Notebook organization belongs in the user DB as a personal library of saved Design references, not in the plant DB, settings JSON, or `.canopi` Design save composition. Use incremental user DB migrations with dedicated tables for saved Design references, Notebook Sections, section membership, manual ordering, and timestamps.
- Web Edition v1 does not have the Design Notebook, notebook-style Design organization, or a visible browser-local Drafts list. Browser Drafts are internal browser-local convenience state, not user DB rows, saved path references, or Recent Designs.
- Design Notebook references point to saved `.canopi` paths only. Listing should share Recent Design path-availability semantics: prune references whose paths are definitely stale, hide ambiguous or permission-blocked paths for the current read without deleting them, and never delete user Notebook Sections as a side effect of file availability checks.
- Desktop Saved Object Stamps belong in the user DB, not in the plant DB and not in the settings JSON blob. Add an incremental user DB migration for a dedicated table rather than extending plant catalog schema or `.canopi` Design save composition.
- Saved Object Stamp rows should support stable identity, user-owned name, persisted manual order, timestamps, and an opaque normalized payload JSON for the visible canvas arrangement. Use prepared statements and keep library CRUD in focused user DB/service modules.
- Manual Saved Object Stamp ordering should update explicit order fields in the user DB. Do not rely on recently used ordering, and do not reorder stamps as a side effect of placement.
- Saved Object Stamp import/export uses `.canopi` files for portability, but imported/exported stamp files are not Recent Designs and should not be recorded through recent-file database helpers.

## Schema Update Checklist

When canopi-data removes or adds columns, update atomically:

1. Update the relevant version, Species/copied-supporting facts, prepared-only generated table/FTS facts, indexes, and reduced Web dependencies in `scripts/schema-contract.json`.
2. Run `python3 scripts/species_catalog_contract.py emit-rust --write`, then `python3 scripts/species_catalog_contract.py check`. Commit the generated Rust file with the authored source.
3. Update `common-types/src/species.rs` when the caller-facing contract changes.
4. Update `desktop/src/services/species_catalog_read/detail_projection.rs` and its row mapping when desktop read behavior changes; do not derive that caller model from physical storage automatically.
5. Update backend fixtures and `scripts/prepare-db.py` only when preparation/search behavior changes.
6. Keep the `web_projection` physical dependencies reduced. Web row derivation, Parquet layout, and manifest predicates remain in `generate-web-catalog.py` and are cross-validated at generation time.
7. Run the Python contract/preparation/Web tests, regenerate shared bindings, prepare a real DB when data is available, and run the Rust/database gates.

## Query Builder And Filters

- Plant detail query shape, selected columns, row-mapping contract, and projected text translation have one projection owner: `services/species_catalog_read/detail_projection.rs`.
- Detail row mapping reads projected columns by name so projection order can change without remapping every field.
- Search plans own count/list query construction and cursor semantics.
- Species Catalog read projections own caller-oriented SQL shape, row mapping, parameter placeholders, and localized Common Name hydration before a workflow interprets the facts.
- Treat the Species Catalog storage engine as an adapter behind Species Catalog read behavior. Desktop currently uses Rust + SQLite; Web Edition v1 uses a browser-native DuckDB-WASM adapter with generated browser catalog assets, but shared UI and workflows should not depend on a concrete storage engine. See `docs/adr/0008-species-catalog-storage-adapters.md`.
- Web Edition catalog assets should be generated from canopi-data export lineage in this repository, not hand-maintained in `canopi-website`. The generator should emit DuckDB-queryable Parquet shards as the primary catalog format, locale/search shards, current Web Edition filter fields, a supported-filter projection, and image metadata with deterministic names and size checks for the versioned Web Edition artifact.
- Generate Web Edition Species Catalog assets with `cd desktop/web && npm run generate:web-catalog`, which runs `scripts/generate-web-catalog.py` against the latest local canopi-data export by default. The target artifact is DuckDB-queryable Parquet shards under ignored `desktop/web/public/canopi-catalog/`; do not commit generated catalog output. If NDJSON fixtures remain during migration, keep them out of the browser performance path.
- The Web Edition catalog generator enforces Cloudflare Pages' 25 MiB per-asset limit across every emitted catalog, locale/search, filter metadata, image metadata, manifest, or worker-adjacent file in the output directory. Adjust shard counts, compression, or file format rather than weakening this guardrail.
- The Web catalog manifest records the semantic Species storage-contract fingerprint. Generation verifies the `web-export` profile, builds and validates a sibling staged artifact, publishes it through a failure-safe staged replacement, and cross-checks local manifest Filter keys/columns against the reduced projection. Pre-publication failures preserve the previous artifact, and publication failure attempts to restore its owned backup; do not describe the directory swap as visibility-atomic.
- Web catalog publication may replace only an absent/empty destination or an existing catalog identified by its generated manifest (with a constrained legacy-layout migration). Never point `--output-dir` at a repository root or unrelated directory; unowned destinations and destinations containing the source export are rejected.
- The live Species Catalog Workbench singleton is selected through `#species-catalog-live`: desktop uses `app/plant-browser/live.desktop.ts` with Tauri IPC adapters, and Web Edition uses `app/plant-browser/live.browser.ts` with `web/duckdb-wasm-catalog.ts`, `web/reduced-species-catalog.ts`, and browser-local app data. Keep `app/plant-browser/workbench.ts` dependency-injected and free of IPC imports.
- `web/duckdb-wasm-catalog.ts` must use DuckDB-WASM CDN bundle selection (`getJsDelivrBundles()`/`selectBundle()`) rather than importing raw `duckdb-*.wasm` assets. The raw npm WASM files exceed Cloudflare Pages' 25 MiB per-file limit.
- Web Edition v1 should reuse the desktop Species Catalog Workbench filter UI shape where possible, but the current browser catalog data scope remains climate zone, habit or growth form, life cycle, selected-locale Common Names/search data, and one hero image metadata row. Do not export new Species attributes for desktop-only dynamic filters in the Parquet migration unless a later bead explicitly expands the Web Edition data scope.
- The Web catalog generator should write the Web-supported filter catalog/projection into catalog metadata or manifest assets. The Web UI and adapter should consume that generated projection; do not hardcode a browser-only supported-filter list in components or adapter code.
- Unsupported desktop Species Catalog Filters should be absent from the Web Workbench projections, not returned as disabled controls.
- Web Edition Species Catalog search/filter execution should keep DuckDB-WASM alive as the query engine over the generated Parquet shards instead of loading all catalog rows into JavaScript arrays for filtering. Use DuckDB projection/filter pushdown-friendly query shapes, and measure two-character search cases plus strip/dynamic-filter combinations before accepting the migration.
- `web/duckdb-wasm-catalog.ts` should own one live DuckDB database and connection per catalog reader lifetime after the Parquet migration. Do not instantiate DuckDB, load every row, close the connection, and terminate the database as the normal search path. Clean up the connection/database on reader disposal and Vite HMR disposal.
- Register/query catalog asset URLs through DuckDB and let queries fetch the needed Parquet columns/row groups. Do not eagerly fetch all 11 locale shards, all image metadata, or all Species rows into JavaScript on startup. Locale-specific name/search assets should be registered or queried lazily for the active request locale.
- Preserve the existing Species Catalog Workbench search policy in Web Edition: empty text browses, one normalized character stays local/too-short, and active text searches start at two normalized characters with first-page exact counts omitted.
- Web Edition result-order parity work should target active Species Catalog Search first. Empty browse and filter-only results may keep stable canonical-name order unless a separate product decision changes browse sorting.
- Web Edition active search should match the desktop Common Name relevance tiers before attempting full SQLite FTS parity: displayed selected-language Common Name exact match, displayed selected-language Common Name prefix match, displayed selected-language Common Name contains-all-tokens match, selected-language alternate Matched Common Name, then canonical-name fallback. Exact desktop BM25 parity over family/genus, uses text, and broader text is out of scope unless the Web catalog data scope explicitly adds a richer search index.
- Web catalog initialization, manifest, or query failures should surface through the Workbench search/detail error and retry path. Do not silently return an empty catalog or hide the Plant Database panel when catalog assets fail.
- Web Edition v1 detail hydration should project only hero image metadata, Canonical Name, Common Names, climate zone, habit or growth form, and life cycle. Do not recreate the desktop `SpeciesDetail` payload in the DuckDB-WASM catalog just because filterable columns are present for search predicates.
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

`npm run gen:types` fails before writing adapters when a dynamic or fixed predicate references a missing column, a categorical/boolean/numeric field has an incompatible SQLite affinity, or the climate-zone join shape is absent.

## FTS5 Search

- `species_search_fts` has weighted columns: canonical name, common names, family/genus, uses text, and other text.
- `species_search_common_name_tokens` stores normalized Common Name tokens by species and language for non-indexed search plans; generated `species_search_name_entries` and `species_search_name_entry_tokens` store selected-language Common Name rows plus `__canonical__` and `__taxonomy__` rows for fast active search. Runtime relevance uses the generated entry index when present.
- Query-side Common Name tokenization must stay aligned with `scripts/prepare-db.py` `common_name_tokens()`: split on Unicode word tokens, fold diacritics/case, and only plan token-table joins for relevance-ordered pages.
- Use the full FTS table name in `MATCH`, not an alias.
- Strip all FTS metacharacters before building MATCH queries.
- Empty sanitized query means skip FTS.
- Relevance text searches rank selected-language Common Name matches before BM25: exact displayed Common Name first, then displayed Common Names whose tokens start with the query tokens, then displayed Common Names that contain the query tokens later, then Matched Common Names from selected-language alternates, then `bm25(species_search_fts, 8, 10, 5, 1, 1)` for Canonical Name, family, genus, and broader text matches. Do not use English Common Names as ranking or display fallback when another UI language is selected.
- `total_estimate` comes from count; visible rows come from list. If UI shows a new count with old rows during debounce, investigate frontend committed-result lifecycle first.
- The Species Catalog Workbench may pass `include_total=false` for active text searches to keep first-page latency low; pagination must rely on `next_cursor`, not `total_estimate`.
- The Species Catalog Workbench treats two normalized text characters as the first active backend search; one-character text is a frontend short-query state. Preserve this UX unless there is an explicit product decision to change it.
- Active Species Catalog Search must not put broad SQLite work on a synchronous invoke path. Long-running first-page list queries should run behind an async/background boundary with stale-result handling and a way to cancel or interrupt obsolete searches so newer input is not queued behind a shared plant DB read.
- SQLite interrupt handles are connection-wide. Active Species Catalog Search cancellation should mark a search interruptible only while that search owns the plant DB read; queued stale searches should be rejected without interrupting unrelated detail, favorite, filter, or browse reads on the shared plant DB connection.
- Short-prefix relevance optimization should preserve selected-language Common Name behavior. Prefer staging selected-language displayed and matched Common Name tiers before weaker Canonical Name, family, genus, or broader text matches instead of raising the minimum query length or reintroducing English Common Name fallback.
- Run the manual Species Catalog latency harness with `cargo test -p canopi-desktop services::species_catalog_read::search::tests::bundled_species_search_latency_harness_reports_list_and_count_timings -- --ignored --nocapture`.
- The harness opens `desktop/resources/canopi-core.db` by default, or `CANOPI_PLANT_DB_PATH` when set, and reports first-page list latency separately from total-count latency.
- Keep two-character broad-prefix cases such as `en-ap`, `fr-me`, and `fr-po` in any search-performance regression coverage because they exercise the first real user-visible active search.
- The Web Edition Parquet/DuckDB migration needs focused performance evidence before landing: record before/after timings for current Web catalog browse, two-character active search, a backed strip filter, and a locale switch. Add fixture-level tests for manifest parsing, supported-filter projection, Parquet query filtering, localized Common Name matching, and catalog asset size/file-count guards.

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
- `species_common_names.display_order` from canopi-data v14 is the authoritative Common Name rank.
- `best_common_names` uses `display_order`, then `is_primary`, then shortest non-canonical fallback.
- `get_locale_best_common_name` returns locale-specific best name without fallback.
- Search list rows include secondary names for disambiguation and may include a selected-language Matched Common Name to explain an active text search match.
- Cross-workflow backend callers should share Species Catalog read behavior through `desktop/src/services/species_catalog_read.rs` and its projection modules instead of reaching directly into `plant_db` lookup helpers from unrelated services.
- Dormant Site Adaptation was retired by ADR 0023. Do not keep hardiness compatibility or replacement-suggestion read projections in the Species Catalog unless a later decision reintroduces Site Adaptation as a mounted workflow.
- Web Edition v1 omits Site Adaptation and must not export hardiness, height, stratum, edibility, risk, or other desktop-only Species attributes during the current Parquet/DuckDB performance migration. A later data-scope decision may add backing attributes for additional desktop Species Catalog Filters when the generated catalog remains within Cloudflare Pages limits, but those fields must not automatically expand Web Edition Plant Detail or reintroduce Site Adaptation compatibility/replacement workflows. The reduced web detail projection in `desktop/web/src/web/reduced-species-catalog.ts` may expose Canonical Name, selected-locale Common Names, climate zone, habit/growth form, life cycle, and one hero image metadata row only. See `docs/adr/0018-web-edition-omits-site-adaptation.md` and `docs/adr/0023-retire-dormant-site-adaptation.md`.

## canopi-data Export

- canopi-data exports live under `~/projects/canopi-data/data/exports/canopi-export-YYYY-MM-DD.db`.
- Use the latest dated export unless the bead specifies another export.
- The canopi-data changelog lives at `~/projects/canopi-data/data/exports/changelog.md`.
- Regenerate with `python3 scripts/prepare-db.py --export-path ~/projects/canopi-data/data/exports/<latest>.db`.
- Omitting `--export-path` auto-discovers the latest export.
- The prepared desktop DB intentionally omits export tables that the app does not query, including `species_relationships`, `species_distributions`, `species_text_translations`, and `synonym_lookup`.
- canopi-data v14 removed provenance/audit columns from exported Species and `source` columns from supporting tables; do not reintroduce app dependencies on those columns.
- Stop the Tauri app before regenerating; finalization can hit DB locks.
- There is no `sqlite3` CLI on this system by default. Use Python `sqlite3` for DB inspection.

## Image Cache And Network

- `image_cache.rs` exposes path-only cache hits and fetch/cache misses.
- Cache hits should not reread image bytes when the caller only needs a path.
- Misses are single-flight per cache path and publish via temp-file plus rename.
- Cache LRU target is 500MB under the app data image-cache directory.
- Use `convertFileSrc()` on frontend paths returned by Rust.
- Do not reintroduce base64 image IPC.
- Web Edition v1 image support is metadata-only and lazy: include at most one remote hero image per Species, plus source/credit/license fields where available. Do not bundle image binaries, prefetch galleries, add a backend image proxy, or port the desktop native image cache into the static web build. See `docs/adr/0008-species-catalog-storage-adapters.md`.
