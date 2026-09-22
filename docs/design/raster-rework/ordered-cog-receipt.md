# Ordered COG Data Layers — delivery receipt

Status: evidence — the [ordered COG design](ordered-cog-design.md) is implemented on `feature/bounded-raster-generations`: a Data Layer is now an ordered collection of independent source COGs whose value is the highest-priority valid sample at each location, shared by display, review and slope, and no new edit materializes a merged elevation raster. Undo, History, the source list, the dependent-analysis refresh and the compatibility transition are wired through the real callers. Independently reviewed: no — this delivery awaits the main agent's disposition. Integrated or released: no.
Tracking: `canopi-jv8a.4` (kept open for independent disposition); `canopi-kko3` is resolved by the delivered recompute-after-Undo decision; parent `canopi-jv8a`, epic `canopi-j571`.
Current guidance: [design](ordered-cog-design.md), [assignment](ordered-cog-agent-prompt.md), [ADR 0027](../../adr/0027-ordered-cog-data-layers.md), [LiDAR](../../agent/lidar.md), [delivery](../../workflow/delivery.md).

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
| Ordered collection storage, snapshot edits and the retired merge machinery | the commit that carries this receipt |
| Frontend source list, version actions, translations and tests | the commit that carries this receipt |
| Documentation reconciliation and this receipt | the commit that carries this receipt |

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
Independent acceptance of the fix is the main agent's call, not claimed here.

## Migration and compatibility limits

- **New work is ordered; old work stays exact.** A new source generation is `ordered-members-v1` and stores member metadata only. `legacy-dense-v1` and `cog-chunks-v1` generations remain readable through their own accepted readers, and persisted slope results remain sparse resolved chunks. Neither is eagerly converted, deleted or re-encoded.
- **A pre-transition head is one member.** Its masked replacement history cannot be reduced to a priority stack, so it is exposed as one indivisible bottom member labelled "Previous composition". It can move or be removed like a source; its internals cannot be reordered.
- **Dense compatibility costs one derivative per preserved generation.** A dense mosaic is not in the controlled COG profile, so the library prepares one GDAL derivative per preserved generation and owns it for the library's lifetime. This is a read-time compatibility cost, not a new publication path.
- **Display bounds are the occupied-block envelope.** Matching the superseded sparse route keeps a layer's map footprint stable across the transition, so a composition with distant members still reports the envelope between them rather than the exact coverage extent.
- **Production admission limits are unchanged.** 16 files, 512 MiB per source, 1 GiB per selection and 25 000 000 union-envelope cells for new imports. Reorder, remove, Undo and restore are not new import admission and are not bounded by them. No capacity evidence is claimed here.
- **Undo of a layer's first change publishes the empty composition.** The layer stays valid, accepts sources again, and the import it replaced remains restorable from History.
- **`LidarLayerSource.filename` is a short digest.** The catalogue does not retain an original file name for a committed source, so the list shows a stable 12-character identity cue instead of inventing one; a truthful name would need a new catalogue column and is a follow-up.

## Unavailable observations

- **The isolated real-Desktop workflow did not run, and the missing prerequisite is now exact.** This
  session's shell runs inside a private PID namespace (`bwrap --unshare-pid`), the host has no
  `Xvfb`/`xvfb-run`, and `DISPLAY=:0` is the user's live session with their own Canopi instance and
  file dialogs open. So a second instance cannot be given its own display, and a process started from
  here cannot afterwards be observed or stopped: `pgrep`/`ps` see only this sandbox, which is exactly
  how an earlier check in this session wrongly concluded that no Canopi instance was running. A
  window-list contradiction (`xwininfo`) corrected it. That sandbox limit is itself the finding: no
  host-process observation from this environment is evidence.
- **Runnables for the revision that carries this receipt.** (1) From the implementation worktree,
  `cd desktop/web && npm run dev -- --port 1430 --strictPort`; launch the app with
  `cargo tauri dev --config '{"build":{"devUrl":"http://localhost:1430","beforeDevCommand":null}}'`,
  started as a managed background job so it can be stopped again. (2) Use a fresh disposable profile:
  one newly created temp root holding `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` and a
  `0700` `XDG_RUNTIME_DIR`, inside `dbus-run-session`, preserving the user's own instance, data and
  ports 1420/1422. Confirm the window's own geometry with `xwininfo` and hit-test the pointer before
  every synthetic event. (3) Fixtures: an identified real MNT plus a small aligned authored overlay,
  a second authored overlay for the reorder case, and one that re-declares the layer CRS with
  different WKT for the refusal step. (4) Observe in the real window: **Add TIFFs** → staged sources
  → **Add sources** → the raster appears and the source list shows the new source topmost with a
  disabled ▲; move it down and watch the composed values change where the sources overlap; hide/show
  the group eye and confirm the composition and the analysis job count do not change; **Create
  slope**; **Remove** a source and confirm the confirmation names the retained history; **Undo last
  change** repeatedly until the action disables itself, and confirm the map and the open History
  update without reopening and that the slope refreshes; **Restore this version** on an older entry
  and confirm an equal composition republishes nothing; change the selected layer while a read is in
  flight and confirm the late answer does not replace the new selection's list; save, close, relaunch
  and reopen the same Design and confirm layer, sources, versions, filenames and visibility survived;
  finally import the foreign-CRS raster and confirm it is refused by name with no generation
  published. (5) Capture the window, the app log and the analysis job rows as evidence. A helper
  test, the gallery or a SQLite inspection is not a substitute for a claimed live map action.
- **Automated/component evidence is not a live-window pass.** The panel behaviour is covered by
  component tests with deferred answers, and the backend settlement by caller tests; neither shows
  what the real WebView does with a MapLibre source replacement.
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

Independent disposition by the main agent, then the user's integration decision. The follow-ups this delivery deliberately leaves open are: the real-Desktop workflow observation; truthful source display names; a capacity/measurement pass for the ordered route if the courier wants the admission limits revisited; and the deferred general reclamation of unreferenced published assets. Nothing here changes production admission limits, integrates the branch into `main` or releases anything.
