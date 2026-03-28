# Canopi Roadmap

**Last updated**: 2026-03-28
**Current state**: Phases 0-2.1 complete. All Phase 3 complete (MVP). Phase 3.3 complete (FTS5 weighted columns + BM25 ranking, multiple common names, filter translation audit). Phase 3.4 complete (plant density: LOD labels, hover tooltip, stacked badges, dense planting zoom). Phase 3.5.5 complete (photo carousel + Rust image cache). Phase 3.6 complete (display mode controls + floating legend). Phase 3.9 complete (favorites panel). Phase 3.10 complete (copy-paste). Next: Tauri MCP live verification, then Phase 4 (terrain & location).

---

## Principles

These are non-negotiable. Every implementation decision must pass through them.

1. **Claude Code is the builder, humans review.** We move fast because the implementer is tireless and precise. But speed without validation is reckless. Every sub-phase ends with Tauri MCP verification — not "hope tsc passes."

2. **No technical debt.** No hacks, no drift, no "we'll fix it later." If the architecture doesn't support a feature cleanly, fix the architecture first. Invariants are enforced, not documented and ignored. Every module has a clear contract.

3. **Validate with the real app.** Max 3 sub-phases between `cargo tauri dev` + Tauri MCP verification runs. Screenshots, interaction tests, IPC monitoring. Static analysis catches syntax; only live testing catches behavior.

4. **Product sense before code.** Before implementing, describe the user workflow step by step. If it involves typing IDs, CRUD forms disconnected from context, or browser dialogs — redesign first. Research how professional tools solve the problem.

5. **UX is the product.** Every interaction must feel polished to Figma/Sketch level. 60fps canvas, smooth transitions, hover states, empty state guidance. Performance budget: all interactions <16ms, zoom/pan never below 30fps with 200+ plants.

6. **The data is the differentiator.** 175K species with 173 columns of ecological, morphological, and agronomic data — translated into 6 languages. No other garden design tool has this. Every feature should leverage the data richness.

---

## Tooling Protocol

Every sub-phase follows this workflow:

| Step | Tool | Purpose |
|------|------|---------|
| 1. Before code | Context7 MCP | Up-to-date library API docs |
| 2. Before UI code | Read `.interface-design/system.md` | Design tokens and patterns. Load `/interface-design:init` only for major new UI surfaces |
| 3. Understand blast radius | taoki `xray` / `ripple` | File structure, dependencies |
| 4. Write code | — | Implementation |
| 5. Static check | `cargo check`, `tsc --noEmit`, `npm run build` | Catch compile errors |
| 6. Live verification | Tauri MCP: `webview_screenshot`, `webview_interact`, `webview_keyboard` | Visual + interaction testing |
| 7. Backend verification | Tauri MCP: `ipc_execute_command`, `ipc_monitor` | IPC contract testing |
| 8. Design compliance | `/interface-design:audit` | Token, spacing, direction adherence |
| 9. Code quality | `/craft` with code-reviewer agents | Structural review, convergence rounds |

Context7 Library IDs: Tauri v2 (`/websites/v2_tauri_app`), rusqlite (`/rusqlite/rusqlite`), Konva.js (`/konvajs/site`), MapLibre (`/maplibre/maplibre-gl-js`), i18next (`/i18next/react-i18next`)

---

## What's Built (Phases 0-2.1, 3.0, 3.5, 3.0b, 3.0c)

- Tauri v2 + Preact shell with custom title bar, frameless window
- 175K-species plant DB with FTS5 full-text search, 173 contracted columns (schema v7)
- Plant search panel with compact rows, virtual scrolling
- Plant detail card (9 collapsible sections: identity, dimensions, life cycle, light & climate, soil, ecology, uses, text, related species)
- Filter drawer (8 filters: hardiness, sun, growth rate, life cycle, stratum, soil tolerance, nitrogen fixer, edible)
- Konva.js canvas with 4 MVP tools (Select, Hand, Rectangle, Text)
- 7 named layers, plant drag-and-drop, zone drawing
- Undo/redo (500-cap command pattern), grid + rulers, scale bar
- Multi-select + Transformer
- `.canopi` save/load with full document integrity, autosave
- Dark/light theme, 11-language i18n (en, fr, es, pt, it, zh, de, ja, ko, nl, ru)
- Field notebook design system (`.interface-design/system.md`)
- Welcome screen, zoom controls, panel bar
- Schema contract v4 (`scripts/schema-contract.json`) — 173 columns from schema v8, 8 supporting tables
- Species images (105K), external links (3.6K), species_uses (55K) tables contracted
- Soil filtering migrated from species_soil_types table to boolean tolerance columns
- `translated_values` carries 22 language columns (11 active in app UI, 11 reserved for future expansion)

---

## Phase 3: Data & Polish (MVP)

Goal: Make the plant database genuinely useful for design decisions, fix visual bugs, and ship a complete vertical slice.

### 3.0 — Data Contract Sync ✅

**Status**: Complete (2026-03-25). Schema contract pattern established, prepare-db.py rewritten, Rust backend adapted for `nitrogen_fixer`, `is_annual`/`is_biennial`/`is_perennial`, new succession stages. Frontend types updated. 57 columns contracted from schema v5 export.

---

### 3.0b — Schema v7 Sync ✅

**Status**: Complete (2026-03-26). Full pipeline updated for canopi-data schema v7 export.

**What was done**:
- Schema contract v3: 173 species columns (up from 57), 8 supporting tables, 35 B-tree indexes
- `species_soil_types` table removed — soil filtering migrated to boolean tolerance columns (`tolerates_light_soil`/`tolerates_medium_soil`/`tolerates_heavy_soil`/`well_drained`/`heavy_clay`)
- 5 new languages added: German (de), Japanese (ja), Korean (ko), Dutch (nl), Russian (ru) — total 11
- `translated_values` expanded to 11 language columns, 42 field_names from export + 4 contract-only
- `best_common_names` built for all 11 languages (111K entries)
- New tables contracted: `species_images` (105K rows), `species_external_links` (3.6K), `species_text_translations` (empty, ready)
- `SpeciesDetail` struct expanded to ~170 fields, 35+ categorical fields translated
- `get_species_images` and `get_species_external_links` IPC commands added
- FTS5 search text expanded with conservation_status, habitats, physical_characteristics, special_uses
- Frontend types mirrored, 5 new locale files created, language switcher updated
- `ellenberg_inferences` table skipped (468K ML predictions — will add when confidence improves)

**Verification gate**: `cargo tauri dev` + `ipc_execute_command` — species queries return new columns. Soil filtering works with boolean columns. `get_species_images` returns image URLs. `webview_interact` to verify plant search, filters, and detail card still work.

---

### 3.0c — Schema v8 Sync ✅

**Status**: Complete (2026-03-27). Non-breaking version bump for canopi-data v8 export.

**What was done**:
- Schema contract bumped to v4 (`min_export_schema_version` = 8)
- DB rebuilt from v8 export (175,473 species, 173 columns unchanged)
- `translated_values` now carries 22 language columns (11 new: fi, cs, pl, sv, da, ca, uk, hr, hu) and 48 field_names — extra languages carried in DB, not yet active in app UI
- `ellenberg_inferences` table (468K ML predictions) acknowledged but still skipped — observed values only
- Rust version check bumped to warn if `PRAGMA user_version < 4`

**No code changes** to types, queries, UI, or display modes — species table schema is identical to v7.

**Verification gate**: `prepare-db.py` succeeds, output DB has `user_version = 4`, 22-column `translated_values`, no `ellenberg_inferences` table. `cargo check` passes.

---

### 3.1 — Plant Characteristics (Detail Card) ✅

**Status**: Complete (2026-03-27). 15 collapsible sections, 11-language i18n, full field coverage.

**Why**: The detail card currently shows 9 sections covering ~30 fields. The DB now has 173 columns. A permaculture designer choosing plants needs growth form, propagation methods, fruit/seed info, leaf traits, ecological indicators, hazards, cultivation notes, and more.

**Approach**: Expand the detail card with collapsible sections. All categorical values displayed using the `translated_values` table for the user's locale.

**Prerequisite**: Phase 3.0b ✅ — all 173 columns contracted and available in the DB. `SpeciesDetail` struct already expanded with ~170 fields. 35+ categorical fields translated across 11 languages.

**Sections**:
| Section | Fields |
|---------|--------|
| Identity | canonical_name, common_name (best for locale), family, genus, is_hybrid, taxonomic_order, taxonomic_class |
| Dimensions | height_min/max_m, width_max_m, hardiness_zone_min/max, growth_rate, age_of_maturity_years |
| Life cycle | is_annual, is_biennial, is_perennial, lifespan, deciduous_evergreen, leaf_retention |
| Light & climate | tolerates_full_sun/semi_shade/full_shade, frost_tender, frost_free_days_min, drought_tolerance, precip_min/max_inches, active_growth_period |
| Soil | soil_ph_min/max, well_drained, heavy_clay, tolerates_light_soil/medium_soil/heavy_soil, tolerates_acid/alkaline/saline, fertility_requirement, moisture_use, anaerobic_tolerance, root_depth_min_cm |
| Growth form | habit, growth_form_type, growth_form_shape, growth_habit, woody, canopy_position, resprout_ability, coppice_potential |
| Ecology | stratum, succession_stage, ecological_system, nitrogen_fixer, mycorrhizal_type, grime_strategy, raunkiaer_life_form, cn_ratio, allelopathic, root_system_type, taproot_persistent |
| Uses & ratings | edibility_rating, medicinal_rating, other_uses_rating, edible_uses, medicinal_uses, other_uses, special_uses, scented, attracts_wildlife |
| Propagation | propagated_by_seed/cuttings/bare_root/container/sprigs/bulb/sod/tubers/corm, cold_stratification_required, vegetative_spread_rate, seed_spread_rate, propagation_method, sowing_period, harvest_period, dormancy_conditions, management_types |
| Fruit & seed | fruit_type, fruit_seed_color, fruit_seed_period_begin/end, fruit_seed_abundance, fruit_seed_persistence, seed_mass_mg, seed_length_mm, seed_germination_rate, seed_dispersal_mechanism, seed_storage_behaviour, seed_dormancy_type, seedbank_type |
| Leaf | leaf_type, leaf_compoundness, leaf_shape, sla_mm2_mg, ldmc_g_g, leaf_nitrogen/carbon/phosphorus_mg_g, leaf_dry_mass_mg |
| Bloom & flower | bloom_period, flower_color, pollinators |
| Reproduction | pollination_syndrome, sexual_system, mating_system, self_fertile, reproductive_type, clonal_growth_form, storage_organ |
| Risk | toxicity, known_hazards, invasive_potential, noxious_status, invasive_usda, weed_potential, fire_resistant, fire_tolerance, hedge_tolerance, salinity_tolerance, pests_diseases |
| Distribution | native_range, native_distribution (JSON), introduced_distribution (JSON), range_text, conservation_status |
| Text | summary, physical_characteristics, cultivation_notes, propagation_notes, habitats, carbon_farming |
| Photos | species_images (carousel — see 3.5.5) |
| Related species | species_relationships |
| External links | species_external_links (Wikipedia, TheFerns, Wikimedia) |
| Data quality | data_quality_tier, wood_density_g_cm3, photosynthesis_pathway (science/metadata — collapsed by default, shown for power users) |

**Sub-phases**:
- **3.1a**: Detail card UI: add new collapsible sections for all fields above. Style with field notebook tokens. Sections collapsed by default, expand on click. Empty/null fields hidden. Note: Rust types and frontend types already expanded in 3.0b
- **3.1b**: i18n: add section header keys and field label keys to all 6 locale files. Ensure all categorical values use `translated_values` for display
- **3.1c**: Bloom & flower section, distribution section, data quality section — separate pass since these have special rendering (color chips for flower_color, JSON array parsing for distribution)

**Verification gate**: `webview_screenshot` of detail card for Malus domestica. Verify all sections render, translations work when switching language, empty fields don't show.

---

### 3.2 — Filter UI Redesign ✅

**Status**: Complete (2026-03-28). Always-visible FilterStrip (6 controls: stratum chips, sun chips, hardiness/height range sliders, edibility threshold, nitrogen toggle) + MoreFiltersPanel (8 categories, 56 filterable fields, lazy-loaded options). Hybrid architecture: typed always-visible filters + dynamic `Vec<DynamicFilter>` channel with 65-field Rust allowlist. FilterChip used consistently across all surfaces. i18n in all 11 locales. Dark mode verified.

**Why**: Current filter drawer has 8 dropdown buttons. The DB now has 173 columns with 60+ filterable variables. Need Option C hybrid: always-visible essentials + "More filters" picker. Note: soil type filter migrated from `species_soil_types` table to boolean tolerance columns in 3.0b.

**Always-visible filters** (initial set, iterate with user feedback):
1. Stratum — multi-select chips (emergent, high, medium, low)
2. Hardiness zone — range slider
3. Sun tolerance — toggle buttons (full sun, semi-shade, full shade)
4. Edibility rating — minimum threshold slider (1-5)
5. Height range — dual-handle range slider (0-50m)
6. Nitrogen fixer — toggle switch

**"More filters" panel**: Opens as an overlay/drawer. Searchable field list grouped by category (Growth & Form, Climate & Soil, Ecology, Reproduction, Fruit & Seed, Leaf, Risk, Uses & Ratings). Each field opens a value picker appropriate to its type (multi-select for categoricals, toggle for booleans, range for numerics).

Active "More" filters display as removable chips below the always-visible filters.

**Sub-phases**:
- **3.2a**: Rust backend: expand `FilterOptions` and `SpeciesFilter` structs. Update `query_builder.rs` to handle all new filter types (boolean fields, numeric ranges, multi-select categoricals). Translate categorical filter values
- **3.2b**: Frontend: replace filter drawer with always-visible compact filter bar. Build range sliders, toggle buttons, multi-select chips
- **3.2c**: Frontend: build "More filters" panel with searchable categorized field picker. Wire to backend. Show active filter chips

**Verification gate**: `webview_interact` to apply filters, verify result counts change. Test combining multiple filters. Test "More filters" flow end to end.

---

### 3.3 — Search Quality & Translated Values ✅

**Status**: Complete (2026-03-28). FTS5 restructured from single `all_text` blob to 5 weighted columns (canonical_name, common_names, family_genus, uses_text, other_text). BM25 ranking with weights 10/8/5/1/1. Multiple common names display in detail card header. Filter translation audit: 6 raw English leaks fixed across FilterStrip, ActiveChips, FilterChip, RangeSlider, ThresholdSlider. All i18n keys added to 11 locales.

**Why**: 11-language support is a differentiator. The `translated_values` table has 659 entries across 55 field_names in 22 language columns (11 active, 11 reserved). Use-category and pollinators translations wired in 3.1. `best_common_names` now uses `is_primary` flag (fixed in 3.1). Common names expanded to 2.4M rows with Wikidata sources. However, search ranking is poor for non-English queries (FTS5 uses a single unweighted blob), and the app only shows one "best" common name per locale when multiple exist.

**Prerequisite**: Phase 3.1 ✅ — `is_primary` selection in `best_common_names`, pollinators translated, `species_uses` deduplicated, use descriptions translated.

**Approach**: Two remaining concerns — search ranking and common name visibility.

**Search ranking (FTS5 column weighting)**:
- Current FTS index is a single `all_text` blob — no way to prioritize common name matches over habitat text matches
- Restructure `species_search_fts` to use multiple columns: `canonical_name`, `common_names` (all languages), `family_genus`, `uses_text`, `other_text`
- Rank with `ORDER BY bm25(species_search_fts, 10, 8, 5, 1, 1)` — common name match on "maïs" outranks habitat text match on "mais"
- Requires `prepare-db.py` change + `query_builder.rs` ORDER BY update

**Common name visibility**:
- Search list rows: show primary common name prominently, then additional locale names as secondary text (e.g., "*Zea mays* — Maïs · Blé d'Inde"). Fetch from `species_common_names` for current locale, not just `best_common_names`
- Detail card header: show primary common name + additional names expandable
- Requires new IPC or expanding `get_species_detail` to return all locale common names
- `species_common_names` has data: avg 14.2 names per species, `is_primary` flag for ranking

**Sub-phases**:
- **3.3a**: FTS5 restructure — split into weighted columns in `prepare-db.py`, update `query_builder.rs` bm25 ranking. Regenerate DB
- **3.3b**: Multiple common names — fetch all locale common names for search results (batch) and detail card. Show in UI with primary + secondary pattern
- **3.3c**: Filter value labels — all dropdown/chip values show translated strings. "More filters" field names translated via i18n keys
- **3.3d**: Audit — switch through all 11 languages, screenshot each. Verify no untranslated categorical values leak through

**Verification gate**: Search "maïs" in French — Zea mays appears first. Search "Kukuruz" in German — Zea mays appears. Detail card for Zea mays in French shows "Maïs" as primary. `webview_screenshot` in each of the 11 languages.

---

### 3.4 — Plant Density Fix ✅

**Status**: Complete (2026-03-28). LOD threshold raised to stageScale >= 5. Nearest-neighbor label density (40px threshold, labels suppressed when crowded). HTML hover tooltip with common name, botanical name, stratum, height. Stacked plant badges (5px clustering with moss-green count badges). Grid snap extended to 1cm/2cm/5cm increments. Max zoom already at 200x. Selected plants always show labels.

**Why**: Dense plantings (guilds, ground cover rows, stacked plants) produce unreadable label overlap. Labels must be earned, not default. Additionally, permaculture practitioners designing herb spirals, salad beds, and ground cover layers commonly place plants at 5–10cm spacing — the current fixed screen-pixel circles and zoom range don't support this workflow.

**Design**:
- Default view: colored dot only, no labels — clean at any density
- Hover tooltip: common name, scientific name, key attributes on mouseover
- Zoom threshold: labels fade in when nearest-neighbor distance > ~40px screen space
- Selected plant: always shows label regardless of density
- Stacked plants: count badge on the dot, hover shows plant list

**Dense planting UX (5–10cm spacing)**:
- **Max zoom increase**: Current max zoom is insufficient for distinguishing plants at 10cm intervals in a 20m garden. Increase max zoom to allow viewing a ~0.5m area at full resolution
- **World-space plant size mode**: Add an option where circle diameter represents actual ground coverage (canopy spread or spacing diameter) instead of a fixed screen-pixel size. At dense zoom, circles should show actual spacing relationships. Counter-scale remains default for overview; world-space activates when zoomed past a threshold or as a user toggle
- **Bed/mass planting tool** (future — Pattern Fill): For 200 lettuce at 10cm spacing, individual circle placement is impractical. A region-based tool that says "fill this area with species X at Y spacing" is the real solution. This is the disabled Pattern Fill tool — re-enable as part of this phase or track separately
- **Grid snap granularity**: Ensure grid snap supports 1cm increments at high zoom levels. Current "nice distances" ladder may bottom out too early

**Sub-phases**:
- **3.4a**: Remove default labels from plant creation. Add hover tooltip (HTML overlay positioned at plant coordinates, not Konva text)
- **3.4b**: LOD label system — on zoom/pan, compute nearest-neighbor distances. Show labels only where space permits. Use spatial index for performance
- **3.4c**: Stacked plant detection + count badge. Selection always shows label
- **3.4d**: Dense planting support — increase max zoom, add world-space circle sizing mode, verify grid snap at fine granularity
- **3.4e**: (Optional) Bed planting tool prototype — region + species + spacing → auto-fill with plants. May move to a later phase if scope is too large

**Verification gate**: Place 20+ plants in a tight cluster. `webview_screenshot` at different zoom levels. Verify clean dots at overview, labels appearing as you zoom in. Test hover tooltip. Additionally: create a 1m×1m bed with plants at 10cm spacing — verify individual plants are distinguishable at max zoom, circles don't overlap, and grid snap allows precise 10cm placement.

---

### 3.5 — Dark Mode Canvas Fix ✅

**Status**: Complete (2026-03-25). `refreshCanvasTheme()` built, `getCanvasColor()` pattern established, scale bar and ruler corner fixed for both themes.

---

### 3.5.5 — Plant Photos ✅

**Status**: Complete (2026-03-28). Rust image cache module (ureq HTTP + SHA256 filenames + 500MB LRU eviction). PhotoCarousel component with 3:2 aspect ratio, fade-in, shimmer loading, nav arrows, 8px dot indicators, source badges. Stale state guard for rapid species switching. Dark mode verified. `convertFileSrc()` for WebView-safe image URLs.

**Why**: A plant photo is the single highest-value element in the detail card. 60% of species now have image URLs (105K images across 175K species). Showing a photo (or slideshow for multiple) dramatically improves plant identification and card usefulness.

**Prerequisite**: ~~canopi-data ships a `species_images` table~~ ✅ **MET** (schema v6, 2026-03-26). Table schema:
```
species_images (
  id TEXT PRIMARY KEY,
  species_id TEXT REFERENCES species(id),
  url TEXT NOT NULL,           -- direct HTTPS image URL
  source TEXT,                 -- "pfaf", "trefle", "floristic"
  sort_order INTEGER DEFAULT 0
)
```
Note: no `license` or `attribution` columns in the current export. Source field ("pfaf", "trefle") is available for display. Licensing filter deferred until canopi-data adds license metadata.

**Design**:
- Detail card header: photo area above the botanical name. Placeholder silhouette when no image or offline
- Multiple images: horizontal dot indicators, swipe/click to browse
- Source badge: small text overlay showing image source (pfaf, trefle, etc.)
- Offline: Rust backend fetches and caches images in app data dir (`~/.local/share/canopi/image-cache/`). Serve cached images via Tauri asset protocol. Cache eviction: LRU, max 500MB
- Privacy: all image fetches go through Rust (no direct browser requests to external CDNs)

**Sub-phases**:
- **3.5.5a**: Schema contract + prepare-db.py already updated in 3.0b. Rust backend: `SpeciesImage` struct and `get_species_images` IPC command already added in 3.0b. Frontend type wired
- **3.5.5b**: Rust image cache: fetch URL → save to app data dir → serve via `asset:` protocol or localhost. Cache lookup before fetch. Background fetch (don't block detail card render)
- **3.5.5c**: Frontend: photo component in detail card header. Placeholder → fade-in on load. Dot indicators for multiple images. Click to cycle. Source badge overlay
- **3.5.5d**: Offline mode: serve from cache when no network. Cache warming: on first detail view, fetch all images for that species. Eviction policy

**Verification gate**: Open detail card for Malus domestica — photo loads from cache after first fetch. Disconnect network — cached photo still shows. Species with no images shows placeholder. Switch between multiple images. Source badge visible.

---

### 3.6 — Display Modes (Color by Value, Size by Value) ✅

**Status**: Complete (2026-03-28). DisplayModeControls floating toolbar with custom dropdowns (Display: Default/Canopy Spread, Color by: None/Stratum/Hardiness/Life Cycle/Nitrogen/Edibility). DisplayLegend floating card. Visual cohesion with ZoomControls (matched surface treatment, opacity, transitions). Escape-to-close, keyboard nav. Rendering logic was already in display-modes.ts — this phase added the UI.

**Why**: Visual guild analysis. Color plants by stratum/moisture/nitrogen/growth-rate to instantly see ecological patterns. Size by height/width to visualize mature canopy.

**Design**:
- Toolbar or panel control: "Color by" dropdown (any categorical or boolean field) + "Size by" dropdown (any numeric field)
- Color mapping: auto-generate a palette from the field's distinct values (use field notebook earthy tones, not neon)
- Size mapping: linear scale from field min→max mapped to plant symbol min→max radius
- Legend: small floating legend showing color/size mapping
- Default: color=none (uniform dots), size=none (uniform radius)

**Sub-phases**:
- **3.6a**: Backend: add IPC command to fetch distinct values for a given field (for color legend) and min/max for numeric fields (for size scaling). Return translated values
- **3.6b**: Frontend: display mode controls (dropdowns for color-by and size-by). Color mapping engine — assign palette colors to distinct values. Size mapping engine — linear interpolation
- **3.6c**: Canvas rendering: update plant symbols when display mode changes. Walk all plant nodes, set fill color and radius based on their species data + active display mode. Add floating legend component

**Verification gate**: Place 10+ plants of different species. Set color-by=stratum, size-by=height_max_m. `webview_screenshot`. Verify distinct colors per stratum, size proportional to height. Toggle display modes off, verify uniform appearance returns.

---

### 3.7 — Dirty Indicator + File Operations Polish

**Why**: Basic UX hygiene. Users need to know when they have unsaved changes.

**Sub-phases**:
- **3.7a**: Dirty dot indicator next to file name in title bar. Wire to existing `designDirty` signal. Dot disappears on save
- **3.7b**: Cmd+N from canvas prompts if dirty. Recent files on welcome screen — verify clicking opens correctly. Title bar always shows file name after save

**Verification gate**: Make a change, `webview_screenshot` to see dirty dot. Save, verify dot gone. Test Cmd+N with unsaved changes.

---

### 3.8 — DB Upgrade Robustness

**Why**: canopi-data evolves faster than the app. Column renames broke the pipeline once (3.0) and a table removal broke it again (3.0b). The contract pattern works — this phase hardens the remaining gaps.

**Already done** (in 3.0 + 3.0b):
- `scripts/schema-contract.json` is the authoritative mapping (173 columns, 6 supporting tables)
- `prepare-db.py` validates export against contract: warns on missing columns, ignores unknown, fails on schema_version mismatch
- Rust backend checks `PRAGMA user_version` at startup

**Remaining**:
- **3.8a**: Rust backend: `PlantDb::open()` — if it encounters version N+1 (newer than expected), operate in degraded mode for unknown fields rather than crashing
- **3.8b**: Write `scripts/SCHEMA.md` documenting the contract so canopi-data contributors know what Canopi expects

**Verification gate**: Run prepare-db.py against the current export — should succeed. Simulate a future export with an extra column — should succeed with warning. Simulate missing column — should succeed with NULL default and warning.

---

### 3.9 — Favorites Panel ✅

**Status**: Complete (2026-03-28). Backend was already implemented (user_db favorites table, toggle/get/recently_viewed IPC). Added: `"favorites"` to Panel/SidePanel types, star icon in PanelBar, FavoritesPanel component with PlantRow reuse, detail card integration, empty state with warm ochre star icon, accessibility (aria-live, aria-busy, role=list). Critique pass refined typography, spacing, count badge to match design system.

**Why**: A permaculture designer has 20-30 go-to plants they use across every design. Searching 175K species each time is wasteful. The star button already exists on plant rows but there's no dedicated view to access starred plants quickly.

**Design**: A third tab in the right panel bar (alongside Plant Database and Learning). Shows only favorited plants in a compact list. Drag-to-canvas works the same as from the search panel. Favorites persist in the user DB across sessions.

**Sub-phases**:
- **3.9a**: Rust backend: `favorites` table in user DB (species_id, added_at). IPC commands: `add_favorite`, `remove_favorite`, `get_favorites`. Return full species data for each favorite so the list is self-contained
- **3.9b**: Frontend: Favorites panel component in PanelBar. Same compact row format as plant search. Star button toggles filled/unfilled. Drag-to-canvas support. Empty state: "Star plants from the search panel to add them here"
- **3.9c**: Wire existing star buttons in PlantRow and PlantDetailCard to the favorites IPC. Visual feedback on toggle (filled star = favorited)

**Verification gate**: Star 5 plants from search. Switch to Favorites tab — all 5 appear. Drag one to canvas — plant appears. Unstar one — disappears from favorites. Restart app — favorites persist.

---

### 3.10 — Copy-Paste (Ctrl+C/V/D) ✅

**Status**: Complete (discovered pre-existing implementation during 2026-03-28 MVP audit). Internal clipboard in engine.ts:1072-1176 (copyToClipboard, pasteFromClipboard with new UUIDs, duplicateSelected). Keyboard shortcuts in manager.ts:123-134 (Ctrl+C/V/D). Undoable via BatchCommand.

**Why**: Table stakes for any design tool. Users expect to copy a plant or zone and paste it elsewhere. Currently missing entirely.

**Design**:
- Ctrl+C: copy selected nodes to an internal clipboard (serialized Konva node data)
- Ctrl+V: paste at mouse position (or offset from original if mouse hasn't moved). Pasted nodes get new IDs
- Ctrl+D: duplicate in place (paste with small offset, no clipboard involvement)
- Multi-select copy: copy a group of nodes, paste preserves relative positions
- Cross-design paste is out of scope for MVP (would need `.canopi` fragment format)

**Sub-phases**:
- **3.10a**: Internal clipboard — serialize selected nodes to a portable format (reuse `serializeNode` from serializer.ts). Store in module-level signal, not system clipboard (avoids browser API issues in WebView)
- **3.10b**: Paste command — deserialize clipboard, assign new IDs, position at cursor or offset. Implement as `PasteCommand` for undo/redo. Handle plant nodes (need species_id reference) and zone/text nodes
- **3.10c**: Ctrl+D duplicate shortcut. Wire keyboard shortcuts in engine. Verify undo/redo works for paste and duplicate

**Verification gate**: Select a plant, Ctrl+C, click elsewhere, Ctrl+V — plant appears at new position. Undo — pasted plant removed. Select 3 objects, Ctrl+D — duplicates appear offset. Verify pasted objects have new IDs (don't conflict with originals on save).

---

### 3.11 — OS Locale Auto-Detection

**Why**: Non-technical users shouldn't have to hunt for a language picker on first launch. A French user on a French OS should see French immediately.

**Approach**: On first launch (no saved `locale` in user settings), detect the OS locale via the `sys_locale` crate in Rust, map to our 11 supported codes (e.g., `fr_FR.UTF-8` → `fr`), and set as the initial locale. Once the user changes language manually, their choice is persisted and the OS locale is never checked again.

**Implementation**:
- Add `sys_locale` crate to `desktop/Cargo.toml`
- In `get_settings` IPC: if `locale` is null/missing (fresh install), call `sys_locale::get_locale()`, extract the 2-letter code, match against `["en","fr","es","pt","it","zh","de","ja","ko","nl","ru"]`, fall back to `"en"`
- Write the detected locale to user DB so subsequent launches use it directly
- Works on Linux (`$LANG`), macOS (`NSLocale`), Windows (`GetUserDefaultLocaleName`) — all via `sys_locale`

**Verification gate**: Delete user DB, set OS locale to French, launch app — UI appears in French without any user interaction. Change to German via the locale picker — restart app — stays German (user choice persists).

---

### MVP Completion Checklist

All of Phase 3 (3.0 through 3.10) constitutes the MVP. After completion:

- [x] End-to-end flow: Launch, welcome screen, New Design, search plants, apply filters (visible + "More"), drag plants to canvas, draw zones, display modes (color/size by value), save, reopen
- [x] All 11 languages: translated categorical values, common names, UI strings
- [x] OS locale auto-detection on first launch
- [x] Both themes: light and dark mode fully functional including canvas elements
- [x] Plant density: clean dots at overview, labels on zoom, hover tooltips, stacked badges
- [x] Detail card: all 173 columns organized in collapsible sections, with plant photos
- [x] Plant photos: image carousel in detail card, offline cache, source badges
- [x] Favorites: star plants, access from dedicated panel, drag to canvas
- [x] Copy-paste: Ctrl+C/V/D for all canvas objects with undo/redo
- [x] Dirty indicator: visible in title bar, prompt on close with unsaved changes
- [x] DB resilience: schema contract validated, forward/backward compatible
- [ ] Tauri MCP live verification: visual + interaction testing across all features (pending reconnection)

---

## Phase 4: Terrain & Location (Post-MVP)

Goal: Add geographic context — terrain contours, hillshading, base maps, and location-aware features.

**Technology**: MapLibre GL JS (confirmed after evaluating alternatives). BSD-3-Clause, best-in-class terrain support, offline via PMTiles, integration pattern already scaffolded in codebase.

### Architecture

```
Konva.js (Canvas 2D)     ← Design layer (plants, zones, annotations)
  z-index: above
MapLibre GL JS (WebGL)   ← Map layer (basemap, terrain, contours)
  z-index: below
```

- MapLibre renders in a `<div>` behind the Konva stage
- Coordinate sync: local tangent plane projection (`canvas/projection.ts`)
- Tile source: PMTiles bundles served via Tauri asset protocol (offline-first)
- Contour generation: `maplibre-contour` plugin (client-side from DEM tiles)

### Tile Sources (open, offline-capable)
- Basemap: OpenFreeMap or Protomaps (PMTiles format)
- Terrain DEM: Mapzen terrain tiles (PMTiles via Protomaps)
- Satellite: Esri World Imagery or Sentinel-2 (licensing TBD)

### 4.0 — Location Input

**Why**: Every geo feature depends on knowing where the design is. Without coordinates, no map tiles, no contours, no climate data.

**Design**: Location is set per-design, stored in the `.canopi` file's `location` field (already in the document schema). Two input methods:
1. **Address search** — geocoding via Nominatim (free, no API key) or Photon. Type "123 Rue des Érables, Quebec" → get lat/lng
2. **Map click** — show a simple MapLibre map in a modal, user clicks to drop a pin

The design's location becomes the origin point for the local tangent plane projection. All canvas meter-coordinates are relative to this point.

**Sub-phases**:
- **4.0a**: Add location modal component — address search bar + MapLibre mini-map for visual confirmation. Geocoding via Nominatim HTTP API (called from Rust to avoid CORS). Store lat/lng in design metadata
- **4.0b**: Wire location to document save/load. Show location summary in title bar or design properties. Allow changing location (warn that it shifts all geo-referenced features)
- **4.0c**: Implement `canvas/projection.ts` — local tangent plane math: `lngLatToMeters(lng, lat, originLng, originLat)` and inverse. Unit tests for projection accuracy at different latitudes

**Verification gate**: Set a location via address search. `ipc_execute_command` to verify lat/lng stored. Save, reload, confirm location persists. Test projection round-trip at equator and at 60°N.

---

### 4.1 — MapLibre Integration

**Why**: The base map layer behind the canvas — satellite imagery, topo maps, street context.

**Architecture**: MapLibre renders in a `<div>` positioned behind the Konva stage container via CSS `z-index`. When the map layer is active, the Konva base layer background becomes transparent. On pan/zoom, MapLibre viewport syncs with Konva stage transforms.

**Key challenges**:
- **Event routing**: Pan/zoom events must reach both MapLibre (for tile loading) and Konva (for shape interaction). Solution: Konva stage captures events first; pass-through to MapLibre when no shape is under the cursor
- **Coordinate sync**: Konva uses meters (world units), MapLibre uses lng/lat. Every stage transform change must update MapLibre's center/zoom via projection.ts
- **Lazy loading**: MapLibre is ~220KB. Never top-level import — dynamic `import()` on first map activation

**Sub-phases**:
- **4.1a**: Reactivate existing `canvas/map-layer.ts`. Create MapLibre container div behind Konva stage. Implement viewport sync — when Konva stage pans/zooms, update MapLibre center and zoom via projection math
- **4.1b**: Event routing layer — pointer events pass through to MapLibre when no Konva shape is hit. Map layer activation toggle (signal in `state/canvas.ts`)
- **4.1c**: Style selection — load a default basemap style (OpenFreeMap). Add map opacity control. Ensure theme switch doesn't break map rendering

**Verification gate**: Enable map layer. `webview_screenshot` to verify tiles render behind canvas shapes. Pan and zoom — map and canvas stay aligned. Place a plant, verify it doesn't drift relative to the map. Disable map layer, verify canvas returns to normal background.

---

### 4.2 — PMTiles Offline

**Why**: Desktop app used in rural areas. Tiles must work without internet after initial download.

**Design**: PMTiles is a single-file tile archive format. One `.pmtiles` file contains all tiles for a region at all zoom levels. MapLibre loads tiles from it via a protocol handler.

**Approach**:
- On first location set, offer to download regional tiles for offline use
- Rust backend serves PMTiles via Tauri's custom protocol (`canopi://tiles/...`) or localhost HTTP
- Downloaded tiles cached in app data directory (`~/.local/share/canopi/tiles/` on Linux)
- Tile region selection: bounding box around design location + configurable radius (default 10km)

**Sub-phases**:
- **4.2a**: Rust backend: PMTiles reader — parse the PMTiles header, serve individual tiles by z/x/y coordinates. Expose as Tauri custom protocol handler so MapLibre can fetch `canopi-tiles://basemap/{z}/{x}/{y}.pbf`
- **4.2b**: Tile download manager — given a bounding box and zoom range, download a PMTiles extract from a remote source (Protomaps or pre-built regional files). Show download progress in UI. Store in app data dir
- **4.2c**: MapLibre configuration — register the custom protocol as a tile source. Fallback: if local tiles unavailable, load from remote. Indicator in UI showing online/offline tile status

**Verification gate**: Download tiles for a test region. Disconnect network. `webview_screenshot` — map still renders from local tiles. Reconnect, verify no change in behavior.

---

### 4.3 — Terrain Contours

**Why**: Contour lines show slope, ridges, valleys, water flow paths — essential for site analysis in agroecological design (swale placement, terrace planning, drainage).

**Technology**: `maplibre-contour` plugin generates contour lines client-side from DEM raster tiles. No server-side processing needed.

**Design**:
- Contour interval configurable: 1m, 2m, 5m, 10m (auto-select based on zoom level and terrain relief)
- Major contours (every 5th line) rendered thicker with elevation labels
- Contour colors: earthy brown tones from field notebook palette, not cartographic orange
- Contours render as a MapLibre vector layer — toggleable independently from basemap

**Sub-phases**:
- **4.3a**: Add `maplibre-contour` dependency. Configure DEM tile source (Mapzen terrain tiles). Generate contour lines for the design's bounding box. Render as a MapLibre line layer
- **4.3b**: Contour styling — major/minor line weights, elevation labels on major contours, field notebook color palette. Adaptive interval based on zoom level (coarser when zoomed out, finer when zoomed in)
- **4.3c**: Contour interval control in layer panel — dropdown or slider. Persist user preference in settings

**Verification gate**: Set location to a hilly area. `webview_screenshot` to verify contour lines render. Zoom in — verify interval adapts and labels appear on major contours. Toggle contours off, verify they disappear cleanly.

---

### 4.4 — Hillshading

**Why**: Hillshading gives immediate visual understanding of terrain relief — ridges, valleys, slope aspect — without reading contour numbers. Combined with contours, it makes terrain analysis intuitive.

**Technology**: MapLibre's built-in `hillshade` layer type. Renders directly from DEM raster tiles with configurable sun angle and exaggeration.

**Sub-phases**:
- **4.4a**: Add `hillshade` layer to MapLibre style, sourced from the same DEM tiles as contours. Default: subtle shadow (low exaggeration), sun from northwest (standard cartographic convention)
- **4.4b**: Hillshade opacity control — must blend well with both light and dark canvas themes. Semi-transparent so canvas shapes remain readable on top

**Verification gate**: Enable hillshading. `webview_screenshot` — verify terrain relief is visible but doesn't overwhelm canvas shapes. Toggle theme — verify hillshade remains readable in both modes. Adjust opacity, verify smooth transition.

---

### 4.5 — Layer Controls UI

**Why**: All map layers (basemap, satellite, contours, hillshading, street overlay) need independent toggle and opacity controls. Users may want contours + satellite but no hillshading, or contours-only on the plain canvas.

**Design**: Layer control panel — either a section in the right panel bar or a floating popover from a map button in the toolbar. Each layer gets:
- Toggle switch (on/off)
- Opacity slider (0-100%)
- For contours: interval selector
- For basemap: style selector (topo, satellite, street)

**Sub-phases**:
- **4.5a**: Layer control component — list of available map layers with toggle + opacity slider per layer. Wire to MapLibre layer visibility and opacity. Persist layer preferences in user settings
- **4.5b**: Basemap style switcher — topo, satellite, street, none. Contour interval control integrated here. Add map toggle button to canvas toolbar (or panel bar)
- **4.5c**: Polish: layer thumbnails/previews, smooth opacity transitions, keyboard shortcuts for quick layer toggle

**Verification gate**: Toggle each layer independently. `webview_screenshot` with different layer combinations. Adjust opacities, verify they persist after app restart. Test with location set vs no location (graceful degradation — show "Set location to enable map layers" message).

---

## Phase 5: Native Platform Integration

Goal: Native OS capabilities for export quality, performance, and platform polish. The `Platform` trait provides a unified API; each OS gets its own implementation.

### Development Environment Constraint

Development happens on **Linux only**. No access to macOS or Windows machines.

- **lib-c (Linux)**: Full develop + test + Tauri MCP verification locally
- **lib-swift (macOS)** and **lib-cpp (Windows)**: Write code on Linux → CI compiles and runs tests on GitHub Actions macOS/Windows runners → team beta testers validate on their machines → we fix based on feedback

This means CI infrastructure is a hard prerequisite before any macOS/Windows native code.

### Platform Trait

```rust
// desktop/src/platform.rs
pub trait Platform {
    fn export_png(canvas_data: &[u8], width: u32, height: u32, dpi: u32) -> Result<Vec<u8>, String>;
    fn export_pdf(document: &DesignDocument, layout: &PrintLayout) -> Result<Vec<u8>, String>;
    fn watch_file(path: &Path, callback: Box<dyn Fn(FileEvent)>) -> Result<WatchHandle, String>;
    fn generate_thumbnail(design: &DesignDocument, size: u32) -> Result<Vec<u8>, String>;
    // OS-specific integrations added per platform
}
```

Conditional compilation selects the right implementation:
- `#[cfg(target_os = "macos")]` → lib-swift (swift-bridge)
- `#[cfg(target_os = "windows")]` → lib-cpp (cxx)
- `#[cfg(target_os = "linux")]` → lib-c (cc/bindgen)

### What Each Library Provides

| Capability | lib-c (Linux) | lib-swift (macOS) | lib-cpp (Windows) |
|---|---|---|---|
| High-DPI rendering | Cairo/Skia | Core Graphics/Metal | Direct2D |
| PDF export | Cairo PDF | PDFKit | DirectWrite |
| File watching | inotify | FSEvents | ReadDirectoryChanges |
| OS integration | DBus, XDG, desktop portals | Spotlight, Quick Look, native menu | Shell thumbnails, jump list, taskbar progress |
| Pen/stylus | — | Apple Pencil | Windows Ink |

### 5.0 — CI Infrastructure (prerequisite for 5.2+)

**Why**: Cannot compile or test macOS/Windows native code locally. CI is the only way to validate cross-platform builds.

**Sub-phases**:
- **5.0a**: GitHub Actions workflow — `.github/workflows/build.yml`. Three jobs: Linux (ubuntu-latest), macOS (macos-latest), Windows (windows-latest). Each runs `cargo build --workspace` and `cargo test --workspace`. Triggered on push to main and PRs
- **5.0b**: Platform-specific test jobs — `cargo test -p lib-c` on Linux, `cargo test -p lib-swift` on macOS, `cargo test -p lib-cpp` on Windows. These are separate from the workspace build so failures are isolated
- **5.0c**: Tauri build jobs — `cargo tauri build` on each platform. Produces distributable binaries (.deb/.AppImage on Linux, .dmg on macOS, .msi on Windows). Upload as artifacts for beta testers to download

**Verification gate**: Push a trivial change, verify all 3 platform builds succeed via `gh run view`. Download macOS and Windows artifacts, share with beta testers for smoke test.

---

### 5.1 — Platform Trait + lib-c (Linux)

**Why**: Define the cross-platform abstraction and implement the first platform. Linux is the dev environment, so we get full local validation. This also proves the trait design before committing to it on macOS/Windows.

**Design decisions**:
- `Platform` trait is **object-safe** — allows dynamic dispatch if needed, but primary use is static dispatch via conditional compilation
- Each method returns `Result<T, PlatformError>` with a typed error enum (not String — this is infrastructure, not IPC)
- Export functions take a `CanvasSnapshot` struct (pixel data + dimensions + DPI) rather than raw bytes — type-safe contract
- PDF export takes a `PrintLayout` describing page size, margins, title block, legend, scale bar, plant schedule columns

**Sub-phases**:
- **5.1a**: Define `Platform` trait in `desktop/src/platform.rs`. Define `PlatformError`, `CanvasSnapshot`, `PrintLayout`, `FileEvent`, `WatchHandle` types in `common-types`. Implement no-op fallback so the app compiles on all platforms even before native libs are done
- **5.1b**: lib-c high-DPI rendering — Cairo surface from `CanvasSnapshot` pixel data, export as PNG at configurable DPI (72, 150, 300). Expose as IPC command: `export_png { dpi: u32 }` → saves file via dialog. FFI via `cc` + `bindgen` with Cairo C headers
- **5.1c**: lib-c PDF export — Cairo PDF surface. Render design at print scale with `PrintLayout` template: title block, north arrow, scale bar, legend (display mode colors if active), plant schedule table. Multi-page support for large designs
- **5.1d**: lib-c file watching — inotify watcher on the current `.canopi` file. Detect external modifications (e.g., another instance saved). Surface as Tauri event (`design-file-changed`) so frontend can prompt reload
- **5.1e**: lib-c OS integration — XDG desktop entry, MIME type registration for `.canopi` files (double-click opens Canopi), DBus notifications for long operations (tile download, large export)

**Verification gate**: Export a design as 300 DPI PNG — `ipc_execute_command` to trigger, verify file size and dimensions. Export PDF — open in document viewer, verify layout. Modify the `.canopi` file externally, verify app detects change. Run `xdg-open test.canopi`, verify Canopi launches.

---

### 5.2 — lib-swift (macOS)

**Prerequisites**: Phase 5.0 CI + beta testers on macOS available.

**FFI**: `swift-bridge` — generates Rust ↔ Swift bindings. Swift source files in `lib-swift/Sources/`, compiled by the `build.rs` script via `swiftc`. Only compiled on `target_os = "macos"`.

**Sub-phases**:
- **5.2a**: swift-bridge scaffold — `build.rs` that compiles Swift sources, Rust bridge module that exposes `Platform` trait implementation. CI must pass: Swift compiles, trait methods link. Context7 for swift-bridge API
- **5.2b**: Core Graphics rendering — `CGContext` from pixel data, export PNG at configurable DPI. Metal acceleration for large canvases (>4000px). Replaces Konva `toDataURL` path on macOS
- **5.2c**: PDFKit PDF export — native PDF with proper typography (San Francisco font), vector graphics, print-ready output matching the `PrintLayout` contract from 5.1
- **5.2d**: FSEvents file watching — native file system events, more efficient than polling. Same `design-file-changed` event contract
- **5.2e**: OS integration — Spotlight indexing (`.canopi` file metadata searchable), Quick Look preview generator (thumbnail of the design), `.canopi` UTI registration for Finder

**Validation**: CI compilation on macOS runner. Beta testers verify: PNG export quality, PDF opens in Preview.app, Spotlight finds designs, Quick Look shows preview in Finder. Feedback loop: testers file issues → we fix on Linux → CI validates → testers retest.

---

### 5.3 — lib-cpp (Windows)

**Prerequisites**: Phase 5.0 CI + beta testers on Windows available.

**FFI**: `cxx` — generates Rust ↔ C++ bindings. C++ source files in `lib-cpp/cpp/`, compiled by `build.rs` via MSVC (CI) or MinGW (cross-compile). Only compiled on `target_os = "windows"`.

**Sub-phases**:
- **5.3a**: cxx scaffold — `build.rs` that compiles C++ sources with MSVC on Windows, bridge module exposing `Platform` trait. CI must pass on Windows runner. Context7 for cxx API
- **5.3b**: Direct2D rendering — `ID2D1RenderTarget` from pixel data, export PNG via WIC (Windows Imaging Component) at configurable DPI. GPU-accelerated for large canvases
- **5.3c**: Native PDF export — DirectWrite text rendering + Direct2D graphics into XPS or PDF. Same `PrintLayout` contract
- **5.3d**: ReadDirectoryChanges file watching — native Windows file system notifications. Same `design-file-changed` event contract
- **5.3e**: OS integration — Shell thumbnail handler (design preview in Explorer), jump list integration (recent files), taskbar progress bar (for long exports or tile downloads), `.canopi` file association

**Validation**: CI compilation on Windows runner. Beta testers verify: PNG export, PDF opens in default viewer, Explorer shows thumbnails, jump list shows recent files. Same feedback loop as 5.2.

---

### 5.4 — Pen/Stylus Input

**Prerequisites**: 5.2 and 5.3 complete. Beta testers with Apple Pencil (iPad+Sidecar or MacBook trackpad) and/or Windows Ink devices.

**Why**: Pressure-sensitive drawing enables natural freeform zone sketching — a permaculture designer tracing terrain contours or drawing guild boundaries.

**Design**:
- Pressure maps to stroke width (light touch = thin, hard press = thick)
- Tilt maps to stroke angle (for natural calligraphic feel)
- Works with the existing Freeform tool (currently disabled, code on disk)
- Falls back gracefully to mouse input when no stylus detected

**Sub-phases**:
- **5.4a**: lib-swift: Apple Pencil event handling — pressure, tilt, azimuth. Expose as Tauri events. Requires macOS beta testers with compatible hardware
- **5.4b**: lib-cpp: Windows Ink event handling — `IPointerPointProperties` for pressure/tilt. Same event contract
- **5.4c**: Frontend: map pressure/tilt events to Konva line stroke width. Re-enable Freeform tool with stylus support. Smooth stroke rendering with variable width

**Validation**: Exclusively beta tester driven — no way to test stylus input without the hardware. Testers verify: pressure sensitivity works, strokes feel natural, no lag.

---

## Phase 6: Bottom Panel — Timeline & Budget

Goal: Expandable bottom panel with productivity tabs that connect canvas objects to time and cost planning.

**Layout**: Bottom panel slides up from the canvas bottom edge. Collapsed by default (thin grab bar). Drag to resize. Tabs along the top: Timeline, Budget. Same field notebook styling as right panel.

### 6.0 — Bottom Panel Shell

**Why**: Infrastructure for the tabs. The bottom panel was in the original UI (pruned during overhaul). Reactivate with the new design system.

**Sub-phases**:
- **6.0a**: Bottom panel component — collapsible, resizable via drag handle, tab bar. Persists open/closed state and height in user settings. Doesn't interfere with canvas pointer events when collapsed
- **6.0b**: Wire into app layout. Canvas viewport adjusts when panel opens (canvas area shrinks, no overlap). Keyboard shortcut to toggle

**Verification gate**: Toggle bottom panel open/closed. Resize by dragging. `webview_screenshot` in both states. Verify canvas shapes don't jump or clip.

---

### 6.1 — Timeline Tab (Gantt Chart)

**Why**: Permaculture design is temporal — plants have sowing windows, growth stages, harvest periods. A timeline connects the spatial design on the canvas to the temporal plan.

**Design**: Professional-grade interactive Gantt chart. Must feel like a real Gantt tool, not a CRUD table.
- **Rows**: One row per plant species on the canvas (auto-populated from canvas objects, grouped by species)
- **Columns**: Time axis — months or weeks, scrollable
- **Bars**: Drag to set start/end dates for actions (sow, transplant, prune, harvest). Color-coded by action type
- **Interactions**: Click bar to expand details, drag bar to move in time, drag bar edges to resize duration, right-click for action menu
- **Data source**: `sowing_period`, `harvest_period`, `bloom_period`, `fruit_seed_period_begin/end` from the plant DB pre-populate suggested timelines. User adjusts for their local conditions
- **Persistence**: Timeline data stored in the `.canopi` file's `timeline` section (already in document schema)

**Sub-phases**:
- **6.1a**: Timeline data model — action types (sow, transplant, prune, harvest, custom), per-species action bars with start/end dates. Rust backend: CRUD IPC for timeline entries. Wire to document save/load (timeline section already exists in `.canopi` schema)
- **6.1b**: Gantt rendering — Konva-based or HTML canvas in the bottom panel. Time axis with month/week grid. Species rows auto-populated from canvas. Bars positioned by date, colored by action type
- **6.1c**: Gantt interactions — drag bar to move, drag edges to resize, click to expand details, right-click menu (edit, delete, duplicate). Undo/redo integration
- **6.1d**: Pre-population — when a plant is added to canvas, suggest timeline bars from its DB fields (sowing_period, harvest_period). User can accept, adjust, or dismiss suggestions
- **6.1e**: Polish — smooth scrolling, zoom on time axis (year/month/week views), today marker, print-friendly layout for PDF export (Phase 5 integration)

**Verification gate**: Add 5 different plants to canvas. Open Timeline tab — all species appear as rows. Drag to create a "sow" bar for one species. Resize it. Save, reload — bar persists. `webview_screenshot` of the Gantt at month and week zoom levels.

---

### 6.2 — Budget Tab

**Why**: Planning a food forest or farm has real costs. Knowing "I need 12 apple trees at $25 each" helps scope the project. The canvas already knows how many of each plant are placed.

**Design**: Auto-generated table from canvas contents.
- **Rows**: One row per species on the canvas (auto-populated, grouped)
- **Columns**: Species name, quantity (auto-counted from canvas), unit price (user-editable), subtotal (computed)
- **Footer**: Grand total
- **Unit price persistence**: Prices stored per-design in the `.canopi` file's `budget` section. Prices can also be saved as defaults in user DB (so you don't re-enter for common plants)
- **Export**: CSV download of the budget table

**Sub-phases**:
- **6.2a**: Budget data model — per-species unit price, stored in `.canopi` budget section. Rust backend: IPC to get plant counts from the current document (group canvas plants by species_id, count). IPC to get/set unit prices
- **6.2b**: Budget table component — auto-populated rows with species name (translated), quantity (live from canvas), editable price field, computed subtotal. Grand total footer. Styled with field notebook tokens
- **6.2c**: Live updates — when plants are added/removed on canvas, budget quantities update in real time (via signal). CSV export button

**Verification gate**: Place 3 apple trees and 5 comfrey plants on canvas. Open Budget tab — see "Malus domestica: 3" and "Symphytum officinale: 5". Enter prices. Verify subtotals and total compute correctly. Add another apple tree on canvas — quantity updates to 4 live. Save, reload — prices persist.

---

## Phase 7: World Map & Community

Goal: A discovery surface where users explore featured designs from around the world and use them as templates.

**Why**: "See what others built" is the fastest way to onboard new users. A world map of food forests, permaculture gardens, and farm designs provides both inspiration and practical starting points.

### Architecture

- **Frontend**: MapLibre world map (reuses Phase 4 infrastructure) with design markers. Click a marker → preview card with screenshot, description, climate zone, plant count
- **Backend**: Curated design repository — initially a git repo or static JSON + `.canopi` files hosted on a CDN. No user accounts or uploads for v1
- **Template import**: Download a `.canopi` file, open as a new design. Optionally adapt plant selections to local hardiness zone (flag incompatible plants, suggest alternatives)
- **Content curation**: Maintained by the team, updated based on user feedback

### Sub-phases

**7.0 — Featured Designs Repository**
- Define the template format: `.canopi` file + metadata (title, description, author, location, screenshot, tags, climate zone)
- Host as a git repo or static API. Start with 10-20 curated designs covering different climates, scales (balcony, garden, farm), and styles (food forest, syntropic rows, herb spiral)
- Rust backend: IPC to fetch the design catalog (JSON index), download individual `.canopi` files

**7.1 — World Map Discovery UI**
- MapLibre map showing design markers at their locations. Cluster markers when zoomed out
- Click marker → preview card (screenshot, title, description, plant count, climate zone)
- "Use as template" button → downloads `.canopi` file, opens as new untitled design
- Filter by: climate zone, design style, scale

**7.2 — Template Adaptation**
- On import, compare template's plant hardiness zones against the user's design location
- Flag incompatible plants (too cold/hot for the user's zone)
- Suggest replacements from the plant DB with similar characteristics but compatible hardiness
- User can accept suggestions or keep originals

**7.3 — Knowledge Section**
- Curated agroecology content in the Learning panel (right panel bar, book icon — currently placeholder)
- Content categories: design principles, companion planting guides, soil building, water management, succession planting
- Content format: Markdown articles rendered in-app, curated and updated by the team based on user feedback
- Searchable, tagged by topic
- Future: link knowledge articles to relevant plants in the DB ("learn more about nitrogen fixation" from a nitrogen-fixing plant's detail card)

---

## Phase 8+: Future Features (unordered, to be prioritized)

These features are built on the Phase 3-7 foundation.

### Canvas Tools
- Ellipse + Polygon zone tools
- Alignment + distribution
- Group/ungroup
- Guides + snap-to-guides
- Arrow + callout annotations
- Dimension + measure tools
- Pattern fill
- Minimap
- Celestial dial (sun path visualization)

### Ecological Intelligence
- Companion planting compatibility scoring (using species_relationships + Ellenberg values)
- Syntropic strata-succession matrix (consortium builder — canvas plants organized by strata x succession stage)
- Growth timeline slider (Year 0 to Mature — requires growth-rate interpolation data)
- Shadow projection (solar position + per-plant ray-casting)

### Geo Features (requires Phase 4 foundation)
- Soil type overlay
- Climate zone overlay
- Parcel boundary import
- Elevation/slope analysis tools

### Data & Export (requires Phase 5 native libs for quality export)
- GeoJSON export
- High-DPI PNG/SVG export via native rendering
- PDF report generation (print layout with title block, legend, scale bar, plant schedule)
- Plant list export (CSV with all characteristics)

### Panel & UI
- Plant collections (saved filter presets / plant lists)
- Plant comparison (side-by-side detail cards)
- Layer panel (named layer management)

### Code Quality Debt
- Move `STRATUM_I18N_KEY` from `canvas/plants.ts` to a shared constants module (`types/species.ts` or `constants/species.ts`) — PlantRow imports from the canvas layer purely for a data constant, creating a layer inversion
- Extract shared dropdown component from `DisplayModeControls.tsx` and `TitleBar.tsx` `LocalePicker` — both implement the same ~20-line click-outside/Escape/aria pattern independently. Also fix `LocalePicker` to use `pointerup` (currently uses `mousedown`, violating CLAUDE.md convention)
- Cache stacked plant badges in `updatePlantsLOD` instead of destroy/recreate on every zoom event — toggle visibility and update text when count changes, skip the destroy pass when no badges exist

---

## Completed Phases (archived)

| Phase | What | When | Archive |
|-------|------|------|---------|
| 0 | Scaffold (Tauri + Preact shell) | 2026-03-23 | `docs/archive/phase-0-scaffold.md` |
| 1 | Plant Database (175K species, FTS5) | 2026-03-23 | `docs/archive/phase-1-plant-database.md` |
| 2 | Design Canvas (Konva, zones, plants, undo/redo) | 2026-03-24 | `docs/archive/phase-2-design-canvas.md` |
| 2.1 | Document Integrity (save/load, autosave, dirty tracking) | 2026-03-24 | `docs/archive/phase-2.1-document-integrity.md` |
| UI | Overhaul (feature pruning, field notebook design system) | 2026-03-25-26 | `docs/archive/ui-overhaul-next-steps.md` |
