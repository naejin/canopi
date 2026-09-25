# Ordered COG Data Layers — delivery receipt

Status: evidence — ordered COG correction delivered through `34e4ded4` and independently accepted in the named R12–R14 scope; see the [disposition](ordered-cog-review.md#accepted-correction-at-34e4ded4). Integration/release and broader completion remain separate.
Tracking: `canopi-jv8a.4` (status reconciliation delegated to the completion assignment); `canopi-kko3` is resolved by the delivered recompute-after-Undo decision; parent `canopi-jv8a`, epic `canopi-j571`.
Current guidance: [design](ordered-cog-design.md), [assignment](ordered-cog-agent-prompt.md), [ADR 0002](../../adr/0002-geolibre-module-reuse.md), [LiDAR](../../agent/lidar.md), [delivery](../../workflow/delivery.md).

## What is delivered

| Design phase | State |
| --- | --- |
| 1. Catalogue + resolver + compatibility | **Delivered.** Schema v14 adds `lidar_collection_members` (stable `member_id`, top-first `position`, kind `source` \| `previous-composition`, originating job) and v15 adds the snapshot lineage `previous_generation_id`. `collection.rs` owns snapshot load, measurement, insertion and history; `generation.rs` owns one bounded resolver (`CollectionReader` + `GenerationReader`) over the ordered list. A pre-transition head becomes one indivisible bottom member that references the preserved generation directly, so no compatibility wrapper nests. Migration is additive, keeps the WAL-consistent `VACUUM INTO` backup and refuses a future schema version. |
| 2. Import + edits + lifecycle + transport | **Delivered.** `apply_import` publishes an ordered snapshot — member rows plus one bounded measuring pass — and materializes nothing. `move_member`, `remove_member`, `undo_last_change` and `restore_version` publish a new head under the layer-wide heavy lease with expected-head validation, and `settle_layer_edit` runs the dependent-refresh path exactly once on settlement. Typed transport adds `LidarLayerCollection` / `LidarLayerSource` and five commands; the native command policy guard passes. Slope resolves the composed elevation window plus its halo before computing. |
| 3. Dock + presentation | **Delivered.** The existing Layers dock shows the top-first source list with filename, coverage, move up/down and Remove (with its retained-history confirmation), plus an explicit "Undo last change" and per-version "Restore this version". The import route now confirms **Add sources** with the ordered-insertion explanation and no longer offers the retired overlap decisions, exact overlap counters or Before/After merge tabs; its staged-source list still names every rejected input and its reason, and the confirmation is refused while any selection is incompatible. All 11 locales carry the new strings and the 13 retired preview/decision keys are removed. Group visibility remains one eye and never touches the composition. |
| 4. Product verification + retirement | **Delivered.** The new-write merge machinery is removed (`prepare_chunked_generation`, `publish_applied_chunks`, `publish_undone_chunks`, `materialize_generation_chunks`, the opaque-base overlay occurrence and `undo_removes_member`), while every legacy reader a preserved generation needs is retained. Repository gates pass on the final candidate; the real-Desktop workflow is recorded as unavailable here with exact runnable steps. |

## Revisions

| What | Revision |
| --- | --- |
| Baseline | `0696bd3d` on `feature/bounded-raster-generations` (accepted predecessor `a5fc7d7b`) |
| Forwarded documentation commit incorporated | merge of `06c1498c` |
| Ordered collection storage, snapshot edits and the retired merge machinery | `64050896` |
| Frontend source list, version actions, translations and tests | `64050896` |
| Documentation reconciliation and this receipt | `524eef55` |
| Forwarded correction brief incorporated (current prompt/design/review) | `34bf6041` |
| R12 tile candidate bounds, R13 edit lifetime, R14 view-request identity | `d53f4185` |
| Mounted-map evidence, receipt/debrief/guide reconciliation | `1bf4e6fe` |
| Prompt status closed | `a685cc87` |

## What changed, precisely

- **One composition, resolved on demand.** `CollectionReader` holds the top-first member list reversed into resolver order and applies one uniform "paint the valid sample" rule, so the highest-priority source wins by being painted last. `GenerationReader` dispatches between that composition and a preserved chunked generation, so display, review, slope and the head read all consume the same numbers through one seam.
- **Publication materializes member metadata only.** `collection::measure` visits only the composition's occupied 1024-cell blocks and streams each through the resolver, deriving exact valid cells, the finite value range and the display bounds. No chunk asset, mosaic or coverage file is written for a new source generation, so a reorder or an Undo re-encodes nothing.
- **A snapshot names its predecessor, not its publication time.** `previous_generation_id` records the head that was current when the snapshot was published. Undo therefore restores the predecessor of the *change* it is undoing, so repeated Undo walks backwards through prior user changes instead of toggling between a restoration and the snapshot it replaced; an explicit restore records the current head as its predecessor and is itself undoable. Undoing a layer's first change publishes the empty composition, which the layer can accept sources into again.
- **Every numeric edit refreshes dependents on settlement.** `begin_member_edit` takes the heavy raster lease before creating work, runs the caller-level operation off the UI thread, and `settle_layer_edit` refreshes the snapshot and enqueues one analysis refresh per definition. This closes `canopi-kko3` by construction: recompute after Undo exactly as after Apply, through the same orchestration.
- **Review reads the composition, not a store.** `HeadBlockSource` gained the format-driven reader variant, the accepted head's own lattice now seeds the review union for an ordered head, and `BlockStream::occupied` derives an ordered collection's occupied blocks arithmetically from member extents, so the empty gap inside the envelope still contributes neither work nor metadata.
- **Reduction cells follow occupied blocks.** `CollectionReader` caches its occupied block set, `GenerationReader::chunk_is_occupied` lets the tile renderer skip a block that holds no coverage without opening anything, and `CollectionReader::aggregate` answers a reduced footprint from the occupied chunks it intersects. That keeps a deeply minified display tile affordable without inventing a second stored representation.
- **The compatibility base is library-owned.** A dense mosaic is not in the controlled COG profile, so `LidarLibrary::compat_lease` prepares one GDAL derivative per preserved generation, reuses it for every later read, and releases it when the layer is deleted. `delete_layer` also clears the collection rows and the self-referencing lineage before removing generations.
- **One deliberate retention.** The backend `lidar_preview_import_decision` command and its `render_decision_preview` caller remain, because the review's Before/After renderers are still the detector for "the accepted head's own composed values" (the preview regression reads them) and the design's later interaction slice owns retiring the old preview entry points. The frontend no longer exposes any path to them, so no user can reach a merge decision.
- **Retired new-write machinery.** The merge-model publication paths and their helpers are gone; `lidar_generation_members`, `GenerationChunkReader`, `persisted_chunks` and the dense read remain, because preserved generations, persisted slope results and the compatibility tests still read through them.

## Correction at `d53f4185` — R12–R14 and the mounted map

The [review of `524eef55`](ordered-cog-review.md#current-disposition-at-524eef55) reproduced three
failures and recorded that the earlier live pass never mounted the map. All three are repaired with an
ordinary regression each, and the mounted-map observation is now established in an isolated profile.

| # | Reproduced failure | Repair | Regression (boundary) |
| --- | --- | --- | --- |
| R12 | `tile_read_bounds` bounded sample centres with one native cell of padding, so a source inside a level-dependent reduced footprint was filtered out and the tile rendered `Empty` | the candidate footprint is derived from the read geometry itself: a native-scale sample reads its two cells per axis, a minified sample reads the two reduced cells around its own cell, whose footprints reach `2 * side` native cells (checked arithmetic, existing read limits and member filtering retained) | `a_tile_near_its_edge_keeps_the_sources_inside_its_reduction_footprint` (caller: two overlapping 2×2 fixtures at tile 14/8192/8191 — the composed level-3 cell mean renders, the level-0 tile still draws) and `tile_candidate_bounds_enclose_the_reduced_windows_they_read` (geometry) |
| R13 | `runEdit` cleared `pending` only when the request generation still matched, so navigating during an edit left every edit control disabled forever | the awaited edit owns the panel's pending state until its own settlement; only its view refresh is fenced to the selection that submitted it; unmount detaches view work without cancelling the submitted edit | `settles a pending edit after the view moves on`, `settles a rejected edit after the view moves on and keeps its message`, `detaches on unmount without cancelling an edit already submitted` (panel, deferred commands) |
| R14 | collection and History reads shared one request generation and one loading flag, so a late same-layer answer replaced the refreshed head, mixed-head pages appended, and one settled read enabled controls while the other was still in flight | collection and History each own their traversal identity and loading state; a page appends only into the traversal that produced it; a head/selection change supersedes the traversal; History actions wait until both pages describe one head, and a settled disagreement is re-read once | `keeps the refreshed head when an older same-layer read answers late`, `keeps the refreshed history when an older same-layer read answers late`, `does not append a page from a superseded traversal after a refresh`, `keeps History actions disabled until their own read settles` (panel, deferred responses) |

Red/green was demonstrated by restoring the superseded behaviour, not asserted: with the old
`tile_read_bounds` body both R12 tests failed (the caller test panicked on `Empty`) and returned to
green when the fix was restored; with the pre-fix `LidarLayersSection.tsx` all six new panel tests
failed and passed again with the fix. The pre-fix component addition was also probed on its own —
removing only the unmount guard fails `detaches on unmount…`. Each restoration was byte-verified.

Adjacent behaviour found while reviewing the diff and kept: no new helper was needed beyond the two
traversals and the `headsConsistent` check the design already required; `ViewTraversal` carries no
unused field, and a torn-down panel starts no further view work.

### Mounted-map evidence in an isolated profile

Second use of the recipe below, on the revision that carries the section: the app built from this
worktree, its own nested X server, a disposable profile, real pointer and keyboard input, and a
screenshot at every step. Evidence directory, local and ignored: `.rq-scratch/smoke-map-K9t/` (PNGs,
`act.py` with hit-tested input and text-targeted clicking, the profile and its `lidar-library.sqlite`).
The user's app, profile, display and ports were never used; `:99` and 1430 were checked free first.

| Step | What the live window showed | Screenshots |
| --- | --- | --- |
| Design Location | Location tab mounted the real basemap; a geocoder result previewed "Selected location 48.4312, 0.0911"; **Confirm location** published "Confirmed site 48.4312, 0.0911" — the state the earlier pass left provisional | `03-location`, `06-preview`, `07-confirmed` |
| Import and mount | Layer **Ground A** created, two fixtures added through the native chooser and the review panel; **View coverage** flew the canvas onto the coverage and the ordered COG rendered over the basemap at 3 % zoom | `18-staging`, `19-applied`, `22-map-a-top` |
| Rendered order | rank 1 `smoke-ground-a.tif` → the whole 1 km² square carries A's own gradient; **↓** republished the order (rank 1 `smoke-ground-b.tif`) and the same canvas redrew in place as A's low frame plus B's dark high square, without reopening the panel or restarting | `22-map-a-top`, `23b-map-b-top` |
| Undo → Restore | **Undo last change** returned the canvas to A's gradient (`Undo#3`); **Restore this version** of `Reorder#2` published `Restore#4` and the frame-plus-square render returned | `27-map-after-undo`, `30-hist`, `38b-map-after-restore` |
| Whole-layer visibility | the eye removed the whole raster and left the basemap, and restored it with the same composition | `39-map`, `40-map`, `41-visible`, `42-map` |
| Zoomed-out edge | six wheel steps out showed the coverage as an island with all four edges and the basemap labels around it | `43-map` |
| Slope currency | **Create slope** produced `Ground A · Slope / Slope (degrees) · ready`; a live move then published a new head and the catalogue carried one new job and generation for it, completed and re-pointed — and a later edit did the same again | `48-panel`, `49-row`, `65-after-move`, `66-rows` |
| Navigation during a pending edit | a **↓** move was followed immediately by leaving the Layers panel for another dock panel (unmounting it mid-edit): the edit still settled and published `gen-18d79dc7cb5799f10015`, and the next edit from the remounted panel published another head — controls were live, not orphaned | `67-left-panel`, `68-returned`, `74-live-edit` |
| Save and reopen | File → **Save As** wrote `smoke-map.canopi`; after an app restart the Design reopened with `LiDAR 1`, `Ground A` ready, `Ground A · Slope` ready and History intact, and **View coverage** re-rendered the same composed surface — the mounted map survives the round trip | `76-savedialog`, `81-saved`, `83-reopened`, `84-panel`, `85-coverage-after-reopen` |

The catalogue was read back as ground truth; the rendered states correlate with the head identities:

| Visible state | Head | Topmost member | Range |
| --- | --- | --- | --- |
| A's gradient only | `gen-…0008` (import) and `gen-…000c` (undo), `gen-…000e`, `gen-…0015` | `mem-…0006` (`smoke-ground-a.tif`) | 150.84 … 191.81 |
| A's frame + B's dark square | `gen-…000b`, `gen-…000d`, `gen-…0012`, and the reopened `gen-…0018` | `mem-…0007` (`smoke-ground-b.tif`) | 150.84 … 1183.27 |

Every numeric edit in the pass produced exactly one dependent analysis job and generation (four in
total), each completed, and the analysis head always pointed at the generation computed from the
current layer head; schema stayed at v16, so no migration was involved.

### Gates on the correction candidate

| Gate | Result |
| --- | --- |
| `cargo fmt --all -- --check` | clean |
| `CARGO_SKIP… cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `cargo check --workspace` | clean |
| `cargo test -p canopi-desktop --lib native_command_policy` | 13 passed / 0 failed |
| `services::lidar --include-ignored --skip services::lidar::e2e --test-threads=1` | **176 passed / 0 failed** in 575.64 s (two more than the earlier lane: the new tile regressions) |
| `cd desktop/web && npx tsc --noEmit` | clean |
| focused Vitest (`lidar-layer-priority`, `lidar-layer-collection`, `lidar-actions`, `lidar-library-store`) | 27 passed / 0 failed |
| `git diff --check` | clean |

The unchanged migration, admission, compatibility and slope evidence above keeps its original revision;
the suite counts in this table are this revision's runs and replace nothing silently. Windows/macOS
compilation and the external IGN fixture remain unavailable exactly as recorded below.

## Finding-to-regression map

Every finding from the [independent review](ordered-cog-review.md) is answered at the boundary the
review named, with the counterexample it gave as the input. The disposition column states what the
repair changed; "caller" means the regression drives the real public surface, not a helper.

| # | Finding | Repair | Regression (boundary) |
| --- | --- | --- | --- |
| 1 | Collection reads deadlock on their own catalogue lock | the read holds one connection and never calls a public method that re-acquires it | `a_public_collection_read_does_not_re_acquire_the_catalogue_lock` (public read on an empty layer, own thread with a deadline so a regression fails instead of hanging) |
| 2 | Edit completion and the visible selection are not connected | the four edit commands await the real edit and its settlement and return a typed outcome (`LidarLayerEditOutcome`); the panel keeps controls disabled while a read or edit is in flight, fences answers by layer + request generation, re-reads the head after a refusal, and keeps the failure message on screen; History and sources are re-read on every settlement | `undo_stops_at_empty_and_restoring_an_equal_composition_is_a_no_op` (caller), `lidar-layer-priority.test.tsx` (pending disables controls, a late answer cannot replace a newer selection, a refusal stays visible and re-reads), `lidar-layer-collection.test.ts` (typed outcomes, deferred responses) |
| 3 | Published statistics use the superseded composition roles | one composition rule everywhere: `compose_union_block` paints valid incoming, `CollectionReader::new` normalizes every ordered occurrence to topmost-valid, and publication builds incoming occurrences with that rule | `published_statistics_match_the_reopened_composition` (caller: full-cover 9 over 5 publishes 9..9 and reopens as 9) |
| 4 | Import admission is incomplete | one common CRS/grid anchor for a first batch; preparation's valid count is persisted and a zero-valid source is refused by name; `prepare_apply` and `apply_import` refuse a partially rejected batch; the envelope is the current composition's extent plus the selection, separate from the lattice anchor | `a_first_batch_refuses_sources_that_disagree_on_the_horizontal_crs`, `an_all_nodata_source_is_refused_by_name`, `the_admission_envelope_follows_the_current_composition` (all caller; the envelope case admits two small imports whose third composition crosses 25M while the anchor-relative check stays far below it) |
| 5 | The transition can alter accepted historical data | a pre-transition head is wrapped as itself, never through `base_generation_id`; a sparse preserved composition keeps its signed chunk extent and is read through the member-to-lattice offset | `the_previous_composition_wraps_the_actual_accepted_head`, `a_sparse_previous_composition_keeps_its_signed_extent` (caller; both build the pre-repair shape directly) |
| 6 | Slope has three correctness holes | eligibility resolves through the composition's own members (source COG, preserved mosaic or preserved record); a superseded job settles as the scheduler's stale outcome on the sparse route too; readiness is derived from result/source identity and composition emptiness at presentation, and startup re-schedules stale definitions once the executor attaches | `slope_accepts_a_previous_composition_only_layer`, `a_superseded_sparse_slope_job_settles_as_stale`, `an_old_result_is_not_ready_after_the_head_changes` (caller, including a restart) |
| 7 | Undo/history boundaries and restore equality are inconsistent | Undo availability and its target are recorded explicitly (schema v16); Undo publishes the target and inherits the target's next-Undo state; a no-op publishes nothing; restore compares ordered occurrence identities; the real operation is recorded instead of inferred | `undo_stops_at_empty_and_restoring_an_equal_composition_is_a_no_op` (caller: first change undoes to empty, the next Undo is refused, restore is undoable and an equal composition is a no-op, operations and cues are exact), `v15_catalogue_migrates_to_an_explicit_undo_baseline` (catalogue) |
| 8 | Source-region facts reread the first block | the chunk-local clip is translated back to the member's own pixel coordinates; zero-valid blocks are excluded from stored extrema | `source_region_facts_cover_later_blocks` (caller + public source list: a 2048×1 half-NoData source reports 1024 covered cells and a 7..7 range) |
| 9 | Incremental read surfaces are unbounded | collection summary, member pages and history pages are separate bounded responses with snapshot-bound / upper-bound cursors; a numeric window resolves only the occurrences whose own extent intersects it | `a_window_resolves_only_the_occurrences_that_can_reach_it` (caller), `lidar-layer-priority.test.tsx` (paging appends, a page bound to another snapshot is refused), `lidar-layer-collection.test.ts` (cursors) |
| 10 | The UI contract is unfinished | the stored original filename is joined through the interpretation's own source relation; History shows each version's recorded operation and its publication-order cue; the retired overlap counters are gone from the import confirmation | `lidar-layer-priority.test.tsx` (filename, neutral label for a migrated version, unique cue, no counters), `lidar-import-progress.test.tsx` |
| 11 | Cancellation does not reach the compatibility read | the caller's token is threaded through the snapshot load and checked before the lease is published | `a_cancelled_read_does_not_prepare_a_compatibility_lease` (caller: a cancelled read refuses by name and leaves the lease cache cold; a live token is the healthy control) |

A helper assertion is never the whole claim: rows 3, 5, 9 and 11 additionally read the published
value back through the public head window or the public list, and rows 2, 9 and 10 drive the real
panel with deferred answers rather than immediately-resolved mocks.

## Evidence

### Regression strength on the repaired boundaries

The regressions were written with their repairs, so no RED-before-GREEN is claimed for them. What is
recorded instead is a guard-removal probe round on the delivered revision: each probe restores one
piece of the superseded behaviour, runs the named regression, and the file is restored and verified
afterwards.

| Probe (superseded behaviour restored) | Regression | Result |
| --- | --- | --- |
| `layer_collection` reads history through the public method again | `a_public_collection_read_does_not_re_acquire_the_catalogue_lock` | **FAILED** as required (the read deadlocked and the deadline fired) |
| ordered occurrences are no longer normalized to topmost-valid | `published_statistics_match_the_reopened_composition` | **FAILED** as required (published 5..5 while the snapshot reads 9) |
| the previous composition wraps `base_generation_id` again | `the_previous_composition_wraps_the_actual_accepted_head` | **FAILED** as required (the accepted 7 became the base's 5) |
| the preserved sparse member keeps only the manifest rectangle | `a_sparse_previous_composition_keeps_its_signed_extent` | **FAILED** as required (the far chunk read as invalid) |
| source-region facts use chunk-local coordinates again | `source_region_facts_cover_later_blocks` | **FAILED** as required (1024 covered cells became 0) |
| incoming occurrences carry the review's roles again, normalization intact | `published_statistics_match_the_reopened_composition` | **PASSED** — and that is the intended result: the one-rule normalization in `CollectionReader::new` prevents the wrong composition independently of how the occurrence was built. The probe above shows the composition rule itself is detected; this one shows the second layer of defence is real rather than decorative. |

The probe harness patches one guard, runs the named test, then restores the file from a byte copy
and verifies the restoration; `git status` shows no probe residue afterwards. Log:
`.rq-scratch/sensitivity-probes.log` (transient, not committed).

### Focused caller-level tests (GDAL required)

- `ordered_stage_review_apply_reorder_remove_undo_and_restore_keep_exact_values` runs the whole product workflow through the real callers: stage and review a bottom source, Apply, reopen the library and read the values back, add a second source above it, move it below, Undo twice walking further back, restore a version explicitly, remove an occurrence, and confirm every earlier version is still listed with exactly one current head and that a stale edit is refused by name.
- `an_undo_refreshes_the_dependent_analysis_it_restored` drives `canopi-kko3` end to end with the Apply path as its control, including the no-op case.
- `ordered_collection_resolves_topmost_valid_without_materializing_anything` and `preserved_composition_reads_exact_values_with_the_authoritative_mask` prove the numeric and compatibility rules at the resolver.
- The finding-to-regression map above lists every repair's decisive test.

### Frontend

- `lidar-layer-priority.test.tsx` drives the real panel: the stored filename and the neutral label for a migrated version, a unique version cue per entry, controls disabled for the whole round trip of a pending edit, a refusal that stays visible and re-reads the head, paging that appends the next page, and Undo disabled with an explanation when the walk is exhausted.
- `lidar-layer-collection.test.ts` covers the ordered actions and their cursors: a member page is bound to the snapshot it was requested from, a history page keeps its captured upper bound, a move sends the expected head, a no-op message stays visible, and a rejection re-reads the library.
- `lidar-import-progress.test.tsx` covers the import route: the **Add sources** confirmation exists, the retired overlap decision and Before/After tabs are gone, the ordered-insertion rule is stated, and an incompatible selection keeps the confirmation disabled with its reason.

### Live Desktop workflow in an isolated profile

At revision `524eef55`. The real Desktop workflow ran on the revision that carries this receipt: the
app built from this worktree, a nested X server of its own, a disposable app profile, real pointer and
keyboard input, and a screenshot of the app window at every step. The user's own instance, profile and
ports were never touched. Evidence directory, local and ignored: `.rq-scratch/smoke-repair-K7Qm/`
(numbered PNGs, `driver.py` with its hit-test, the profile and its `lidar-library.sqlite`). This pass
never mounted the map; the [correction pass](#mounted-map-evidence-in-an-isolated-profile) reused its
recipe and closed that gap.

| Step | What the live window showed | Screenshots |
| --- | --- | --- |
| Add | **Add TIFFs** → native dialog → two selected COGs → the review lists both and states they are added above the layer's existing sources in the listed order → **Add sources** → "Import complete … ready" | `29-review-panel`, `30-after-add` |
| Ordered members | Sources 2 — rank 1 `smoke-ground-a.tif` 4 000 000 cells, rank 2 `smoke-ground-b.tif` 1 000 000 cells; layer 1 km² | `35-list` |
| Reorder | ↓ on rank 1 republished the order: rank 1 `smoke-ground-b.tif`, rank 2 `smoke-ground-a.tif`, with the edge arrows disabled at both ends | `36-list` |
| Remove | **Remove** → inline confirmation naming the retained history → layer coverage fell to 250 000 m², Sources 1 | `37-wide`, `38-list` |
| Repeated Undo | History named the operation behind every head — `Import#1`, `Reorder#2`, `Remove#3`, then `Undo#4`, `Undo#5`, `Undo#6` (0 sources · 0 cells · current) — after which **Undo last change** disabled itself as "There is no earlier version to undo." | `41-entries`–`44-entries` |
| Restore | `Restore#7` published; restoring `Undo#4` while the head was the equal-summary `Undo#5` (both "2 sources · 4 000 000 cells") published `Restore#8` and changed the live order to `smoke-ground-b.tif` first | `45-entries`, `47-panel`, `48-list` |
| Slope | **Create slope** produced `Ground A · Slope / Slope (degrees) · ready` | `49-list` |
| Selection during a read | History read started, selection moved to the analysis in the same interaction: the detail stayed the analysis, with no stale layer list, unchanged three seconds later | `55-view`, `56-view` |
| Restart | Design saved, app restarted, Design reopened from Recent: layer `ready`, Sources 2 in the same order and counts, History identical through `Restore#8 … Import#1` with Undo still available, slope `ready` | `71-sources`, `75-entries`, `76-top` |
| Foreign CRS | An EPSG:4326 source was refused in review — "no source could join layer 'Ground A': horizontal CRS differs from the layer; transforming foreign grids arrives in a later slice; grid incompatible with layer: pixel size differs …" — and the composition afterwards was untouched | `82-wide`, `84-final` |
| Dependent settlement | A live **Undo last change** published `Undo#9`, and the catalogue then carried a new analysis job and generation for that head with the analysis head repointed: the dependent slope was recomputed, not left stale | `91-view` |

The catalogue was read back after each phase as ground truth, and it agrees with the window: the
layer head's `members` list, `coverage_cells`, `min_value`/`max_value`, `operation` and
`undo_available` match the panel exactly, and the two equal-summary versions are distinguishable there
alone: `max_value` is 1 183.27 where the authored `+1000 m` overlay is topmost and 191.81 where the
base raster is.

Recipe, including what cost time here. The reusable form now lives in the
[edition guide](../../agent/edition-development.md#isolated-desktop-verification-on-a-nested-x-server);
the revision-specific findings were:

1. `Xephyr :99 -screen 1280x900x24 -ac -noreset -listen tcp -extension GLX` started from the host
   display, with `LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe MESA_LOADER_DRIVER_OVERRIDE=llvmpipe`.
   Without `-extension GLX` the nested server segfaults inside the NVIDIA EGL/GBM stack on this host,
   which is the difference between "no isolation available" and this section.
2. Vite on 1430, then
   `cargo tauri dev --config '{"build":{"devUrl":"http://localhost:1430","beforeDevCommand":null}}'`,
   both as managed background jobs so they can be stopped again, with `DISPLAY=:99`, `GDK_BACKEND=x11`,
   `LIBGL_ALWAYS_SOFTWARE=1`, `WEBKIT_DISABLE_COMPOSITING_MODE=1`, fresh `XDG_CONFIG_HOME`,
   `XDG_DATA_HOME`, `XDG_CACHE_HOME` and a `0700` `XDG_RUNTIME_DIR` inside `dbus-run-session`. A
   freshly created `$XDG_DATA_HOME/com.canopi.app` is the proof that the window is this instance's,
   because host PIDs are invisible from this sandbox.
3. The GTK file chooser wedges the app's main loop (repeating `Gtk-CRITICAL
   gtk_tree_model_get_iter_first`) when a path typed into its location entry contains a hidden-directory
   segment: `/…/canopi/.rq-scratch/…` arrived as `canopimopi/.rq-scratch/…` and every later click was
   swallowed until the app was restarted. Navigate the chooser by clicking its breadcrumb and rows, and
   keep fixture paths free of `/.` segments.
4. There is no compositor, so pixels under a native dialog are stale once it closes: resize the window
   by a few pixels to force a repaint before reading a screenshot.
5. The correction pass added one trap of its own: the inspector's "Coverage is outside this view"
   notice appears and disappears with the map view, which re-flows the panel mid-interaction, so a
   control's position has to be measured immediately before each click instead of reused. The Save
   dialog's **Name** field accepts an absolute path, which is the reliable way to save into an ignored
   directory.

### Repository gates on the final candidate

| Gate | Result |
| --- | --- |
| `cargo fmt --all -- --check` | clean |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `cargo check --workspace` | clean |
| `cargo test -p canopi-desktop --lib native_command_policy` | 13 passed / 0 failed |
| `services::lidar --include-ignored --skip services::lidar::e2e --test-threads=1` | **174 passed / 0 failed** in 570.57 s (log `.rq-scratch/repair-lidar.log`, transient) |
| `cargo test --workspace` | 405 passed / 0 failed across 14 targets (log `.rq-scratch/workspace-tests.log`, transient) |
| `cd desktop/web && npx tsc --noEmit` | clean |
| `cd desktop/web && npm test` | 2 657 passed / 0 failed (273 files) |
| `cd desktop/web && npm run check:types` | generated bindings match |
| `python3 scripts/check_docs.py` | 0 errors |
| `git diff --check` | clean |

### Final gate lane

Every gate above ran on one committed candidate after the last code change, in this order: Rust
formatting, strict workspace Clippy and check, the native command policy guard, the focused
`services::lidar` lane with `--include-ignored`, the workspace suite, then the frontend typecheck,
generated-binding check and the full Vitest suite, and finally the documentation and diff checks. The
private `e2e` fixture module is excluded from the focused lane by name, as the design's route
specifies, and its external IGN MNT fixture was not available here.

### `canopi-kko3` resolution evidence

The design settled this as "recompute after Undo as after Apply", not an open product choice.
`settle_layer_edit` runs the dependent-refresh path exactly once on the real settlement of every
committed numeric edit, and `an_undo_refreshes_the_dependent_analysis_it_restored` proves it at the
caller level: the Apply path is the control (its refresh enqueues a job for the new head and the
published result becomes current), the Undo enqueues its own refresh for the restored generation, the
analysis head ends pointing at that generation, and no current result still describes the composition
the user undid. Restoring the version that is already current publishes nothing and enqueues nothing.
Independently of the refresh, `an_old_result_is_not_ready_after_the_head_changes` shows that a result
whose captured source is no longer the head is never presented as Ready, including after a restart.
The live profile carries the same boundary: a real **Undo last change** published the next head and the
catalogue then held a fresh analysis job and generation for that head with the analysis head repointed
at it. Independent acceptance of the fix is the main agent's call, not claimed here.

## Migration and compatibility limits

- **New work is ordered; old work stays exact.** A new source generation is `ordered-members-v1` and stores member metadata only. `legacy-dense-v1` and `cog-chunks-v1` generations remain readable through their own accepted readers, and persisted slope results remain sparse resolved chunks. Neither is eagerly converted, deleted or re-encoded.
- **A pre-transition head is one member.** Its masked replacement history cannot be reduced to a priority stack, so it is exposed as one indivisible bottom member labelled "Previous composition". It can move or be removed like a source; its internals cannot be reordered.
- **Dense compatibility costs one derivative per preserved generation.** A dense mosaic is not in the controlled COG profile, so the library prepares one GDAL derivative per preserved generation and owns it for the library's lifetime. This is a read-time compatibility cost, not a new publication path.
- **Display bounds are the occupied-block envelope.** Matching the superseded sparse route keeps a layer's map footprint stable across the transition, so a composition with distant members still reports the envelope between them rather than the exact coverage extent.
- **Production admission limits are unchanged.** 16 files, 512 MiB per source, 1 GiB per selection and 25 000 000 union-envelope cells for new imports. Reorder, remove, Undo and restore are not new import admission and are not bounded by them. No capacity evidence is claimed here.
- **Undo of a layer's first change publishes the empty composition.** The layer stays valid, accepts sources again, and the import it replaced remains restorable from History.
- **A source's displayed name is its original file name, and identical bytes share it.** `lidar_sources` is keyed by content hash and stores `original_filename`, so the list shows the name the file arrived with; importing the same bytes twice therefore shows one name for both occurrences. A per-occurrence name would need a new column and is a follow-up, not a claim here.

## Unavailable observations

- **The earlier live pass at `524eef55` did not read the map.** That revision's isolated Design kept its
  provisional site, so order effects were read from the priority list and the catalogue, not from
  pixels. The [correction pass](#mounted-map-evidence-in-an-isolated-profile) confirmed a Design
  Location through the same UI and observed the rendered composition, so that gap is closed; what
  remains unobserved from the window is named below.
- **The legacy-only state is not reachable from the UI.** No import route produces a pre-transition
  chunked head in a fresh profile, so the `Previous composition` member, the compatibility lease and
  legacy-only slope eligibility were exercised by caller tests (`publish_legacy_chunked_head`, the
  preserved-generation fixtures) and not in the window.
- **The mounted-map pass used two synthetic MNT-derived crops** (`smoke-ground-a.tif` 2000×2000 and
  `smoke-ground-b.tif` 1000×1000, both 0.5 m EPSG:2154, the second the same crop authored +1000 m and
  offset 250 m south-east). They are labelled as synthetic here; the external IGN lifecycle fixture was
  not available, so no IGN dataset claim is made.
- **The window has no accessibility tree in this isolation.** AT-SPI reported no application objects,
  so element locations came from screenshots; every click was still hit-tested against the owning
  window before it was sent, and no synthetic event ever reached a display this session did not own.
  The correction pass additionally had to re-measure a control's position immediately before some
  clicks: the inspector's "Coverage is outside this view" notice appears and disappears with the map
  view, which re-flows the panel. That is a driving observation, not a product defect.
- **No host-process observation from this environment is evidence.** The shell runs in a private PID
  namespace (`bwrap --unshare-pid`), so `pgrep`/`ps` see only the sandbox: an earlier check in this
  session wrongly concluded that no Canopi instance was running until a window-list query contradicted
  it. Ownership has to be established by the profile the window writes into.
- **Windows and macOS are not compiled here**, so platform free-space, rename durability and
  asset-URL behaviour remain as recorded in the predecessor receipt.
- **No capacity, disk-budget or large-fixture campaign was run** for the ordered route. The
  representative 24-tile and sparse-gap runs still execute their authored coverage assertions, but
  their memory figures belong to the superseded route and are not restated as this route's
  measurements.
- **One retained complexity with no current caller benefit.** `MemberSource::LegacyDense` (a raw
  values/mask member payload) is still read because pre-retention libraries contain it, but an ordered
  composition can no longer produce it; it is kept for history, not for new work.

## Next dependency

Independent correction disposition is recorded at `34e4ded4`. The [completion assignment](completion-agent-prompt.md) now owns accepted-foundation integration and the broader rework. The follow-ups this
delivery deliberately leaves open are: truthful source display names for repeated imports of the same
bytes; a capacity/measurement pass for the ordered route if the courier wants the admission limits
revisited; the deferred general reclamation of unreferenced published assets; and the per-occurrence
name column the [design](ordered-cog-design.md#incremental-consumers-and-small-ui-corrections) keeps
out of this correction. Nothing here changes production admission limits, integrates the branch into
`main` or releases anything.
