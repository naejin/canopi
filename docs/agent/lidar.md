# LiDAR implementation guide

Use this entry point for raster import, overlap review, the shared library, analysis, numeric inspection, or LiDAR presentation. The implementation admits bounded, north-up, aligned single-band numeric rasters and persisted slope analysis, and the [raster rework](../design/raster-data-analysis-rework.md) surfaces described below are **implemented**: Data/Analysis/Layers, numeric inspection and shared Web basemaps. What remains is verification, not capability — the [completion receipt](../design/raster-rework/completion-receipt.md) is the authority on what has been observed and what has not. The [foundation record](../design/lidar-library.md) retains storage and scientific invariants. Consult bd before claiming a slice.

## Accepted direction and current assignment

The user selected [ordered COG Data Layers](../design/raster-rework/ordered-cog-design.md): an ordered collection of source COGs, topmost-valid composition shared by display/analysis, whole-layer presentation visibility, and no compulsory merged-source raster for new edits. [ADR 0027](../adr/0027-ordered-cog-data-layers.md) supersedes ADR 0026 for new source composition. The correction at `34e4ded4` is [independently accepted in scope](../design/raster-rework/ordered-cog-review.md#accepted-correction-at-34e4ded4); integration and release remain separate.

The rework under `canopi-j571` continues from candidate `5d0a5e0b` on
`feature/raster-rework-completion`; the accepted foundation stack is integrated
into `main` at `f61f8494`. Data/Analysis/Layers, numeric inspection and Web
Location/shared basemaps already exist in the candidate, but the
[independent review](../design/raster-rework/completion-review-5d0a5e0b.md)
requires R15–R26 repairs and the code is **not** independently accepted. The
[source-import amendment](../design/raster-rework/source-import-design.md) settles
the new bounded source-only route, separate display/exact metadata and removal of
arbitrary input policy ceilings; it describes intended behavior until that route
lands, so read the candidate for current code. The
[contract](../design/raster-rework/completion-design.md) owns the capacity,
execution and review boundaries, and the
[receipt](../design/raster-rework/completion-receipt.md) owns measured evidence.
Do not restate per-round progress here — bd tracks it. Preserve R12–R14's tile
footprint, edit lifetime, traversal and teardown regressions and mounted-map
evidence in the [ordered receipt](../design/raster-rework/ordered-cog-receipt.md).

Implementation inventory. `services/lidar/collection.rs` owns snapshot membership, measurement and Undo/restore history; `generation.rs` owns the ordered resolver (`CollectionReader`) and the preserved-generation reader (`GenerationReader`); `tiles.rs` resolves display reads from the native and reduced windows it actually consumes; `admission.rs` owns the capacity policy (`MAX_IMPORT_PROCESSING_CELLS`, the file and byte ceilings, and `MAX_DENSE_ENVELOPE_CELLS` as the legacy dense guard); `inspection.rs` owns numeric inspection — `resolve_target`, `transform_point` through `gdaltransform`, the north-up half-open `containing_pixel` and `apply_scene_offset`, which inverts the canvas east/north conversion; `analysis.rs` owns slope publication and carries the author's result name through `AnalysisParameters::published_name`; `catalogue.rs` owns the schema, currently **v17**, whose migrations are additive and guarded per column; `mod.rs` exposes `layer_collection`, `layer_history_page`, the awaited edit entries (`apply_move`, `apply_remove`, `apply_undo`, `apply_restore` over `apply_member_edit`) and `settle_layer_edit`; `commands/lidar.rs` carries the ordered commands plus `lidar_sample_pixel` and `lidar_create_analysis`'s `result_name`. On the frontend, `desktop/web/src/app/lidar/` and `components/panels/lidar/` own the Data, Analysis and Layers surfaces, the source list, History, the import route and their request lifetimes; `app/lidar/inspection.ts` owns the inspection session (`beginInspection`, `endInspection`, `interpretOutcome`, `setInspectionPointerHandler`); `maplibre/basemap-bind.ts` is the only place a live map takes its basemap from a provider.

Q is unqualified and frozen. Preserve useful regression tests and [historical evidence](../design/raster-qualification-q.md); do not repair or rerun its retired harness assignments. The [review/debrief](../design/raster-rework/review-and-debrief.md) owns historical outcomes and improvement evidence. GDAL and the pinned native reader remain selected; Rust owns native raster work and TypeScript application orchestration. No new Python raster tooling or wholesale Python removal.

Preserve originals/sidecars, source-specific validity, valid zero/negative values and current Float32 semantics. The candidate still carries its old 24-file/2-GiB/400M input policy and compulsory measurement on the pre-amendment route; replace those only through the source-import amendment's bounded implementation and evidence, never by deleting guards alone. Legacy dense/sparse assets stay readable exactly; never reinterpret masked historical replacement as simple source order. Current code remains the authority for existing behavior; update this guide's implementation inventory and the dock contract when the new route actually lands. The accepted workbench HTML reference `0e696722` is the production UI reference for completion, with ordered-source behavior taking precedence over obsolete replacement controls. [Collaboration](../design/raster-rework/collaboration-protocol.md) retains main-agent review and user courier authority.

| Change | Owner / reference |
| --- | --- |
| Catalogue migrations, generations, footprints, history | `desktop/src/services/lidar/catalogue.rs`, `import.rs`, `mod.rs` |
| Input admission, validity, prepared grids | `desktop/src/services/lidar/probe.rs`, `grid.rs`, `import.rs` |
| GDAL lifecycle, bounded native execution, packaged engine | [Build and release: LiDAR](build-release.md#lidar-raster-engine) |
| Library reads, import/review actions, job presentation | `desktop/web/src/app/lidar/`; [dock patterns](../../.interface-design/patterns/dock-panels.md) |
| Design references, persistence, browser preservation | [Design format: LiDAR presentation](document-format.md#lidar-presentation-section) |
| Map band, visibility, coverage navigation, failure cleanup | [MapLibre: LiDAR raster band](maplibre.md#lidar-raster-band) |
| Scientific interpretation and historical qualification | [Foundation receipt](../design/lidar-foundation-review.md), [scientific evidence](../design/lidar-agroecology/report.md) |

The library owns originals, masks, numeric results, jobs and caches; a Design owns only references and presentation. Shared workspace navigation never changes raster geography or scientific results. Use the current map/camera lifecycle rather than introducing a second map owner.

For native library changes, run the focused `services::lidar` tests and repository Rust gates. The real IGN lifecycle command and prerequisites are in the build guide; an unavailable fixture is not a pass. Frontend tests include `lidar-actions`, `lidar-library-store`, `lidar-map-presentation`, `design-edit-lidar`, and `lidar-camera-navigation` under `desktop/web/src/__tests__/`. Shared contracts require generated-binding checks; shared workspace changes require the edition gates in [AGENTS.md](../../AGENTS.md#quality-gates).
