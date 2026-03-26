# Canopi — Agroecological Design App

## Tech Stack
- **Backend**: Rust workspace (Tauri v2 + rusqlite + specta)
- **Frontend**: Preact + @preact/signals + TypeScript + Vite + CSS Modules
- **Canvas**: Konva.js (imperative API, NOT react-konva)
- **i18n**: i18next core (NOT react-i18next), 6 languages
- **Maps**: MapLibre GL JS (disabled for MVP, code on disk)
- **Native**: lib-swift (macOS), lib-cpp (Windows), lib-c (Linux) — stubs only

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

## Current Layout (Post UI Overhaul)
- **Left**: Canvas toolbar (38px) — drawing tools only (Select, Hand, Rectangle, Text + Grid/Snap/Rulers toggles)
- **Center**: Canvas workspace
- **Right**: PanelBar (36px, always visible) + sliding panels (plant search, learning)
- **Title bar**: Logo + file name + lang/theme toggle + window controls
- **No activity bar** — removed, navigation via PanelBar
- **No status bar** — removed, controls moved to title bar
- Design system: `.interface-design/system.md` (field notebook direction)

## Design Direction
- **Field notebook** aesthetic: parchment, ink, ochre palette. See `.interface-design/system.md`
- **Green NEVER in UI chrome** — green lives only on the canvas (plant symbols). UI uses ochre `#A06B1F` as primary accent.
- Theme toggle: light/dark only (no system option)
- Depth: borders-only (no dramatic shadows)

## MVP Feature Pruning (active)
These features are **disabled in UI but code stays on disk**:
- Tools: Ellipse, Polygon, Freeform, Line, Measure, Dimension, Arrow, Callout, Pattern Fill, Spacing
- Overlays: Minimap, Celestial dial, Consortium visual, MapLibre/location, Display modes
- Panels: Bottom panel (Timeline/Budget/Consortium tabs), Layer panel, World Map, Learning (placeholder only)
- Export: GeoJSON, PNG/SVG export commands
- Compass: import commented out in `engine.ts`
- Re-enable plan: see `docs/roadmap.md`

## Key Conventions

### Before Writing Code
1. Query **Context7** for up-to-date library API docs (see Context7 Library IDs below)
2. For UI work: read `.interface-design/system.md` for design tokens and patterns. Load `/interface-design:init` only for major new UI surfaces (new panels, new workflows, new component patterns)
3. Use taoki `xray`/`ripple` to understand file structure and blast radius before modifying

### Banned Patterns (enforced by plugin hooks)
- **No React**: Import from `preact`, `preact/hooks`, `preact/compat` — never `react`
- **No react-konva**: Use imperative Konva.js via CanvasEngine class
- **No Tailwind**: Use CSS Modules (`.module.css`)
- **No Zustand/Redux/MobX**: Use `@preact/signals`
- **No react-i18next**: Use `import { t } from '../i18n'`
- **No connection pools** (r2d2, deadpool, sqlx): `Mutex<Connection>` only — rusqlite Connection is not Sync, Arc alone is unsound
- **No typeshare**: Use `specta::Type`
- **No string-formatted SQL**: Use prepared statements with `?1`, `?2`
- **No raw rgba() in CSS Modules**: Always use `var(--color-*)` tokens — raw values break dark mode

### IPC Commands
- Return `Result<T, String>` — Tauri serializes errors to frontend
- Use types from `common-types` crate
- Map errors: `.map_err(|e| format!("Failed to <action>: {e}"))`
- Mutex locks: `db.0.lock().unwrap_or_else(|e| e.into_inner())` — recover from poison, don't propagate

### State
- All reactive state as `@preact/signals` at module level
- Canvas state syncs with Konva imperatively via `effect()`

### i18n
- ALL user-visible strings must go through `t()` from `../i18n` — no hardcoded text in components
- Add keys to all 6 locale files (en, fr, es, pt, it, zh) when adding new strings

### CSS
- Design tokens in `global.css` as CSS variables (field notebook palette)
- Components use CSS Modules, reference tokens (never raw values)
- Dark theme via `[data-theme="dark"]` on `<html>`

## Development
```bash
# Full app dev (from project root — NOT desktop/)
cargo tauri dev

# Frontend dev only (from desktop/web/)
npm run dev

# Check workspace
cargo check --workspace

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

**After UI changes:** run `/interface-design:audit` to check design system compliance. Run `/interface-design:critique` after building major new components

## Gotchas

### Tauri v2
- **`tauri.conf.json` beforeDevCommand path**: Runs from project root. Uses `npm run --prefix desktop/web dev`, NOT `npm run dev`
- **tauri-specta**: Deferred — specta rc ecosystem has version conflicts. Using plain `generate_handler![]` until stable
- **Emit in setup**: Events fired in `setup()` are lost — frontend JS hasn't loaded yet
- **Blocking dialogs on Linux**: `blocking_save_file()` / `blocking_pick_file()` deadlock on GTK. Use `@tauri-apps/plugin-dialog` JS API from the frontend. Rust commands only handle file I/O, never show dialogs
- **Window permissions**: `decorations: false` + `startDragging()` requires `core:window:allow-start-dragging`, `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, `core:window:allow-close` in `capabilities/main-window.json`
- **Emitter trait**: `app.handle().emit()` requires `use tauri::Emitter`
- **Icons**: `generate_context!()` panics if icon files in tauri.conf.json don't exist on disk
- **Resource path in dev**: `resolve_resource()` may not find bundled files during `cargo tauri dev`. Fall back to `env!("CARGO_MANIFEST_DIR")` path. Always register a fallback in-memory DB so `State<PlantDb>` doesn't panic
- **No blocking dialogs in setup()**: `.blocking_show()` in `setup()` hangs — window hasn't been created. Log errors instead
- **`close()` re-emits `closeRequested`**: Use `destroy()` for discard-without-save. Requires `core:window:allow-destroy`
- **No `window.prompt()`/`confirm()`/`alert()`**: Silently blocked in WebView. Use Preact components for all user input

### Konva.js / Canvas
- **Shapes don't react to CSS theme changes**: Colors hardcoded at creation time. Theme switch requires walking nodes and updating `fill`/`stroke` from computed CSS variables
- **Canvas colors must use `getCanvasColor()` from `theme-refresh.ts`**: Never hardcode fill/stroke on Konva nodes. Add CSS variable to `global.css` (both themes) + cache entry in `theme-refresh.ts`. `refreshCanvasTheme()` in the engine's theme effect walks all layers on toggle
- **Transformer must be on same layer as targets**: Cross-layer Transformer breaks drag/transform
- **`name: 'shape'` only on top-level selectable nodes**: Children inside Groups must NOT have it — causes independent selection
- **Screen-space overlays**: Use HTML `<canvas>` (not Konva layers) for rulers. Konva layers are subject to stage transforms
- **`strokeScaleEnabled: false`**: Keeps stroke width constant in screen pixels. Use on all zone/annotation shapes
- **Group-level counter-scale for plants**: Set `group.scale({x: 1/stageScale, y: 1/stageScale})` on the group, not children
- **`stage.on('dragmove')` fires for shape drags too**: Filter by `e.target !== this.stage`
- **Custom attrs: use `?? null` not `|| null`**: `getAttr()` can return `0` or `''` which are legitimate values
- **Grouped node coordinates**: Always use `node.getAbsolutePosition(layer)` when serializing. `node.x()/y()` are group-relative after grouping
- **`recreateNode` must handle every shape class**: Missing cases fall through to generic `Konva.Shape` which doesn't render
- **AddNodeCommand strips event handlers**: Attach interaction handlers at the stage level, not on individual nodes
- **Zoom display is relative**: `zoomLevel` is raw stage scale. Display as `Math.round((zoomLevel / zoomReference) * 100)%`
- **Compass disabled for MVP**: Import commented out in `engine.ts`
- **Ruler corner uses CSS vars**: `var(--canvas-ruler-bg)` inline so it updates on theme change

### Preact / Signals
- **Preact Vite plugin**: Package is `@preact/preset-vite` (not `@preactjs/preset-vite`)
- **HMR safety**: Module-level `effect()` and `addEventListener` must store disposers and clean up via `import.meta.hot.dispose()`
- **Signals + hooks**: Use `useSignalEffect` (not `useEffect`) when subscribing to signals inside components
- **Effect subscription**: Effects only subscribe to signals **read during execution**. An early `return` before reading a signal = never re-runs. Read ALL dependencies BEFORE conditional returns

### Database / SQLite
- **Plant DB schema contract**: `scripts/schema-contract.json` maps canopi-data export columns to canopi-core.db columns. `prepare-db.py` reads from this contract, not hardcoded lists. When canopi-data changes column names, update the contract — not the Rust code
- **canopi-data column renames (completed 3.0)**: `life_cycle` replaced by `is_annual`/`is_biennial`/`is_perennial` (booleans), `nitrogen_fixation` replaced by `nitrogen_fixer` (integer). All layers updated: prepare-db.py, Rust types, query builder, frontend types, display-modes, detail card. Filter UI keeps `life_cycle: string[]` for OR-semantics, mapped to boolean columns in `query_builder.rs`
- **Schema version**: `PRAGMA user_version = 2` in canopi-core.db. Rust backend warns if < 2 at startup
- **Filter-to-column mapping**: `SpeciesFilter.life_cycle: Vec<String>` maps to boolean columns via `query_builder.rs` (e.g. `"Annual"` → `is_annual = 1`). This preserves OR-semantics in the UI while the DB uses boolean columns. Don't change the filter type — change the query mapping
- **No `sqlite3` CLI on this machine**: Use `python3 -c "import sqlite3; ..."` for DB inspection
- **No `pip`/`pip3` on this machine**: Use `python3 -c "import ..."` for ad-hoc checks. Only stdlib modules available
- **rusqlite feature**: Use `bundled-full` (not `bundled`) — enables FTS5 full-text search
- **Plant DB PRAGMAs**: On read-only connections, do NOT set `journal_mode=WAL` or `query_only=true`. Only `mmap_size` and `cache_size`
- **`translated_values` table is wide format**: Columns are `field_name`, `value_en`, `value_fr`, `value_es`, `value_pt`, `value_it`, `value_zh`. NOT a normalized table with `language`/`translated` columns. `translate_value()` in `plant_db.rs` maps locale to column name via allowlist
- **FTS5 MATCH syntax**: Always use full table name (`species_search_fts MATCH ?1`), never an alias
- **FTS5 sanitization**: Strip ALL metacharacters `"()*+-^:\` — not just quotes. Empty after sanitization → skip FTS
- **Species table name**: `species` (NOT `silver_species` as in the architecture draft)
- **Migration versioning**: User DB uses `PRAGMA user_version` — check before adding migrations
- **Plant DB degraded mode**: If missing/corrupt, `lib.rs` falls back to in-memory DB. Frontend short-circuits all species IPC calls when degraded

### Canvas Engine / Architecture
- **Every new canvas module must be wired into runtime**: Must be imported and called from `engine.ts` or `serializer.ts`
- **`state/canvas.ts` mirror signals**: `engine.ts` cannot import from `state/design.ts` (circular). Use mirror signals in `state/canvas.ts`
- **MapLibre lazy loading**: Never top-level import. Use dynamic `import('./map-layer')` on first activation
- **`Command` interface**: Every undo/redo command class must include `readonly type = 'commandName'`
- **`CanvasTool` event signatures**: Tool methods use `Konva.KonvaEventObject<MouseEvent>`, not raw `MouseEvent`
- **Panel switching recreates CanvasEngine**: CanvasPanel unmounts/remounts. Re-load via `loadCanvasFromDocument()` + `showCanvasChrome()`
- **Canvas dirty tracking**: `_past.length` caps at 500. Use `_savedPosition` checkpoint. `history.clear()` must NOT trigger dirty
- **Vitest with Konva**: Requires `canvas` npm package as devDependency

### Platform / Build
- **Linux deps**: `sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev patchelf` — do NOT install `libappindicator3-dev`
- **Dev environment is Linux-only**: No macOS or Windows access. Cross-platform native libs (lib-swift, lib-cpp) require CI (GitHub Actions) + beta testers for validation
- **`std::fs::rename` on Windows**: Fails with locked files. Use `design::atomic_replace()` with rollback sidecar

## Document Lifecycle (enforced — Phase 2.1 implemented)
- **`toCanopi(engine, metadata, doc)` is the sole save composition point** — all save paths go through it
- **`state/document.ts` is the canonical document API** — external consumers import from here. `state/design.ts` is internal
- **Never regenerate `created_at`** — preserve from loaded file
- **Preserve all loaded document sections on save** — timeline, budget, consortiums, description, location, extra fields
- **Preserve per-object non-visual fields** — plant notes/planted_date/quantity and zone notes as Konva custom attrs
- **Preserve unknown `extra` fields** — `extractExtra()` captures unknown top-level keys. Spread extra FIRST in `toCanopi()`
- **Two-baseline dirty model** — Canvas: `_savedPosition` checkpoint in `CanvasHistory`. Non-canvas: `nonCanvasRevision` vs `nonCanvasSavedRevision`. Never write to `designDirty` directly
- **Autosave** checkpoints same document as manual save. Failures surface via `autosaveFailed` signal
- **Background-image import is gated** — not persisted in `.canopi` yet
- **No serializer/state module cycle** — `serializer.ts` must NOT import from `state/design.ts`
- **Close guard uses `destroy()` not `close()`** — avoids re-entry loop
- **Cross-platform file replace** — `atomic_replace()` in `design/mod.rs`

## Settings Persistence Contract
- **Rust `Settings` (user DB) is the single source of truth** for all user preferences: locale, theme, grid, snap, autosave interval
- **`localStorage` is a sync cache only** — `initTheme()` reads it for instant first-paint, Rust settings overwrite on bootstrap
- **Frontend signals are runtime projections** — hydrated from Rust on startup via `get_settings` IPC
- **`persistCurrentSettings()` in `state/app.ts`** — must include ALL settings in the Rust `Settings` struct
- **Theme**: light/dark only (no system option). Toggle in title bar cycles between the two

## Canvas Architecture
- Zone shapes: world-unit geometry, `strokeScaleEnabled: false` for constant-pixel strokes
- Plant symbols: fixed screen-pixel circles, group-level counter-scale. Labels pending density rework (see `docs/roadmap.md`)
- Grid: single `Konva.Shape` with custom `sceneFunc`, adaptive density via "nice distances" ladder
- Rulers: HTML `<canvas>` elements, NOT Konva — always in screen space
- Scale bar: uses `--color-text-muted` for theme-aware rendering
- File dialogs: JS `@tauri-apps/plugin-dialog` API, NOT Rust `blocking_*`
- `_chromeEnabled` signal: controls grid/ruler visibility — must be a signal so effects track it

## Quality Process
- After completing a phase or significant feature, run `/craft` with two parallel code-reviewer agents
- Fix all issues, re-review until convergence (typically 2 rounds)
- For UI work: run `/interface-design:critique` to verify design system adherence
- Verify interactive features via Tauri MCP (screenshot + interact) — do not rely solely on `tsc`/`npm test`
- Max 3 sub-phases between live app verification runs

## Key Documents
- Roadmap: `docs/roadmap.md`
- Design system: `.interface-design/system.md`
- Completed phase plans + reviews: `docs/archive/`

## Context7 Library IDs
- Tauri v2: `/websites/v2_tauri_app`
- rusqlite: `/rusqlite/rusqlite`
- Konva.js: `/konvajs/site`
- MapLibre: `/maplibre/maplibre-gl-js`
- i18next: `/i18next/react-i18next`
