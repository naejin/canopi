# Reviewer-authored raster acceptance tests

Status: evidence — packet at `0a3a29f4` had five frontend failures on `68852cbd`; all five repaired and 81/81 plus both native proofs independently pass at `592e04ed`.
Tracking: `canopi-j571.1`; tests on `test/raster-acceptance-handoff`, implementation remains `feature/raster-rework-completion`.
Current guidance: [sole prompt](completion-agent-prompt.md), [ownership contract](completion-ownership-design.md), [receipt](completion-receipt.md), [debrief](review-and-debrief.md).

## Assignment boundary

This packet is already merged and repaired in the current candidate. Do not replay
its initial RED assignment. Continue with the [current review cases](completion-review-de336a7d.md);
the original baseline procedure below is historical evidence, not a new merge task.

The user approved reviewer-authored tests followed by implementation-agent repairs.
Merge the test handoff preserving history; do not replace the candidate with the older
documentation checkout. This branch intentionally contains ordinary failing tests,
not skipped/expected-failure assertions. It must not be integrated into main as a green
candidate. The implementer completes GREEN and refactoring, adds tests for discoveries,
runs the full required gates and returns one consolidated delivery. Passing this packet
does not replace C0–C5, independent review or remaining evidence requirements.

All new executable code is TypeScript or Rust. Native call-site additions and hooks
are `cfg(test)` only; no production policy, dependency, storage or IPC changed. Tests
are maintained beside existing suites. No external fixture, temporary reviewer file,
Python script or custom test runner is required. GDAL must be available for the two
explicitly ignored native tests, matching existing fixture-lane conventions.

## Frontend packet and observed baseline

Run from `desktop/web`:

```bash
npx vitest run src/__tests__/world-map-surface.test.tsx src/__tests__/location-map-editing-host.test.tsx src/__tests__/lidar-settlement-acceptance.test.ts src/app/canvas-map-surface/workspace-map-controls.test.ts
npx tsc --noEmit
```

Baseline: **76 passed, five failed across 81 tests**. TypeScript passes. The failures
are behavioral assertions after working setup, not missing exports or fixture errors.

| Test | Real boundary and independent expectation | Observed failure |
| --- | --- | --- |
| `acceptance: movement refreshes official metadata through the mounted Location caller` | Actual hook/workbench/host/provider/binding; fake MapLibre and HTTP only. Initial metadata installs maxzoom 18; movement must request the new viewport and apply maxzoom 16 and `Moved credit` without map replacement | Viewport request count stays 1 |
| Same test for `WorldMap` | Actual mounted component/host/provider/binding with the same independent response sequence | Viewport request count stays 1 |
| `acceptance: repeated basemap hide/show releases mount-owned movement listeners` | Actual WorkspaceMapControls and surface lifetime; three hide/show cycles must preserve the original listener count and final release removes all | Count grows from 2 to 5 |
| `acceptance: workspace leaves attribution control ownership to the mount` | Actual map-construction options must suppress automatic attribution under the accepted single-control design | Automatic `{ compact: true }` remains enabled |
| `disposed workflow ignores late failed settlement` | Real store/workflow; gate IPC, dispose, set current status, reject obsolete read; late error cannot overwrite status | Status becomes `obsolete read error` |

The settlement file retains three passing controls: ordinary success, outage recovery,
and repeated Complete with one pending read. Map suites retain their existing healthy
cases. Map movement tests also assert a working initial official session before the
failure, and their fakes expose real bounds instead of a constant fallback viewport.

Sensitivity check: temporarily supply the missing lifetime event capability at both
map callers; both map suites pass (8 tests), including moved zoom/credit. Restore the
caller files afterwards. No implementation fix is included in this handoff.

The Canvas automatic-control assertion verifies the fixed construction contract; it
is not proof of live attribution DOM rendering or other-source credit retention.
Keep the existing control-identity tests and complete remaining production credit
behavior. Do not satisfy the assertion by removing all attribution controls.

## Native packet and observed baseline

Run from repository root with GDAL on PATH or the existing configured GDAL directory:

```bash
CANOPI_SKIP_BUNDLED_DB=1 cargo test -p canopi-desktop --lib acceptance_ -- --ignored --test-threads=1
```

Both tests pass on the existing implementation. This supplies missing verification;
it is not a new repair or a retrospective RED→GREEN implementation claim.

| Test in `analysis_acceptance_tests.rs` | What it proves | Limits |
| --- | --- | --- |
| `acceptance_inspection_rejects_head_changes_during_value_and_nodata_reads` | Generated 16×16 plane, independently located value 5 and NoData controls; actual library sample with head changed after target resolution or pixel read refuses stale Value, hole NoData and early unrepresentable-index NoData | Deterministic interleaving through one-shot hooks, not thread scheduling stress or frontend response delivery |
| `acceptance_sparse_midwrite_failure_preserves_publication_and_retries` | Generated 1030×16 two-block plane; first block must produce output before injected capacity loss or real filesystem create failure in block two. Accepted head/manifest and prior asset bytes unchanged, scratch/staging removed, worker rerun publishes successfully | Worker retry, not action/IPC scheduler retry; no claim of reclaiming all unpublished content-addressed assets, peak scratch or queue bounds |

The thread-local hooks are one-shot and cleared by RAII. They do not replace sampling,
capacity admission, output writing, publication or cleanup. Fault injection is restricted
to generated temporary data. An actual directory collision causes the write error;
the test does not substitute an invented successful/failing worker result.

Sensitivity check: temporarily bypass `finish_sample_outcome` currency checking; the
inspection test fails on stale early NoData. Restore the saved file and rerun both
native tests successfully. Preserve all production checks; no mutation is delivered.

Rust workspace tests, strict workspace/all-target Clippy and formatting were run on
the restored test tree. The standard workspace run skips the two GDAL tests; the
explicit command above supplies their separate evidence. No capacity-plane, private
IGN, GUI, packaged or platform qualification is claimed by this packet.

## Finish without another prose-only cycle

First run the packet to establish the same failures and passing controls. Then select
one failing behavior, make the smallest coherent fix, rerun it and its caller suite,
and refactor while green. Continue automatically through the other failures and
remaining accepted obligations. Do not skip, weaken, mock out the owner, special-case
test data or rewrite tests to assert implementation details. If a test is incorrect,
provide a concrete contract counterexample; the reviewer owns correcting its oracle.
Equivalent test organization is delegated if it retains the asserted behavior and
actual owner boundary. Preserve tests proving behavior already works.

Finish R50 action/IPC/native identity evidence, R43 scratch/queue/fault evidence and
available C0–C5 workflows. R48/R51 now have the scoped native evidence above; rerun
when affected rather than returning them as unwritten or claiming broader proof.
Retain safe ceilings until the source-import amendment permits lifting them.

Before delivery, compare every “done” receipt row with the real caller, test assertion,
revision and remaining limit. Inspect the actual caller capabilities and removed
subscriptions, then late success/error callbacks and disposal. Repair in-scope escapes
before returning; only consequential contract conflicts require an escalation.

The final debrief must evaluate this division of work: reviewer test-authoring and
oracle corrections, defects caught before/after handoff, real-owner coverage retained,
new tests the implementer needed, and observed effort/courier exchanges or unknowns.
Promote demonstrated improvements into existing tests/guides; no new tooling platform.
