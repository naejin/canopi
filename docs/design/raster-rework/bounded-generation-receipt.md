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
| B4 — bounded display transport and Desktop protocol | **Partly delivered**: the presentation contract carries a tagged tile source (preserved asset pyramid vs native generation), the library renders bounded 256×256 tiles from an immutable sparse generation through an executor-backed command returning raw PNG bytes or an explicit empty/unavailable outcome, and the frontend builds and parses the `canopi-raster://` template. Still open: the MapLibre protocol adapter and its lifecycle, the display request/queue and cache budgets, and lifting the publication gate |
| B5 — end-to-end verification and conditional limit removal | Not started |

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
| Tagged tile-source contract, bounded native tile renderer and command, raster URL builder | the commit that carries this receipt |

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
  authority is never bypassed silently.
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
  chunked generation would still show nothing on the map (and its slope result
  would carry no display either). Enabling the switch before that adapter and
  the display budgets land would leave a Ready layer the map cannot render.
- No `base_generation_id` overlay: a legacy head without durable member history
  still takes the accepted dense route (correct, but not the sparse target).
- The retained source COG is still not written by staging, so sparse members are
  read from durable dense raw/mask assets; retained source COGs and their
  content-addressed admission remain open.
- Review classification still assembles a dense union buffer before classifying;
  reads are bounded, the assembly is not. Block-wise classification without
  visiting the gap is B2/B4 work.
- A no-change Apply materializes chunks and leaves unreferenced
  content-addressed assets behind, because the no-change decision needs the
  resolved counts. Asset reclamation for unreferenced published assets is open.
- The real 48M-cell batch, 24-source sparse case, 400M-cell plane and 12-tile
  MNH run were not attempted; no capacity limit was removed and no disk/memory
  measurement of retained chunks was made.
- Windows capacity/asset behaviour remains uncompiled here, as recorded in the
  predecessor receipt.

## Next dependency

The next session needs, in order: the B3 slope reader over resolved core+halo
windows (which removes the explicit chunked-head refusal in `analysis.rs`) and
the shared heavy-job lease with `canopi-jv8a.3`; then B4's bounded display
transport and Desktop tile protocol, which is what allows the publication gate
to be lifted; then the legacy-base overlay and source-COG retention; then B5's
capacity gates. Do not enable the gate, remove production limits or delete the
dense callers before those land.
