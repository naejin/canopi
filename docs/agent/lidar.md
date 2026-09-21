# LiDAR implementation guide

Use this entry point for raster import, overlap review, the shared library, analysis, or LiDAR presentation. The current foundation admits bounded, north-up, aligned single-band numeric rasters and persisted slope analysis. The [raster rework](../design/raster-data-analysis-rework.md) specifies future bounded import, Data/Analysis workbenches and shared Web maps; it does not change the current workflow until implemented. The [foundation record](../design/lidar-library.md) retains storage and scientific invariants. Consult bd before claiming a slice.

## Accepted direction and current implementation

The user selected [compatibility-first GeoLibre native integration](../design/raster-rework/geolibre-integration-design.md), independently accepted at `a5fc7d7b` on `feature/geolibre-native-raster-integration`, not integrated into this checkout (evidence in the [integration receipt](../design/raster-rework/geolibre-integration-receipt.md); the [review](../design/raster-rework/geolibre-integration-review.md) closes D1/R1). The [bounded-generation design](../design/raster-rework/bounded-generation-design.md) settles sparse generations and bounded review/Apply, undo, display and slope behind the existing UI. Only its B1 foundation is delivered so far — retained/committed COG reads, resolved and 0/1 quality chunk creation, digesting, content-addressed admission, the catalogue v7 index with pre-migration backup, and the ordered-occurrence resolver — and **no production caller uses them yet**; the [receipt](../design/raster-rework/bounded-generation-receipt.md) records that boundary, and production composition, slope and display remain the accepted dense code. GDAL and the pinned native reader remain the selected engines.

Import extraction and slope result postprocessing now read through the GeoLibre-selected `wbgeotiff` native core behind one private module, `desktop/src/services/lidar/prepared_raster.rs`: it prepares one uncompressed single-band Float32 COG (256×256 blocks, no overviews) with the existing GDAL adapter, then streams it back in at most 1024×1024 windows. Neither path creates a whole-raster buffer, and neither reads a file whole when the controlled layout is unavailable. GDAL remains preparation, CRS, slope and display authority.

Dense composition is deliberately unchanged. `compose_values_cancellable`, `replay_members`, `head_values_on_union` (through `import::raw_f32_bytes`), the `ValidMask::read_from` consumers and display generation still work on full member or head buffers. The 512 MiB/file, 1 GiB/batch, 16-file and 25-million-cell admission limits are unchanged, and this slice does not claim bounded end-to-end import. The next foundation assignment owns review, undo, display, slope input resolution and sparse gaps together before those limits move.

The old Q→production prerequisite is explicitly superseded. The [Q receipt](../design/raster-qualification-q.md), [GeoLibre pattern inventory](../design/raster-rework/geolibre-reuse-inventory.md) and [review/debrief](../design/raster-rework/review-and-debrief.md) retain historical evidence. Q is unqualified and its harness remains frozen: preserve useful regressions and known defects, but do not repair it, relabel records, change old artifact declarations or run it under retired prompts. Desktop completion `f9b5c10c` remains partial; correct pilot cells do not establish safe production lifecycle.

The revised next design retains prepared source COGs and uses standard COG chunks for sparse resolved generations; the bespoke raw/mask persistence proposed at `24fd1a56` is withdrawn before implementation. Current accepted code still owns temporary derivatives and deletes them on drop: persistent readers must have separate non-deleting ownership before reuse. Do not describe planned COG persistence or capacity as already shipped. Source-specific validity, composed NaN NoData and separate analysis quality are settled in design §3, not assumed internal-mask support.

Rust owns native raster work; TypeScript owns any newly required orchestration. No new Python raster tooling or wholesale Python removal. Existing unrelated repository tools remain in use. The forwarded bounded-generation assignment authorizes its isolated capacity fixtures after preflight, not new UI or other engines. Production limits move only after its whole-workflow gates pass.

Preserve originals and sidecars; prepare stripped inputs before native tiled reads, and disable auxiliary metadata writes when the input is read-only (`GDAL_PAM_ENABLED NO`). Admission for a prepared derivative is one checked combined estimate — padded derivative, metadata ceiling, any numeric output written while the derivative is alive, and the 256 MiB reserve — enforced before preparation, with the reserve rechecked at every window boundary; a measured check is not an OS reservation. The temporary derivative lives in the job's scratch directory, is removed when its reader drops — before an analysis staging directory becomes a published generation — and never touches originals or accepted generations. Import partial raw/mask outputs are removed on failure; abandoned *analysis* staging left by a failed or cancelled slope job is a tracked inherited gap (`canopi-jv8a.3`), so do not claim whole-analysis cleanup. Keep zero/negative data, NoData and existing Float32 conversion semantics explicit: `values.raw` stays little-endian Float32, `valid.bin` stays one byte per cell, validity is finite-and-not-NoData, and the source range still includes finite NoData sentinels (`canopi-jv8a.2` tracks that discrepancy). This first migration must not claim the later precision-preserving or fully bounded import contract. Faithful later UI work uses approved HTML revision `0e696722`; material departures require renewed user approval. The [collaboration protocol](../design/raster-rework/collaboration-protocol.md) retains main-agent architecture/review and user courier authority.

| Change | Owner / reference |
| --- | --- |
| Catalogue migrations, generations, footprints, history | `desktop/src/services/lidar/catalogue.rs`, `import.rs`, `mod.rs` |
| Input admission, validity, prepared grids | `desktop/src/services/lidar/probe.rs`, `grid.rs`, `import.rs` |
| Controlled derivative, bounded native window reads, committed-asset leases | `desktop/src/services/lidar/prepared_raster.rs` |
| Standard COG asset creation, digests, 0/1 quality reads (B1 primitives) | `desktop/src/services/lidar/raster_assets.rs`; [receipt](../design/raster-rework/bounded-generation-receipt.md) |
| Ordered-occurrence resolver, signed lattice windows, sparse chunk enumeration, bounded legacy dense reads | `desktop/src/services/lidar/generation.rs` |
| Catalogue v7 asset/chunk/region index with pre-migration `VACUUM INTO` backup | `desktop/src/services/lidar/catalogue.rs` |
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
