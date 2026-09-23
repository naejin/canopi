# LiDAR implementation guide

Use this entry point for raster import, the shared library, analysis, inspection and LiDAR presentation. The [raster rework](../design/raster-data-analysis-rework.md) has candidate Data/Analysis workbenches, source-only import and shared Web maps; the primary documentation checkout does not contain that implementation. Candidate `9208c930` remains partial after independent review. The [foundation record](../design/lidar-library.md) retains storage and scientific invariants. Consult bd before claiming a slice.

## Accepted direction and current assignment

The user selected [ordered COG Data Layers](../design/raster-rework/ordered-cog-design.md): an ordered collection of source COGs, topmost-valid composition shared by display/analysis, whole-layer presentation visibility, and no compulsory merged-source raster for new edits. [ADR 0027](../adr/0027-ordered-cog-data-layers.md) supersedes ADR 0026 for new source composition. The correction at `34e4ded4` is [independently accepted in scope](../design/raster-rework/ordered-cog-review.md#accepted-correction-at-34e4ded4); integration and release remain separate.

The [completion prompt](../design/raster-rework/completion-agent-prompt.md) continues
`canopi-j571.1` from candidate `9208c930`, with foundation integrated at `f61f8494`.
The [current independent review](../design/raster-rework/completion-review-9208c930.md)
requires R44–R51 repairs and remaining R27–R43 evidence under the [repair decisions](../design/raster-rework/completion-correction-design.md).
Source-only publication and nullable exact/display facts are present; lifecycle,
resource admission and evidence obligations remain. The
[source-import amendment](../design/raster-rework/source-import-design.md) still
supersedes arbitrary input ceilings once bounded consumers and safety evidence
are established. Do not weaken that contract to match current caps or claim
only external observations remain. Preserve R12–R26's meaningful regressions.
Implementation, independent acceptance and integration into the user's primary
checkout remain separate; reconcile the candidate's detailed inventory as repairs land.

The delivered implementation lives on that branch, not in this documentation checkout: `services/lidar/collection.rs` owns snapshot membership, measurement and Undo/restore history; `generation.rs` owns the ordered resolver (`CollectionReader`) and the preserved-generation reader (`GenerationReader`); `tiles.rs` resolves display reads from the native and reduced windows it actually consumes; `mod.rs` exposes `layer_collection`, `layer_history_page`, the awaited edit entries (`apply_move`, `apply_remove`, `apply_undo`, `apply_restore` over `apply_member_edit`) and `settle_layer_edit`; `commands/lidar.rs` carries the five ordered commands; `desktop/web/src/app/lidar/` and `components/panels/lidar/` own the source list, History, import route and their request lifetimes.

Q is unqualified and frozen. Preserve useful regression tests and [historical evidence](../design/raster-qualification-q.md); do not repair or rerun its retired harness assignments. The [review/debrief](../design/raster-rework/review-and-debrief.md) owns historical outcomes and improvement evidence. GDAL and the pinned native reader remain selected; Rust owns native raster work and TypeScript application orchestration. No new Python raster tooling or wholesale Python removal.

Preserve originals/sidecars, source-specific validity, valid zero/negative values and current Float32 semantics. The candidate still has its old 24-file/2-GiB/400M input policy and compulsory measurement; replace those only through the source-import amendment’s bounded implementation and evidence, not by deleting guards alone. Legacy dense/sparse assets stay readable exactly; never reinterpret masked historical replacement as simple source order. Current code remains the authority for existing behavior; update this guide's implementation inventory and the dock contract when the new route actually lands. The accepted workbench HTML reference `0e696722` is the production UI reference for completion, with ordered-source behavior taking precedence over obsolete replacement controls. [Collaboration](../design/raster-rework/collaboration-protocol.md) retains main-agent review and user courier authority.

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
