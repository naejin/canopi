# Canopi v2 implementation plan

Status: accepted by the user on 2026-09-25. This is the single execution handoff for Canopi v2. It is self-contained: a new session needs no chat history. Delete this file when v2.0 is released; `docs/architecture.md` (written in step V1) is the lasting description.

## 0. How to use this plan

- Work on branch `feature/geolibre-adoption` only. Every v2 bead commits there; do not open per-bead branches. Pull with rebase before starting; push after every bead.
- The bd epic `canopi-fxil` ("Canopi v2") has one bead per step: `V1` = `canopi-fxil.1` … `V12` = `canopi-fxil.12`. Claim the bead, implement its section, run its gates, close it with a receipt (what shipped, commits, tests run, anything skipped and why).
- Subagents are allowed without asking. Give each one explicit file ownership; never let two agents edit the same file.
- Behavioural TDD: write the failing test that states the new behaviour first, then the code.
- When this plan and older repository docs disagree, this plan wins. Delete or rewrite the stale doc in the same bead instead of working around it.
- Escalate to the user (do not decide alone): anything that changes a decision in §2, adds a runtime dependency not named here, or needs a service's terms interpreted beyond the checks listed in §8.

## 1. Philosophy (the five v2 principles)

1. **The map is the canvas.** Basemap, satellite, LiDAR and terrain are the background of the design surface. There is no separate "local canvas" and no Design location.
2. **Every design object is geolocated.** Plants, zones, annotations, measurement guides and group members are stored in WGS84 longitude/latitude. Metres exist only inside the runtime, never in files.
3. **Reuse GeoLibre before writing code.** GeoLibre (MIT, https://github.com/opengeos/GeoLibre, reference commit `e9df9e2`) is the source for generic GIS pieces: layer management, basemaps, geocoding, raster/COG, print helpers. Copy modules (with attribution) or depend on light packages; do not fork the app.
4. **No backward compatibility.** No migrations, legacy readers, compatibility shims or old-format fixtures. Old data is refused, set aside or deleted.
5. **Delete, don't deprecate.** Remove dead code, docs, tests, scripts and dependencies in the same change that makes them dead.

## 2. Decisions (locked)

| # | Decision |
|---|---|
| D1 | Option A: keep Canopi's Preact + signals app, Rust/Tauri backend and design engine; reuse GeoLibre modules. No React, no fork. |
| D2 | `.canopi` format **v7**: all positions in lon/lat; `spatial_frame` (anchor, north bearing, placement status, altitude) removed; v6 and older are refused with the existing unsupported-version error. |
| D3 | The runtime keeps working in metres through a **session plane** (see §4.2) built at the codec boundary; stored lon/lat is authoritative. |
| D4 | New Design view: the app's last view; if none, the middle of the Sahara (lat 23.0, lon 13.0, zoom 4) with a "Search your site" prompt. Opening an existing Design fits the camera to its objects (empty Design → last view). |
| D5 | Location tab and the Canvas/Location primary navigation are removed. A **pin** button (icon only) under the **inspection lens** button (loupe icon only) opens a search field: place name or coordinates. Confirm moves the **view only**; objects never move. Users cut/paste objects to relocate them. |
| D6 | Geocoding in **both** editions through one provider registry (copied from GeoLibre `packages/core/src/geocoding.ts`); Nominatim first, search on Enter only, never as-you-type, 1.1 s spacing, OSM attribution on results. |
| D7 | Basemap: OpenFreeMap **Liberty** vector style by default, with the attribution "OpenFreeMap © OpenMapTiles Data from OpenStreetMap"; style choice Liberty/Positron/Bright/Dark in the Basemap row. OSM raster tiles and MapTiler are removed. |
| D8 | Satellite is its own row in **Site references**, listed under Basemap; turning Satellite on hides the Basemap. Providers: Google **only with a device key** (official Map Tiles API session path; the keyless path is removed) and one keyless provider, **Esri World Imagery**, subject to the terms check in §8.1 (fallback: EOX Sentinel-2 cloudless). |
| D9 | One renderer: the PixiJS scene inside MapLibre (`maplibre-pixi`). Canvas2D fallback and any standalone (non-map) scene backend are deleted. |
| D10 | GeoJSON (RFC 7946) import and export of design objects on Desktop and Web. |
| D11 | Maps in PDF are **deferred** (not in v2.0). |
| D12 | Docs: historical docs are deleted outright; the target structure in §6 V10 replaces everything. |
| D13 | Existing user data: LiDAR libraries from older Canopi are deleted on open; an older `user.db` is renamed `user.db.v<N>-set-aside`; Web v1 storage is ignored (all already implemented on this branch). |

## 3. Current state (facts at plan time)

Branch head `5c36c703` on `feature/geolibre-adoption`, which already contains:

- GeoLibre adoption S0–S5: fixed LiDAR library items, upstream COG display (`maplibre-gl-raster`, `cog-tiler-wasm`), Data Library and Layers data band, GeoLibre CLI slope. Receipt: `docs/design/raster-rework/geolibre-adoption-receipt.md` (deleted in V10; read it first if you touch LiDAR).
- LiDAR compatibility removal (catalogue v20, no migrations) and app-wide compatibility removal (user DB schema v9, Web storage without migration, no "system" theme rewrite, no scene `scale` mirror).

Architecture today (verified):

- **The map already hosts the scene.** `maplibre/shared-scene-layer.ts` is a MapLibre custom layer in which Pixi draws the scene (`canvas/runtime/renderers/maplibre-scene.ts`, id `maplibre-pixi`). MapLibre owns the camera (`maplibre/workspace-camera.ts`), non-interactive; Canopi interaction forwards pan/zoom. `maplibre/scene-camera-transform.ts` derives the scene viewport from the map by projecting the anchor and two 1 m unit vectors.
- **Storage is local metres.** `common-types/src/design.rs`: `Position {x, y}` (line ~477) used by `PlacedPlant.position`, `Zone.points` (+ `rotation`), `Annotation.position`, `MeasurementGuide.start/end`; `SpatialFrame` (line ~277); `CURRENT_CANOPI_FILE_VERSION = 6` (line 7). Codec: `canvas/runtime/scene/codec.ts`. Ingestion: `app/contracts/design-ingestion.ts`, `app/contracts/document.ts`. Conformance corpus: `common-types/canopi-design-conformance.json`. Projection seam: `canvas/projection.ts` (`worldToGeo`, `geoToWorld`, local Mercator, 10 km precision warning), `canvas/maplibre-camera.ts`, `canvas/spatial-frame.ts`.
- **`spatial_frame` consumers** (non-test): `canvas/runtime/runtime.ts`, `canvas/runtime/scene-runtime/scene-sync.ts`, `canvas/runtime/scene/codec.ts`, `canvas/runtime/app-adapter.ts`, `web/browser-workspace-map-contribution-adapter.ts`, `web/browser-design-session.ts`, `app/saved-object-stamps/file.ts`, `app/canvas-map-surface/desktop-workspace-map-contribution-adapter.ts`, `app/canvas-map-surface/workspace-activation-snapshot.ts`, `app/location/{map-editing,model,coordinate-workbench}.ts`, `app/contracts/{document,design-ingestion}.ts`, `app/lidar/{camera-request,inspection}.ts`, `app/design-edit/{authority-capability,history,location}.ts`, `app/document-session/store.ts`, `desktop/src/design/{format,new_design_defaults}.rs`, `common-types/src/design.rs`.
- **Metre-based geometry (keep, runs in the session plane):** zone geometry/measurements, measurement guides, plant spacing, plant presentation (canopy from `width_max_m`), annotation layout, automatic detail, inspection lens, grid snapping (`canvas/grid.ts`), guides snapping, rulers (`canvas/rulers.ts`), scale bar (`canvas/scale-bar.ts`), hit testing, camera `{x, y, scale}` (px per metre).
- **Renderers:** `canvas/runtime/renderers/{maplibre-scene,pixi-scene,canvas2d-scene,host,capabilities,profile}.ts`. Production = `maplibre-pixi`; Canvas2D fallback per ADR 0025.
- **Location & basemaps:** `components/canvas/LocationTab.tsx`, `components/canvas/BasemapSettings.tsx`, `app/location/*`, `maplibre/location-map.ts`, `maplibre/basemap-provider.ts` (OSM street, MapTiler `satellite`, `google_satellite` keyless or official), `maplibre/basemap-tile-auth.ts` (credential boundary), `maplibre/config.ts`, `app/canvas-map-surface/layer-stack.ts`, Layers rows in `app/canvas-layer-presentation/presentation.ts` rendered by `components/canvas/LayerPanel.tsx`. Desktop geocoding: `desktop/src/services/geocoding.rs` (Nominatim `/search`, limit 5).
- **Inspection lens:** `components/canvas/InspectionLens.tsx`, mounted in `components/panels/CanvasPanel.tsx`.
- **Icons:** in-house (`components/canvas/toolbar-icons`, `components/shared/PanelIcon`).
- **Sizes:** canvas runtime ~25.5k LOC (`canvas/runtime/` 22.6k), `app/` 22.6k, `components/` 13.5k, `maplibre/` 5.9k; Rust 42k LOC of which LiDAR 21.7k. Tests: 287 Vitest files (~2,800 cases), ~440 Rust tests.
- **Known pre-existing failures:** `canopi-8dy9` (two unhandled rejections from LiDAR polling in `bootstrap-shell.test.ts`), `canopi-6660` (`location-tab-map-failure.test.tsx`, disappears with the Location tab).
- **Docs:** 183 Markdown files / ~20,100 lines; ~74 % historical.

GeoLibre facts you will rely on (reference commit `e9df9e2`; clone it to `.rq-scratch/geolibre-src` with `git clone https://github.com/opengeos/GeoLibre && git -C GeoLibre checkout e9df9e2` if needed):

- React 19 + Zustand app, ~400k LOC; do **not** import its React components or stores.
- Reusable modules (framework-free TS): `packages/core/src/geocoding.ts` (provider registry, Nominatim spacing), basemap presets in `packages/core/src/types.ts` (`OPENFREEMAP_BASEMAPS`, `DEFAULT_BASEMAP` = Liberty), store-driven layer sync in `packages/map/src/layer-sync.ts` (3.9k lines — copy ideas/parts, not wholesale), fill patterns `packages/map/src/fill-patterns.ts`, map capture `packages/map/src/map-capture.ts`, print export `apps/geolibre-desktop/src/lib/print-layout-export.ts`.
- `@geolibre/map` pulls Cesium and a React peer; prefer copying modules. `@geolibre/core` may be depended on for types only if it adds no heavy runtime.

## 4. Target architecture

### 4.1 Authorities (write this into `docs/architecture.md`)

| Owner | Owns | Mutation path |
|---|---|---|
| Scene runtime (`SceneStore` via `SceneCanvasRuntime`) | design objects: plants, zones, annotations, guides, groups, locks, species colours/symbols/codes, layers | runtime transactions |
| Design Edit (`app/design-edit/`) | budget, currency, timeline, consortiums, description, extra | Design Edit commands |
| Map layer store (new, replaces `layer-stack.ts` + per-surface binders) | map layers: basemap, satellite, LiDAR items, contours, hillshade; order, visibility, opacity, provider choice | layer-store actions |
| Settings | last view, basemap style, satellite provider, Google key (device-local credential), locale, theme | settings actions |

One undo history covers scene runtime + Design Edit (as today). Map layers and settings are not undoable.

### 4.2 Geolocation model

- **Files store lon/lat.** New `GeoPoint { lon: f64, lat: f64 }` replaces `Position` in every persisted design object. Zone rotation is an angle in degrees clockwise from true north.
- **Session plane.** On load, the codec builds a local tangent plane (reuse the local-Mercator math in `canvas/projection.ts`) with its origin at the centre of the objects' bounds (empty Design: the current view centre). All runtime geometry, tools, snapping, measurements and PDF layout keep using metres in this plane.
- **Re-origin.** When the view centre moves more than 10 km from the plane origin, rebuild the plane at the view centre and re-project every object from its **stored** lon/lat. This is lossless because lon/lat is authoritative; it replaces the 10 km precision warning.
- **Canonical write-back.** The codec remembers each object's loaded lon/lat. On save, an object whose plane coordinates did not change writes its original lon/lat unchanged; a changed object writes lon/lat rounded to 1e-9 degree (~0.1 mm). Open → save without edits must be byte-identical.
- **Saved object stamps and templates** stay relative arrangements in metres (stamps already are; templates become v7 files with lon/lat and are placed relative to the view on insert).
- **LiDAR** sampling and coverage fit use the session plane instead of the anchor (`app/lidar/camera-request.ts`, `app/lidar/inspection.ts`).
- **Web and Desktop** share the codec and runtime unchanged.

### 4.3 Map stack

- Map layer store (signals) + a sync module that applies it to MapLibre (pattern from GeoLibre `layer-sync.ts`): one place orders layers into bands — background (basemap **or** satellite), LiDAR, terrain references, the shared scene layer, interaction overlays.
- Basemap = OpenFreeMap vector style added as a vector source + style layers + glyphs + sprite **without** `setStyle()` (keeps the map lifetime, camera and edits). Row opacity scales each style layer's paint opacity. Labels follow the app locale (`name:<locale>` with `name` fallback).
- Satellite = raster source. Esri (keyless, pending §8.1) or Google (device key, official session through `basemap-tile-auth.ts`).
- Site references group in Layers: Basemap, Satellite, LiDAR items, Contours, Hillshade.

## 5. Sequencing

```
V1 docs/ADR foundation ──► V2 format v7 + geolocation ──► V5 navigation ──► V6 GeoJSON
        │                        │
        │                        └──► V3 single renderer (after V2 lands)
        ├──► V4 map layers, basemap, satellite (parallel with V2; different files)
        ├──► V8 cleanup + deps + bundle (parallel; not canvas/ or app/location/)
        ├──► V9 test baseline + CI gates (parallel)
        ├──► V11 backlog + disk hygiene (parallel; disk deletions need user approval)
        └──► V7 remaining GeoLibre reuse (after V4)
V10 docs rewrite runs alongside and finishes last; V12 release after everything.
```

## 6. Steps

Each step lists scope, main files, acceptance (tests to write first) and step-specific gates. Common gates are in §7.

### V1 — Foundation: architecture, ADRs, AGENTS.md (~1 day)

- Write `docs/architecture.md` (≤200 lines): the five principles, §4 authorities, geolocation model, map stack, GeoLibre reuse boundary (what is copied, from which path, at which commit), editions.
- Replace `docs/adr/` with a fresh v2 set (≤60 lines each), numbered from 0001: geolocated map canvas; GeoLibre module reuse (not fork); no backward compatibility; one renderer; Web edition scope (static app, browser-local data, geocoding allowed, no problem reports, `.canopi` export only); species catalog storage (Desktop SQLite / Web Parquet+DuckDB); Design groups, symbols and saved stamps; PDF export (no map in v2.0). Carry over only still-true content from the old ADRs, then delete all old ADRs.
- Rewrite `AGENTS.md` (≤120 lines): priorities, the five principles, repo map, one-line guide index, branch rule once (all v2 work on `feature/geolibre-adoption`), subagents allowed, quality-gate table, architecture rules (authorities, resource ownership, native execution), banned patterns (no React, Tailwind, Zustand/Redux/MobX, react-i18next, rusqlite pools, typeshare, string SQL, raw `rgba()` in CSS Modules, `font-weight: 500`), handoff checklist. Move long command blocks to the native/release guide; move design direction to `.interface-design/system.md`.
- Acceptance: `python3 scripts/check_docs.py` passes; no doc mentions `spatial_frame`, Location tab, migrations, backward compatibility as a requirement, one-branch-per-bead for v2, or "subagents only when asked".

### V2 — Format v7 and geolocated objects (~4–5 days)

- `common-types/src/design.rs`: add `GeoPoint`; replace `Position` in persisted objects; delete `SpatialFrame` and its fields; `CURRENT_CANOPI_FILE_VERSION = 7`, minimum supported 7; regenerate bindings (`npm run gen:types`) and rewrite `canopi-design-conformance.json` for v7 only.
- Codec (`canvas/runtime/scene/codec.ts`) + ingestion (`app/contracts/*`): session plane build, lon/lat ↔ plane, canonical write-back, re-origin support exposed to the runtime.
- Delete: `canvas/spatial-frame.ts`, `app/design-edit/location.ts`, `app/location/*` placement workbench, `spatial_frame` handling in every consumer listed in §3, anchor fields in `desktop/src/design/{format,new_design_defaults}.rs`. `maplibre/scene-camera-transform.ts` derives the viewport from the session plane origin instead of the anchor.
- Settings: add `last_view {lon, lat, zoom}` (written on camera settle, throttled); new Design opens there, else Sahara (D4). Opening a Design fits to its objects.
- LiDAR: `app/lidar/camera-request.ts`, `app/lidar/inspection.ts` use the session plane.
- PDF (`app/canvas-pdf/`): layout from the session plane; no behaviour change otherwise.
- Tests first:
  - v7 round trip byte-identical without edits; editing one plant rewrites only that plant.
  - 1e-9° canonical rounding; lon/lat → plane → lon/lat error < 0.1 mm within 10 km.
  - re-origin after a >10 km pan leaves every object's stored lon/lat unchanged.
  - v6 file refused with `unsupported_version`.
  - new Design view: last view, else Sahara 23/13 z4.
  - zone area/edge labels and plant spacing unchanged vs. v6 fixtures converted by a one-off test helper (test-only, no production converter).
  - 2,200-plant scene: frame time and pan within 5 % of the current benchmark.
- Gates: shared-contract gates (gen/check types, cargo test), Rust gates, full Vitest, edition builds.

### V3 — One renderer (~1–2 days, after V2)

- Keep `maplibre-scene.ts` (`maplibre-pixi`) and the Pixi drawing code it uses. Delete `canvas2d-scene.ts`, the standalone Pixi canvas backend, fallback selection in `capabilities.ts`/`profile.ts`, and camera code that only aligned the metre canvas with the map. WebGL2 unavailable → explicit "map unavailable" state (already exists for MapLibre failures).
- Tests: renderer selection has one outcome; unavailable WebGL2 shows the unavailable state; dense-scene tests still pass on `maplibre-pixi`.

### V4 — Map layers, basemap, satellite (~3–4 days, parallel with V2)

- New map layer store + sync (replaces `app/canvas-map-surface/layer-stack.ts` and per-surface basemap binders; keep the credential boundary `maplibre/basemap-tile-auth.ts`).
- `maplibre/basemap-provider.ts`: OpenFreeMap styles (D7) with attribution; satellite providers (D8); delete OSM raster, MapTiler, keyless Google, `REMOTE_BASEMAP_TILE_URL_TEMPLATE`.
- `BasemapStyle` setting becomes `basemap_style: liberty|positron|bright|dark` + `satellite_provider: esri|google`; the satellite row visibility is a layer-store state.
- Layers panel (`presentation.ts`, `LayerPanel.tsx`): Site references group = Basemap (style choice, opacity), Satellite (provider choice, Google key field when Google, opacity; on ⇒ Basemap hidden), LiDAR items, Contours, Hillshade. Remove `BasemapSettings.tsx` after moving its key UI.
- Tests: OpenFreeMap source/layers added without `setStyle`; attribution present; opacity scales all style layers; Satellite on hides Basemap and off restores it; Google without key is unavailable with the key prompt; key never appears in state snapshots, exports or logs (existing tests keep passing); locale switch updates labels.

### V5 — Navigation: pin search, loupe, Location removed (~2 days, after V2)

- Delete `components/canvas/LocationTab.tsx`, the Canvas/Location primary navigation in the panel bar, `maplibre/location-map.ts` if unused, `app/location/search-controller.ts` after moving search.
- Copy GeoLibre `packages/core/src/geocoding.ts` into `desktop/web/src/app/geocoding/` (MIT header + `THIRD_PARTY_NOTICES` entry with path and commit). Desktop transport: reuse `desktop/src/services/geocoding.rs` as the Nominatim HTTP transport (identifying User-Agent) behind the registry; Web: browser `fetch`. Coordinates ("lat, lon") are parsed locally without a request.
- Canvas controls (`CanvasPanel.tsx`): loupe icon button (inspection lens, no visible label) and below it a pin icon button that opens an inline search field; Enter searches; results list; confirm flies the camera; Escape closes. Tooltips, `aria-label`, keyboard shortcut, all 11 locales.
- Empty-Design onboarding: when the Design has no objects and there is no last view, show a one-line "Search your site" prompt that opens the pin search.
- Tests: confirm moves the view only (scene snapshot identical before/after); Enter-only requests with ≥1.1 s spacing; coordinates skip the network; Web and Desktop both reach the registry; attribution shown with results.

### V6 — GeoJSON import/export (~2 days, after V2)

- Export: FeatureCollection (RFC 7946, WGS84) of all design objects with `canopi_kind` and domain properties (species, colour, symbol, notes, planted date, quantity, group ids, rotation).
- Import: Point with `species`/`canonical_name` → plant; other Point → annotation; Polygon → zone; LineString → measurement guide; unsupported geometries reported by count. Imported objects are one undoable transaction.
- Desktop: native open/save dialogs through existing file commands; Web: file picker and download.
- Tests: export→import round trip preserves objects and properties; malformed input rejected with a named error; import is one undo step.

### V7 — Remaining GeoLibre reuse (~1 week, after V4)

- Replace remaining generic map infrastructure with GeoLibre-derived modules where it removes code: terrain/contours/hillshade wiring, raster display pool glue, map capture helpers (for future PDF maps), fill patterns for zones if they improve on the current ones.
- Rule: a copy is justified only if Canopi code gets smaller or clearly better; record every copied file in `THIRD_PARTY_NOTICES`.

### V8 — Cleanup, dependencies, bundle (~2–3 days, parallel)

- Delete `scripts/raster-qualification/`, the Q harness, capacity-plane generators, benchmark/evidence scripts, and any code only they used. Second pass over `desktop/src/services/lidar` for code that only served the old import/history model.
- Dependencies: confirm each of `@deck.gl/*`, `geotiff`, `proj4`, `whitebox-wasm` is needed (by `maplibre-gl-raster`, `cog-tiler-wasm` or slope); remove unused ones; resolve `npm audit` findings.
- Bundle: lazy-load the PDF engine, Data Library/LiDAR, species detail, Budget/Calendar/Consortium panels. Target main chunk < 900 kB (from 1.46 MB).
- Gates: builds for both editions; `check-web-build-boundaries.mjs`; bundle size recorded in the receipt.

### V9 — Test baseline and CI gates (~2 days, parallel)

- Fix `canopi-8dy9`; `canopi-6660` closes with V5.
- Make unhandled errors fail Vitest (`dangerouslyIgnoreUnhandledErrors: false`, and CI checks the exit code).
- Add CI jobs: 2,200-plant performance run (fails on >10 % regression), geolocation precision/round-trip suite, coverage ratchet (current coverage as the floor; fails if it drops).
- Run the GDAL-backed LiDAR lane in CI (`canopi-kc8z`).

### V10 — Documentation (~2–3 days, alongside, finishes last)

Target (~3,000 lines excluding release notes):

```
AGENTS.md (≤120)   README.md (≤80)   CONTEXT.md (glossary only, ≤250)
docs/README.md (≤40: map + placement rules)
docs/architecture.md (≤200, from V1)
docs/guides/map-workspace.md, design-document.md, data-library.md, frontend.md,
            editions.md, species-catalog.md, pdf-export.md, native-and-release.md
docs/workflow.md (bd, triage, branch rule, delivery, ownership)
docs/adr/ (fresh v2 set from V1)
docs/release-notes/
.interface-design/system.md + ≤4 patterns
```

- Delete outright: `docs/design/**` (after moving surviving LiDAR storage/scientific invariants and the Data Library product contract into `guides/data-library.md`), evidence docs at `docs/` top level (canvas-pdf-{validation,export-research,native-verification}, canvas-performance-evidence, native-canvas-performance, v2-*, web-catalog-parquet-performance-evidence, windows-compression-benchmark), `docs/assets/`, `docs/evidence/`, `docs/agents/`, `docs/agent/` (after merging still-valid content into `docs/guides/`), `docs/workflow/` (merged into `docs/workflow.md`), `.tmp/pdf-workspace-review/`, and this plan at release.
- Design system (item 15): define the icon set (in-house `toolbar-icons`/`PanelIcon`), icon-only button rules (tooltip, `aria-label`, shortcut hint, focus ring), and apply them to every canvas control, not only loupe and pin.
- Acceptance: `check_docs.py` passes (update the validator if paths change, with `python3 -m unittest scripts.test_check_docs`); every guide ≤ its budget; no contradictions on branch policy, compatibility, geocoding, renderer or coordinates.

### V11 — Backlog and disk hygiene (~0.5 day, parallel)

- Close as obsolete (reason: superseded by the v2 philosophy): `canopi-j571.1`, `canopi-j571.3`, `canopi-jv8a`, `canopi-kqpp`, `canopi-a9uy`, `canopi-8shm.8`. Rewrite `canopi-j8mp` into V5's scope or close it. Keep product beads (`canopi-8shm.9`, `canopi-9357`, `canopi-0rl5`, `canopi-b5c7`, `canopi-wsi1`, `canopi-qcd5`, `canopi-kc8z`, `canopi-5neg`, `canopi-todb`, `canopi-6o8q`).
- Disk (at ~94 %): list `.rq-scratch/*` worktrees, build dirs and probes with sizes and last-modified dates; ask the user which to delete; then `git worktree remove` / `rm` exactly those. Never delete the user's main checkout `target/` without approval.

### V12 — Release v2.0 (after all steps)

- Version bump across workspace and frontend packages; release notes stating the break (old `.canopi` v6 designs are refused; old LiDAR libraries deleted; old user data set aside; Web v1 storage ignored); website copy; `canopi-qcd5` permanent download URLs.
- Tag only after the user reviews the candidate with `cargo tauri dev` and approves. Delete this plan in the release commit.

## 7. Quality gates (every bead)

| Change | Gates |
|---|---|
| Any Rust | `cargo fmt --all -- --check`; `CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings`; `CANOPI_SKIP_BUNDLED_DB=1 cargo test --workspace` |
| Native commands | `CANOPI_SKIP_BUNDLED_DB=1 cargo test -p canopi-desktop native_command_policy::tests` |
| Shared contracts | `cd desktop/web && npm run gen:types && npm run check:types` |
| Frontend | `cd desktop/web && npx tsc --noEmit && npm test` (zero failures, zero unhandled errors) |
| Shared composition | `npm run check:ui && npm run build && npm run build:web` |
| LiDAR | GDAL + GeoLibre ignored lanes: `CANOPI_GEOLIBRE_BIN=<path> CANOPI_SKIP_BUNDLED_DB=1 cargo test -p canopi-desktop --lib services::lidar -- --ignored --test-threads=1 --skip e2e_` |
| Docs | `python3 scripts/check_docs.py` |

A gate that cannot run is reported with the exact command, reason and residual risk in the bead and receipt. Never weaken a gate to pass.

## 8. Verification items the implementer must resolve

1. **Esri World Imagery terms** (V4): confirm the current Esri terms allow a free desktop/web app to display World Imagery tiles keylessly with attribution. If not clearly allowed, use EOX Sentinel-2 cloudless (check its licence year: 2016 is CC BY 4.0) and tell the user the resolution trade-off. Do not ship an unverified provider.
2. **Nominatim from Desktop** (V5): confirm the Desktop transport sends an identifying User-Agent and that Web requests carry a Referer; if Nominatim blocks either, stop and report (alternatives in the registry: Pelias/Photon), do not add a proxy.
3. **OpenFreeMap without `setStyle`** (V4): confirm glyphs and sprite can be added at runtime in the pinned MapLibre (`map.setGlyphs`, `map.addSprite`); if not, report before redesigning the map lifetime.
4. **Performance** (V2/V3): record the 2,200-plant benchmark before and after; a regression >5 % blocks the step.

## 9. Environment notes

- Plant DB: `desktop/resources/canopi-core.db` (~1.2 GB, gitignored) is needed for full builds; `CANOPI_SKIP_BUNDLED_DB=1` for checks and tests.
- GeoLibre CLI for slope: `target/debug/geolibre` (or `CANOPI_GEOLIBRE_BIN`); build with `scripts/build-geolibre-cli.sh`.
- The user runs `cargo tauri dev` in the main checkout `~/projects/canopi` on this branch. Their uncommitted `desktop/src/native_operation.rs` and `.beads.gate.lock` are theirs: never stage, revert or stash them. Prefer a separate worktree for implementation and ask the user to pull.
- Disk is tight (~28 GB free): share build caches deliberately and delete only your own artifacts.
- User data on this machine was backed up to `~/canopi-v1-data-backup` before v2 first ran.

## 10. Handoff and receipts

- Each closed bead: commit hashes, gates run with results, skipped gates with reasons, docs changed, follow-up beads filed.
- At the end of a session: push, `git status --short --branch` clean for your files, summary to the user with what to test in `cargo tauri dev`.
