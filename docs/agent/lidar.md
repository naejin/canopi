# LiDAR implementation guide

Use this entry point for raster import, overlap review, the shared library, analysis, or LiDAR presentation. The current foundation admits bounded, north-up, aligned single-band numeric rasters and persisted slope analysis. The [raster rework](../design/raster-data-analysis-rework.md) specifies future bounded import, Data/Analysis workbenches and shared Web maps; it does not change the current workflow until implemented. The [foundation record](../design/lidar-library.md) retains storage and scientific invariants. Consult bd before claiming a slice.

## Accepted direction and current assignment

The user selected [ordered COG Data Layers](../design/raster-rework/ordered-cog-design.md): an ordered collection of source COGs, topmost-valid composition shared by display/analysis, whole-layer presentation visibility, and no compulsory merged-source raster for new edits. This is accepted direction, not current shipped behavior. The [implementation prompt](../design/raster-rework/ordered-cog-agent-prompt.md) is the sole active assignment on `canopi-jv8a.4`; it owns the permitted existing-dock UI changes and compatibility transition. [ADR 0027](../adr/0027-ordered-cog-data-layers.md) supersedes ADR 0026 for new source composition.

Inspected implementation baseline is `0696bd3d` on `feature/bounded-raster-generations`, retaining accepted native integration `a5fc7d7b`. C1/C2 are independently accepted in safety scope; the entire product is not: Undo left stale presentation and dependent slope. The replacement assignment includes these fixes and settles recomputation after numeric edits/Undo. Neither implementation branch is integrated into this planning checkout. Preserve newer source inventories/evidence when incorporating this design commit; do not overwrite branch-specific history with older descriptions.

Q is unqualified and frozen. Preserve useful regression tests and [historical evidence](../design/raster-qualification-q.md); do not repair or rerun its retired harness assignments. The [review/debrief](../design/raster-rework/review-and-debrief.md) owns historical outcomes and improvement evidence. GDAL and the pinned native reader remain selected; Rust owns native raster work and TypeScript application orchestration. No new Python raster tooling or wholesale Python removal.

Preserve originals/sidecars, source-specific validity, valid zero/negative values and current Float32 semantics. Existing production limits remain unchanged. Legacy dense/sparse assets stay readable exactly; never reinterpret masked historical replacement as simple source order. Current code remains the authority for existing behavior; update this guide's implementation inventory and the dock contract when the new route actually lands. The later workbench HTML reference `0e696722` does not block the explicitly authorized source-list changes in the existing dock. [Collaboration](../design/raster-rework/collaboration-protocol.md) retains main-agent review and user courier authority.

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
