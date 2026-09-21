# Bounded raster generations — delivery receipt

Status: evidence — partial implementer report for `canopi-jv8a.4` (B1–B5): **B1 storage primitives plus the first B2 production vertical slice**, which is implemented and tested but **deliberately gated off in production**. Not acceptance, integration or release.
Tracking: `canopi-jv8a.4` (parent `canopi-jv8a`, epic `canopi-j571`); `canopi-jv8a.3` is linked work inside B3.
Current guidance: [complete design](bounded-generation-design.md), [storage decision](../../adr/0026-sparse-raster-generations.md), [LiDAR](../../agent/lidar.md), [delivery](../../workflow/delivery.md).

## Scope actually delivered

| Design step | State |
| --- | --- |
| B1 — retained source COG, resolved/quality COG creation, reader ownership, catalogue index, resolver, legacy adapters, paged regions | **Delivered and verified**: committed-asset leases, controlled resolved/quality chunk creation with digesting and content-addressed admission, catalogue schema v7 with a WAL-consistent pre-migration backup and future-version refusal, the private resolver over ordered occurrences, the legacy TIFF-only derivative lease with an independently applied authoritative mask, and paged occupied-region aggregates |
| B2 — import/review/Apply/undo migration | **First vertical slice delivered and caller-tested, gated off**: stage → review → Apply → reopen → undo publish and read the sparse format through the real `stage_import`/`render_decision_preview`/`apply_import`/`undo_import` callers, with exact committed windows and preserved legacy generations. Still open: display publication for a chunked head, the legacy-base overlay for heads with no reconstructible member history, retention of the incoming source COG, and unreferenced-asset reclamation |
| B3 — slope core+halo and shared job ownership | Not started (`canopi-jv8a.3` remains open); slope refuses a chunked head explicitly |
| B4 — bounded display transport and Desktop protocol | Not started |
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
| Catalogue v8, format identity, gated stage→review→Apply→reopen→undo caller slice | the commit that carries this receipt |

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

Regression status: the full `services::lidar` suite passes with
`--include-ignored` (83 passed) except `e2e_import_publish_slope_restart_reuse`,
which requires the external IGN MNT fixture (`CANOPI_LIDAR_E2E_FIXTURE`) and is
unavailable here. The hermetic observability counters used by three decode
assertions are now thread-local, because they were process-global and a
concurrently running reader test could reset another test's evidence.

## Limits, unavailable evidence and known gaps

- **The sparse format is not enabled in production.** `chunked_publication_enabled`
  is a `const fn` returning `false` outside tests, so no user workflow can
  publish `cog-chunks-v1` yet. The gate exists because the display reader is not
  migrated: a chunked generation publishes no display tileset, and the accepted
  slope job refuses a chunked head explicitly instead of reading a path that does
  not exist. Enabling the switch before B3/B4 land would leave a Ready layer that
  the map cannot render.
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
