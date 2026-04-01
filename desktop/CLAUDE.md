# Tauri v2, IPC & Platform

## IPC Commands
- Return `Result<T, String>` — Tauri serializes errors to frontend
- Use types from `common-types` crate
- Map errors: `.map_err(|e| format!("Failed to <action>: {e}"))`
- Mutex locks: `db.0.lock().unwrap_or_else(|e| e.into_inner())` — recover from poison, don't propagate

## Document Lifecycle (enforced — Wave 1 + Wave 2)
- **`state/document-actions.ts` is the sole document replacement authority** — no component or panel may replace the active document directly. All destructive flows (new, open, template import) go through document-actions
- **`state/document.ts` is the canonical document API** — external consumers import from here. `state/design.ts` is internal
- **`toCanopi(engine, metadata, doc)` is the sole save composition point** — all save paths go through it
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
- **Queued-load handoff** — `consumeQueuedDocumentLoad` routes through document-actions without the dirty guard (file was just opened from OS, no unsaved work to protect)

## Settings Persistence Contract
- **Rust `Settings` (user DB) is the single source of truth** for all user preferences: locale, theme, grid, snap, autosave interval. Rust struct retains map/terrain/bottom-panel fields for forward compatibility; frontend no longer reads/writes them (pruned features)
- **`localStorage` is a sync cache only** — `initTheme()` reads it for instant first-paint, Rust settings overwrite on bootstrap
- **Frontend signals are runtime projections** — hydrated from Rust on startup via `get_settings` IPC
- **`persistCurrentSettings()` in `state/app.ts`** — must include ALL settings in the Rust `Settings` struct
- **Theme**: light/dark only (no system option). Toggle in title bar cycles between the two

## Tauri v2 Gotchas
- **No `convertFileSrc()` for local files**: The `asset://` protocol is not scoped in `capabilities/main-window.json`. Serving local files to the WebView requires base64 data URLs from Rust. Adding `fs:allow-read` scope would fix it properly but needs capability config work
- **Image base64 bottleneck**: `get_cached_image_url` encodes images as base64 data URLs (~2.7MB IPC payload per 2MB image), freezing the UI. Planned fix: enable scoped asset protocol + `convertFileSrc()`. See `docs/todo.md` section 10. Do not extend the base64 pattern to new image surfaces
- **`ureq` for blocking HTTP in Tauri commands**: Use `ureq` (not `reqwest`) — lightweight, no async runtime needed, fits Tauri's sync command thread pool. Already in `desktop/Cargo.toml`
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
- **No `window.prompt()`/`confirm()`/`alert()`**: Silently blocked in WebView. Use `ask()` from `@tauri-apps/plugin-dialog` for confirms, Preact components for other input. `dialog:default` capability includes `allow-ask`
- **Theme: light/dark only, no system**: `Theme` enum has only `Light`/`Dark`. `get_settings` migrates stale `"system"` values to `"light"` via JSON patching before deserialization
- **TitleBar drag handler**: `handleMouseDown` in `TitleBar.tsx` calls `startDragging()` on the title bar. Interactive elements must be caught by `target.closest('button')` — if adding non-button interactive elements, wrap in a button or update the guard
- **No native `<select>` in UI chrome**: Native dropdowns break the field notebook aesthetic. Use custom dropdown components (see `LocalePicker` in `TitleBar.tsx`). Must include click-outside-to-close, `aria-expanded`, keyboard support
- **WebKitGTK range input thumb alignment**: `<input type="range">` thumbs are NOT vertically centered. With a 0px-height runnable track, the thumb's TOP edge sits at the track center. Fix: `::-webkit-slider-thumb { margin-top: calc(var(--slider-thumb-size) / -2) }`. Injected `<style>` overrides for pseudo-elements are silently ignored by WebKitGTK — always modify the actual `.module.css` file
- **Filter UI architecture**: Always-visible filters in `FilterStrip.tsx` use typed `SpeciesFilter` fields. "More filters" panel uses dynamic `Vec<DynamicFilter>` channel with `validated_column()` allowlist in `query_builder.rs`. Adding a new filterable field requires two additions: entry in `field-registry.ts` + entry in the Rust allowlist. `patchFilters()` in `state/plant-db.ts` is the single mutation point for filter state. `dynamicOptionsCache` is locale-scoped (`Record<locale, Record<field, DynamicFilterOptions>>`); `dynamicOptionsPending` deduplicates concurrent IPC requests per locale+field

## Build
- **`CANOPI_SKIP_BUNDLED_DB=1`**: Env var checked in `desktop/build.rs`. When set, overrides `tauri.conf.json` bundle resources to an empty list so the crate compiles without a locally generated `canopi-core.db`. Used by CI lint/test jobs. The runtime already degrades gracefully when the DB is missing; release packaging still requires the real DB
- **CI release build downloads the DB**: The `build.yml` workflow downloads `canopi-core.db` from the `canopi-core-db` GitHub release tag into `desktop/resources/` before running `tauri build`
- **Linux deps shared action**: `.github/actions/install-linux-deps/` — reusable composite action for `apt-get install` of GTK/WebKit/librsvg/patchelf. Used by lint, test, and build jobs
- **Linux bundle**: `--bundles deb` only (no AppImage/RPM). Other platforms use Tauri defaults
- **Release candidate workflow**: `.github/workflows/release-candidate.yml` — builds RC artifacts from a release branch. Promotion scripts: `scripts/promote-release.sh` (RC → release), `scripts/publish-db-release.sh` (upload canopi-core.db to GitHub release tag)
- **Desktop icons**: Generated via `scripts/generate-desktop-icons.sh` from an SVG source. All sizes (32/128/256/icns/ico) must be committed — `generate_context!()` panics if missing

## Platform / Native Gotchas
- **Platform trait lives in `desktop/src/platform/mod.rs`**: NOT in `common-types` — `FileWatchHandle` contains closures (not serializable). Lib crates export marker structs, platform/mod.rs implements the trait via conditional modules
- **`FileWatchHandle` must cancel on drop**: Uses `Option<Box<dyn FnOnce()>>` pattern with `Drop` impl that joins the watcher thread
- **Cairo deps for lib-c**: `cairo-rs = "0.20"` with `png` + `pdf` features, `inotify = "0.11"`, `libc = "0.2"`
- **macOS/Windows stubs**: All code `#[cfg(target_os = "...")]` gated. Compiles on Linux via conditional compilation. CI validates on actual platforms
- **Linux deps**: `sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev patchelf` — do NOT install `libappindicator3-dev`
- **`std::fs::rename` on Windows**: Fails with locked files. Use `design::atomic_replace()` with rollback sidecar

## MapLibre / Terrain (deleted — deferred post-rewrite)
MapLibre code (`map-layer.ts`, contour/hillshade effects, map sync) was deleted during pre-rewrite pruning. These gotchas apply when rebuilding:
- **MapLibre paint properties can't use CSS vars**: Hardcoded hex colors in MapLibre style objects are acceptable — they render on map tiles, not app chrome
- **`maplibre-contour` for client-side DEM contours**: Use `DemSource` with AWS Terrain Tiles (Terrarium encoding). Register protocol once with `addProtocol()`
- **MapLibre container opacity for map blending**: Apply opacity to the container div, NOT try to make Konva canvas transparent (causes blank canvas bugs)
- **Map layer z-index**: Insert map div before `.canvasContainer`. Canvas container background must become transparent when map is active. Konva `<canvas>` elements are inherently transparent where no shapes are drawn
- **`download_template` security**: HTTPS-only + domain allowlist (`templates.canopi.app`) + filename sanitization + path traversal check + 50MB size limit
