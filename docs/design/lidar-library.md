# LiDAR layers and local agroecological analysis — implementation plan

Status: **foundation implemented and Linux-qualified; later slices remain tracked**. Updated 2026-09-15. Implementation beads: `canopi-j571`, foundation audit `canopi-cldf`. See the [foundation review and implementation report](lidar-foundation-review.md) and [LiDAR agroecology evidence](lidar-agroecology/report.md).

For v2.0.0 spatial behavior, the [unified workspace implementation plan](geolibre-spatial-review.md) and active `canopi-ltck` epic own the required Design Spatial Frame, shared camera/render lifecycle, v2 document admission, placement and navigation. That clean v2 contract supersedes compatibility requirements in this plan for those surfaces. This document continues to own raster import, coverage, library persistence and scientific analysis. LiDAR contributions enter the production Shared Spatial Workspace above the basemap and below geographic references, grid, Design objects and interaction overlays; camera movement never changes numeric analysis.

This is the single implementation authority for the feature. Historical alternatives and review notes have been removed. The coding agent must implement the slices in order, keep the bead current, and create follow-up beads instead of expanding a slice silently.

## 1. Product outcome and fixed decisions

Canopi behaves like a local map application for numeric LiDAR rasters. A user creates a named LiDAR layer, assigns one measurement kind, adds one or more compatible TIFF files, and sees their accepted valid coverage as a seamless background. The user can apply compatible agroecological analyses to that layer. Numeric results are persisted and rendered efficiently without recomputing on pan, zoom, restart, or use from another Design.

The primary workflow uses user-owned drone-derived TIFFs and runs locally. Files are never uploaded implicitly. IGN MNT/MNS/MNH data are initial POC fixtures and may later provide optional context; Canopi does not mirror or host the national IGN archive.

The qualified foundation currently admits a deliberately narrow subset: north-up, single-band numeric GeoTIFF sources with identity scale/offset, declared NoData instead of a dataset mask, compatible metre units, and grids aligned to the layer. It caps one source at 512 MiB, one import at 16 files/1 GiB, and every dense working grid at 25 million cells. These limits prevent unbounded allocation while `canopi-kqpp` owns out-of-core processing, genuine drone-scale evidence, disk quotas, and packaged-OS qualification.

Fixed decisions:

- A **LiDAR source layer** has a stable ID, editable name, and exactly one immutable measurement definition. Multiple layers may use the same kind, such as “Drone ground” and “IGN ground”. They remain independent.
- A layer contains any number of accepted compatible TIFF sources. Coverage is the union of valid accepted pixels, not file rectangles.
- Import targets one layer. Overlap decisions apply only within that destination layer; overlap with another layer never overwrites it.
- Users explicitly choose an analysis for one source layer. Each application creates a persistent **analysis layer** tied to the source layer and recipe.
- Selected analyses automatically regenerate after accepted source changes. Analysis covers the source layer’s complete accepted coverage, using a larger processing domain when an algorithm requires it.
- Source and analysis visibility are independent. An analysis can remain visible and usable while its source layer is hidden. Hiding a source does not cancel, invalidate, hide, or exclude it from analysis.
- Multiple source and analysis layers can be visible concurrently and reordered within the LiDAR background band.
- Shared library mutations do not dirty a Design. A `.canopi` document stores ordered layer/result references and presentation settings only.
- Passive LiDAR read/render failures silently omit the affected contribution while the rest of the app works. An explicitly requested import or analysis reports its direct outcome.
- Coverage fit is an explicit Layers action when accepted bounds exist. There is no automatic recentering, revision chooser, file-by-file display selector, point-inspection tool, reopening notice, relink prompt, or automatic “newest wins” replacement.

Required draw order, back to front:

`basemap → ordered LiDAR source and analysis layers → canvas grid → all Design objects and interaction overlays`

At 100% LiDAR opacity, grid, zones, plants, annotations, Measurement Guides and selection remain visible and interactive. LiDAR layers have no Scene hit target and are not draggable Design objects.

## 2. Domain model and persistence

Use a dedicated `lidar-library.sqlite`, managed immutable raster assets, and a separate bounded display cache. Do not store one row per pixel, put rasters in `.canopi`, or physically rewrite a whole mosaic when one source changes.

### Library entities

- **Source asset:** immutable imported bytes identified by SHA-256, plus original filename and sidecars. Exact byte reimports deduplicate. Copy accepted originals into managed app data so Downloads can move or disappear.
- **Interpretation:** selected band, measurement kind, numeric scale/offset, units, horizontal CRS, vertical reference, acquisition provenance, NoData and validity-mask rules. Correcting interpretation creates a new identity.
- **Source layer:** stable ID, editable name, immutable measurement definition, and active immutable generation. Rename changes no hashes and invalidates no results.
- **Acceptance region:** exact valid geographic pixels from an interpretation admitted as uncovered additions or explicit overlap replacements. Rejected areas remain excluded after restart, cache rebuild, and reimport.
- **Layer generation:** immutable snapshot resolving effective source provenance for every accepted valid region. A short catalogue transaction advances the active head.
- **Analysis definition:** stable result ID, source-layer ID, versioned analysis kind, parameters, processing resolution, output meaning and display defaults.
- **Analysis result generation:** immutable output associated with the exact source generation, recipe/engine versions, domain/grid, conditioning operations, quality masks and provenance. Publication atomically advances the result head.
- **Design presentation entry:** reference to a source layer or analysis layer plus independent visibility, opacity, style and order. References survive global source-layer rename.

Suggested tables: `lidar_sources`, `lidar_interpretations`, `lidar_source_layers`, `lidar_source_footprints` with R-tree, `lidar_layer_generations`, `lidar_generation_members`, `lidar_acceptance_regions`, `lidar_import_jobs`, `lidar_analysis_definitions`, `lidar_analysis_jobs`, `lidar_analysis_generations`, and dependency records. Large exact masks and numeric results may be content-addressed files referenced by the catalogue.

Physical ownership:

| Store | Contents |
| --- | --- |
| `lidar-library.sqlite` | Definitions, spatial index, generations, decisions, jobs, dependencies, manifests and recovery journal |
| `lidar/sources/<sha256>/` | Immutable originals, sidecars and recovery manifest |
| `lidar/prepared/<interpretation-hash>/<pipeline>/` | Lossless tiled numeric COGs, masks and overviews when preparation is required |
| `lidar/analysis/<result-id>/<generation>/` | Numeric result rasters/vectors, quality masks and manifest |
| `lidar-display-cache.sqlite` | Bounded reproducible display tiles only |
| `.canopi` | Ordered presentation entries and per-entry display settings; no bytes, paths or source generations |

The document contract should use an additive optional field similar to:

```text
lidar: {
  schema_version,
  entries: [
    { kind: "source" | "analysis", id, visible, opacity, order, style }
  ]
}
```

Persist source/analysis references even when unavailable. Web Edition initially preserves unknown entries without rendering them. Source and result visibility are separate values. Renaming a library layer does not dirty Designs; presentation edits flow through Design Edit and participate in save/autosave/discard.

## 3. Raster admission and partial coverage

Accept numeric GeoTIFFs based on content, including files without `.tif` extensions. Use GDAL driver detection and retain original bytes/WKT. A TIFF is not assumed to be elevation: the user chooses or confirms the destination layer and band interpretation before publication.

Initial measurement kinds:

| Kind | Meaning | Compatible initial analyses |
| --- | --- | --- |
| Ground elevation (MNT/DTM) | Bare-earth elevation | Slope, aspect, terrain relief, flow concentration, contributing area, wetness-potential experiment |
| Surface elevation (MNS/DSM) | Top surface including vegetation/buildings | Surface display; obstruction/shade deferred |
| Above-ground height (MNH) | Height relative to compatible terrain | Height structure; never automatically “tree height” |
| Other continuous numeric | User-described value and units | Numeric color display only until a capability is explicitly registered |

Measurement kind, units and reference establish capability; layer name, filename and provider do not. A source may join a layer only after numeric representation, CRS, vertical reference, units and meaning are compatible or transformed by a recorded supported operation. Never silently shift elevations to force surveys to join.

### Validity rules

Build an explicit binary valid-data mask before overlap classification, preparation, analysis, or display. Apply validity in this order: GDAL valid-data/mask band and alpha where semantically valid, declared NoData comparison in raw/scaled value space as specified by the driver, and non-finite rejection. Valid zero and negative values remain data. Do not infer emptiness from a background color, bounding rectangle, convex hull, or value `0`.

Masks may be ragged, concave, rotated, contain holes or thin strips, and have disconnected islands. Store exact masks at analysis resolution or a lossless equivalent; use polygon envelopes/R-tree only for candidate lookup. Resampling must combine values and validity without allowing invalid pixels to bleed into valid output.

For every incoming valid pixel within the destination layer, classify it as:

- **Uncovered:** no accepted valid value exists; selected by default for addition.
- **Overlap:** an accepted valid value exists; keep existing by default unless the user explicitly approves replacement.
- **Invalid/empty:** contributes nothing and cannot erase accepted coverage.

Import review shows synchronized Before/After at a fixed comparison style. Users can accept uncovered regions and overlap regions independently, including separate disconnected regions. Apply publishes only selected valid regions; Cancel/Escape publishes nothing. If the layer head changes while review is open, recompute the plan or return a stale-review outcome. A batch decision applies atomically.

Deleting/undoing an accepted import publishes a new generation; immutable history remains until explicit cleanup. Never purge authoritative originals automatically. Missing or corrupt sources leave unaffected layers usable.

## 4. Layers UI and interaction

Use the existing Layers dock as the primary surface, following the project’s compact ruled-row and progressive-disclosure patterns.

The LiDAR section lists source layers in user-defined display order. Each source row has visibility, name, kind, opacity/style entry point and an action menu: Add TIFFs, Analyse, Rename, History, Delete. Create layer asks for name and measurement kind; name is editable later, kind is not. Deleting a layer requires an impact summary for its analysis layers and saved Design references.

Analysis layers appear indented below their source for organization, with their own visibility, opacity/style, status and action menu. The source group may collapse without changing visibility. Hiding or collapsing the source never changes child result visibility. Results remain renderable from stored outputs even when the source row is hidden.

“Analyse” opens compatible options for that layer. Initial choices:

- Ground elevation: Slope, Aspect, Potential flow concentration, Contributing area, Topographic wetness potential (experimental).
- Above-ground height: Height structure.
- Surface/other numeric: no scientific analysis until a registered capability exists.

The apply surface shows the result name, fixed whole-layer coverage, analysis resolution/default parameters, estimated work/disk where available, and a concise scientific interpretation. Apply creates the analysis definition and job. Users may cancel work; completed prior result remains until a replacement publishes. Do not expose raw engine flags in the primary flow.

Result states are `preparing`, `ready`, `refreshing`, `incomplete`, and `failed`. `refreshing` continues showing the last complete result with its prior provenance until atomic replacement. `incomplete` must distinguish unknown areas from low/zero measured values. An explicit analysis failure is local to its result row; it does not block Design editing. Passive rendering failure remains silent.

Selection, visibility, opacity, order, and style do not start scientific recomputation. A selected analysis refreshes automatically after a relevant accepted source-layer generation changes, even when source or result is hidden. Deleting an analysis removes its definition after confirmation; cache cleanup may follow asynchronously.

## 5. Analysis semantics and lifecycle

Analysis operates on the source layer’s complete accepted valid coverage, not the viewport or current Design bounds. Another source layer is never borrowed implicitly. A future explicit multi-input analysis must declare every input layer and compatibility rule.

Viewport zoom controls display resolution only. Analysis uses the persisted recipe resolution. Cache numeric authority separately from rendered colors so legends and styles can change without recomputation.

Initial outputs:

| Analysis | Output | Dependency behavior |
| --- | --- | --- |
| Slope | Degrees or percent, selected in definition | Neighborhood halo around changed coverage |
| Aspect | Compass direction with flat/unknown mask | Neighborhood halo |
| Potential flow concentration | Terrain-based routing indicator | Recompute affected processing domain; upstream changes may affect all downstream cells |
| Contributing area | Physical m²/ha, never raw cell count in UI | Same nonlocal hydrological dependency |
| Topographic wetness potential | Versioned terrain indicator, explicitly experimental | Same routing dependency; not measured moisture |
| Height structure | Above-ground height distribution/background | Local dependency on admitted height pixels |

Terrain conditioning produces a derived analysis surface and records filled/breached cells; it never edits source elevation. Do not flatten every depression. NoData holes remain unknown unless a documented supported fill is chosen. Hydrology must not independently solve display tiles and stitch the answers.

For water analyses, complete rectangular coverage does not prove an adequate catchment. Mark cells whose accumulation is likely underestimated because the accepted layer ends upstream or contains holes. The result may be incomplete while still rendering trustworthy areas. Do not report discharge, flood depth, soil moisture percentage, groundwater depth, infiltration, or pond capacity from terrain alone.

Chosen analyses refresh through dependency-aware invalidation:

1. Publish a new source-layer generation.
2. Mark dependent result heads stale internally and enqueue one debounced refresh per definition.
3. Resolve an immutable input snapshot and calculate without holding catalogue locks.
4. Persist numeric output, quality mask and manifest in staging.
5. Atomically publish only if the expected source/definition heads still match; otherwise discard/reuse safe artifacts and enqueue current work.
6. Notify presentation readers without dirtying Designs.

Jobs are cancellable, bounded by RAM/thread/temp-disk budgets, and scheduled so interactive tile reads retain capacity. Crash recovery distinguishes unpublished staging from acknowledged results. Never mix generations inside one result.

Use a pinned established engine behind a narrow adapter; evaluate GDAL plus GRASS for the POC. Do not implement a new hydrology engine. The external analysis-module interface should stay small:

```text
createAnalysis(layerId, kind, parameters) -> analysisId + jobReceipt
cancelAnalysisJob(jobId) -> settlement
readAnalysisStatus(analysisId) -> status + currentResultMetadata
deleteAnalysis(analysisId) -> impactReceipt
```

Layer/import interfaces likewise return opaque review/job identities and receipts. UI callers do not orchestrate SQL, GDAL, masks, engine processes, cache publication, or recovery. Configure adapters once at the application composition seam. Heavy local work uses the Native Operation Executor; a child process, if chosen, has one lifecycle owner and bounded protocol.

## 6. IGN POC, implementation slices, and gates

### IGN fixture

Begin with the supplied `0446_6807` MNT/MNS/MNH trio. Acquire the eight neighboring MNT tiles at X `0445–0447`, Y `6806–6808` through a verified public IGN route, retaining URLs, dates, hashes and sidecars. Keep large rasters outside Git and `.canopi`; commit only manifests and small synthetic fixtures.

Nine sample-format MNT tiles are approximately 144 MB, including 128 MB new data. The 3×3 km window tests cross-tile behavior but does not guarantee a complete upstream catchment. Compare central-tile and expanded-domain results, expand only when diagnostics justify it and stop with an incomplete result at the agreed resource ceiling.

The POC must use the generic import and analysis modules, not an IGN-only path. Follow with synthetic arbitrary filenames, partial masks, holes, rotated grids and alignment faults, then at least one genuine drone-derived DTM with survey/export metadata. A 1 km² Float32 raster at 5 cm contains 400 million cells and 1.6 GB before masks/working arrays; benchmark rather than assuming IGN-scale behavior generalizes.

### Ordered slices

| Slice | Required outcome |
| --- | --- |
| 1. Packaged vertical slice | One named ground layer; real TIFF import/review/publication; one persisted slope result; source hidden while result remains visible; restart reuse; real tile rendering; cancellation and native engine packaging on development OS |
| 2. Durable layer library | Dedicated catalogue migrations, managed originals, preparation, R-tree, exact masks, generation publication/recovery, create/rename/delete/history, multiple independent same-kind layers |
| 3. Partial coverage and overlap | Arbitrary masks/holes/islands, independent uncovered/replacement decisions, stale reviews, undo, empty TIFF behavior, resampling validity, cross-tile virtual coverage |
| 4. Analysis system | Capability registry, definitions/jobs/results, slope/aspect/height, hydrology reference engine, quality masks, automatic invalidation/refresh and atomic publication |
| 5. Layers and Design integration | Multiple independently ordered/visible source/results, source-hidden/result-visible behavior, Design Edit persistence and Web unknown-field round-trip, correct map stack and interaction |
| 6. Scale and qualification | IGN 3×3 domain, genuine drone fixture, large-grid/resource tests, downstream invalidation, disk quotas, cleanup, packaged supported-OS checks |

### Required tests and acceptance scenarios

- Original extensionless IGN TIFFs and generic filenames use the same admission path.
- Two ground layers overlap without affecting each other; imports replace only within their chosen destination.
- Rename preserves layer ID, analyses, Design references and caches.
- Partially empty rasters, NoData holes, concave/disconnected coverage, valid zero/negative values and an entirely empty raster behave correctly.
- Before/After decisions survive restart/reimport/cache rebuild; rejected and invalid pixels never overwrite accepted values.
- Multiple source/result layers render concurrently in saved order. A visible analysis with hidden source survives save/reopen and new-Design reuse.
- Hiding a source does not hide/cancel/invalidate its analysis; hiding a result avoids display reads but does not delete output.
- Selected analyses refresh after accepted changes even while hidden. Local, halo and downstream invalidation match each algorithm.
- Pan/zoom never changes numeric answers or starts analysis. Reads are limited to visible tiles/appropriate overviews.
- Analytic slope/flat/convergent/divergent/sink fixtures and an independent pinned engine establish numerical correctness; plausible screenshots are insufficient.
- Missing upstream coverage and internal holes propagate unknown/incomplete quality instead of zero or confident dry values.
- Interrupted imports and result publication recover idempotently. Stale completion never replaces a newer result.
- Normal editing remains responsive during import/analysis; cancellation releases workers/files. No catalogue lock is held during raster computation.
- At full opacity and DPR 1/2 with nonzero bearing, basemap is below every LiDAR entry and grid/zones/plants/guides/selection remain above and interactive.

Frontend changes require focused Vitest, `npx tsc --noEmit`, gallery checks and both edition builds for shared composition. Contract changes require bindings regeneration/check. Rust/native changes require fmt, Clippy, workspace check/tests and the native command policy test. Run the full frontend suite for shared canvas/map behavior. Validate packaged engine behavior on every supported Desktop OS before release.

Performance gates must name hardware and dataset: responsive ≥55 fps pan/zoom during warm display, no raster task on the main thread over 50 ms, warm prepared display tile p95 <100 ms, cold prepared tile p95 <500 ms, bounded queue/RAM/temp disk for rasters larger than RAM, and a 100,000-footprint catalogue query benchmark. Initial preparation/analysis has separate progress, cancel and measured duration; it is excluded from tile latency.

## 7. Repository seams and documentation duties

Implementation should concentrate complexity behind four deep modules:

| Caller role | Module responsibility |
| --- | --- |
| Library management | Create/rename/delete layers, stage/apply imports, history and receipts |
| Analysis management | Capability discovery, definition/job lifecycle, dependency invalidation and result status |
| Numeric resolver | Immutable generation windows, exact masks, provenance and analysis-domain reads |
| Presentation | Ordered source/result snapshots, display tile lifecycle and legends |

Current seams: native work under `desktop/src/services/lidar/`; frontend orchestration under `desktop/web/src/app/lidar/`; document preferences through `app/design-edit/`; rendering contributions through `app/canvas-map-surface/` and the low-level MapLibre adapters. Controller/action modules remain leaves. The Shared Spatial Workspace owns map/camera/render lifetime; the LiDAR subsystem owns files, jobs, engines, numeric results and caches.

When implementing, update `docs/agent/maplibre.md`, `docs/agent/document-lifecycle.md`, `docs/agent/build-release.md`, `.interface-design/patterns/dock-panels.md`, and domain vocabulary only when the corresponding behavior lands. Remove the temporary gallery prototype once production reproduces its accepted behaviors; until then it remains historical interaction evidence and does not define the new multi-layer analysis UI.

## 8. Measured evidence and scientific limits

The supplied MNT/MNS/MNH each contain a 2000×2000 Float32 grid at 0.5 m over 1 km². The MNH equals MNS−MNT at all four million cells; it is not independent information for this trio. See the [reproducible evidence](lidar-agroecology/input-evidence.json) and [inspection script](lidar-agroecology/inspect-inputs.py).

The files are strip-organized with no overviews and use an imperfect embedded CRS WKT. Their sidecars indicate Lambert-93/IGN69, acquisition 2025-02-15 and edition 2025-07-23. Admission must validate/record the interpretation rather than trust the filename or WKT name. Pixel spacing is not an accuracy guarantee.

The scientific report defines which outputs are geometry, indicators or simulations. SoilGrids is optional coarse context and is not required for the initial analyses. Do not label MNH as canopy, topographic wetness as measured moisture, contributing area as discharge, or LiDAR-derived terrain as field-validated drainage.

The current foundation validates real extensionless IGN MNT import, decision-specific shared-scale previews, atomic publication, decoded display pixels, one independently known slope, restart reuse, same-file replacement, targeted undo, deletion, and Design presentation round-trip on Linux with GDAL 3.8.4. It does not establish packaged Windows/macOS support, genuine drone-scale performance, broader numeric interpretation, hydrology, or the later analysis catalogue. Those claims remain with the ordered slice beads rather than this qualified result.
