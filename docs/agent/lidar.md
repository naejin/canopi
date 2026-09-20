# LiDAR implementation guide

Use this entry point for raster import, overlap review, the shared library, analysis, or LiDAR presentation. The current foundation admits bounded, north-up, aligned single-band numeric rasters and persisted slope analysis. The [raster rework](../design/raster-data-analysis-rework.md) specifies future bounded import, Data/Analysis workbenches and shared Web maps; it does not change the current workflow until implemented. The [foundation record](../design/lidar-library.md) retains storage and scientific invariants. Consult bd before claiming a slice.

## Accepted direction and current implementation

The user selected [compatibility-first GeoLibre native integration](../design/raster-rework/geolibre-integration-design.md), delivered for independent review under `canopi-jv8a.1` (G1–G5) with the [integration receipt](../design/raster-rework/geolibre-integration-receipt.md). Import extraction and slope result postprocessing now read through the GeoLibre-selected `wbgeotiff` native core behind one private module, `desktop/src/services/lidar/prepared_raster.rs`: it prepares one uncompressed single-band Float32 COG (256×256 blocks, no overviews) with the existing GDAL adapter, then streams it back in at most 1024×1024 windows. Neither path creates a whole-raster buffer, and neither reads a file whole when the controlled layout is unavailable. GDAL remains preparation, CRS, slope and display authority.

Dense composition is deliberately unchanged. `compose_values_cancellable`, `replay_members`, `head_values_on_union` (through `import::raw_f32_bytes`), the `ValidMask::read_from` consumers and display generation still work on full member or head buffers. The 512 MiB/file, 1 GiB/batch, 16-file and 25-million-cell admission limits are unchanged, and this slice does not claim bounded end-to-end import. The next foundation assignment owns review, undo, display, slope input resolution and sparse gaps together before those limits move.

The old Q→production prerequisite is explicitly superseded. The [Q receipt](../design/raster-qualification-q.md), [GeoLibre pattern inventory](../design/raster-rework/geolibre-reuse-inventory.md) and [review/debrief](../design/raster-rework/review-and-debrief.md) retain historical evidence. Q is unqualified and its harness remains frozen: preserve useful regressions and known defects, but do not repair it, relabel records, change old artifact declarations or run it under retired prompts. Desktop completion `f9b5c10c` remains partial; correct pilot cells do not establish safe production lifecycle.

Rust owns native raster work; TypeScript owns any newly required orchestration. No new Python raster tooling or wholesale Python removal. Existing unrelated repository tools remain in use. Large-capacity runs, new UI and other engine work are not authorized by that assignment.

Preserve originals and sidecars; prepare stripped inputs before native tiled reads, and disable auxiliary metadata writes when the input is read-only (`GDAL_PAM_ENABLED NO`). The temporary derivative lives in the job's scratch directory, is removed when its reader drops — before an analysis staging directory becomes a published generation — and never touches originals or accepted generations. Keep zero/negative data, NoData and existing Float32 conversion semantics explicit: `values.raw` stays little-endian Float32, `valid.bin` stays one byte per cell, validity is finite-and-not-NoData, and the source range still includes finite NoData sentinels (`canopi-jv8a.2` tracks that discrepancy). This first migration must not claim the later precision-preserving or fully bounded import contract. Faithful later UI work uses approved HTML revision `0e696722`; material departures require renewed user approval. The [collaboration protocol](../design/raster-rework/collaboration-protocol.md) retains main-agent architecture/review and user courier authority.

| Change | Owner / reference |
| --- | --- |
| Catalogue migrations, generations, footprints, history | `desktop/src/services/lidar/catalogue.rs`, `import.rs`, `mod.rs` |
| Input admission, validity, prepared grids | `desktop/src/services/lidar/probe.rs`, `grid.rs`, `import.rs` |
| Controlled derivative, bounded native window reads | `desktop/src/services/lidar/prepared_raster.rs` |
| Free-space checks before new derivative/output writes | `desktop/src/services/lidar/paths.rs` |
| Streamed 3×3 quality-mask erosion | `desktop/src/services/lidar/grid.rs` (`erode_mask_file`) |
| GDAL lifecycle, bounded native execution, packaged engine | [Build and release: LiDAR](build-release.md#lidar-raster-engine) |
| Library reads, import/review actions, job presentation | `desktop/web/src/app/lidar/`; [dock patterns](../../.interface-design/patterns/dock-panels.md) |
| Design references, persistence, browser preservation | [Design format: LiDAR presentation](document-format.md#lidar-presentation-section) |
| Map band, visibility, coverage navigation, failure cleanup | [MapLibre: LiDAR raster band](maplibre.md#lidar-raster-band) |
| Scientific interpretation and historical qualification | [Foundation receipt](../design/lidar-foundation-review.md), [scientific evidence](../design/lidar-agroecology/report.md) |

The library owns originals, masks, numeric results, jobs and caches; a Design owns only references and presentation. Shared workspace navigation never changes raster geography or scientific results. Use the current map/camera lifecycle rather than introducing a second map owner.

For native library changes, run the focused `services::lidar` tests and repository Rust gates. Tests that need the GDAL tools are ignored by default and run explicitly:

```bash
cargo test -p canopi-desktop services::lidar::prepared_raster -- --ignored
cargo test -p canopi-desktop services::lidar::import::tests -- --ignored
cargo test -p canopi-desktop services::lidar::analysis::tests -- --ignored
```

The real IGN lifecycle command and prerequisites are in the build guide; an unavailable fixture is not a pass. Frontend tests include `lidar-actions`, `lidar-library-store`, `lidar-map-presentation`, `design-edit-lidar`, `lidar-import-progress` and `lidar-camera-navigation` under `desktop/web/src/__tests__/`. Run them from a checkout with a real `desktop/web/node_modules`; a symlinked `node_modules` outside the checkout makes Vite deny worker and asset module IDs, which looks like unrelated PDF/MapLibre failures. Shared contracts require generated-binding checks; shared workspace changes require the edition gates in [AGENTS.md](../../AGENTS.md#quality-gates).
