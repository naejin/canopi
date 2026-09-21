# Complete the native integration review corrections

Status: retired — D1/R1 delivered and independently accepted at `a5fc7d7b` (evidence in the [integration receipt](geolibre-integration-receipt.md)); not continuing execution authority. Next work uses the [bounded-generation assignment](bounded-generation-agent-prompt.md).
Tracking: reopen `canopi-jv8a.1` for its review correction; parent `canopi-jv8a`, epic `canopi-j571`. Track deferred cleanup separately in bd.
Current guidance: [review disposition](geolibre-integration-review.md), [native design](geolibre-integration-design.md), [LiDAR](../../agent/lidar.md), [courier protocol](collaboration-protocol.md), [delivery](../../workflow/delivery.md).

## Mandate and starting point

Finish the narrow acceptance correction to the delivered G1–G5 production integration. Retain that implementation; do not restart the architecture. Complete code, tests, reporting corrections, follow-up tracking and one consolidated delivery autonomously. The main agent owns design and independent review; the user remains courier. Do not use subagents or message another agent directly.

Implementation baseline: `3004e4d3` on `feature/geolibre-native-raster-integration`, based on `60e41d50`. The primary checkout remains on `feature/raster-html-references`; the delivered worktree is `.rq-scratch/wt-geolibre`. Inspect status and ancestry before editing. Preserve the full accepted stack, approved HTML `0e696722`, the primary checkout's user-owned `desktop/src/native_operation.rs` edit and any unrelated files. Continue the existing implementation branch for this review correction. Bring the forwarded docs commit into it, resolving documentation overlaps by retaining the delivered receipt/current code descriptions and installing this assignment as the sole live prompt. Do not overwrite the delivered files with pre-integration descriptions from the primary checkout. This docs reconciliation is authorized; integration into main is not.

Read AGENTS, the linked disposition, native design and relevant LiDAR/build guides. Inspect and reopen/claim `canopi-jv8a.1` before coding; record this limited scope. Use **tdd** and **craft** for the changed behavior; the interface decision below is settled, so no new architecture exercise is needed. Apply any mandatory skill references. Missing tooling is a named limitation, not authority to weaken tests.

## Fixed correction: account for simultaneously live disk allocations

At `3004e4d3`, `import::stage_source_samples` checks raw/mask space and then `PreparedRaster::open` independently checks derivative space. Both checks see the same free bytes before either allocation. This violates the native design's combined footprint requirement.

Keep `paths::require_free_space` and platform capacity APIs. Extend the private reader preparation contract to accept **additional output bytes that will be allocated while its derivative remains alive**. Use checked arithmetic and one shared estimate for:

`padded_cog_bytes(width,height) + metadata_prefix_ceiling + additional_output_bytes + FREE_SPACE_FLOOR_BYTES`

The import caller passes `cells * 5` (four sample bytes and one validity byte per cell); analysis statistics passes zero because its result and quality files already exist when the reader opens. Existing files are already reflected in measured free space: do not charge them twice. Compute and enforce the combined requirement **before GDAL preparation or creating/truncating raw/mask outputs**. Remove the redundant import preflight or make it use the same combined estimate; do not maintain two inconsistent formulas. Update all actual and test callers. Keep the estimate private to the existing module; no quota service, reservation manager, new dependency or generic filesystem abstraction.

Keep bounded runtime capacity checks. In `scan`, place the reserve check at the per-window consumer boundary rather than only the outer row band, so a very wide band cannot perform many writes without rechecking. A measured free-space check is not an OS reservation and cannot prevent another process consuming disk concurrently. Preserve ordinary write-error propagation and existing import partial-output cleanup; do not claim a hard global reserve guarantee. No fallback to dense decoding on capacity failure.

### Required regression evidence

Use the production estimate/check path with a narrow test seam for available bytes if needed; never fill a real filesystem to force the condition. No persistent test-only environment switch in production.

- Independently calculated example: 1024×1024 Float32 raster → 4 MiB padded derivative, 4 MiB metadata allowance, 5 MiB outputs, 256 MiB reserve: **269 MiB total**. At **265 MiB** free both old separate checks (261 MiB for outputs; 264 MiB for preparation) pass, but the combined check must reject. Name required/available space and establish that rejection precedes preparation/output creation.
- At exactly 269 MiB the combined admission passes; one byte below fails. A reader with zero additional output uses 264 MiB for the same grid. Exercise arithmetic overflow without allocation; it is a named error, not wraparound or panic.
- Test the actual import caller supplies both raw and validity bytes, rather than only testing a detached formula. A private seam may control the capacity observation, but do not replace the budget decision being tested. Assert no new derivative/raw/mask output on rejection and a healthy caller control remains valid.
- Retain existing numerical/validity, row-addressed output, cancellation, erosion and degree/percent slope tests. Confirm a multi-window scan observes capacity between consumer calls. No mutation quota or transcript framework is required; record intended RED and GREEN concisely in the existing receipt.

Helper names, parameter packaging, test organization and ordinary in-scope fixes are delegated. Do not stop after the first passing unit test.

## Reporting correction: analysis staging cleanup

Do not broaden this patch into an analysis lifecycle rewrite. Inspect `analysis::run_slope_job` and its settlement caller, distinguish inherited staging cleanup gaps from new derivative ownership, and create/reuse a focused follow-up bug bead for analysis staging left by failed/cancelled work. Include the affected paths, source evidence, preservation of accepted results and the required future failure/cancellation test. Do not claim the bug was reproduced dynamically unless you actually ran that test.

Correct `geolibre-integration-receipt.md`: derivative cleanup and import raw/mask failure cleanup do not establish cleanup of every analysis staging asset. Retain genuine passing evidence and mark whole-analysis cleanup unestablished. Reconcile any broader claims in the LiDAR/build guides and debrief. This known inherited issue is tracked, not an additional blocker to this bounded correction; no scientific result or publication guarantee may be relaxed.

## Verification, autonomy and stop boundary

Run relevant focused tests, including the GDAL-backed import caller and slope compatibility tests with explicit ignored-test selection from the existing build guide. Ordinary dependency restoration/build retries, source fetch at the existing pin, and small existing fixture tests are authorized. The reviewer could not repeat the prior suite offline: the default Cargo cache lacked the git dependency, and the reported scratch cache lacked `jpeg-encoder`. Record the actual successful environment/commands rather than assuming those caches are complete. A missing private fixture or platform blocks only that evidence; never silently substitute tile-specific scientific expectations.

Run repository Rust gates (`cargo fmt --all -- --check`, `CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings`, `CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace`, `CANOPI_SKIP_BUNDLED_DB=1 cargo test --workspace`), docs validation and `git diff --check` on the delivered tree. No frontend rerun or binding regeneration is required if those surfaces remain unchanged. Follow current repository CI-parity/ancestry rules without losing the required feature stack; record any baseline/remote blocker rather than silently dropping it. Do not include unrelated formatting fixes. If dependencies still prevent a gate, deliver the exact failure and residual uncertainty, not an invented pass.

Perform one bounded self-review of the full import capacity path: caller estimate → live platform observation → preparation → per-window writes → error cleanup. Fix in-scope findings before delivery. No old Q runs/repairs, new evaluator, Python migration, engine changes, UI changes, limit increases, capacity experiments or bounded-composition implementation. The latter needs a new main-agent design after review. Routine test failures, private helper choices and dependency-cache repair do not require courier approval; a changed public/storage/scientific contract does.

Update the existing integration receipt with the correction, tests and exact limits; append the implementer response to the linked review disposition without rewriting the reviewer's findings as accepted. Update one concise debrief outcome with decisions handled locally, self-review discoveries and any new design omissions. Retire this prompt on delivery. Reconcile/export bd, commit intended files, push the implementation branch and sync Dolt under repository workflow. Return one handoff with branch/commits, regression evidence, gates, cleanup follow-up id and preserved user work. Stop for independent review: no automatic next slice, main integration or release.
