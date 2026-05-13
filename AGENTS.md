# Agent Operating Contract

These instructions are for AI agents working in this repository. Optimize for long-term project health, reviewable changes, and reliable handoff over local speed.

## Operating Priorities

- Preserve user work. Check `git status --short --branch` before editing, and treat pre-existing dirty or untracked files as user-owned unless explicitly told otherwise.
- Track all work in `bd`. Do not use markdown TODO lists, TodoWrite, TaskCreate, or ad hoc task trackers.
- Keep scope narrow. Implement the claimed bead; create follow-up beads for new work instead of silently expanding scope.
- Prefer small, reversible changes. Avoid broad rewrites unless the bead explicitly calls for one.
- Never weaken tests, type checks, lint rules, or architecture guardrails just to make a gate pass. If a guardrail is wrong, document why and replace it with an equivalent or stronger guardrail.
- Do not introduce runtime dependencies unless the bead or PR explains why existing project patterns are insufficient.

## Repository Map

- `desktop/src/`: Rust Tauri backend, IPC commands, DB access, platform code, and services.
- `desktop/web/src/`: Preact frontend, canvas runtime, UI components, app controllers, and `__tests__/`.
- `desktop/web/src/app/`: frontend orchestration and application coordination.
- `common-types/`: shared Rust and TypeScript contracts. Regenerate bindings when these change.
- `bindings-gen/`: codegen for frontend transport bindings.
- `scripts/`: database preparation and release tooling.
- `.interface-design/`: design system directory (removed — tokens documented in this file and in `global.css`).

## Common Commands

```bash
# Full app dev (from project root — NOT desktop/)
cargo tauri dev

# Frontend only (from desktop/web/)
npm run dev

# Frontend tests
npm test

# TypeScript check
cd desktop/web && npx tsc --noEmit

# Regenerate shared TypeScript bindings
cd desktop/web && npm run gen:types

# Verify generated bindings are committed
cd desktop/web && npm run check:types

# Rust workspace check (without plant DB)
CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace

# Rust tests
cargo test --workspace

# Generate plant DB (first time only)
python3 scripts/prepare-db.py

# Build release
cargo build --release
```

## Start-of-Session Workflow

1. Run `bd prime` when you need the full issue workflow or command reference.
2. Run `git status --short --branch` before making changes.
3. Inspect available work with `bd ready`, or inspect the requested bead with `bd show <id>`.
4. Claim work before coding with `bd update <id> --claim`.
5. For implementation beads, start from `main`, run `git pull --rebase`, then create a scoped branch such as `refactor/document-session-transition`.
6. Direct `main` work is acceptable only for explicitly requested mainline maintenance, small docs-only updates, or repository administration.

## Branch And Git Hygiene

- Use one branch per implementation bead unless the user explicitly requests otherwise.
- Name branches by intent: `feature/...`, `fix/...`, `refactor/...`, `test/...`, or `docs/...`.
- Stage only files you intentionally changed for the bead. Do not stage unrelated dirty files.
- If unrelated tracked changes block rebase, testing, or push, ask before stashing unless the user has already approved autostash for that operation.
- Never use destructive git commands such as `git reset --hard` or `git checkout -- <file>` unless the user explicitly requests them.
- Keep generated files in the same commit as the source change that produced them.
- Use commit messages matching the existing style, for example `fix(frontend): ...`, `test(frontend): ...`, `docs: ...`, or `refactor(backend): ...`.

## Coding Style

- Follow existing file style; do not reformat unrelated code.
- TypeScript and Preact use 2-space indentation.
- Preact components use `PascalCase`; functions and signals use `camelCase`; CSS module files use `kebab-case`.
- Rust follows standard Rust style: `snake_case` for functions/modules and `CamelCase` for types.
- Add comments only when they clarify non-obvious behavior, invariants, or architecture boundaries.

## Quality Gates

- Docs-only changes do not require code tests, but the final handoff must say tests were skipped because the change was docs-only.
- Frontend tests live in `desktop/web/src/__tests__/` as `*.test.ts` or `*.test.tsx`.
- Bug fixes require focused regression tests, especially around document lifecycle, canvas runtime, IPC boundaries, persistence, and shared contracts.
- Frontend changes require `cd desktop/web && npx tsc --noEmit` and focused Vitest coverage.
- Run `cd desktop/web && npm test` when the frontend surface area is broad or the change touches shared runtime behavior.
- Shared contract changes require `cd desktop/web && npm run gen:types` and `cd desktop/web && npm run check:types`.
- Rust changes require `CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace`.
- Persistence, database, IPC, or shared type changes require the relevant frontend checks plus `cargo test --workspace`.
- If a required gate cannot be run, record the exact command, failure reason, and residual risk in the bead and final handoff.

## Subagent Rules

- Use subagents only when the user explicitly asks for delegation or parallel agent work.
- Use subagents for bounded exploration, independent verification, or disjoint implementation slices.
- Give each implementation subagent explicit file or module ownership.
- Do not let two agents edit the same files in parallel.
- Tell subagents they are not alone in the codebase and must not revert other agents' or user changes.
- The main agent remains responsible for integration, final review, quality gates, bead updates, and push.

## Bead Lifecycle

- Keep the bead status accurate: claim before coding, update when scope changes, and close only after acceptance criteria and local quality gates are satisfied.
- Create follow-up beads for deferred work, discovered bugs, missing tests, or architectural cleanup that is outside the current scope.
- Use `bd remember` for durable project knowledge. Do not create memory files.
- When closing a bead, include a concrete reason that mentions the shipped outcome and any tests run or skipped.

## Handoff Expectations

- File beads for remaining follow-up work before ending the session.
- Run the required quality gates for the files changed.
- Commit all intended changes, including `.beads/issues.jsonl` when bead metadata changed.
- Pull with rebase before pushing unless doing so would disturb user-owned work.
- Push the current branch. For feature/refactor beads, push the bead branch with upstream tracking; push `main` only for intentional mainline work.
- Run `git status --short --branch` after pushing and verify the branch is up to date with its upstream.
- Final handoff must include the bead id, commit hash, branch pushed, tests run or skipped, and any user-owned files left untouched.

---

# Project Overview

## Tech Stack

- **Backend**: Rust workspace (Tauri v2 + rusqlite + specta)
- **Frontend**: Preact + @preact/signals + TypeScript + Vite + CSS Modules
- **Canvas**: PixiJS (primary renderer) + Canvas2D (fallback) — scene-owned runtime via `SceneCanvasRuntime`
- **i18n**: i18next core (NOT react-i18next), 11 languages (en, fr, es, pt, it, zh, de, ja, ko, nl, ru)
- **Maps**: MapLibre GL JS + maplibre-contour. Shared hosted basemap style reused across all live MapLibre surfaces.
- **Native**: lib-c (Linux, Cairo PNG/PDF + inotify + XDG), lib-swift (macOS stub), lib-cpp (Windows stub)

## Project Structure

```
canopi/
├── desktop/          # Tauri v2 app crate
│   ├── src/          # Rust backend
│   ├── web/          # Preact frontend
│   └── tauri.conf.json
├── common-types/     # Shared Rust <-> TS types
├── bindings-gen/     # Codegen for frontend transport bindings
├── scripts/          # DB generation, release tooling
└── lib-c/            # Linux native (stub)
```

## Current Layout

- **Left**: Canvas toolbar (38px) — drawing tools plus plant color action (Select, Hand, Rectangle, Text, Plant Color + Grid/Snap/Rulers toggles)
- **Center**: Canvas workspace
- **Right**: PanelBar (36px, always visible) + sliding panels (plant search, favorites)
- **Bottom**: Bottom panel with Budget and Consortium tabs (Timeline hidden — pending rework)
- **Title bar**: Logo + file name + lang/theme toggle + window controls
- **No activity bar** — removed, navigation via PanelBar
- **No status bar** — removed, controls moved to title bar

## Design Direction

- **Field notebook** aesthetic: parchment, ink, ochre palette. See the Design Direction section and `global.css` for tokens.
- **Green NEVER in UI chrome** — green lives only on the canvas (plant symbols). UI uses ochre `#A06B1F` as primary accent.
- Theme toggle: light/dark only (no system option)
- Depth: borders-only (no dramatic shadows)

---

# Architecture Rules

## Document Mutation Rule

- **No component may replace the active document directly** — only `app/document-session/actions.ts` performs destructive session replacement.
- **No panel may call document replacement directly** — panels request document changes through the document-session actions boundary.
- All document-replacing flows use one shared guard path (dirty check -> confirm -> replace).

## Document Authority Rule

The `.canopi` file has two categories of content with separate authorities:

- **Canvas scene state** (plants, zones, annotations, groups, plant-species-colors, layers) — owned by `SceneStore`. Mutations flow through the canvas runtime. Renderers and interaction are projections of this state.
- **Non-canvas document state** (consortiums, timeline, budget, `budget_currency`, location, description, extra) — owned by the document layer (`state/design.ts`) with higher-level policy in `app/document/controller.ts` and `app/document-session/*`. Mutations flow through `mutateCurrentDesign()` and the feature controllers under `app/*/controller.ts`.

The save path composes both into a single `CanopiFile`. Neither authority should duplicate the other's data. Panels that read canvas entities (plant list, zone names) should use a read-only query interface on the runtime, not mirrored signals.

**Anti-patterns:**
- Do not push non-canvas state (consortiums, timeline, budget, `budget_currency`) into `SceneStore` — it is not a canvas concern.
- Do not mirror canvas state into standalone signals when a derived/computed value or a direct read from the authority would work. Prefer `computed()` signals derived from the authority over manually-synced mirrors.
- Do not create new ad hoc sync paths between the two authorities — if sync is needed, centralize it in one explicit adapter.
- **Adding new document-level fields**: Add to the shared `CanopiFile` contract, regenerate `KNOWN_CANOPI_KEYS`, keep `app/contracts/document.ts` aligned, and add the `serializeDocument()` passthrough. Rust `#[serde(flatten)] extra` round-trips unknown keys automatically, so no Rust struct change is needed until the field requires backend logic.
- **`KNOWN_CANOPI_KEYS` must include `'extra'`** — the `extra` field is a first-class key on `CanopiFile` emitted by the scene codec. Without it, `extractExtra()` captures the `extra` object as an unknown key, risking double-nesting on round-trip.
- **Adding new required array fields to `CanopiFile`**: Add `#[serde(default)]` in Rust (backward compat with old files), make the field required (not optional) in TS `CanopiFile` to match Rust `Vec<T>`, add empty placeholder in `serializeScenePersistedState` in `codec.ts`, and update all test fixtures. The `?? []` fallback is only needed where the parent object is nullable (`currentDesign.value?.field ?? []`), not inside `mutateCurrentDesign` callbacks where the design is guaranteed non-null.
- **Adding a new file-format migration**: Add a match arm in `migrate_design_value()` in `desktop/src/design/format.rs` for the new version, bump `CURRENT_VERSION`, and add the migration function. The loop runs each step sequentially (v1->v2->v3 etc.). Add a test in the same file's `mod tests`.

## Action-Layer Rule

- **Controller/action modules must not import other controller/action modules** — the write boundaries under `app/*/controller.ts` should stay leaf modules.
- Import direction: **components -> actions -> state** (never backwards).
- **Cross-concern orchestration**: When a mutation in one domain must trigger side effects in another (e.g., plant deleted -> orphan cleanup in timeline/budget/consortium), create an explicit workflow module at a higher boundary. Do not wire action modules to each other. See `app/document-session/workflows.ts` for the pattern.
- **Workflow effect lifecycle**: Workflow modules that install `effect()` should manage their own disposer as a module-level singleton (`installX()` / `disposeX()`). This avoids circular imports when both `app/document/controller.ts` and `app/document-session/actions.ts` need to call them. Do not install workflow effects inside `SceneCanvasRuntime` — they belong at the document boundary.
- **Budget actions**: `app/budget/controller.ts` owns `setBudgetCurrency` and `setPlantBudgetPrice`. Price action reads currency from the document (`budget_currency`), not from caller parameters — prevents currency split state.
- **Settings-backed actions**: Action functions that mutate signals backed by Rust `Settings` (e.g., `setBottomPanelOpen`, `setBottomPanelTab`) must call `persistCurrentSettings()` after writing the signal. Exception: 60fps hot paths (e.g., drag resize) should persist on mouse-up, not per-frame.

## Signal Performance in Hot Paths

- **Never write signals unconditionally at 60fps** (e.g. map `move` events). New object literals always fail `Object.is` equality, triggering unnecessary rerenders. Use `.peek()` to read without subscribing, compare before writing.
- **`getBoundingClientRect()` in hot loops**: Cache the DOMRect — don't call twice per pointermove event.

## Async Surface Rule

- When a surface intentionally keeps stale data visible while async work is in flight (debounced search, deferred hydrate, optimistic list), separate **intent state** from **committed data state**.
- Scroll reset, virtualizer reset, and re-measure logic must key off a committed data revision, not raw input/filter signals that can advance before the new payload arrives.
- Increment committed-data revisions only when a new first page replaces the displayed dataset; pagination appends should update measurements in place without forcing a full reset.

## Resource Ownership Rule

- Every resource-owning surface must have **one explicit lifecycle owner** for setup, update, and teardown.
- Applies to: canvas runtime (SceneCanvasRuntime), renderer host, MapLibre instances, timers, listeners, async cancellation tokens, DOM overlays.
- HMR cleanup: module-level `effect()` and `addEventListener` must store disposers and clean up via `import.meta.hot.dispose()`.

## MapLibre Integration Rule

- **MapLibre is a derived visualization layer, not a document authority.** Map layers render scene/document state; they do not own or mutate it.
- Existing full-screen surfaces may keep component-local MapLibre ownership when setup/update/teardown are contained in one component (`LocationTab`, `WorldMapSurface`). In-canvas MapLibre must remain isolated in one dedicated sibling surface/controller and must not be scattered across the canvas runtime or renderer implementations.
- **MapLibre follows canvas camera state (one-directional).** The canvas camera is the authority; the map layer subscribes and projects through read-only runtime/query seams. The current in-canvas basemap is non-interactive and must not mutate document or canvas state.
- **Map/canvas projection is bearing-aware, Mercator-backed, and shared.** `north_bearing_deg` participates in both camera derivation and world<->geo feature projection; do not keep separate bearing math or alternate zoom math in `MapLibreCanvasSurface` or overlay code.
- **Projection backend choice is centralized.** `desktop/web/src/canvas/projection.ts` exposes the active backend seam; the current live backend is the local Mercator frame. Precision warnings and dev diagnostics must derive from that seam rather than ad hoc surface math.
- **Exact sync means no skipped viewport updates.** Do not add camera deadbands/tolerances in `MapLibreCanvasSurface` or other map consumers that can suppress tiny pan/zoom changes.
- **MapLibre bearing adaptation lives at the camera seam.** Preserve document `north_bearing_deg` semantics; if MapLibre-facing bearing handling changes, adapt it inside `canvas/maplibre-camera.ts`, not in panel overlays, canvas state, or document serialization.
- Keep the in-canvas map surface thin. `MapLibreCanvasSurface` owns lifecycle only; helper modules under `desktop/web/src/maplibre/` should own state shaping, basemap presentation, overlay coordination, and terrain diff/apply logic.
- The lazy import boundary around `maplibre-gl` should be preserved for bundle size.
- Rendered panel-map overlays, and any richer future variants, must consume the pure `projectPanelTargetsToMapFeatures()` seam rather than re-resolving panel identity or making MapLibre a second scene/document authority.

## Panel <-> Canvas Reactivity

- **Bottom panel components that read canvas-derived data must subscribe to `sceneEntityRevision`** from `canvas/runtime-mirror-state.ts` to react to canvas mutations (plant placement, undo/redo). Reading `currentCanvasSession.value?.getPlacedPlants()` alone is not reactive — the session reference doesn't change when scene state changes. Panels that only read non-canvas document state (e.g., TimelineTab reads `currentDesign.value?.timeline`) should NOT subscribe — it causes spurious re-renders on every canvas mutation.
- **Cross-domain auto-sync must be a workflow module** (like `consortium-sync-workflow.ts`), not a component-level effect. Component effects only run when mounted — data integrity requires document-level effects that run regardless of which tab is visible.
- **Use `.peek()` in workflow effects** to read signals without subscribing. Only subscribe to the intended trigger signal (e.g., `sceneEntityRevision`). Writing `currentDesign.value` inside an effect that subscribes to it creates re-execution loops.
- **Panel target identity is explicit.** Timeline, budget, and consortium entries use typed `PanelTarget` identity (`placed_plant`, `species`, `zone`, `manual`, `none`) with legacy migration. Do not reintroduce string matching against timeline descriptions, legacy `plants` arrays, budget descriptions, or consortium canonical-name fields.
- **Panel-origin hover/selection is presentation state.** `hoveredPanelTargets` and `selectedPanelTargets` are resolved by `SceneCanvasRuntime` into renderer highlights only. They must not mutate real canvas selection, selection labels, dirty state, or history unless a future slice explicitly chooses and designs that behavior.
- **Canvas-origin hover is separate.** Canvas plant hover publishes `hoveredCanvasTargets` for bottom-panel affordances without changing panel selection/history.

## Canvas2D Tab Components

- **Use `useCanvasRenderer` hook** from `components/canvas/useCanvasRenderer.ts` for DPR-aware canvas setup — handles `devicePixelRatio` scaling, `ResizeObserver`, and redraw lifecycle. Both `ConsortiumChart` and `InteractiveTimeline` use it.
- **Use `canvas2d-utils.ts`** for `cssVar()` (cached CSS variable reads) and `roundRect()` (rounded rectangle path) — shared between `timeline-renderer.ts` and `consortium-renderer.ts`.
- **Shared nice-distance arrays**: `grid.ts` exports `NICE_DISTANCES` — rulers and scale-bar derive subsets via `.filter()` (not `.slice(indexOf())` which silently breaks if the anchor value is removed). Do not create independent copies.
- **Renderer functions receive `t` parameter** for i18n — don't hardcode user-visible strings in Canvas2D renderers.

---

# Backend Rules (Rust / Tauri v2)

## IPC Commands

- Return `Result<T, String>` — Tauri serializes errors to frontend.
- Use types from `common-types` crate.
- Map errors: `.map_err(|e| format!("Failed to <action>: {e}"))`.
- Mutex locks: use `db::acquire(&db.0, "PlantDb")` helper — recovers from poison with `tracing::warn`, don't use inline `lock().unwrap_or_else()` anymore.

## Document Lifecycle

- **`state/document-actions.ts` is the sole document replacement authority** — no component or panel may replace the active document directly. All destructive flows (new, open, template import) go through document-actions.
- **`state/document.ts` is the canonical document API** — external consumers import from here. `state/design.ts` is internal.
- **`session.serializeDocument()` / `SceneStore.toCanopiFile()` is the sole save composition point** — all save paths go through it.
- **Never regenerate `created_at`** — preserve from loaded file.
- **Preserve all loaded document sections on save** — timeline, budget, consortiums, description, location, extra fields.
- **No `?? []` fallbacks on required `CanopiFile` array fields in TS**: Rust `#[serde(default)]` guarantees presence. TS-side `??` fallbacks are dead code that masks type errors. Only use `?? []` where the parent object is nullable (`currentDesign.value?.field ?? []`).
- **`installConsortiumSync()` must be active before any document load completes** — `loadCanvasFromDocument` installs it, but `applyDocumentReplacement` (queued loads, template imports) does not. `CanvasPanel` must call it unconditionally at mount, not only when `currentDesign.value` exists.
- **Two document-load paths must stay in sync for post-load behavior**: `applyDocumentReplacement()` in `document-actions.ts` (open/new/template/OS-open) and `loadCanvasFromDocument()` in `document.ts` (CanvasPanel mount with existing design). Both call `session.zoomToFit()` after hydration. When adding new post-load behavior, update both paths.
- **Preserve per-object non-visual fields** — plant notes/planted_date/quantity and zone notes.
- **Preserve unknown `extra` fields** — `extractExtra()` captures unknown top-level keys. Spread extra FIRST when composing the save output.
- **File format version**: `CURRENT_VERSION` constant in `desktop/src/design/format.rs` — used by migration loop, `create_default()`, and forward-version diagnostic log. Type is `u32` (matches `CanopiFile.version`). Cast to `u64` only at the JSON boundary (`serde_json::as_u64()`).
- **Two-baseline dirty model** — Canvas: `_savedPosition` checkpoint in `SceneHistory` (patch-based). Non-canvas: `nonCanvasRevision` vs `nonCanvasSavedRevision`. Never write to `designDirty` directly.
- **Autosave** checkpoints same document as manual save. Failures surface via `autosaveFailed` signal.
- **No circular imports between scene store and document store** — `SceneStore` and scene runtime must not import `state/design.ts` directly. If the runtime needs to read document state (e.g., for save composition), pass it as a parameter or use a reader interface. The goal is unidirectional data flow, not total isolation.
- **Close guard uses `destroy()` not `close()`** — avoids re-entry loop.
- **Cross-platform file replace** — `atomic_replace()` in `design/mod.rs`.
- **Queued-load handoff** — `consumeQueuedDocumentLoad` routes through document-actions without the dirty guard (file was just opened from OS, no unsaved work to protect).

## Settings Persistence Contract

- **Rust `Settings` (user DB) is the single source of truth** for all user preferences: locale, theme, grid, snap, autosave interval, and bottom-panel open/height/tab state. Map/terrain fields are retained for forward compatibility while in-canvas geo work remains deferred.
- **`localStorage` is a sync cache only** — `initTheme()` reads it for instant first-paint, Rust settings overwrite on bootstrap.
- **Frontend signals are runtime projections** — hydrated from Rust on startup via `get_settings` IPC.
- **`persistCurrentSettings()` in `state/app.ts`** — must include ALL settings in the Rust `Settings` struct.
- **Adding a new persisted setting (end-to-end)**: (1) Add field to Rust `Settings` struct + TS `Settings` interface, (2) Add signal to the appropriate state module, (3) Hydrate from Rust in `app.tsx` bootstrap (`get_settings` handler), (4) Write back in `persistCurrentSettings()` in `state/app.ts`, (5) Call `persistCurrentSettings()` in the action functions that mutate the signal (skip 60fps hot paths like drag — persist on mouse-up instead).
- **Theme**: light/dark only (no system option). Toggle in title bar cycles between the two.

## Tauri v2 Gotchas

- **Use `convertFileSrc()` for cached local images**: The app enables `app.security.assetProtocol` with scope limited to `$APPDATA/image-cache/**`. Image surfaces should return a file path from Rust and convert it in the frontend instead of sending image bytes over IPC.
- **Do not reintroduce base64 image IPC**: The old `get_cached_image_url` pattern froze the UI with multi-megabyte JSON payloads. The current path is `get_cached_image_path` + `convertFileSrc()`.
- **Optimized binary IPC**: For returning large binary data (tiles, images), use `tauri::ipc::Response::new(bytes)` instead of JSON serialization — arrives as `ArrayBuffer` in JS, no base64 overhead. For streaming chunks, use `tauri::ipc::Channel<&[u8]>`.
- **Blocking HTTP/file work must stay off the main command thread**: `ureq` is acceptable, but only behind an async Tauri command boundary that moves the blocking work to `tauri::async_runtime::spawn_blocking`.
- **`tauri.conf.json` beforeDevCommand path**: Uses `{ script: "npm run dev", cwd: "web" }` object format (relative to `desktop/`). NOT a bare `npm run dev` at project root.
- **CSP configured**: `tauri.conf.json` has a strict CSP policy. When adding new resource origins (e.g., tile servers), update CSP directives.
- **`tauri-plugin-shell` removed**: No shell capability. If external process spawning is needed in the future, use Rust `std::process::Command` from a Tauri command, not the shell plugin.
- **Emit in setup**: Events fired in `setup()` are lost — frontend JS hasn't loaded yet.
- **Blocking dialogs on Linux**: `blocking_save_file()` / `blocking_pick_file()` deadlock on GTK. Use `@tauri-apps/plugin-dialog` JS API from the frontend. Rust commands only handle file I/O, never show dialogs.
- **Window permissions**: `decorations: false` + `startDragging()` requires `core:window:allow-start-dragging`, `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, `core:window:allow-close` in `capabilities/main-window.json`.
- **Icons**: `generate_context!()` panics if icon files in tauri.conf.json don't exist on disk.
- **Resource path resolution**: `resolve_plant_db_path()` in `lib.rs` tries `PLANT_DB_BUNDLED_PATHS` (`resources/canopi-core.db`, `canopi-core.db`) via Tauri resource resolver, then falls back to `CARGO_MANIFEST_DIR/resources/` for dev. Always register a fallback in-memory DB so `State<PlantDb>` doesn't panic.
- **No blocking dialogs in setup()**: `.blocking_show()` in `setup()` hangs — window hasn't been created. Log errors instead.
- **`close()` re-emits `closeRequested`**: Use `destroy()` for discard-without-save. Requires `core:window:allow-destroy`.
- **No `window.prompt()`/`confirm()`/`alert()`**: Silently blocked in WebView. Use `ask()` from `@tauri-apps/plugin-dialog` for confirms, Preact components for other input.
- **Theme: light/dark only, no system**: `Theme` enum has only `Light`/`Dark`. `get_settings` migrates stale `"system"` values to `"light"` via JSON patching before deserialization.
- **TitleBar drag handler**: `handleMouseDown` in `TitleBar.tsx` calls `startDragging()` on the title bar. Interactive elements must be caught by `target.closest('button')`.
- **No native `<select>` in UI chrome**: Native dropdowns break the field notebook aesthetic. Use custom dropdown components (see `LocalePicker` in `TitleBar.tsx`).
- **No native `<input type="date">` in UI chrome**: WebKitGTK native calendar popup lifecycle is uncontrollable. Use `DatePicker` from `components/shared/DatePicker.tsx`.
- **WebKitGTK range input thumb alignment**: `<input type="range">` thumbs are NOT vertically centered. Fix: `::-webkit-slider-thumb { margin-top: calc(var(--slider-thumb-size) / -2) }`.

## Build

- **`CANOPI_SKIP_BUNDLED_DB=1`**: Env var checked in `desktop/build.rs`. When set, overrides `tauri.conf.json` bundle resources to an empty list so the crate compiles without a locally generated `canopi-core.db`. Used by CI lint/test jobs.
- **Rust lint gate**: Match CI locally with `cargo clippy --workspace --all-targets -- -D warnings`. `--all-targets` matters; plain workspace clippy can miss test-only warnings.
- **CI release build downloads the DB**: The `build.yml` workflow downloads `canopi-core.db` from the `canopi-core-db` GitHub release tag into `desktop/resources/` before running `tauri build`.
- **Linux bundle**: `--bundles deb appimage` (no RPM).
- **Deb depends**: Explicit `depends` in `tauri.conf.json` uses `|` alternatives for Ubuntu 24.04 t64 transition (`libgtk-3-0 | libgtk-3-0t64`). Tauri *merges* custom depends with auto-detected ones.
- **Package size**: `canopi-core.db` is ~1.1GB, making the `.deb` ~335MB compressed. AppImage is ~351MB.
- **Release candidate workflow**: `.github/workflows/release-candidate.yml` — builds RC artifacts from a release branch. Promotion scripts: `scripts/promote-release.sh` (RC -> release), `scripts/publish-db-release.sh` (upload canopi-core.db to GitHub release tag).
- **Desktop icons**: Generated via `scripts/generate-desktop-icons.sh` from an SVG source. All sizes (32/128/256/icns/ico) must be committed.

## Platform / Native Gotchas

- **Platform trait lives in `desktop/src/platform/mod.rs`**: NOT in `common-types` — `FileWatchHandle` contains closures (not serializable). Lib crates export marker structs, platform/mod.rs implements the trait via conditional modules.
- **`FileWatchHandle` must cancel on drop**: Uses `Option<Box<dyn FnOnce()>>` pattern with `Drop` impl that joins the watcher thread.
- **Cairo deps for lib-c**: `cairo-rs = "0.20"` with `png` + `pdf` features, `inotify = "0.11"`, `libc = "0.2"`.
- **macOS/Windows stubs**: All code `#[cfg(target_os = "...")]` gated. Compiles on Linux via conditional compilation. CI validates on actual platforms.
- **Linux deps**: `sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev patchelf` — do NOT install `libappindicator3-dev`.
- **`std::fs::rename` on Windows**: Fails with locked files. Use `design::atomic_replace()` with rollback sidecar.

---

# Frontend Rules (Preact + Signals + CSS Modules)

## State

- **`unlockSelected()` is actually `unlockAll()`**: The function clears all locked objects, not just selected ones. This is intentional — the sole call site (`Ctrl+L` shortcut) uses it as a toggle: selection present -> lock selected, no selection -> unlock all. Do not "fix" this without updating the shortcut manager.
- All reactive state as `@preact/signals` at module level.
- **Two document authorities** — see Document Authority Rule above.
- **Canvas seam**: App code must not reach into renderer implementations or `SceneCanvasRuntime` internals. `currentCanvasSession` stores `CanvasRuntime | null`; app code consumes `CanvasCommandSurface`, `CanvasQuerySurface`, and `CanvasDocumentSurface` facades.
- **Panel target bridges are presentation-only**: Bottom-panel hover/selection uses typed `PanelTarget[]` (`hoveredPanelTargets`, `selectedPanelTargets`, `selectedPanelTargetOrigin`) and the runtime resolves them into highlights. Do not mutate real canvas selection/history or reintroduce string matching for timeline/budget/consortium identity.
- **Map projection seam is pure, bearing-aware, and Mercator-backed**: `canvas/projection.ts` owns the active projection backend seam, and `projectPanelTargetsToMapFeatures()` resolves typed targets through `resolvePanelTargets()` plus that seam. It does not import MapLibre, write signals, or own document/canvas state.
- **Basemap state semantics**: `layerVisibility.base` / `layerOpacity.base` now mean basemap visibility/opacity for the shared hosted basemap. `gridVisible` is a separate overlay control and must not be re-coupled to the base layer row.
- **`activeLayerName` accepts any layer string**: Scene layers (`annotations`, `plants`, `zones`, `base`) and terrain layers (`contours`, `hillshading`) all participate in LayerPanel expand/collapse.
- **Terrain layer signal asymmetry**: Contours uses `layerVisibility.contours` / `layerOpacity.contours` (same as scene layers). Hillshading uses separate `hillshadeVisible` / `hillshadeOpacity` signals. `LayerPanel` bridges this via `getVisibility()` / `handleToggleVisibility()` helpers.
- **Compass is canvas chrome, not map state**: the north indicator is display-only UI fed by `northBearingDeg`; do not turn it into a second camera authority or map-only rotation control.
- **Exact sync is correctness-critical**: Map camera math, basemap scale, terrain, and projected overlays must derive from the same canonical seam.

## ErrorBoundary

- `ErrorBoundary` class component in `components/shared/ErrorBoundary.tsx` wraps `<App />` in `main.tsx`.
- Catches render-time errors only (not event handlers, async, or `setTimeout`).
- Import `ErrorInfo` from `preact` for `componentDidCatch` — don't redeclare the type inline.
- **No `t()` fallback strings**: i18next with `fallbackLng: 'en'` never returns falsy for existing keys. `t('key') || 'fallback'` is dead code — use `t('key')` directly.

## PanelBar State

- PanelBar includes a visible Location entry. On the welcome screen (no design loaded), location, plant-db, and favorites buttons are `disabled`; the canvas button remains the only always-active entry.

## i18n

- ALL user-visible strings must go through `t()` from `../i18n` — no hardcoded text in components.
- Add keys to all 11 locale files (en, fr, es, pt, it, zh, de, ja, ko, nl, ru) when adding new strings.
- **Unit strings must be i18n keys**: Never hardcode "yr", "d", "in" etc. in NumAttr/formatters. Use `t('plantDetail.yearUnit')` pattern. Scientific units (mg, mm, cm, g/g) are universal and don't need translation.
- **CSV/file export headers must use `t()`**: Table column headers in the UI use i18n, but export code easily misses this. Reuse the same `t()` keys for both.
- **Components using `t()` must subscribe to `locale`**: Read `void locale.value` in the component body or include `locale.value` in render deps. Without it, `t()` returns stale translations when the user switches language. Canvas2D components use `locale.value` in `useCanvasRenderer` deps instead.
- **i18n translations must include proper diacritics**: Never use ASCII approximations. Applies to both `i18n/*.json` files and `schema-contract.json` translations.

## CSS

- Design tokens in `global.css` as CSS variables (field notebook palette).
- Components use CSS Modules, reference tokens (never raw values).
- **CSS Modules `composes:` for variant classes**: When a modifier class shares most properties with a base class, use `composes: baseClass` and override only the differing properties.
- Dark theme via `[data-theme="dark"]` on `<html>`.
- **No `type="search"` native clear button**: WebKitGTK renders its own clear button on search inputs. Hide with `::-webkit-search-cancel-button { -webkit-appearance: none; display: none; }` when using a custom clear button.
- **SearchBar layout is flex, not absolute overlay**: The result count is a flex sibling of the input wrapper, not absolutely positioned inside it.
- **No hardcoded px values**: All spacing must use `var(--space-N)` tokens (4/8/12/16/24/28/32/48px). All font-sizes must use `var(--text-*)` tokens (xs=11/sm=12/base=13/md=14/lg=16/xl=20). All border-radius must use `var(--radius-*)` tokens (sm=3/md=5/lg=7/full=9999). Control sizes must use `var(--control-size-*)` tokens (xs=20/sm=24/md=28/lg=32/xl=34/window=44). Slider dimensions must use `var(--slider-thumb-size)` (12px) and `var(--slider-track-size)` (2px).
- **Transition timing**: Use `var(--transition-fast)` (80ms ease) for color/bg/border hover states, `var(--transition-normal)` (150ms ease) for transform/layout shifts, `var(--transition-enter)` (200ms ease-out) for panel slide/fade enter. Always use `ms` units, never `s`.
- **Dark mode token audit**: When adding CSS that uses `--color-*` tokens as foreground text/border, verify the token has a dark mode override in `global.css` `[data-theme="dark"]`. Check contrast ratio >= 4.5:1 against `--color-bg`.
- **Click-outside-to-close pattern**: Use `pointerup` (not `mousedown`) to avoid catching the click that opened the panel. No `setTimeout` delays. Controls that shouldn't dismiss open panels use `data-preserve-overlays="true"`.
- **No native `<input type="date">` in UI chrome**: Use `DatePicker` from `components/shared/DatePicker.tsx`.
- **Escape layering in nested overlays**: When an overlay is inside another overlay, the inner overlay's Escape handler must be on a DOM element (`onKeyDown` on the dialog div), NOT document-level. `stopPropagation()` on a document listener does nothing.
- **`role="dialog"` elements must auto-focus on mount**: Use `useEffect([], ...)` to focus the first interactive element inside the dialog after mount.
- **Popover flip positioning**: When `anchorY + popoverHeight > containerHeight`, position at `anchorY - popoverHeight - gap` instead of clamping upward.
- **Popover close + click-through**: When removing an early `return` after popover dismiss to allow click-through on action hits, guard the empty-space path with a `popoverWasOpen` flag to prevent dismiss-click from reopening a new popover.
- **No raw `white`/`black` in CSS Modules**: Use `var(--color-bg)` for white-on-colored backgrounds (badges, pills). Raw color keywords break dark mode.
- **Section headers**: Uppercase, `var(--text-xs)` (11px), weight 600, `0.06em` letter-spacing, `--color-text-muted`. One pattern everywhere.
- **Non-token sizes**: When a component genuinely needs a size not in the token scale (e.g., 22px swatches), define a scoped CSS custom property on the component root and reference it everywhere. Never scatter raw px values.

## Preact / Signals Gotchas

- **Virtualizer reset boundary is committed results, not query intent**: `ResultsList` intentionally keeps the previous rows visible while debounced search text is in flight. Reset the virtualizer only when a committed first page replaces the displayed dataset (`searchResultsRevision`), then scroll to top.
- **`@tanstack/virtual-core` needs `measure()` when row counts change without a new scroll element**: `_willUpdate()` only rebinds observers when `getScrollElement()` changes. When results are replaced or appended under the same `.listContainer`, update options and call `virt.measure()`.
- **Stale async guard: one monotonic counter ref is enough**: For async effects that fire-and-forget, a single `useRef` counter incremented on each effect run guards against all staleness.
- **JSX `onWheel` is passive by default**: Browsers register JSX wheel handlers as passive — `preventDefault()` silently fails. Use imperative `addEventListener('wheel', handler, { passive: false })` in a `useEffect` instead.
- **Use refs (not signals) for keyboard focus tracking**: Non-reactive state like `focusedDay` in grid navigation should be a `useRef`, not a `useSignal`. Signal writes during render cause double-renders.
- **Signal reads before early returns subscribe unnecessarily**: `const height = signal.value` before `if (!open) return null` subscribes the component even when closed. Move signal reads to after the guard. When hooks prevent moving reads below the guard, split into a thin wrapper + inner component. See `BottomPanel.tsx` for the pattern.
- **Interface parameter types must match implementation invariants**: If a method throws on null, the type must be non-null — push the guard to call sites for compile-time safety.
- **Preact Vite plugin**: Package is `@preact/preset-vite` (not `@preactjs/preset-vite`).
- **HMR safety**: Module-level `effect()` and `addEventListener` must store disposers and clean up via `import.meta.hot.dispose()`.
- **Signals + hooks**: Use `useSignalEffect` (not `useEffect`) when subscribing to signals inside components.
- **Never put `signal.value` in a `useEffect` dependency array**: It captures the value at render time, not a live reference. Use `useSignalEffect` instead.
- **Effect subscription**: Effects only subscribe to signals **read during execution**. An early `return` before reading a signal = never re-runs. Read ALL dependencies BEFORE conditional returns.
- **`void signal.value` in parent components**: Unnecessary when all child components subscribe to the signal independently. Safe to remove.
- **`locale.value` in Canvas2D components**: Prefer adding `locale.value` to `useCanvasRenderer` deps over `void locale.value` at component top-level.
- **`updateDesignArray<K>()` in `document-mutations.ts`** is the generic helper for mutating array fields on `CanopiFile`. Action modules should use it instead of duplicating the identity-guard + spread pattern.
- **Signal retry pattern**: Setting a signal to its current value is a no-op (`Object.is` equality). To force a re-fetch, use a dedicated `retryCount` signal.
- **`SceneHistory` truncation must mirror in both paths**: `execute()` and `record()` both trim `_past` at 500-cap. Both must set `_savedPosition = -1` when truncation passes the saved point, or dirty tracking breaks.
- **Stable empty fallback in component bodies**: `currentDesign.value?.timeline ?? []` creates a new reference every render, defeating `useMemo`. Use a module-level `const EMPTY_ACTIONS: T[] = []` as the fallback. This applies equally to `useMemo` deps.
- **Vitest partial mocks + signals**: When `vi.mock` replaces a module that exports signals, use `importOriginal` spread (`vi.mock(path, async (importOriginal) => ({ ...await importOriginal(), ...overrides }))`).
- **`useEffect` needs a dependency array**: Omitting `[]` or `[dep]` runs the effect every render — causes listener leaks and duplicate subscriptions. Always provide explicit deps, even in Preact.
- **`display: flex` on `<td>` is unreliable in WebKitGTK**: Wrap flex content in a `<div>` inside the `<td>` — don't apply flex directly to table cells.
- **Pointer capture cleanup needs a guard boolean**: `releasePointerCapture()` in `pointerup` causes `lostpointercapture` to fire — cleanup runs twice without a `let cleaned = false` guard.
- **No `Math.max(...array.map())` for unbounded arrays**: Spread passes each element as a function argument — blows the call stack on large arrays. Use a `for` loop.
- **Dropdown is viewport-aware**: `Dropdown.tsx` auto-flips direction, clamps `max-height`, and right-aligns when opened near screen edges.
- **`floating-position.ts` utility**: `computeFloatingDirection` (vertical flip + availableHeight) and `shouldAlignRight` (horizontal overflow estimate) in `utils/floating-position.ts`.
- **Floating element positioning must be synchronous**: `prefers-reduced-motion` CSS sets `opacity: 1; animation: none` on floating elements. Post-render rAF-based position corrections cause a visible layout snap.

## Budget / Numeric Input Patterns

- **Never use `parseFloat(v) || 0` for optional numeric inputs**: The `|| 0` conflates empty input with intentional zero. Use `isFinite(parsed) && parsed >= 0` to reject empty/invalid and accept zero.
- **Check entry existence, not value, for "has been set" semantics**: `priceMap.has(key)` distinguishes "not yet priced" from "priced at 0". Do not use `price > 0` as a proxy for "has a price entry".

## Canvas2D Component Patterns

- **`useCanvasRenderer` deps must include `theme.value`** for theme reactivity — renderers read fresh CSS variables via `readThemeTokens()` at render time, but the redraw only fires when a dep changes.
- **Grid visibility uses `gridVisible` signal, not `layerVisibility['base']`**: The grid is chrome (rendered by `scene-chrome.ts`), not a scene entity.
- **Drag handlers must use `useCallback([])` with refs**, not signal-derived deps. A `renderState` object literal in `useCallback` deps causes the callback to be a new reference every render -> document-level event listeners re-register mid-drag.
- **Canvas `onMouseMove` must skip during drag**: When both document-level and canvas-element `mousemove` handlers exist, the canvas handler must early-return if drag is active (`if (!dragState.current) handleMouseMove(e)`).
- **Cache cumulative row offsets in a ref**: Compute `rowOffsets` via `useMemo` from `rowHeights`, store in a `rowOffsetsRef`, pass to renderers and hit-testers as an optional param — avoids per-frame array allocation at 60fps.
- **Snapshot mutable values at drag start**: Values that can change mid-drag (e.g., `pxPerDay`, zoom level) must be captured in `DragState` at `mousedown`, not read live from signals during `mousemove`.
- **`useMemo` for layout computation** (e.g., `buildConsortiumBars`), not inline in the component body — prevents O(n) layout work on every hover.
- **`useMemo` for derived table aggregates**: Table components with inline editing (e.g., BudgetTab) must memoize `countPlants`, `buildPriceMap`, and aggregate reduces — otherwise they re-run on every keypress during editing.
- **Canvas `onMouseMove` must be `useCallback`**: Both `ConsortiumChart` and `InteractiveTimeline` need `useCallback([handleMouseMove])` wrappers for the drag-guard lambda.
- **Drag cleanup must track `hasMutated`**: Add a `hasMutated: boolean` field to `DragState`, set it `true` when a mutation actually fires. Both `handleMouseUp` and unmount cleanup should only call `markDocumentDirty()` if `hasMutated` is true.
- **Multi-signal action functions must use `batch()`**: When an action writes multiple signals (e.g., `openBottomPanel` writes tab + open + height), wrap in `batch()` from `@preact/signals` to prevent intermediate re-renders.
- **Change guards before `moveConsortiumEntry` during drag** — skip no-op updates when phase/stratum haven't changed to avoid unconditional signal writes at 60fps.
- **`getPlacedPlants()` returns a fresh array reference every call** — never list it directly in `useMemo` deps. Store the result in a ref, use `sceneEntityRevision.value` as the trigger dep.
- **Action module updater wrappers must check reference identity**: Shared helpers like `updateConsortiums(updater)` that wrap `mutateCurrentDesign` must check `if (next === design.field) return design` before spreading — otherwise no-op updaters still create new design objects, bypassing `mutateCurrentDesign`'s identity guard and causing spurious dirty marks.
- **Upsert updaters must field-compare before spreading**: `upsertConsortiumEntry`-style functions that do `updated[idx] = entry` must compare all mutable fields first — spreading always creates a new object, bypassing `updateDesignArray`'s identity guard even when nothing changed.
- **Field-compare guards must cover ALL `TimelineAction` fields**: `updateTimelineAction`'s identity guard compares every field including `targets` and `depends_on` (reference equality). Omitting array fields causes silent data loss when a future caller patches only those fields.
- **60fps resize must bypass signals**: Panel resize handlers must set height directly on a DOM ref during drag (`panelRef.current.style.height`), NOT write to a signal at 60fps. Commit the final value to the signal via a dedicated action on mouseup only.
- **Cache `getBoundingClientRect()` in a ref for hover path**: Use `cachedRectRef = useRef<DOMRect | null>(null)` invalidated by `ResizeObserver`.
- **Resize handles must use pointer capture**: Use `setPointerCapture()`/`lostpointercapture` on the handle element instead of document-level `mousemove`/`mouseup` listeners.
- **`Date.now()` in `useMemo`-feeding functions defeats memoization**: If a function's result feeds into `useMemo` deps, using `Date.now()` as a seed makes the dep non-deterministic -> continuous redraw. Use `Infinity` with a stable fallback instead.
- **Canvas2D interactive components must have `onMouseLeave`**: Both `ConsortiumChart` and `InteractiveTimeline` use `hoveredX` signals for hover highlight — if the pointer exits the canvas without a final no-hit `mousemove`, the signal stays non-null.
- **`localeCompare()` in sort functions needs `locale.value` as a useMemo dep**.
- **`useCanvasRenderer` ResizeObserver must use `cachedRectRefInternal.current.ref`** (not the direct `cachedRectRef` parameter) to stay consistent with the `doRedraw` ref indirection.
- **Document-level `keydown` handlers must guard with `isEditableTarget(event.target)`** from `canvas/runtime/interaction/pointer-utils.ts` — prevents capturing Delete/Backspace/etc. when the user is typing in form inputs.
- **`useCanvasRenderer` deps must include data sources read via refs**: When renderers consume data through refs, the upstream signal/prop that populates those refs must be in the deps array — refs don't trigger redraws on their own.
- **Cached Date refs for frozen values must be set at ALL code paths that set the source ref**.
- **Separate rAF lifecycle refs from accumulated state refs**: When a rAF loop accumulates a value that other code paths also read, the accumulated value must survive `cancelAnimationFrame` + ref clear. Use two refs: one for the rAF id (nullable, cleared on stop) and one for the accumulated value (reset only at drag start).

## TypeScript Patterns

- **`satisfies` for typed string sets**: When a `Set<string>` must contain only valid keys of a type but `.has()` receives `string`, use `new Set<string>([...] satisfies (keyof T)[])` — compile-time validation at definition, no casts at call sites.

## Date Formatting

- **Use `Intl.RelativeTimeFormat` + `Intl.DateTimeFormat` with `locale.value`** for date display — no i18n keys needed. `numeric: 'auto'` gives "today"/"yesterday" instead of "0 days ago"/"1 day ago".

## Testing (Vitest)

- **i18n in Vitest**: The i18n module eagerly loads all 11 locale files at import time — `t()` returns real translations in tests without mocking. `locale.value` changes trigger `i18n.changeLanguage()` synchronously via module-level `effect()`.

---

# Canvas Runtime Rules

## Public Seams

- App code must not reach into renderer implementations or runtime internals.
- The app-facing canvas boundary is split into `CanvasCommandSurface`, `CanvasQuerySurface`, and `CanvasDocumentSurface` facades over `SceneCanvasRuntime`.
- Sibling read-only surfaces must consume `CanvasQuerySurface` for scene snapshots, viewport queries, selection reads, placed plants, localized names, and presentation context.
- Toolbars, shortcuts, menus, and plant-color actions consume `CanvasCommandSurface`. Document session orchestration, save/load, chrome, resize, and teardown consume `CanvasDocumentSurface`.
- Bearing-aware world<->geo and viewport->MapLibre camera derivation live in the active backend seam under `canvas/projection.ts` / `canvas/maplibre-camera.ts`; `MapLibreCanvasSurface` consumes them but does not own projection math.
- Exact sync means every canonical frame change must be applied; do not add camera deadbands/tolerances in `MapLibreCanvasSurface`.
- Preserve document `north_bearing_deg` semantics. Any MapLibre-facing bearing normalization/adaptation belongs in `canvas/maplibre-camera.ts`.
- Precision warning thresholds and dev diagnostics are backend-derived metadata. Surface/UI code may present them, but must not redefine them outside the projection seam.
- Terrain paint-only changes (opacity/theme) should stay incremental through `maplibre/terrain-sync.ts`; rebuild terrain sources/layers only when source-shape inputs change.

## State Ownership

- `SceneStore` owns **canvas scene state**: plants, zones, annotations, groups, layers, plant-species-colors, and ephemeral session state (selection, viewport, hover, presentation modes).
- Non-canvas document sections (consortiums, timeline, budget, `budget_currency`, location, description, extra) are **not** owned by `SceneStore`.
- Commands, tools, save/load, and document replacement mutate scene state, not renderer objects.
- Canvas-owned document fields serialize from the live scene, not from stale document input copies.
- Top-level `annotations` belong in the schema; do not put live annotations back under `extra`.
- Plant presentation state lives in `SceneStore.session`, not in standalone canvas signals.
- The only active presentation fields are `plantSizeMode` and `plantColorByAttr`.
- Selection truth lives in `SceneStore.session.selectedEntityIds`.
- Canvas signals such as `selectedObjectIds`, `plantSizeMode`, and `plantColorByAttr` are UI mirrors, not runtime authority.
- Panel-origin target hover/selection signals are presentation inputs only. Resolving `hoveredPanelTargets` or `selectedPanelTargets` must not mutate real canvas selection, labels, dirty state, or history.
- Canvas-origin hover uses `hoveredCanvasTargets` and must remain separate from panel-origin hover/selection ownership.

## Rendering Ownership

- `RendererHost` owns backend lifecycle, capability probing, and fallback.
- Renderers are projections of scene state, never the source of truth.
- Camera transforms go through `CameraController`; do not invent a second transform authority.
- The in-canvas basemap is a sibling visualization layer, not part of the renderer contract, and remains derived/non-authoritative.
- Screen-space chrome such as rulers stays outside the world renderer.
- Renderers may cache scene state internally, but viewport-only updates must not require a fresh runtime scene snapshot.
- `renderScene()` is for scene/presentation/selection rebuilds; `setViewport()` is for camera-only updates.
- Pixi keeps retained per-entity world objects across viewport changes; viewport updates may only retune transform- or scale-sensitive overlay details.

## Interaction Ownership

- `SceneInteractionController` owns live pointer and drag behavior.
- Hit testing and selection geometry must stay scene-side.
- Off-canvas drag continuation, multi-drag, and additive selection behavior are part of the contract.
- Plant hit testing must use the same shared presentation context as renderers and fit/bounds logic.
- Interaction selection writes must go through the runtime-owned selection seam; runtime logic must read authoritative selection from scene session.
- In-canvas MapLibre interaction (map pan/zoom, click-on-map) remains out of scope for the current basemap slice.

## Panel Target Projection Rules

- Timeline, budget, and consortium identity is typed with `PanelTarget[]` / `PanelTarget`; do not reintroduce string matching against timeline descriptions, legacy `plants` arrays, budget descriptions, or consortium canonical-name fields.
- Use `panelTargets.indexScene(scene)` and `panelTargets.resolve(targets, index)` to map typed panel targets to scene plant/zone IDs for canvas highlights.
- Use `projectPanelTargetResolutionToMapFeatures(resolution, location)` to turn the same resolved targets into map-ready plant point / zone polygon features.
- Camera sync and overlay projection must share the same bearing-aware world<->geo seam so pan/zoom stays aligned at all zoom levels.
- Screen-lock validation is the acceptance standard: the same world point must land on the same screen pixel in canvas and map projections.
- The canonical seam is Mercator-backed to match MapLibre's own projection surface; do not reintroduce equirectangular or 256px-world zoom shortcuts.
- `manual` and `none` targets are intentionally empty, not unresolved errors.
- The current basemap slice is non-interactive for direct map gestures. Panel<->map hover/selection overlays are live and must consume the pure projection seam.

## Annotation Rules

- Annotation geometry must come from shared helpers in `runtime/annotation-layout.ts`.
- Use the same annotation bounds for hit testing, band select, grouping, zoom-to-fit, and selection outlines.
- Visible text should win hit testing over underlying zones/plants when it is on top.

## Plant Presentation Rules

- Plant geometry, color, and stack badges come from `runtime/plant-presentation.ts`.
- **No per-plant labels on canvas** — plant identification is via hover tooltip (common name + scientific name) and selection labels (one per species at centroid).
- Hover tooltip is an HTML overlay managed by `SceneInteractionController` via `runtime/interaction/hover-tooltip.ts`.
- Hover species highlight (ring on all same-species plants) flows through `hoveredCanonicalName` in the renderer snapshot.
- Selection labels are computed by `runtime/selection-labels.ts`, separate from the presentation pipeline; both renderers recompute labels on viewport change.
- Size mode and color mode are independent axes; do not reintroduce a combined `plantDisplayMode`.
- Bounds, zoom-to-fit, grouping, renderers, and interaction must all consume the same resolved presentation state.
- **Designs auto-fit to content on open**: Both document-load paths call `session.zoomToFit()` after hydration.
- species-cache backfill may enrich plant metadata, but production geometry should never depend on ad hoc empty-cache fallbacks.
- **Default-mode dot sizing is world-proportional**: `PLANT_WORLD_RADIUS = 0.12m` (24cm diameter). Screen size is capped at `CIRCLE_SCREEN_PX` (8px) when zoomed in and floored at `MIN_SCREEN_PX` (2px) when zoomed far out. Do not reintroduce fixed screen-pixel sizing.

## Hover & Tooltip Rules

- `SceneInteractionController._updateHover()` hit-tests on idle `pointermove` (when `_pointerId === null`).
- `_onPointerMove` is on `window`, not container — hover path must bounds-check via `getBoundingClientRect()` (single call).
- Hover tooltip is a plain `.ts` module using inline styles with CSS custom properties — no CSS Module imports from `.ts` files.
- `hoveredEntityId` flows: interaction controller -> session state -> renderer snapshot (`hoveredCanonicalName`) -> highlight ring.
- Selection labels are computed per-species at centroid by `selection-labels.ts`; both renderers must recompute labels in `setViewport()` for pan/zoom tracking.
- **do not reintroduce per-plant labels** — the label collision/dedup/placement system was deleted because it is fundamentally unreadable at dense planting scales.

## Invalidation Rules

- Use scene invalidation for content, selection, presentation, locale, theme, and hover changes.
- Use viewport invalidation for pan, zoom, and fit operations.
- Use chrome invalidation for rulers, grid, and guide-only changes.
- Do not route viewport-only work through the full scene render path.
- When a retained surface preserves stale content during async work, invalidate/reset from a committed content revision, not from intent state.

## Scene Codec Contract

- `serializeScenePersistedState` only produces canvas-entity fields plus document metadata placeholders — when adding new required fields to `CanopiFile` that are non-canvas state, the codec must emit empty placeholder/default values to satisfy the type contract. `serializeDocument()` overwrites them with document-store values.
- **Canvas DPR sizing must use `Math.round()`** — `canvas.width = cssWidth * dpr` produces floats on fractional-DPR screens. The browser truncates to integer on assignment, so the guard `canvas.width !== newW` never matches on subsequent frames -> unconditional buffer reallocation.
- **`ctx.setTransform()` not `ctx.scale()` after size guards** — when a size guard prevents canvas clearing, `ctx.scale(dpr, dpr)` accumulates (2x, 4x, 8x…). `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` atomically resets-and-sets.

---

# Database Rules (SQLite)

## Schema & Contract

- **Plant DB schema contract**: `scripts/schema-contract.json` maps canopi-data export columns to canopi-core.db columns. `prepare-db.py` reads from this contract, not hardcoded lists. When canopi-data changes column names, update the contract — not the Rust code.
- **Plant detail query has one projection owner**: `plant_db/detail.rs` owns a single ordered species-detail projection with cursor-based row mapping and contract-driven SQL generation.
- **`schema_contract.rs` module**: Runtime schema validation — checks `user_version`, expected table presence, and column counts at startup. Warns on drift but does not block startup.
- **Schema version**: `PRAGMA user_version = 8` in canopi-core.db. Rust backend warns if outside the shared expected version at startup. Export schema version 11 (`min_export_schema_version` in contract).
- **Species table name**: `species` (NOT `silver_species` as in the architecture draft).
- **Migration versioning**: User DB uses `PRAGMA user_version` — check before adding migrations.
- **Contract drift is test-owned, not runtime-fatal**: Keep plant DB startup in warn-and-continue mode, but add/update automated contract checks whenever the detail projection, schema version, or contract-managed translation fields change.
- **Schema version update checklist**: When canopi-data removes or adds columns: (1) `schema-contract.json` — bump `schema_version` + `min_export_schema_version`, add/remove columns, (2) `schema_contract.rs` — bump `EXPECTED_PLANT_SCHEMA_VERSION`, (3) `common-types/src/species.rs` — update `SpeciesDetail` struct, (4) `plant_db/detail.rs` — update `DETAIL_CONTRACT_COLUMNS` + `map_detail_row()` cursor reads (order must match), (5) `plant_db.rs` — update test fixtures, (6) `prepare-db.py` — update `build_search_index()` if FTS columns change. Phases 1-5 must be atomic.

## Column Conventions

- **Life cycle / nitrogen columns are booleans**: `is_annual`/`is_biennial`/`is_perennial` (not `life_cycle`), `nitrogen_fixer` (not `nitrogen_fixation`). Filter UI keeps `life_cycle: string[]` for OR-semantics, mapped to boolean columns in `query_builder.rs`.
- **`species_soil_types` removed (schema v5)**: Soil filtering uses boolean tolerance columns (`tolerates_light_soil`, `tolerates_medium_soil`, `tolerates_heavy_soil`, `well_drained`, `heavy_clay`).
- **Stratum DB values are lowercase**: DB stores `"emergent"`, `"high"`, `"low"`, `"medium"` — NOT `"Emergent"`, `"High canopy"`. The `STRATA_COLORS` map in `plants.ts` uses raw DB keys. Display labels come from `STRATUM_I18N_KEY` -> `t()`. Never hardcode display-case stratum strings in color maps or comparisons.
- **`SpeciesListItem.family/genus` are `Option<String>`**: DB columns are nullable. Non-optional `String` causes silent row drops in search and hard errors in favorites hydration.
- **`species_common_names` has `is_primary` and `source` columns**: `is_primary=1` marks the preferred common name per species+language.
- **Schema evolution field splits**: `invasive_potential` split into `invasive_potential` + `biogeographic_status`; `seed_dormancy_type` split into `seed_dormancy_type` + `seed_dormancy_depth` + `serotinous` (boolean). `habit` narrowed from 11 to 3 values, then expanded to 4 (v11 export: added `Herbaceous`). `flower_color` separator changed from `/` to comma-space.
- **15 prose columns removed (v9 export, schema v6)**: `edible_uses`, `medicinal_uses`, `other_uses`, `special_uses`, `summary`, `physical_characteristics`, `cultivation_notes`, `propagation_notes`, `known_hazards`, `habitats`, `range_text`, `native_range`, `carbon_farming`, `reasoning`, `pests_diseases` — all dropped. Structured replacements: `species_uses` table (use tags), `toxicity` (categorical).
- **Distribution JSON->text parsing (v10 export, schema v7)**: `native_distribution` and `introduced_distribution` store JSON arrays in the DB (`["China", "India"]`). `detail.rs::parse_json_array_to_display()` converts to comma-separated text before IPC. Returns `None` for empty arrays (`"[]"`).
- **`species_distributions` junction table (v10 export, schema v7)**: Structured distribution data (species_id, distribution_type, region). Copied from export and indexed but not yet queried at runtime.
- **`species_climate_zones` junction table (v11 export, schema v8)**: Climate zone assignments per species (species_id, climate_zone, confidence, source). 311K rows, 7 zones. Filtered via EXISTS subquery in `append_structured_filters`. `climate_zones` JSON column on species table stores a simple string array.
- **FilterStrip filter migration (schema v8)**: `stratum`, `hardiness_zone_min/max`, `height_max_m` moved from dedicated `SpeciesFilter` fields to the dynamic filter path.
- **Secondary name ranking (schema v8)**: `get_secondary_common_name` and search query `display_name_2` prefer `source = 'llm'` names over other sources for better disambiguation.
- **Common name sources hierarchy**: `species_common_names.source` values: `wikidata`, `gbif`, `llm`, `plantatlas`, `pfaf`, `unknown`.
- **No `sqlite3` CLI on this system**: Use `python3 -c "import sqlite3; ..."` for DB inspection.
- **Image sources replaced (v9 export)**: Old sources (`pfaf`, `trefle`, `plantatlas`) replaced by `wikidata_p18` (Wikimedia Commons) and `inaturalist`.
- **Ellenberg indicators are filterable**: 6 numeric Ellenberg columns exposed as numeric range filters through generated `filter_field_kind()` metadata.
- **`ellenberg_inferences` table skipped**: 468K rows of ML-predicted Ellenberg values. Not contracted — using observed values only.

## rusqlite

- **`db::acquire()` helper**: All Mutex lock acquisition uses `acquire(&db.0, "PlantDb")` from `db/mod.rs` — recovers from poison with `tracing::warn`. Do not use inline `lock().unwrap_or_else(|e| e.into_inner())` in commands.
- **rusqlite feature**: Use `bundled-full` (not `bundled`) — enables FTS5 full-text search.
- **Plant DB PRAGMAs**: On read-only connections, do NOT set `journal_mode=WAL` or `query_only=true`. Only `mmap_size` and `cache_size`.
- **Plant DB degraded mode**: If missing/corrupt, `lib.rs` falls back to in-memory DB. Frontend short-circuits all species IPC calls when degraded.
- **`resolve_species_id()` helper**: Use `plant_db::resolve_species_id(conn, canonical_name)` for canonical->UUID lookup.
- **Cursor pagination typed values**: Height/Hardiness sort values must be pushed as `Value::Real`/`Value::Integer`, not `Value::Text`. SQLite type affinity makes text-vs-numeric comparisons silently wrong.

## FTS5 Full-Text Search

- **FTS5 weighted columns**: `species_search_fts` has 5 columns: `canonical_name`, `common_names`, `family_genus`, `uses_text`, `other_text`. Ranked via `bm25(species_search_fts, 8, 10, 5, 1, 1)` — common name matches rank above canonical name matches.
- **FTS5 MATCH syntax**: Always use full table name (`species_search_fts MATCH ?1`), never an alias.
- **FTS5 sanitization**: Strip ALL metacharacters `"()*+-^:\`` — not just quotes. Empty after sanitization -> skip FTS.
- **Species search query plans own pagination and cursor semantics**: Build `SpeciesSearchPlan` from `SpeciesSearchRequest`, then execute `plan.count()` and `plan.list()` in `plant_db/search.rs`.
- **Count/list search predicates share one planner path**: FTS and structured filters are appended through the same query-builder helper for count and list statements.
- **Search count and first-page rows are separate outputs**: `total_estimate` comes from the optional count statement in `SpeciesSearchPlan`, while visible rows come from `plan.list()`. If the UI ever shows a new count with an old first page during debounce, treat that as a frontend result-set lifecycle bug first.

## Translations

- **`translated_values` table is wide format**: 22 language columns (`value_en` through `value_hu`). App UI supports 11 languages; extra 11 carried in DB for future expansion. NOT a normalized table. `translate_value()` in `plant_db.rs` maps locale to column name via allowlist.
- **`translated_values` coverage**: Only fields WITH entries in this table get translated. Check `SELECT DISTINCT field_name FROM translated_values` before assuming a field is translatable.
- **`translated_values` has two sources**: (1) rows copied from the canopi-data export, (2) rows inserted/updated by `populate_translations()` from `schema-contract.json`. Contract entries override export entries for the same `(field_name, value_en)` pair.
- **Translation ownership**: canopi-data's `translated_values` table is the primary source. The app's `schema-contract.json` translations section only supplements gaps.
- **Adding translations**: Two steps required — (1) add entries to `schema-contract.json` `translations` section, (2) run `populate_translations()` from prepare-db.py or use python to INSERT directly into both `desktop/resources/canopi-core.db` and `target/debug/resources/canopi-core.db`.
- **Schema-contract translation keys must match actual DB values exactly (case-sensitive)**: Always verify with `SELECT DISTINCT <column> FROM species` before adding/changing keys.
- **DB hot-patching**: Can INSERT/UPDATE `translated_values` in the running app's DB files — changes visible on next IPC call without app restart.
- **Composite value translation**: `translate_composite_value()` in `plant_db/lookup.rs` treats comma-space-separated values as canonical, but still accepts legacy slash-separated composites.

## Common Names

- **Common name lookup order**: `best_common_names` -> `species_common_names` -> `species.common_name`. Both `get_common_name` (single) and `get_common_names_batch` (batch) follow this order. Always use `best_common_names` first.
- **`best_common_names` selection**: Uses `is_primary` flag from `species_common_names` (preferred), falls back to shortest non-canonical name. `prepare-db.py` uses `ROW_NUMBER()` with `is_primary DESC, LENGTH ASC`.
- **`get_locale_best_common_name`**: Returns the locale-specific best name only (no fallback). Use when you need to distinguish locale match from English fallback.
- **`get_secondary_common_name`**: Returns the next-best name for a locale excluding the primary. Used by favorites hydration and search query.
- **Search query returns `display_name_2` and `is_name_fallback`**: Correlated subquery against `species_common_names` for secondary locale name; CASE expression for fallback flag.

## Filter-to-Column Mapping

- **Filter-to-column mapping**: `SpeciesFilter.life_cycle: Vec<String>` maps to boolean columns via `query_builder.rs` (e.g. `"Annual"` -> `is_annual = 1`). This preserves OR-semantics in the UI while the DB uses boolean columns. Don't change the filter type — change the query mapping.

## canopi-data Export

- **canopi-data export location**: `~/projects/canopi-data/data/exports/canopi-export-YYYY-MM-DD.db` — use the latest dated file.
- **canopi-data changelog**: `~/projects/canopi-data/data/exports/changelog.md` documents breaking/non-breaking changes per export.
- **Regenerate plant DB**: `python3 scripts/prepare-db.py --export-path ~/projects/canopi-data/data/exports/<latest>.db` (outputs to `desktop/resources/canopi-core.db`). Omit `--export-path` to auto-discover latest export.
- **`prepare-db.py` fails if Tauri app is running**: The `PRAGMA journal_mode=DELETE` at finalization hits a lock. Stop the app before regenerating.
- **CI bundled DB**: Release builds download `canopi-core.db` from the `canopi-core-db` GitHub release tag. Lint/test jobs set `CANOPI_SKIP_BUNDLED_DB=1`.

## Image Cache & Network

- **Image cache**: `image_cache.rs` exposes `cached_path_if_present()` for path-only cache hits and `fetch_and_cache()` for misses. Cache hits must not reread image bytes if the caller only needs a path. Misses are single-flight per cache path and publish via temp-file + rename. Uses shared `AtomicU64` tracked size. LRU eviction at 500MB. Cache dir: `~/.local/share/com.canopi.app/image-cache/`.
- **Network hardening convention**: All `ureq` calls must set `timeout_global` and response size limits, and blocking network/file work must run behind an async command + `spawn_blocking` seam. Geocoding uses 5s timeout.

See docs/release.md for release process.

# Banned Patterns

These are enforced by code review and pre-commit hooks:

- **No React**: Import from `preact`, `preact/hooks`, `preact/compat` — never `react`.
- **No Konva**: Konva has been fully removed. Canvas rendering goes through `SceneCanvasRuntime` + `RendererHost` (PixiJS/Canvas2D). Do not reintroduce Konva.
- **No Tailwind**: Use CSS Modules (`.module.css`).
- **No Zustand/Redux/MobX**: Use `@preact/signals`.
- **No react-i18next**: Use `import { t } from '../i18n'`.
- **No connection pools** (r2d2, deadpool, sqlx): `Mutex<Connection>` only — rusqlite Connection is not Sync, Arc alone is unsound.
- **No typeshare**: Use `specta::Type`.
- **No string-formatted SQL**: Use prepared statements with `?1`, `?2`.
- **No raw rgba() in CSS Modules**: Always use `var(--color-*)` tokens — raw values break dark mode.
- **No `font-weight: 500`**: Two weights only — `400` (body/reading) and `600` (name/label/interactive). Weight 500 creates a mushy middle with no clear purpose.

---

# Before Writing Code Checklist

1. Query **Context7** for up-to-date library API docs (Tauri v2: `/websites/v2_tauri_app`, rusqlite: `/rusqlite/rusqlite`, PixiJS: `/pixijs/pixijs`, MapLibre: `/maplibre/maplibre-gl-js`, i18next: `/i18next/i18next`).
2. For UI work: reference the Design Direction section in this file and CSS tokens in `global.css`.
3. Use taoki `xray`/`ripple` to understand file structure and blast radius before modifying.
4. For multi-phase work with subagents: define a **file ownership matrix** (one writer per file at any time), keep **Tauri MCP in main context only** (single WebView session), and decide UI control types in the plan before building alternatives.
5. For multi-feature i18n work: **batch all i18n keys in one early phase** to prevent 11-file merge conflicts across parallel agents.
6. Before planning new features: **explore the codebase for existing implementations** — code may already exist.
7. Run `/simplify` after implementation — converges in ~3 rounds.
8. For multi-phase work: **implement -> `tsc` + `npm test` -> craft code review -> fix -> re-review until convergence** per phase.
9. When delegating commits to subagents: instruct them to `git add` only the specific files they modified — never `git add -A` or `git add .`.
10. **Adding a new filterable species field** (end-to-end): (1) `columns.rs` -> `validated_column()` match arm, (2) `filters.rs` -> `is_numeric_field()` or `is_boolean_field()` if applicable, (3) `field-registry.ts` -> `FIELD_REGISTRY` entry, (4) `i18n/*.json` -> `filters.field.<key>` label in all 11 locales, (5) if also adding to detail card: update `PlantDetailCard.tsx` + `plantDetail.*` i18n key.

---

# Output Rules

- Answer is always line 1. Reasoning comes after, never before.
- No preamble. No "Great question!", "Sure!", "Of course!", "Certainly!", "Absolutely!".
- No hollow closings. No "I hope this helps!", "Let me know if you need anything!".
- No restating the prompt. If the task is clear, execute immediately.
- No explaining what you are about to do. Just do it.
- No unsolicited suggestions. Do exactly what was asked, nothing more.
- Structured output only: bullets, tables, code blocks. Prose only when explicitly requested.

## Token Efficiency

- Compress responses. Every sentence must earn its place.
- No redundant context. Do not repeat information already established in the session.
- No long intros or transitions between sections.
- Short responses are correct unless depth is explicitly requested.

## Typography - ASCII Only

- No em dashes (-) - use hyphens (-)
- No smart/curly quotes - use straight quotes (" ')
- No ellipsis character - use three dots (...)
- No Unicode bullets - use hyphens (-) or asterisks (*)
- No non-breaking spaces

## Sycophancy - Zero Tolerance

- Never validate the user before answering.
- Never say "You're absolutely right!" unless the user made a verifiable correct statement.
- Nobody: Disagree when wrong. State the correction directly.
- Do not change a correct answer because the user pushes back.

## Accuracy and Speculation Control

- Never speculate about code, files, or APIs you have not read.
- If referencing a file or function: read it first, then answer.
- If unsure: say "I don't know." Never guess confidently.
- Never invent file paths, function names, or API signatures.
- If a user corrects a factual claim: accept it as ground truth for the entire session. Never re-assert the original claim.
- Whenever something doesn't work, you should first assume that your changes broke it. Code is always committed at working states.

## Code Output

- Avoid brittle, narrow solutions. When fixing bugs, always consider: is this the only case? Or does this fix apply more broadly? Is the band-aid solution correct. Prefer architecturally correct fixes, that solve the problem at the root and apply to all cases.
- Return the simplest working solution. No over-engineering.
- No abstractions or helpers for single-use operations.
- No speculative features or future-proofing.
- No docstrings or comments on code that was not changed.
- Inline comments only where logic is non-obvious.
- Concrete: Read the file before modifying. Never edit blind.

## Session Memory

- Learn user corrections and preferences within the session.
- Apply them silently. Do not re-announce learned behavior.
- If the user corrects a mistake: fix it, remember it, move on.

## Scope Control

- Do not add features beyond what was asked.
- Do not refactor surrounding code when fixing a bug.
- Do not create new files unless strictly necessary.

## Override Rule

User instructions always override this file.
