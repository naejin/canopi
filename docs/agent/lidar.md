# LiDAR implementation guide

Use this entry point for raster import, overlap review, the shared library, analysis, or LiDAR presentation. The current foundation admits bounded, north-up, aligned single-band numeric rasters and persisted slope analysis. The [raster rework](../design/raster-data-analysis-rework.md) specifies future bounded import, Data/Analysis workbenches and shared Web maps; it does not change the current workflow until implemented. The [foundation record](../design/lidar-library.md) retains storage and scientific invariants. Consult bd before claiming a slice.

## Accepted direction and current assignment

The user selected [compatibility-first GeoLibre native integration](../design/raster-rework/geolibre-integration-design.md), independently accepted at `a5fc7d7b`; its [review](../design/raster-rework/geolibre-integration-review.md) closes D1/R1. The successor on `feature/bounded-raster-generations` through `1fcab504` changes real production callers but is [partially reviewed, not accepted as complete](../design/raster-rework/bounded-generation-review.md). Continue `canopi-jv8a.4` under the [BG1–BG5 correction](../design/raster-rework/bounded-generation-correction-agent-prompt.md) and [design](../design/raster-rework/bounded-generation-design.md), not the retired kickoff. Neither branch is integrated into this planning checkout. When applying these docs there, retain accurate branch-specific source inventories and reconcile stale descriptions. GDAL and the pinned native reader remain selected.

The old Q→production prerequisite is explicitly superseded. The [Q receipt](../design/raster-qualification-q.md), [GeoLibre pattern inventory](../design/raster-rework/geolibre-reuse-inventory.md) and [review/debrief](../design/raster-rework/review-and-debrief.md) retain historical evidence. Q is unqualified and its harness remains frozen: preserve useful regressions and known defects, but do not repair it, relabel records, change old artifact declarations or run it under retired prompts. Desktop completion `f9b5c10c` remains partial; correct pilot cells do not establish safe production lifecycle.

The standard-COG design replaces the unimplemented bespoke encoding at `24fd1a56`. At reviewed `1fcab504`, committed readers and resolved chunks exist, but new source staging still persists raw/mask assets; retained source COG wiring is required work, not optional optimization. The correction also addresses clipped multi-chunk reduction, unpaged generation metadata, process-tree measurement and admission/reporting mismatches. Do not call the 39 MiB parent observation a combined-memory pass or unchanged constants proof of retained admission. Source-specific validity, composed NaN NoData and separate analysis quality remain fixed in design §3.

Rust owns native raster work; TypeScript owns any newly required orchestration. No new Python raster tooling or wholesale Python removal. Existing unrelated repository tools remain in use. The forwarded bounded-generation assignment authorizes its isolated capacity fixtures after preflight, not new UI or other engines. Production limits move only after its whole-workflow gates pass.

Preserve originals and sidecars; prepare stripped inputs before native tiled reads. Keep zero/negative data, NoData and existing Float32 conversion semantics explicit. This first migration must not claim the later precision-preserving or fully bounded import contract. Full-grid composition and old limits stay until the next end-to-end foundation assignment passes its product gates. Faithful later UI work uses approved HTML revision `0e696722`; material departures require renewed user approval. The [collaboration protocol](../design/raster-rework/collaboration-protocol.md) retains main-agent architecture/review and user courier authority.

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
