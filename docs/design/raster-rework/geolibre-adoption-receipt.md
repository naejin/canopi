# GeoLibre adoption — delivery receipt

Status: in progress — S0 inventory recorded; later slices append evidence here as they land.
Tracking: epic `canopi-8shm`; branch `feature/geolibre-adoption` from `feature/data-library-reference` `d6e1b65c` (itself `main` `e01e7d07` plus the plan and gallery reference).
Current guidance: [adoption plan](geolibre-adoption-plan.md), [LiDAR guide](../../agent/lidar.md), [MapLibre guide](../../agent/maplibre.md).

This receipt holds revision-linked evidence for the authorized S0–S5 migration. The plan owns the contracts; bd owns execution state.

## S0 — production capability inventory

Inventory of `desktop/src/lib.rs` at `d6e1b65c`: 73 registered Tauri commands. The 49 non-raster commands (`design` 7, `design_notebook` 11, `export` 3, `favorites` 3, `geocoding` 1, `health` 1, `problem_report` 2, `saved_object_stamps` 7, `settings` 2, `species` 12) own botanical, Design, planning, export, settings and diagnostics behavior. They are **retained unchanged**; the migration adds no caller to them except the existing Design Edit and document-session seams.

The 24 LiDAR commands are classified against plan section 1:

| Command | Disposition | Target behavior |
| --- | --- | --- |
| `lidar_engine_status` | Retained | Availability read; method-specific analysis availability moves into the library read model (S4). |
| `lidar_list_library` | Retained, extended | One read model for fixed items, pending/failed imports, results with method provenance. |
| `lidar_rename_layer` | Retained | Name is editable metadata; renaming never enqueues analysis. |
| `lidar_delete_layer_impact` | Retained, extended | Reports dependent saved results so deletion can be refused with a route to them. |
| `lidar_delete_layer` | Retained, changed | Refuses a source with saved results instead of cascading; recheck inside the delete transaction. |
| `lidar_create_layer` | **Removed** | Empty-dataset setup is outside the target; import creates the item. |
| `lidar_import_sources` | **Removed** | Appending to an existing item is published-source mutation. Replaced by one-item import. |
| `lidar_get_import_job` | Retained | Progress for one import operation. |
| `lidar_cancel_import` | Retained | Explicit Cancel. |
| `lidar_create_analysis` | Retained, changed (S4) | Creates a new definition/result; new definitions use recipe version 2 once qualified. |
| `lidar_retry_analysis` | Retained, restricted | Only failed/cancelled operations without a complete result; uses the stored recipe version and pinned input. |
| `lidar_get_analysis_job_status` | Retained | — |
| `lidar_cancel_analysis_job` | Retained | — |
| `lidar_delete_analysis` | Retained | Deleting a result leaves its source intact. |
| `lidar_sample_pixel` / `lidar_cancel_sample_pixel` | Retained | Exact native numeric inspection and head fences. |
| `lidar_layer_collection` | Retained read-only | Source filenames/order for item details; no mutation. |
| `lidar_layer_history` | **Removed** | History browser is outside the target. |
| `lidar_move_layer_source` / `lidar_remove_layer_source` | **Removed** | Published-source membership editing. |
| `lidar_undo_layer_change` / `lidar_restore_layer_version` | **Removed** | Library Undo/Restore. |
| `lidar_raster_tile` / `lidar_cancel_raster_tile` | **Removed after S3 proof** | Native PNG tiling is replaced by display derivatives rendered by the upstream renderer. |

New LiDAR commands introduced by this migration: a display descriptor request (S1/S2) and a one-item import with retry/dismiss for the same item identity (S2).

Frontend entry points: `nav.data` becomes **Data Library**; `nav.layers` keeps the Layers surface with its botanical/geographic bands and the new data band; `nav.analysis` (standalone Analysis navigation) is **removed** in S3, with Calculate slope becoming a contextual action in S4. Data surface source editing, History, Restore and library Undo UI are removed with their callable paths. Canvas, plant tools, Species Catalog/Favorites, Location, Calendar, Budget, Consortium, Notebook, exports and settings have no disposition change: they are preserved and re-verified in S5.

Deferred (outside this plan): advanced LiDAR processing, point clouds, hydrology, SQL console, RGB imagery and browser raster processing.

## S0 — performance baseline (reduced by user decision)

On 2026-09-24 the user waived the full three-way baseline comparison ("we know that geolibre upstream will be better"). The comparison in plan section 9 against the pinned upstream reference and the remaining baseline fixtures is therefore **not performed**; the migrated route is measured against the plan's absolute targets only. The baseline evidence already captured is retained below.

Setup: baseline `d6e1b65c` release build with debug assertions (needed for the in-app driver bridge) and one repair applied — `import 'pixi.js/unsafe-eval'` — because the production CSP otherwise fails the shared map scene with "Basemap unavailable" (a pre-existing packaged-build defect, fixed on this branch). Isolated profile on nested Xephyr `:99` with llvmpipe software GL, 1280×800 window. Input: real IGN LiDAR HD MNH tile `0445_6806` (2000×2000, 0.5 m, Lambert-93) imported through the production IPC (1.5 s). Timing is taken at the native tile IPC boundary; 32 scripted wheel zoom/pan interactions.

| Condition | First tile | Viewport complete | Interaction p95 / max | Frame gaps > 50 ms (worst) |
| --- | --- | --- | --- | --- |
| Cold app and native tile cache, OS file cache warm | 5.0 s | 29.8 s | 19.6 s / 19.9 s | 68 (495 ms) |
| Warm native tile cache after reload | 0.65 s | 0.70 s | 0.43 s / 7.7 s | 68 (463 ms) |

Baseline import times on the same build: IGN tile 1.5 s, 24 adjacent 2000×2000 tiles 19.8 s, 20000×20000 capacity plane 59.7 s. Display-derivative preparation of the capacity plane with `gdal_translate -of COG` (DEFLATE, 256 blocks, AVERAGE overviews, 2 threads): 18.2 s, 335 MB peak RSS, 21 MB output.
