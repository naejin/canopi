# Bounded raster generations — delivery receipt

Status: evidence — partial implementer report for `canopi-jv8a.4` (B1–B5): **B1 storage primitives plus the first B2 production vertical slice**, which is implemented and tested but **deliberately gated off in production**. Not acceptance, integration or release.
Tracking: `canopi-jv8a.4` (parent `canopi-jv8a`, epic `canopi-j571`); `canopi-jv8a.3` is linked work inside B3.
Current guidance: [complete design](bounded-generation-design.md), [storage decision](../../adr/0026-sparse-raster-generations.md), [LiDAR](../../agent/lidar.md), [delivery](../../workflow/delivery.md).

## Scope actually delivered

| Design step | State |
| --- | --- |
| B1 — retained source COG, resolved/quality COG creation, reader ownership, catalogue index, resolver, legacy adapters, paged regions | **Delivered and verified**: committed-asset leases, controlled resolved/quality chunk creation with digesting and content-addressed admission, catalogue schema v7 with a WAL-consistent pre-migration backup and future-version refusal, the private resolver over ordered occurrences, the legacy TIFF-only derivative lease with an independently applied authoritative mask, and paged occupied-region aggregates |
| B2 — import/review/Apply/undo migration | **First vertical slice delivered and caller-tested, gated off**: stage → review → Apply → reopen → undo publish and read the sparse format through the real `stage_import`/`render_decision_preview`/`apply_import`/`undo_import` callers, with exact committed windows and preserved legacy generations. Still open: display publication for a chunked head, the legacy-base overlay for heads with no reconstructible member history, retention of the incoming source COG, and unreferenced-asset reclamation |
| B3 — slope core+halo and shared job ownership | **Delivered, gated off**: analysis staging ownership and `canopi-jv8a.3` are done (guard plus bounded startup pruning); slope computes one 1024×1024 core plus one-cell halo block per occupied chunk through the resolver, publishes sparse result and 0/1 quality chunks (schema v9 gives analysis results nullable dense paths), checks grid eligibility against GDAL's own CRS report, and keeps the accepted dense whole-raster path for generations without reconstructible member history; and the library now owns one exclusive heavy raster job lease shared by staging, apply, undo and analysis refresh, refusing a competing user submission promptly without creating running work |
| B4 — bounded display transport and Desktop protocol | **Partly delivered**: the presentation contract carries a tagged tile source (preserved asset pyramid vs native generation), the library renders bounded 256×256 tiles from an immutable sparse generation through an executor-backed command returning raw PNG bytes or an explicit empty/unavailable outcome, and the frontend installs the `canopi-raster://` MapLibre protocol adapter with per-request cancellation, display reads are admitted library-wide at two active and thirty-two queued with a synchronous cancel command, and encoded tiles are served from a shared bounded memory and disk cache with leases, LRU eviction, generation-scoped invalidation and atomic owned writes. Still open: lifting the publication gate and the B5 verification runs |
| B5 — end-to-end verification and conditional limit removal | **Representative runs done; the capacity switch is not**. Verified on real and authored data: the IGN MNT lifecycle through both formats with identical slope ranges, the authorized 12-tile MNH batch (48,000,000 cells, 48 chunks, four drawn tiles at zooms 15–18, restart reuse, **kernel peak RSS (VmHWM) 315 MiB**), the 24-tile authored batch (60.8M-cell union stored as 3 chunks / 12.6 MB), and the sparse-gap and fixed-anchor runs. The 400M-cell plane is **unavailable here**: the host reports 6.5 GiB available against the required ≥8 GiB, so per the design its gate is recorded, not faked. Production admission limits are therefore **retained**, and the format gate is still off |

Production behaviour is unchanged: the storage-format switch is `false` in every
non-test build, so import, review, Apply, undo, slope and display still publish
and read `legacy-dense-v1` generations exactly as at `a5fc7d7b`. **No capacity
limit was moved.** The chunked path is real caller code exercised end to end by
caller-level tests, not an inert module.

## Revisions

| What | Revision |
| --- | --- |
| Accepted predecessor baseline | `a5fc7d7b` on `feature/geolibre-native-raster-integration` |
| Forwarded design + revision docs | merged in `be0d4d17` and `7f2e3bef` |
| Reader/asset primitives and tests | `1b8683db` |
| Catalogue v7 index, resolver and their tests | `9f1e5420` |
| Legacy TIFF lease, paged region aggregates and their tests | `3cf213e5` |
| Persisted-chunk publication rows and read path | `76d8aa8e` |
| Resolved-chunk materialization for publication | `d57cdfc9` |
| Catalogue v8, format identity, gated stage→review→Apply→reopen→undo caller slice | `535d353a` |
| Analysis staging guard, `staging-*` startup pruning and `canopi-jv8a.3` | `48aba35a` |
| Catalogue v9, bounded core+halo slope with sparse result/quality chunks | `eea106d2` |
| Exclusive library-wide heavy raster job lease (staging/apply/undo/refresh) | `f0715252` |
| Tagged tile-source contract, bounded native tile renderer and command, raster URL builder | `4fe2f55a` |
| MapLibre raster protocol adapter, bounded display admission and cancellation | `0a0dedf5` |
| Shared bounded display cache (memory + disk) with leases, eviction and invalidation | `6ae0ba0d` |
| Reprojected lattice mapping fix, analysis tileset fix, sparse real-fixture lifecycle | `f7313624` |
| Dense-ceiling test seam, bounded preview target, sparse-gap representative run | `834043e5` |
| Schema v10 fixed per-layer lattice inherited by sparse generations | `fdb907b3` |
| Extended admission test seam, 12-tile MNH and 24-tile representative runs | `4c86f6c6` |
| Block-wise review classification and bounded previews | the commit that carries this receipt |

## What the caller slice does

- **Format identity is explicit.** `GenerationManifest` gained a `format` field
  (`legacy-dense-v1` default, `cog-chunks-v1`), absent in older manifests and
  therefore dense by definition. Every reader selects its path from that field;
  no caller guesses from the presence of a file.
- **Catalogue v8 makes the legacy dense paths nullable** so a sparse generation
  can honestly own no mosaic, with a paired-nullability check so it can never
  own half of one. Existing rows are copied unchanged, so preserved generations
  keep their identity, files and member order. The pre-migration `VACUUM INTO`
  backup, atomic version record and future-version refusal are unchanged; the
  rebuild suspends foreign keys for that single migration and runs
  `PRAGMA foreign_key_check` before reporting success.
- **The head read path is format-driven.** `head_numeric_read` selects either the
  accepted dense mosaic/coverage pair or the published chunk rows, and
  `head_values_on_union` reads the sparse head one bounded 1024×1024 window at a
  time. Review counts, decision previews and the next Apply all read a chunked
  head this way; the before-preview of a chunked head is rendered from that same
  bounded read instead of a dense file it does not own.
- **Publication materializes occupied chunks only.** `prepare_chunked_generation`
  resolves each occupied chunk once through the ordered replay, writes it as an
  immutable content-addressed COG, indexes it unpublished, and derives
  generation statistics and bounds from the chunks themselves. The final short
  transaction re-checks the job state and the planned head, flips the chunk
  index to published, inserts the generation and member rows, advances the head
  and completes the job — or publishes nothing.
- **Legacy members are adapted, never fabricated.** A head recorded as
  `legacy-dense-v1` contributes its ordered members from their durable raw/mask
  assets, so extending a legacy layer with a sparse publication preserves its
  coverage without rewriting its files. A head whose member history is not
  reconstructible is refused by the sparse route, which falls back to the
  accepted dense publication rather than publishing a generation missing prior
  coverage. The legacy-base overlay (`base_generation_id`) for those heads is
  still open.
- **Undo republishes the remaining sequence.** Undo removes this job's
  occurrences (by job identity, or by accepted interpretation for older members
  without it) and publishes the shorter sequence, deleting the removed
  footprints in the same transaction. A chunked head is undone from its member
  history, never from a dense mosaic.
- **The index stays coherent with its owners.** Startup discards unpublished
  chunk rows left by a crashed job, and deleting a layer deletes its generations'
  chunk rows explicitly (chunk rows carry no foreign key, because they are
  inserted before the generation commits). Immutable assets outlive their
  generation and are left to catalogue-aware reclamation.
- **Bounded native tiles (B4, first half).** A sparse generation owns no PNG
  pyramid and no filesystem path, so the presentation contract now carries a
  tagged tile source: `legacy-asset` for a preserved pyramid (unchanged
  behaviour) or `native-generation` for on-demand rendering. The renderer
  selects a power-of-two reduction level per target sample from that sample's
  own native displacement — so a sample shared by two tiles picks the same
  level in both — and reads only what it needs: one bounded window for
  native-scale samples, and one read per *occupied* reduction page for minified
  samples, where a sample whose block is a whole chunk is answered from the
  chunk's stored f64 sum/count with no raster I/O at all. Pages the index does
  not hold are never visited, the level exponent and page count are bounded,
  invalid cells stay transparent, valid zero/negative cells are coloured, and
  the colour ramp clamps and interpolates exactly as the legacy relief ramp
  does. The command returns encoded PNG bytes (never base64) or an error that
  the caller must surface as unavailable; an empty tile is the shared 1×1
  transparent PNG, so "no coverage" never masks "could not render". The
  coordinate transform verifies the Web Mercator affine shortcut against GDAL
  once and otherwise transforms bounded 4096-point batches, so the projection
  authority is never bypassed silently. Display reads are admitted separately
  from the heavy raster lease — two may run at once and thirty-two may wait
  library-wide, anything beyond that is declined by name — a waiting read never
  holds a Native Operation Executor permit, an obsolete waiter never takes a
  slot from a newer viewport request, and `lidar_cancel_raster_tile` stops a
  waiting or running read through bounded in-memory state. The Desktop map
  surface installs the protocol adapter when a map context attaches, so a
  native tile source is fetchable before its layer is added; the Web edition
  leaves the hook undefined and stays free of native raster transport.
- **Bounded display cache (B4).** Encoded tiles are derivatives of an
  immutable generation and an explicit style version, so they are cached
  aggressively and discarded freely: a 128 MiB in-memory budget and a 512 MiB
  reproducible disk budget are shared across every source and result
  generation, enforced by byte accounting with least-recently-used eviction. An
  entry a render currently holds is never evicted, an entry that cannot be
  admitted is simply not cached (the tile is still served), writes go through
  an owned temp file and a rename so an interrupted write is never a readable
  entry, a restart re-accounts what the previous session left and discards its
  temp files, and deleting a layer or analysis drops that generation's cached
  tiles. Nothing in the cache is authority: a miss only costs a re-render.
- **Bounded slope (B3).** `publish_sparse_slope` resolves the input generation
  once and iterates only its occupied chunks. Each block resolves a 1026×1026
  core+halo window, exports it as a bounded NaN-NoData scratch raster, runs the
  existing fixed-argv Horn slope (`-s 1`, `-p` only for percent, no edge
  interpolation) and stores the 1024×1024 core as an immutable resolved chunk,
  with a separate 0/1 quality chunk for the exact 3×3 accepted-input
  neighborhood. Statistics and coverage come from the stored chunk aggregates,
  never from a concatenated result raster. GDAL marks uncomputed cells with its
  own NoData marker (a NaN input marker does not survive `gdaldem`), so the
  marker is read back and treated as invalid before anything is persisted; a
  non-negative marker, which a real slope cell could equal, is refused by name.
  Eligibility is checked against GDAL's own CRS report and the layer's units,
  with the plan's explicit reason for geographic or non-metre grids. A
  generation whose member history cannot be replayed keeps the accepted dense
  whole-raster slope route, so compatibility is preserved while the gate holds.
- **One heavy job at a time (B3).** `HeavyJobLease` is the library's exclusive
  heavy raster lease. Import staging, apply and undo acquire it before any
  running work is created, so a competing user submission is refused promptly
  with a named busy reason instead of competing for the same disk, memory and
  GDAL children; the guard rides into the spawned work and releases when it
  settles, which is also what releases staging for review before apply
  reacquires it. An analysis refresh waits for the lease *before* taking a
  Native Operation Executor permit, so a queued refresh never occupies a permit
  behind another heavy job, and a refresh that was cancelled or superseded
  while waiting stops instead of running.
- **Analysis staging is owned (`canopi-jv8a.3`, B3 linked work).** A slope job's
  `staging-*` root is owned by a guard that removes it on any early return,
  propagated error, cancellation or panic, and is disarmed only once the
  directory has been renamed into its published generation directory. Startup
  pruning removes `staging-*` roots left by a crash, and never considers
  published `gen-*` directories, member assets or originals.

## Evidence

Caller-level tests (`services::lidar::import::tests`, GDAL required):

- `chunked_stage_review_apply_reopen_and_undo_keep_exact_values` runs the whole
  slice: stage a source, review it, Apply, **reopen the library**, review a
  second overlapping source over the sparse head (asserting the recomputed
  overlap/uncovered cells and that a before-preview is rendered), Apply a
  `replace-overlap` decision, then undo it. It asserts the head is chunked with
  no dense path, its manifest format, its exact `coverage_cells`/min/max, one
  published chunk, exact Float32 values in every cell, exactly invalid cells
  outside the covered area, restored values after undo, and that the replaced
  generation and its chunks survive as immutable history.
- `chunked_publication_extends_a_legacy_generation_without_rewriting_it`
  publishes a legacy dense generation first, then extends it with a separated
  source through the sparse route: the legacy row keeps its original mosaic path
  and file, the new head reports the summed coverage and final min/max, a
  440-column gap between the two members reads as exactly invalid rather than as
  data, both members read back with their own values, and undo restores the
  legacy coverage alone.
- `chunked_publication_is_gated_off_without_an_explicit_test_enablement` proves
  the production switch is off without an explicit test enablement, and the
  in-test guard restores it.

Catalogue tests:

- `v7_catalogue_gains_nullable_dense_paths_without_losing_rows` migrates a v7
  file with a generation, member and head: the version advances, the preserved
  generation keeps its paths, cells and history, a sparse generation may own no
  dense pair, a lone dense path is rejected, and the pre-migration backup
  reopens as a complete v7 database.
- `v6_catalogue_is_backed_up_and_migrated_to_current` still migrates v6 with its
  backup intact.
- `delete_layer_removes_all_referencing_rows_with_foreign_keys_enabled` now also
  seeds a published chunk row with its asset and proves the chunk rows are
  deleted with the layer while the immutable asset row remains.
- Bounded slope (GDAL required):
  `sparse_slope_matches_the_dense_oracle_in_both_units` imports the same two
  plane members (a hole spans the member seam) once dense and once sparse,
  runs slope through both storage formats, and asserts the sparse result equals
  the accepted dense whole-raster oracle at every cell with a complete 3×3
  neighborhood, that result validity and the 3×3 quality mask agree exactly
  (including the generation's own outer boundary and the hole ring), that the
  interior is exactly 45°/100 %, and that the dense oracle raster is real.
  `cancelled_sparse_slope_publishes_nothing` asserts a cancelled bounded slope
  publishes no analysis head, leaves no unpublished chunk row and removes its
  scratch root; `slope_eligibility_refuses_non_metre_elevations` and
  `slope_eligibility_accepts_a_projected_metre_grid` cover the eligibility gate.
- Bounded native tiles (GDAL required):
  `native_tiles_render_a_sparse_generation_and_report_empty_areas` publishes a
  multi-chunk plane through the real callers, asserts the layer presents a
  native tileset, renders a fully opaque tile inside the plane in the exact
  elevation-ramp colour, renders a coarser tile with both painted and
  transparent pixels, returns an explicit empty tile beyond the coverage,
  completes a deep zoom-out that can only be answered from stored aggregates,
  and refuses a generation that belongs to another entity. Hermetic tests cover
  the XYZ bounds, the reduction-level rule including its bound, lattice-aligned
  blocks including negative cells, stored-aggregate means, page-edge block
  means, and malformed-request rejection. The contract's wire shape is pinned
  by `common_types::lidar::tests::tile_source_wire_shape_is_tagged_and_stable`,
  and the frontend covers both URL forms plus raster-URL parsing and rejection.
- Authorized 12-tile MNH batch (`e2e_mnh_batch_import_apply_display_restart`, run
  here against `~/Downloads/la magnerie`, with **no raised admission ceiling**): all twelve 16,000,513-byte tiles
  enumerated and hashed individually, staged as one batch, 48,000,000
  uncovered cells with no overlap, an 8000×6000 union, published as exactly
  **48** resolved chunks with range −1.70…39.28 m, four native tiles drawn at
  zooms 18/17/16/15 (41–72 KB each) from the batch centre, the head and its
  tileset intact after a restart, and a **peak resident set of 39 MiB** — the
  kernel's own `VmHWM` high-water mark for the test process, which is exact for
  that process rather than a sampling estimate, plus the largest peak any
  still-live child reported; short-lived GDAL children are excluded, which is
  the residual uncertainty. That is well inside the design's 1 GiB combined
  working-memory budget. MNH is height above ground and
  is deliberately never used as slope input.
- Authorized 24-tile authored batch (`sparse_twenty_four_tile_batch_stays_chunk_sized`):
  twenty-four files — more than the production 16-file ceiling — arranged in
  three widely separated columns produce a 60,809,728-cell union and are stored
  as **3 occupied chunks totalling 12.6 MB**, one per column; only the file
  count is raised for that thread, because the 60.8M-cell union needs no
  ceiling at all.
- Fixed layer lattice (GDAL required):
  `sparse_lattice_anchor_never_moves_when_the_layer_extends_left` publishes a
  member, extends the layer 1200 cells to its left, and asserts the manifest's
  lattice origin is unchanged, the unchanged member still occupies chunk 0, the
  extension lands in chunk -2, both members read back at their own lattice
  cells, the space between them stays invalid, and a review over the sparse
  head still sees the accepted member (through the union-to-lattice remap).
  `v9_catalogue_gains_the_layer_lattice_and_never_moves_it` proves the v10
  table migrates in, that recording twice never replaces an existing anchor,
  and that deleting a layer takes its lattice with it.
- Sparse-gap representative run (authored, GDAL required):
  `sparse_gap_import_stores_only_occupied_chunks` imports three members whose
  union spans ~1,000,000 columns and ~45M cells — far beyond the dense working
  ceiling, which the run raises only for its own thread through the new
  test-only `dense_working_probe` seam — and asserts the whole flow stays
  chunk-sized: two occupied chunks (one of them 977 chunks away), no index row
  anywhere in the gap, written bytes bounded by two chunks, and window reads
  that return each member's exact value while the gap is exactly invalid. The
  run also caught a pre-existing preview defect: the fixed 512-wide review
  target collapsed an extreme aspect ratio to zero rows, so both preview
  dimensions are now bounded to 1..=512 with the aspect preserved.
- Real fixture (IGN MNT `0445_6806`, hash `7b8773046c27d3f42d9f6548c7adc24fca810de19ea6ed5f49b29302e22076ad`):
  `e2e_sparse_generation_lifecycle` publishes the 2000×2000 EPSG:2154 tile as
  four occupied resolved chunks (4,000,000 cells, 150.84–191.81 m), renders a
  native tile at zoom 18 through the real protocol command path (24,504 bytes,
  repeated request served as a cache hit), publishes sparse slope result and
  quality chunks whose value range (`0.0012363962596282363`–`66.75675964355469`)
  is **identical to the dense lifecycle's** on the same fixture, reopens the
  library and re-renders the same immutable head, and undoes the import while
  history keeps its chunks. Run with
  `CANOPI_LIDAR_E2E_FIXTURE=<mnt> cargo test -p canopi-desktop --lib -- --ignored e2e_sparse`.
  This run also caught two real defects the authored fixtures could not: the
  reprojected coordinate path returned world coordinates where lattice cells
  were required, and an analysis result manifest was parsed as a source
  manifest, so a sparse slope result presented no tileset.
- Display cache (hermetic): `tiles_are_cached_in_memory_and_on_disk` (including
  re-accounting a reopened cache), `the_disk_budget_evicts_the_least_recently_used_entry`,
  `a_leased_entry_is_never_evicted`, `the_memory_budget_evicts_without_touching_the_disk_copy`,
  `an_oversized_tile_is_served_but_not_cached`,
  `invalidating_a_generation_drops_its_tiles_only` and
  `interrupted_writes_are_not_readable_entries`; the caller-level tile test also
  proves a repeated request is a cache hit and that deleting the layer empties
  the generation's cached bytes.
- Display transport (hermetic):
  `display_reads_are_bounded_in_order_and_cancellable` admits two running and
  thirty-two waiting reads, declines the next by name, proves a waiter neither
  runs early nor jumps the queue, and proves cancellation stops a waiter and
  signals a running read. The frontend covers protocol installation, request
  forwarding, single installation per module, URL rejection, unavailable tiles
  failing rather than rendering empty, and an aborted request whose answer
  arrives late.
- Heavy lease (hermetic):
  `heavy_raster_lease_is_exclusive_and_released_on_every_path` holds the lease
  for one job, proves a competing staging submission is refused with the busy
  reason while its job row is left untouched, proves release admits the next
  holder, and proves an early failure inside a submission releases the lease
  rather than wedging the library. The refresh wait path is exercised end to
  end by the B5 integration runs, not yet by an isolated test.
- Analysis staging (`canopi-jv8a.3`):
  `failed_slope_job_removes_its_staging_root_and_keeps_the_accepted_head` forces
  a failure after the slope step wrote its staged result (the message proves the
  failure point) and asserts the staging root is gone and the accepted layer head
  is unchanged; `cancelled_slope_job_removes_its_staging_root` does the same for
  a cancelled run; `startup_pruning_removes_abandoned_staging_roots_only` proves
  a crashed run's staging root is pruned at startup while a published `gen-*`
  directory survives.

Regression status: the full `services::lidar` suite passes with
`--include-ignored` (83 passed) except `e2e_import_publish_slope_restart_reuse`,
which requires the external IGN MNT fixture (`CANOPI_LIDAR_E2E_FIXTURE`) and is
unavailable here. The hermetic observability counters used by three decode
assertions are now thread-local, because they were process-global and a
concurrently running reader test could reset another test's evidence.

## Limits, unavailable evidence and known gaps

- **The sparse format is not enabled in production.** `chunked_publication_enabled`
  is a `const fn` returning `false` outside tests, so no user workflow can
  publish `cog-chunks-v1` yet. The gate exists because the display path is not
  finished: the native renderer and its command exist, but MapLibre reaches a
  tile through the raster protocol adapter, which is not installed yet, so a
  chunked generation now renders through the protocol adapter behind a bounded
  shared cache, but the switch still waits for the B5 verification runs: the
  real-fixture lifecycle, the sparse-gap case and the recorded resource
  measurements that justify the change of default storage.
- No `base_generation_id` overlay: a legacy head without durable member history
  still takes the accepted dense route (correct, but not the sparse target).
- **Lattice anchor.** Schema v10 records one lattice per layer, chosen by the
  layer's first accepted source, and a sparse publication inherits it instead
  of the re-anchored union, so extending a layer left or up no longer moves
  unchanged members' chunk coordinates (verified: the anchored member keeps
  chunk 0 while the extension lands in a negative chunk). What remains is that
  a *dense* generation's mosaic still uses its own re-anchored union grid, so a
  layer that was dense first and sparse later records the anchor from that
  first dense publication; the sparse formats of one layer are consistent with
  each other from then on.
- Review classification is block-wise. `stage_import` and
  `render_decision_preview` walk the union in 1024-cell blocks: each block unions
  the incoming sources' validity (so overlapping files count once), compares it
  once with the accepted head, and reduces the result into both previews on a
  bounded target of at most 512 per side. The envelope's cell count is
  arithmetic, so the gap is a number rather than a walk, and `invalid_cells`
  keeps its meaning as envelope minus unique incoming valid cells. The
  consequence is measured: the real 12-tile MNH batch (48M cells) now imports
  under **production admission limits with no raised ceiling**, and its peak
  resident set fell from 315 MiB to **39 MiB**; the 45M-cell sparse-gap run and
  the 60.8M-cell 24-tile run likewise need no dense-area ceiling, and each runs
  about half as long as before.
- The retained source COG is still not written by staging, so sparse members are
  read from durable dense raw/mask assets; retained source COGs and their
  content-addressed admission remain open.
- Review classification still assembles a dense union buffer before classifying;
  reads are bounded, the assembly is not. Block-wise classification without
  visiting the gap is B2/B4 work.
- A no-change Apply materializes chunks and leaves unreferenced
  content-addressed assets behind, because the no-change decision needs the
  resolved counts. Asset reclamation for unreferenced published assets is open.
- The memory measurement is a process high-water mark, not a sampled
  process-tree trace: a GDAL child's own transient peak is not captured, so the
  number is a lower bound for the tree. The design's sampled-tree measurement
  remains open.
- The **400M-cell plane was not attempted**: its preflight needs at least 8 GiB
  of free host RAM and this host reported 31.3 GiB total but only **6.5 GiB
  available** (88.9 GiB disk free, 8 cores), so the design's rule applies —
  finish everything else, retain the production admission limits and report
  this exact incomplete gate rather than calling capacity enabled. The retained
  resolved chunks' disk cost was measured only for the runs above (12.6 MB for
  3 chunks, 48 chunks for the MNH batch); no disk-budget sweep was made.
- Windows capacity/asset behaviour remains uncompiled here, as recorded in the
  predecessor receipt.

## Next dependency

Everything the migrated workflows need now exists, is block-bounded, and is
exercised on real data inside production admission limits, so the next
session's order is: (1) the legacy-base overlay
(`base_generation_id`) for heads whose member history is not reconstructible,
and retained source COGs, so no preserved legacy head keeps the dense route;
(3) the conditional admission switch, which may remove the 16-file, 512 MiB,
1 GiB and 25M-cell limits only after (1) and (2) land and the 400M-cell plane
gate can actually run on a host with 8 GiB free; (4) then the format gate flip,
the consolidated receipt and the LiDAR/build/MapLibre guide updates. Do not
flip the gate, remove a limit or delete the dense callers before those land.
