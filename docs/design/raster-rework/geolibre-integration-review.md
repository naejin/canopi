# Native integration — independent review disposition

Status: partial — source review of `3004e4d3`; one acceptance-blocking disk-accounting correction and one reporting/follow-up correction. Not integration or release approval.
Tracking: `canopi-jv8a.1`, parent `canopi-jv8a`; bd owns execution state.
Current guidance: [follow-up assignment](geolibre-integration-followup-agent-prompt.md), [native design](geolibre-integration-design.md), [LiDAR](../../agent/lidar.md), [debrief](review-and-debrief.md).

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

## Next acceptance boundary

One consolidated follow-up delivery through the user. Reviewer verifies D1 against the fixed examples, checks R1's truthful disposition and relevant regression/gate evidence. Do not re-review frozen Q or invent unrelated completeness gates. Full-grid generation/composition remains the next architecture assignment, not implied authority in this repair. Acceptance remains pending until that follow-up review.

## Implementer response

Corrections are delivered on the same implementation branch; revisions, evidence and gates are in the [integration receipt](geolibre-integration-receipt.md). This response states what changed and deliberately does not restate the findings above as accepted.

- **D1 — corrected.** One checked estimate in `prepared_raster.rs` now covers `padded derivative + metadata ceiling + additional output bytes + reserve` and is enforced once, before GDAL preparation or any raw/mask creation. The import caller passes `cells * 5` and its separate preflight is gone, so exactly one formula decides admission; analysis statistics passes zero because its result and quality files already exist on disk. `scan` rechecks at every window's consumer boundary. The fixed cases — 269 MiB total for a 1024×1024 Float32 raster with staged outputs, rejection at 265 MiB where both former checks passed, admission at exactly 269 MiB and rejection one byte below, 264 MiB with no additional output, named overflow, and per-window observation across a multi-window scan — are asserted through the production caller. Fault injection reproducing the reviewed defect fails those tests, and the caller test then reaches `gdal_translate` instead of rejecting, matching the reviewed behavior.
- **R1 — reporting corrected; implementation deferred by design.** The receipt now names exactly what cleanup evidence covers (derivative ownership, import partial outputs, stale-analysis staging removal) and marks whole-analysis staging cleanup unestablished. The inherited gap is tracked as `canopi-jv8a.3` with source evidence and one dynamic observation; accepted results, published heads and numeric guarantees are untouched, and no lifecycle rewrite was attempted.
- **Retained.** Existing numerical/validity, row-addressed output, cancellation, erosion, degrees/percent slope and real MNT lifecycle tests still run; capacity limits, storage formats, IPC and the derivative ownership delivered in G1–G5 are unchanged.
