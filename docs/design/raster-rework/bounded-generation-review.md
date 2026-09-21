# Bounded-generation review — `1fcab504`

Status: evidence — independent focused review: partial delivery, not accepted as complete; no integration or release approval.
Tracking: `canopi-jv8a.4`, parent `canopi-jv8a`.
Current guidance: [delivery receipt with the BG1–BG5 response](bounded-generation-receipt.md), [design](bounded-generation-design.md), [courier protocol](collaboration-protocol.md).

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

The implementation response belongs in the existing branch's `bounded-generation-receipt.md`, with BG1–BG5 mapped to code and decisive tests. Reconcile stale current statements rather than appending contradictory updates. The main agent records an independent disposition here after the user forwards the corrected revision. Until then the disposition remains partial, regardless of passing test counts.

Status note: the correction was delivered on `feature/bounded-raster-generations` through `3253543d` (BG5 `762d665a`, BG1 `6477f74e`, BG3/BG2 `2782fa80`, BG4 `3253543d`), and the branch receipt now carries the completed BG1–BG5 response table with its decisive tests. The findings above remain the record of the reviewed revision `1fcab504`; the disposition of the correction is still the main agent's to make.
