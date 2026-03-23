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

# Generate plant DB (run before first `cargo tauri dev`)
python3 scripts/prepare-db.py

# Build
cargo build --release
```

## Gotchas
- **tauri-specta**: Deferred — specta rc ecosystem has version conflicts. Using plain `generate_handler![]` until stable
- **Tauri v2 emit in setup**: Events fired in `setup()` are lost — frontend JS hasn't loaded yet. DB is ready synchronously before any IPC call
- **Tauri v2 Emitter trait**: `app.handle().emit()` requires `use tauri::Emitter`
- **Tauri icons**: `generate_context!()` panics if icon files in tauri.conf.json don't exist on disk
- **Preact Vite plugin**: Package is `@preact/preset-vite` (not `@preactjs/preset-vite`)
- **Linux deps**: `sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev patchelf` — do NOT install `libappindicator3-dev` (conflicts with ayatana)
- **HMR safety**: Module-level `effect()` and `addEventListener` must store disposers and clean up via `import.meta.hot.dispose()`
- **Signals + hooks**: Use `useSignalEffect` (not `useEffect`) when subscribing to signals inside components — avoids fragile implicit subscriptions
- **Migration versioning**: User DB uses `PRAGMA user_version` to track schema version — check before adding migrations
- **rusqlite feature**: Use `bundled-full` (not `bundled`) — enables FTS5 full-text search
- **Plant DB PRAGMAs**: On read-only connections, do NOT set `journal_mode=WAL` (creates sidecar files triggering dev watcher loops) or `query_only=true` (breaks FTS5 shadow table updates). Only set `mmap_size` and `cache_size`.
- **FTS5 MATCH syntax**: Always use full table name (`species_search_fts MATCH ?1`), never an alias — SQLite treats aliases as column names. Sanitize user input: strip `"()*+-^:` before MATCH.
- **Tauri resource path in dev**: `resolve_resource()` may not find bundled files during `cargo tauri dev`. Fall back to `env!("CARGO_MANIFEST_DIR")` path. Always register a fallback in-memory DB so `State<PlantDb>` doesn't panic.
- **No blocking dialogs in setup()**: `tauri_plugin_dialog` `.blocking_show()` in `setup()` hangs — the window hasn't been created yet. Log errors instead.
- **Species table name**: The export table is `species` (NOT `silver_species` as in the architecture draft)

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
