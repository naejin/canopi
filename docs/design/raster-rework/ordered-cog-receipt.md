# Ordered COG Data Layers — delivery receipt

Status: evidence — the [ordered COG design](ordered-cog-design.md) is implemented on `feature/bounded-raster-generations`: a Data Layer is now an ordered collection of independent source COGs whose value is the highest-priority valid sample at each location, shared by display, review and slope, and no new edit materializes a merged elevation raster. Undo, History, the source list, the dependent-analysis refresh and the compatibility transition are wired through the real callers. Independently reviewed: no — this delivery awaits the main agent's disposition. Integrated or released: no.
Tracking: `canopi-jv8a.4` (kept open for independent disposition); `canopi-kko3` is resolved by the delivered recompute-after-Undo decision; parent `canopi-jv8a`, epic `canopi-j571`.
Current guidance: [design](ordered-cog-design.md), [assignment](ordered-cog-agent-prompt.md), [ADR 0027](../../adr/0027-ordered-cog-data-layers.md), [LiDAR](../../agent/lidar.md), [delivery](../../workflow/delivery.md).

## What is delivered

| Design phase | State |
| --- | --- |
| 1. Catalogue + resolver + compatibility | **Delivered.** Schema v14 adds `lidar_collection_members` (stable `member_id`, top-first `position`, kind `source` \| `previous-composition`, originating job) and v15 adds the snapshot lineage `previous_generation_id`. `collection.rs` owns snapshot load, measurement, insertion and history; `generation.rs` owns one bounded resolver (`CollectionReader` + `GenerationReader`) over the ordered list. A pre-transition head becomes one indivisible bottom member that references the preserved generation directly, so no compatibility wrapper nests. Migration is additive, keeps the WAL-consistent `VACUUM INTO` backup and refuses a future schema version. |
| 2. Import + edits + lifecycle + transport | **Delivered.** `apply_import` publishes an ordered snapshot — member rows plus one bounded measuring pass — and materializes nothing. `move_member`, `remove_member`, `undo_last_change` and `restore_version` publish a new head under the layer-wide heavy lease with expected-head validation, and `settle_layer_edit` runs the dependent-refresh path exactly once on settlement. Typed transport adds `LidarLayerCollection` / `LidarLayerSource` and five commands; the native command policy guard passes. Slope resolves the composed elevation window plus its halo before computing. |
| 3. Dock + presentation | **Delivered.** The existing Layers dock shows the top-first source list with filename, coverage, move up/down and Remove (with its retained-history confirmation), plus an explicit "Undo last change" and per-version "Restore this version". All 11 locales carry the new strings. Group visibility remains one eye and never touches the composition. |
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
- **Retired new-write machinery.** The merge-model publication paths and their helpers are gone; `lidar_generation_members`, `GenerationChunkReader`, `persisted_chunks` and the dense read remain, because preserved generations, persisted slope results and the compatibility tests still read through them.

## Evidence

### Decisive caller-level tests (GDAL required)

- `ordered_stage_review_apply_reorder_remove_undo_and_restore_keep_exact_values` runs the whole product workflow through the real callers: stage and review a bottom source (`uncovered 60×45`, no overlap), Apply, reopen the library and read the exact values back, add a second source above it (`overlap 40×45`, `uncovered 20×45`), read the composed `[…5, 9]` boundary, move the top source below the bottom one and read the changed composition, Undo the move, Undo again (walking further back rather than toggling), restore the moved version explicitly, remove one occurrence, and confirm that every earlier version is still listed with exactly one current head and that a stale edit is refused by name. It also asserts the format is `ordered-members-v1` and that the generated library tree contains no composed raster at all.
- `an_undo_refreshes_the_dependent_analysis_it_restored` drives `canopi-kko3` end to end: a slope definition is created and its first job run, the **Apply** path is the control (it enqueues a refresh whose `source_generation_id` is the new head and whose published result becomes current), then an Undo is settled through `settle_layer_edit` and a new refresh is enqueued for the *restored* generation; the analysis head ends pointing at the restored generation and no current result still describes the composition the user undid. Restoring the version that is already current publishes nothing and enqueues nothing.
- `ordered_collection_resolves_topmost_valid_without_materializing_anything` (hermetic, generation) proves the numeric rule directly on the design's decisive example: bottom A = `[10,20,30]`, top B = `[100,NoData,0]` gives `[100,20,0]` with every cell valid, moving B below A gives `[10,20,30]`, restoring B gives `[100,20,0]` again, a valid negative and a valid zero both survive, the library tree holds no `gen-*`/`chunk` artifact, and a member a million cells away occupies exactly one block.
- `preserved_composition_reads_exact_values_with_the_authoritative_mask` proves the compatibility rule: a preserved dense mosaic replayed through the compatibility lease returns the authored values exactly where the generation's own coverage mask admits them, returns no sample where it does not, answers a sub-window with the same values without re-preparing, and keeps its lease owned for the next read.
- `chunked_publication_extends_a_legacy_generation_without_rewriting_it` proves the transition: a generation published through the preserved dense route keeps its row, its mosaic path and its files, and the extension publishes an ordered composition whose bottom member is `previous-composition` referencing that original generation. Both members read back with their own values and the 440-column gap between them stays exactly invalid.
- `sparse_publication_overlays_an_opaque_legacy_base` proves the indivisible case: a head whose member rows were stripped is overlaid as one member, its coverage is replayed from the lease rather than fabricated into reorderable sources, the extension paints over it, the gap stays invalid, and undo restores the preserved composition still pointing at the original base.
- `legacy_and_retained_members_replay_together_and_undo_exactly` proves the semantic change explicitly: a top source's valid sample now covers a lower invalid cell (the superseded `replace-overlap` rule could not create coverage), the preserved columns keep their own values and validity, and undo restores the legacy payload byte-identical.
- `a_retained_source_cog_is_the_only_durable_member_payload`, `grandfathered_large_generations_stay_readable_after_the_override_expires`, `sparse_gap_import_stores_only_occupied_chunks`, `sparse_lattice_anchor_never_moves_when_the_layer_extends_left`, `admission_admits_a_union_exactly_at_the_envelope_limit` and `sparse_twenty_four_tile_batch_stays_chunk_sized` keep their coverage, ownership, admission, lattice and bounded-work detectors and now assert the ordered rule: member metadata only, no resolved source raster, arithmetic occupied blocks, and reads that follow the composition.
- `native_tiles_render_a_sparse_generation_and_report_empty_areas` keeps the display detector: an ordered layer presents a native tileset, renders opaque and partially painted tiles through the real protocol path, answers a deep zoom-out from reduced cells, returns an explicit empty tile beyond the coverage and refuses a generation belonging to another entity.

### Frontend

- `lidar-layer-collection.test.ts` covers the ordered actions: reading the collection, sending the expected head with a move so a stale edit fails by name, remove, snapshot Undo, per-version restore, and surfacing a rejected edit without refreshing the library.
- `npm test` passes in full (272 files, 2 646 tests) and `npx tsc --noEmit` is clean.

### Repository gates on the final candidate

| Gate | Result |
| --- | --- |
| `cargo fmt --all -- --check` | clean |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `cargo check --workspace` | clean |
| `cargo test -p canopi-desktop native_command_policy::tests` | 13 passed / 0 failed |
| `services::lidar --include-ignored --skip services::lidar::e2e --test-threads=1` | **159 passed / 0 failed** in 474.34 s (log `.rq-scratch/final-lidar.log`, transient) |
| `cargo test --workspace` | 41 + 352 + 1 + 7 + 2 passed / 0 failed |
| `cd desktop/web && npx tsc --noEmit` | clean |
| `cd desktop/web && npm test` | **2 646 passed / 0 failed** (272 files) |
| `cd desktop/web && npm run check:types` | generated bindings match (`bindings-gen --check`) |
| `python3 scripts/check_docs.py` | 0 errors |
| `git diff --check` | clean |

### Final gate lane

Every gate above ran on one committed candidate after the last code change (logs `.rq-scratch/final-lidar.log`, `.rq-scratch/workspace-tests.log`; transient, not committed). The private `e2e` fixture module is excluded from the focused lane by name, as the design's route specifies, and its external IGN MNT fixture was not available here: that exclusion is the recorded reason the count is 159 rather than the wider suite's total.

### `canopi-kko3` resolution evidence

The design settled this as "recompute after Undo as after Apply", not an open product choice. `settle_layer_edit` runs the dependent-refresh path once on the real settlement of every committed numeric edit, and `an_undo_refreshes_the_dependent_analysis_it_restored` proves it at the caller level: the Apply path is the control (its refresh enqueues a job for the new head and the published result becomes current), the Undo enqueues its own refresh for **the restored generation**, the analysis head ends pointing at that generation, and no current result still describes the composition the user undid. Restoring the version that is already current publishes nothing and enqueues nothing. Independent acceptance of the fix is the main agent's call, not claimed here.

## Migration and compatibility limits

- **New work is ordered; old work stays exact.** A new source generation is `ordered-members-v1` and stores member metadata only. `legacy-dense-v1` and `cog-chunks-v1` generations remain readable through their own accepted readers, and persisted slope results remain sparse resolved chunks. Neither is eagerly converted, deleted or re-encoded.
- **A pre-transition head is one member.** Its masked replacement history cannot be reduced to a priority stack, so it is exposed as one indivisible bottom member labelled "Previous composition". It can move or be removed like a source; its internals cannot be reordered.
- **Dense compatibility costs one derivative per preserved generation.** A dense mosaic is not in the controlled COG profile, so the library prepares one GDAL derivative per preserved generation and owns it for the library's lifetime. This is a read-time compatibility cost, not a new publication path.
- **Display bounds are the occupied-block envelope.** Matching the superseded sparse route keeps a layer's map footprint stable across the transition, so a composition with distant members still reports the envelope between them rather than the exact coverage extent.
- **Production admission limits are unchanged.** 16 files, 512 MiB per source, 1 GiB per selection and 25 000 000 union-envelope cells for new imports. Reorder, remove, Undo and restore are not new import admission and are not bounded by them. No capacity evidence is claimed here.
- **Undo of a layer's first change publishes the empty composition.** The layer stays valid, accepts sources again, and the import it replaced remains restorable from History.
- **`LidarLayerSource.filename` is a short digest.** The catalogue does not retain an original file name for a committed source, so the list shows a stable 12-character identity cue instead of inventing one; a truthful name would need a new catalogue column and is a follow-up.

## Unavailable observations

- **No automated WebView smoke test.** The suite has none and none was added. The workflow was exercised through caller-level tests only; the exact isolated-profile steps for a real Desktop run are in the handoff.
- **The isolated real-Desktop workflow was not driven in this environment.** Import, reorder, remove, Undo, restore, group hide/show, slope refresh and restart were not observed in a live window here. This is pending, not passed, and it is the one acceptance item the design asks for that this delivery could not produce.
- **Windows and macOS are not compiled here**, so platform free-space, rename durability and asset-URL behaviour remain as recorded in the predecessor receipt.
- **No capacity, disk-budget or large-fixture campaign was run** for the ordered route. The representative 24-tile and sparse-gap runs still execute their authored coverage assertions, but their memory figures belong to the superseded route and are not restated as this route's measurements.

## Next dependency

Independent disposition by the main agent, then the user's integration decision. The follow-ups this delivery deliberately leaves open are: the real-Desktop workflow observation; truthful source display names; a capacity/measurement pass for the ordered route if the courier wants the admission limits revisited; and the deferred general reclamation of unreferenced published assets. Nothing here changes production admission limits, integrates the branch into `main` or releases anything.
