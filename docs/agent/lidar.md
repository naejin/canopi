# LiDAR implementation guide

Use this entry point for raster import, overlap review, the shared library, analysis, or LiDAR presentation. The current foundation admits bounded, north-up, aligned single-band numeric rasters and persisted slope analysis. The [raster rework](../design/raster-data-analysis-rework.md) specifies future bounded import, Data/Analysis workbenches and shared Web maps; it does not change the current workflow until implemented. The [foundation record](../design/lidar-library.md) retains storage and scientific invariants. Consult bd before claiming a slice.

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
