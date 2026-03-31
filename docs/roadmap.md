# Canopi Roadmap

**Last updated**: 2026-03-28
**Current state**: Phases 0–7 complete. Next: Phase DC (Design Coherence) → Phase SG (Safeguards) → Phase QA (Quality & Stabilization) before Phase 8+.

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
- 175K-species plant DB with FTS5 full-text search (5 weighted columns, BM25 ranking), 176 contracted columns (schema v8 export, contract v5)
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
    ├── Phase 6 (Timeline & Budget) ✅
    └── Phase QA (Quality & Stabilization) ← YOU ARE HERE
            └── Phase 8+ (canvas tools, ecological intelligence, geo features, export)
```

Next: **Phase QA** — start with QA.0 (bug catalog via parallel code-review agents + live Tauri MCP testing).

---

## Phase DC: Design Coherence

Goal: Unify the app's visual language so it reads as one product, not a collection of independently-styled panels. Extend the design system with structural rules, then enforce token adoption across all 34 CSS modules.

**Why before QA**: QA.3d (cosmetic fixes) would patch symptoms of the same root cause — hardcoded values and missing shared patterns. A coherence pass first means QA validates one unified system instead of 17 independent ones. The dark-mode canvas bugs (BUG-002–006) are fixed for free when hardcoded colors become tokens. Doing this after QA means redoing cosmetic fixes when the coherence pass changes the same files.

**Execution model**: Sequential phases. DC.0 extends the design system (rules on paper). DC.1 creates shared CSS infrastructure. DC.2–DC.4 migrate modules in parallel batches grouped by surface type. DC.5 fixes canvas element colors (resolves BUG-002–006). DC.6 verifies via screenshots.

**Scope boundary**: This phase unifies existing surfaces. It does NOT redesign layouts, add new components, or change the field notebook direction. The palette, depth strategy, and layout are already correct — the problem is inconsistent application of structure (spacing, controls, typography, transitions).

---

### DC.0 — Extend Design System Rules [S]

**Depends on**: nothing
**Why**: The design system defines palette and typography but is silent on spacing rhythm, button hierarchy, empty states, and transitions. Each panel filled these gaps independently. Rules must exist before enforcement.
**Output**: Updated `.interface-design/system.md` with new sections.

**Add to `system.md`**:

- **Spacing rhythm**: 4px base is declared but not enforced. Define the allowed scale: `--space-1` (4px), `--space-2` (8px), `--space-3` (12px), `--space-4` (16px), `--space-6` (24px), `--space-8` (32px), `--space-12` (48px). No other values. Tight contexts (toolbar icons, filter strips) use `--space-1`/`--space-2`. Panel sections use `--space-3`/`--space-4`. Page-level padding uses `--space-6`
- **Button hierarchy**: Define 4 variants with fixed padding/radius/transition:
  - **Primary** (CTA): `--color-primary` fill, `--space-2` `--space-4` padding, `--radius-md`, text `--color-bg`
  - **Secondary**: `--color-surface` fill, `--color-border` border, same padding/radius as primary
  - **Ghost**: transparent bg, `--color-text-muted` text, hover `--color-primary-bg` bg. Same padding
  - **Icon**: square (`--space-6` = 24px or `--space-7` = 28px), transparent bg, `--radius-sm`, hover `--color-primary-bg`
  - All hover transitions: `80ms ease` (single standard)
- **Empty state pattern**: One layout for all panels — upper-third vertical position, icon at 32px with 0.3 opacity `--color-primary`, title at `--text-sm` (12px) weight 500, hint at `--text-xs` (11px) `--color-text-muted`, `--space-2` gap
- **Section header pattern**: Uppercase, `--text-xs` (11px), weight 600, `0.06em` letter-spacing, `--color-text-muted`. No exceptions (kills the 10px/12px/14px scatter)
- **Transition standard**: `80ms ease` for color/bg/border hover states. `150ms ease` for transform/layout shifts. `200ms ease-out` for panel slide/fade enter. Units always `ms`
- **Input controls**: Text inputs — `--space-1` `--space-2` padding (4px 8px), 28px min-height, `--radius-md`, `--color-surface` bg, `--color-border` border. Checkboxes — 13px square. Slider tracks — `--radius-sm` (not 1px)
- **Card/section surface**: `--radius-lg` border, `--color-surface` bg, `--space-3` padding, `--color-border` border. One pattern everywhere

**Files**: `.interface-design/system.md`
**Size**: S
**Acceptance**: New sections exist in system.md covering all 7 structural areas above

---

### DC.1 — Token Infrastructure [S]

**Depends on**: DC.0
**Why**: Some structural values need new tokens in `global.css` before modules can reference them. Canvas element colors need CSS variables to become theme-refreshable.

**Sub-phases**:

- **DC.1a** [S] **Add missing tokens to `global.css`**: Both `:root` and `[data-theme="dark"]` blocks:
  - `--space-7: 28px` (icon button size, currently hardcoded everywhere)
  - `--transition-fast: 80ms ease` / `--transition-normal: 150ms ease` / `--transition-enter: 200ms ease-out` (or just document the values — CSS custom properties for transitions are verbose)
  - Canvas element color tokens: `--canvas-guide: ...`, `--canvas-guide-smart: ...`, `--canvas-minimap-bg: ...`, `--canvas-minimap-stroke: ...`, `--canvas-consortium-stroke: ...`, `--canvas-consortium-fill: ...`, `--canvas-badge-bg: ...`, `--canvas-badge-text: ...`, `--canvas-zone-fallback-fill: ...`, `--canvas-zone-fallback-stroke: ...` — with dark mode overrides that are visible against `--canvas-bg`

- **DC.1b** [S] **Add `getCanvasColor()` entries in `theme-refresh.ts`**: For each new `--canvas-*` token, add a cache entry so canvas code can read them. Add refresh calls to `refreshCanvasTheme()` for guides, minimap, consortium hulls, badges

**Files**: `desktop/web/src/styles/global.css`, `desktop/web/src/canvas/theme-refresh.ts`
**Size**: S (two files, mechanical additions)
**Acceptance**: All new tokens defined with both light and dark values. `refreshCanvasTheme()` has stubs for the new canvas elements

---

### DC.2 — Migrate Chrome Modules [M]

**Depends on**: DC.1
**Why**: Chrome surfaces (title bar, toolbar, panel bar, welcome screen) are the app's first impression. Unifying them sets the visual baseline.

Replace all hardcoded spacing, font-size, border-radius, and transition values with tokens. Apply the button hierarchy from DC.0. Standardize section headers.

**Files to modify** (one agent, sequential):
- `components/shared/TitleBar.module.css` — replace 10px/12px font-sizes with `--text-xs`/`--text-sm`, hardcoded padding with tokens
- `components/canvas/CanvasToolbar.module.css` — replace hardcoded tooltip sizes, standardize icon button size to `--space-7`
- `components/panels/PanelBar.module.css` — standardize icon button size
- `components/shared/WelcomeScreen.module.css` — apply primary/secondary button patterns from DC.0, replace 10px/14px/28px with tokens, standardize empty state layout
- `components/shared/Dropdown.module.css` — replace hardcoded 11px with `--text-xs`, standardize padding
- `components/canvas/ZoomControls.module.css` — standardize icon button, transition timing
- `components/canvas/DisplayModeControls.module.css` — match ZoomControls surface treatment exactly
- `components/canvas/DisplayLegend.module.css` — standardize transition timing

**Size**: M (8 files, mostly mechanical find-replace within each)
**Acceptance**: Zero hardcoded px values for spacing/font-size/radius in modified files. All buttons match one of the 4 hierarchy variants. Visual spot-check: title bar, toolbar, panel bar, welcome screen look identical before/after (same tokens, just via variables now)

---

### DC.3 — Migrate Panel Modules [L]

**Depends on**: DC.1
**Why**: Panels are where the "collection of parts" feeling is strongest. PlantDb (dense, cramped) vs. PlantDetail (spacious, rounded) vs. WorldMapPanel (different again) — three different density worlds.

**Files to modify** (one agent, sequential — these share component patterns):
- `components/plant-db/PlantDb.module.css` — **worst offender** (20+ custom spacing values). Replace all with tokens. Standardize plant row padding to `--space-1` `--space-2`, gap to `--space-1`. Section headers to DC.0 pattern
- `components/plant-db/FilterStrip.module.css` — replace 6px/10px/3px with `--space-1`/`--space-2`
- `components/plant-db/MoreFiltersPanel.module.css` — replace 5px/10px/22px/14px with tokens. Match section header pattern
- `components/plant-db/FilterChip.module.css` — already close, just verify token usage
- `components/plant-db/RangeSlider.module.css` — fix 1px track radius → `--radius-sm`
- `components/plant-db/ThresholdSlider.module.css` — fix 1px track radius → `--radius-sm`
- `components/plant-detail/PlantDetail.module.css` — already best-adopted, align card surface to DC.0 pattern, verify section headers match
- `components/plant-detail/PhotoCarousel.module.css` — verify token usage
- `components/panels/FavoritesPanel.module.css` — standardize empty state to DC.0 pattern
- `components/panels/LearningPanel.module.css` — replace 5px/6px/10px with tokens, standardize empty state
- `components/panels/WorldMapPanel.module.css` — standardize section headers, button patterns
- `components/canvas/LocationInput.module.css` — standardize input padding to DC.0 pattern

**Size**: L (12 files, PlantDb.module.css alone needs ~40 replacements)
**Acceptance**: Zero hardcoded px values for spacing/font-size/radius. All section headers use the DC.0 pattern. Empty states in Favorites, Learning, PlantDb match the DC.0 pattern. Slider tracks use `--radius-sm`

**Parallelism**: DC.2 and DC.3 can run in parallel (no file overlap). DC.2 owns `shared/` + `canvas/` chrome. DC.3 owns `plant-db/` + `plant-detail/` + `panels/`

---

### DC.4 — Migrate Bottom Panel + Canvas Overlay Modules [S]

**Depends on**: DC.1
**Why**: Bottom panel has its own button/tab styling that diverges from the rest. Canvas overlays (layer panel, tile download) need alignment.

**Files to modify**:
- `components/canvas/BottomPanel.module.css` — standardize tab buttons to ghost button pattern, fix 11px → `--text-xs`, transition timing to 80ms
- `components/canvas/LayerPanel.module.css` — replace 10px section headers with `--text-xs`, standardize toggle button size
- `components/canvas/TimelineTab.module.css` — standardize button patterns
- `components/canvas/BudgetTab.module.css` — standardize button patterns
- `components/canvas/ConsortiumTab.module.css` — standardize button patterns
- `components/canvas/TemplateAdaptation.module.css` — standardize button patterns
- `components/canvas/TileDownloadModal.module.css` — standardize input padding, button patterns
- `components/panels/Panels.module.css` — verify layout tokens (already mostly correct)

**Size**: S (8 files, mostly bottom panel tabs — similar structure)
**Acceptance**: Tab buttons use ghost button pattern. All section headers match DC.0. Transition timing unified

**Parallelism**: DC.2, DC.3, DC.4 can all run in parallel (no file overlap)

---

### DC.5 — Canvas Element Theme Colors [M]

**Depends on**: DC.1b (theme-refresh.ts entries)
**Why**: Resolves BUG-002–006 from the pre-cataloged bug list. Hardcoded dark-green canvas colors become token-backed and theme-refreshable.

**Files to modify**:
- `canvas/guides.ts` — replace `GUIDE_COLOR` and `SMART_GUIDE_COLOR` constants with `getCanvasColor()` reads. Add guide refresh to `refreshCanvasTheme()` walker
- `canvas/minimap.ts` — replace 6 hardcoded color constants with `getCanvasColor()`. Add minimap color refresh (re-read on theme change, `_render()` already runs per-frame)
- `canvas/consortium-visual.ts` — replace `HULL_STROKE`/`HULL_FILL` with `getCanvasColor()`. Add consortium hull refresh to `refreshCanvasTheme()` walker
- `canvas/plants.ts` — replace badge colors (lines 151-152) with `getCanvasColor()`. Already in the plant label refresh path
- `canvas/serializer.ts` — replace zone fallback colors (lines 198, 214, 234) with `getCanvasColor()` reads
- `canvas/map-layer.ts` — fix BUG-001 (map occlusion): move map container inside `.canvasContainer` before `.konvajs-content`, or toggle `.canvasContainer` background to transparent when `mapLayerVisible` is true

**Size**: M (6 files, each small change but requires understanding the refresh walker)
**Acceptance**: Toggle dark mode via Tauri MCP → all canvas elements visible in both themes. Map layer visible when toggled on with a location set. BUG-001–006 resolved

**Parallelism**: DC.5 can run in parallel with DC.2–DC.4 if a separate agent owns the `canvas/` directory

---

### DC.6 — Visual Verification + Simplify [S]

**Depends on**: DC.2–DC.5 all complete
**Why**: Coherence is a visual property — must be verified visually. `/simplify` catches duplication exposed by token migration.

**Sub-phases**:

- **DC.6a** [S] **Tauri MCP visual walkthrough**: `cargo tauri dev` + MCP session. Screenshot every major surface in both themes:
  1. Welcome screen (no design loaded)
  2. Plant search panel with results
  3. Plant detail card (scrolled through sections)
  4. Filter strip + "More Filters" panel
  5. Favorites panel (with items + empty state)
  6. Learning panel (placeholder)
  7. Canvas with zones + plants + map layer visible
  8. Canvas with display mode controls + legend
  9. Bottom panel (timeline + budget tabs)
  10. Layer panel
  11. World map panel with location set
  12. Toggle dark mode, repeat screenshots 1–11
  - Verify: consistent density, button sizes, section headers, empty states, transitions. No hardcoded colors visible in dark mode. Map layer renders

- **DC.6b** [S] **Run `/simplify`**: Expect ~2 rounds. R1: structural duplication exposed by token migration (shared values now identical, can be collapsed). R2: verify convergence

- **DC.6c** [S] **Run `/interface-design:audit`**: Check design system compliance. Fix any flagged violations

- **DC.6d** [S] **Update docs**:
  - Mark Phase DC complete in roadmap
  - Update CLAUDE.md if new patterns or gotchas discovered
  - Archive any planning docs to `docs/archive/`

**Size**: S (verification, no major code changes expected)
**Acceptance**: All 22 screenshots (11 surfaces × 2 themes) show consistent visual language. `/simplify` converged. `/interface-design:audit` clean

---

### Phase DC Summary

| Sub-phase | What | Size | Depends on | Parallel? |
|-----------|------|------|------------|-----------|
| DC.0 | Extend design system rules | S | — | — |
| DC.1a | Add CSS tokens to global.css | S | DC.0 | ✅ with DC.1b |
| DC.1b | Add theme-refresh.ts entries | S | DC.0 | ✅ with DC.1a |
| DC.2 | Migrate chrome modules (8 files) | M | DC.1 | ✅ with DC.3, DC.4, DC.5 |
| DC.3 | Migrate panel modules (12 files) | L | DC.1 | ✅ with DC.2, DC.4, DC.5 |
| DC.4 | Migrate bottom panel + overlays (8 files) | S | DC.1 | ✅ with DC.2, DC.3, DC.5 |
| DC.5 | Canvas element theme colors (6 files) | M | DC.1b | ✅ with DC.2, DC.3, DC.4 |
| DC.6a | Visual verification (Tauri MCP) | S | DC.2–5 | — |
| DC.6b | /simplify | S | DC.6a | — |
| DC.6c | /interface-design:audit | S | DC.6b | — |
| DC.6d | Update docs | S | DC.6c | — |

**File ownership matrix** (for parallel DC.2–DC.5):
| Agent | Owns |
|-------|------|
| Chrome agent (DC.2) | `components/shared/*.module.css`, `components/canvas/{CanvasToolbar,ZoomControls,DisplayModeControls,DisplayLegend}.module.css` |
| Panel agent (DC.3) | `components/plant-db/*.module.css`, `components/plant-detail/*.module.css`, `components/panels/{FavoritesPanel,LearningPanel,WorldMapPanel}.module.css`, `components/canvas/LocationInput.module.css` |
| Bottom agent (DC.4) | `components/canvas/{BottomPanel,LayerPanel,TimelineTab,BudgetTab,ConsortiumTab,TemplateAdaptation,TileDownloadModal}.module.css`, `components/panels/Panels.module.css` |
| Canvas agent (DC.5) | `canvas/{guides,minimap,consortium-visual,plants,serializer,map-layer,theme-refresh}.ts` |

**Estimated total**: 2 sessions. DC.0+DC.1 in session 1 (foundation). DC.2–DC.5 parallel + DC.6 verification in session 2.

---

## Phase SG: Safeguards

Goal: Add the three cheapest, highest-impact safeguards before QA begins. These prevent blank-screen crashes, broken commits during parallel agent work, and catch regressions from DC's 34-file CSS migration.

**Why before QA**: The error boundary prevents the worst user experience (blank screen on render error). Pre-commit hooks prevent broken commits during QA's parallel code-reviewer agents. Both are <30 min each and compound in value — every subsequent phase benefits.

---

### SG.0 — Preact Error Boundary [S]

**Depends on**: nothing
**Why**: An unhandled render error (bad signal value, null dereference in a component) crashes the entire UI silently — blank screen, no recovery. Preact doesn't have a built-in `ErrorBoundary` like React. A class component with `componentDidCatch` wrapping the app root shows a fallback UI + "Reload" button instead of a white page.

**Implementation**:
- Create `desktop/web/src/components/shared/ErrorBoundary.tsx` — class component with `componentDidCatch(error)` and `getDerivedStateFromError()`. Renders `this.props.children` normally; on error, renders a fallback div with the error message, a "Reload" button (`window.location.reload()`), and a "Copy error" button for bug reports
- Wrap `<App />` in `desktop/web/src/main.tsx` with `<ErrorBoundary>`
- Style the fallback with inline styles (not CSS Modules — the error might be in the CSS pipeline itself)
- Log the error to console + `window.__canopi_last_error = error` for Tauri MCP debugging

**Files**: `components/shared/ErrorBoundary.tsx` (new), `main.tsx` (1-line wrap)
**Size**: S (one small component + one import)
**Acceptance**: Deliberately throw in a component → fallback UI appears with error message and reload button. Remove the throw → app works normally

---

### SG.1 — Pre-commit Hooks [S]

**Depends on**: nothing
**Why**: Nothing prevents committing broken TypeScript or unformatted Rust. CI catches it after push, but with 4 parallel agents (DC.2–DC.5) and QA's parallel code-reviewers, a broken commit from one agent blocks others. Local pre-commit validation is the cheapest gate.

**Implementation**:
- Install husky: `cd desktop/web && npm install --save-dev husky lint-staged`
- `npx husky init` — creates `.husky/` in `desktop/web/`
- Configure `.husky/pre-commit`: run `npx lint-staged`
- Configure `lint-staged` in `desktop/web/package.json`:
  ```json
  "lint-staged": {
    "*.{ts,tsx}": ["npx tsc --noEmit --pretty"],
    "../../desktop/src/**/*.rs": ["cargo fmt --check --manifest-path ../../desktop/Cargo.toml"]
  }
  ```
- Verify: make a type error in a `.tsx` file → `git commit` fails with tsc error. Fix the error → commit succeeds

**Files**: `desktop/web/package.json` (lint-staged config), `.husky/pre-commit` (new)
**Size**: S (package install + config)
**Acceptance**: Intentional type error blocks commit. Clean code commits successfully. `cargo fmt` violation blocks commit

**Parallelism**: SG.0 and SG.1 can run in parallel (no file overlap)

---

### SG.2 — Test Foundation [M]

**Depends on**: SG.0 (error boundary should exist before writing tests that verify error states)
**Why**: Frontend test coverage is 3% (4 test files for ~20K lines). QA.1 adds roundtrip tests and QA.3 adds per-bug regression tests, but there's no test infrastructure for the two highest-risk areas: signal state modules and canvas engine operations. Without this, every DC and QA change is a trust exercise.

**Sub-phases**:

- **SG.2a** [S] **Signal state tests**: Write vitest tests for the critical state modules that every feature depends on:
  - `state/app.ts`: `setBootstrappedSettings()` hydrates all signals correctly, `persistCurrentSettings()` round-trips through signal reads
  - `state/canvas.ts`: signal defaults match expected initial values, `designLocation` signal updates propagate
  - `state/document.ts`: `markSaved()` / `resetDirtyBaselines()` correctly reset dirty tracking, `saveCurrentDesign()` calls `writeCanvasIntoDocument()` (mock IPC)
  - Files: `desktop/web/src/__tests__/state-signals.test.ts` (new)

- **SG.2b** [M] **Canvas engine operation tests**: Write vitest tests for canvas operations that QA and future phases depend on. Requires `canvas` npm devDependency (already present for Konva):
  - `CanvasHistory`: execute/undo/redo cycle, truncation at 500 cap, `_savedPosition` drift after truncation, `clear()` doesn't trigger dirty
  - `commands/node-serialization.ts`: `serializeNode()` → `recreateNode()` roundtrip for each shape class (Rect, Text, Group, plant Group). Missing shape class falls through gracefully
  - `display-modes.ts`: `updatePlantDisplay()` handles null/missing attributes without throwing
  - `plants.ts`: `getPlantLOD()` returns correct thresholds at boundary zoom levels
  - Files: `desktop/web/src/__tests__/canvas-engine.test.ts` (new), `desktop/web/src/__tests__/canvas-commands.test.ts` (new)

- **SG.2c** [S] **CI test coverage reporting**: Add coverage threshold to vitest config so future PRs can't reduce coverage:
  - Add `coverage` config to `desktop/web/vite.config.ts`: `provider: 'v8'`, `reporter: ['text', 'lcov']`
  - Add `"test:coverage": "vitest run --coverage"` script to `package.json`
  - Do NOT enforce a threshold yet (coverage is too low) — just report. Set threshold after QA.3 when regression tests raise the baseline
  - Files: `desktop/web/vite.config.ts`, `desktop/web/package.json`

**Size**: M (3 new test files + config)
**Acceptance**: `npm test` passes with new tests. Coverage report generates. History truncation test catches the `_savedPosition` edge case. Node serialization test covers all shape classes in `recreateNode()`

---

### Phase SG Summary

| Sub-phase | What | Size | Depends on | Parallel? |
|-----------|------|------|------------|-----------|
| SG.0 | Preact Error Boundary | S | — | ✅ with SG.1 |
| SG.1 | Pre-commit hooks (husky + lint-staged) | S | — | ✅ with SG.0 |
| SG.2a | Signal state tests | S | SG.0 | ✅ with SG.2b |
| SG.2b | Canvas engine operation tests | M | SG.0 | ✅ with SG.2a |
| SG.2c | CI coverage reporting | S | SG.2a+b | — |

**Estimated total**: 1 session. SG.0+SG.1 in parallel (30 min). SG.2a+SG.2b in parallel (1–2 hours). SG.2c (15 min).

---

## Phase QA: Quality & Stabilization

Goal: Harden everything built in Phases 0–7 + DC + SG before adding new features. Fix bugs, eliminate UI freezes, close memory leaks, add regression tests, verify error paths.

**Why now**: Phases 3–7 landed in rapid succession (all on 2026-03-28). High velocity = high probability of subtle bugs, missing error handling, blocking UX, and unchecked resource cleanup. Fixing these now prevents compounding: every Phase 8+ feature built on a shaky foundation inherits its bugs.

**Execution model**: Sequential phases (each depends on the previous), but sub-phases within each phase can run in parallel where noted. The bug catalog informs what to fix; the async/perf fixes are structural so they go before logic fixes; tests lock in each fix; memory and error handling are verification passes on the stabilized code. Phase DC already resolved BUG-001–006 (map occlusion + dark-mode canvas colors) and unified CSS token adoption, so QA.3d should be minimal. Phase SG established the error boundary, pre-commit hooks, and baseline test coverage — QA.3 regression tests build on this foundation.

---

### QA.0 — Bug Catalog [L]

**Depends on**: nothing (first phase)
**Why**: Know the full landscape before fixing anything. Triage prevents wasted effort on low-impact issues.
**Output**: `docs/qa-bugs.md` — categorized, prioritized bug list. Each entry has: description, reproduction steps, severity (P0 data-loss / P1 crash / P2 wrong-behavior / P3 cosmetic), affected files.

**Sub-phases**:

- **QA.0a** [M] **Static code review — Rust backend**: Launch `code-reviewer` agent scoped to `desktop/src/`. Focus areas:
  - Mutex usage: any path where `lock()` is held across an IPC boundary or HTTP call (deadlock risk)
  - `unwrap()` on user-controlled data (130 unwrap/expect calls found in infrastructure audit — panics in Tauri command threads crash the command, not the app, but return opaque errors). Phase SG.0 added an error boundary for frontend render crashes; this audit targets Rust-side panics
  - SQL: any string interpolation that bypasses `validated_column()` allowlist
  - Error messages: any `.map_err()` that swallows the original error context
  - Type mismatches between `common-types` Rust structs and `desktop/web/src/types/` TS interfaces (field names, optionality, enum variants)
  - Files: `commands/*.rs`, `db/*.rs`, `design/*.rs`, `image_cache.rs`, `lib.rs`, `platform/mod.rs`

- **QA.0b** [M] **Static code review — Canvas engine**: Launch `code-reviewer` agent scoped to `desktop/web/src/canvas/`. Focus areas:
  - Serializer roundtrip: fields set on Konva nodes in `fromCanopi()` that are not read in `toCanopi()` (silent data loss)
  - `recreateNode()` in `node-serialization.ts`: missing shape class cases that fall through to generic `Konva.Shape`
  - Undo/redo: `CanvasHistory` truncation at 500 — does `_savedPosition` adjust correctly when truncation passes the save point?
  - Display modes: `updatePlantDisplay()` handling of missing/null attribute values (e.g., species with no hardiness zone)
  - Theme refresh: `refreshCanvasTheme()` missing node types or layers — **known gap**: guide lines (`guides.ts:21,23`), minimap (`minimap.ts:13-18`), consortium hulls (`consortium-visual.ts:9-10`), plant stacked badges (`plants.ts:151-152`), zone fallback colors (`serializer.ts:198,214,234`) all use hardcoded dark-green `rgba(45,95,63,...)` that vanishes on dark canvas `#1A1714`
  - Plant LOD: `updatePlantsLOD()` counter-scale math, label density check with 0 plants, stacked badge edge cases
  - **Known P2**: Map layer occlusion — `createMapLayer()` inserts MapLibre div behind `.canvasContainer` which has opaque `background: var(--canvas-bg)`. Map tiles render but are fully hidden. No code makes the canvas container transparent when map is active. Fix: place map inside `.canvasContainer` before `.konvajs-content`, or toggle background to `transparent` when `mapLayerVisible` is true
  - Files: `engine.ts`, `serializer.ts`, `display-modes.ts`, `theme-refresh.ts`, `plants.ts`, `history.ts`, `commands/*.ts`, `map-layer.ts`, `timeline-renderer.ts`

- **QA.0c** [M] **Static code review — Frontend state & UI**: Launch `code-reviewer` agent scoped to `desktop/web/src/{state,components,ipc}/`. Focus areas:
  - Signal subscription bugs: `effect()` or `useSignalEffect()` with early `return` before reading all dependencies (effect never re-runs)
  - Missing `useEffect` dependency arrays (runs every render → listener leaks)
  - HMR cleanup: module-level `effect()` or `addEventListener` without `import.meta.hot.dispose()` cleanup
  - CSS dark mode: `var(--color-*)` tokens used as foreground without dark mode override in `global.css`
  - Click-outside-to-close: patterns using `mousedown` instead of `pointerup` (catches opening click)
  - Panel lifecycle: components that allocate resources (MapLibre, Konva, timers) without cleanup on unmount
  - Files: `state/*.ts`, `components/**/*.tsx`, `ipc/*.ts`, `utils/*.ts`, `app.tsx`

- **QA.0d** [L] **Live app testing via Tauri MCP**: Run `cargo tauri dev`, connect MCP session. Systematic walkthrough:
  1. **Fresh launch**: screenshot default state, verify no console errors (`webview_execute_js("JSON.stringify(window.__errors || [])")`)
  2. **Plant search**: type query, verify results load, scroll pagination, clear search
  3. **Filters**: apply each FilterStrip control, open MoreFiltersPanel, apply dynamic filters, verify result counts, clear all
  4. **Plant detail**: open detail card, scroll all 19 sections, verify photo carousel loads, check i18n of units
  5. **Favorites**: star a plant, switch to favorites panel, verify it appears, drag to canvas, unstar, verify removal
  6. **Canvas**: create rectangle, text, place plant. Select, move, resize, undo, redo. Copy-paste. Multi-select + transform
  7. **Display modes**: cycle default → canopy → color-by (each attribute). Verify legend updates. Verify plants re-render
  8. **Save/load cycle**: save design, close, reopen, verify all objects + metadata preserved
  9. **Theme toggle**: switch light↔dark. Screenshot each. Verify canvas, panels, map, title bar all update
  10. **Location**: set address, verify geocoding returns, verify MapLibre centers
  11. **Map layers**: toggle basemap, contours, hillshade. Adjust opacities. Verify persistence after panel switch
  12. **World map**: open panel, verify template catalog loads, preview a template
  13. **Bottom panel**: open timeline tab, open budget tab. Resize. Verify Ctrl+J toggle
  14. **Window**: minimize, maximize, restore. Resize to small viewport. Verify no overflow/clipping
  - Record each bug with screenshot + reproduction steps

**Pre-cataloged bugs** (discovered during 2026-03-28 audit, seed `docs/qa-bugs.md` with these):

| ID | Severity | Summary | Files | Root cause |
|----|----------|---------|-------|------------|
| BUG-001 | P2 | Map layer invisible — tiles render behind opaque canvas background | `map-layer.ts:59`, `Panels.module.css:101` | `createMapLayer()` inserts div before `.canvasContainer` which has solid `background: var(--canvas-bg)`. No code makes it transparent when map is active |
| BUG-002 | P3 | Guide lines invisible in dark mode | `guides.ts:21,23` | Hardcoded `rgba(45,95,63,0.6)` dark green, not in `refreshCanvasTheme()` |
| BUG-003 | P3 | Minimap jarring in dark mode | `minimap.ts:13-18` | White bg + dark green strokes hardcoded, not theme-refreshed |
| BUG-004 | P3 | Consortium hulls invisible in dark mode | `consortium-visual.ts:9-10` | Hardcoded `rgba(45,95,63,...)`, not in `refreshCanvasTheme()` |
| BUG-005 | P3 | Zone fallback colors invisible in dark mode | `serializer.ts:198,214,234` | Hardcoded dark green fill/stroke when zone has no custom colors |
| BUG-006 | P3 | Plant stacked badges not theme-aware | `plants.ts:151-152` | Hardcoded `#5A7D3A` + `#FFFFFF`, not in `refreshCanvasTheme()` |

**Common fix pattern for BUG-002–006**: Migrate colors to CSS variables in `global.css` (both themes), read via `getCanvasColor()` in `theme-refresh.ts`, add refresh hooks to `refreshCanvasTheme()`.

**Verification gate**: `docs/qa-bugs.md` exists with categorized entries. Every P0/P1 has reproduction steps.

**Parallelism**: QA.0a, QA.0b, QA.0c run as parallel code-reviewer agents (read-only, no file conflicts). QA.0d runs in main context (needs Tauri MCP session).

---

### QA.1 — Save/Load Roundtrip Fidelity [M]

**Depends on**: QA.0 (bug catalog may reveal serialization issues to include)
**Why**: Data loss is the worst bug category. Users trust autosave. A silently dropped field is unrecoverable.

**Sub-phases**:

- **QA.1a** [M] **Roundtrip test suite**: Write Vitest tests in `desktop/web/src/__tests__/serializer-roundtrip.test.ts`:
  - Create a maximal `CanopiFile` object with every field populated: layers with zones + plants (including notes, planted_date, quantity), object groups, timeline actions, budget items, consortiums, location, description, metadata, extra fields
  - `toCanopi()` → JSON → `fromCanopi()` → `toCanopi()` → assert deep equality
  - Test: plant custom attrs (notes, planted_date, quantity) survive roundtrip
  - Test: zone custom attrs (notes) survive roundtrip
  - Test: `extractExtra()` preserves unknown top-level keys
  - Test: empty/null optional fields don't become `undefined` or get dropped
  - Test: old format files (pre-Phase 6 without timeline/budget) load without error

- **QA.1b** [S] **Live roundtrip via Tauri MCP**: Create a design via MCP with every feature exercised (plants, zones, groups, location, timeline actions, budget entries). Save via IPC. Load via IPC. Compare JSON output field-by-field. Any missing field is a P0 bug → add to `docs/qa-bugs.md`.

**Verification gate**: All roundtrip tests pass. Live roundtrip produces identical JSON (minus timestamps).

---

### QA.2 — Performance / Async UX [L]

**Depends on**: QA.0 (catalog may reveal additional blocking operations)
**Why**: Structural change — async patterns established here affect how subsequent bug fixes handle loading states. Fix before logic bugs so fixes build on correct patterns.

**Sub-phases**:

- **QA.2a** [M] **Audit blocking operations**: Identify every frontend `await` of a slow IPC call that blocks rendering. Check:
  - `geocodeAddress()` in `LocationInput.tsx` — HTTP call to Nominatim
  - `getSpeciesImages()` / image cache fetches in `PhotoCarousel.tsx` — network image download
  - `getSpeciesDetail()` in `PlantDetailCard.tsx` — DB query (fast, but verify)
  - `searchSpecies()` in `state/plant-db.ts` — FTS query (usually fast, but heavy filter combos?)
  - `getTemplateCatalog()` / `downloadTemplate()` in community features — HTTP calls
  - `downloadTiles()` in `TileDownloadModal.tsx` — batch HTTP (already has progress events?)
  - `getFilterOptions()` in `state/plant-db.ts` — DB aggregation query on 175K rows
  - Document: which calls are >100ms, which block UI rendering, which have loading indicators already
  - Output: annotated list in `docs/qa-bugs.md` under "Performance" category

- **QA.2b** [L] **Fix blocking UX**: For each identified blocker, apply the pattern: **render first, fetch second, update reactively**.
  - Geocoding: debounce input (300ms), show spinner in search field, don't block modal rendering while awaiting result. Timeout at 5s with user-visible error
  - Photo carousel: render detail card immediately with image placeholder skeleton. Load images via `useEffect` with signal update on completion. Handle 404/timeout with fallback icon
  - Any other identified blockers: same pattern — skeleton/placeholder → async fetch → signal update → reactive re-render
  - Add loading state CSS: skeleton pulse animation as a shared utility class in `global.css` (reusable, not per-component)
  - i18n keys: ~3 (loading, error, retry). Add to all 11 locales
  - Files likely modified: `LocationInput.tsx`, `PhotoCarousel.tsx`, `PlantDetailCard.tsx`, `global.css`, locale files

- **QA.2c** [S] **Verify async behavior via Tauri MCP**: For each fix, use `webview_screenshot` to confirm:
  - Panel renders instantly with placeholder
  - Data loads in background (no UI freeze)
  - Error state shows on network failure (disconnect network or mock timeout)

**Verification gate**: No operation freezes the UI for >200ms. All slow paths show loading indicators. Network failures show user-visible error messages.

---

### QA.3 — Bug Fixes + Regression Tests [L–XL]

**Depends on**: QA.2 (async patterns settled, fixes build on them)
**Why**: Fix bugs from QA.0 catalog. Write regression test for each fix so it never recurs.
**Size depends on**: Bug count from QA.0. Estimate L (15–30 bugs) to XL (30+).

**Sub-phases**:

- **QA.3a** [varies] **P0 fixes (data loss)**: Fix immediately. Each fix gets a regression test. These may include:
  - Serializer field omissions (from QA.1)
  - Autosave failures that don't surface to user
  - Canvas history corruption (savedPosition drift)

- **QA.3b** [varies] **P1 fixes (crashes/errors)**: Fix in priority order. Each fix gets a regression test. These may include:
  - Unhandled `unwrap()` on user data in Rust commands
  - Konva `recreateNode()` missing shape classes
  - Signal effects that never re-run due to early returns

- **QA.3c** [varies] **P2 fixes (wrong behavior)**: Fix in priority order. Regression tests for non-trivial fixes. These may include:
  - Dark mode visual bugs (missing token overrides)
  - Filter logic errors (filter-to-column mapping edge cases)
  - Display mode handling of null/missing attributes
  - i18n: hardcoded English strings missed by `t()` audit

- **QA.3d** [S] **P3 fixes (cosmetic)**: Fix residual cosmetic issues not already resolved by Phase DC. No tests needed for pure CSS fixes. Expect a small list — DC.2–DC.5 handled the systematic token migration, dark-mode canvas colors (BUG-002–006), and map occlusion (BUG-001)

**Execution pattern**: For each bug: (1) write failing test → (2) fix code → (3) verify test passes → (4) mark bug as fixed in `docs/qa-bugs.md`. Parallel agents OK if file ownership doesn't conflict.

**Verification gate**: All P0 and P1 bugs fixed. All regression tests pass (`npm test`). P2 bugs fixed or explicitly deferred with justification.

---

### QA.4 — Memory Leak Audit [M]

**Depends on**: QA.3 (bug fixes may change resource lifecycle)
**Why**: Desktop app runs for hours. Leaks that don't matter in a web page accumulate in a desktop session. Diagnosing leaks after Phase 8+ adds features is harder — more noise, more suspects.

**Sub-phases**:

- **QA.4a** [M] **Static audit of resource lifecycle**: Review every resource that requires explicit cleanup:
  - **Konva**: `CanvasEngine` constructor creates Stage, Layers, Transformer, event listeners. Verify `destroy()` is called on every Konva object when `CanvasPanel` unmounts. Check: does `engine.ts` have a `dispose()` or `destroy()` method? Is it called?
  - **MapLibre**: `createMapLayer()` returns a `map` instance. Verify `map.remove()` is called on cleanup. Check: `WorldMapPanel.tsx` creates its own MapLibre instance — is it cleaned up on unmount?
  - **Effects**: every module-level `effect()` returns a dispose function. Verify all are called in `import.meta.hot.dispose()` (dev) and component unmount (production). List offenders
  - **Event listeners**: `window.addEventListener` / `document.addEventListener` in `shortcuts/manager.ts`, `engine.ts`, component `useEffect` blocks. Verify matching `removeEventListener` on cleanup
  - **Timers**: `setInterval` / `setTimeout` — verify `clearInterval` / `clearTimeout` on cleanup. Check autosave timer
  - **Image cache**: `image_cache.rs` `AtomicU64` tracked size — does it accurately reflect disk usage after eviction? Memory-side: are fetched image byte arrays released after being sent to frontend?
  - Files: `engine.ts`, `map-layer.ts`, `WorldMapPanel.tsx`, `CanvasPanel.tsx`, `shortcuts/manager.ts`, `state/*.ts`, `image_cache.rs`
  - Output: list of confirmed leaks → add to `docs/qa-bugs.md` as P1

- **QA.4b** [M] **Fix confirmed leaks**: For each leak:
  - Add missing `destroy()` / `remove()` / `dispose()` / `removeEventListener()` / `clearInterval()` calls
  - For `CanvasEngine`: ensure a `destroy()` method exists and is called from `CanvasPanel` cleanup
  - For MapLibre in `WorldMapPanel`: ensure `useEffect` cleanup returns `() => map.remove()`
  - For module-level effects: ensure both HMR and production cleanup paths exist

- **QA.4c** [S] **Verify via Tauri MCP**: Exercise the leak-prone paths:
  - Switch between canvas and other panels 10 times. Check JS heap via `webview_execute_js("performance.memory?.usedJSHeapSize")` (Chrome-based WebView only — may not be available in WebKitGTK; if unavailable, check DOM node count instead: `document.querySelectorAll('*').length`)
  - Open/close world map panel 5 times. Check for orphaned MapLibre canvases in DOM
  - Toggle display modes rapidly. Check Konva node count doesn't grow

**Verification gate**: No orphaned DOM nodes after panel switching. No unbounded growth in node count or heap after repeated operations.

---

### QA.5 — Error Handling & Offline Resilience [M]

**Depends on**: QA.3 (logic bugs fixed, async patterns settled from QA.2)
**Why**: Rapid development builds happy paths. Users in rural areas (core audience for agroecology tool) have unreliable internet. Every network-dependent feature is a failure mode.

**Sub-phases**:

- **QA.5a** [M] **Audit and fix network failure paths**: For each HTTP-dependent feature, verify behavior when network is unavailable or server returns error:
  - `geocodeAddress()`: timeout handling? User feedback on failure? Currently uses `ureq` — check if there's a timeout configured. Add 5s timeout if missing. Frontend: show "Could not find location" message
  - Image cache (`fetch_and_cache_bytes`): timeout? Retry? What does frontend show on failure? Ensure `PhotoCarousel` shows placeholder on fetch error
  - Template catalog (`getTemplateCatalog`): what happens when `templates.canopi.app` is unreachable? Show "Could not load templates" with retry button
  - Template download (`downloadTemplate`): partial download handling? Verify HTTPS + domain allowlist. Show error on failure
  - Tile download (`downloadTiles`): progress events on failure? Resume on retry?
  - Files: `commands/community.rs`, `commands/geocoding.rs`, `commands/tiles.rs`, `image_cache.rs`, `LocationInput.tsx`, `PhotoCarousel.tsx`, `WorldMapPanel.tsx`, `TileDownloadModal.tsx`

- **QA.5b** [S] **Audit disk failure paths**:
  - Autosave when disk is full: does `autosave.rs` surface the error via `autosaveFailed` signal? Verify frontend shows warning
  - Image cache eviction: does LRU eviction handle permission errors gracefully?
  - User DB write failure: does `set_setting` propagate error or swallow it?

- **QA.5c** [S] **i18n keys for error states**: Add error message keys to all 11 locale files:
  - ~8 keys: network error, timeout, retry, disk full warning, location not found, template load failed, image load failed, tile download failed
  - Batch all in one commit to avoid 11-file merge conflicts

**Verification gate**: Each network feature handles failure gracefully (no crash, no infinite spinner, user-visible message). Autosave failure shows warning.

---

### QA.6 — Mechanical Checks [M]

**Depends on**: QA.3 (bugs fixed — these checks catch residual issues)
**Why**: Automated checks that catch entire categories of defects. Low effort, high signal. Run last because earlier phases may add/change i18n keys, CSS, and imports.

**Sub-phases**:

- **QA.6a** [S] **i18n completeness audit**: Write a script or use `node -e` to:
  - Parse all 11 locale JSON files under `desktop/web/src/i18n/locales/`
  - Diff key sets: report keys present in `en.json` but missing in any other locale
  - Report keys present in other locales but missing in `en.json` (stale keys)
  - Report keys in code (`t('...')` calls via grep) not present in `en.json` (runtime errors)
  - Fix all gaps

- **QA.6b** [S] **Bundle size & code splitting**: Run `npm run build` in `desktop/web/`, inspect Vite output:
  - Verify MapLibre is in a separate chunk (dynamic import → code split)
  - Verify `maplibre-contour` is in same chunk as MapLibre (used together)
  - Verify timeline renderer is NOT in the main chunk (bottom panel is toggled)
  - Report total bundle size. Flag any chunk >500KB
  - If MapLibre is in main bundle: fix the import to use dynamic `import()` properly

- **QA.6c** [S] **Security surface review**: Targeted review (not full audit):
  - `markdown.ts`: verify HTML output is sanitized (no raw `innerHTML` with user content). Check for XSS vectors in rendered markdown
  - `query_builder.rs` `validated_column()`: verify every frontend-originated column name goes through the allowlist. Check `field-registry.ts` → IPC → `validated_column()` path
  - `download_template()`: verify content validation beyond size limit (is the downloaded file valid JSON/.canopi format?)
  - `geocoding.rs`: verify address input is URL-encoded before HTTP request
  - Report findings → `docs/qa-bugs.md` as P1

- **QA.6d** [S] **Dead code identification**: Identify code that is both (a) disabled/pruned per CLAUDE.md and (b) not importable by any active code path. Don't delete — just document in `docs/qa-bugs.md` under "Dead Code" for future cleanup. This is informational only — pruned features stay on disk per project convention.

**Verification gate**: Zero missing i18n keys across all 11 locales. MapLibre code-split confirmed. No XSS vectors in markdown renderer. All dynamic filter columns go through allowlist.

---

### QA.7 — Final Verification [S]

**Depends on**: QA.0–QA.6 all complete
**Why**: End-to-end confidence check on the stabilized codebase.

**Sub-phases**:

- **QA.7a** [S] **Full test suite**: `npm test` — all existing + new regression tests pass. `cargo check --workspace` — no warnings. `npx tsc --noEmit` — no type errors. `npm run build` — clean build.

- **QA.7b** [S] **Live smoke test via Tauri MCP**: Repeat QA.0d walkthrough (abbreviated — 5 minutes, not exhaustive). Verify no regressions from fixes. Screenshot key states.

- **QA.7c** [S] **Update docs**:
  - Mark Phase QA complete in roadmap
  - Archive `docs/qa-bugs.md` to `docs/archive/` (keeping unresolved P3s noted)
  - Update CLAUDE.md with any new patterns or gotchas discovered during QA
  - Run `/simplify` one final round

**Verification gate**: All tests pass. Smoke test clean. `docs/qa-bugs.md` has no open P0/P1/P2 items.

---

## Phase QA Summary

| Sub-phase | What | Size | Depends on | Parallel? |
|-----------|------|------|------------|-----------|
| QA.0a | Static review — Rust backend | M | — | ✅ with 0b, 0c |
| QA.0b | Static review — Canvas engine | M | — | ✅ with 0a, 0c |
| QA.0c | Static review — Frontend state/UI | M | — | ✅ with 0a, 0b |
| QA.0d | Live app testing (Tauri MCP) | L | — | ❌ (main context) |
| QA.1a | Roundtrip test suite | M | QA.0 | ✅ with 1b |
| QA.1b | Live roundtrip via Tauri MCP | S | QA.0 | ✅ with 1a |
| QA.2a | Audit blocking operations | M | QA.0 | — |
| QA.2b | Fix blocking UX | L | QA.2a | — |
| QA.2c | Verify async behavior | S | QA.2b | — |
| QA.3a | P0 fixes (data loss) | varies | QA.2 | — |
| QA.3b | P1 fixes (crashes) | varies | QA.3a | — |
| QA.3c | P2 fixes (wrong behavior) | varies | QA.3b | — |
| QA.3d | P3 fixes (cosmetic) | S | QA.3c | — |
| QA.4a | Static memory leak audit | M | QA.3 | — |
| QA.4b | Fix confirmed leaks | M | QA.4a | — |
| QA.4c | Verify leak fixes | S | QA.4b | — |
| QA.5a | Network failure paths | M | QA.3 | ✅ with QA.4 |
| QA.5b | Disk failure paths | S | QA.5a | — |
| QA.5c | Error state i18n keys | S | QA.5a | — |
| QA.6a | i18n completeness | S | QA.3 | ✅ with 6b,6c,6d |
| QA.6b | Bundle size / code splitting | S | QA.3 | ✅ with 6a,6c,6d |
| QA.6c | Security surface review | S | QA.3 | ✅ with 6a,6b,6d |
| QA.6d | Dead code identification | S | QA.3 | ✅ with 6a,6b,6c |
| QA.7a | Full test suite | S | QA.0–6 | — |
| QA.7b | Live smoke test | S | QA.7a | — |
| QA.7c | Update docs | S | QA.7b | — |

**Estimated total**: 3–5 sessions depending on bug count from QA.0.

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

---

## 2026-03-28 Architecture Review & Stabilization Recommendations

This section is rewritten for an agent-heavy execution model.

The project can move very fast. That changes the recommended sequencing, but not the core architectural diagnosis. The bottleneck is no longer implementation throughput. The bottleneck is integration safety: preventing data loss, reducing shared authority, and creating work packets that multiple agents can execute without colliding.

### Scope And Validation

Review scope:
- `docs/roadmap.md`
- Rust workspace structure
- Tauri bootstrap and command registration
- DB/query layer
- document persistence and autosave
- canvas engine and canvas-adjacent panels
- frontend state and IPC boundaries
- current test/build status

Validation run during review:
- `cargo check` ✅
- `cargo test` ✅
- `npm test` ✅
- `npm run build` ✅

Observed build pressure:
- main frontend chunk remains very large
- `maplibre-gl` is also large
- this is not the primary stabilization blocker, but it is a sign that code surface is concentrating faster than it is being decomposed

### Executive Conclusion

The repo has a solid top-level shape:
- workspace crates are separated sensibly
- Tauri is used as a composition root rather than as business-logic glue
- Rust owns file I/O and durable state
- the frontend owns live editing state and rendering
- `state/document.ts` is the correct long-term document boundary

The instability comes from three interacting issues:
- user-visible transitions are not consistently guarded by one mutation boundary
- too much real authority sits in a few oversized modules
- async lifecycle, rendering, persistence, and direct state mutation are still mixed together in several critical files

If the team is using agents aggressively, I would change the roadmap in one major way:
- do authority reduction earlier, not later

Reason:
- agents make code generation cheap
- they make coordination mistakes expensive
- the worse the shared authority structure is, the more agent speed amplifies regression risk

So the right strategy is not “slow down because the architecture is stressed.”
The right strategy is:
- protect data first
- establish stable mutation boundaries second
- reduce oversized authority modules into facade-plus-owned-internals
- then let agents move fast inside those seams

### Architecture Snapshot

Current architecture, as implemented, looks like this:

`desktop/src/lib.rs`
- runtime composition root
- plugin registration
- app data directory bootstrap
- user DB and plant DB initialization
- image cache initialization
- Tauri IPC registration

`desktop/src/commands/*`
- Tauri command boundary
- generally thin and appropriately placed
- most commands delegate into DB or design modules rather than inlining logic

`desktop/src/db/*`
- plant DB querying
- query construction
- user DB and recent file persistence
- this is the strongest backend seam conceptually, but `plant_db.rs` and `query_builder.rs` have become oversized authorities

`desktop/src/design/*`
- `.canopi` file creation, load/save, autosave, atomic replacement
- overall shape is good
- frontend still bypasses a single guarded transition layer when replacing the active document

`desktop/web/src/state/*`
- signal-based app state
- conceptually small and understandable
- but mutation authority is still diffuse because many components write directly to signals

`desktop/web/src/canvas/*`
- the canvas subsystem is the highest-risk area
- `CanvasEngine` is both the public API and too much of the implementation
- this is the single biggest frontend blast-radius problem

`desktop/web/src/components/*`
- panel structure is serviceable
- some panels are now becoming mini-subsystems and need controller extraction before they become the next `CanvasEngine`

### What Changes Because Agents Are Doing The Coding

Knowing that agents will implement most of the work changes the recommendations in these ways:

1. Authority reduction should move earlier.
- In a single-engineer workflow, it is tempting to defer structural cleanup until after bug fixes.
- In an agent-heavy workflow, that is backwards.
- Without clear ownership seams, multiple agents will keep editing the same authority files and integration will get worse, not better.

2. Mutation boundaries become mandatory.
- Direct signal writes from many components are manageable for one engineer.
- They are a coordination hazard when many agents are changing flows in parallel.
- Shared action modules are not style polish. They are concurrency infrastructure.

3. Stable facades matter more than file size.
- The goal is not to get files under an arbitrary line count.
- The goal is to preserve a stable external interface while internals are split so agents can own disjoint write sets.

4. The best refactor is the one that creates parallel ownership.
- Ask: “what change gives us the cleanest disjoint write zones?”
- Not: “what change produces the most elegant taxonomy on paper?”

### Principal Findings

Ordered by severity and by how strongly they should shape the next architectural moves.

#### 1. Document transitions can discard unsaved work

Severity: Critical

Confirmed paths:
- `desktop/web/src/state/design.ts` `openDesign()`
- `desktop/web/src/state/design.ts` `openDesignFromPath()`
- `desktop/web/src/state/design.ts` `newDesignAction()`
- `desktop/web/src/components/panels/WorldMapPanel.tsx` template import flow

The app already protects window close, but not in-app document replacement. That means the document system has no single transition authority. This is the most important issue in the codebase because it is silent data loss.

Architectural implication:
- document replacement must move behind one shared action boundary
- component-level direct document replacement should stop

#### 2. Canvas document loading has a lifecycle race

Severity: High

`CanvasPanel` can start an async queued load against an engine instance that gets destroyed before the promise resolves.

Architectural implication:
- document session lifecycle is not isolated enough from component lifecycle
- the canvas subsystem needs an explicit document-session owner

#### 3. Offline tiles are optimistic rather than truthful

Severity: High

The current tile flow deletes the old cache first, counts attempted downloads rather than successful writes, and writes a manifest that can overstate actual offline readiness.

Architectural implication:
- network + disk flows need staging semantics
- destructive replacement should not happen before replacement validity is known

#### 4. World map discovery mixes controller logic and map lifecycle

Severity: High

Catalog loading, filtering, map init, source updates, and template import all live in one panel file. That created the current map marker race.

Architectural implication:
- async controller logic and rendering lifecycle need to be separated for any panel that owns external resources

#### 5. Document loading does not reset all transient runtime state

Severity: Medium

Selection, lock state, and per-document caches can leak across document transitions.

Architectural implication:
- persisted state restore and runtime session reset are different phases and need different owners

#### 6. Some backend command semantics are too forgiving for their user promise

Severity: Medium

Example:
- replacement suggestions silently degrade to generic results when the source species lookup fails

Architectural implication:
- commands that represent guidance or integrity-sensitive behavior need explicit failure semantics rather than silent fallback

#### 7. Networked media paths are under-bounded

Severity: Medium

Image fetching currently lacks the same kind of timeout and validation discipline used elsewhere.

Architectural implication:
- every network path needs the same bounded policy: timeout, size limit, validation, and explicit UI error state

#### 8. Mutation authority is still too diffuse in the frontend

Severity: Structural, high leverage

Many components still mutate signals directly. That is convenient locally but makes system behavior hard to reason about globally.

Architectural implication:
- the frontend needs action modules, not just more component splitting

#### 9. Some module-level effects are doing lifecycle work that should belong to mounted surfaces

Severity: Structural, medium leverage

Example:
- `state/plant-db.ts` starts search behavior at module import time

This is not an immediate correctness failure, but it raises test complexity and makes ownership less explicit.

Architectural implication:
- stop introducing new module-init side effects for networked or resourceful behavior
- migrate toward mounted controllers or explicit actions over time

### Root Cause: Authority Concentration

The real problem is authority concentration.

An oversized authority module is not merely “a big file.”
It is a file that combines too many of the following at once:
- state ownership
- async lifecycle
- I/O boundaries
- persistence translation
- render orchestration
- user-triggered mutation logic
- cleanup semantics

That is why the following modules matter more than the rest:
- `desktop/web/src/canvas/engine.ts`
- `desktop/src/db/plant_db.rs`
- `desktop/src/db/query_builder.rs`
- `desktop/web/src/components/panels/WorldMapPanel.tsx`
- `desktop/web/src/components/canvas/LayerPanel.tsx`
- `desktop/web/src/components/canvas/InteractiveTimeline.tsx`

With agents, these modules become merge magnets.
If they are left as-is, the team will keep paying the same cost:
- overlapping edits
- hidden behavior coupling
- fragile integration
- regressions discovered late

### Core Recommendation: Facade Plus Owned Internals

The project should adopt one consistent structural rule for its critical subsystems:
- keep one facade per subsystem
- move implementation responsibilities behind owned internal modules
- never replace one oversized authority file with many peer files that all mutate the same global state directly

This matters because agents need stable edges.

A good split creates:
- a stable public API
- disjoint write sets for implementation work
- smaller test seams
- clearer cleanup and lifecycle ownership

A bad split creates:
- more files
- the same authority problem spread across them
- more imports and harder traceability

### Required Mutation Boundaries

Before or alongside the main module splits, add shared action boundaries.

These are not optional if agents are doing most of the implementation.

Create:
- `desktop/web/src/state/document-actions.ts`
- `desktop/web/src/state/canvas-actions.ts`
- `desktop/web/src/state/community-actions.ts`
- `desktop/web/src/state/timeline-actions.ts`
- `desktop/web/src/state/plant-db-actions.ts` if search/filter behavior keeps growing

Rule of thumb:
- components read signals
- components call actions
- actions mutate signals, invoke IPC, coordinate persistence, and own user-confirmation flows

What should move into actions immediately:
- guarded document transitions
- post-load reset sequence
- template import flow
- map/terrain settings persistence
- timeline mutations
- budget mutations

What should stop happening over time:
- deep presentational components writing signals directly
- multiple components duplicating the same persistence logic
- document replacement logic living in panels

### Oversized Authority Modules: Detailed Recommendations

#### 1. `CanvasEngine` should become a facade immediately

Current authority held by `engine.ts`:
- stage creation and layer registry
- keyboard and pointer lifecycle
- zoom and pan
- grid/ruler/minimap/map overlay sync
- tooltip DOM lifecycle
- drag/drop import flow
- document session assumptions
- object operations
- display-mode cache loading
- cleanup ordering

That is too much for one implementation file, and it is the worst possible place for many agents to keep landing changes.

Keep `CanvasEngine` as the public facade.
Do not make the rest of the app learn a new surface.

Move owned responsibilities into internal modules such as:

`canvas/runtime/viewport.ts`
- zoom/pan
- resize observer
- overlay redraw scheduling
- map viewport sync trigger

`canvas/runtime/overlays.ts`
- grid
- rulers
- scale bar
- minimap hookup
- theme refresh hooks for overlay visuals

`canvas/runtime/document-session.ts`
- load/reset flow
- chrome show/hide
- guide restore
- transient session reset
- per-document cache reset

`canvas/runtime/object-ops.ts`
- selection lookup
- delete/duplicate/copy/paste
- lock/unlock
- z-order changes
- align/distribute/group/ungroup entry points

`canvas/runtime/external-input.ts`
- drag/drop plant import
- tooltip lifecycle
- species cache loading for display modes

Keep in `CanvasEngine` itself:
- stage and layer registry
- history instance
- tool registry
- public delegating methods
- destruction order

Non-negotiable constraint:
- do not turn these runtime modules into new global singletons
- they must be owned by one engine instance or one engine context

Why this matters for agents:
- one agent can work on viewport behavior without touching clipboard logic
- one agent can harden document reset without editing drag/drop code
- one agent can improve cleanup without touching rendering math

#### 2. `plant_db.rs` should be split by query family

`plant_db.rs` is not one concern. It is at least five:
- search listing
- detail hydration
- relationships and media
- filter metadata
- localization and translation

Recommended shape:

`desktop/src/db/plant/mod.rs`
- thin facade or module index

`desktop/src/db/plant/search.rs`
- `search`
- search row mapping
- pagination cursor assembly where appropriate

`desktop/src/db/plant/detail.rs`
- `get_detail`
- detail-row mapping
- detail translation composition

`desktop/src/db/plant/relations.rs`
- `get_relationships`
- `get_species_images`
- `get_species_external_links`

`desktop/src/db/plant/filters.rs`
- `get_filter_options`
- `get_dynamic_filter_options`
- field classification helpers

`desktop/src/db/plant/localization.rs`
- `get_common_name`
- `get_locale_common_names`
- `get_common_names_batch`
- `translate_value`

Why this split is correct:
- each family changes for different reasons
- it creates clean agent ownership
- it preserves the command layer API
- it reduces the chance that a detail-schema change destabilizes search or localization logic

What not to do:
- extract only helper functions while leaving `get_detail()` and its associated translation logic partly interleaved in one file

#### 3. `query_builder.rs` should become an internal query-construction DSL

The problem here is not just file length. It is that one file currently carries:
- allowlisted field validation
- cursor encoding/decoding
- cursor SQL clauses
- filter expansion
- FTS sanitization
- full SQL assembly

That is a security and auditability problem, not just a readability problem.

Recommended shape:

`desktop/src/db/query/columns.rs`
- validated dynamic fields
- sort column resolution

`desktop/src/db/query/cursor.rs`
- encode/decode cursor
- cursor clause construction

`desktop/src/db/query/filters.rs`
- filter expansion
- operator handling
- value normalization

`desktop/src/db/query/search_sql.rs`
- final SELECT/JOIN/WHERE/ORDER/LIMIT assembly

Keep one `QueryBuilder` entry point or facade.

Why this matters:
- the security boundary becomes explicit
- cursor behavior becomes independently testable
- agents can work on search quality without sharing a file with the allowlist boundary

#### 4. `WorldMapPanel` should be split into shell, controller, map surface, and import flow

Current panel responsibilities:
- map settings UI
- catalog fetch
- catalog filtering
- map init/destroy
- source/layer updates
- selection state
- template import mutation

This is exactly the kind of mixed authority that produces async races.

Recommended shape:

`components/panels/WorldMapPanel.tsx`
- shell composition only

`components/world-map/use-template-catalog.ts`
- catalog fetch
- climate/style filtering
- selected template state

`components/world-map/DiscoveryMap.tsx`
- map init/destroy
- source updates
- map event wiring

`components/world-map/template-import.ts`
- download + load + guarded document replacement

`components/world-map/TemplatePreviewCard.tsx`
- pure presentation

Why this split matters:
- the current marker race is fixed at the right seam
- template import stops sharing a file with map lifecycle
- agents can own the map surface and the import flow independently

#### 5. `LayerPanel` should stop mixing layer list control with terrain/map configuration

`LayerPanel.tsx` is not yet a critical stability risk, but it is clearly becoming a mini-subsystem.

Recommended shape:
- `LayerPanel.tsx` as shell
- `CanvasLayerList.tsx`
- `TerrainLayersSection.tsx`
- `layer-panel-icons.tsx`
- `state/canvas-actions.ts` for mutations and persistence

Why:
- the canvas layer list and terrain settings do not evolve for the same reasons
- map and terrain settings already carry persistence side effects and should not live as inline component mutations indefinitely

#### 6. `InteractiveTimeline` should separate interaction controller and document mutation

The timeline rendering math is already reasonably separated.
The remaining authority problem is that the interactive component still mixes:
- drag state machine
- hit testing orchestration
- document mutation
- delete/update logic

Recommended shape:
- keep one interactive component
- extract document mutations into `timeline-actions.ts`
- extract drag/update controller logic into a small hook or controller module

Why:
- timeline interaction work becomes easier to test
- document mutation no longer lives in the render file
- agents can safely work on rendering and mutation logic independently

#### 7. `state/plant-db.ts` should stop being the next large hidden controller

This module is not yet enormous, but it is already acting like a controller:
- module-level effect
- search generation and debounce logic
- filter merge behavior
- sidebar loading
- favorites synchronization
- dynamic options caching

Recommendation:
- do not rewrite it immediately
- but stop adding more behavior directly into this module
- if the plant DB surface grows further, split toward:
  - query-controller logic
  - favorites/recent controller logic
  - filter option loading
  - pure derived state

### Agent-First Planning Rules

If agents are doing the coding, the roadmap should assume this operating model.

#### Rule 1: establish shared interfaces before parallel edits begin

Before multiple agents work in the same subsystem:
- define the facade
- define the internal module responsibilities
- define the mutation boundary
- define the file ownership matrix

Otherwise agents will all “helpfully” edit the same orchestrator file.

#### Rule 2: do not parallelize through a hot authority file

If the work still requires repeated edits to one file such as `engine.ts` or `plant_db.rs`, the right move is not more parallelism.
The right move is to split the authority first.

#### Rule 3: batch cross-cutting type and action changes before implementation swarms

Typical examples:
- shared action modules
- shared i18n key batches
- shared type updates
- shared CSS tokens

These should land first because they reduce merge conflict risk for every follow-on agent.

#### Rule 4: use disjoint write sets as the unit of planning

Good agent task:
- one worker owns `document-actions.ts` and call sites in a bounded set of document transition surfaces

Bad agent task:
- three workers all touching `engine.ts` because they are working on “canvas improvements”

#### Rule 5: every resource-owning surface needs an explicit lifecycle owner

If a panel owns:
- a map instance
- a canvas engine
- a timer
- a listener graph
- a network subscription

then lifecycle should be isolated enough that one module clearly owns setup and teardown.

### Preferred Work Packet Shape For Agents

This is not yet a line-by-line implementation plan. It is the shape the work should take.

Good work packets:
- one facade extraction with a small set of internal modules
- one action-boundary creation plus its call sites
- one backend query family split with command layer unchanged
- one panel controller extraction with pure presentational children

Bad work packets:
- “clean up canvas code”
- “improve state management”
- “refactor map stuff”

Every packet should answer:
- what files does this worker own?
- what public interface remains stable?
- what mutation boundary is introduced or preserved?
- what tests prove the behavior is unchanged or improved?

### Rewritten QA Sequence For An Agent-Heavy Project

The old instinct would be to fix bugs first and refactor later.
For this project, with agents, that is too expensive.

The right QA sequence is:

#### QA.0 — Data Safety And Transition Authority

Goal:
- eliminate silent data loss
- make document replacement go through one boundary

Required outcomes:
- all document-replacing actions use a shared guarded transition path
- close, new, open, open-recent, queued load, and template import all share the same user-decision model
- canvas document loading is cancellation-safe
- transient canvas state is reset explicitly on document switch

Why first:
- this is the highest-severity user issue
- it also creates the first shared mutation seam that other agent work can rely on

Parallelism guidance:
- one worker owns `document-actions.ts` and transition semantics
- one worker owns canvas session reset and queued-load hardening
- one worker can update UI call sites once the action interface is fixed

#### QA.1 — Truthful Network And Storage Behavior

Goal:
- make network-backed and disk-backed features bounded and honest

Required outcomes:
- tile downloads stage before replacement and report actual success state
- image cache has timeout, size cap, and validation policy
- template/geocoding/adaptation failure paths surface clear user-visible errors
- autosave and related disk failures are surfaced consistently

Why second:
- these paths cross network and filesystem boundaries and are currently optimistic
- they are ideal agent work once mutation boundaries are not in flux

Parallelism guidance:
- one worker: `tiles.rs` plus status model
- one worker: image cache and photo fallback behavior
- one worker: geocoding/template/adaptation error semantics

#### QA.2 — Controller Extraction For Race-Prone Surfaces

Goal:
- isolate lifecycles that currently mix controller logic and rendering

Primary targets:
- `WorldMapPanel`
- `LayerPanel`
- `InteractiveTimeline`

Required outcomes:
- map lifecycle is isolated from catalog and import flow
- terrain/map settings write through actions rather than direct ad hoc mutations
- timeline mutation logic is extracted from the render-heavy component

Why third:
- these are high-leverage panel seams
- they are strong candidates for parallel agent work
- this reduces the chance that later UI work reintroduces lifecycle regressions

#### QA.3 — Core Authority Reduction

Goal:
- reduce blast radius in the highest-authority backend and frontend modules

Primary targets:
- `CanvasEngine`
- `plant_db.rs`
- `query_builder.rs`
- `state/plant-db.ts` if it continues to grow as a hidden controller

Required outcomes:
- `CanvasEngine` becomes a stable facade with owned internals
- plant DB query families are split without changing command APIs
- query-builder security and cursor logic become independently testable
- future agent work no longer requires routine edits to the same giant authority files

Why here, not last:
- because agents are the implementation engine
- the project needs structural parallelism before more feature and bug work piles on top

#### QA.4 — Coverage And Verification Hardening

Goal:
- encode the new boundaries in tests and verification routines

Required outcomes:
- regression tests for document transitions
- lifecycle tests for queued load and map initialization order
- backend tests for staged offline tiles and bounded image fetch behavior
- smoke verification for critical panel flows
- explicit checks around new action boundaries

Why last:
- testing too early against unstable boundaries causes churn
- once the authority seams are in place, tests become cheaper and more durable

### Recommended Permanent Conventions

These should become project rules, not just one-time recommendations.

1. No component should replace the active document directly.
- use document actions only

2. No new resource-owning surface should mix lifecycle and business mutations in one file if it can be avoided.

3. No new network path should ship without:
- timeout
- size bound where relevant
- validation where relevant
- explicit UI error state

4. No new feature should land directly inside an existing oversized authority module unless it is part of splitting that module.

5. New frontend behavior should prefer:
- signal reads in components
- signal writes in actions

6. Every substantial subsystem should define:
- facade
- owner of lifecycle
- owner of mutations
- test seam

### What I Would Not Recommend

I would not recommend:
- a broad rewrite of the app
- pausing all bug work until every big file is split
- splitting files purely to reduce line count
- introducing many new global singletons or manager classes
- spawning many agents against `engine.ts` or `plant_db.rs` before seams exist
- continuing to add features directly into current authority hotspots as if the architecture were already safe for parallelism

### Immediate Priorities

If the goal is to help the project most, the next architectural priorities are:

1. Create document transition authority.
- this resolves the most serious user risk
- it also establishes the first strong action boundary

2. Isolate canvas document session behavior.
- this removes a real race and creates a seam for further engine splitting

3. Make network/storage flows truthful and bounded.
- especially offline tiles and image cache

4. Extract controller logic from world-map and terrain surfaces.
- this fixes a real race and reduces panel-level integration risk

5. Split the core authority modules behind stable facades.
- especially `CanvasEngine`, `plant_db.rs`, and `query_builder.rs`

### Exit Criteria For Calling The Project Stable

Do not call the project stabilized until all of these are true:
- no document transition can discard unsaved work without an explicit user decision
- all document-replacing flows go through one shared action boundary
- queued canvas loads are cancellation-safe
- document load resets both persisted state and runtime-transient state correctly
- offline tile state reflects actual downloaded availability, not optimistic attempts
- all network-backed media/template/geocoding paths have bounded timeout and validation behavior
- the world-map surface behaves correctly regardless of async load ordering
- `CanvasEngine` is a facade rather than the primary implementation dumping ground
- backend search/query logic is split into auditable, ownership-friendly seams
- panel controllers that own external resources have isolated lifecycle owners
- new work can be assigned to agents through disjoint write sets without routine collisions in the same authority files

### Bottom Line

The project is not unstable because it grew quickly.
It is unstable because the speed of implementation outpaced the speed of authority reduction.

Agents make that imbalance more visible.

So the recommendation is:
- do not slow down
- do not do a broad rewrite
- do restructure earlier
- do create mutation boundaries now
- do turn oversized authority files into stable facades with owned internals

That is the path that keeps velocity high without letting the codebase become progressively harder to change.
