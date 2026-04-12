# Tauri v2, IPC & Platform

## IPC Commands
- Return `Result<T, String>` — Tauri serializes errors to frontend
- Use types from `common-types` crate
- Map errors: `.map_err(|e| format!("Failed to <action>: {e}"))`
- Mutex locks: use `db::acquire(&db.0, "PlantDb")` helper — recovers from poison with `tracing::warn`, don't use inline `lock().unwrap_or_else()` anymore

## Document Lifecycle
- **`state/document-actions.ts` is the sole document replacement authority** — no component or panel may replace the active document directly. All destructive flows (new, open, template import) go through document-actions
- **`state/document.ts` is the canonical document API** — external consumers import from here. `state/design.ts` is internal
- **`session.serializeDocument()` / `SceneStore.toCanopiFile()` is the sole save composition point** — all save paths go through it
- **Never regenerate `created_at`** — preserve from loaded file
- **Preserve all loaded document sections on save** — timeline, budget, consortiums, description, location, extra fields
- **No `?? []` fallbacks on required `CanopiFile` array fields in TS**: Rust `#[serde(default)]` guarantees presence. TS-side `??` fallbacks are dead code that masks type errors. Only use `?? []` where the parent object is nullable (`currentDesign.value?.field ?? []`)
- **`installConsortiumSync()` must be active before any document load completes** — `loadCanvasFromDocument` installs it, but `applyDocumentReplacement` (queued loads, template imports) does not. `CanvasPanel` must call it unconditionally at mount, not only when `currentDesign.value` exists
- **Two document-load paths must stay in sync for post-load behavior**: `applyDocumentReplacement()` in `document-actions.ts` (open/new/template/OS-open) and `loadCanvasFromDocument()` in `document.ts` (CanvasPanel mount with existing design). Both call `session.zoomToFit()` after hydration. When adding new post-load behavior, update both paths
- **Preserve per-object non-visual fields** — plant notes/planted_date/quantity and zone notes
- **Preserve unknown `extra` fields** — `extractExtra()` captures unknown top-level keys. Spread extra FIRST when composing the save output
- **File format version**: `CURRENT_VERSION` constant in `desktop/src/design/format.rs` — used by migration loop, `create_default()`, and forward-version diagnostic log. Type is `u32` (matches `CanopiFile.version`). Cast to `u64` only at the JSON boundary (`serde_json::as_u64()`)
- **Two-baseline dirty model** — Canvas: `_savedPosition` checkpoint in `SceneHistory` (patch-based). Non-canvas: `nonCanvasRevision` vs `nonCanvasSavedRevision`. Never write to `designDirty` directly
- **Autosave** checkpoints same document as manual save. Failures surface via `autosaveFailed` signal
- **No circular imports between scene store and document store** — `SceneStore` and scene runtime must not import `state/design.ts` directly. If the runtime needs to read document state (e.g., for save composition), pass it as a parameter or use a reader interface. The goal is unidirectional data flow, not total isolation
- **Close guard uses `destroy()` not `close()`** — avoids re-entry loop
- **Cross-platform file replace** — `atomic_replace()` in `design/mod.rs`
- **Queued-load handoff** — `consumeQueuedDocumentLoad` routes through document-actions without the dirty guard (file was just opened from OS, no unsaved work to protect)

## Settings Persistence Contract
- **Rust `Settings` (user DB) is the single source of truth** for all user preferences: locale, theme, grid, snap, autosave interval, and bottom-panel open/height/tab state. Map/terrain fields are retained for forward compatibility while in-canvas geo work remains deferred
- **`localStorage` is a sync cache only** — `initTheme()` reads it for instant first-paint, Rust settings overwrite on bootstrap
- **Frontend signals are runtime projections** — hydrated from Rust on startup via `get_settings` IPC
- **`persistCurrentSettings()` in `state/app.ts`** — must include ALL settings in the Rust `Settings` struct
- **Adding a new persisted setting (end-to-end)**: (1) Add field to Rust `Settings` struct + TS `Settings` interface, (2) Add signal to the appropriate state module, (3) Hydrate from Rust in `app.tsx` bootstrap (`get_settings` handler), (4) Write back in `persistCurrentSettings()` in `state/app.ts`, (5) Call `persistCurrentSettings()` in the action functions that mutate the signal (skip 60fps hot paths like drag — persist on mouse-up instead)
- **Theme**: light/dark only (no system option). Toggle in title bar cycles between the two

## Tauri v2 Gotchas
- **Use `convertFileSrc()` for cached local images**: The app now enables `app.security.assetProtocol` with scope limited to `$APPDATA/image-cache/**`. Image surfaces should return a file path from Rust and convert it in the frontend instead of sending image bytes over IPC
- **Do not reintroduce base64 image IPC**: The old `get_cached_image_url` pattern froze the UI with multi-megabyte JSON payloads. The current path is `get_cached_image_path` + `convertFileSrc()`. Do not extend the base64 pattern to new image or tile surfaces
- **Optimized binary IPC**: For returning large binary data (tiles, images), use `tauri::ipc::Response::new(bytes)` instead of JSON serialization — arrives as `ArrayBuffer` in JS, no base64 overhead. For streaming chunks, use `tauri::ipc::Channel<&[u8]>`
- **Blocking HTTP/file work must stay off the main command thread**: `ureq` is acceptable, but only behind an async Tauri command boundary that moves the blocking work to `tauri::async_runtime::spawn_blocking`. Do not perform network fetches, large reads, or long writes directly inside synchronous `#[tauri::command]` handlers. For cacheable assets, also avoid concurrent same-path writes and publish completed files atomically
- **`tauri.conf.json` beforeDevCommand path**: Uses `{ script: "npm run dev", cwd: "web" }` object format (relative to `desktop/`). NOT a bare `npm run dev` at project root
- **CSP configured**: `tauri.conf.json` has a strict CSP policy (`default-src 'self'`, `connect-src ipc: http://ipc.localhost https:`, etc.). No longer `null`. When adding new resource origins (e.g., tile servers), update CSP directives
- **`tauri-plugin-shell` removed**: No shell capability. If external process spawning is needed in the future, use Rust `std::process::Command` from a Tauri command, not the shell plugin
- **tauri-specta**: Deferred — specta rc ecosystem has version conflicts. Using plain `generate_handler![]` until stable
- **Emit in setup**: Events fired in `setup()` are lost — frontend JS hasn't loaded yet
- **Blocking dialogs on Linux**: `blocking_save_file()` / `blocking_pick_file()` deadlock on GTK. Use `@tauri-apps/plugin-dialog` JS API from the frontend. Rust commands only handle file I/O, never show dialogs
- **Window permissions**: `decorations: false` + `startDragging()` requires `core:window:allow-start-dragging`, `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, `core:window:allow-close` in `capabilities/main-window.json`
- **Emitter trait**: `app.handle().emit()` requires `use tauri::Emitter`
- **Icons**: `generate_context!()` panics if icon files in tauri.conf.json don't exist on disk
- **Resource path resolution**: `resolve_plant_db_path()` in `lib.rs` tries `PLANT_DB_BUNDLED_PATHS` (`resources/canopi-core.db`, `canopi-core.db`) via Tauri resource resolver, then falls back to `CARGO_MANIFEST_DIR/resources/` for dev. Always register a fallback in-memory DB so `State<PlantDb>` doesn't panic
- **No blocking dialogs in setup()**: `.blocking_show()` in `setup()` hangs — window hasn't been created. Log errors instead
- **`close()` re-emits `closeRequested`**: Use `destroy()` for discard-without-save. Requires `core:window:allow-destroy`
- **No `window.prompt()`/`confirm()`/`alert()`**: Silently blocked in WebView. Use `ask()` from `@tauri-apps/plugin-dialog` for confirms, Preact components for other input. `dialog:default` capability includes `allow-ask`
- **Theme: light/dark only, no system**: `Theme` enum has only `Light`/`Dark`. `get_settings` migrates stale `"system"` values to `"light"` via JSON patching before deserialization
- **TitleBar drag handler**: `handleMouseDown` in `TitleBar.tsx` calls `startDragging()` on the title bar. Interactive elements must be caught by `target.closest('button')` — if adding non-button interactive elements, wrap in a button or update the guard
- **No native `<select>` in UI chrome**: Native dropdowns break the field notebook aesthetic. Use custom dropdown components (see `LocalePicker` in `TitleBar.tsx`). Must include click-outside-to-close, `aria-expanded`, keyboard support
- **No native `<input type="date">` in UI chrome**: WebKitGTK native calendar popup lifecycle is uncontrollable (focus-based heuristics fail). Use `DatePicker` from `components/shared/DatePicker.tsx`
- **WebKitGTK range input thumb alignment**: `<input type="range">` thumbs are NOT vertically centered. With a 0px-height runnable track, the thumb's TOP edge sits at the track center. Fix: `::-webkit-slider-thumb { margin-top: calc(var(--slider-thumb-size) / -2) }`. Injected `<style>` overrides for pseudo-elements are silently ignored by WebKitGTK — always modify the actual `.module.css` file
- **Filter UI architecture**: Always-visible filters in `FilterStrip.tsx` use typed `SpeciesFilter` fields. "More filters" panel uses dynamic `Vec<DynamicFilter>` channel with `validated_column()` allowlist in `query_builder.rs`. Adding a new filterable field requires two additions: entry in `field-registry.ts` + entry in the Rust allowlist. `patchFilters()` in `state/plant-db.ts` is the single mutation point for filter state. `dynamicOptionsCache` is locale-scoped (`Record<locale, Record<field, DynamicFilterOptions>>`); `dynamicOptionsPending` deduplicates concurrent IPC requests per locale+field
- **FilterStrip is data-driven**: Chip-row filters are defined as a `chipRows` config array in `FilterStrip.tsx`, not individual JSX blocks. Add new chip filters by adding an entry to the array. Toggle filters (woody, nitrogen) remain inline JSX. Layout uses CSS Grid (`auto 1fr` columns) with `display: contents` on `.filterRow` — the label column auto-sizes to the widest label across all languages. `.filterActions` spans both columns via `grid-column: 1 / -1`
- **FilterStrip <-> More Filters exclusion**: Fields that are first-class `SpeciesFilter` typed fields must be listed in `STRIP_FIELDS` in `MoreFiltersPanel.tsx` to prevent double-filtering. Strip-only fields (like `habit`, `climate_zones`) should NOT appear in `field-registry.ts` at all. Currently: `habit`, `woody`
- **Junction-table filters use EXISTS subquery**: `climate_zones` filters via `EXISTS (SELECT 1 FROM species_climate_zones cz WHERE cz.species_id = s.id AND cz.climate_zone IN (?))` in `append_structured_filters`. This pattern is not compatible with the dynamic `validated_column()` path - junction-table fields must be strip-only (dedicated `SpeciesFilter` field), not in More Filters
- **Strip chip labels use i18n keys, not DB translations**: FilterStrip chips render at load time before dynamic options IPC completes. Labels use `t('filters.climateZone_Tropical')` pattern, not `translate_value()`. DB `translated_values` entries for `climate_zone` exist for forward compatibility but are not currently consumed at runtime
- **Dynamic filter option ordering**: `value-ordering.ts` exports `orderFilterValues(field, values)` which sorts dynamic filter options semantically (seasonal chronological, intensity low-to-high, structural large-to-small, spectral warm-to-cool). Called from `MoreFiltersPanel.tsx` when rendering categorical chips. Add new field orderings to `FIELD_ORDERING` map. Fields not in the map keep alphabetical DB order
- **SearchBar count badge uses `totalEstimate` from backend `total_estimate`**: `build_count_query` in Rust computes the real count. SearchBar shows it when `> 0`. The count is a flex sibling of the input wrapper; only the clear button is absolutely positioned inside `.searchInputWrap`
- **Virtualized plant-search resets are keyed to committed first-page results, not query text**: `state/plant-db.ts` intentionally keeps the previous rows visible during debounced text changes. Any scroll-top / virtualizer reset behavior must key off `searchResultsRevision` (incremented when a fresh first page replaces the visible dataset), not `searchText`, filters, or locale directly. Pagination appends must not bump the revision
- **`@tanstack/virtual-core` count changes need `measure()` on the same scroll element**: Updating options + calling `_willUpdate()` is not enough when the container stays mounted. `_willUpdate()` only does real work when the scroll element changes; use `virt.measure()` after count changes under the same scroll container

## Build
- **`CANOPI_SKIP_BUNDLED_DB=1`**: Env var checked in `desktop/build.rs`. When set, overrides `tauri.conf.json` bundle resources to an empty list so the crate compiles without a locally generated `canopi-core.db`. Used by CI lint/test jobs. The runtime already degrades gracefully when the DB is missing; release packaging still requires the real DB
- **Rust lint gate**: Match CI locally with `cargo clippy --workspace --all-targets -- -D warnings`. `--all-targets` matters; plain workspace clippy can miss test-only warnings
- **CI release build downloads the DB**: The `build.yml` workflow downloads `canopi-core.db` from the `canopi-core-db` GitHub release tag into `desktop/resources/` before running `tauri build`
- **Linux deps shared action**: `.github/actions/install-linux-deps/` — reusable composite action for `apt-get install` of GTK/WebKit/librsvg/patchelf. Used by lint, test, and build jobs
- **Linux bundle**: `--bundles deb appimage` (no RPM). Other platforms use Tauri defaults
- **Deb depends**: Explicit `depends` in `tauri.conf.json` uses `|` alternatives for Ubuntu 24.04 t64 transition (`libgtk-3-0 | libgtk-3-0t64`). Tauri *merges* custom depends with auto-detected ones (doesn't replace)
- **Package size**: `canopi-core.db` is ~1.1GB, making the `.deb` ~335MB compressed. AppImage is ~351MB. Large enough for download corruption - users should verify checksums
- **Release candidate workflow**: `.github/workflows/release-candidate.yml` — builds RC artifacts from a release branch. Promotion scripts: `scripts/promote-release.sh` (RC → release), `scripts/publish-db-release.sh` (upload canopi-core.db to GitHub release tag)
- **Desktop icons**: Generated via `scripts/generate-desktop-icons.sh` from an SVG source. All sizes (32/128/256/icns/ico) must be committed — `generate_context!()` panics if missing

## Platform / Native Gotchas
- **Platform trait lives in `desktop/src/platform/mod.rs`**: NOT in `common-types` — `FileWatchHandle` contains closures (not serializable). Lib crates export marker structs, platform/mod.rs implements the trait via conditional modules
- **`FileWatchHandle` must cancel on drop**: Uses `Option<Box<dyn FnOnce()>>` pattern with `Drop` impl that joins the watcher thread
- **Cairo deps for lib-c**: `cairo-rs = "0.20"` with `png` + `pdf` features, `inotify = "0.11"`, `libc = "0.2"`
- **macOS/Windows stubs**: All code `#[cfg(target_os = "...")]` gated. Compiles on Linux via conditional compilation. CI validates on actual platforms
- **Linux deps**: `sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev patchelf` — do NOT install `libappindicator3-dev`
- **`std::fs::rename` on Windows**: Fails with locked files. Use `design::atomic_replace()` with rollback sidecar

## MapLibre / Terrain
Current MapLibre usage is frontend-owned in the full-screen `LocationTab`, featured-design `WorldMapSurface`, and the in-canvas `MapLibreCanvasSurface` basemap. The current in-canvas slice is visual-only: lazy-loaded, non-interactive, and driven by the canvas camera through read-only runtime seams. These gotchas apply when extending beyond that base-layer slice:
- **MapLibre paint properties can't use CSS vars**: Hardcoded hex colors in MapLibre style objects are acceptable — they render on map tiles, not app chrome
- **`maplibre-contour` for client-side DEM contours**: Use `DemSource` with AWS Terrain Tiles (Terrarium encoding). Register protocol once with `addProtocol()`
- **MapLibre container opacity for map blending**: Apply opacity to the container div; do not make the renderer canvas transparent via renderer internals
- **Map layer z-index**: Insert map div before `.canvasContainer`. Canvas container background must become transparent when map is active
- **Canvas camera remains authoritative**: In-canvas MapLibre follows viewport state via read-only runtime APIs (`getViewport()`, `getViewportScreenSize()`, `viewportRevision`). Do not let MapLibre become a second camera or document authority
- **`download_template` security**: HTTPS-only + domain allowlist (`templates.canopi.app`) + filename sanitization + path traversal check + 50MB size limit
