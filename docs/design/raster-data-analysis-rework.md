# Raster foundation, Data and Analysis workbenches

Status: proposed — satellite access decided; engine qualification and UI prototype acceptance remain execution gates.
Tracking: `canopi-j571`; reconciled children `canopi-kqpp`, `canopi-jv8a`, `canopi-j8mp`, and deferred `canopi-5neg`. Implementation still requires separate authorization.
Current guidance: [LiDAR](../agent/lidar.md), [MapLibre](../agent/maplibre.md), [edition development](../agent/edition-development.md), and [document lifecycle](../agent/document-lifecycle.md).

## Mandate and delivery boundary

Replace the dense-raster import foundation with bounded raster access inspired by GeoLibre, and organize Desktop geographic workflows around Data, Analysis, and Layers. A user imports numeric GeoTIFFs, chooses whether incoming data replaces overlap, runs a compatible analysis, and controls source/result display independently. Large files and large collections must not require a full-resolution mosaic in memory.

Include Web Location placement and shared basemap presentation in this initiative. Desktop alone receives Data import and Analysis in this delivery. Web continues to preserve dataset references without rendering or processing their local assets. Numeric rasters are in scope; local RGB/RGBA orthophotos are deferred. Web Location supports map placement and coordinates; address search is deferred. Preserve Desktop address search.

The first complete analysis is slope. Hydrology, canopy analysis, and globe rendering are later increments, not required to close the initial delivery. Prepare small reusable interfaces for the actual consumers in this plan; do not implement speculative engine abstractions or a general-purpose GIS framework.

No SQLite-to-DuckDB migration, general SQL console, plugin marketplace, visual processing model builder, split-map comparison, national data mirror, implicit upload, point-cloud import, service worker, or offline Web map archive is included. PDF map/raster export remains outside scope under [ADR 0024](../adr/0024-shared-canvas-pdf-export.md). Existing local Desktop raster use must work offline after installation/import; online basemaps retain provider-dependent availability.

Planning only is authorized. No implementation, issue slicing, deployment, or public release is authorized by this artifact. User review accepts product layout; scientific fixtures, lifecycle checks, and packaged-platform evidence accept implementation.

## Evidence and existing work

Inspected baseline: `a13f2d99d0864df81fb67fc61baacc24d7d476ff` (2026-09-17); recheck before execution. The reported import error has not been reproduced through the application; metadata and code identify a relevant capacity failure, not a verified account of the user's original action.

| Surface | Inspected entry point and retained behavior |
| --- | --- |
| Native library | `desktop/src/services/lidar/{mod,catalogue,paths,import,grid,analysis,display,engine,probe}.rs`: dedicated SQLite catalog, managed originals, immutable generations, history/undo, generation-checked publication, slope refresh |
| Contracts and IPC | `common-types/src/lidar.rs`, `desktop/src/commands/lidar.rs`, `desktop/web/src/ipc/lidar.ts`: typed native boundary and versioned document presentation |
| Frontend library | `desktop/web/src/app/lidar/actions.ts`, `library-store.ts`: session-fenced presentation attachment, status, polling, import and analysis actions |
| Document authority | `desktop/web/src/app/design-edit/lidar.ts`: reference visibility, opacity, style, order, and removal through Design Edit |
| Current UI | `desktop/web/src/components/panels/lidar/LidarLayersSection.tsx`: combined management/presentation and import review, to be replaced by the three-surface workflow |
| Shared renderer | `desktop/web/src/app/canvas-map-surface/`: coordinator, contribution adapters, semantic layer stack, one camera/context, terminal failure handling |
| Basemaps | `desktop/web/src/maplibre/config.ts`: OSM street tiles, MapTiler satellite-v4 when `VITE_MAPTILER_KEY` exists; current missing-key normalization falls back to street |
| Location | `desktop/web/src/app/location/coordinate-workbench.ts`, `map-editing.ts`, `model.ts`; `components/canvas/LocationTab.tsx`: placement transaction is reusable, current view composes native address search |
| Edition shell | Frontend-relative `components/workspace/DesktopWorkspace.tsx`, `web/WebWorkspace.tsx`, `components/workspace/WorkspaceComposition.tsx`, `components/panels/PanelBar.tsx`, `app/shell-commands/`: capabilities and registered dock surfaces |

The current importer checks 512 MiB per file, 1 GiB and 16 files per batch, and 25 million cells per dense working grid. `stage_source` extracts a complete raw numeric buffer; composition allocates a full union grid and mask. Import review also constructs union coverage and preview imagery. Batching only the original-file copy would leave those allocations intact.

Existing operating contracts to preserve: SceneStore owns local geometry; Design Edit owns non-canvas document edits; the library owns source bytes and scientific results. Preserve native executor admission, controller dependency rules, independent source/result visibility, coordinated document history, scoped asset access, and exact shared-map teardown. See [ADR 0025](../adr/0025-always-anchored-spatial-workspace.md).

### External reuse inventory

These are inspected upstream source identities, not verified installed package versions. Phase 1 must record the actual package tarball or built artifact, dependency lock, licenses, and supported APIs before production adoption.

| Candidate | Source identity | Decision and adaptation |
| --- | --- | --- |
| GeoLibre | `c5a72b027002a673ce48115ee19358205acd9791` | Adapt architectural patterns and selected pure definitions. Do not import its React/Zustand shell. Inspect `packages/map/src/cesium-cog-imagery.ts`, processing registry, and core dataset descriptors. Retain relevant upstream assertions when adapting behavior. |
| whitebox-wasm | `9c0ff4fdf3513f27b89c78e294610c3b418b3a4f` | Preferred evaluation candidate for `CogStream` metadata/window decoding and selected scientific capabilities; use a pinned package or narrowly built artifact behind Canopi's raster module. Do not treat full-band APIs as bounded. |
| cog-tiler-wasm | `a71c321d357b0fde063238ab38bcf7ddb914eacd` | Evaluate reuse for overview selection, reprojection and display tiles. Verify local byte-range I/O, worker operation, numeric masks, and shared MapLibre context behavior. The inspected workspace says 0.3.1 while GeoLibre declares a newer package range: resolve artifact/source correspondence explicitly. |
| geolibre-rust / geolibre-wasm | `f568433ba6392c57509b418688cc8e4c2479e088`; inspected npm manifest 1.5.3 | Defer wholesale adoption. Adapt selected tool definitions if they fit the first slope workflow. It extends Whitebox; do not bundle duplicate engines. Browser runner uses an in-memory filesystem and is not evidence of large-raster capacity. |
| Existing GDAL adapter | `desktop/src/services/lidar/engine.rs` | Retain as scientific reference and qualified native preparation/processing path while new components are evaluated. Native block processing is allowed; a complete replacement of GDAL is not promised. |

Sources: [GeoLibre architecture](https://geolibre.app/architecture/), [COG tiler](https://github.com/opengeos/cog-tiler-wasm), [Whitebox](https://github.com/opengeos/whitebox-wasm), [GeoLibre Rust](https://github.com/opengeos/geolibre-rust). Whitebox's wasm32 ceiling and whole-raster operations require qualification. Existing source availability does not establish numerical correctness, packaged compatibility, or bounded execution.

Canopi's raster-module maintainer owns upstream pins, license notices, adapter tests, and upgrade qualification. Prefer upstream libraries over copied implementations; copied definitions require source/license attribution and a retained behavior test. Do not copy generated forms that expose arbitrary engine flags or add React/Tailwind/Zustand dependencies.

## Product and domain decisions

### Dataset, analysis, and presentation

A dataset has stable identity, editable name, immutable measurement interpretation, and a current immutable generation. Interpretation records numeric type, band, scale/offset, units, horizontal CRS, vertical reference where meaningful, resolution, extent, and validity. A filename is a hint, never authority for measurement type.

An analysis definition records compatible input dataset identities, recipe/version, parameters, resolution, engine identity, and output meaning. The initial operation accepts one ground-elevation input and produces slope in degrees or percent. Results retain exact input generations, numeric outputs, validity/quality masks, and provenance. Later multi-input operations must declare compatibility and dependencies explicitly.

A display layer is a Design-owned presentation reference to a dataset or result. Hiding, reordering, or restyling does not mutate numeric data or start computation. Multiple Designs can reference one library dataset. Renaming or updating that library dataset does not dirty every Design. Adding/removing its presentation does dirty the current Design through Design Edit. Imported raster geography never changes when the Design anchor moves.

Preserve the existing serialized `lidar` presentation section and stable IDs initially, even though UI terminology becomes Data and Analysis. Do not rename the format just for UI vocabulary. Continue format-6 admission and Web round-trip behavior. Any schema extension must be additive and retain unknown per-entry fields according to existing contracts; a breaking format change requires a separate decision.

### Right-side surfaces

Data and Analysis become registered side surfaces in the existing resizable dock, adjacent to Layers in the Design group. Opening them keeps the canvas mounted. Use the existing Preact components, tokens, focus-return behavior, keyboard access, and all 11 locales. Prototype the consequential layout before production changes, following the [dock contract](../../.interface-design/patterns/dock-panels.md).

Data lists reusable library datasets and their interpretation/status. Its primary action imports files into a new dataset or a chosen compatible existing dataset. The same surface provides rename, add to current Design, import history/undo, and library deletion. New imports attach a visible reference to the originating Design only if that session still exists. Existing-dataset updates preserve current presentation preferences.

Analysis starts with operation selection, followed by compatible inputs, result name, units/parameters, and Run. Display why an input is ineligible; do not silently convert MNH into ground elevation. Keep unsupported future operations out of the working catalog. Closing/switching panels leaves jobs running. Explicit Cancel cancels the job; Escape closes a non-mutating form but must not silently cancel an unrelated running job.

Layers contains presentation controls for datasets and results, alongside the existing scene stack and site references. Geographic sources/results share an explicitly ordered geographic band beneath grid and Design objects. They are not active scene drawing layers or draggable Design objects. Provide independent visibility, opacity, color ramp/legend, and Zoom to extent. Source grouping, if used, must not constrain result visibility or actual saved order.

Pixel inspection is read-only: select the geographic layer to inspect, then show the physical numeric value and units or explicit NoData/unknown. Read native numeric data, not a colorized display pixel. It must not steal normal canvas editing gestures; the prototype must validate an explicit inspection mode and keyboard dismissal. Display sampling cannot change analysis resolution or source values.

Hide affects visibility; Remove from Design removes only the presentation reference and is undoable in document history. Delete from library requires an impact confirmation covering dependent analyses and other Design references. Retain current library history/undo semantics; library undo is separate from document undo. Missing references remain preserved with an unavailable state rather than being silently discarded.

### Simple, bounded import

The user chooses files, destination/measurement interpretation, and one unchecked-by-default option: **Replace existing data where these files overlap**. Import begins the job; no Before/After preview, per-region decisions, or second Apply stage remains.

Uncovered valid pixels are always admitted. With replacement off, existing valid pixels win; with replacement on, incoming valid pixels win. Incoming NoData/non-finite/masked pixels never erase existing data. Within a batch, preserve a stable displayed filename order; first valid input wins with replacement off, last valid input wins with replacement on. The summary states that ordering; no detailed overlap editor is introduced. Exact byte reimports remain deduplicated and cannot manufacture duplicate generations when nothing changes.

Probe all selected inputs before publication. One incompatible/corrupt file fails the batch with a named reason; no silent partial import. An all-NoData or entirely redundant batch reports no change. Import history records the sources, ordering, replacement choice, and resulting generation.

Process one bounded set of source blocks at a time, incrementally persisting prepared numeric tiles/COGs, validity, statistics, and provenance. Original hashing/copying is streamed too. Resolve accepted coverage through immutable source/member references and block-level precedence; never rewrite a full dense mosaic when a source changes. Publish the batch through one short catalog transaction after durable staging is complete. Remove fixed file-count/file-byte/dense-union ceilings as capacity policy once their replacement resource gates pass; retain arithmetic, format, disk-space, and bounded-allocation checks.

Keep original files byte-identical in managed library storage. Preparation creates derivatives; no user original or sidecar may be rewritten. Reuse existing mask and numeric semantics, including valid zero/negative values. Initial support remains single-band continuous numeric data. Explicit masks and nonidentity scale/offset must be handled correctly or rejected before mutation; report the qualified support matrix. Do not promise automatic cross-CRS/grid/vertical-datum mosaicking in this delivery: independent datasets may have different supported CRSs, but adding sources to one dataset requires compatible interpretation and aligned grids. Broader reprojection/resampling admission requires its own measured extension.

This is one user batch processed internally in blocks, not a request that users manually split files. Both one large raster and many small rasters are required acceptance cases.

## Architecture, ownership, and recovery

Keep four caller roles: library management, numeric access, processing, and display. Library operations return job/receipt identities; UI never sequences catalog transactions, engine processes, or raster buffers. Numeric reads take an immutable generation plus bounded window/resolution and return physical values with exact validity. Processing owns recipes and persistent results. Display owns derived tile requests, caches, and legends. Configure engines and file access once at composition, not through every UI call.

Use local managed GeoTIFF/COG assets with SQLite metadata. Do not store pixels as individual SQL rows. Numeric windows and display tiles may share source access while retaining separate caches and semantics. Use full-resolution data for analysis, appropriate overviews for display, and recorded reduction rules for previews/statistics. Loading a dataset must not precompute an entire world tile pyramid before it becomes usable.

The library owner survives panel changes and Design navigation. It owns job cancellation, bounded queues, file handles, engine workers/processes, and shutdown settlement. The existing native executor remains the only admission path for native heavy work. Display decoding must run off the UI thread when using WASM. Introduce a worker only with explicit creation, request-generation fencing, cancellation, partial-init cleanup, and teardown ownership.

One import may mutate a destination dataset at a time; queue or reject with a clear busy status. Reads use immutable heads. An import records its starting head and rechecks before publication; if it has changed, fail with retry guidance rather than silently applying replacement against different data. Jobs must release catalog locks during compute/I/O.

On source changes, preserve existing automatic dependency-aware slope refresh. Keep the last complete result visible, marked refreshing/stale, until replacement succeeds. A failed/cancelled refresh keeps that prior result and its provenance. Results from stale input/definition generations never publish; coalesce refreshes to the latest generation. Hidden inputs/results remain eligible for refresh. Display pan/zoom/style changes do not enqueue scientific work.

Disk exhaustion, malformed input, missing engine, cancellation, or worker failure must leave the prior dataset head usable. Publication acknowledgment follows durable data and catalog state. On restart, reconcile staged/unpublished jobs idempotently; preserve committed heads and mark interrupted work explicitly. Remove abandoned temporary outputs, never automatically delete authoritative originals/history. Reproducible display caches may be evicted under a bounded LRU policy. Preserve scoped asset serving; raw paths and credentials do not enter `.canopi` or diagnostics.

The Shared Spatial Workspace continues to own MapLibre, camera, shared Pixi context, layer ordering, and Canvas2D fallback. Raster adapters only contribute stable descriptors/data. A failed raster contribution reports dataset-local status and leaves editing usable when cleanup succeeds; failed resource cleanup follows the existing terminal map failure path. Cancel stale tile requests on generation replacement or teardown. Cache keys include immutable content/interpretation/generation and display style, not just dataset names.

### Migration and compatibility

Preserve library IDs, original hashes, history, analysis definitions, and Design references. Keep physical legacy directory/catalog names initially to reduce migration risk. Add versioned prepared-cache artifacts rather than destructively converting originals. Existing ready generations remain readable during rollout; prepare a replacement generation lazily or explicitly, never by mixing old/new reads inside a result.

If catalog changes are necessary, use the existing migration owner with backup and transactional schema changes; old binaries must reject unsupported schemas rather than reinterpret them. Abort interrupted legacy awaiting-review jobs without applying them, retain their original source bytes, and offer reimport through the new simple flow. No old preview job is silently approved. A failed qualification retains the existing application path; do not ship an automatic fallback that reintroduces unbounded allocations for large inputs.

## Web Location and basemaps

Adapt the shared placement transaction to a browser-safe Location surface. Latitude/longitude entry validates the finite Mercator-bounded domain from ADR 0025; map click or current-center placement produces the same candidate frame. Confirm commits one undoable edit, Cancel/Escape/unmount aborts it, and Design replacement fences late map events. Preserve altitude metadata and north bearing; no automatic elevation lookup or new altitude editor is included. Coordinate entry remains usable when the map cannot load. Geographic backgrounds may load in the explicitly opened Location editor, while provisional/hidden Canvas basemaps retain their no-remote-request rules.

Keep Desktop's address-search capability at its edition adapter. Browser production imports must not reach native geocoding or Tauri. Web draft/save/export/open must retain confirmed placement and dataset references. This phase requires an explicit replacement ADR for the relevant scope in ADRs 0013 and 0016; it does not override the static deployment or no-PWA contracts.

Share street/satellite visibility, opacity, attribution, and provider availability between Location and Canvas without introducing another simultaneous workspace camera. Switching basemaps must preserve the scene runtime, raster layers, selection, and camera. Keep settings ownership for existing basemap preferences. Provider keys stay device-local and out of Designs/exports/logs; public browser credentials require provider-supported restrictions and are not secrets merely because they are in frontend configuration.

**Decision S1 — Google satellite access (user-selected):** match GeoLibre's dual-path behavior in Desktop and Web. Selecting Google Satellite without a configured Google Maps API key uses `https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}` as a MapLibre raster source. In the basemap controls, show the non-blocking message **“Enter a Google Maps API key to load the official Google tiles.”** Provide a labelled key input and a link to Google's key setup documentation. Do not require a key to select or display the keyless layer, and do not describe this endpoint as an authorized free third-party service. Authorization for free third-party use and service guarantees have not been established; this is a recorded limitation, not an unresolved product choice.

When the user supplies a key, request an official Map Tiles API satellite session and load `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={session}&key={api-key}`. Keep the key in device-local settings, never in a Design, export, telemetry, or error text. Mask the input. Clearing the key explicitly returns to the keyless path. Retain existing MapTiler support as a separate provider option; existing saved provider choices must not silently change.

The basemap adapter owns official session acquisition, expiration/renewal, attribution, request cancellation, and generation fencing. Key changes and provider switches invalidate pending session work; late responses cannot replace the currently selected source. An invalid key or official service/quota failure shows an actionable provider error and allows editing/removing the key; do not silently downgrade configured official access to keyless access. Keyless failures also show unavailable imagery with the key-entry action. Neither failure blocks canvas editing, raster processing, or Location coordinate entry. Source replacement preserves camera, scene, data layers, and opacity. Validate current official session/attribution requirements during provider implementation; this decision does not assert billing-free official usage.

References: [GeoLibre basemap catalog](https://github.com/opengeos/maplibre-gl-basemap-control/blob/main/src/lib/core/catalog.ts), [endpoint selection](https://github.com/opengeos/maplibre-gl-basemap-control/blob/main/src/lib/core/BasemapControl.ts), [Google policies](https://developers.google.com/maps/documentation/tile/policies). Provider outages omit only that background with an honest unavailable state; never label street imagery as satellite. No bulk download, persistent offline imagery cache, or print use is authorized by interactive availability.

## Representative evidence and capacity acceptance

Originals are read-only and stay outside Git. Inspected with `gdalinfo -json`; SHA-256 streamed without mutation. Only small synthetic fixtures and reproducible manifests belong in the repository.

| Fixture | Verified facts and role |
| --- | --- |
| `~/Downloads/la magnerie/LHD_FXX_0445_6806_MNH_O_0M50_LAMB93_IGN69` | 16,000,513 bytes; GTiff, 2000×2000 Float32, 0.5 m pixels, NoData −9999, strip layout and no overviews. SHA-256 `c4e2938e8a166b723f25c7ac3f5a64d21555671b758fb3b40b71daac45a8bc28`. Numeric height import/display, not ground slope. |
| `~/Downloads/la magnerie/` | 12 inspected MNH tiles, X 0445–0448 and Y 6806–6808; total 192,006,156 bytes; aligned 8000×6000 union, 48 million cells. Must import as one batch and reopen/display successfully. |
| `~/Downloads/LHD_FXX_0445_6806_MNT_O_0M50_LAMB93_IGN69/LHD_FXX_0445_6806_MNT_O_0M50_LAMB93_IGN69` | 16,000,513 bytes; matching 2000×2000 grid/type/NoData. SHA-256 `7b8773046c27d3f42d9f6548c7adc24fca810de19ea6ed5f49b29302e22076ad`. Ground-elevation slope fixture. |

Both named files have an imperfect embedded WKT declaring EPSG:2154 with incomplete datum detail. Accompanying export JSON identifies LAMB93/IGN69, acquisition 2025-02-15, edition 2025-07-23. Qualification must verify CRS interpretation numerically; do not globally trust filename text or silently substitute a datum. Capture the sidecar identity and engine interpretation in evidence.

Build a separate disposable 20,000×20,000 Float32 analytical-plane GeoTIFF (400 million cells, approximately 1.6 GB uncompressed) with independently known slope, holes and explicit NoData. It tests a single file above the current byte/cell ceilings; do not resample user data and describe that as a new real survey. Also test adjacent/separated synthetic tiles so gaps do not allocate full bounding rectangles. No genuine drone survey is presently supplied; drone-specific format/accuracy claims remain unqualified.

Proposed release gates for bounded processing: the supplied 48-million-cell batch and the synthetic 400-million-cell single file complete import/reopen; the latter also completes slope without a whole-grid allocation. Use an isolated profile on a recorded machine with at least 8 GiB RAM and sufficient temporary disk. Limit combined raster-job worker/process working memory to 1 GiB, excluding the measured idle app baseline; bound concurrent reads and record peak RSS, Wasm heap, temporary bytes, and queue depth. If library behavior cannot meet this budget, stop at the qualification gate and revise the engine plan explicitly. Never raise the old ceilings alone and call the work complete.

Measure one cold run and three warm runs per real display fixture; record median and p95 tile latency plus frame/long-task observations during navigation. Existing 55 fps and tile-latency aspirations in the earlier plan remain diagnostic until representative hardware is accepted; they are not measured promises. Memory bounds, responsive cancellation, correctness, and no UI-thread raster compute above 50 ms are release gates. Cancellation should stop scheduling immediately and settle owned work within 5 seconds in the fixture tests; test stalled subprocess/worker termination too. Record machine, OS/WebView, dependency artifacts, resolutions, raw measurements, and failures. Test timing does not replace lifecycle assertions.

## Acceptance examples

| Starting state and action | Observable result |
| --- | --- |
| Empty library; import supplied MNH batch | One height dataset with 48-million-cell extent, preserved valid samples, usable tiled display, restart reuse; no preview or fixed dense-grid rejection |
| Existing value 5; incoming valid 9, replacement off/on | Value stays 5 / becomes 9; unaffected regions remain identical |
| Existing valid pixel; incoming NoData | Existing pixel survives either choice; valid zero and negative inputs remain data |
| Batch contains corrupt or incompatible source | Named error; no partial head publication; prior Design/library usable |
| Import interrupted during prepare or publication | No acknowledged partial generation; restart recovery converges; originals unchanged |
| Source head changes before a job publishes | Stale job cannot overwrite newer state; clear retry/refresh outcome |
| Hidden ground dataset; run slope | Compatible input remains selectable; visible result independent of source; saved result reused after restart |
| Select MNH for slope | Rejected as incompatible measurement, not merely accepted because it is TIFF |
| Plane fixture crosses processing blocks | Correct interior and seam values/validity against independent expectations; no artificial tile-edge gaps |
| Pan, restyle, hide result | No recomputation or numeric change; hidden result stops unnecessary display reads |
| Library rename, then save/reopen Design | Stable references and results; rename alone does not dirty Design |
| Remove reference, then undo | Presentation restored; library bytes/results never deleted |
| Switch Design while import/analysis completes | Library result may publish; no layer is attached to the wrong session |
| Web coordinate placement then undo/export/reopen | Correct spatial frame and history; local plant coordinates and raster geography unchanged |
| Google Satellite selected with no key | Keyless Google raster source selected; exact non-blocking key prompt visible; attribution retained |
| Google key supplied, changed, or removed | Official satellite session used when configured; stale responses fenced; removing key returns to keyless; camera and other layers preserved |
| Invalid Google key or provider outage | Actionable error, no silent official-to-keyless downgrade, other app features usable; credentials absent from exports/logs |
| Map failure during Web placement | Coordinate input remains usable; no native call; no silent confirmation from camera movement |
| Dataset tile failure or missing reference | Honest dataset-local unavailable state; remaining layers and canvas edits usable |
| Full-opacity geographic layers at DPR 1/2 and nonzero bearing | Grid, plant symbols, zones, guides and interaction stay visible above them; geographic rows never become drawing targets |

Expected outcomes derive from user-approved simple import and edition scope, ADR 0025, and retained library/document invariants. Deliberately replace old preview assertions; retain their atomicity, validity, and cancellation coverage through the new interface.

## Ordered execution and exit gates

Execution is serial by default, one responsible implementer with a fresh final review. No subagents are authorized. The integration owner retains responsibility for all shared files, generated contracts, locale batches, gates, and final receipts. The existing LiDAR backlog is reconciled under `canopi-j571`: `canopi-kqpp` qualifies engines, `canopi-jv8a` implements bounded import, `canopi-j8mp` retains workbench/shared-edition integration, and `canopi-5neg` retains deferred analysis expansion. Before claiming implementation, split prototype, Web/provider and final packaged qualification work into bounded children as needed; do not create a competing epic.

| Phase | Outcome, owned surfaces, prerequisites | Exit gate and stop condition |
| --- | --- | --- |
| 1. Qualification | Inspect pinned upstream APIs/licenses; exercise local range/window access, COG preparation, worker lifecycle, CRS and slope against the named fixtures in isolated temporary artifacts. Own qualification harness/evidence only. No production engine switch. | Record exact reusable artifacts, native/WASM execution split, retained GDAL responsibilities, memory/cancellation/numerical results. If APIs require full-file materialization or CRS/validity is wrong, adapt narrowly or reject that component and return for review. This is the first executable slice. |
| 2. Interaction prototype | Gallery-only Data/Analysis/ Layers navigation using production primitives and memory fixtures; simple import form, jobs, compatibility, legends, inspection. No real library mutations. | User accepts desktop/narrow layouts, keyboard/focus, empty/error/progress states, long translations, and independence of data/presentation. Prototype acceptance gates production UI. |
| 3. Bounded library and import | Native library/numeric resolver, managed tiled assets, cancellation, transactional generations, migration. Preserve identifiers and history. Contract and all locale changes have one writer. Requires phase 1. | Real 48-million-cell batch and synthetic single-file gates, overlap/mask/no-op/order tests, crash/disk/cancel cases, legacy library reopening and Web presentation round-trip. No full dense-grid path for newly admitted large inputs. |
| 4. Complete Data/Analysis/Layers path | Replace dock management; bind slope registry/jobs and on-demand raster display through existing shared map ownership. Requires phases 2–3. | Import → slope → hide source/show result → restart and new-Design reuse; pixel inspection and styling correctness; no map/context leak; full shared-edition/native gates. Remove obsolete preview UI/IPC/cache authorization paths only after replacement coverage passes. |
| 5. Web Location/shared basemaps | Browser-safe placement view, coordinate controls, capability injection, persisted preferences and attribution. Requires phase 4 integration for combined review, although read-only design can start earlier. Implement the keyless/default and keyed/official paths specified by S1. | Both editions pass placement/history/map-failure tests and Web packaging boundary checks. Reconcile ADRs 0013/0016 and current guides. Verify both S1 access paths, key persistence/redaction, source-switch races, attribution, and provider failures. |
| 6. Integration and packaged qualification | One owner combines all accepted changes on latest main; qualified Desktop platform artifacts, private fixture receipts, docs and backlog reconciliation. | Required gates and native WebView/platform matrix pass; record unavailable platforms as release blockers for those platforms. No public release without separate authorization. |

Hydrology/canopy/globe follow-ups start only after the core path passes. Hydrology needs explicit conditioning, upstream-domain completeness, nonlocal dependency handling and independent numerical evidence; canopy needs declared input semantics; globe needs a renderer/capability decision and preserves local editing authority. Do not elaborate or implement those contracts past their own decision gates.

## Verification, documentation, and handoff

Use existing meaningful coverage in `desktop/web/src/__tests__/lidar-actions.test.ts`, `lidar-library-store.test.ts`, `lidar-import-progress.test.tsx`, `lidar-map-presentation.test.ts`, `lidar-camera-navigation.test.ts`, `design-edit-lidar.test.ts`, `location-workbench.test.tsx`, `location-route-boundary.test.ts`, and `workspace-composition.test.tsx`. Update behavior assertions instead of preserving obsolete UI flows or weakening architecture guards. Native tests live with the LiDAR modules; extend `e2e.rs` to accept an explicit fixture path rather than silently choosing another Downloads tile.

Apply the [repository quality gates](../../AGENTS.md#quality-gates) for this mixed Rust/frontend/persistence/shared-contract change: Rust formatting, strict Clippy, workspace check/tests, native command policy, bindings regeneration/drift checks, TypeScript, full Vitest, gallery check, both edition builds, and documentation validation. The [edition guide](../agent/edition-development.md#verification-workflow) owns runnable commands and environment boundaries. Qualification fixture commands and measured results must be added with the phase-1 harness, not invented before it exists.

Use `npm run dev:ui` for live prototype/production review, then isolated real Desktop and Web sessions as described in the edition guide. Browser/jsdom success does not establish native file access, WebKit behavior, or packaged WASM loading. Qualify Linux, Windows, and macOS before claiming support there. Pin/bundle required offline processing assets and test worker/CSP/asset paths without network; a CDN-only successful development run is insufficient.

At implementation, update `CONTEXT.md`, the dock design contract, LiDAR/MapLibre/edition/build-release/document-format guides, and the old LiDAR design's current-guidance/status links. The foundation record already retires preview/region-choice and no-pixel-inspection as future requirements; replace current operating guidance only when their implementation changes. Keep scientific validity, independent visibility, immutable publication, and history requirements. Existing Web map-scope ADR descriptions contain historical implementation statements; replace their scope through a linked decision rather than treating those statements as current behavior. Do not change operating guidance merely because this proposal exists.

Use the [issue workflow](../workflow/issue-tracker.md) and [delivery contract](../workflow/delivery.md). At handoff, attach fixture identities, numeric/resource measurements, exact validation results, upstream artifact pins, and unavailable platform evidence to the normal bead/commit receipt. No implementation or new issue creation is authorized by this proposal.

## Open gates and plan audit

S1 is resolved by the explicit user choice above; no satellite-provider product decision remains open. Phase 1 is a mandatory feasibility gate: no production rewrite should assume the inspected WASM APIs meet large-local-raster, numeric, or packaged-platform requirements. Phase 2 requires the already-agreed UI prototype acceptance. Larger real drone datasets and packaged-platform measurements are unavailable today; synthetic scale tests cannot replace those claims.
