# Bounded-generation independent review

Status: evidence — independent focused review: partial delivery, not accepted as complete; no integration or release approval.
Tracking: `canopi-jv8a.4`, parent `canopi-jv8a`.
Current guidance: [completion assignment](bounded-generation-completion-agent-prompt.md), [design](bounded-generation-design.md), [courier protocol](collaboration-protocol.md).

## Current disposition — `eb64a853`

Partial acceptance. Preserve job-local source COGs, Before/After value correction, the sparse traversal direction and earlier BG1–BG5 improvements. BG8's requested incomplete-baseline/sample and observed-over-budget cases are independently verified; it needs no further repair in this assignment. BG6 and BG7 remain incomplete for the four findings below, against their existing contracts.

The focused command recorded below was independently rerun at `eb64a853`: **150 passed, 0 failed**, including ignored native/GDAL tests but excluding `services::lidar::e2e`; elapsed 405.81 seconds. Docs validation and diff checks passed; worktree remained clean. Private MNT/MNH, full workspace/frontend, 400M and platform evidence were not independently repeated. No repository files were changed during review.

| ID | Evidence at `eb64a853` | Impact / disposition |
| --- | --- | --- |
| BG6-A — transformed page ordering | `import.rs:1830–1838` sorts expanded coordinates per page and discards coordinates below the prior page maximum. An executable extraction of this Rust transformation maps 257 regions at offset `(0,1)` to 513 of 514 expected coordinates, dropping `(0,256)`; offset-zero control retains all 257. | Blocks correct review counts/previews. This is an isolated production-logic reproduction, not a new full staging run. The existing multi-page test seeds aligned index rows without matching distant raster payloads. |
| BG7-A — guard begins after promotion | At `import.rs:3138–3142` and the dense caller, `promote_source_cogs(...)?` finishes before `PromotionGuard` is constructed. | Source-confirmed early-error escape: partial promotion/cancellation has no rollback owner. The tested BeforeTransaction failure happens later and does not cover it. |
| BG7-B — outer cleanup destroys recovery evidence | `mod.rs:310–321` logs reconciliation failure, then removes settled job roots containing unresolved journals. | Source-confirmed loss of retry evidence. A helper-only retention test does not establish startup retention. |
| BG7-C — cleanup failure reverses reported success | `import.rs:3261` propagates post-commit cleanup failure; `mod.rs::finish_apply` unconditionally marks errors failed and skips the successful-publication refresh path. | Source-confirmed committed-head/job-state inconsistency. The new post-commit test expects an error and never exercises settlement. Publication success must survive cleanup failure. |

The lifecycle findings are caller-path analysis, not independently executed new fault runs. The continuation makes those caller-level regressions mandatory and includes ownership-reference/reuse checks within the same touched cleanup boundary. No architecture restart, measurement framework or capacity-policy change is needed. Keep old asset reclamation and unavailable platform/capacity evidence separate.

## Historical disposition — `9ad85c18`

Partial acceptance: preserve retained source COG wiring, complete display footprints/interpolation, paged tile queries and restored admission. Three existing-contract gaps remain below; no architecture restart is warranted. BG1's payload migration is demonstrated but its cleanup obligation remains; BG3's tile paging is repaired but the review caller still walks empty space; BG4's sampler is improved but its gate admits unusable evidence. This is not integration or release approval.

Independently rerun on `feature/bounded-raster-generations` at `9ad85c18`:

```sh
CARGO_HOME=/home/daylon/projects/canopi/.rq-scratch/cargo-home CANOPI_SKIP_BUNDLED_DB=1 cargo test --offline -p canopi-desktop --lib services::lidar -- --include-ignored --skip services::lidar::e2e --test-threads=1
python3 scripts/check_docs.py
git diff --check
```

137 native/GDAL tests passed; docs and diff checks passed. The private MNT/MNH e2e module, full workspace/frontend suites, 400M run and platform smoke were not independently repeated. The implementer's reported resource runs remain attributed evidence, not invalidated merely because the gate has an uncovered failure mode.

| ID | Evidence at `9ad85c18` | Disposition |
| --- | --- | --- |
| BG6 — empty-envelope review traversal | `import.rs::union_blocks` builds every envelope window; `review_coverage` consumes all of them. An isolated extraction of that exact function returns 977 windows for a 1,000,001×1 envelope containing two separated cells, versus one for adjacent cells. | Blocks sparse review completion. This is metadata/work proportional to empty area, not a full pixel-buffer allocation. The earlier review missed this caller: reviewer oversight as well as implementation gap. |
| BG7 — unpublished source ownership | `stage_source_samples` calls `write_source_cog_asset`/`admit_staged_cog`, moving bytes globally before facts/regions and union admission. Error/startup cleanup removes job roots, not those global files. The shared-asset failure test protects reuse but does not assert cleanup of newly created assets. | Blocks new-job cleanup acceptance. Source inspection establishes the missing owner; no new dynamic end-to-end disk-leak test was run in this review. Historical orphan GC may remain deferred; newly owned unpublished cleanup may not. |
| BG8 — incomplete sampler passes | An isolated copy of the real `measurement.rs` finish/gate path with baseline=peak=100, ten ticks, all ten incomplete returns `Some(0)` and passes. A healthy complete-sample control passes too. `snapshot_tree` also discards baseline completeness. | Blocks reliance on the gate for capacity acceptance. This is a seam-state reproduction, not a real `/proc` failure run. Require complete baseline/workload evidence and preserve observed over-budget lower bounds. |

No source files were changed during this review. The temporary isolated reproductions are not product regression tests; the continuation must cover the real callers and measurement gate. Missing 400M and platform evidence remain separate limitations and admission limits remain unchanged.

## Historical review — `1fcab504`

## Disposition and evidence boundary

The branch `feature/bounded-raster-generations` delivers real production caller work, not merely storage scaffolding. Preserve it and the accepted `a5fc7d7b` predecessor. The review inspected the code and receipt at `1fcab504`; it did not independently repeat the full workspace/frontend suites, real MNH/MNT lifecycles, resource runs, migration/crash matrix or Desktop smoke. The implementer's reported results remain attributed evidence.

Independently rerun from that branch, with `CARGO_HOME=/home/daylon/projects/canopi/.rq-scratch/cargo-home` and `CANOPI_SKIP_BUNDLED_DB=1`:

```sh
cargo test --offline -p canopi-desktop services::lidar::tiles::tests -- --test-threads=1
cargo test --offline -p canopi-desktop services::lidar::tiles::tests::native_tiles_render_a_sparse_generation_and_report_empty_areas -- --ignored --test-threads=1
```

Results: six ordinary tile tests passed, one GDAL test initially ignored; the second command ran that GDAL test and passed. These tests do not establish the missing behavior below. No source edits were made during review. Source references below are revision-relative, not assertions that the planning checkout contains delivered code.

## Findings against existing requirements

| ID | Evidence at `1fcab504` | Impact / existing contract |
| --- | --- | --- |
| BG1 — source COG retention missing | `import.rs::stage_source_samples` drops the prepared COG; `write_member_assets` copies `values.raw` and `valid.bin` and creates `native.tif`; sparse Apply calls it. `generation::retained_cog` is a reader without production staging wiring. | Design §3 explicitly requires one retained source COG and no new durable raw/mask payload. This is unfinished B1/B2, not optional optimization. |
| BG2 — reduction footprint clipped | `tiles.rs::MAX_LEVEL = 10`, `level_for_displacement` clamps the exponent; rendering looks up the one chunk containing that reduced-cell origin. The existing test expects the clamp. | Design §7 requires the complete power-of-two footprint, aggregating intersecting occupied chunks and bounded partial reads. A 2048-cell footprint needs level 11, not one 1024-cell chunk. Wrong means or omitted contributing coverage are inferred from that code path; no new end-to-end counterexample was executed in this review. |
| BG3 — generation metadata materialized whole | `tiles::render_tile_uncached` calls `generation::persisted_chunks`; it calls `catalogue::generation_chunk_assets`, collects all matching rows and builds another `Vec`. | Design §§3–4 require paged occupied metadata and spatially bounded reads. Per-tile memory scales with the entire generation independently of the displayed region. Small tests do not demonstrate large-index boundedness. |
| BG4 — combined-memory assertion invalid | `e2e.rs` takes `process_peak_rss_bytes().max(live_child_peak_rss_bytes())` after the MNH workload. The child query sees only still-live children and uses their maximum. | Design §8 requires a time-sampled parent-plus-descendants total, with baseline and limitations. This is neither a simultaneous sum nor coverage of exited GDAL work. The 39 MiB observation cannot establish combined peak memory; receipt elsewhere acknowledges the limitation. |
| BG5 — admission/reporting mismatch | Sparse staging/publication uses `validate_lattice`, not `validate_working_grid`; 48M union admission is explicitly tested without an override. The 25M check remains for individual sources and dense branches. Receipt says both production-default and gated-off, both 315 and 39 MiB without coherent current/historical status, and calls source retention optional. | Design §8 gates capacity-policy changes. Keeping a constant does not preserve its former callers. Current effective admission and delivery state must be corrected, not summarized as “all limits retained.” |

BG1–BG3 block completion of the affected implementation contracts. BG4 blocks the combined-memory claim and capacity enablement. BG5 blocks the admission/completion claims. The missing 400M run and unavailable platform smoke are separately named evidence limits, not reasons to discard valid work or fabricate passes.

This is a bounded review, not a guarantee that publication, cleanup, migration and concurrency contain no other defects. The correction retains their existing acceptance cases and requires one composed-path self-review. Do not create a new qualification campaign or treat the five examples as permission to ignore the rest of the original contract.

## Review closure

The implementation response belongs in the existing branch's `bounded-generation-receipt.md`, now mapping BG6-A and BG7-A/B/C to code and decisive caller tests alongside retained delivery evidence. Reconcile stale current statements rather than appending contradictory updates. The main agent records the next independent disposition here after the user forwards the corrected revision. Until then the disposition remains partial, regardless of passing test counts.
