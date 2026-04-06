# Canopi — Agroecological Design App

## Tech Stack
- **Backend**: Rust workspace (Tauri v2 + rusqlite + specta)
- **Frontend**: Preact + @preact/signals + TypeScript + Vite + CSS Modules
- **Canvas**: PixiJS (primary renderer) + Canvas2D (fallback) — scene-owned runtime via `SceneCanvasRuntime`
- **i18n**: i18next core (NOT react-i18next), 11 languages (en, fr, es, pt, it, zh, de, ja, ko, nl, ru)
- **Maps**: MapLibre GL JS + maplibre-contour (dependency retained, code deleted — deferred post-rewrite)
- **Native**: lib-c (Linux, Cairo PNG/PDF + inotify + XDG), lib-swift (macOS stub), lib-cpp (Windows stub)

## Project Structure
```
canopi/
├── desktop/          # Tauri v2 app crate
│   ├── src/          # Rust backend
│   ├── web/          # Preact frontend
│   └── tauri.conf.json
├── common-types/     # Shared Rust ↔ TS types
├── .interface-design/ # Design system (system.md)
├── lib-swift/        # macOS native (stub)
├── lib-cpp/          # Windows native (stub)
└── lib-c/            # Linux native (stub)
```

Domain-specific instructions in subdirectory CLAUDE.md files:
- `desktop/CLAUDE.md` — Tauri v2, IPC, platform, document lifecycle, settings
- `desktop/src/db/CLAUDE.md` — Database, SQLite, translations, schema contract
- `desktop/web/CLAUDE.md` — Frontend: CSS, i18n, state, Preact/Signals
- `desktop/web/src/canvas/CLAUDE.md` — Canvas runtime (SceneCanvasRuntime), PixiJS renderer, scene-owned architecture rules

## Current Layout (Post UI Overhaul)
- **Left**: Canvas toolbar (38px) — drawing tools plus plant color action (Select, Hand, Rectangle, Text, Plant Color + Grid/Snap/Rulers toggles)
- **Center**: Canvas workspace
- **Right**: PanelBar (36px, always visible) + sliding panels (plant search, favorites)
- **Title bar**: Logo + file name + lang/theme toggle + window controls
- **No activity bar** — removed, navigation via PanelBar
- **No status bar** — removed, controls moved to title bar
- Design system: `.interface-design/system.md` (field notebook direction)

## Design Direction
- **Field notebook** aesthetic: parchment, ink, ochre palette. See `.interface-design/system.md`
- **Green NEVER in UI chrome** — green lives only on the canvas (plant symbols). UI uses ochre `#A06B1F` as primary accent.
- Theme toggle: light/dark only (no system option)
- Depth: borders-only (no dramatic shadows)

## Pruned Features (code deleted, git history preserves)
These features were deleted during pre-rewrite cleanup. See `docs/todo.md` for current status:
- **Tools**: Ellipse, Polygon, Freeform, Line, Measure, Dimension, Arrow, Callout, Pattern Fill, Spacing
- **Overlays**: Minimap, Celestial dial, Consortium visual, MapLibre/location, Compass
- **Panels**: Layer panel, World Map, Learning
- **Export**: GeoJSON, PNG/SVG export commands
- **Support files**: dimensions.ts, pattern-math.ts, map-layer.ts, ipc/community.ts, ipc/tiles.ts, TileDownloadModal
- **Retained for beta release**: LayerPanel, location flows (Wave 3 retained-surface closeout)
- **Bottom panel shipped**: Timeline (trimmed), Budget, and Consortium (succession chart) tabs all active. Consortium auto-sync runs via `state/consortium-sync-workflow.ts` at document level. Panel↔canvas reactivity via `sceneEntityRevision` signal
- **Deferred beyond beta**: WorldMapPanel, geo/terrain, export, learning content
- **Selection**: No resize/rotate — objects are position-only (highlight + move). Resize/rotate commands all deleted
- **Konva engine**: Entire `CanvasEngine` + old command/tool/serializer/history/import/export system deleted. Konva dependency fully removed. Replaced by scene-owned runtime (PixiJS + Canvas2D)
- **Per-plant labels**: Label rendering, collision detection, dedup, and adaptive placement all deleted. Replaced by hover tooltip (common name + scientific name), hover species highlight (ring on same-species), and selection labels (one per species at centroid). See `desktop/web/src/canvas/CLAUDE.md` Plant Presentation Rules

## Architecture Rules

### Document Mutation Rule
- **No component may replace the active document directly** — only `state/document-actions.ts` performs destructive session replacement
- **No panel may call document replacement directly** — panels request document changes through the document-actions boundary
- All document-replacing flows use one shared guard path (dirty check → confirm → replace)

### Document Authority Rule
The `.canopi` file has two categories of content with separate authorities:

- **Canvas scene state** (plants, zones, annotations, groups, plant-species-colors, layers) — owned by `SceneStore`. Mutations flow through the canvas runtime. Renderers and interaction are projections of this state
- **Non-canvas document state** (consortiums, timeline, budget, location, description, extra) — owned by the document store (`state/design.ts` / `state/document.ts`). Mutations flow through `mutateCurrentDesign()` and the `*-actions.ts` modules

The save path composes both into a single `CanopiFile`. Neither authority should duplicate the other's data. Panels that read canvas entities (plant list, zone names) should use a read-only query interface on the runtime, not mirrored signals.

**Anti-patterns:**
- Do not push non-canvas state (consortiums, timeline, budget) into `SceneStore` — it is not a canvas concern
- Do not mirror canvas state into standalone signals (`currentConsortiums`, `designLocation`) when a derived/computed value or a direct read from the authority would work
- Do not create new ad hoc sync paths between the two authorities — if sync is needed, centralize it in one explicit adapter

### Action-Layer Rule
- **Action modules must not import other action modules** — `state/*-actions.ts` files are leaf modules
- Import direction: **components → actions → state** (never backwards)
- **Cross-concern orchestration**: When a mutation in one domain must trigger side effects in another (e.g., plant deleted → orphan cleanup in timeline/budget/consortium), create an explicit workflow module at a higher boundary. Do not wire action modules to each other. See `state/template-import-workflow.ts` for the pattern
- As panel↔canvas sync grows, expect more workflow modules. This is the intended pattern — name them clearly (e.g., `state/plant-lifecycle-workflow.ts`)

### Signal Performance in Hot Paths
- **Never write signals unconditionally at 60fps** (e.g. map `move` events). New object literals always fail `Object.is` equality, triggering unnecessary rerenders. Use `.peek()` to read without subscribing, compare before writing
- **`getBoundingClientRect()` in hot loops**: Cache the DOMRect — don't call twice per pointermove event

### Signal Mirror Rule
- **Prefer derived/computed signals over manually-synced mirrors.** If a value exists in one authority (SceneStore or document store), components should read from that authority — or from a `computed()` signal derived from it — not from a hand-copied signal that requires `syncDocumentMirrors()`
- Existing mirrors (`currentConsortiums`, `designLocation`) should be replaced with computed views as the document authority converges. Do not add new mirrors

### Resource Ownership Rule
- Every resource-owning surface must have **one explicit lifecycle owner** for setup, update, and teardown
- Applies to: canvas runtime (SceneCanvasRuntime), renderer host, MapLibre instances, timers, listeners, async cancellation tokens, DOM overlays
- HMR cleanup: module-level `effect()` and `addEventListener` must store disposers and clean up via `import.meta.hot.dispose()`

### MapLibre Integration Rule
- **MapLibre is a derived visualization layer, not a document authority.** Map layers render scene/document state; they do not own or mutate it
- MapLibre instances must be managed by a dedicated controller (e.g., `MapLibreController`), not scattered across the canvas runtime or individual components
- Map viewport sync with the canvas must go through `CameraController`, not ad hoc signal wiring
- The lazy import boundary around `maplibre-gl` should be preserved for bundle size, but isolation from the canvas runtime is no longer required — the map controller is a sibling to the runtime, not walled off from it

### Hotspot File Protection
These files have concentrated authority. **One writer at a time** — do not assign multiple concurrent writers. Create seam files first, then move ownership:
- `desktop/web/src/canvas/runtime/scene-runtime.ts`
- `desktop/web/src/canvas/runtime/scene-interaction.ts`
- `desktop/src/db/plant_db.rs`
- `desktop/src/db/query_builder.rs`
- `desktop/web/src/state/design.ts`
- `desktop/web/src/state/plant-db.ts`

## Key Conventions

### Before Writing Code
1. Query **Context7** for up-to-date library API docs (see Context7 Library IDs below)
2. For UI work: read `.interface-design/system.md` for design tokens and patterns. Load `/interface-design:init` only for major new UI surfaces (new panels, new workflows, new component patterns)
3. Use taoki `xray`/`ripple` to understand file structure and blast radius before modifying
4. For multi-phase work with subagents: define a **file ownership matrix** (one writer per file at any time), keep **Tauri MCP in main context only** (single WebView session), and decide UI control types in the plan before building alternatives
5. For multi-feature i18n work: **batch all i18n keys in one early phase** to prevent 11-file merge conflicts across parallel agents
6. Before planning new features: **explore the codebase for existing implementations** — code may already exist (e.g., copy-paste, favorites backend, display mode rendering were all discovered pre-built during MVP planning)
7. Run `/simplify` after implementation — converges in ~3 rounds: R1 structural, R2 duplication exposed by R1 fixes, R3 confirms convergence
8. For async canvas features: audit every pipeline operation for main-thread blocking — use `createImageBitmap()` (never `toDataURL()`), epoch guards for cancellation, `requestIdleCallback` for deferred init
9. For multi-phase work: **implement → `tsc` + `npm test` → craft code review → fix → re-review until convergence** per phase. Don't batch reviews across phases — bugs compound

### Banned Patterns (enforced by plugin hooks)
- **No React**: Import from `preact`, `preact/hooks`, `preact/compat` — never `react`
- **No Konva**: Konva has been fully removed. Canvas rendering goes through `SceneCanvasRuntime` + `RendererHost` (PixiJS/Canvas2D). Do not reintroduce Konva
- **No Tailwind**: Use CSS Modules (`.module.css`)
- **No Zustand/Redux/MobX**: Use `@preact/signals`
- **No react-i18next**: Use `import { t } from '../i18n'`
- **No connection pools** (r2d2, deadpool, sqlx): `Mutex<Connection>` only — rusqlite Connection is not Sync, Arc alone is unsound
- **No typeshare**: Use `specta::Type`
- **No string-formatted SQL**: Use prepared statements with `?1`, `?2`
- **No raw rgba() in CSS Modules**: Always use `var(--color-*)` tokens — raw values break dark mode
- **No `font-weight: 500`**: Two weights only — `400` (body/reading) and `600` (name/label/interactive). Weight 500 creates a mushy middle with no clear purpose. See `.interface-design/system.md` for the five typography roles (Label, Name, Body, Caption, Value)

## Development
```bash
# Full app dev (from project root — NOT desktop/)
cargo tauri dev

# Frontend dev only (from desktop/web/)
npm run dev

# Check workspace (needs plant DB or skip env var)
CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace

# TypeScript check (from desktop/web/)
npx tsc --noEmit

# Frontend build (from desktop/web/)
npm run build

# Frontend tests (from desktop/web/)
npm test

# Generate plant DB (run before first `cargo tauri dev`)
python3 scripts/prepare-db.py

# Build release
cargo build --release
```

### Release Process
- **Version bump files**: `Cargo.toml` (workspace version), `desktop/tauri.conf.json`, `desktop/web/package.json` — Cargo.lock auto-updates
- **Trigger RC workflow**: `gh workflow run "Release Candidate" --ref main -f ref=main -f release_version=<ver> -f db_release_tag=canopi-core-db -f db_asset_name=canopi-core.db`
- **RC timing**: ~15-20min total (macOS Intel ~10min, Windows ~10min are the slowest targets)
- **Promote**: `scripts/promote-release.sh` creates a **draft** release — publish with `gh release edit <tag> --draft=false`
- **Promotion upload timing**: 10-20min (Windows artifact ~500MB dominates)
- **Tags are remote-only**: promote script creates the tag via `gh release create`, not locally — `git fetch --tags` to sync
- **Release docs example**: `docs/release-operations.md` promote command has a hardcoded version — update it during version bump

### Tauri MCP Development Workflow
The app has `tauri-plugin-mcp-bridge` (debug builds only). Use it for screenshot-driven development and interactive verification:

**Setup:**
1. `cargo tauri dev` — launches app with MCP bridge on port 9223
2. `driver_session start` — connect to the running app

**Gotcha:** If MCP tools error with `resolveRef is not a function`, the session is stale. Run `driver_session stop` then `driver_session start` to reconnect.

**Gotcha:** MCP tools disconnect from Claude Code when the Tauri app restarts (e.g. after `cargo tauri dev` relaunch). Must `driver_session stop` then `start` to reconnect. If tools show as "no longer available", they need the app running first.

**Verification tools:**
- `webview_screenshot` — capture current visual state
- `webview_interact` — click, scroll, drag to test user flows
- `webview_keyboard` — type text, press keys to test input
- `webview_execute_js` — run JS in app context (access `window.__TAURI__`)
- `webview_dom_snapshot` — inspect accessibility tree or DOM structure
- `webview_get_styles` — check computed CSS (catch dark mode issues without manual toggling)
- `webview_find_element` — locate elements by CSS selector, XPath, or text
- `ipc_execute_command` — call Rust backend commands directly (test DB queries, settings)
- `ipc_monitor` / `ipc_get_captured` — watch frontend↔backend IPC traffic for serialization mismatches

**Visual debugging at zoom:** To inspect fine CSS details (thumb alignment, pixel offsets), isolate and zoom via JS: `el.style.transform = 'scale(3)'; el.style.transformOrigin = 'top left'`, then `webview_screenshot`. Reset with `el.style.cssText = ''`

**After UI changes:** run `/interface-design:audit` to check design system compliance. Run `/interface-design:critique` after building major new components

## Quality Process
- After completing a phase or significant feature, run `/craft` with two parallel code-reviewer agents
- Fix all issues, re-review until convergence (typically 2 rounds)
- For UI work: run `/interface-design:critique` to verify design system adherence
- Verify interactive features via Tauri MCP (screenshot + interact) — do not rely solely on `tsc`/`npm test`
- Max 3 sub-phases between live app verification runs
- Detail card expansion pattern: Rust struct → SQL query → translate_value() → frontend types → collapsible sections → i18n keys × 11 locales → schema-contract.json translations → DB population
- Adding a new filterable species field (end-to-end): (1) `columns.rs` → `validated_column()` match arm, (2) `filters.rs` → `is_numeric_field()` or `is_boolean_field()` if applicable, (3) `field-registry.ts` → `FIELD_REGISTRY` entry (key must match columns.rs exactly), (4) `i18n/*.json` → `filters.field.<key>` label in all 11 locales, (5) if also adding to detail card: update `PlantDetailCard.tsx` `has*` check + render + `plantDetail.*` i18n key

## Key Documents
- Docs entry point: `docs/README.md`
- Agent reading order: `docs/agents.md`
- Docs maintenance protocol: `docs/maintenance.md`
- Active/deferred work tracker: `docs/todo.md`
- Architecture review: `docs/code-quality-architecture-review-2026-04-05.md`
- Release hardening: `docs/release-verification.md`
- Release operations: `docs/release-operations.md`
- Renderer validation: `docs/renderer/renderer.md`
- Database guidance: `docs/db/README.md`
- Product scope lock: `docs/product-definition.md`
- Historical roadmap: `docs/archive/roadmap.md`
- Archived reviews: `docs/archive/reviews/`
- Design system: `.interface-design/system.md`
- Rewrite history: `docs/archive/rewrite-history-2026-03.md`
- Archive root: `docs/archive/`

## Context7 Library IDs
- Tauri v2: `/websites/v2_tauri_app`
- rusqlite: `/rusqlite/rusqlite`
- PixiJS: `/pixijs/pixijs`
- MapLibre: `/maplibre/maplibre-gl-js`
- i18next: `/i18next/react-i18next`
