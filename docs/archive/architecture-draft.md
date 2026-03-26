# Canopi — Agroecological Design App

## Context

Canopi is an offline-first, open-source, cross-platform desktop app that makes agroecological design accessible to everyone — from home gardeners to professional permaculture designers. It ships with a massive plant database (175,484 species) and provides a VSCode-like interface for designing food forests, polycultures, and regenerative landscapes.

**Problem**: Existing tools are either too complex (QGIS), too shallow (garden planners), or too narrow (agroforestry-only). No single tool combines accessibility with scientific depth across the full agroecological design workflow.

**Distribution**: Open source, GitHub releases, fully offline. A website will be built separately.

**Repository**: https://github.com/naejin/canopi

### Claude Code Plugin: `canopi@canopi-team` v0.1.0

All development is guided by a Claude Code plugin that encodes project conventions, prevents common mistakes, and captures learnings. The plugin ships with **8 skills**, **3 agents**, and **3 hooks**.

**Install**: The plugin is registered as `canopi@canopi-team`. Cache: `~/.claude/plugins/cache/canopi-team/canopi/0.1.0/`.

#### Skills — Invoke Before Writing Code

Each skill contains domain-specific patterns, constraints, and Context7 library IDs. **Invoke the relevant skill BEFORE writing code in that domain.**

| Skill | Command | When to Invoke |
|-------|---------|----------------|
| `canopi-ux` | `/canopi-ux` | Before building/modifying any UI component, panel, layout, interaction, empty state, a11y feature, or theme |
| `canopi-rust` | `/canopi-rust` | Before writing/modifying any Rust code — IPC commands, Tauri setup, state, serde, specta, Cargo.toml |
| `canopi-canvas` | `/canopi-canvas` | Before working on canvas engine, Konva shapes/layers, tools, undo/redo, serialization, grid/rulers |
| `canopi-db` | `/canopi-db` | Before writing DB queries, schema changes, FTS5 search, pagination, prepare-db.py, user DB ops |
| `canopi-native` | `/canopi-native` | Before working on lib-swift/lib-cpp/lib-c, Platform trait, FFI bridges, build.rs for native code |
| `canopi-i18n` | `/canopi-i18n` | Before adding UI strings, locale switching, translation files, date/number formatting, CJK handling |
| `canopi-test` | `/canopi-test` | Before writing tests, CI/CD config, quality gates, E2E setup, performance benchmarks |
| `canopi-retro` | `/canopi-retro` | At end of session — captures corrections, discoveries, new conventions back into skills |

#### Agents — Spawned by Task Context

| Agent | Model | Color | Spawn When |
|-------|-------|-------|------------|
| `canopi-backend-dev` | Sonnet | Green | Building Rust modules, IPC commands, DB queries, native platform features |
| `canopi-frontend-dev` | Sonnet | Cyan | Building Preact components, UI panels, signals state, CSS Modules, Konva integration |
| `canopi-reviewer` | Opus | Magenta | Code review, PR review, convention compliance checks after feature completion |

#### Hooks — Automatic Enforcement

**PreToolUse → `guard-packages.sh`** (fires on Bash commands):
Blocks installation of banned packages before they enter the project:
- npm: `react-konva`, `react-i18next`, `tailwindcss`, `zustand`/`redux`/`mobx`
- cargo: `r2d2`/`deadpool`/`sqlx`, `typeshare`

**PostToolUse → Convention guard prompt** (fires on Write|Edit):
Scans written/edited source code for critical violations. Only speaks on violations, silent otherwise:
- `.ts/.tsx`: importing from `react` instead of `preact`, using `react-konva`, `useTranslation()`, Tailwind utility classes, zustand/redux/mobx
- `.rs`: string-formatted SQL (must use prepared statements), connection pools, typeshare

**Stop → Retro suggestion** (fires at session end):
Checks if corrections were made or new patterns discovered during the session → suggests running `/canopi-retro` to capture learnings back into skills.

#### Phase → Skill Mapping

| Phase | Primary Skills | Agents |
|-------|---------------|--------|
| Phase 0 (Scaffold) | `canopi-rust`, `canopi-ux`, `canopi-i18n` | `canopi-backend-dev`, `canopi-frontend-dev` |
| Phase 1 (Plant DB) | `canopi-db`, `canopi-rust`, `canopi-ux` | `canopi-backend-dev`, `canopi-frontend-dev` |
| Phase 2 (Canvas Core) | `canopi-canvas`, `canopi-ux`, `canopi-rust` | `canopi-frontend-dev`, `canopi-backend-dev` |
| Phase 3 (Advanced + Location) | `canopi-canvas`, `canopi-native`, `canopi-db` | All three |
| Phase 4 (World Map + Showcase) | `canopi-ux`, `canopi-db`, `canopi-i18n` | `canopi-frontend-dev` |
| Phase 5 (Polish + Release) | `canopi-test`, `canopi-i18n`, `canopi-native` | `canopi-reviewer` |
| Any session end | `canopi-retro` | — |

**Rule**: Every implementation task should invoke the relevant skill first. Agents are spawned based on task context. The retro skill captures learnings that improve all other skills over time.

### Documentation Strategy: Use Context7

When implementing, **always use the Context7 MCP tool** to fetch up-to-date documentation for our dependencies. This avoids relying on potentially outdated training data or unreliable web sources.

**Context7 library IDs for our stack:**

| Library | Context7 ID | Use for |
|---------|------------|---------|
| Tauri v2 | `/websites/v2_tauri_app` | IPC commands, plugins, window management, bundling, auto-updater |
| Konva.js | `/konvajs/site` | Canvas API, shapes, drag-and-drop, serialization, events |
| MapLibre GL JS | `/maplibre/maplibre-gl-js` | Map setup, terrain, markers, offline tiles, layers |
| i18next | `/i18next/react-i18next` | Translation setup, hooks, locale switching |
| Zustand/Signals | `/pmndrs/zustand` | (reference only — we use @preact/signals) |
| rusqlite | `/rusqlite/rusqlite` | SQLite queries, FTS5, bundled feature, connection setup |
| swift-bridge | `/chinedufn/swift-bridge` | Rust↔Swift FFI, bridge module, build.rs |
| Preact | resolve via `mcp__context7__resolve-library-id` | Component API, signals, compat layer |

**Rule: Before writing code that uses any library API, query Context7 for the current docs.** This ensures we use correct, up-to-date API patterns instead of hallucinated or deprecated ones.

---

## Architecture

### Design Philosophy: Leverage Claude Code

Claude Code changes the tech stack calculus. Every decision is re-evaluated through this lens:

| Human Dev Assumption | Claude Code Reality | Implication |
|---------------------|--------------------|----|
| Frameworks reduce decision fatigue | Claude Code has no decision fatigue | Choose frameworks for runtime performance, not DX |
| Utility CSS (Tailwind) speeds up prototyping | Claude Code generates any CSS equally fast | Choose CSS approach for readability and performance |
| Connection pools handle concurrent load | Desktop app = single user, few concurrent ops | Simpler concurrency model |
| Native libs add FFI complexity most devs avoid | Claude Code handles Swift/C++/C FFI fluently | Include native libs from the start — better performance and OS integration |
| typeshare automates type sync | Claude Code keeps types in sync manually | Use `specta` (Tauri-native) or `ts-rs` for correctness guarantee |
| Large ecosystems reduce integration work | Claude Code integrates any library equally fast | Choose the smallest, most performant library |

### Rust Workspace Layout

```
canopi/
├── Cargo.toml                  # Workspace root (2 crates for MVP)
├── desktop/                    # Main Tauri v2 application
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs              # Module exports + Tauri builder
│   │   ├── db/                 # Plant DB + User DB modules
│   │   │   ├── mod.rs
│   │   │   ├── plant_db.rs     # Read-only plant queries, FTS5 search
│   │   │   ├── user_db.rs      # Writable: designs, settings, favorites
│   │   │   └── query_builder.rs # Composable filter + search SQL
│   │   ├── commands/           # All #[tauri::command] handlers
│   │   │   ├── mod.rs
│   │   │   ├── species.rs      # search, get_by_id, relationships, filters
│   │   │   ├── design.rs       # save, load, list, delete .canopi files
│   │   │   ├── settings.rs     # get/set preferences
│   │   │   └── content.rs      # learning content, DB status
│   │   ├── design/             # .canopi file format: serialize, deserialize, migrate
│   │   │   ├── mod.rs
│   │   │   ├── format.rs       # CanopiFile struct (serde), version migration
│   │   │   └── migrate.rs      # v1→v2→v3... migration functions
│   │   └── i18n.rs             # System locale detection
│   ├── web/                    # Frontend (Preact/TS/Vite)
│   │   ├── src/
│   │   │   ├── app.tsx         # Root: activity bar + panel router
│   │   │   ├── components/     # Preact components (UI shell)
│   │   │   │   ├── activity-bar/
│   │   │   │   ├── plant-db/
│   │   │   │   ├── canvas-panel/    # Canvas container + toolbar + bottom panel
│   │   │   │   ├── world-map/
│   │   │   │   ├── learning/
│   │   │   │   ├── saved-designs/
│   │   │   │   ├── plant-detail/    # Reusable PlantDetailCard
│   │   │   │   └── shared/          # StatusBar, CommandPalette, etc.
│   │   │   ├── canvas/         # Canvas engine (imperative Konva, NOT in Preact render)
│   │   │   │   ├── engine.ts        # CanvasEngine class: stage, layers, objects
│   │   │   │   ├── tools/           # Tool classes: SelectTool, RectTool, PlantStampTool...
│   │   │   │   │   ├── base.ts      # Tool interface
│   │   │   │   │   ├── select.ts
│   │   │   │   │   ├── hand.ts
│   │   │   │   │   ├── rectangle.ts
│   │   │   │   │   ├── polygon.ts
│   │   │   │   │   ├── freeform.ts
│   │   │   │   │   ├── line.ts
│   │   │   │   │   ├── text.ts
│   │   │   │   │   ├── measure.ts
│   │   │   │   │   ├── plant-stamp.ts
│   │   │   │   │   └── pattern-fill.ts
│   │   │   │   ├── history.ts       # Command-based undo/redo (not state snapshots)
│   │   │   │   ├── serializer.ts    # CanvasEngine ↔ CanopiFile conversion
│   │   │   │   ├── compass.ts       # North arrow + sun direction widgets
│   │   │   │   └── grid.ts          # Grid, rulers, guides, snap logic
│   │   │   ├── state/          # @preact/signals — all reactive state
│   │   │   │   ├── app.ts           # Global: activePanel, locale, theme
│   │   │   │   ├── canvas.ts        # Canvas: activeTool, layers, selection, history
│   │   │   │   ├── plant-db.ts      # Search query, filters, results
│   │   │   │   └── design.ts        # Current design: file path, dirty flag, metadata
│   │   │   ├── ipc.ts          # Typed IPC wrapper: invoke() with TS generics
│   │   │   ├── i18n/           # i18next core + locale signal sync
│   │   │   │   ├── index.ts
│   │   │   │   ├── en.json     # English
│   │   │   │   ├── fr.json     # French
│   │   │   │   ├── es.json     # Spanish
│   │   │   │   ├── pt.json     # Portuguese
│   │   │   │   ├── it.json     # Italian
│   │   │   │   └── zh.json     # Chinese (Simplified)
│   │   │   ├── styles/         # Global CSS + CSS Module convention
│   │   │   │   └── global.css       # CSS variables, reset, theme tokens
│   │   │   └── utils/
│   │   │       ├── solar.ts         # Sun position math (~50 LOC, no library)
│   │   │       └── debounce.ts
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── resources/              # Bundled resources (Tauri resource dir)
│   │   └── canopi-core.db      # Optimized plant DB (~200MB)
│   ├── content/                # Learning content (Markdown + images)
│   │   ├── en/
│   │   ├── fr/
│   │   ├── es/
│   │   ├── pt/
│   │   ├── it/
│   │   └── zh/
│   ├── assets/                 # Icons, images
│   ├── capabilities/           # Tauri security capabilities
│   └── tauri.conf.json
│
├── common-types/               # Shared Rust types → TS via specta
│   ├── src/
│   │   ├── lib.rs
│   │   ├── species.rs          # Species, SpeciesSearchResult, Relationship, Filter types
│   │   ├── design.rs           # CanopiFile, PlacedPlant, Consortium, TimelineAction, BudgetItem
│   │   ├── settings.rs         # Settings, Locale
│   │   └── content.rs          # Topic, MarkdownContent
│   ├── Cargo.toml
│   └── build.rs                # specta TS generation (Tauri-native, better than typeshare)
│
├── lib-swift/                  # macOS native APIs (Swift via swift-bridge)
│   ├── src/
│   │   └── lib.rs              # #[swift_bridge::bridge] FFI definitions
│   ├── swift/
│   │   ├── Package.swift
│   │   └── Sources/
│   │       ├── FileSystem.swift      # Spotlight indexing, Quick Look, file watching
│   │       ├── Rendering.swift       # Core Graphics/Metal: high-DPI export, thumbnail gen
│   │       ├── SystemIntegration.swift  # Native menu bar, Dock, Touch Bar
│   │       └── PDF.swift             # Native PDF generation via PDFKit
│   ├── Cargo.toml
│   └── build.rs                # swift-bridge CLI orchestration
│
├── lib-cpp/                    # Windows native APIs (C++ via cxx)
│   ├── src/
│   │   └── lib.rs              # cxx bridge definitions
│   ├── cpp/src/
│   │   ├── filesystem.cpp      # Shell integration, thumbnails, jump list, file watching
│   │   ├── rendering.cpp       # Direct2D: high-DPI export, thumbnail generation
│   │   ├── system.cpp          # Taskbar progress, Windows Ink/stylus input
│   │   └── pdf.cpp             # Native PDF via Windows.Data.Pdf or DirectWrite
│   ├── Cargo.toml
│   └── build.rs                # cxx-build, C++17, /MT
│
├── lib-c/                      # Linux native APIs (C via cc/bindgen)
│   ├── src/
│   │   └── lib.rs              # FFI bindings (bindgen or manual)
│   ├── c/src/
│   │   ├── filesystem.c        # inotify file watching, XDG dirs, desktop entry
│   │   ├── rendering.c         # Cairo/Skia: high-DPI export, thumbnail generation
│   │   ├── system.c            # DBus integration, portal APIs
│   │   └── pdf.c               # Cairo PDF surface for PDF generation
│   ├── Cargo.toml
│   └── build.rs                # cc crate, pkg-config for system libs
│
└── scripts/
    ├── prepare-db.py           # Generate core/full DB from canopi-data
    └── translate-values.py     # Populate translations for categorical values (fr, es, pt, it, zh)
```

**Native platform libraries (lib-swift, lib-cpp, lib-c)** provide capabilities beyond Tauri plugins:
- Hardware-accelerated rendering for high-DPI PNG/PDF export
- OS search indexing (Spotlight, Windows Search) for .canopi files
- Kernel-level file watching (FSEvents, ReadDirectoryChanges, inotify)
- Shell integration (thumbnails, file associations, jump lists)
- Platform-native menus and taskbar/dock integration

Claude Code handles the FFI complexity (swift-bridge, cxx, cc/bindgen) fluently — the build scripts and cross-language type mappings are well within its capabilities. The trade-off (build complexity vs. native performance) favors native when the developer is Claude Code.

### Key Crate Responsibilities

| Crate | Purpose |
|-------|---------|
| `desktop` | Tauri app: IPC commands, DB queries, .canopi file I/O, settings persistence, resource bundling. Delegates to platform libs via trait abstraction. |
| `common-types` | Shared Rust↔TS types via `specta`. Species, Design, Settings, Content types. Single source of truth. |
| `lib-swift` | macOS: Core Graphics/Metal rendering, PDFKit PDF export, Spotlight indexing, Quick Look previews, native menu bar, file watching. Compiled only on macOS. |
| `lib-cpp` | Windows: Direct2D rendering, native PDF, Shell thumbnails, jump list, taskbar progress, Windows Ink/stylus, file watching. Compiled only on Windows. |
| `lib-c` | Linux: Cairo/Skia rendering, Cairo PDF, inotify file watching, DBus integration, XDG compliance, desktop portal APIs. Compiled only on Linux. |

### Platform Abstraction Layer

The `desktop` crate defines a `Platform` trait. Each native lib implements it. Conditional compilation selects the right implementation:

```rust
// desktop/src/platform/mod.rs
pub trait Platform {
    fn export_pdf(design: &CanopiFile, path: &Path, options: &PdfOptions) -> Result<()>;
    fn generate_thumbnail(design: &CanopiFile, size: u32) -> Result<Vec<u8>>;
    fn render_high_dpi(stage_json: &str, width: u32, height: u32, dpi: u32) -> Result<Vec<u8>>;
    fn watch_file(path: &Path, callback: Box<dyn Fn()>) -> Result<WatchHandle>;
    fn register_file_type() -> Result<()>;  // .canopi file association
    fn index_design(path: &Path, metadata: &DesignMeta) -> Result<()>;  // Spotlight/Windows Search
}

#[cfg(target_os = "macos")]
pub use lib_swift::MacOSPlatform as NativePlatform;
#[cfg(target_os = "windows")]
pub use lib_cpp::WindowsPlatform as NativePlatform;
#[cfg(target_os = "linux")]
pub use lib_c::LinuxPlatform as NativePlatform;
```

---

## Frontend Architecture

### UI Layout (VSCode-like)

```
┌──────────────────────────────────────────────────────────────┐
│  Title Bar (native or custom per platform)                    │
├────┬─────────────────────────────────────────────┬───────────┤
│    │                                              │           │
│ A  │         Active Panel Content                 │  Right    │
│ c  │                                              │  Panel    │
│ t  │  ┌─────────────────────────────────────┐    │ (plant    │
│ i  │  │  Plant DB / Canvas / Map / Learn    │    │  detail,  │
│ v  │  │                                     │    │  click a  │
│ i  │  │                                     │    │  plant on │
│ t  │  │                                     │    │  canvas   │
│ y  │  │                                     │    │  to open) │
│    │  │                                     │    │           │
│ B  │  ├─────────────────────────────────────┤    │ collaps-  │
│ a  │  │  Bottom Panel (Canvas view only)    │    │ ible ↔    │
│ r  │  │  [Timeline] [Consortium] [Budget]       │    │           │
│    │  │  ↕ collapsible                      │    │           │
├────┴──┴─────────────────────────────────────┴────┴───────────┤
│  Status Bar (locale toggle, design info)                      │
└──────────────────────────────────────────────────────────────┘
```

### Bottom Panel (Canvas view — collapsible, like VSCode terminal)

When the Design Canvas is active, a resizable/collapsible bottom panel provides:

1. **Timeline tab** — Interactive chronological action planner:

   **Layout**: Horizontal timeline (Gantt-like) with months/seasons as columns and action rows. Each action is a draggable bar.

   **Interactions**:
   - **Add action**: Click "+" button or double-click empty space on timeline. Opens a form: type (soil_prep/planting/pruning/harvest/maintenance/other), description, start date, end date (optional for point-in-time actions), plants involved (multi-select from placed plants), recurrence (one-time/yearly/seasonal).
   - **Drag to reschedule**: Drag an action bar left/right to change its date. Snaps to week boundaries. Visual feedback shows new date.
   - **Resize duration**: Drag the right edge of an action bar to extend/shorten the duration (e.g., "soil prep" spans 2 weeks).
   - **Edit action**: Click an action to open edit form. All fields modifiable.
   - **Delete action**: Right-click → Delete, or select + Delete key. Confirmation if `confirm_destructive` setting is on.
   - **Mark complete**: Checkbox on each action. Completed actions show strikethrough / muted color.
   - **Reorder rows**: Drag action rows vertically to reorder.
   - **Zoom**: Zoom timeline between day/week/month/season/year views.

   **Smart features**:
   - **Auto-suggest actions**: When a plant is placed on canvas, suggest typical actions based on species data (e.g., "Prune fruit trees in late winter", "Sow annual seeds in spring"). User confirms or dismisses.
   - **Season color bands**: Background color bands for spring/summer/autumn/winter based on location's hemisphere.
   - **Dependency arrows**: Optional: drag from one action to another to create a dependency ("mulch AFTER planting").
   - **Conflict warnings**: Highlight if two actions overlap for the same zone/plant that shouldn't (e.g., planting while soil prep is ongoing).
   - **Export to calendar**: iCal export includes all timeline actions as calendar events.
2. **Consortium tab** — Shows the plant consortium for the current design. Displays companion planting groups, synergies, and conflicts between placed plants.
3. **Budget tab** — Cost tracking: plant costs, materials, labor estimates. Totals and per-zone breakdowns.

### Activity Bar Icons (top to bottom)

1. **Leaf icon** → Plant Database panel
2. **Pencil/Canvas icon** → 2D Design Canvas
3. **Globe icon** → World Map (showcased designs)
4. **Book icon** → Learning (techniques, syntropy fundamentals)
5. **Folder icon** → Saved Designs sidebar

### Plant Database Panel — Search & Filter

The Plant DB panel has a powerful search/filter system:

- **Search bar** (top): FTS5 full-text search across name, family, genus, uses. Debounced 300ms. Results update as you type.
- **Filter sidebar** (collapsible left section within the panel):
  - **Hardiness zone** — Range slider (1–13)
  - **Height** — Min/max range (meters)
  - **Sun tolerance** — Full sun / Semi-shade / Full shade (checkboxes)
  - **Soil type** — Heavy clay, well-drained, sandy, etc. (multi-select)
  - **Growth rate** — Slow / Medium / Fast
  - **Life cycle** — Annual / Biennial / Perennial
  - **Edible** — Yes / No / Partial
  - **Nitrogen fixer** — Yes / No
  - **Stratum** (syntropic) — Emergent / High / Medium / Low
  - **Family** — Searchable dropdown
  - **Uses** — Edible / Medicinal / Other (multi-select)
- **Results list**: Virtual-scrolled, shows plant thumbnail/icon, common name, scientific name, family. Click to open detail view.
- **Drag handle**: Each plant row is draggable — drag from DB list directly onto the canvas.

### Right Side Panel — Plant Detail (Canvas view)

When user clicks a plant on the canvas:
- Right panel slides open showing full plant info (reuses PlantDetailCard component from Plant DB view)
- Shows: botanical name, common name (in user's locale), dimensions, hardiness, tolerances, uses, cultivation notes, syntropic classification
- Quick actions: remove from canvas, edit notes, view relationships/companions
- Collapsible — click X or press Escape to close

### Plant DB — Advanced Features

**Organization**
- **Favorites** — Star/bookmark plants for quick access. Stored in user DB. Dedicated "Favorites" filter toggle.
- **Collections** — User-defined plant lists (e.g., "My food forest canopy", "Mediterranean herbs", "Nitrogen fixers for zone 7"). Create, rename, delete. Drag plants into collections.
- **Recently viewed** — Auto-tracked list of last 50 browsed plants.
- **Tags** — User can add custom tags to plants (e.g., "available at nursery", "ordered", "established")

**Browsing & Discovery**
- **View modes**: List view (compact, shows key fields), Card/grid view (thumbnails with summary), Table view (spreadsheet-like, sortable columns)
- **Sort options**: By name (common/scientific), family, height, hardiness zone, growth rate, stratum
- **Comparison view** — Select 2-4 plants → side-by-side table comparing all their attributes. Highlights differences.
- **Similar plants** — "Show similar" button on any plant → finds species with similar hardiness, height, sun tolerance, and soil preferences
- **Relationship graph** — For a selected plant, show companion plants (beneficial), antagonists (harmful), and neutral neighbors. Uses the 108K species_relationships data.

**Advanced Search**
- **Boolean filter combinations** — All filters are AND-combined. Each filter category is OR within (e.g., "Full sun OR Semi-shade" AND "Edible" AND "Zone 5-8")
- **Search by use case presets**: Quick filter buttons for common scenarios:
  - "Food forest canopy" (tall, perennial, edible, shade-casting)
  - "Ground cover" (low, spreading, shade tolerant)
  - "Pollinator garden" (flowering, attracts wildlife)
  - "Windbreak" (tall, tolerates wind, evergreen)
  - "Nitrogen fixers" (nitrogen_fixation = true)
  - "Mediterranean climate" (drought tolerant, zones 8-10)
- **Saved searches** — Save a filter combination with a name for reuse

**Plant Data**
- **Seasonal calendar per species** — When to sow, transplant, harvest, prune. Based on hardiness zone and location.
- **Personal notes** — User can add notes to any species (stored in user DB, not in plant DB)
- **Custom plants** — Add local varieties not in the database. Minimal required fields: name, height, hardiness zone. Stored in user DB.

### Tech Stack (Optimized for Claude Code + Performance)

**Framework: Preact + @preact/signals** (not React)
- Preact: 3KB vs React's 40KB. Same JSX/component API. React ecosystem works via `preact/compat`.
- @preact/signals: True fine-grained reactivity (~1KB). Replaces Zustand entirely. Signals update only the DOM nodes that depend on them — no virtual DOM diffing overhead.
- Why not React: Virtual DOM overhead is wasted in a desktop app. Canvas operations shouldn't go through React's reconciliation. Preact is strictly better here — same API, 10x smaller, faster.
- Why not vanilla TS: The 20-dev team benefits from a component model for the non-canvas UI (panels, sidebars, lists). Preact gives us this without the weight.

**Canvas: Konva.js (direct imperative API, not react-konva)**
- For a design app with undo/redo, multi-select, 1000+ objects, and complex interactions, imperative Konva gives direct control over when and what renders.
- react-konva routes all canvas updates through Preact's render cycle — wasteful and limiting for a design tool.
- Canvas state lives in signals; Konva objects are created/updated imperatively in response to signal changes.
- Konva's serialization (toJSON/fromJSON) maps cleanly to .canopi file format.

**Styling: CSS Modules** (not Tailwind)
- Claude Code writes excellent, well-organized CSS — Tailwind's utility-class approach solves a human productivity problem we don't have.
- CSS Modules: scoped by default, zero runtime, full CSS power, readable markup.
- A VSCode-like UI needs pixel-precise custom CSS — fighting Tailwind's utility model would slow us down.
- `<div className={styles.activityBar}>` is far more reviewable by the 20-dev team than long Tailwind class strings.

**State: @preact/signals** (not Zustand)
- Signals are reactive primitives: `const count = signal(0)`. Read with `count.value`, components auto-subscribe.
- No store boilerplate, no selectors, no middleware. The state IS the API.
- Fine-grained updates: only the DOM nodes reading a signal re-render, not the whole component tree.
- For the canvas bridge: signals notify Konva imperatively when state changes.

**Full Stack:**
- **Preact** + **@preact/signals** for UI components and state
- **TypeScript** + **Vite** for build tooling
- **CSS Modules** for scoped, zero-runtime styling
- **Konva.js** (imperative API) for 2D design canvas
- **MapLibre GL JS** for maps — open-source, offline-capable, terrain/contours
- **i18next** (core library, no Preact wrapper) — signals drive locale reactivity
- **@tanstack/virtual** (framework-agnostic) for plant DB list virtualization
- **marked** or **markdown-it** for learning content rendering (lighter than react-markdown)
- **@tauri-apps/api** for IPC
- Solar position: ~50 lines of math (no library needed — standard astronomical formulas)

**Dependency comparison (what we dropped and why):**

| Dropped | Replacement | Savings |
|---------|-------------|---------|
| React (40KB) | Preact (3KB) | 37KB, same API |
| ReactDOM (120KB) | preact (included) | 120KB |
| Zustand (~3KB) | @preact/signals (~1KB) | 2KB + no boilerplate |
| react-konva (~15KB) | Konva imperative API (0KB extra) | 15KB + better canvas perf |
| react-i18next (~10KB) | i18next core + signal effect (0KB extra) | 10KB |
| Tailwind CSS (build tooling) | CSS Modules (native Vite support) | Simpler build, readable markup |
| react-markdown (~25KB) | marked (~5KB) | 20KB |

**Total frontend JS savings: ~200KB+ smaller bundle → faster Tauri WebView startup**

### Key Frontend Patterns

- **Panel routing**: Activity bar toggles active panel (not URL routing — single window)
- **Drag-and-drop**: HTML5 DnD API for cross-panel plant dragging (DB → Canvas)
- **Virtual scrolling**: For plant DB list (175K records, paginated queries)
- **Debounced search**: Frontend sends search queries to Rust backend via IPC
- **Layer system**: Canvas layers managed in signals, toggled via UI
- **Undo/Redo**: True command pattern — each action is a **command object** (not a state snapshot). Commands store the minimum diff needed to undo/redo. E.g., `{ type: 'add_plant', canonical_name: '...', position: {...} }` → undo removes that plant. This is memory-efficient (unlimited undo depth) unlike state snapshots which duplicate the entire canvas state per action. Keyboard shortcuts: Ctrl+Z / Ctrl+Shift+Z.
- **Multi-select**: Shift+click to add plants to selection. Drag-select (rubber band) to select multiple. Selected plants can be moved, deleted, or grouped as a consortium together. Selection state in signals.
- **Plant info side panel**: Clicking a plant on the canvas opens a right-side panel showing the full plant detail (from DB). Same component as the plant detail in the Plant DB view. Panel is collapsible and doesn't replace the main view.
- **.canopi file save/load**: Ctrl+S saves the current design to its .canopi file path (or prompts "Save As" via native file dialog if new). Ctrl+O opens a .canopi file. Recent files tracked in user DB. File watcher detects external changes.

---

## Backend Architecture (Rust/Tauri)

### Tauri IPC Commands

```rust
// Plant Database — all return Result<T, String> for error propagation
search_species(text: String, filters: SpeciesFilter, cursor: Option<String>, limit: u32, locale: String)
  → PaginatedResult<SpeciesListItem>   // cursor-based pagination, NOT offset
get_species_detail(canonical_name: String, locale: String) → SpeciesDetail
get_species_relationships(canonical_name: String) → Vec<Relationship>
get_similar_species(canonical_name: String, limit: u32) → Vec<SpeciesListItem>
get_filter_options() → FilterOptions   // available values for each filter field (cached on startup)

// Design (.canopi files)
save_design(path: Option<String>, content: String) → String  // returns saved file path
load_design(path: String) → String     // returns JSON string, frontend deserializes
list_designs() → Vec<DesignSummary>    // from user DB recent files
delete_design(path: String) → ()

// Consortiums
get_consortium_suggestions(canonical_names: Vec<String>) → Vec<ConsortiumSuggestion>

// Settings
get_settings() → Settings
set_settings(settings: Settings) → ()

// Learning content
list_learning_topics(locale: String) → Vec<Topic>
get_learning_content(slug: String, locale: String) → String  // raw markdown

// Full DB download
get_db_status() → DbStatus
download_full_db() → ()  // emits progress events

// File dialogs (via tauri-plugin-dialog, not native libs)
// Handled frontend-side via @tauri-apps/plugin-dialog
```

### Database Architecture

**No connection pool.** This is a desktop app, not a web server. Instead:
- **Plant DB**: One `rusqlite::Connection` opened read-only at startup. Wrapped in `Arc<Connection>` (SQLite in WAL mode supports concurrent reads from multiple threads).
- **User DB**: One `rusqlite::Connection` wrapped in `Mutex<Connection>` (writes need serialization).
- Both connections live in Tauri managed state.

```rust
struct AppState {
    plant_db: Arc<Connection>,       // read-only, concurrent reads safe in WAL mode
    user_db: Mutex<Connection>,      // writable, serialized access
}
```

**Why not r2d2?** r2d2 manages a pool of connections for concurrent web server workloads. A desktop app has one user making sequential interactions. One read connection + one write connection is correct and simpler.

### Database Strategy — Tiered (core + downloadable)

- **Core DB** (~200MB, bundled in `desktop/resources/`): Identity, dimensions, hardiness, tolerances, common names, uses, relationships. FTS5 indexes. Accessed via Tauri's resource resolver.
- **Full DB** (~800MB, downloadable): All 167 fields. Downloaded to app data dir (`tauri::api::path::app_data_dir`). Replaces core DB connection when available.
- **User DB** (writable): In platform config dir. Stores: recent files, favorites, collections, tags, custom plants, user notes, saved searches, settings.

### Search Architecture

The plant DB has two query modes that combine:

1. **FTS5 full-text search** — Matches against canonical_name, common_name, family, genus, uses text
2. **Structured filters** — SQL WHERE clauses on indexed columns

```sql
-- Combined query: FTS5 search + structured filters
SELECT s.canonical_name, s.common_name, s.family, s.height_max_m, ...
FROM species_fts fts
JOIN silver_species s ON fts.rowid = s.rowid
WHERE fts MATCH ?1                           -- text search (FTS5)
  AND s.hardiness_zone_min >= ?2             -- structured filter
  AND s.hardiness_zone_max <= ?3
  AND s.height_max_m <= ?4
  AND (s.tolerates_full_sun = 1 OR s.tolerates_semi_shade = 1)
ORDER BY fts.rank
LIMIT ?5
```

**Cursor-based pagination** (not offset): Return a cursor token with each page. The cursor encodes the last row's sort key. Next page query uses `WHERE rank > cursor_rank`. This is O(1) regardless of page depth, unlike OFFSET which is O(n).

**Indexes needed on core DB** (created by prepare-db script):
- FTS5 virtual table on text fields
- B-tree indexes on: `hardiness_zone_min`, `hardiness_zone_max`, `height_max_m`, `growth_rate`, `life_cycle`, `nitrogen_fixation`, `family`

### Data Preparation (pre-build script)

`scripts/prepare-db.py`:
1. Read export DB from `/projects/canopi-data/data/exports/`
2. Create **core DB**: select essential columns (~40 most-used fields)
3. Build FTS5 virtual table + B-tree indexes on filter columns
4. Copy `species_common_names` table (all languages) + `species_relationships` + `species_uses`
5. Populate `translated_values` for all 6 languages (en, fr, es, pt, it, zh)
6. VACUUM + analyze
7. Copy to `desktop/resources/canopi-core.db`
8. Create **full DB**: all 167 columns, same indexes → upload to GitHub Releases

---

## Canvas System

**Technology: Konva.js (imperative API, managed by CanvasEngine)**

Why Konva:
- Performant HTML5 Canvas rendering (handles thousands of objects)
- Built-in drag-and-drop, zoom, pan
- Layer system maps directly to our needs (soil layer, plant layer, water layer, etc.)
- Serializable stage (toJSON/fromJSON) → maps cleanly to .canopi format
- Large community, well-maintained
- Imperative API gives direct control over rendering (critical for design tools)

### Canvas Toolbar (left side of canvas area, vertical)

**Selection & Navigation**
- **Pointer/Select** (V) — Click to select, Shift+click to multi-select, drag rubber band for area selection
- **Hand/Pan** (H / Space+drag) — Grab and pan the canvas
- **Zoom** (+/- / Ctrl+scroll) — Zoom in/out, zoom to fit (Ctrl+0), zoom to selection (Ctrl+1)

**Drawing Tools**
- **Rectangle** (R) — Draw rectangular zones (beds, structures, paths)
- **Ellipse** (E) — Draw circular/oval zones (ponds, round beds)
- **Polygon** (P) — Click to place vertices, close to complete (irregular beds, property boundary)
- **Freeform** (F) — Freehand drawing for organic shapes (stream paths, natural contours)
- **Line/Polyline** (L) — Straight lines and multi-segment lines (fences, irrigation pipes, swales)
- **Arc** (A) — Curved lines (keyline design, terrace edges)
- **Text** (T) — Place text labels anywhere on canvas

**Measurement & Annotation**
- **Measure** (M) — Click two points to show distance in meters. Click three for angle. Stays visible as annotation.
- **Dimension line** — Attach to edges/points, auto-updates when objects move
- **Area label** — Click a closed shape to display area in m²
- **Arrow** — Directional arrow annotations (water flow, wind direction, access)
- **Callout** — Text box with pointer to a location
- **Image placement** — Drop a photo/image onto the canvas as reference (site photo, satellite image)

**Plant-Specific Tools**
- **Plant stamp** — Select a plant from DB, then click to place repeatedly (batch planting)
- **Pattern fill** — Select an area + a plant species → fill the area with plants at configurable spacing (row spacing, in-row spacing, offset/grid/hex pattern)
- **Spacing tool** — Select multiple plants → distribute evenly along a line or within an area
- **Consortium builder** — Select plants → group as a consortium. Visual indicator shows the consortium boundary.

**Object Operations**
- **Copy/Paste** (Ctrl+C / Ctrl+V) — Duplicate selected objects
- **Duplicate** (Ctrl+D) — Quick duplicate in place with offset
- **Delete** (Delete/Backspace) — Remove selected objects
- **Lock/Unlock** — Prevent accidental movement of placed objects (lock icon toggle)
- **Group/Ungroup** (Ctrl+G / Ctrl+Shift+G) — Combine objects into a group
- **Z-ordering** — Bring to front / Send to back / Bring forward / Send backward
- **Align** — Align selected objects: left, center, right, top, middle, bottom
- **Distribute** — Evenly distribute selected objects horizontally or vertically
- **Rotate** — Free rotation with 15° snap (hold Shift for free rotation)
- **Scale** — Resize with aspect ratio lock (hold Shift to unlock)
- **Flip** — Horizontal / Vertical flip

### Canvas Navigation & Aids

- **Grid** — Configurable grid overlay (snap to grid toggle, grid size in meters: 0.5m, 1m, 2m, 5m)
- **Rulers** — Horizontal and vertical rulers on canvas edges (in meters, scaled to zoom)
- **Guide lines** — Drag from rulers to create alignment guides (snap to guides toggle)
- **Smart guides** — Appear dynamically when dragging objects near alignment with other objects
- **Scale bar** — Always-visible indicator showing real-world distance at current zoom
- **Minimap** — Small overview panel (bottom-right corner) showing entire design with viewport rectangle
- **Level of detail** — When zoomed out, plant icons simplify to colored dots. Zoomed in, show detail icons with labels.

### Keyboard Shortcuts & Command Palette

- **Command palette** (Ctrl+Shift+P) — VSCode-like quick access to all commands by name
- Full keyboard shortcut system for all tools and operations
- Shortcut reference panel (Ctrl+K Ctrl+S)
- All shortcuts shown in tooltips

### Canvas Layers (toggleable)
1. **Base layer** — Background, terrain imagery
2. **Contour layer** — Altitude/elevation lines
3. **Climate layer** — Sun exposure, microclimate zones
4. **Zone layer** — User-drawn zones, beds, paths
5. **Water layer** — Water features, irrigation, swales
6. **Plant layer** — Placed plants (dragged from DB)
7. **Annotation layer** — Labels, measurements, notes

### Compass & Sun Direction (always visible on canvas)

- **North arrow** — Draggable/rotatable compass indicator on the canvas. Defaults to top = north. User can rotate it to match their land orientation. Stored in .canopi file as `north_bearing_deg` (0-360).
- **Sun direction overlay** — Shows sun path arc based on location (lat/lon) and date/season. Computed from solar position algorithms (no API needed — pure math from lat/lon + date). Displays:
  - Sun rise/set direction arrows
  - Peak sun angle indicator
  - Optional shadow projection for placed plants at a given time of day
- Both are computed client-side when a location is set. If no location, user can manually set north bearing and approximate sun direction.
- **Auto + manual override**: When a location is set, sun path is auto-computed from lat/lon + date. User can still drag/adjust the sun direction manually to model custom scenarios (e.g., obstructed sunlight, microclimate adjustments). Manual overrides are saved in the .canopi file.

### .canopi File Format (versioned, forward-compatible)

Designs are saved as `.canopi` files — JSON with a version field for forward compatibility. **Plants are identified by `canonical_name` (TNRS-resolved scientific name)**, not UUIDs, ensuring portability across DB versions.

```typescript
interface CanopiFile {
  version: number              // Schema version (starts at 1), incremented on breaking changes
  name: string
  description?: string
  location?: { lat: number, lon: number, altitude_m?: number }
  north_bearing_deg?: number   // Compass north rotation (0 = top of canvas is north, 90 = east, etc.)
  layers: Layer[]
  plants: PlacedPlant[]
  zones: Zone[]
  consortiums: Consortium[]              // Plant consortiums
  timeline: TimelineAction[]   // Scheduled actions (soil prep, planting, pruning)
  budget: BudgetItem[]         // Cost tracking
  created_at: string
  updated_at: string
}

interface PlacedPlant {
  canonical_name: string       // TNRS scientific name = stable ID across versions
  position: { x: number, y: number }
  rotation?: number
  scale?: number
  notes?: string
  planted_date?: string
  quantity?: number
}

interface Consortium {              // Plant consortium
  name: string
  plants: string[]             // canonical_names
  notes?: string
}

interface TimelineAction {
  id: string                   // Unique ID for drag/edit operations
  type: "soil_prep" | "planting" | "pruning" | "harvest" | "maintenance" | "other"
  description: string
  start_date?: string          // ISO date (e.g., "2026-03-15")
  end_date?: string            // ISO date. If absent, action is a point-in-time event.
  recurrence?: "one_time" | "yearly" | "seasonal"  // Repeat pattern
  plants?: string[]            // canonical_names involved
  zone?: string                // Zone/bed name on canvas this applies to
  depends_on?: string[]        // IDs of actions that must complete first
  completed: boolean
  order: number                // Vertical display order in timeline
}

interface BudgetItem {
  category: "plant" | "material" | "labor" | "tool" | "other"
  description: string
  quantity: number
  unit_cost: number
  currency: string             // Default: EUR
}
```

**Forward compatibility strategy**: New versions add optional fields. Old fields are never removed. A `version` field lets the app migrate old files. Unknown fields are preserved on save (round-trip safety).

---

---

## Import / Export

### Design Export Formats

| Format | Purpose | Phase |
|--------|---------|-------|
| **.canopi** (JSON) | Native save format. Full fidelity, versioned, forward-compatible. | 2 |
| **PNG** | Raster image export at configurable DPI (72/150/300). Includes visible layers only. | 2 |
| **SVG** | Vector export. Scalable, editable in Inkscape/Illustrator. | 2 |
| **PDF** | Print-ready layout with title block, legend, scale bar, north arrow, plant list table. A3/A4/custom. | 3 |
| **GeoJSON** | GIS-compatible vector format. Zones/plants as features with properties. Requires location set. | 3 |
| **KML/KMZ** | Google Earth compatible. View design overlaid on satellite imagery. | 4 |
| **Plant list CSV** | Spreadsheet of all placed plants: canonical name, common name, quantity, position, consortium, notes. | 2 |
| **Budget report CSV/PDF** | Export budget tab data as spreadsheet or formatted PDF. | 3 |
| **Timeline iCal (.ics)** | Export timeline actions as calendar events. Import into Google Calendar, Apple Calendar, etc. | 4 |

### Design Import Formats

| Format | Purpose | Phase |
|--------|---------|-------|
| **.canopi** | Open previously saved designs. Forward-compatible loading. | 2 |
| **Background image** (PNG/JPG) | Import site photo, satellite screenshot, or drone image as base layer. Scale/position on canvas. | 2 |
| **GeoJSON** | Import property boundary, existing features, or zones from GIS software. | 3 |
| **KML/KMZ** | Import from Google Earth (traced boundaries, points of interest). | 4 |
| **GPX** | Import GPS tracks (site walk boundary recording). Convert to polygon. | 4 |
| **DXF** (future) | Import from CAD software (AutoCAD, LibreCAD). | future |

### Plant Data Import/Export

- **Export selected plants as CSV/JSON** — From a collection or search result, export plant data for external use
- **Import custom plants** — CSV import for adding local varieties not in the database. Template provided. Fields: canonical_name, common_name, family, height_min_m, height_max_m, hardiness_zone_min, hardiness_zone_max, notes.

### Print Layout System (PDF Export)

When exporting to PDF, the user configures a print layout:
- **Paper size**: A4, A3, A2, A1, Letter, Tabloid, Custom
- **Orientation**: Portrait / Landscape
- **Title block**: Project name, designer name, date, scale, location
- **Legend**: Auto-generated from used plant species and zone types with colors/icons
- **Scale bar**: Based on canvas scale and paper size
- **North arrow**: From canvas
- **Plant schedule table**: List of all plants with quantities, spacing, consortium assignments
- **Notes section**: User-defined text area
- **Multiple sheets**: If design is large, split across pages with overlap marks

---

## Map Integration

**Technology: MapLibre GL JS** with offline tile packs

- Renders vector maps in WebGL (fast, smooth)
- Supports offline via pre-downloaded tile packs (.mbtiles or PMTiles)
- Terrain/elevation overlay support built-in
- Open-source (no API key needed, unlike Mapbox)
- For the World Map panel: show pins for showcased designs
- For the Canvas: optional base map layer under the design

### Offline Tile Strategy
- Bundle a low-zoom world tile set (~50MB) for the World Map
- Allow users to download regional high-zoom packs for their design location
- Elevation data: use open DEM data (SRTM, Copernicus) served as raster tiles

---

## Internationalization (i18n)

### Supported Languages
**English (en), French (fr), Spanish (es), Portuguese (pt), Italian (it), Chinese Simplified (zh)**

### Approach
- **UI strings**: i18next (core, no framework wrapper) with JSON translation files per language. Locale signal drives changes.
- **Plant common names**: Already multilingual in DB for en (211K), fr (179K), es (210K), pt (170K), it (170K). **Chinese common names (zh) need to be sourced and added** — this is a data pipeline task for canopi-data.
- **Categorical fields**: `translated_values` table populated for all 6 languages
- **Locale detection**: System locale via Rust (platform-native), user override via language picker in status bar
- **Language picker**: Dropdown/selector in status bar showing all 6 languages (not just a toggle)
- **Fallback chain**: zh → en, es → en, pt → en, it → en, fr → en (English as ultimate fallback)

### Translation Work Needed
1. UI strings — create JSON files for all 6 languages (en.json, fr.json, es.json, pt.json, it.json, zh.json)
2. Categorical plant field values — populate `translated_values` for all 6 languages
3. Learning content — author in all 6 languages (start with en + fr, translate to others)
4. Chinese common names — source from botanical databases and add to canopi-data pipeline
5. Chinese UI requires CJK font stack consideration (Noto Sans SC / PingFang SC / Microsoft YaHei)

---

## Native API Layer

Native libraries provide higher performance and deeper OS integration than Tauri plugins alone. Claude Code handles the FFI complexity across all three platforms.

### Why Native Libs (not just Tauri plugins)

| Capability | Tauri Plugin | Native Lib Advantage |
|-----------|-------------|---------------------|
| PDF export | No built-in | **PDFKit** (macOS), **DirectWrite** (Windows), **Cairo** (Linux): native PDF rendering with proper typography, vector graphics, print-ready output |
| High-DPI image export | JS Canvas toDataURL (slow, memory-limited) | **Core Graphics/Metal** (macOS), **Direct2D** (Windows), **Cairo/Skia** (Linux): hardware-accelerated rendering, handles 10000x10000px+ exports without memory issues |
| Thumbnail generation | None | Native thumbnail providers: .canopi files show preview in Finder/Explorer/Nautilus |
| File type association | Basic | Full OS integration: .canopi opens in Canopi, custom icon in file browser |
| Search indexing | None | **Spotlight** (macOS), **Windows Search** (Windows): users can find designs by name/location/plants |
| File watching | `tauri-plugin-fs-watch` (polling) | **FSEvents** (macOS), **ReadDirectoryChanges** (Windows), **inotify** (Linux): kernel-level, zero-overhead |
| Stylus/pen input | Basic pointer events | **Windows Ink** API: pressure sensitivity, tilt, eraser end. Better for drawing on canvas. |
| Taskbar/Dock | Basic | Progress bars during DB download, badge counts, jump lists (recent files) |
| Native menus | `tauri-plugin-menu` | Proper platform-native app menus with system shortcuts, services menu (macOS) |

### Tauri Plugins (still used for)

| Need | Plugin |
|------|--------|
| File dialogs | `tauri-plugin-dialog` |
| System theme | `window.theme()` |
| Auto-start | `tauri-plugin-autostart` |
| Notifications | `tauri-plugin-notification` |
| Single instance | `tauri-plugin-single-instance` |
| Auto-updater | `tauri-plugin-updater` |
| Shell/open | `tauri-plugin-shell` |

### Per-Platform Responsibilities

**macOS (lib-swift via swift-bridge)**
```
FileSystem.swift       → Spotlight indexing, Quick Look preview, FSEvents file watching
Rendering.swift        → Core Graphics high-DPI PNG/SVG export, Metal-accelerated canvas export
PDF.swift              → PDFKit: native PDF with print layout, title block, vector graphics
SystemIntegration.swift → NSMenu (app menu bar), Dock badge, Touch Bar, .canopi file association
```

**Windows (lib-cpp via cxx)**
```
filesystem.cpp   → Shell thumbnail provider, file association, ReadDirectoryChanges watching
rendering.cpp    → Direct2D high-DPI export, WIC image encoding
pdf.cpp          → DirectWrite PDF rendering with typography
system.cpp       → Taskbar progress, Jump List (recent files), Windows Ink stylus input
```

**Linux (lib-c via cc/bindgen)**
```
filesystem.c     → inotify file watching, XDG dirs, .desktop file generation, freedesktop thumbnails
rendering.c      → Cairo high-DPI export, Pango text rendering
pdf.c            → Cairo PDF surface for vector PDF generation
system.c         → DBus integration, desktop portal APIs, Wayland/X11 clipboard
```

---

## Frontend / UI / UX (canopi-ux)

All UI/UX decisions below are encoded in the `canopi-ux` skill and guide every implementation choice.

### Visual Design Language — Hybrid (professional structure + organic warmth)

**Color palette:**
- Primary: `#2D5F3F` (forest green) — authority, nature, trust
- Secondary: `#64748B` (slate) — neutral, professional
- Accent: `#D4A843` (golden) — sunlight, attention, warmth
- Light BG: `#F8F6F3` (warm white)
- Dark BG: `#1C2127` (warm dark)
- Success: `#22C55E` — companion compatibility, completed actions
- Warning: `#EAB308` — caution, partial compatibility
- Danger: `#EF4444` — antagonist plants, destructive actions

**Design tokens:**
- Border radius: 6px
- Shadows: subtle, directional (not flat, not heavy)
- Icons: clean geometric with botanical touches (leaf, seedling, tree silhouettes)
- Spacing: 4px base unit (4, 8, 12, 16, 24, 32, 48)
- Typography: system font stack (Inter / SF Pro / Segoe UI / Noto Sans / Noto Sans SC / PingFang SC / Microsoft YaHei), 13px base
- Botanical names: italic, slightly different style from common names
- All tokens as CSS variables → easy to theme

### Dark Mode — Warm Dark

- Canvas BG: `#1A1D21`
- Panel BG: `#252830`
- Borders: `#3A3F4B`
- Text: `#E1E4E8` (not pure white — reduces eye strain)
- Shadows → subtle glow effects in dark mode
- Plant icons: +10% saturation boost for visibility
- Maps: MapLibre dark tile style
- All colors tested against WCAG AA contrast ratios

### First-Time Experience — Wizard + Optional Tour

**Welcome wizard (~15 seconds):**
1. "Choose your language" — 6 language options with flag icons: English, Français, Español, Português, Italiano, 中文
2. "Where are you?" — Optional pin on map. Skip button prominent. Enables sun/climate features.
3. "What do you want to do?" — Quick start templates:
   - "Design a food forest" → pre-configured canvas with strata guides
   - "Plan a kitchen garden" → smaller-scale canvas with bed templates
   - "Explore the plant database" → opens Plant DB panel
   - "Open an existing design" → native file dialog

**Optional interactive tour (~60 seconds, offered after wizard):**
- "Want a quick tour?" [Yes, show me] [No, I'll explore]
- Highlight-based walkthrough: activity bar → plant DB → canvas → drag a plant
- Tracked in user DB — shows offer once per user, never again

### Animation & Motion — Minimal

- Animate ONLY when it prevents disorientation: zoom, panel open/close
- All transitions instant or near-instant (<100ms)
- No decorative animations (no bounce, no stagger, no shimmer)
- Focus on raw performance feel — the app should feel FAST
- Always respect `prefers-reduced-motion` system setting

### Plant Cards — Hybrid Icons + Text

```
┌─────────────────────────────────┐
│ Lavandula angustifolia          │
│ Lavender          Lamiaceae     │
│ ☀ Zone 5-9   ↕ 0.3-0.6m       │
│ Edible · Medicinal · Low       │
└─────────────────────────────────┘
```
- Small icons for sun tolerance, hardiness zone, height
- Text for uses, stratum, family
- Botanical name first (bold), common name below (locale-specific)
- Draggable row with subtle drag handle on left

### Canvas Interaction — Figma-like

| Action | Input |
|--------|-------|
| Pan | Space+drag (any tool active), inertia on release |
| Zoom | Ctrl+scroll toward cursor, pinch-to-zoom on trackpad |
| Select | Click, Shift+click, rubber band on empty space |
| Cycle overlapping | Tab |
| Constrain to axis | Hold Shift while dragging |
| Precision mode | Hold Alt (slower movement) |
| Disable snap | Hold Alt |
| Paste | At cursor position |
| Duplicate | Ctrl+D, 20px diagonal offset |
| Context menu | Right-click on any element |

**Smart guides**: Appear when aligning with other objects. Show distance indicators. Magnetic snap.

### Empty States — Helpful with CTAs

Every panel has a thoughtful empty state that guides the user forward:

| Panel | Empty State |
|-------|------------|
| Plant DB | "Search 175,000+ plants by name, family, or use" + popular search chips: [Fruit trees] [Nitrogen fixers] [Shade tolerant] [Edible] |
| Canvas (new) | Subtle grid + north arrow. "Set a location to enable map layers, or start drawing" + [Set location] [Start drawing] buttons |
| World Map | World map visible. "Be the first to share a design in your area!" |
| Learning | Topic list with icons. "Learn techniques from soil prep to syntropy" |
| Saved Designs | "Your designs will appear here" + [Create your first design] button |
| Consortium tab | "Add plants to see consortium suggestions and compatibility" |
| Timeline | "Plan your season — add soil prep, planting dates, pruning schedules" |
| Budget | "Track costs for plants, materials, and labor" |
| Search (no results) | "No plants match. Try removing [specific filter]" with per-filter clear buttons |

### Panel Resize — Full Resize with Memory

- Activity bar: fixed 48px width
- Main content: fills remaining space
- Right panel (plant detail): drag to resize. Min 250px, max 40% window. Remembers width.
- Bottom panel (timeline/consortium/budget): drag to resize height. Min 150px, max 50% canvas. Remembers height.
- Double-click divider: snap to default size
- All sizes persisted in user DB across sessions

### Accessibility — Full WCAG AA

- **Keyboard-first**: Every feature reachable via Tab/Shift+Tab, arrow keys, Enter. Test by unplugging mouse.
- **32px minimum click targets** (44px on touch-capable devices)
- **ARIA labels** on all interactive elements
- **Focus indicators**: Visible focus rings, focus moves to new panel's first element on switch
- **Color-blind friendly**: Never color alone. Always icon + color for companion/antagonist indicators.
- **Screen reader announcements**: "Design saved", "Plant added to canvas", "3 plants selected"
- **`prefers-reduced-motion`**: Disables all transitions
- **High contrast mode**: Toggle in settings, boosted contrast ratios

### Localization — Full Locale Awareness (6 languages)

- **Language picker** always visible in status bar — dropdown with all 6 languages (not buried in settings)
- **Plant display**: Botanical name (italic) always shown. Common name in user's locale below it. If no common name in locale, fallback to English then show "(no translation)".
- **Date formats per locale**:
  - en: MM/DD/YYYY
  - fr: DD/MM/YYYY
  - es: DD/MM/YYYY
  - pt: DD/MM/YYYY
  - it: DD/MM/YYYY
  - zh: YYYY年MM月DD日
- **Number formats per locale**:
  - en: 1,500.50 USD
  - fr: 1 500,50 EUR
  - es: 1.500,50 EUR
  - pt: 1.500,50 BRL
  - it: 1.500,50 EUR
  - zh: 1,500.50 CNY
- **Currency**: Default per locale, user-configurable in settings
- **System locale auto-detect** on first launch, user override via status bar picker
- **CJK support**: Chinese requires wider character spacing, font stack includes Noto Sans SC / PingFang SC / Microsoft YaHei. UI layout tested with Chinese strings (often longer than Latin).
- **Layout direction**: All 6 languages are LTR. No RTL support needed currently.

### Performance Perception — Full Optimistic UI

- **Skeleton screens**: Show layout shape immediately, fill content as data arrives
- **Instant cache results**: Search results appear from cache immediately, update when IPC responds
- **Prefetch on hover**: Hovering a plant in list prefetches detail data
- **Progressive list loading**: First 50 items render, more on scroll
- **Background IPC**: Database operations NEVER block UI thread
- **Preload adjacent panels**: When on Plant DB, preload Canvas component in background

### Discoverability Features (for all ages and tech literacy)

**Command palette (Ctrl+Shift+P):**
- VSCode-style search-all-commands interface
- Every tool, action, setting, shortcut searchable by name
- Shows keyboard shortcut next to each command
- Essential for power users, but also helps beginners discover features they didn't know existed

**Contextual plant suggestions:**
- When placing a plant near others on canvas, show compatibility indicator (green/yellow/red border glow)
- Tooltip explains WHY: "Walnut trees release juglone which inhibits tomato growth"
- Suggest good companions: "Consider adding comfrey (nutrient accumulator) near this fruit tree"
- Teaches agroecology principles IN CONTEXT as the user designs

**Right-click context menus:**
- Every canvas element has a right-click menu with all available actions
- Critical for users who don't know keyboard shortcuts
- Menus show keyboard shortcuts next to each action (teaches shortcuts over time)

**Zoom-level-appropriate labels:**
- Wide zoom (>50 plants visible): show colored dots by stratum
- Medium zoom (10-50 plants visible): show plant name labels
- Close zoom (<10 plants visible): show name + key info (height, uses)
- User never gets lost regardless of zoom level

**Undo confirmation for destructive actions:**
- "Delete 5 plants from canvas?" confirmation dialog
- "This design has unsaved changes. Save before closing?" on window close
- Power users can disable confirmation dialogs in settings ("Don't ask again" checkbox)

## Performance Strategy

- **Virtual scrolling** (@tanstack/react-virtual) for plant DB list — only renders visible rows, handles 175K records
- **Level-of-detail rendering** — Canvas simplifies plant icons to colored dots at low zoom, shows full icons at medium zoom, shows icons + labels at high zoom
- **Lazy loading** — Plant detail data fetched on demand (only identity fields loaded in list view)
- **Debounced IPC** — Search queries debounced 300ms. Filter changes batched before querying.
- **Web Workers** — Heavy client-side computations (sun path calculation, pattern fill generation) offloaded to Web Workers to keep UI responsive
- **Canvas viewport culling** — Konva only renders objects within the visible viewport area
- **Image caching** — Plant icons and map tiles cached in memory and on disk
- **Prepared statements** — Rust backend uses prepared SQL statements, reused across queries

## Accessibility

- **Keyboard navigation** — All UI elements reachable via Tab/Shift+Tab. Arrow keys for lists. Enter to activate.
- **ARIA labels** — All interactive elements have proper ARIA attributes
- **Focus indicators** — Visible focus rings on all interactive elements
- **Screen reader support** — Plant info panels, search results, and tool names announced correctly
- **Contrast ratios** — WCAG AA compliant minimum. High contrast mode toggle in settings.
- **Zoom** — UI text respects system font size preferences

---

## Test & Release Process

### Testing Pipeline (every PR and push to main)

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Actions CI                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. LINT & FORMAT (fast, catches obvious issues)             │
│     ├─ cargo fmt --check                                     │
│     ├─ cargo clippy -- -D warnings                           │
│     ├─ npm run lint (eslint + tsc --noEmit)                  │
│     └─ css-modules type check                                │
│                                                              │
│  2. UNIT TESTS (parallel across all platforms)               │
│     ├─ cargo test --workspace (Rust: DB queries, .canopi     │
│     │   serialization, version migration, query builder)     │
│     ├─ npm test (Vitest: canvas engine, undo/redo commands,  │
│     │   tool logic, serializer, solar math, state signals)   │
│     └─ Native lib tests (platform-specific):                 │
│         macOS: swift test (rendering, PDF, Spotlight)         │
│         Windows: ctest (Direct2D, PDF, Shell integration)    │
│         Linux: make test (Cairo, inotify, DBus)              │
│                                                              │
│  3. INTEGRATION TESTS                                        │
│     ├─ Tauri IPC round-trip tests: invoke commands from      │
│     │   test harness, verify responses match expected types   │
│     ├─ DB integration: open real canopi-core.db, run search  │
│     │   queries, verify result counts and field correctness   │
│     ├─ .canopi file round-trip: create design → save →       │
│     │   reload → verify identical (including unknown fields)  │
│     └─ Version migration: load v1 file in v2 code → verify   │
│                                                              │
│  4. BUILD (parallel matrix)                                  │
│     ├─ macOS arm64:    cargo tauri build --target aarch64    │
│     ├─ macOS x86_64:   cargo tauri build --target x86_64    │
│     ├─ Windows x64:    cargo tauri build                     │
│     ├─ Linux x64:      cargo tauri build                     │
│     └─ Linux arm64:    cargo tauri build --target aarch64    │
│                                                              │
│  5. E2E TESTS (on built artifacts, per platform)             │
│     ├─ Launch app binary → verify window opens               │
│     ├─ Playwright: search a plant → verify results           │
│     ├─ Playwright: create design → add plant → save          │
│     ├─ Playwright: reload saved design → verify plants       │
│     ├─ Playwright: switch locale → verify UI updates         │
│     ├─ Playwright: toggle dark/light theme                   │
│     ├─ Verify native integration:                            │
│     │   macOS: .canopi file association works                 │
│     │   Windows: thumbnail generation works                  │
│     │   Linux: .desktop entry valid                          │
│     └─ Memory/performance check: open app, load 1000 plants  │
│         on canvas → verify <500MB RSS, <2s render            │
│                                                              │
│  6. ARTIFACT SIGNING                                         │
│     ├─ macOS: code sign + notarize (Apple Developer ID)      │
│     ├─ Windows: Authenticode signing (code signing cert)     │
│     └─ Linux: GPG sign .AppImage and .deb                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Release Process (tag-triggered)

```
Git tag v1.2.3 → triggers release workflow:

1. FULL TEST SUITE (all 6 steps above must pass)

2. BUILD RELEASE ARTIFACTS
   ├─ macOS:   universal .dmg (arm64 + x86_64 merged via lipo)
   ├─ Windows: .msi installer + portable .exe
   ├─ Linux:   .AppImage + .deb (x64 and arm64)
   └─ All:     canopi-full.db (full plant DB for download)

3. SMOKE TEST RELEASE ARTIFACTS
   ├─ Install on clean VM (macOS, Windows, Ubuntu)
   ├─ Launch app → verify startup < 3 seconds
   ├─ Open bundled plant DB → search works
   ├─ Create and save a design → .canopi file valid
   ├─ Verify auto-updater manifest is correct JSON
   └─ Verify native integrations (file association, thumbnails)

4. PUBLISH
   ├─ Create GitHub Release with changelog
   ├─ Upload all signed artifacts
   ├─ Upload latest.json (Tauri auto-updater manifest)
   ├─ Upload canopi-full.db to release assets
   └─ Update download links on website (if exists)

5. POST-RELEASE VERIFICATION
   ├─ Install from GitHub Release on each platform
   ├─ Verify auto-updater detects the new version
   └─ Monitor for crash reports (first 24 hours)
```

### Version Strategy

- **Semantic versioning**: `MAJOR.MINOR.PATCH`
  - MAJOR: Breaking .canopi file format changes (user must explicitly migrate)
  - MINOR: New features, non-breaking file format additions
  - PATCH: Bug fixes, performance improvements
- **.canopi file version** is separate from app version. File format version only increments on schema changes.
- **Auto-updater**: Checks `latest.json` on GitHub Releases. Users can disable in settings. Updates are downloaded in background, installed on next launch.

### CI Infrastructure

**GitHub Actions runners:**
- macOS: `macos-14` (Apple Silicon) + `macos-13` (Intel) for universal binary
- Windows: `windows-latest`
- Linux: `ubuntu-22.04` (x64) + self-hosted ARM runner for arm64

**Secrets required:**
- `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD` — macOS code signing
- `APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID` — macOS notarization
- `WINDOWS_CERTIFICATE` + `WINDOWS_CERTIFICATE_PASSWORD` — Authenticode signing
- `GPG_PRIVATE_KEY` — Linux artifact signing
- `TAURI_SIGNING_PRIVATE_KEY` — Tauri auto-updater signature

**Caching (speeds up CI by ~60%):**
- Rust: `~/.cargo/registry`, `target/` keyed by `Cargo.lock` hash
- Node: `node_modules/` keyed by `package-lock.json` hash
- Tauri: pre-built WiX (Windows), pre-installed deps (Linux)

### Quality Gates (PRs cannot merge unless)

1. All lint checks pass (cargo fmt, clippy, eslint, tsc)
2. All unit tests pass on all 3 platforms
3. All integration tests pass
4. Build succeeds on all 5 targets (macOS arm64/x64, Windows x64, Linux x64/arm64)
5. E2E tests pass on all 3 platforms
6. No new `unsafe` code without explicit review comment
7. .canopi file round-trip test passes (backward compatibility)
8. Bundle size regression check: alert if installer grows >10% vs previous release

### Build Artifacts

| Platform | Artifact | Signed | Size Target |
|----------|----------|--------|-------------|
| macOS | `Canopi-{version}-universal.dmg` | Apple notarized | < 250MB |
| Windows | `Canopi-{version}-x64.msi` | Authenticode | < 250MB |
| Windows | `Canopi-{version}-x64-portable.exe` | Authenticode | < 250MB |
| Linux | `Canopi-{version}-x86_64.AppImage` | GPG signed | < 250MB |
| Linux | `canopi_{version}_amd64.deb` | GPG signed | < 250MB |
| Linux | `Canopi-{version}-aarch64.AppImage` | GPG signed | < 250MB |
| All | `canopi-full-{version}.db` | SHA-256 checksum | < 800MB |
| All | `latest.json` | Tauri signed | < 1KB |

---

## MVP Phases

### Phase 0 — Scaffold & Shell
- [ ] Initialize Rust workspace (Cargo.toml, all 5 crates: desktop, common-types, lib-swift, lib-cpp, lib-c)
- [ ] Set up Platform trait + conditional compilation for native libs
- [ ] Set up swift-bridge (macOS), cxx (Windows), cc/bindgen (Linux) build scripts with minimal stubs
- [ ] Scaffold Tauri v2 app with Preact/Vite/TS frontend
- [ ] Set up specta for Rust→TS type generation
- [ ] VSCode-like shell: activity bar (5 icons) + panel switching + status bar
- [ ] Dark/light theme with system detection + toggle
- [ ] i18n setup (i18next core + signals, 6 language JSON files, language picker dropdown in status bar)
- [ ] Command palette skeleton (Ctrl+Shift+P)
- [ ] Keyboard shortcut system foundation
- [ ] Settings system: user.db schema with defaults table, settings IPC commands
- [ ] Startup sequence: show UI shell <500ms, lazy DB open in background, `db_ready` event
- [ ] Application logging: `tracing` crate setup, log rotation, crash handler
- [ ] CI pipeline: GitHub Actions building on macOS, Windows, Linux
- [ ] `git init`, set remote to `https://github.com/naejin/canopi`, CLAUDE.md, LICENSE

### Phase 1 — Plant Database
- [ ] `scripts/prepare-db.py`: Generate core DB (~200MB) from canopi-data exports with FTS5 indexes
- [ ] Bundle core DB with Tauri app (resource bundling)
- [ ] Rust DB module: Arc<Connection> (plant, read-only) + Mutex<Connection> (user, writable), rusqlite bundled, prepared statements
- [ ] Rust IPC commands: `search_species` (FTS5), `get_species_by_id`, `get_species_relationships`
- [ ] Rust query layer: multi-field filtering (hardiness, height, sun, soil, growth rate, life cycle, edible, nitrogen fixer, stratum, family, uses)
- [ ] Pagination: cursor-based for performance on 175K records
- [ ] Plant DB panel UI:
  - [ ] Search bar (debounced 300ms, FTS5 backend)
  - [ ] Filter sidebar (collapsible) with all filter categories
  - [ ] View modes: list view (default), card/grid view, table view
  - [ ] Sort: by name, family, height, hardiness zone, growth rate
  - [ ] Virtual-scrolled results list (@tanstack/react-virtual)
  - [ ] Drag handle on plant rows (HTML5 DnD data transfer)
- [ ] PlantDetailCard component (reusable across DB view + canvas right panel):
  - [ ] Botanical name, common name (locale-specific), family, genus
  - [ ] Dimensions, hardiness zone, growth rate, tolerances
  - [ ] Uses (edible, medicinal, other), cultivation notes
  - [ ] Syntropic classification (stratum, succession stage)
  - [ ] Relationship list (companions, antagonists)
- [ ] Multilingual display: common names from multilingual table (en/fr/es/pt/it, zh pending), categorical values translated
- [ ] Translate categorical values for all 6 languages (populate `translated_values` table in prepare-db script)
- [ ] Chinese common names: source and add to canopi-data pipeline (new data task)
- [ ] Favorites: star/bookmark plants (stored in user DB)
- [ ] Recently viewed: auto-tracked last 50 plants

### Phase 2 — Design Canvas (Core) — COMPLETED
- [x] Konva.js Stage + Layer setup via imperative CanvasEngine (not react-konva)
- [x] Canvas navigation: scroll-up zoom in (Figma convention), pan (Space+drag / Hand tool), zoom to fit
- [x] Grid overlay: adaptive density via "nice distances" ladder, snap-to-grid toggle. Custom `sceneFunc` for performance.
- [x] Rulers: HTML `<canvas>` elements (NOT Konva layers) — always in screen space, zero transform lag
- [x] Scale bar: always-visible, auto-picks round distance, counter-scaled on UI layer
- [x] Canvas toolbar (vertical, left of canvas):
  - [x] Pointer/Select (V) — click, Shift+click multi-select, rubber band area select. Parent-walk for groups.
  - [x] Hand/Pan (H)
  - [x] Rectangle (R), Ellipse (E), Polygon (P), Freeform (F) — all with `strokeScaleEnabled: false`
  - [x] Line/Polyline (L)
  - [x] Text (T) — HTML textarea overlay, counter-scaled Konva.Text on commit
  - [x] Measure (M) — distance with counter-scaled label pills
  - ~~Plant stamp~~ → **Deferred to Phase 3** (needs species picker UI)
- [x] Object operations: copy/paste (recursive Group serialization), duplicate, delete, rotate (15° snap), scale, flip
- [x] Lock/unlock objects
- [x] Z-ordering: bring to front, send to back
- [x] Layer system: 7 layers, visibility + lock toggle in layer panel. Water/contours/climate greyed out (Phase 3).
- [x] **Drag-and-drop** plants from DB panel onto canvas (DOM→Konva via setPointersPositions). Compact green pill drag preview via `setDragImage()`.
- [x] Plant placement: fixed-size screen-pixel circles (8px radius) with strata colors. Common name + botanical abbreviation labels. Counter-scaled at group level — zero zoom lag.
- [x] **Multi-select**: Shift+click, rubber band drag-select, Transformer on same layer as targets.
- [x] **Undo/Redo**: True command pattern (500 command cap). AddNode/RemoveNode/MoveNode/TransformNode/Batch commands. `record()` for post-drag logging.
- ~~Right side panel~~ → **Removed** (redundant with Plant DB sidebar; Phase 3: highlight plant in DB on canvas click)
- [x] .canopi file format v1:
  - [x] Save (Ctrl+S) — JS `save()` dialog (NOT Rust `blocking_save_file` — deadlocks on Linux GTK)
  - [x] Save As (Ctrl+Shift+S) — JS `save()` dialog
  - [x] Open (Ctrl+O) — JS `open()` dialog
  - [x] Forward-compatible loading: `#[serde(flatten)] extra: HashMap<String, Value>`
  - [x] Plant ID by `canonical_name` + `common_name` stored in file
  - [x] Recent files in user DB
- [x] Export: PNG (Konva `toDataURL`, native rendering deferred to Phase 3), SVG (manual Konva→SVG mapping), CSV plant list
- [x] Import: Background image (PNG/JPG) on zones layer — scaled to 50m, centered in viewport, draggable
- ~~Native file watching~~ → **Deferred to Phase 3**
- [x] **North arrow**: Compass rose widget (red/grey needle triangles), draggable, scroll-wheel rotatable
- ~~Sun direction~~ → **Deferred to Phase 3**
- [x] Bottom panel (collapsible, resizable):
  - [x] Timeline tab — table-based CRUD for TimelineAction items
  - [x] Consortium tab — manual consortium CRUD + companion/antagonist display
  - [x] Budget tab — table CRUD with auto-total, currency selector
  - (Full Gantt-like interactive timeline deferred to Phase 3)
- [x] Dark/light canvas theme adaptation — CSS token-driven, grid/ruler colors cached and refreshed on theme change
- [x] Level-of-detail rendering: dot → icon → icon+label based on zoom. Group-level counter-scale for zero-lag zoom.
- [x] **Plant symbols**: Fixed screen-pixel circles with strata colors. Common name primary, botanical abbreviation secondary. Locale-aware labels (batch IPC lookup on language change).
- [x] **Auto-save**: 60-second timer, silent IPC to autosave dir
- [x] **Unsaved changes indicator**: amber dot in custom title bar + "Save before closing?" dialog
- [x] **.canopi.prev backup**: atomic write (tmp → rename) + .prev copy before overwrite
- [x] **Custom title bar**: Canopi logo + file name + window controls (minimize/maximize/close). `decorations: false` + `startDragging()` API.
- [x] **Canvas locked before design**: no tools, grid, rulers, or chrome until New Design or Open. Clean welcome state with Canopi logo.
- [x] **Plant DB as sidebar**: opens alongside canvas (not replacing it) for drag-and-drop. Resizable via drag handle (320-800px).
- ~~Saved Designs panel~~ → **Removed** (redundant with OS file dialog; recent files in empty state for Phase 3)

### Phase 3 — Canvas Advanced + Location
- [ ] Guide lines: drag from rulers, snap-to-guides toggle
- [ ] Smart guides: dynamic alignment indicators during drag
- [ ] Align: left/center/right/top/middle/bottom for selected objects
- [ ] Distribute: even horizontal/vertical distribution
- [ ] Group/Ungroup (Ctrl+G / Ctrl+Shift+G)
- [ ] **Plant stamp tool**: Select a species from the DB, then click repeatedly on canvas to place multiple instances. Requires a species picker UI (toolbar dropdown or DB sidebar "Set as stamp" button) that writes to a `plantStampSpecies` signal. Currently plants are placed via drag-and-drop only.
- [ ] Pattern fill: select area + species → fill with plants at configurable spacing (grid/hex/offset)
- [ ] Spacing tool: distribute plants evenly along line or within area
- [ ] Consortium builder: select plants → group as consortium with visual boundary
- [ ] Arrow annotation tool
- [ ] Callout/text box annotation
- [ ] Dimension lines (attached to objects, auto-update)
- [ ] Minimap: overview panel (bottom-right) with viewport rectangle
- [ ] Location input: lat/lon manual entry + interactive map pin drop (MapLibre popup)
- [ ] MapLibre base map layer on canvas (below design layers, toggleable)
- [ ] Elevation/contour layer (open DEM data: SRTM/Copernicus raster tiles)
- [ ] Climate data overlay (temperature zones, rainfall heatmap)
- [ ] Layer toggle UI for all map data layers
- [ ] Shadow projection: compute and display shadow cast by placed plants at given time/date
- [ ] **Plant display modes ("Display by")**: Dropdown in canvas toolbar to change how plants render:
  - Default (current): Fixed-size screen-pixel circles with strata colors — optimized for readability
  - **Canopy spread**: Circles sized to real `width_max_m` from the plant DB — shows actual canopy coverage and overlap. Uses the `data-canopy-spread` attr already stored on each plant group.
  - **Thematic coloring ("Color by")**: Recolor circles by attribute — stratum (default), hardiness zone (blue gradient), life cycle, soil type, edibility, nitrogen fixation, sun tolerance. Requires batch SpeciesDetail lookup (cache results), color legend panel.
  Architecture: `plantDisplayMode` signal, `width_max_m` already in SpeciesListItem and PlantRow drag data, `updatePlantDisplay()` function.
- [ ] **Canvas rotation**: Allow rotating the viewport (not just the compass bearing). Requires updating all coordinate transforms (drawing, selection, snap-to-grid, rulers, serialization). Best implemented alongside MapLibre integration which handles rotation natively.
- [ ] **Native file watching**: Detect external .canopi file changes (FSEvents/ReadDirectoryChanges/inotify) and prompt reload.
- [ ] **Sun direction widget**: Auto-computed from lat/lon + date using solar position math. Manual override via drag. Sunrise/set arrows + peak angle indicator.
- [ ] **Native high-DPI PNG export**: Core Graphics (macOS) / Direct2D (Windows) / Cairo (Linux) — configurable DPI up to 300.
- [ ] **Growth timeline slider**: Year 0→1→2→5→10→20→Mature. Plant symbols scale dynamically. Canopy coverage visualization. Succession progression for syntropy.
- [ ] **PDF export via native libs**: PDFKit (macOS) / DirectWrite (Windows) / Cairo (Linux) — print layout with title block, legend, scale bar, north arrow, plant schedule. Vector output, proper typography.
- [ ] GeoJSON export (zones + plants as features with properties, requires location)
- [ ] Budget report CSV/PDF export
- [ ] GeoJSON import (property boundary, existing features)
- [ ] Collections: user-defined plant lists, drag plants into collections
- [ ] Plant comparison view: side-by-side 2-4 plants
- [ ] Relationship graph: visual network of companions/antagonists for selected plant
- [ ] Similar plants: "Show similar" button on plant detail
- [ ] Search presets: quick filter buttons (food forest canopy, ground cover, pollinator, windbreak, nitrogen fixers)
- [ ] Saved searches: save filter combinations by name

### Phase 4 — World Map, Showcase & Advanced DB
- [ ] World Map panel: MapLibre GL JS with bundled low-zoom tiles (~50MB)
- [ ] Pin-based browsing: showcase designs as markers with popup previews
- [ ] Import/export .canopi files for sharing
- [ ] Initial curated showcase designs (created by you + contributors)
- [ ] Full plant DB download: in-app option (Settings), background download with progress, checksum verification
- [ ] Custom plants: add local varieties not in DB (stored in user DB). CSV import with template.
- [ ] User notes on any plant species (stored in user DB)
- [ ] Tags: user-defined tags on plants
- [ ] Seasonal calendar per species: sow/transplant/harvest/prune timing based on zone + location
- [ ] KML/KMZ export (Google Earth compatible)
- [ ] KML/KMZ import
- [ ] GPX import (GPS tracks → polygon boundaries)
- [ ] Timeline iCal export (.ics calendar events)
- [ ] Regional high-zoom tile packs: download for design location

### Phase 5 — Learning, Polish & Release
- [ ] Learning panel: Markdown renderer (react-markdown + rehype-raw) with image support
- [ ] Content in all 6 languages: soil prep, grafting, pruning, syntropy fundamentals, companion planting, keyline design (start with EN + FR, translate to ES/PT/IT/ZH)
- [ ] Learning content as .md files in `content/{locale}/`
- [ ] Saved Designs sidebar: list with thumbnails, last modified date, location
- [ ] Auto-updater integration (Tauri updater plugin + GitHub releases JSON manifest)
- [ ] Single instance enforcement (tauri-plugin-single-instance)
- [ ] User data auto-backup (daily user.db backup, keep 7)
- [ ] Export/import user data (JSON: favorites, collections, notes, tags, settings)
- [ ] Plant DB update migration: canonical_name_redirects table, auto-migrate user references
- [ ] Graceful handling of unknown plants in .canopi files (warning icon, not crash)
- [ ] "Copy debug log" button in Settings for bug reports
- [ ] System tray with quick actions (new design, open recent, quit)
- [ ] Platform-specific native integration:
  - [ ] macOS: native app menu (NSMenu), Dock badge, .canopi file association, Spotlight indexing, Quick Look preview, DMG installer
  - [ ] Windows: .canopi file association, Shell thumbnail provider, taskbar progress (DB download), jump list (recent files), MSI/EXE installer
  - [ ] Linux: .desktop file generation, freedesktop thumbnail spec, XDG file associations, AppImage + .deb
  - [ ] All platforms: native high-DPI thumbnail generation for saved designs sidebar
- [ ] Accessibility pass: keyboard navigation, ARIA labels, focus indicators, contrast ratios
- [ ] Performance profiling: identify and fix bottlenecks (search latency, canvas rendering, memory usage)
- [ ] First GitHub release (v0.1.0)
- [ ] README, screenshots, installation instructions
- [ ] License file (recommend AGPL-3.0 or GPL-3.0 for open-source agroecology mission)

### Future (post-v0.1)
- [ ] DXF import/export (CAD interop)
- [ ] 3D preview (WebGL visualization of the design with plant heights)
- [ ] AI assistant: "suggest plants for this zone" based on location, soil, climate
- [ ] Collaborative editing (when web version exists)
- [ ] Mobile companion app (Tauri v2 supports mobile)
- [ ] Plugin system for community extensions
- [ ] Windows Ink / Apple Pencil: pressure-sensitive drawing on canvas with pen/stylus input via native libs
- [ ] Offline satellite imagery caching for design locations
- [ ] Native canvas rendering bypass: render entire design via Metal/Direct2D/Cairo instead of WebView Canvas for maximum performance on large designs

---

## Critical Files to Create First (Phase 0)

```
canopi/
├── Cargo.toml                          # Workspace definition
├── desktop/Cargo.toml                  # Tauri app crate
├── desktop/src/main.rs                 # Entry point
├── desktop/src/lib.rs                  # Module exports
├── desktop/tauri.conf.json             # Tauri config
├── desktop/web/package.json            # Frontend deps
├── desktop/web/vite.config.ts          # Vite config
├── desktop/web/src/app.tsx             # Root component
├── desktop/web/src/components/activity-bar/  # Shell UI
├── common-types/Cargo.toml             # Shared types
├── common-types/src/lib.rs
├── common-types/build.rs               # typeshare
├── lib-swift/Cargo.toml                # macOS stub
├── lib-cpp/Cargo.toml                  # Windows stub
├── lib-c/Cargo.toml                    # Linux stub
└── .github/workflows/build.yml         # CI
```

---

## Implementation Reference (from library docs)

### Tauri v2 — App Entry + State + Commands

```rust
// desktop/src/lib.rs
use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use tauri::Manager;

// Separate read-only and writable DB — no pool needed for a desktop app
struct PlantDb(Arc<Connection>);  // read-only, Arc for concurrent reads
struct UserDb(Mutex<Connection>); // writable, Mutex for serialized writes

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Open plant DB (read-only, from bundled resources)
            let resource_path = app.path().resource_dir()?.join("canopi-core.db");
            let plant_conn = Connection::open_with_flags(
                &resource_path,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )?;
            plant_conn.pragma_update(None, "journal_mode", "wal")?;
            app.manage(PlantDb(Arc::new(plant_conn)));

            // Open user DB (writable, in app data dir)
            let user_db_path = app.path().app_data_dir()?.join("user.db");
            let user_conn = Connection::open(&user_db_path)?;
            user_conn.execute_batch(include_str!("../migrations/init.sql"))?;
            app.manage(UserDb(Mutex::new(user_conn)));

            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::species::search_species,
            commands::species::get_species_detail,
            commands::species::get_species_relationships,
            commands::design::save_design,
            commands::design::load_design,
            commands::design::list_designs,
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::content::list_learning_topics,
            commands::content::get_learning_content,
        ])
        .run(tauri::generate_context!())
        .expect("error running canopi");
}
```

```rust
// desktop/src/commands/species.rs
#[tauri::command]
fn search_species(
    plant_db: tauri::State<'_, PlantDb>,
    text: String, filters: SpeciesFilter, cursor: Option<String>, limit: u32, locale: String,
) -> Result<PaginatedResult<SpeciesListItem>, String> {
    let conn = &plant_db.0;
    let (sql, params) = query_builder::build_search_query(&text, &filters, cursor.as_deref(), limit);
    // Execute prepared statement, map rows to SpeciesListItem
    // Return PaginatedResult { items, next_cursor }
}
```

### rusqlite — Bundled SQLite + FTS5 Search

```toml
# desktop/Cargo.toml
[dependencies]
rusqlite = { version = "0.37.0", features = ["bundled"] }
```

```rust
// FTS5 search pattern for plant database
let mut stmt = conn.prepare(
    "SELECT canonical_name, common_name, family, genus
     FROM species_fts WHERE species_fts MATCH ?1
     ORDER BY rank LIMIT ?2"
)?;
let results = stmt.query_map([&search_text, &limit.to_string()], |row| {
    Ok(SpeciesSearchResult {
        canonical_name: row.get(0)?,
        common_name: row.get(1)?,
        family: row.get(2)?,
        genus: row.get(3)?,
    })
})?;
```

### swift-bridge — macOS Native FFI

```rust
// lib-swift/src/lib.rs
#[swift_bridge::bridge]
mod ffi {
    extern "Rust" {
        // Types shared from Rust → Swift
        type PdfOptions;
        fn pdf_page_width(&self) -> f64;
        fn pdf_page_height(&self) -> f64;
    }
    extern "Swift" {
        // High-DPI rendering via Core Graphics
        fn render_to_png(stage_json: &str, width: u32, height: u32, dpi: u32) -> Vec<u8>;

        // PDF generation via PDFKit
        fn export_pdf(design_json: &str, output_path: &str, options: PdfOptions) -> bool;

        // Spotlight indexing
        fn index_design(path: &str, name: &str, plants: &str, location: &str);
        fn deindex_design(path: &str);

        // File watching via FSEvents
        type FileWatcher;
        fn watch_path(path: &str) -> FileWatcher;
        fn stop_watching(&self);

        // Quick Look thumbnail
        fn generate_thumbnail(design_json: &str, size: u32) -> Vec<u8>;
    }
}
```

```rust
// lib-cpp/src/lib.rs
#[cxx::bridge]
mod ffi {
    extern "C++" {
        include!("lib-cpp/cpp/src/rendering.h");
        fn render_to_png(stage_json: &str, width: u32, height: u32, dpi: u32) -> Vec<u8>;
        fn export_pdf(design_json: &str, output_path: &str) -> bool;
        fn generate_thumbnail(design_json: &str, size: u32) -> Vec<u8>;

        include!("lib-cpp/cpp/src/system.h");
        fn set_taskbar_progress(progress: f64);  // 0.0 - 1.0
        fn update_jump_list(recent_files: &[&str]);
        fn register_file_association();
    }
}
```

### specta — Tauri-native type generation (replaces typeshare)

```rust
// common-types/src/species.rs
use serde::{Serialize, Deserialize};
use specta::Type;

#[derive(Serialize, Deserialize, Type)]
pub struct SpeciesListItem {
    pub canonical_name: String,
    pub common_name: Option<String>,
    pub family: String,
    pub genus: String,
    pub height_max_m: Option<f32>,
    pub hardiness_zone_min: Option<i32>,
    pub growth_rate: Option<String>,
}

#[derive(Serialize, Deserialize, Type)]
pub struct PaginatedResult<T: specta::Type> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
    pub total_estimate: u64,
}

#[derive(Serialize, Deserialize, Type)]
pub struct SpeciesFilter {
    pub hardiness_min: Option<i32>,
    pub hardiness_max: Option<i32>,
    pub height_max: Option<f32>,
    pub sun_tolerance: Option<Vec<String>>,  // "full_sun", "semi_shade", "full_shade"
    pub soil_types: Option<Vec<String>>,
    pub growth_rate: Option<Vec<String>>,
    pub life_cycle: Option<Vec<String>>,
    pub edible: Option<bool>,
    pub nitrogen_fixer: Option<bool>,
    pub stratum: Option<Vec<String>>,
    pub family: Option<String>,
}
// specta generates TypeScript interfaces from these at build time,
// integrated with Tauri's IPC type system. No separate typeshare step needed.
```

### @preact/signals — Reactive State (replaces Zustand)

```typescript
// state/app.ts — global state as signals
import { signal } from '@preact/signals'

export const activePanel = signal<'plant-db' | 'canvas' | 'world-map' | 'learning'>('plant-db')
export const locale = signal<'en' | 'fr' | 'es' | 'pt' | 'it' | 'zh'>('en')
export const theme = signal<'light' | 'dark'>('dark')

// state/canvas.ts — canvas-specific state
export const activeTool = signal<string>('select')
export const activeLayers = signal<string[]>(['zones', 'plants', 'annotations'])
export const bottomPanelOpen = signal(false)
export const bottomPanelTab = signal<'timeline' | 'consortium' | 'budget'>('timeline')
export const rightPanelPlant = signal<string | null>(null)
export const selectedPlants = signal<Set<string>>(new Set())
export const designDirty = signal(false)  // unsaved changes indicator
export const designPath = signal<string | null>(null)  // current file path

// state/plant-db.ts — search/filter state
export const searchQuery = signal('')
export const activeFilters = signal<SpeciesFilter>({})
export const searchResults = signal<SpeciesListItem[]>([])
export const searchCursor = signal<string | null>(null)

// Components auto-subscribe: just read .value in JSX
// <div>{activePanel.value === 'canvas' && <CanvasPanel />}</div>
// Only the exact DOM node reading the signal re-renders — zero diffing overhead
```

### Canvas Undo/Redo — True Command Pattern

```typescript
// canvas/history.ts — commands store diffs, not snapshots
interface Command {
  type: string
  execute(engine: CanvasEngine): void
  undo(engine: CanvasEngine): void
}

// Example commands:
class AddPlantCommand implements Command {
  type = 'add_plant'
  constructor(private plant: PlacedPlant) {}
  execute(engine: CanvasEngine) { engine.addPlantToLayer(this.plant) }
  undo(engine: CanvasEngine) { engine.removePlantFromLayer(this.plant.canonical_name) }
}

class MovePlantsCommand implements Command {
  type = 'move_plants'
  constructor(private moves: Array<{ name: string, from: Point, to: Point }>) {}
  execute(engine: CanvasEngine) { this.moves.forEach(m => engine.movePlant(m.name, m.to)) }
  undo(engine: CanvasEngine) { this.moves.forEach(m => engine.movePlant(m.name, m.from)) }
}

class CanvasHistory {
  private past: Command[] = []
  private future: Command[] = []

  execute(cmd: Command, engine: CanvasEngine) {
    cmd.execute(engine)
    this.past.push(cmd)
    this.future = []  // clear redo stack on new action
    designDirty.value = true
  }

  undo(engine: CanvasEngine) {
    const cmd = this.past.pop()
    if (!cmd) return
    cmd.undo(engine)
    this.future.push(cmd)
  }

  redo(engine: CanvasEngine) {
    const cmd = this.future.pop()
    if (!cmd) return
    cmd.execute(engine)
    this.past.push(cmd)
  }
}
// Memory efficient: stores only the diff per action, not entire canvas state.
// Unlimited undo depth (commands are tiny objects).
```

### i18next — Direct (no React/Preact wrapper)

```typescript
// i18n/index.ts — i18next core, driven by locale signal
import i18n from 'i18next'
import { locale } from '../state/app'
import { effect } from '@preact/signals'
import en from './locales/en.json'
import fr from './locales/fr.json'
import es from './locales/es.json'
import pt from './locales/pt.json'
import it from './locales/it.json'
import zh from './locales/zh.json'

i18n.init({
  lng: locale.value,
  fallbackLng: 'en',
  supportedLngs: ['en', 'fr', 'es', 'pt', 'it', 'zh'],
  ns: ['common', 'plants', 'canvas', 'learning'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  resources: { en: { common: en }, fr: { common: fr }, es: { common: es },
               pt: { common: pt }, it: { common: it }, zh: { common: zh } },
})

// Sync locale signal → i18next
effect(() => { i18n.changeLanguage(locale.value) })

// Helper for components: just call t() directly
export const t = i18n.t.bind(i18n)

// Usage in Preact components:
// <h1>{t('plantDb.title')}</h1>
// <LanguagePicker /> — dropdown with all 6 languages in status bar
```

### Konva.js — Imperative API (no react-konva)

```typescript
// canvas/engine.ts — Canvas engine, managed imperatively, driven by signals
import Konva from 'konva'
import { effect, batch } from '@preact/signals'
import { canvasHistory, activeLayers, selectedPlants } from '../state/app'

export class CanvasEngine {
  stage: Konva.Stage
  layers: Map<string, Konva.Layer> = new Map()

  init(container: HTMLDivElement, width: number, height: number) {
    this.stage = new Konva.Stage({ container, width, height, draggable: true })
    // Create named layers
    for (const name of ['base', 'contours', 'climate', 'zones', 'water', 'plants', 'annotations']) {
      const layer = new Konva.Layer({ name })
      this.stage.add(layer)
      this.layers.set(name, layer)
    }
    this.setupZoom()
    this.setupDrop()
    // Signals drive layer visibility
    effect(() => {
      for (const [name, layer] of this.layers) {
        layer.visible(activeLayers.value.includes(name))
      }
    })
  }

  addPlant(canonicalName: string, x: number, y: number) {
    this.pushHistory() // snapshot for undo
    const group = new Konva.Group({ x, y, draggable: true, name: canonicalName })
    group.add(new Konva.Circle({ radius: 12, fill: '#4CAF50', stroke: '#2E7D32' }))
    group.add(new Konva.Text({ text: canonicalName.split(' ')[0], y: 16, fontSize: 10, align: 'center' }))
    group.on('click', () => { rightPanelPlant.value = canonicalName })
    this.layers.get('plants')!.add(group)
    this.layers.get('plants')!.batchDraw()
  }

  // DOM drop handler — called from Preact component wrapping the canvas div
  setupDrop() {
    const container = this.stage.container()
    container.addEventListener('dragover', (e) => e.preventDefault())
    container.addEventListener('drop', (e) => {
      e.preventDefault()
      this.stage.setPointersPositions(e)
      const pos = this.stage.getPointerPosition()!
      const data = JSON.parse(e.dataTransfer!.getData('application/json'))
      this.addPlant(data.canonical_name, pos.x, pos.y)
    })
  }

  setupZoom() {
    this.stage.on('wheel', (e) => {
      e.evt.preventDefault()
      const scaleBy = 1.05
      const oldScale = this.stage.scaleX()
      const pointer = this.stage.getPointerPosition()!
      const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy
      this.stage.scale({ x: newScale, y: newScale })
      // Adjust position to zoom toward pointer
      const mousePointTo = { x: (pointer.x - this.stage.x()) / oldScale, y: (pointer.y - this.stage.y()) / oldScale }
      this.stage.position({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale })
    })
  }

  // Save to .canopi — serialize Konva state to CanopiFile format
  toCanopi(): CanopiFile { /* ... */ }
  fromCanopi(file: CanopiFile) { /* ... */ }
}

// In Preact component:
// const canvasRef = useRef<HTMLDivElement>(null)
// useEffect(() => { engine.init(canvasRef.current!, w, h); return () => engine.stage.destroy() }, [])
// <div ref={canvasRef} />
```

### MapLibre GL JS — Terrain + Contours + Markers

```javascript
// World Map or Canvas base map with terrain
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      osm: { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256 },
      terrainSource: { type: 'raster-dem', url: 'https://demotiles.maplibre.org/terrain-tiles/tiles.json', tileSize: 256 },
    },
    layers: [
      { id: 'osm', type: 'raster', source: 'osm' },
      { id: 'hills', type: 'hillshade', source: 'terrainSource', paint: { 'hillshade-shadow-color': '#473B24' } },
    ],
    terrain: { source: 'terrainSource', exaggeration: 1 },
  },
  zoom: 12, center: [2.3522, 48.8566], pitch: 45,
})

// Contour lines
map.addSource('contours', { type: 'vector', url: '...' })
map.addLayer({ id: 'contour-lines', type: 'line', source: 'contours', source-layer: 'contour',
  paint: { 'line-color': '#8B4513', 'line-width': 1 } })

// Showcase design pins
new maplibregl.Marker().setLngLat([lon, lat]).addTo(map)
```

---

## Reliability & Data Safety

### Auto-save & Crash Recovery

- **Auto-save**: Every 60 seconds, silently save current design to `{app_data_dir}/autosave/{design-hash}.canopi.tmp`. No UI indication (minimal motion principle). Timer resets on each manual save.
- **Crash recovery**: On app launch, scan autosave directory. If any autosave file is newer than its corresponding saved .canopi file, show dialog: "Canopi recovered unsaved changes from [timestamp]. [Restore] [Discard]"
- **Unsaved changes indicator**: Dot (●) in title bar next to filename when design has unsaved changes. Status bar shows "Unsaved changes". "Save before closing?" dialog on window close / Cmd+Q.
- **Auto-save is non-blocking**: Write happens in a background Rust task. Never freezes the UI.

### User Data Backup

- **Auto-backup**: On app launch (max once per day), copy `user.db` to `user.db.{YYYY-MM-DD}.bak`. Keep last 7 backups.
- **Export user data**: Settings → "Export all user data" → JSON file containing: favorites, collections, tags, custom plants, user notes, saved searches, settings, recent files.
- **Import user data**: Settings → "Import user data" → restore from exported JSON. Merge or replace option.
- **Design backup**: Each .canopi save keeps one `.canopi.prev` backup of the previous version (single-level undo at the file level).

### Plant DB Update Strategy

When a new app version ships with an updated plant DB:
- **User data isolation**: Favorites, notes, tags, collections are in user.db (never touched by plant DB update). Safe by design.
- **Name stability**: Plants are identified by `canonical_name`. If TNRS renames a species between DB versions, the prepare-db script generates a `canonical_name_redirects` table mapping old → new names.
- **On app update**: Rust startup checks for redirects, automatically migrates user.db references (favorites, notes, etc.) to new canonical names. Logs migrations for debugging.
- **Graceful degradation**: If a plant in a .canopi file doesn't exist in the DB, show it on canvas with a warning icon: "Unknown plant: [name]. It may have been renamed or removed from the database."

### Application Logging

- **Backend**: `tracing` crate with structured logging (JSON format)
- **Log location**: `{app_data_dir}/logs/canopi-{YYYY-MM-DD}.log`
- **Log rotation**: Keep last 7 days, auto-delete older files on startup
- **Log levels**: ERROR (always), WARN (always), INFO (default), DEBUG (opt-in via settings)
- **Frontend errors**: Global error boundary catches unhandled errors → sends to Rust backend via IPC → logged
- **User-facing**: Settings → "Copy debug log to clipboard" button for easy bug reports
- **Crash logs**: On panic, write panic info + backtrace to `crash-{timestamp}.log`

### Startup Performance

- **Target**: UI visible in <500ms, plant DB searchable in <2s
- **Sequence**:
  1. Tauri creates window → Preact renders shell (activity bar + empty panels) → **visible in <500ms**
  2. Background: Rust opens plant DB connection, runs PRAGMA optimizations
  3. Background: Load user settings, check for autosave recovery
  4. Event: `db_ready` → frontend populates plant DB panel → **searchable in <2s**
  5. Background: Check for app updates, load learning content index
- **DB optimization pragmas**: `PRAGMA journal_mode=WAL; PRAGMA mmap_size=268435456; PRAGMA cache_size=-64000;` (256MB mmap, 64MB cache)

## Plant Symbols on Canvas

### Visual Representation

Plants on canvas are represented as **strata-based symbols** that reflect real proportions:

| Stratum | Symbol Shape | Scale Behavior |
|---------|-------------|---------------|
| Emergent | Tall tree silhouette (rounded crown) | Scales to actual canopy spread (5-15m) |
| High | Medium tree silhouette (oval crown) | Scales to canopy spread (3-8m) |
| Medium | Shrub silhouette (rounded bush) | Scales to spread (1-4m) |
| Low | Ground cover circle/ellipse | Scales to spread (0.3-2m) |
| Vine/Climber | Wavy line or spiral icon | Fixed small icon near support structure |
| Root crop | Underground icon (below-ground emphasis) | Fixed small icon |

- **Color coding**: Each stratum has a default color (customizable). Emergent = dark green, High = medium green, Medium = light green, Low = yellow-green.
- **Labels**: Shown/hidden based on zoom level (see zoom-level-appropriate labels in UX section)
- **Selected state**: Blue glow outline + drag handles
- **Compatibility indicator**: When dragging near other plants, border color shifts: green (companion), yellow (neutral), red (antagonist)

### Growth Over Time (Timeline Slider)

A unique differentiating feature:
- **Timeline slider** at top of canvas: "Year 0 → 1 → 2 → 5 → 10 → 20 → Mature"
- Plant symbols **scale dynamically** based on growth data from DB (height_min/max, growth_rate)
- **Canopy coverage visualization**: Semi-transparent circles showing shade cast area
- Shows **succession progression** for syntropy designs — placenta species dominate early, climax species dominate later
- **Animate between years**: Smooth transition when sliding between time points
- Optional: show which plants are expected to be pruned/removed at each stage per the timeline actions

## Settings Schema

All settings persisted in user.db with these defaults:

| Setting | Type | Default | Notes |
|---------|------|---------|-------|
| `locale` | enum | auto-detect | en, fr, es, pt, it, zh |
| `theme` | enum | system | light, dark, system |
| `grid_size_m` | float | 1.0 | 0.5, 1.0, 2.0, 5.0 |
| `snap_to_grid` | bool | true | |
| `snap_to_guides` | bool | true | |
| `show_smart_guides` | bool | true | |
| `auto_save_interval_s` | int | 60 | 0 = disabled |
| `confirm_destructive` | bool | true | Delete confirmation dialogs |
| `default_currency` | string | EUR | Per-locale default, user-configurable |
| `measurement_units` | enum | metric | metric, imperial |
| `show_botanical_names` | bool | true | Show italic botanical names |
| `canvas_bg_color` | string | theme-default | Custom canvas background |
| `debug_logging` | bool | false | Enable DEBUG level logs |
| `check_updates` | bool | true | Auto-check for updates on launch |
| `default_design_dir` | string | ~/Documents/Canopi | Where .canopi files are saved |
| `recent_files_max` | int | 20 | Max entries in recent files list |
| `bottom_panel_height` | int | 250 | Remembered panel size |
| `right_panel_width` | int | 350 | Remembered panel size |
| `last_active_panel` | string | plant-db | Restored on launch |

---

## Craft Checklist (applied to this project)

Per the Craft skill hierarchy: **Correct > Clear > Simple > Robust > Performant**

### Error Paths (design these FIRST, per Craft Section 5)

| Scenario | Error Path | User Experience |
|----------|-----------|-----------------|
| Plant DB missing/corrupt at startup | Catch open failure, check file hash | "Plant database not found. [Re-download]" dialog. App still launches (limited mode). |
| .canopi file corrupt or incompatible | JSON parse failure or version > supported | "Cannot open design: [specific error]. File version X requires Canopi Y.Z+." |
| .canopi file from newer version | Unknown fields detected | Open successfully, preserve unknown fields. Show info banner: "Some features from a newer version." |
| FTS5 search returns 0 results | Not an error, but UX matter | "No plants match your search. [Clear filters]" with suggestions |
| Full DB download interrupted | Track bytes received, store partial file | Resume from last byte on retry. Verify SHA-256 on completion. |
| Disk full on save | Catch write error from Rust | "Cannot save: disk full. Free X MB and try again." Do NOT leave half-written file (write to temp, then atomic rename). |
| Canvas export fails (out of memory for large PNG) | Catch Konva toDataURL failure | "Design too large for this export resolution. Try lower DPI or SVG." |
| Tauri IPC timeout | Frontend sets 10s timeout on invoke | "Operation timed out. Please try again." Log for debugging. |
| Map tiles unavailable (offline, no cache) | MapLibre load error | Graceful fallback: show blank canvas with grid. Info: "Map unavailable offline." |

### Invariants (must ALWAYS hold)

1. `canonical_name` is the universal plant identifier across DB, .canopi files, consortiums, and IPC
2. .canopi files are always valid JSON with a `version` field at the root
3. .canopi file saves are **atomic**: write to temp file → rename. Never leave partial writes.
4. Unknown JSON fields in .canopi files are preserved on save (round-trip safety via `serde(flatten)` / JSON spread)
5. Plant DB is read-only. User data is in a separate DB. Never write to the plant DB.
6. All UI strings go through i18next, never hardcoded in components
7. CanvasEngine owns all Konva objects. Preact components never directly mutate Konva state.
8. Every IPC command returns `Result<T, String>`. Errors are user-facing messages, not raw Rust errors.
9. DB connections are opened once at startup. No per-request connection creation.
10. File paths always use Tauri's path resolver. Never hardcode separators or assume platform conventions.

### Resource Cleanup (Craft Section 5)

- Konva Stage: `destroy()` on component unmount
- DB connections: closed on app exit (Tauri handles via Drop)
- Temp files from atomic saves: cleaned up even on error (try-finally in Rust)
- MapLibre map: `remove()` on panel switch
- Event listeners: always paired with cleanup (Preact `useEffect` return, or explicit remove)
- Background download tasks: cancellable via abort signal

## Testing Strategy

See **Test & Release Process** section above for the full CI pipeline. Summary of test categories:

### Rust Backend (cargo test)
- `query_builder.rs`: SQL generation for filter combinations, FTS5, cursor pagination
- `format.rs`: .canopi round-trip serialize/deserialize, unknown field preservation, corrupt file handling
- `migrate.rs`: Version migration v1→v2→v3, backward compatibility
- `commands/*.rs`: IPC integration via Tauri test utilities
- **Native lib tests**: Platform-specific rendering, PDF, file watching (run in platform CI matrix)

### Frontend (Vitest)
- `canvas/history.ts`: Command-based undo/redo correctness (execute, undo, redo for every command type)
- `canvas/serializer.ts`: CanvasEngine ↔ CanopiFile conversion
- `canvas/tools/*.ts`: Tool state machines (each tool's mouse/key event sequences)
- `utils/solar.ts`: Sun position math against known reference values
- Components: filter sidebar state, search debounce, panel switching (via @testing-library/preact)

### E2E (Playwright against built Tauri app)
- Full user flows: search plant → drag to canvas → save → reload → verify
- Locale switching, theme toggling, keyboard shortcuts
- .canopi file association (platform-specific)
- Performance: 1000 plants on canvas < 500MB RSS, < 2s render

### What NOT to test (Craft: mock at boundaries)
- Don't mock Konva internals — test CanvasEngine's public API
- Don't test Preact rendering details — test behavior
- Don't test i18next translation loading — trust the library
- Don't test Tauri plugin internals — test our command handlers

## Verification

After each phase:
1. `cargo build` succeeds for all workspace crates
2. `cargo test` passes
3. `npm run build` produces frontend bundle
4. `npm test` passes (Vitest)
5. `cargo tauri dev` launches the app window
6. Cross-platform CI passes (macOS, Windows, Linux)
7. Manual test: navigate all panels, search plants, create a design, save/load .canopi file
