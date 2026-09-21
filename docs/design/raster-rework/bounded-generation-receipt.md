# Bounded raster generations — delivery receipt

Status: evidence — partial implementer report for `canopi-jv8a.4` (B1–B5): **B1 storage primitives only**; the caller migration (B1 remainder, B2–B5) is not delivered. Not acceptance, integration or release.
Tracking: `canopi-jv8a.4` (parent `canopi-jv8a`, epic `canopi-j571`); `canopi-jv8a.3` is linked work inside B3.
Current guidance: [complete design](bounded-generation-design.md), [storage decision](../../adr/0026-sparse-raster-generations.md), [LiDAR](../../agent/lidar.md), [delivery](../../workflow/delivery.md).

## Scope actually delivered

| Design step | State |
| --- | --- |
| B1 — retained source COG, resolved/quality COG creation, reader ownership, catalogue index, resolver, legacy adapters, paged regions | **Delivered and verified, not yet wired**: committed-asset leases, controlled resolved/quality chunk creation with digesting and content-addressed admission, catalogue schema v7 with a WAL-consistent pre-migration backup and future-version refusal, the private resolver over ordered occurrences, the legacy TIFF-only derivative lease with an independently applied authoritative mask, and paged occupied-region aggregates. What is missing is B2–B5: every production caller (import/Apply/undo, slope, display), the Desktop tile protocol, the shared heavy-job lease and the capacity gates |
| B2 — import/review/Apply/undo migration | Not started |
| B3 — slope core+halo and shared job ownership | Not started (`canopi-jv8a.3` remains open) |
| B4 — bounded display transport and Desktop protocol | Not started |
| B5 — end-to-end verification and conditional limit removal | Not started |

Production callers are unchanged: import staging, composition, slope, display and the map path still run on the accepted `a5fc7d7b` code. No workflow is broken, no storage format is switched, and **no capacity limit was moved**. The new storage layer is not reachable from any production command, so a review of this branch must treat it as an inert, tested foundation rather than a migration.

## Revisions

| What | Revision |
| --- | --- |
| Accepted predecessor baseline | `a5fc7d7b` on `feature/geolibre-native-raster-integration` |
| Forwarded design + revision docs | merged in `be0d4d17` and `7f2e3bef` |
| Reader/asset primitives and tests | `1b8683db` |
| Catalogue v7 index, resolver and their tests | `9f1e5420` |
| Legacy TIFF lease, paged region aggregates and their tests | `3cf213e5` |
| Persisted-chunk publication rows and read path | `76d8aa8e` |
| Resolved-chunk materialization for publication | the commit that carries this receipt |

## What the delivered primitives do

- `prepared_raster.rs` gained `MAX_HALO_SIDE` (1026) so an explicitly requested window may carry the one-cell analysis halo, while the streaming scan keeps its 1024×1024 row-band windows. Window validation still rejects empty, oversized, overflowing and out-of-bounds requests before allocation.
- `PreparedRaster::open_committed(path, grid, nodata)` opens an already-committed controlled COG: same prefix parse, same layout validation, **no** GDAL preparation, **no** capacity charge, and dropping it closes the handle without deleting the file (`owns_derivative = false`). The reserve recheck in `scan` is now tied to an explicit `capacity_guard`, so a read-only lease never demands write headroom.
- `raster_assets.rs` (new, private) creates one controlled COG from bounded in-memory samples through the existing GDAL adapter and the same fixed profile as source preparation (`controlled_cog_arguments`, shared with `open`): `-of COG -ot Float32 -b 1 -mask none`, 256×256 blocks, `COMPRESS=NONE`, `OVERVIEWS=NONE`, `NUM_THREADS=1`, `STATISTICS=NO`, `SPARSE_OK=NO`, PAM disabled, plus `-a_srs`/`-a_ullr` and optional `-a_nodata`. The ENVI scratch pair is bounded and removed before returning.
- Every new asset is admitted only after `open_committed` validates its profile, then digested with bounded 64 KiB reads and moved into a content-addressed store (`assets/<sha256>/cog.tif`). Identical content reuses the existing file. A failed admission removes the staged file.
- `read_quality_window` reads a 0/1 quality asset through the same reader and rejects any sample that is not exactly 0.0 or 1.0, so a corrupt mask cannot read as partial coverage.
- `paths.rs` gained the retained source-COG path (`sources/<sha>/source-cog.tif`) and the content-addressed asset paths.

## Resolver and catalogue evidence

- `catalogue.rs` moved to schema v7 and creates `lidar_raster_assets`, `lidar_interpretation_cogs`, `lidar_generation_chunks` (unique on generation + role + signed chunk coordinates, indexed by asset) and `lidar_interpretation_regions`. Before any upgrade of an existing file it writes a `VACUUM INTO` copy beside the catalogue, syncs it, records its path in `lidar_catalogue_meta.last_backup_path`, and the test reopens that copy as a complete v6 database. A future schema version is still refused before writes.
- `generation.rs` (new, private) resolves one half-open lattice window (≤1026 per side) over an ordered occurrence list: it validates ordinal order up front, maps each member's own frame through `RasterGrid::compatible` plus a rounded lattice offset, reads only the intersecting member window (committed COG through the production reader, or the preserved dense raw/mask pair row-wise), and applies the accepted roles — `add` fills only invalid cells, `replace` paints valid incoming cells anywhere, `replace-overlap` paints only already-valid cells, and invalid incoming samples never erase coverage.
- `LegacyTiffLease` prepares one controlled derivative for a legacy TIFF-only generation and removes it on drop, so a caller never re-prepares per window; the preserved generation's own mask is read row-wise and overrides the derivative's validity. Tests prove one derivative per lease, its removal on drop, the mask override, that a plain legacy TIFF is rejected by the committed-profile check, and that `member_regions` aggregates the member's occupied chunk (valid count, min, max, exact f64 sum) while leaving padded cells untouched.
- `catalogue::{replace_interpretation_regions, interpretation_region_page}` store and page per-block aggregates atomically; the test replaces a five-region page set, pages it, and proves a re-scan swaps rows instead of accumulating them.
- `read_persisted_window` is the published-generation read path: it selects only persisted chunk rows that intersect the window, so a published generation never replays member history, never opens a source COG and never walks absent coordinates. Chunk rows carry an explicit `state`, so `insert_unpublished_chunks` makes a crashed or cancelled job's index unreadable until `publish_generation_chunks` flips it inside the publish transaction. Tests prove unpublished rows are invisible, roles stay separate, windows inside a chunk read its exact values, a gap chunk yields an all-invalid mask, a distant chunk reads its own bytes, and a truncated chunk fails rather than reading as empty coverage.
- `materialize_generation_chunks` is the publication step: for every occupied chunk of an ordered sequence it resolves the window once, writes a resolved NaN-NoData COG through `write_cog_asset`, and returns the chunk plus its aggregate, skipping all-invalid chunks entirely. A GDAL test materializes an add-then-replace sequence (one chunk, aggregate 12 valid / min 9 / sum 108), reads it back only through persisted chunk rows, and proves a member a million cells away adds exactly one further chunk.
- Tests reproduce the design's history example (A=5, replace B=9, reimport A with replacement → 5, undo that occurrence → 9), add-only holes never erasing prior coverage, replace-overlap creating no new coverage, members above/left of the anchor resolving negative lattice cells, occupied-chunk enumeration over a million-cell gap (2 chunks, adjacency-only variation) and chunk straddling, exact bounded legacy window reads with a short-file rejection, and preconditions (empty/oversized window, out-of-order ordinals, unaligned member grids) failing before any file is read.

## Evidence

Decisive B1 round-trip (GDAL + pinned native reader, `services::lidar::raster_assets`):

- A resolved 4×3 chunk authored with valid zero, negative, a finite sentinel-like `-9999.0`, `-0.0`, and NaN holes round-trips: every finite sample compares **bitwise** and every NaN stays invalid, reopened through `open_committed` with **no** GDAL re-preparation.
- The same file opened by GDAL reports `Float32`, `256×256` blocks, the authored geotransform origin and an EPSG:3857 CRS; the ENVI scratch pair is gone; the digest and byte count are stable; **the committed file still exists after the reader is dropped**.
- Identical content re-created yields the same digest and the same file.
- A separate quality chunk of exact 0/1 samples reads back as the authored mask bytes, and a chunk containing `0.5` is rejected as corrupt instead of silently rounding.
- A truncated copy of a real chunk is rejected by profile validation.

Hermetic additions: digest stability against an independently computed SHA-256, and a sample/grid mismatch rejected before any GDAL work.

Regression status of the accepted layer: the full `services::lidar` suite passes with `--include-ignored` (64 tests), including the previous D1 budget cases, caller compatibility, erosion, degrees/percent slope and cancellation controls. The real MNT lifecycle was not re-run in this batch.

## Limits, unavailable evidence and known gaps

- **The batch is not complete.** No caller migration, no legacy TIFF-only adapter, no region/aggregate paging into the catalogue, no display transport, no Desktop protocol, no job lease, no capacity verification and no large-fixture run was delivered. The design's acceptance examples for B2–B5 have not been attempted, and the resolver is exercised only by its own tests rather than by a production caller.
- The delivered module is not reachable from production, so it is not exercised by any real workflow. Its compiler-visible dead-code allowance (`#![allow(dead_code)]` in `raster_assets.rs` plus item-level allowances in `paths.rs`/`prepared_raster.rs`) is temporary and documented in place; it must be removed when B2 wires the resolver. This is a scaffold with verified behaviour, not an integrated storage layer.
- Because no production path consumes the assets, "no full-file helper reachable" and "no production dense path remains" are **not** established; the accepted dense callers (`compose_values_cancellable`, `replay_members`, `head_values_on_union`, display generation) are untouched and still authoritative.
- Retaining resolved chunks costs additional bytes and files; no disk or memory measurement of that trade-off was made in this batch, and the design's resource budgets are unverified.
- The real 48M-cell batch, 24-source sparse case, 400M-cell plane and 12-tile MNH run were not attempted; no capacity limit was removed.
- Windows capacity/asset behaviour remains uncompiled here, as recorded in the predecessor receipt.

## Next dependency

The next session needs, in order: legacy TIFF-only derivative leasing, region/aggregate paging into the v7 tables, then B2 publication/undo through the resolver (chunk creation via `write_cog_asset`, ordered occurrence rows, prior-head retention), then B3–B5. Do not remove production limits or wire display/slope before those land. `canopi-jv8a.3` (analysis staging cleanup) is still open and is delivered with B3, not here.
