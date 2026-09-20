# Native integration — independent review disposition

Status: completed — bounded G1–G5 scope and D1/R1 independently accepted at `a5fc7d7b`. Not integration or release approval. Original findings below are historical.
Tracking: `canopi-jv8a.1`, parent `canopi-jv8a`; bd owns execution state.
Current guidance: [next assignment](bounded-generation-agent-prompt.md), [native design](geolibre-integration-design.md), [LiDAR](../../agent/lidar.md), [debrief](review-and-debrief.md).

## Final independent acceptance — `a5fc7d7b`

The reviewer inspected the correction at `6783fef6` and delivered documentation/bead record at `a5fc7d7b`. D1 now has one checked estimate before preparation, actual import `cells * 5` wiring, zero extra bytes for existing analysis outputs, and a per-window reserve observation. R1 narrows cleanup claims and tracks inherited analysis staging as `canopi-jv8a.3`. No D1/R1 blocker remains. Preserve this implementation; do not reopen Q or repeat the integration batch.

Independent commands from the delivered worktree, with `CARGO_HOME=/home/daylon/projects/canopi/.rq-scratch/cargo-home CANOPI_SKIP_BUNDLED_DB=1`:

- `cargo test --offline -p canopi-desktop services::lidar -- --test-threads=1`: **53 passed, 8 ignored**, no failures.
- `cargo test --offline -p canopi-desktop services::lidar -- --ignored --skip services::lidar::e2e:: --test-threads=1`: **7 passed**, including exact-budget admission, persisted-data compatibility, cleanup controls and slope.
- `python3 scripts/check_docs.py`: 0 errors; `git diff --check 3004e4d3..HEAD`: clean. The delivered worktree remained clean.

The cache blocker from the first review was resolved. The reviewer did not repeat the full workspace/frontend suites, private MNT lifecycle, Desktop UI smoke or Windows build; those remain reported or unavailable as indicated in the implementation receipt. Acceptance covers bounded extraction/postprocessing and its correction, not end-to-end bounded composition or increased capacity. The [next design](bounded-generation-design.md) owns that work.

## Retained progress and evidence limits

The delivered branch `feature/geolibre-native-raster-integration` at `3004e4d3` wires the pinned native reader into real import extraction and slope postprocessing. Preserve those changes, existing UI/storage and unchanged capacity limits. This is product progress, not another harness-only slice. It is adoption of GeoLibre's selected decoder dependency, not adoption of the entire GeoLibre processing toolkit or completion of bounded composition.

The reviewer inspected the implementation, callers, tests and `geolibre-integration-receipt.md` on the delivered branch. `git diff --check 60e41d50..3004e4d3` passed. Independent `cargo test --offline -p canopi-desktop services::lidar -- --test-threads=1` attempts with `CANOPI_SKIP_BUNDLED_DB=1` failed before tests: the default cache lacked the pinned git checkout; `CARGO_HOME=/home/daylon/projects/canopi/.rq-scratch/cargo-home` lacked the `jpeg-encoder` registry package. The earlier suite and real MNT lifecycle remain implementer-reported evidence, not independently repeated results. These environment failures do not contradict their reported success.

## D1 — combined disk footprint (acceptance blocker)

Source: `import.rs::stage_source_samples` checks `raw_bytes + cells + reserve`; `prepared_raster.rs::PreparedRaster::open` separately checks `padded derivative + metadata ceiling + reserve`, before allocation. The existing design's resource section explicitly requires their sum because the files coexist. Independent checks do not establish that sum. The scan checks the reserve before an entire row band, not each consumer write window.

Impact: admission can succeed with insufficient space for the planned simultaneous footprint; later work can fail unnecessarily or temporarily consume the intended reserve. This is a source-proven accounting defect, not a measured out-of-disk incident. Classification: implementation deviation and test gap; the original plan stated the sum but lacked a decisive combined-budget acceptance example. Reviewer owns that handoff improvement.

Resolution and regression cases are fixed in the follow-up assignment. Acceptance requires the combined preflight through the production caller and preservation of existing behavior. No global quota infrastructure is requested.

## R1 — scope of cleanup evidence (reporting correction)

Source: `analysis.rs::run_slope_job` creates a staging directory, then propagates errors from GDAL, quality-mask generation and statistics with `?`; `mod.rs` error settlement updates job state without removing that directory. The new reader removes its derivative, not every analysis asset. The staging ownership issue partly predates this integration.

Impact: failed/cancelled analysis can leave staging output; no accepted-result corruption was demonstrated. Correct whole-pipeline cleanup claims, track a focused bug, and preserve scoped cleanup evidence. Do not reopen the entire lifecycle architecture in this patch. The reporting correction and follow-up tracking are required; implementation of the inherited cleanup bug is deferred. Classification: reporting/test-scope gap with inherited lifecycle debt, not evidence that every cleanup path is broken.

## Original follow-up boundary (closed)

The consolidated follow-up through the user closed D1/R1 as recorded above. Full-grid generation/composition is a separate next assignment. Do not reinterpret this correction's acceptance as general completeness, integration or release.
