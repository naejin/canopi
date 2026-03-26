# Phase 0 — Scaffold & Shell

## Context

Canopi has a comprehensive architecture plan (`docs/plans/architecture-draft.md`) but zero code. This phase creates the entire project skeleton: Rust workspace with 5 crates, Tauri v2 app, Preact/Vite frontend, VSCode-like UI shell, dark/light theme, i18n, settings system, logging, and CI. The goal is a working app that opens a window with the full UI shell — ready for Phase 1 (Plant DB) to build on.

**Toolchain available**: rustc 1.94.0, node 22.22.0, npm 10.9.4. Missing: `tauri-cli`.

---

## Development Workflow — Applied Every Sub-phase

### Canopi Plugin (`canopi@canopi-team`)

Before writing code in any domain, **invoke the relevant skill** to load project conventions and patterns:

| Domain | Skill to invoke | What it provides |
|--------|----------------|-----------------|
| Any Rust code | `/canopi-rust` | AppState pattern, IPC commands, specta types, error handling, Cargo.toml conventions |
| Any UI component | `/canopi-ux` | Design tokens, color palette, dark/light theme, spacing, a11y, empty states, CSS Module patterns |
| Database work | `/canopi-db` | Connection pattern (Arc + Mutex), prepared statements, user.db schema, query conventions |
| Internationalization | `/canopi-i18n` | i18next core setup, signal sync, JSON structure, locale formatting rules, CJK considerations |
| Native platform code | `/canopi-native` | Platform trait, conditional compilation, FFI bridge patterns |
| Tests / CI | `/canopi-test` | Test structure, CI pipeline patterns, quality gates |
| Canvas engine | `/canopi-canvas` | (Phase 2+) Konva imperative API, tool system, command undo/redo |

**Hooks enforce automatically**: PostToolUse checks for convention violations on every Write/Edit (wrong imports, Tailwind classes, connection pools). PreToolUse blocks banned package installs.

### Context7 — Query Before Using Library APIs

**Always query Context7 for up-to-date docs before writing code that uses any library API.** Do not rely on training data for API specifics.

| Library | Context7 ID | Query when |
|---------|------------|------------|
| Tauri v2 | `/websites/v2_tauri_app` | Writing tauri.conf.json, IPC commands, plugins, window config, capabilities |
| Preact | resolve via `resolve-library-id` | Component API, hooks, JSX specifics, compat layer |
| @preact/signals | resolve via `resolve-library-id` | Signal creation, computed, effect, component integration |
| rusqlite | `/rusqlite/rusqlite` | Connection setup, prepared statements, pragmas, bundled feature |
| tauri-specta | `/websites/rs_tauri-specta_2_0_0-rc_21` | Builder pattern, collect_commands!, TypeScript export |
| i18next | `/i18next/react-i18next` | Core init (not the React wrapper), changeLanguage, interpolation |
| Vite | resolve via `resolve-library-id` | Config, plugins, dev server, build options |

**Rule**: If you're about to write `tauri::Builder::default()`, query Context7 first. If you're about to write `i18n.init({...})`, query Context7 first. Always.

---

## Sub-phase 0a: Git + Workspace + Crate Skeleton

**Goal**: All 5 crates compile. No Tauri yet — just Rust.

**Before starting**: Invoke `/canopi-rust`. Query Context7 for `rusqlite` (connection setup, bundled feature) and `tauri-specta` (type derives).

### Steps

1. `git init` in `/home/daylon/projects/canopi`
2. Install tauri-cli: `cargo install tauri-cli --version "^2.0.0" --locked`
3. Create root files:
   - `Cargo.toml` — workspace with members: `desktop`, `common-types`, `lib-swift`, `lib-cpp`, `lib-c`
   - `.gitignore` — Rust + Node + Tauri patterns
   - `LICENSE` — GPL-3.0 (per architecture draft)

4. Create `common-types/` crate:
   - `common-types/Cargo.toml` — deps: `serde`, `serde_json`, `specta`
   - `common-types/src/lib.rs` — re-exports modules
   - `common-types/src/species.rs` — `SpeciesListItem`, `SpeciesFilter`, `PaginatedResult`, `SpeciesDetail`, `Relationship` (all derive `Serialize, Deserialize, specta::Type`)
   - `common-types/src/design.rs` — `CanopiFile`, `PlacedPlant`, `Consortium`, `TimelineAction`, `BudgetItem`, `Layer`, `Zone`
   - `common-types/src/settings.rs` — `Settings`, `Locale` enum, `Theme` enum
   - `common-types/src/content.rs` — `Topic`, `DbStatus`

5. Create native lib stubs (conditional compilation — only compile on their platform):
   - `lib-swift/Cargo.toml` — `[target.'cfg(target_os = "macos")'.dependencies]`
   - `lib-swift/src/lib.rs` — empty stub with `#![cfg(target_os = "macos")]`
   - `lib-cpp/Cargo.toml` — same pattern for windows
   - `lib-cpp/src/lib.rs` — `#![cfg(target_os = "windows")]`
   - `lib-c/Cargo.toml` — same for linux
   - `lib-c/src/lib.rs` — `#![cfg(target_os = "linux")]`, minimal Platform trait impl stub

6. Create `desktop/` crate skeleton (no Tauri setup yet, just module structure):
   - `desktop/Cargo.toml` — deps: `tauri`, `rusqlite` (bundled), `serde`, `serde_json`, `tracing`, `tracing-subscriber`, `tauri-specta`, `specta-typescript`, `common-types` (path), platform libs (conditional)
   - `desktop/src/main.rs` — entry point
   - `desktop/src/lib.rs` — module declarations + `run()` function
   - `desktop/src/commands/mod.rs` — command module declarations
   - `desktop/src/commands/settings.rs` — `get_settings`, `set_settings` stubs (with `#[specta::specta]`)
   - `desktop/src/commands/species.rs` — `search_species` stub
   - `desktop/src/commands/design.rs` — `save_design`, `load_design` stubs
   - `desktop/src/commands/content.rs` — `list_learning_topics` stub
   - `desktop/src/db/mod.rs` — `PlantDb`, `UserDb` state structs
   - `desktop/src/db/user_db.rs` — user.db init + settings queries
   - `desktop/src/platform/mod.rs` — `Platform` trait + conditional `NativePlatform` alias
   - `desktop/src/design/mod.rs` — placeholder

**Checkpoint**: `cargo check --workspace` passes

---

## Sub-phase 0b: Tauri v2 + Preact/Vite Frontend

**Goal**: `cargo tauri dev` opens a window showing "Hello Canopi".

**Before starting**: Query Context7 for Tauri v2 (`/websites/v2_tauri_app`) — tauri.conf.json format, capabilities, window configuration. Query Context7 for Preact (resolve ID first) — Vite plugin setup, JSX config. Query Context7 for `@preact/signals` — signal API.

### Steps

1. Create frontend at `desktop/web/`:
   - `desktop/web/package.json` — deps: `preact`, `@preact/signals`, `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-shell`, `konva`, `i18next`, `@tanstack/virtual-core`, `marked`; devDeps: `@preactjs/preset-vite`, `vite`, `typescript`
   - `desktop/web/vite.config.ts` — `@preactjs/preset-vite` plugin, resolve aliases (`react` → `preact/compat`, `react-dom` → `preact/compat`)
   - `desktop/web/tsconfig.json` — strict, JSX preserve, paths
   - `desktop/web/index.html` — minimal with `<div id="app">`
   - `desktop/web/src/main.tsx` — `render(<App />, document.getElementById('app'))`
   - `desktop/web/src/app.tsx` — placeholder "Hello Canopi"

2. Configure Tauri (query Context7 for current tauri.conf.json schema):
   - `desktop/tauri.conf.json` — productName "Canopi", build commands pointing to `web/`, devUrl `http://localhost:1420`, window 1280x800
   - `desktop/capabilities/main-window.json` — default window capabilities (core:default, dialog, shell)
   - Update `desktop/Cargo.toml` with Tauri v2 deps and features
   - Update `desktop/src/lib.rs` with Tauri builder + `tauri-specta` integration (query Context7 for `tauri-specta`):
     ```rust
     let builder = tauri_specta::Builder::<tauri::Wry>::new()
         .commands(tauri_specta::collect_commands![...]);
     ```

3. `cd desktop && npm install --prefix web && cargo tauri dev`

**Checkpoint**: Window opens showing "Hello Canopi"

---

## Sub-phase 0c: UI Shell

**Goal**: VSCode-like layout with activity bar, panel switching, status bar, dark/light theme.

**Before starting**: Invoke `/canopi-ux` to load the full design system (colors, tokens, spacing, dark mode, a11y rules, empty states). All design tokens, colors, and interaction patterns come from this skill.

### Files to create

**State** (`desktop/web/src/state/`):
- `app.ts` — signals: `activePanel`, `locale`, `theme`, `dbReady`

**Styles** (`desktop/web/src/styles/`):
- `global.css` — CSS variables for all design tokens from `/canopi-ux` (colors: `#2D5F3F` primary, `#64748B` secondary, `#D4A843` accent, etc.), light/dark theme via `[data-theme="dark"]`, system font stack, CSS reset, 4px spacing scale

**Components** (`desktop/web/src/components/`):
- `activity-bar/ActivityBar.tsx` + `ActivityBar.module.css` — 5 icon buttons (leaf, pencil, globe, book, folder), highlights active panel, 48px fixed width
- `activity-bar/icons.tsx` — SVG icon components for the 5 panels
- `panels/PlantDbPanel.tsx` — placeholder with empty state: "Search 175,000+ plants by name, family, or use"
- `panels/CanvasPanel.tsx` — placeholder with empty state
- `panels/WorldMapPanel.tsx` — placeholder
- `panels/LearningPanel.tsx` — placeholder
- `panels/SavedDesignsPanel.tsx` — placeholder (sidebar overlay, not main panel)
- `shared/StatusBar.tsx` + `StatusBar.module.css` — locale dropdown, theme toggle, design info area
- `shared/ThemeToggle.tsx` — light/dark/system toggle

**Root** (`desktop/web/src/`):
- Update `app.tsx` — layout: activity bar (left) + active panel (center) + status bar (bottom). Panel switching driven by `activePanel` signal.

**Theme logic**:
- `desktop/web/src/utils/theme.ts` — detect system theme via `window.matchMedia`, apply `data-theme` attribute on `<html>`, persist choice to localStorage (later to user.db)

**Checkpoint**: App shows activity bar with 5 icons, clicking switches panels (showing placeholder content), status bar at bottom, dark/light theme toggle works

---

## Sub-phase 0d: Backend Foundation

**Goal**: Settings persist in user.db, logging works, startup sequence implemented.

**Before starting**: Invoke `/canopi-rust` and `/canopi-db`. Query Context7 for rusqlite (`/rusqlite/rusqlite`) — connection flags, PRAGMA setup, prepared statements. Query Context7 for Tauri v2 — managed state, events, app data dir resolution.

### Files to create/modify

**User DB**:
- `desktop/migrations/init.sql` — CREATE TABLE for settings (key TEXT PRIMARY KEY, value TEXT), recent_files, favorites
- Update `desktop/src/db/user_db.rs` — init from migration SQL, get/set settings functions (prepared statements only, per `/canopi-db`)
- Update `desktop/src/commands/settings.rs` — working `get_settings` / `set_settings` IPC commands (return `Result<T, String>` per `/canopi-rust`)

**Logging**:
- `desktop/src/logging.rs` — `tracing` + `tracing-subscriber` setup: file appender to `{app_data_dir}/logs/`, log rotation (7 days), JSON format, level from settings

**Startup sequence** (update `desktop/src/lib.rs`):
1. Create window immediately (shell visible <500ms)
2. Background: open user.db, load settings
3. Background: open plant DB (placeholder — actual DB comes in Phase 1)
4. Emit `db_ready` event to frontend
5. Background: check for updates (placeholder)

**tauri-specta bindings** (query Context7 for tauri-specta):
- Export TypeScript bindings to `desktop/web/src/bindings.ts` on debug builds
- Frontend IPC wrapper: `desktop/web/src/ipc.ts` — thin typed wrapper using generated bindings

**Checkpoint**: Settings save/load via IPC, logs written to disk, startup sequence completes

---

## Sub-phase 0e: i18n + Command Palette + Keyboard Shortcuts

**Goal**: Language switching works, command palette opens, keyboard shortcuts functional.

**Before starting**: Invoke `/canopi-i18n` for i18n patterns and `/canopi-ux` for command palette UX. Query Context7 for i18next (`/i18next/react-i18next`) — core init API (we use core only, NOT the React/Preact wrapper).

### i18n

- `desktop/web/src/i18n/index.ts` — i18next core init, synced with `locale` signal via `effect()` (pattern from `/canopi-i18n`)
- `desktop/web/src/i18n/en.json` — English UI strings (activity bar labels, panel titles, status bar, settings, common actions)
- `desktop/web/src/i18n/fr.json` — French translations
- `desktop/web/src/i18n/es.json` — Spanish
- `desktop/web/src/i18n/pt.json` — Portuguese
- `desktop/web/src/i18n/it.json` — Italian
- `desktop/web/src/i18n/zh.json` — Chinese Simplified
- Export `t` function: `import { t } from '../i18n'` (never `useTranslation()`)
- Update `StatusBar.tsx` — language picker dropdown (all 6 languages, per `/canopi-i18n` locale formatting)
- `desktop/src/i18n.rs` — system locale detection via Rust (platform-native)

### Command Palette

- `desktop/web/src/components/shared/CommandPalette.tsx` + `CommandPalette.module.css` — modal overlay, search input, filterable command list, keyboard navigation (up/down/enter/escape). Follow `/canopi-ux` interaction patterns.
- `desktop/web/src/commands/registry.ts` — command registry: `{ id, label, shortcut?, action }[]`. Initial commands: switch panels, toggle theme, toggle language, open/save design (stubs)
- Trigger: `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)

### Keyboard Shortcuts

- `desktop/web/src/shortcuts/manager.ts` — global keyboard event listener, shortcut registry, prevents conflicts with browser defaults
- Initial shortcuts: `Ctrl+Shift+P` (command palette), `Ctrl+,` (settings), `1-5` (panel switching when not in text input), `Ctrl+S` (save stub), `Ctrl+O` (open stub)

**Checkpoint**: Switching language updates all UI strings. Command palette opens on Ctrl+Shift+P and lists commands. Keyboard shortcuts work.

---

## Sub-phase 0f: CI + CLAUDE.md + Final Polish

**Goal**: CI builds on all 3 platforms, project metadata complete.

**Before starting**: Invoke `/canopi-test` for CI pipeline patterns and quality gates.

### Files to create

- `.github/workflows/build.yml` — GitHub Actions per `/canopi-test`: lint (fmt, clippy, eslint, tsc), unit tests (cargo test, vitest), build matrix (macOS arm64/x64, Windows x64, Linux x64). Cache Rust + Node deps.
- `CLAUDE.md` — project conventions: tech stack, architecture overview, skill invocation rules (`/canopi-rust` before Rust, `/canopi-ux` before UI, etc.), Context7 library IDs, key patterns (no connection pools, no Tailwind, no react-konva, specta not typeshare)
- `README.md` — project description, tech stack, development setup instructions
- Update `.gitignore` as needed

### First commit structure
- Initial commit with all Phase 0 code
- Push to `https://github.com/naejin/canopi`

**Checkpoint**: CI passes on push. App builds on all platforms.

---

## File Summary (~55 files)

```
canopi/
├── .github/workflows/build.yml
├── .gitignore
├── Cargo.toml                          # workspace
├── CLAUDE.md
├── LICENSE
├── README.md
├── common-types/
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs
│       ├── species.rs
│       ├── design.rs
│       ├── settings.rs
│       └── content.rs
├── desktop/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── main-window.json
│   ├── migrations/
│   │   └── init.sql
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── logging.rs
│   │   ├── i18n.rs
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── settings.rs
│   │   │   ├── species.rs
│   │   │   ├── design.rs
│   │   │   └── content.rs
│   │   ├── db/
│   │   │   ├── mod.rs
│   │   │   └── user_db.rs
│   │   ├── design/
│   │   │   └── mod.rs
│   │   └── platform/
│   │       └── mod.rs
│   └── web/
│       ├── package.json
│       ├── vite.config.ts
│       ├── tsconfig.json
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── app.tsx
│           ├── ipc.ts
│           ├── bindings.ts                 # generated by tauri-specta
│           ├── state/
│           │   └── app.ts
│           ├── styles/
│           │   └── global.css
│           ├── i18n/
│           │   ├── index.ts
│           │   ├── en.json
│           │   ├── fr.json
│           │   ├── es.json
│           │   ├── pt.json
│           │   ├── it.json
│           │   └── zh.json
│           ├── components/
│           │   ├── activity-bar/
│           │   │   ├── ActivityBar.tsx
│           │   │   ├── ActivityBar.module.css
│           │   │   └── icons.tsx
│           │   ├── panels/
│           │   │   ├── PlantDbPanel.tsx
│           │   │   ├── CanvasPanel.tsx
│           │   │   ├── WorldMapPanel.tsx
│           │   │   ├── LearningPanel.tsx
│           │   │   └── SavedDesignsPanel.tsx
│           │   └── shared/
│           │       ├── StatusBar.tsx
│           │       ├── StatusBar.module.css
│           │       ├── ThemeToggle.tsx
│           │       ├── CommandPalette.tsx
│           │       └── CommandPalette.module.css
│           ├── commands/
│           │   └── registry.ts
│           ├── shortcuts/
│           │   └── manager.ts
│           └── utils/
│               └── theme.ts
├── lib-swift/
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs
├── lib-cpp/
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs
└── lib-c/
    ├── Cargo.toml
    └── src/
        └── lib.rs
```

---

## Key Patterns (enforced by plugin hooks)

- **tauri-specta** for type-safe IPC: `Builder::<tauri::Wry>::new().commands(collect_commands![...])`, export bindings in debug mode
- **@preact/signals** for all state — `signal()`, `computed()`, `effect()` at module level, not Zustand
- **CSS Modules** — `*.module.css` imported as `styles`, never Tailwind
- **i18next core** with `effect(() => i18n.changeLanguage(locale.value))` — no react-i18next wrapper
- **No connection pool** — `Arc<Connection>` (plant DB, read-only) + `Mutex<Connection>` (user DB, writable)
- **All IPC commands** return `Result<T, String>` with `#[specta::specta]` attribute
- **Prepared statements only** — never `format!()` SQL

## Verification

After each sub-phase checkpoint:
- **0a**: `cargo check --workspace` passes
- **0b**: `cd desktop && cargo tauri dev` → window opens
- **0c**: Activity bar visible, panel switching works, theme toggle works
- **0d**: Settings persist across app restart, logs appear in app data dir
- **0e**: Language switching updates UI, command palette opens on Ctrl+Shift+P
- **0f**: `git push` → CI passes on all 3 platforms
