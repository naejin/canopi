# Canopi Roadmap

**Last updated**: 2026-03-28
**Current state**: MVP complete (Phases 0–3). Next: Tauri MCP live verification, then Phase 4 (terrain & location).

---

## Principles

Non-negotiable. Every implementation decision must pass through them.

1. **Claude Code is the builder, humans review.** Speed without validation is reckless. Every sub-phase ends with Tauri MCP verification — not "hope tsc passes."
2. **No technical debt.** No hacks, no drift, no "we'll fix it later." If the architecture doesn't support a feature cleanly, fix the architecture first.
3. **Validate with the real app.** Max 3 sub-phases between `cargo tauri dev` + Tauri MCP verification. Screenshots, interaction tests, IPC monitoring.
4. **Product sense before code.** Describe the user workflow step by step. If it involves typing IDs, CRUD forms disconnected from context, or browser dialogs — redesign first.
5. **UX is the product.** 60fps canvas, smooth transitions, hover states, empty state guidance. Performance budget: all interactions <16ms, zoom/pan ≥30fps with 200+ plants.
6. **The data is the differentiator.** 175K species, 173 columns, 11 languages. Every feature should leverage the data richness.

---

## Execution Patterns

Lessons from Phases 0–3 that shape how future phases are planned and executed.

### What worked

| Pattern | Why it works | Example |
|---------|-------------|---------|
| **Micro-phases** (1–3 sub-phases, single concern) | Fits in one session, verifiable, easy to course-correct | Phase 3.4 (plant density) vs. original 14-sub-phase Phase 3 plan that was scrapped |
| **"What already exists" audit before planning** | Prevents building things that are already built. Discovered copy-paste, favorites backend, display mode rendering pre-existing | Phase 3.10 was marked complete without writing code |
| **Single mutation point per concern** | Eliminates merge conflicts, makes blast radius obvious | `patchFilters()` in `state/plant-db.ts` for all filter state |
| **Batch i18n keys in one early sub-phase** | Prevents 11-file merge conflicts across parallel agents | Phase 3.2 i18n done upfront before filter components |
| **File ownership matrix for parallel agents** | One writer per file at any time. Eliminates merge conflicts | Learned during Phase 3 multi-agent work |
| **Deferred scope with readiness gates** | Ambitious backlog without ambiguous active scope | See `docs/archive/deferred-scope-guidance-for-agentic-implementation-2026-03-25.md` |
| **`/simplify` after implementation** | Converges in ~3 rounds: R1 structural, R2 duplication exposed by R1, R3 confirms | Applied after every major phase |

### What failed

| Anti-pattern | Why it fails | What to do instead |
|-------------|-------------|-------------------|
| **Mega-phases with 10+ sub-phases** | Scope drift, stale context, impossible to verify incrementally | Break into 1–3 sub-phase micro-phases with independent verification |
| **Planning without exploring the codebase first** | Designs features that already exist, misunderstands current architecture | Run radar + xray + ripple before writing any plan |
| **Mixing "implement now" and "maybe implement if easy"** | Agentic scope creep — the agent builds the "maybe" too | Three clean sections: active scope, deferred scope, readiness gates |
| **Parallel agents editing the same file** | Merge conflicts, lost work | File ownership matrix in the plan |
| **Relying on `tsc` alone for UI verification** | Catches types, misses visual bugs, dark mode breaks, layout shifts | Tauri MCP screenshot + interact after every UI sub-phase |
| **i18n keys added file-by-file as components are built** | 11 files × N parallel agents = merge hell | Batch all i18n keys in a dedicated early sub-phase |
| **Deciding UI control types during implementation** | Builds multiple alternatives, wastes time | Decide control types (chips vs. dropdown vs. slider) in the plan |

### Complexity sizing

Every sub-phase gets a T-shirt size to help session planning:

| Size | Scope | Typical session count |
|------|-------|----------------------|
| **S** | Single file change, config, or toggle | 1 short session |
| **M** | One new component or backend command, <5 files touched | 1 session |
| **L** | New feature crossing Rust + frontend + i18n, 5–15 files | 1–2 sessions |
| **XL** | New subsystem (map layer, timeline, new panel), >15 files, new dependencies | 2–3 sessions, plan review recommended |

---

## Phase Planning Template

Every new phase plan must include these sections before execution begins. This is the pre-flight checklist.

### 1. Codebase audit
- [ ] Run `radar` for structural overview
- [ ] Run `xray` on files that will be modified
- [ ] Run `ripple` on files that will be modified (blast radius)
- [ ] Search for existing implementations of the planned feature
- [ ] List what already exists vs. what needs to be built

### 2. Scope definition
- [ ] **Active scope**: numbered sub-phases, each with acceptance criteria
- [ ] **Deferred scope**: features NOT being built, with readiness gates
- [ ] **File ownership matrix** (if parallel agents planned): one writer per file

### 3. Per sub-phase
- [ ] Size (S/M/L/XL)
- [ ] Files to create or modify (explicit list)
- [ ] Dependencies on other sub-phases
- [ ] i18n keys needed (batched in one early sub-phase if >5 keys)
- [ ] UI control types decided (not "TBD" — chips, dropdown, slider, toggle, etc.)
- [ ] Verification gate (what to screenshot, what to `ipc_execute_command`, what to interact with)

### 4. Pre-existing code check
- [ ] Does any disabled/pruned code already implement this? (check `docs/roadmap.md` MVP pruning list)
- [ ] Are there IPC commands already defined for this feature?
- [ ] Are there signals/state already defined?
- [ ] Are there CSS tokens already defined?

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

## What's Built (Phases 0–7)

- Tauri v2 + Preact shell with custom title bar, frameless window
- 175K-species plant DB with FTS5 full-text search (5 weighted columns, BM25 ranking), 173 contracted columns (schema v8)
- Plant search panel with compact rows, virtual scrolling, multiple common names
- Plant detail card (19 collapsible sections, ~170 fields, plant photo carousel)
- Filter system: always-visible FilterStrip (6 controls) + MoreFiltersPanel (8 categories, 56 fields, dynamic `Vec<DynamicFilter>`)
- Konva.js canvas with 4 MVP tools (Select, Hand, Rectangle, Text)
- 7 named layers, plant drag-and-drop, zone drawing
- Undo/redo (500-cap command pattern), grid + rulers, scale bar
- Multi-select + Transformer, copy-paste (Ctrl+C/V/D)
- Plant density: LOD labels, hover tooltip, stacked badges, dense planting zoom
- Display modes: color by stratum/hardiness/life cycle/nitrogen/edibility, canopy spread sizing, floating legend
- `.canopi` save/load with full document integrity, autosave, dirty indicator
- Dark/light theme, 11-language i18n (en, fr, es, pt, it, zh, de, ja, ko, nl, ru)
- OS locale auto-detection on first launch
- Favorites panel with star toggle, drag-to-canvas, user DB persistence
- Rust image cache (500MB LRU, ureq HTTP, SHA256 filenames)
- Field notebook design system (`.interface-design/system.md`)
- Schema contract v4 (`scripts/schema-contract.json`) — 173 columns, 8 supporting tables

### MVP Phase 3 completion log

| Phase | What | Size | When |
|-------|------|------|------|
| 3.0 | Data contract sync (schema v5) | M | 2026-03-25 |
| 3.0b | Schema v7 sync (173 columns, 11 languages) | L | 2026-03-26 |
| 3.0c | Schema v8 sync (non-breaking bump) | S | 2026-03-27 |
| 3.1 | Plant detail card (19 sections, full field coverage) | L | 2026-03-27 |
| 3.2 | Filter UI redesign (FilterStrip + MoreFiltersPanel) | XL | 2026-03-28 |
| 3.3 | Search quality (FTS5 weighted columns, BM25, common names) | L | 2026-03-28 |
| 3.4 | Plant density (LOD labels, tooltip, stacked badges) | L | 2026-03-28 |
| 3.5 | Dark mode canvas fix | S | 2026-03-25 |
| 3.5.5 | Plant photos (carousel + Rust image cache) | L | 2026-03-28 |
| 3.6 | Display mode controls + floating legend | M | 2026-03-28 |
| 3.7 | Dirty indicator + file operations polish | S | (in 2.1) |
| 3.8 | DB upgrade robustness | S | (in 3.0b) |
| 3.9 | Favorites panel | M | 2026-03-28 |
| 3.10 | Copy-paste (pre-existing, discovered during audit) | S | 2026-03-28 |
| 3.11 | OS locale auto-detection | S | (in 3.0b) |

### Phase 4–7 completion log

| Phase | What | Size | When |
|-------|------|------|------|
| 4.0 | Location input + geocoding (Nominatim via ureq) | M | 2026-03-28 |
| 4.1 | MapLibre reactivation (viewport sync, opacity, styles, sidebar panel) | M | 2026-03-28 |
| 4.2 | PMTiles offline (Rust tile storage, download manager, MapLibre addProtocol) | L | 2026-03-28 |
| 4.3 | Terrain contours (maplibre-contour, DEM, adaptive interval) | M | 2026-03-28 |
| 4.4 | Hillshading (MapLibre hillshade layer, warm field notebook tones) | S | 2026-03-28 |
| 4.5 | Layer controls UI (map layer toggles, opacity sliders, settings persistence) | M | 2026-03-28 |
| 5.0 | CI enhancement (platform tests, Tauri CLI build, artifact upload) | S | 2026-03-28 |
| 5.1 | Platform trait + lib-c (Cairo PNG/PDF, inotify, XDG) | XL | 2026-03-28 |
| 5.2 | lib-swift macOS scaffold (stubs, CI-validated) | M | 2026-03-28 |
| 5.3 | lib-cpp Windows scaffold (stubs, CI-validated) | M | 2026-03-28 |
| 6.0 | Bottom panel shell (collapsible, resizable, tab bar, Ctrl+J) | M | 2026-03-28 |
| 6.1 | Timeline/Gantt (Canvas2D renderer, drag interactions, auto-populate) | XL | 2026-03-28 |
| 6.2 | Budget tab (auto-counted plant table, editable prices, CSV export) | L | 2026-03-28 |
| 7.0 | Featured designs repository (8 template catalog, HTTPS download) | M | 2026-03-28 |
| 7.1 | World Map discovery UI (MapLibre clustered markers, preview cards, template import) | L | 2026-03-28 |
| 7.2 | Template adaptation (hardiness comparison, replacement suggestions) | M | 2026-03-28 |
| 7.3 | Knowledge section (5 articles, markdown renderer, searchable Learning panel) | M | 2026-03-28 |
| Debt | Shared Dropdown, STRATUM_I18N_KEY extraction, badge caching | S | 2026-03-28 |

---

## Dependency Graph

```
Phase 3 (MVP) ✅
    ├── Phase 4 (Terrain & Location) ✅
    │       ├── Phase 7 (World Map) ✅
    │       └── Phase 8 Geo Features ← requires Phase 4 projection + tiles
    ├── Phase 5 (Native Platform) ✅ (stubs for macOS/Windows, full on Linux)
    │       ├── Phase 5.4 (Pen/Stylus) ← requires beta testers with hardware
    │       └── Phase 8 Export ← requires Phase 5 native rendering
    └── Phase 6 (Timeline & Budget) ✅
```

Next: Phase 5.4 (Pen/Stylus — needs beta testers), Phase 8+ (canvas tools, ecological intelligence, geo features, export).

---

## Phase 4: Terrain & Location

Goal: Geographic context — terrain contours, hillshading, base maps, location-aware features.

**Technology**: MapLibre GL JS (BSD-3-Clause). Offline via PMTiles. Integration scaffolded in codebase (disabled for MVP).

**Architecture**: MapLibre renders behind Konva stage via CSS z-index. Coordinate sync through local tangent plane projection.

### 4.0 — Location Input [L]

**Depends on**: nothing (first phase)
**Why**: Every geo feature depends on knowing where the design is.

**What already exists**: `location` field in `.canopi` document schema (empty, ready for coordinates). Document save/load already preserves location section.

**What to build**:
- Location modal: address search bar + MapLibre mini-map for visual confirmation
- Geocoding via Nominatim HTTP API (called from Rust via `ureq` to avoid CORS)
- `canvas/projection.ts`: local tangent plane math (`lngLatToMeters` / `metersToLngLat`)
- Wire location to document save/load, show in title bar or design properties

**Sub-phases**:
- **4.0a** [M]: Location modal component — address search + MapLibre mini-map. Geocoding via Rust IPC (Nominatim). Store lat/lng in design metadata
- **4.0b** [S]: Wire location to document save/load. Show location summary in UI. Allow changing (warn about geo-referenced feature shift)
- **4.0c** [M]: `canvas/projection.ts` — local tangent plane projection. Unit tests for accuracy at equator and 60°N

**i18n keys**: ~10 (modal title, placeholder text, confirm/cancel, location summary labels). Batch in 4.0a.

**Verification gate**: Set location via address search. `ipc_execute_command` to verify lat/lng stored. Save, reload, confirm persistence. Projection round-trip tests pass.

---

### 4.1 — MapLibre Integration [XL]

**Depends on**: 4.0 (needs projection math + location)
**Why**: Base map layer behind the canvas — satellite, topo, street context.

**What already exists**: `canvas/map-layer.ts` (disabled, code on disk). Lazy loading pattern scaffolded. `state/canvas.ts` has map-related signals.

**What to build**:
- Reactivate `map-layer.ts`, create MapLibre container div behind Konva stage
- Viewport sync: Konva pan/zoom → MapLibre center/zoom via projection
- Event routing: pointer events pass through to MapLibre when no Konva shape is hit
- Map toggle signal in `state/canvas.ts`
- Default basemap style (OpenFreeMap), map opacity control

**Sub-phases**:
- **4.1a** [L]: Reactivate map-layer.ts. MapLibre container + viewport sync. Map toggle
- **4.1b** [M]: Event routing layer. Pointer pass-through when no shape hit
- **4.1c** [M]: Style selection (OpenFreeMap default). Opacity control. Theme-safe rendering

**i18n keys**: ~5 (map toggle label, opacity label, style names). Batch in 4.1a.

**Verification gate**: Enable map, `webview_screenshot` — tiles behind shapes. Pan/zoom — map and canvas aligned. Place plant, verify no drift. Disable map — normal background returns.

---

### 4.2 — PMTiles Offline [L]

**Depends on**: 4.1 (needs MapLibre running)
**Why**: Desktop app used in rural areas. Tiles must work without internet.

**What already exists**: nothing (new subsystem).

**What to build**:
- Rust PMTiles reader: parse header, serve tiles by z/x/y via Tauri custom protocol
- Tile download manager: bounding box + zoom range → download PMTiles extract, show progress
- MapLibre config: register custom protocol as tile source, fallback to remote

**Sub-phases**:
- **4.2a** [L]: Rust PMTiles reader + Tauri custom protocol handler (`canopi-tiles://basemap/{z}/{x}/{y}.pbf`)
- **4.2b** [M]: Download manager UI — bounding box, zoom range, progress. Store in app data dir
- **4.2c** [S]: MapLibre tile source config. Offline/online fallback. Status indicator

**Verification gate**: Download tiles for test region. Disconnect network. `webview_screenshot` — map renders from local tiles.

---

### 4.3 — Terrain Contours [M]

**Depends on**: 4.1 (needs MapLibre + DEM tile source)
**Why**: Contour lines show slope, ridges, water flow — essential for swale placement, terrace planning.

**What already exists**: nothing.

**What to build**:
- `maplibre-contour` plugin: client-side contour generation from DEM raster tiles
- Adaptive interval (1m/2m/5m/10m based on zoom + relief)
- Major/minor contour styling with field notebook earthy tones
- Contour interval control

**Sub-phases**:
- **4.3a** [M]: `maplibre-contour` + DEM source. Render contour lines. Adaptive interval
- **4.3b** [S]: Styling — major/minor weights, elevation labels, field notebook palette
- **4.3c** [S]: Interval control in layer panel. Persist preference

**Verification gate**: Set location to hilly area. `webview_screenshot` — contour lines render. Zoom in — interval adapts. Toggle off — clean removal.

---

### 4.4 — Hillshading [S]

**Depends on**: 4.1 (same DEM source as contours)
**Why**: Immediate visual understanding of terrain relief without reading numbers.

**What to build**:
- MapLibre `hillshade` layer from DEM tiles
- Opacity control, theme-safe (light + dark)

**Sub-phases**:
- **4.4a** [S]: Hillshade layer + opacity control. Verify both themes

**Verification gate**: Enable hillshading. `webview_screenshot` — relief visible, shapes readable. Toggle theme — still readable.

---

### 4.5 — Layer Controls UI [M]

**Depends on**: 4.1–4.4 (needs layers to control)
**Why**: Independent toggle + opacity for basemap, satellite, contours, hillshading.

**What already exists**: nothing (layer panel was pruned during MVP).

**What to build**:
- Layer control component: toggle + opacity slider per layer
- Basemap style switcher (topo, satellite, street, none)
- Map toggle button in canvas toolbar or panel bar
- Persist layer preferences in user settings

**Sub-phases**:
- **4.5a** [M]: Layer control component. Wire to MapLibre. Persist preferences
- **4.5b** [S]: Basemap style switcher. Contour interval integrated. Map toggle button
- **4.5c** [S]: Polish — smooth transitions, keyboard shortcuts, graceful "Set location" message when no location

**i18n keys**: ~15 (layer names, style names, toggle labels, "set location" message). Batch in 4.5a.

**Verification gate**: Toggle each layer. `webview_screenshot` with combos. Opacities persist after restart. No-location graceful degradation.

---

## Phase 5: Native Platform Integration

Goal: Native OS capabilities for export quality, performance, and platform polish.

**Development constraint**: Linux only. macOS/Windows require CI + beta testers.

### Platform Trait

```rust
pub trait Platform {
    fn export_png(snapshot: &CanvasSnapshot, dpi: u32) -> Result<Vec<u8>, PlatformError>;
    fn export_pdf(document: &DesignDocument, layout: &PrintLayout) -> Result<Vec<u8>, PlatformError>;
    fn watch_file(path: &Path, callback: Box<dyn Fn(FileEvent)>) -> Result<WatchHandle, PlatformError>;
    fn generate_thumbnail(design: &DesignDocument, size: u32) -> Result<Vec<u8>, PlatformError>;
}
```

### 5.0 — CI Infrastructure [L] (prerequisite for 5.2+)

**Depends on**: nothing
**Why**: Cannot compile or test macOS/Windows code locally.

**What to build**:
- GitHub Actions: Linux + macOS + Windows build jobs
- Platform-specific test jobs (`cargo test -p lib-c`, etc.)
- Tauri build jobs producing distributable binaries

**Sub-phases**:
- **5.0a** [M]: `.github/workflows/build.yml` — 3-platform `cargo build` + `cargo test`
- **5.0b** [S]: Platform-specific test isolation
- **5.0c** [M]: Tauri build jobs (.deb/.AppImage, .dmg, .msi). Upload artifacts

**Verification gate**: Push change, all 3 platforms pass. Download artifacts for beta testers.

---

### 5.1 — Platform Trait + lib-c (Linux) [XL]

**Depends on**: 5.0

**What already exists**: `lib-c/` stub, `desktop/src/` Rust backend.

**What to build**:
- `Platform` trait + types in `common-types`
- lib-c: Cairo PNG export (72/150/300 DPI), Cairo PDF export (PrintLayout), inotify file watching
- OS integration: XDG desktop entry, MIME type for `.canopi`, DBus notifications

**Sub-phases**:
- **5.1a** [M]: Platform trait + types. No-op fallback for all platforms
- **5.1b** [L]: lib-c high-DPI PNG via Cairo
- **5.1c** [L]: lib-c PDF export via Cairo (title block, legend, scale bar, plant schedule)
- **5.1d** [M]: lib-c inotify file watching → `design-file-changed` event
- **5.1e** [M]: XDG + MIME + DBus integration

**Verification gate**: 300 DPI PNG export. PDF opens in viewer with correct layout. External `.canopi` edit detected. `xdg-open test.canopi` launches Canopi.

---

### 5.2 — lib-swift (macOS) [XL]

**Depends on**: 5.0 CI + 5.1 trait, beta testers on macOS
**FFI**: `swift-bridge`

**Sub-phases**:
- **5.2a** [M]: swift-bridge scaffold, CI compiles
- **5.2b** [L]: Core Graphics PNG (Metal acceleration for large canvases)
- **5.2c** [L]: PDFKit PDF export
- **5.2d** [M]: FSEvents file watching
- **5.2e** [M]: Spotlight + Quick Look + UTI registration

**Validation**: CI + beta testers (no local macOS).

---

### 5.3 — lib-cpp (Windows) [XL]

**Depends on**: 5.0 CI + 5.1 trait, beta testers on Windows
**FFI**: `cxx`

**Sub-phases**:
- **5.3a** [M]: cxx scaffold, CI compiles on MSVC
- **5.3b** [L]: Direct2D PNG (WIC, GPU-accelerated)
- **5.3c** [L]: DirectWrite PDF export
- **5.3d** [M]: ReadDirectoryChanges file watching
- **5.3e** [M]: Shell thumbnails + jump list + taskbar progress + file association

**Validation**: CI + beta testers.

---

### 5.4 — Pen/Stylus Input [L]

**Depends on**: 5.2 + 5.3, beta testers with hardware

**Sub-phases**:
- **5.4a** [M]: lib-swift Apple Pencil events (pressure, tilt, azimuth)
- **5.4b** [M]: lib-cpp Windows Ink events
- **5.4c** [M]: Frontend: pressure→stroke width. Re-enable Freeform tool with stylus support

**Validation**: Exclusively beta tester driven.

---

## Phase 6: Bottom Panel — Timeline & Budget

Goal: Expandable bottom panel connecting canvas objects to time and cost planning.

### 6.0 — Bottom Panel Shell [M]

**Depends on**: Phase 3 (canvas + document schema)
**Why**: Infrastructure for Timeline + Budget tabs.

**What already exists**: Bottom panel was in original UI (pruned). `.canopi` schema has `timeline` and `budget` sections (empty, ready).

**What to build**:
- Collapsible/resizable bottom panel with tab bar
- Canvas viewport adjustment when panel opens
- Persist open/closed state + height in user settings

**Sub-phases**:
- **6.0a** [M]: Bottom panel component — collapse, resize, tabs. Keyboard shortcut
- **6.0b** [S]: Wire into layout. Canvas area shrinks on open (no overlap)

**Verification gate**: Toggle open/closed. Resize by dragging. Canvas shapes don't jump or clip.

---

### 6.1 — Timeline Tab (Gantt) [XL]

**Depends on**: 6.0
**Why**: Permaculture design is temporal — sowing windows, growth stages, harvest periods.

**What already exists**: `.canopi` `timeline` section in document schema. Plant DB has `sowing_period`, `harvest_period`, `bloom_period`, `fruit_seed_period_begin/end`.

**What to build**:
- Timeline data model: action types (sow, transplant, prune, harvest, custom)
- Gantt rendering: time axis, species rows auto-populated from canvas, colored action bars
- Gantt interactions: drag to move, drag edges to resize, click to expand, undo/redo
- Pre-population from plant DB fields, user adjusts for local conditions

**Sub-phases**:
- **6.1a** [M]: Data model + Rust CRUD IPC. Wire to document save/load
- **6.1b** [L]: Gantt rendering (Konva or HTML canvas). Time axis, species rows, action bars
- **6.1c** [L]: Interactions — drag, resize, click, right-click menu. Undo/redo
- **6.1d** [M]: Pre-population from DB fields. Accept/adjust/dismiss suggestions
- **6.1e** [S]: Polish — year/month/week zoom, today marker, scroll

**i18n keys**: ~20 (action types, column headers, menu items). Batch in 6.1a.

**Verification gate**: Add 5 plants. Open Timeline — species rows appear. Drag to create bar. Resize. Save, reload — persists.

---

### 6.2 — Budget Tab [L]

**Depends on**: 6.0
**Why**: Real costs matter. Canvas knows how many of each plant are placed.

**What already exists**: `.canopi` `budget` section in document schema.

**What to build**:
- Auto-generated table: species, quantity (live from canvas), editable unit price, computed subtotal
- Grand total footer. CSV export
- Price persistence per-design + defaults in user DB

**Sub-phases**:
- **6.2a** [M]: Data model + Rust IPC (plant counts by species, get/set prices)
- **6.2b** [M]: Budget table component. Live quantity updates via signal. CSV export

**Verification gate**: Place 3 apple + 5 comfrey. Open Budget — quantities match. Enter prices — totals compute. Add plant — quantity updates live. Save, reload — prices persist.

---

## Phase 7: World Map & Community

Goal: Discovery surface — explore featured designs, use as templates.

**Depends on**: Phase 4 (MapLibre infrastructure)

### 7.0 — Featured Designs Repository [M]

**What to build**:
- Template format: `.canopi` + metadata (title, description, author, location, screenshot, tags, climate zone)
- Static API or git repo. Start with 10–20 curated designs
- Rust IPC: fetch catalog, download `.canopi` files

---

### 7.1 — World Map Discovery UI [L]

**What to build**:
- MapLibre map with design markers (clustered when zoomed out)
- Click marker → preview card (screenshot, title, plant count, climate zone)
- "Use as template" → download + open as new untitled design
- Filter by climate zone, style, scale

---

### 7.2 — Template Adaptation [M]

**What to build**:
- On import: compare template hardiness zones vs. user's location
- Flag incompatible plants, suggest replacements with similar characteristics
- User accepts suggestions or keeps originals

---

### 7.3 — Knowledge Section [M]

**What to build**:
- Curated agroecology content in Learning panel (right panel bar, book icon — currently placeholder)
- Markdown articles rendered in-app, searchable, tagged by topic
- Future: link articles to relevant plants in the DB

---

## Phase 8+: Future Features (unordered, to be prioritized)

### Canvas Tools
- Ellipse + Polygon zone tools
- Alignment + distribution
- Group/ungroup
- Guides + snap-to-guides
- Arrow + callout annotations
- Dimension + measure tools
- Pattern fill (bed/mass planting)
- Minimap
- Celestial dial (sun path visualization)

### Ecological Intelligence
- Companion planting compatibility scoring (species_relationships + Ellenberg values)
- Syntropic strata-succession matrix (consortium builder)
- Growth timeline slider (Year 0 → Mature — requires growth-rate interpolation data)
- Shadow projection (solar position + per-plant ray-casting)

### Geo Features (requires Phase 4)
- Soil type overlay
- Climate zone overlay
- Parcel boundary import
- Elevation/slope analysis tools

### Data & Export (requires Phase 5 native libs)
- GeoJSON export
- High-DPI PNG/SVG export via native rendering
- PDF report generation (print layout with title block, legend, scale bar, plant schedule)
- Plant list export (CSV with all characteristics)

### Panel & UI
- Plant collections (saved filter presets / plant lists)
- Plant comparison (side-by-side detail cards)
- Layer panel (named layer management)

---

## Code Quality Debt

Living backlog. Update after each phase. Fix opportunistically or batch before major releases.

| Item | Size | Context |
|------|------|---------|
| ~~Move `STRATUM_I18N_KEY` from `canvas/plants.ts` to shared constants~~ | ~~S~~ | ✅ Fixed Sprint 1 — moved to `types/constants.ts` |
| ~~Extract shared dropdown component from `DisplayModeControls.tsx` + `LocalePicker`~~ | ~~M~~ | ✅ Fixed Sprint 1 — `components/shared/Dropdown.tsx` |
| ~~Cache stacked plant badges in `updatePlantsLOD`~~ | ~~S~~ | ✅ Fixed Sprint 1 — toggle visibility + `data-stack-count` gate |
| Wire `LayerPanel.tsx` into canvas layout | M | Component built (497 lines) but never rendered — orphaned during Phase 4.5. Needs mounting in `CanvasPanel.tsx` (left sidebar or collapsible panel) |
| BudgetTab live reactivity to canvas changes | M | `getPlacedPlants()` is an imperative Konva tree walk, not signal-driven. Tab requires switch to refresh. Needs a canvas-change signal or engine event |
| Deduplicate map style i18n keys | S | `canvas.location.mapStreet/mapTerrain/mapSatellite` and `canvas.layers.styleStreet/styleTerrain/styleSatellite` are identical labels in 11 locales. Consolidate to one set |

---

## Completed Phases (archived)

| Phase | What | When | Archive |
|-------|------|------|---------|
| 0 | Scaffold (Tauri + Preact shell) | 2026-03-23 | `docs/archive/phase-0-scaffold.md` |
| 1 | Plant Database (175K species, FTS5) | 2026-03-23 | `docs/archive/phase-1-plant-database.md` |
| 2 | Design Canvas (Konva, zones, plants, undo/redo) | 2026-03-24 | `docs/archive/phase-2-design-canvas.md` |
| 2.1 | Document Integrity (save/load, autosave, dirty tracking) | 2026-03-24 | `docs/archive/phase-2.1-document-integrity.md` |
| UI | Overhaul (feature pruning, field notebook design system) | 2026-03-25–26 | `docs/archive/ui-overhaul-next-steps.md` |
| 3 | Data & Polish — MVP (15 sub-phases) | 2026-03-25–28 | see completion log above |
| 4 | Terrain & Location (geocoding, MapLibre, PMTiles, contours, hillshade, layer controls) | 2026-03-28 | see completion log above |
| 5 | Native Platform (CI, Platform trait, lib-c Cairo, lib-swift/lib-cpp stubs) | 2026-03-28 | see completion log above |
| 6 | Bottom Panel — Timeline & Budget (Gantt, budget table, CSV export) | 2026-03-28 | see completion log above |
| 7 | World Map & Community (template catalog, discovery UI, adaptation, knowledge) | 2026-03-28 | see completion log above |
