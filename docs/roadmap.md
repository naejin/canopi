# Canopi Roadmap

**Last updated**: 2026-03-26
**Current state**: Phases 0-2.1 complete (scaffold, plant DB, canvas, document integrity, UI overhaul). No code shipped for Phase 3+.

---

## Principles

These are non-negotiable. Every implementation decision must pass through them.

1. **Claude Code is the builder, humans review.** We move fast because the implementer is tireless and precise. But speed without validation is reckless. Every sub-phase ends with Tauri MCP verification — not "hope tsc passes."

2. **No technical debt.** No hacks, no drift, no "we'll fix it later." If the architecture doesn't support a feature cleanly, fix the architecture first. Invariants are enforced, not documented and ignored. Every module has a clear contract.

3. **Validate with the real app.** Max 3 sub-phases between `cargo tauri dev` + Tauri MCP verification runs. Screenshots, interaction tests, IPC monitoring. Static analysis catches syntax; only live testing catches behavior.

4. **Product sense before code.** Before implementing, describe the user workflow step by step. If it involves typing IDs, CRUD forms disconnected from context, or browser dialogs — redesign first. Research how professional tools solve the problem.

5. **UX is the product.** Every interaction must feel polished to Figma/Sketch level. 60fps canvas, smooth transitions, hover states, empty state guidance. Performance budget: all interactions <16ms, zoom/pan never below 30fps with 200+ plants.

6. **The data is the differentiator.** 175K species with 170 columns of ecological, morphological, and agronomic data — translated into 6 languages. No other garden design tool has this. Every feature should leverage the data richness.

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

## What's Built (Phases 0-2.1)

- Tauri v2 + Preact shell with custom title bar, frameless window
- 175K-species plant DB with FTS5 full-text search
- Plant search panel with compact rows, virtual scrolling
- Plant detail card (basic: dimensions, tolerances, uses, ecology, related species)
- Filter drawer (8 filters: hardiness, sun, growth rate, life cycle, stratum, soil type, nitrogen fixer, edible)
- Konva.js canvas with 4 MVP tools (Select, Hand, Rectangle, Text)
- 7 named layers, plant drag-and-drop, zone drawing
- Undo/redo (500-cap command pattern), grid + rulers, scale bar
- Multi-select + Transformer
- `.canopi` save/load with full document integrity, autosave
- Dark/light theme, 6-language i18n
- Field notebook design system (`.interface-design/system.md`)
- Welcome screen, zoom controls, panel bar

---

## Phase 3: Data & Polish (MVP)

Goal: Make the plant database genuinely useful for design decisions, fix visual bugs, and ship a complete vertical slice.

### 3.0 — Data Contract Sync

**Why first**: prepare-db.py, Rust backend, and frontend all reference columns that no longer exist in canopi-data. Nothing works until this is fixed.

**Breaking changes in canopi-data export (2026-03-24)**:
- `life_cycle` (string) removed. Replaced by `is_annual`, `is_biennial`, `is_perennial` (booleans)
- `nitrogen_fixation` (string) removed. Replaced by `nitrogen_fixer` (integer/boolean)
- Species table grew from ~50 to 170 columns
- New tables: `ellenberg_inferences` (skip — ML values not reliable enough), `species_external_links`, `species_text_translations`
- Succession stages changed: `pioneer`/`secondary`/`climax` became `placenta_i`/`placenta_ii`/`placenta_iii`/`secondary_i`/`secondary_ii`/`secondary_iii`/`climax`

**Schema contract (Option A)**:
- Create `scripts/schema-contract.json` — defines the column mapping between canopi-data exports and canopi-core.db
- `prepare-db.py` reads from the contract, not hardcoded column lists
- Contract includes a `schema_version` field. The Rust backend checks the DB's schema version at startup and handles version N and N-1 gracefully
- Unknown columns in the export are ignored (forward-compatible). Missing expected columns log a warning and use NULL defaults (backward-compatible)

**Sub-phases**:
- **3.0a**: Schema contract file + prepare-db.py rewrite to consume it
- **3.0b**: Rust backend: adapt `plant_db.rs` and `query_builder.rs` for new column names (`nitrogen_fixer`, `is_annual`/`is_biennial`/`is_perennial`, new succession values). Add schema version check at DB open
- **3.0c**: Frontend types: update `types/species.ts`, `state/plant-db.ts`, display-modes references. Run new prepare-db.py and verify app launches

**Verification gate**: `cargo tauri dev` + `ipc_execute_command` to run species queries and confirm results match expected data.

---

### 3.1 — Plant Characteristics (Detail Card)

**Why**: The detail card currently shows ~15 fields. The export has 170 columns. A permaculture designer choosing plants needs growth form, propagation methods, fruit/seed info, leaf traits, ecological indicators, hazards, cultivation notes, and more.

**Approach**: Expand the detail card with collapsible sections. All categorical values displayed using the `translated_values` table for the user's locale.

**Sections**:
| Section | Fields |
|---------|--------|
| Identity | canonical_name, common_name (best for locale), family, genus, is_hybrid |
| Dimensions | height_min/max_m, width_max_m, hardiness_zone_min/max, growth_rate |
| Life cycle | is_annual, is_biennial, is_perennial, lifespan, deciduous_evergreen, leaf_retention |
| Light & climate | tolerates_full_sun/semi_shade/full_shade, frost_tender, drought_tolerance, ellenberg_light (observed only) |
| Soil | soil_ph_min/max, well_drained, heavy_clay, tolerates_acid/alkaline/saline, fertility_requirement, moisture_use, anaerobic_tolerance |
| Growth form | habit, growth_form_type, growth_form_shape, growth_habit, woody, canopy_position |
| Ecology | stratum, succession_stage, nitrogen_fixer, mycorrhizal_type, grime_strategy, raunkiaer_life_form, cn_ratio, allelopathic |
| Uses & ratings | edibility_rating, medicinal_rating, other_uses_rating, edible_uses, medicinal_uses, other_uses, scented, attracts_wildlife |
| Propagation | propagated_by_seed/cuttings/bare_root/container/sprigs/bulb/sod/tubers/corm, cold_stratification_required, vegetative_spread_rate, seed_spread_rate, sowing_period, harvest_period |
| Fruit & seed | fruit_type, fruit_seed_color, fruit_seed_period_begin/end, fruit_seed_abundance, fruit_seed_persistence, seed_mass_mg, seed_dispersal_mechanism, seed_storage_behaviour, seed_dormancy_type |
| Leaf | leaf_type, leaf_compoundness, leaf_shape, sla_mm2_mg |
| Reproduction | pollination_syndrome, sexual_system, mating_system, self_fertile, reproductive_type |
| Risk | toxicity, known_hazards, invasive_potential, noxious_status, invasive_usda, weed_potential, fire_resistant, fire_tolerance |
| Text | summary, cultivation_notes, propagation_notes, habitats, native_range, conservation_status |
| Related species | (existing — species_relationships) |
| External links | species_external_links (when available) |

**Sub-phases**:
- **3.1a**: Rust backend: expand `SpeciesDetail` struct to include all new fields. Update `get_species_detail` query. Add `translated_values` lookup — load table into a HashMap at startup, apply translations based on locale in response
- **3.1b**: Frontend types + detail card UI: update `types/species.ts`, build collapsible section components, style with field notebook tokens. Sections collapsed by default, expand on click. Empty/null fields hidden
- **3.1c**: i18n: add section header keys and field label keys to all 6 locale files

**Verification gate**: `webview_screenshot` of detail card for Malus domestica. Verify all sections render, translations work when switching language, empty fields don't show.

---

### 3.2 — Filter UI Redesign

**Why**: Current filter drawer has 8 dropdown buttons. The new schema has 60+ filterable variables. Need Option C hybrid: always-visible essentials + "More filters" picker.

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

### 3.3 — Translated Values

**Why**: 6-language support is a differentiator. The `translated_values` table has 245 translated values across 43 categorical fields in all 6 languages. Common names have coverage from 62K (zh) to 211K (en).

**Approach**: This is partially delivered in 3.1a (detail card translations) and 3.2a (filter value translations). This sub-phase ensures complete coverage:

- **3.3a**: Plant list rows: show best common name for current locale (using `best_common_names` table). Show translated categorical tags (stratum, growth_rate, etc.)
- **3.3b**: Filter value labels: all dropdown/chip values show translated strings. "More filters" field names translated via i18n keys
- **3.3c**: Audit: switch through all 6 languages, screenshot each. Verify no untranslated categorical values leak through

**Verification gate**: `webview_screenshot` in each of the 6 languages. Use `webview_execute_js` to switch locale programmatically and compare.

---

### 3.4 — Plant Density Fix

**Why**: Dense plantings (guilds, ground cover rows, stacked plants) produce unreadable label overlap. Labels must be earned, not default.

**Design**:
- Default view: colored dot only, no labels — clean at any density
- Hover tooltip: common name, scientific name, key attributes on mouseover
- Zoom threshold: labels fade in when nearest-neighbor distance > ~40px screen space
- Selected plant: always shows label regardless of density
- Stacked plants: count badge on the dot, hover shows plant list

**Sub-phases**:
- **3.4a**: Remove default labels from plant creation. Add hover tooltip (HTML overlay positioned at plant coordinates, not Konva text)
- **3.4b**: LOD label system — on zoom/pan, compute nearest-neighbor distances. Show labels only where space permits. Use spatial index for performance
- **3.4c**: Stacked plant detection + count badge. Selection always shows label

**Verification gate**: Place 20+ plants in a tight cluster. `webview_screenshot` at different zoom levels. Verify clean dots at overview, labels appearing as you zoom in. Test hover tooltip.

---

### 3.5 — Dark Mode Canvas Fix

**Why**: Konva shapes use hardcoded colors at creation time. Theme switch doesn't update them. Plant labels, zone labels, and scale bar are invisible/faint in dark mode.

**Approach**: Canvas-wide color refresh function that walks all text nodes and updates `fill` from computed CSS variables on theme toggle. Register as an effect on the theme signal.

**Sub-phases**:
- **3.5a**: Build `refreshCanvasTheme()` function in engine. Walk all Konva text nodes (plant labels, zone labels, text annotations) and update `fill` from `getComputedStyle` CSS variables. Wire to theme signal via `effect()`
- **3.5b**: Fix scale bar initial paint, ruler corner on fresh launch. Verify grid line colors in both themes

**Verification gate**: Toggle theme via `webview_interact` (click Theme button). `webview_screenshot` in both modes. Verify all text is readable, scale bar visible, grid lines appropriate contrast.

---

### 3.5.5 — Plant Photos

**Why**: A plant photo is the single highest-value element in the detail card. 50% of species have image URLs in canopi-data. Showing a photo (or slideshow for multiple) dramatically improves plant identification and card usefulness.

**Prerequisite**: canopi-data ships a `species_images` table (replaces the messy `image_urls` JSON column):
```
species_images (
  id TEXT PRIMARY KEY,
  species_id TEXT REFERENCES species(id),
  url TEXT NOT NULL,           -- direct HTTPS image URL (no relative paths, no placeholders)
  source TEXT,                 -- "pfaf", "floristic", "cloudfront"
  license TEXT,                -- "cc-by-sa", "unknown", etc.
  attribution TEXT,            -- photographer/source credit
  sort_order INTEGER DEFAULT 0
)
```

**Design**:
- Detail card header: photo area above the botanical name. Placeholder silhouette when no image or offline
- Multiple images: horizontal dot indicators, swipe/click to browse
- Attribution: small text overlay on photo (source + license)
- Offline: Rust backend fetches and caches images in app data dir (`~/.local/share/canopi/image-cache/`). Serve cached images via Tauri asset protocol. Cache eviction: LRU, max 500MB
- Privacy: all image fetches go through Rust (no direct browser requests to external CDNs)
- Licensing filter: only display images with known permissive licenses by default. Setting to show all

**Sub-phases**:
- **3.5.5a**: Schema contract + prepare-db.py: add `species_images` to supporting tables. Rust backend: `SpeciesImage` struct, IPC command `get_species_images(canonical_name)` returning `Vec<SpeciesImage>`. Frontend type
- **3.5.5b**: Rust image cache: fetch URL → save to app data dir → serve via `asset:` protocol or localhost. Cache lookup before fetch. Background fetch (don't block detail card render)
- **3.5.5c**: Frontend: photo component in detail card header. Placeholder → fade-in on load. Dot indicators for multiple images. Click to cycle. Attribution overlay
- **3.5.5d**: Offline mode: serve from cache when no network. Cache warming: on first detail view, fetch all images for that species. Eviction policy

**Verification gate**: Open detail card for Malus domestica — photo loads from cache after first fetch. Disconnect network — cached photo still shows. Species with no images shows placeholder. Switch between multiple images. Attribution visible.

---

### 3.6 — Display Modes (Color by Value, Size by Value)

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

**Why**: canopi-data evolves faster than the app. Column renames broke the pipeline. This must not happen again.

**Approach** (Option A — schema contract):
- `scripts/schema-contract.json` (created in 3.0a) becomes the authoritative mapping
- `prepare-db.py` validates the export against the contract: warns on missing columns, ignores unknown columns, fails on schema_version mismatch
- Rust backend: `PlantDb::open()` reads `schema_version` from the DB. If it encounters version N+1 (newer than expected), it operates in degraded mode for unknown fields rather than crashing
- Document the contract in a short `scripts/SCHEMA.md` so canopi-data contributors know what Canopi expects

**Sub-phases**:
- **3.8a**: Harden prepare-db.py with validation, graceful degradation for missing columns, clear error messages
- **3.8b**: Rust backend: schema version check in `PlantDb::open()`, degraded-mode handling for unknown schema versions
- **3.8c**: Write `scripts/SCHEMA.md` documenting the contract

**Verification gate**: Run prepare-db.py against the current export — should succeed. Simulate a future export with an extra column — should succeed with warning. Simulate missing column — should succeed with NULL default and warning.

---

### 3.9 — Favorites Panel

**Why**: A permaculture designer has 20-30 go-to plants they use across every design. Searching 175K species each time is wasteful. The star button already exists on plant rows but there's no dedicated view to access starred plants quickly.

**Design**: A third tab in the right panel bar (alongside Plant Database and Learning). Shows only favorited plants in a compact list. Drag-to-canvas works the same as from the search panel. Favorites persist in the user DB across sessions.

**Sub-phases**:
- **3.9a**: Rust backend: `favorites` table in user DB (species_id, added_at). IPC commands: `add_favorite`, `remove_favorite`, `get_favorites`. Return full species data for each favorite so the list is self-contained
- **3.9b**: Frontend: Favorites panel component in PanelBar. Same compact row format as plant search. Star button toggles filled/unfilled. Drag-to-canvas support. Empty state: "Star plants from the search panel to add them here"
- **3.9c**: Wire existing star buttons in PlantRow and PlantDetailCard to the favorites IPC. Visual feedback on toggle (filled star = favorited)

**Verification gate**: Star 5 plants from search. Switch to Favorites tab — all 5 appear. Drag one to canvas — plant appears. Unstar one — disappears from favorites. Restart app — favorites persist.

---

### 3.10 — Copy-Paste (Ctrl+C/V/D)

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

### MVP Completion Checklist

All of Phase 3 (3.0 through 3.10) constitutes the MVP. After completion:

- [ ] End-to-end flow: Launch, welcome screen, New Design, search plants, apply filters (visible + "More"), drag plants to canvas, draw zones, display modes (color/size by value), save, reopen
- [ ] All 6 languages: translated categorical values, common names, UI strings
- [ ] Both themes: light and dark mode fully functional including canvas elements
- [ ] Plant density: clean dots at overview, labels on zoom, hover tooltips, stacked badges
- [ ] Detail card: all 170 columns organized in collapsible sections
- [ ] Favorites: star plants, access from dedicated panel, drag to canvas
- [ ] Copy-paste: Ctrl+C/V/D for all canvas objects with undo/redo
- [ ] Dirty indicator: visible in title bar, prompt on close with unsaved changes
- [ ] DB resilience: schema contract validated, forward/backward compatible

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

---

## Completed Phases (archived)

| Phase | What | When | Archive |
|-------|------|------|---------|
| 0 | Scaffold (Tauri + Preact shell) | 2026-03-23 | `docs/archive/phase-0-scaffold.md` |
| 1 | Plant Database (175K species, FTS5) | 2026-03-23 | `docs/archive/phase-1-plant-database.md` |
| 2 | Design Canvas (Konva, zones, plants, undo/redo) | 2026-03-24 | `docs/archive/phase-2-design-canvas.md` |
| 2.1 | Document Integrity (save/load, autosave, dirty tracking) | 2026-03-24 | `docs/archive/phase-2.1-document-integrity.md` |
| UI | Overhaul (feature pruning, field notebook design system) | 2026-03-25-26 | `docs/archive/ui-overhaul-next-steps.md` |
