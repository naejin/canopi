# Canopi — Agroecological Design App

## Tech Stack
- **Backend**: Rust workspace (Tauri v2 + rusqlite + specta)
- **Frontend**: Preact + @preact/signals + TypeScript + Vite + CSS Modules
- **Canvas**: Konva.js (imperative API, NOT react-konva)
- **i18n**: i18next core (NOT react-i18next), 6 languages
- **Maps**: MapLibre GL JS (Phase 3+)
- **Native**: lib-swift (macOS), lib-cpp (Windows), lib-c (Linux) — Phase 3+

## Project Structure
```
canopi/
├── desktop/          # Tauri v2 app crate
│   ├── src/          # Rust backend
│   ├── web/          # Preact frontend
│   └── tauri.conf.json
├── common-types/     # Shared Rust ↔ TS types
├── lib-swift/        # macOS native (stub)
├── lib-cpp/          # Windows native (stub)
└── lib-c/            # Linux native (stub)
```

## Key Conventions

### Before Writing Code
Invoke the relevant canopi skill: `/canopi-rust`, `/canopi-ux`, `/canopi-db`, `/canopi-canvas`, `/canopi-i18n`, `/canopi-native`, `/canopi-test`. Query Context7 for library API docs.

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
- Design tokens in `global.css` as CSS variables
- Components use CSS Modules, reference tokens (never raw values)
- Dark theme via `[data-theme="dark"]` on `<html>`

## Development
```bash
# Frontend dev
cd desktop/web && npm run dev

# Full app dev (from project root — NOT desktop/)
cargo tauri dev

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

# Build
cargo build --release
```

## Gotchas
- **tauri-specta**: Deferred — specta rc ecosystem has version conflicts. Using plain `generate_handler![]` until stable
- **Tauri v2 emit in setup**: Events fired in `setup()` are lost — frontend JS hasn't loaded yet. DB is ready synchronously before any IPC call
- **Tauri v2 blocking dialogs on Linux**: `blocking_save_file()` / `blocking_pick_file()` from `tauri_plugin_dialog` deadlock on Linux/GTK. Use `@tauri-apps/plugin-dialog` JS API (`save()`, `open()`) from the frontend instead. Rust commands only handle file I/O, never show dialogs.
- **Tauri v2 window permissions**: `decorations: false` + `startDragging()` requires `core:window:allow-start-dragging`, `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, `core:window:allow-close` in `capabilities/main-window.json`
- **Tauri v2 Emitter trait**: `app.handle().emit()` requires `use tauri::Emitter`
- **Tauri icons**: `generate_context!()` panics if icon files in tauri.conf.json don't exist on disk
- **Preact Vite plugin**: Package is `@preact/preset-vite` (not `@preactjs/preset-vite`)
- **Linux deps**: `sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev patchelf` — do NOT install `libappindicator3-dev` (conflicts with ayatana)
- **HMR safety**: Module-level `effect()` and `addEventListener` must store disposers and clean up via `import.meta.hot.dispose()`
- **Signals + hooks**: Use `useSignalEffect` (not `useEffect`) when subscribing to signals inside components — avoids fragile implicit subscriptions
- **Migration versioning**: User DB uses `PRAGMA user_version` to track schema version — check before adding migrations
- **rusqlite feature**: Use `bundled-full` (not `bundled`) — enables FTS5 full-text search
- **Plant DB PRAGMAs**: On read-only connections, do NOT set `journal_mode=WAL` (creates sidecar files triggering dev watcher loops) or `query_only=true` (breaks FTS5 shadow table updates). Only set `mmap_size` and `cache_size`.
- **FTS5 MATCH syntax**: Always use full table name (`species_search_fts MATCH ?1`), never an alias — SQLite treats aliases as column names.
- **FTS5 sanitization must strip ALL metacharacters**: `"()*+-^:\` — not just quotes. Incomplete sanitization causes FTS5 syntax errors. If input reduces to empty after sanitization, skip FTS entirely.
- **Tauri resource path in dev**: `resolve_resource()` may not find bundled files during `cargo tauri dev`. Fall back to `env!("CARGO_MANIFEST_DIR")` path. Always register a fallback in-memory DB so `State<PlantDb>` doesn't panic.
- **No blocking dialogs in setup()**: `tauri_plugin_dialog` `.blocking_show()` in `setup()` hangs — the window hasn't been created yet. Log errors instead.
- **Species table name**: The export table is `species` (NOT `silver_species` as in the architecture draft)
- **@preact/signals effect subscription**: Effects only subscribe to signals **read during execution**. An early `return` before reading a signal = the effect never subscribes to it and never re-runs. Always read ALL signal dependencies BEFORE any conditional returns.
- **Konva Transformer must be on same layer as targets**: Cross-layer Transformer (e.g. Transformer on annotations, shape on zones) breaks drag/transform. Move Transformer to the target's layer in `_syncTransformer`.
- **Konva `name: 'shape'` only on top-level selectable nodes**: Children inside Groups (e.g. plant circle, measure label) must NOT have `name: 'shape'` — it makes them independently draggable/selectable, separating them from their parent group.
- **Konva screen-space overlays**: Use HTML `<canvas>` elements (not Konva layers) for rulers and other screen-space UI. Konva layers are subject to stage transforms — counter-transforming them causes 1-frame lag.
- **Konva `strokeScaleEnabled: false`**: Built-in property that keeps stroke width constant in screen pixels regardless of zoom. Use on all zone/annotation shapes. Don't write custom zoom-scaling systems.
- **Konva group-level counter-scale for plants**: Set `group.scale({x: 1/stageScale, y: 1/stageScale})` on the group, not individual children. Children use plain screen-pixel values. One scale update per group on zoom = zero lag.
- **Canvas `stage.on('dragmove')` fires for shape drags too**: Filter by `e.target !== this.stage` to avoid heavy overlay redraws during shape drag. Only sync overlays for stage-level pans.
- **Plant DB degraded mode**: If plant DB is missing/corrupt, `lib.rs` falls back to in-memory DB and reports `PlantDbStatus::Missing`/`Corrupt` via `get_health` IPC. Frontend short-circuits all species IPC calls when degraded and shows a banner. Do not add more silent fallbacks.
- **Tauri v2 `close()` re-emits `closeRequested`**: `getCurrentWindow().close()` triggers the close guard again. Use `destroy()` for discard-without-save. Requires `core:window:allow-destroy` in capabilities.
- **`std::fs::rename` on Windows with locked files**: Fails if destination held by antivirus/file watcher. Use `design::atomic_replace()` with rollback sidecar — never raw `rename` for overwriting existing files.
- **Konva custom attrs: use `?? null` not `|| null`**: `getAttr()` can return `0` or `''` which are legitimate values. `|| null` collapses them; `?? null` preserves them.
- **Canvas dirty must not use bounded stack length**: `_past.length` caps at `MAX_HISTORY=500`. Use `_savedPosition` checkpoint in `CanvasHistory` instead. `history.clear()` must NOT trigger dirty state changes.
- **Vitest with Konva requires `canvas` npm package**: Install `canvas` as devDependency — Konva's Node.js entry point requires it.

## Document Lifecycle (enforced — Phase 2.1 implemented)
- **`toCanopi(engine, metadata, doc)` is the sole save composition point** — all save paths go through it. The `doc` parameter provides non-canvas sections from `currentDesign`. Never construct a `CanopiFile` from canvas state alone.
- **`state/document.ts` is the canonical document API** — external consumers import from here. `state/design.ts` is internal/transitional.
- **Never regenerate `created_at`** — preserve from loaded file. Only update `updated_at` intentionally on actual save.
- **Preserve all loaded document sections on save** — timeline, budget, consortiums, description, location, extra fields. Do not hardcode empty arrays.
- **Preserve per-object non-visual fields** — plant notes/planted_date/quantity and zone notes stored as Konva custom attrs (`data-notes`, `data-planted-date`, `data-quantity`). Read back with `?? null`.
- **Preserve unknown `extra` fields** — `extractExtra()` captures unknown top-level keys from Rust `#[serde(flatten)]`. Spread extra FIRST in `toCanopi()` return, canonical keys always win.
- **Two-baseline dirty model** — Canvas: `CanvasHistory` tracks a `_savedPosition` checkpoint; `canvasClean` signal is true when `_past.length === _savedPosition`. Safe against 500-cap (truncation shifts `_savedPosition`; if it goes negative, canvas stays dirty). Supports undo-to-clean. Non-canvas: `nonCanvasRevision` vs `nonCanvasSavedRevision`. `designDirty = !canvasClean || nonCanvasRevision !== nonCanvasSavedRevision`. Never write to `designDirty` directly. `history.clear()` must NOT mark canvas dirty.
- **Autosave must checkpoint the same document as manual save** — same composition path, same fields preserved. Autosave failures surface via `autosaveFailed` signal and StatusBar.
- **Background-image import is gated** — not persisted in `.canopi` yet. Command disabled in `registry.ts`. Re-enable when persistence is implemented.
- **No serializer/state module cycle** — `serializer.ts` must NOT import from `state/design.ts`. The `doc` parameter breaks the cycle.
- **Close guard uses `destroy()` not `close()`** — `close()` re-emits `closeRequested` causing infinite loop. Always `destroy()` after user confirms discard.
- **Cross-platform file replace** — `atomic_replace()` in `design/mod.rs` handles Windows file-lock failures. Never use raw `std::fs::rename` for overwriting existing files.

## Settings Persistence Contract
- **Rust `Settings` (user DB) is the single source of truth** for all user preferences: locale, theme, grid, snap, autosave interval.
- **`localStorage` is a sync cache only, not a source of truth** — `initTheme()` reads from localStorage for instant first-paint (avoids flash), but Rust settings overwrite it when bootstrap resolves. The effect writes back to localStorage so the cache stays current.
- **Frontend signals are runtime projections** — hydrated from Rust on startup via `get_settings` IPC, persisted back via `set_settings` on user change.
- **`persistCurrentSettings()` in `state/app.ts`** is the write path — must include ALL user-editable settings that are part of the Rust `Settings` struct.
- **Startup ordering**: `initTheme()` (sync, applies default) → `get_settings` IPC (async, reconciles with persisted values). No flicker because the effect reactively applies the Rust value when it arrives.

## Architecture Review
- Full review and analysis: `docs/reviews/2026-03-24-architecture-review.md` and `2026-03-24-architecture-review-analysis.md`
- Phase 2.1 implementation plan: `docs/plans/phase-2.1-document-integrity.md`
- Code review rounds: `docs/reviews/code/` — 3 rounds, all findings resolved

## Canvas Architecture
- Zone shapes: world-unit geometry, `strokeScaleEnabled: false` for constant-pixel strokes
- Plant symbols: fixed screen-pixel circles (8px radius), group-level counter-scale, common name primary label
- Annotations (text, measures): counter-scaled at creation + on zoom via `updateAnnotationsForZoom()`
- Grid: single `Konva.Shape` with custom `sceneFunc`, adaptive density via "nice distances" ladder
- Rulers: HTML `<canvas>` elements, NOT Konva — always in screen space
- File dialogs: JS `@tauri-apps/plugin-dialog` API, NOT Rust `blocking_*`
- `_chromeEnabled` signal: controls grid/ruler/compass visibility — must be a signal (not plain boolean) so effects track it

## Quality Process
- After completing a phase or significant feature, run Craft skill review (`/craft`) with two parallel code-reviewer agents (backend + frontend)
- Fix all issues, re-review until convergence (typically 2 rounds)
- Run `/canopi:canopi-retro` at session end to update skills with learnings

## Context7 Library IDs
- Tauri v2: `/websites/v2_tauri_app`
- rusqlite: `/rusqlite/rusqlite`
- Konva.js: `/konvajs/site`
- MapLibre: `/maplibre/maplibre-gl-js`
- i18next: `/i18next/react-i18next`
