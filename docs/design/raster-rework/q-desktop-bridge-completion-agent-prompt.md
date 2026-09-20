# Q Desktop bridge — bounded instrument completion

Status: proposed — implementation-ready when forwarded by the user; no execution before that handoff.
Tracking: `canopi-kqpp`, parent `canopi-j571`; leave Q open.
Current guidance: [independent disposition](q-typescript-review.md#desktop-bridge-independent-disposition), [collaboration protocol](collaboration-protocol.md), [LiDAR guide](../../agent/lidar.md), [main plan](../raster-data-analysis-rework.md).

## Assignment and authority

Complete the existing measurement instrument, not another evaluator redesign. The main agent owns the decisions below and independent acceptance; you own implementation and evidence; the user remains the courier. Deliver one consolidated response after all internal milestones. No direct reviewer exchange, automatic subagents or automatic continuation after delivery.

Inspected baseline: `b95b8d1d`, bridge implementation `fab0c381`, delivery through `bf65c479`. Preserve the whole feature stack, accepted numeric tooling `579880be`, settled design `ac68fb64`, UI `0e696722`, the import-map replacement, all scientific requirements, engine pins and budgets. The saved pilot contains genuine correct observations, but the instrument is not independently accepted. Do not rewrite its old evidence or relabel it as a new run.

Forwarding this prompt authorizes repairs within `scripts/raster-qualification/desktop-host/`, narrowly shared publication/test support in `scripts/raster-qualification/ts/`, launcher tests and affected docs. It also authorizes at most two fresh runs of the same small generated-fixture Desktop pilot, after deterministic gates pass: one verification run and one retry only after an identified in-scope correction. No private/large fixtures, new engine build/download/version, new dependency family, production changes, other Q producers, Python migration/deletion, N1, integration or release. A blocked display/network prerequisite is unavailable evidence, not permission to substitute Chromium or change machine-wide policy.

First read AGENTS.md, the collaboration protocol, the disposition, the host README and relevant LiDAR/build-release/edition-development guides. Read and apply tdd (including its required references), craft and codebase-design. Inspect status, intervening commits and `bd show canopi-kqpp`; claim and record this bounded scope before coding. Continue the existing branch. Preserve the user-owned `desktop/src/native_operation.rs` edit; do not stage, revert, stash or incorporate it. If it blocks required rebasing or parity checks, report the specific blocker, not a silently bundled baseline repair.

## Retain and adapt

| Existing surface | Decision |
| --- | --- |
| `desktop-host/src/{bridge,main}.rs` | Retain isolated Tauri workspace and production executor reuse; complete admission, request ownership and teardown here |
| `desktop-host/web/src/{main,worker}.ts` | Retain numeric decoder and opaque-handle transport; add one run lifecycle and validated message boundary |
| `desktop-host/tools/runPilot.mjs` | Keep its CLI entry point compatible; make it a thin bootstrap where needed, with repaired producer/orchestration logic in typed modules under the existing Node tooling tree |
| `desktop-host/tools/makePilotFixture.mjs` | Retain the fixed fixture and GDAL preparation; no unrelated generator rewrite or new fixture classes |
| `ts/src/publication.ts` | Reuse its no-replace publication primitive; if necessary extract a narrow raw-document primitive, preserving every existing decision/diagnostic behavior and regression |
| `ts/src/qualification.ts`, admission, mappings, profiles | Retain the sole decision authority and desktop-local profile; do not compensate for bad producer output by weakening or rewriting the evaluator |

Keep pure producer parsing/comparison separate from process and filesystem orchestration. Tests and the launcher must call the same producer operation: declared run specification plus unknown raw host evidence in, observed reports/findings out. Routine helper names, file splits and algorithms remain yours; no generic workflow framework or second evaluator.

## DB1 — observed window coverage, not declared coverage

Parse the raw host result before claiming measurements. Match returned windows one-to-one by unique ID to the five declared requests; require exact coordinates/dimensions, safe whole-number sizes, and exactly `w*h` values. Missing coverage is a gap; duplicate, extra, conflicting or malformed records fail. Never fill absent observations from the request. Preserve independently known failures alongside gaps. Derive `testedWindows`, measured windows, checked cells and zero/negative retention from actual validated observations. A partial result must not become a successful five-window measurement.

Retain the specified 2048² Float32 plane `z=column-row`, nodata `-9999` at `(100,100)` and `(1024,1024)`, EPSG:2154, tiled 512-cell uncompressed COG without overviews. Requests stay `(0,0,128,128)`, `(480,480,128,128)`, `(1000,1000,128,128)`, `(1920,1920,128,128)`, `(0,1800,128,128)`. Successful coverage is exactly 81,920 cells and two nodata cells. Derive expectations from this formula, not candidate output. Freeze generated fixture bytes before oracle sensitivity tests; a simultaneous generator/oracle change is not independent evidence.

Retain native/worker byte reconciliation and all four refusal controls. Match a refusal by its declared request ID and code, with native returned bytes zero, rather than accepting an unrelated refusal with the same outcome. Candidate read labels are host-owned; renderer requests cannot relabel candidate I/O as preflight/reference. Do not fabricate aggregate success flags.

Decisive tests: the correct five windows pass; five empty duplicate windows check zero cells and cannot pass; five copies of a valid origin window cannot cover the other requests; changed ID/coordinate/length fails; missing window gaps without erasing a wrong value elsewhere; measured zero/negative retention requires actual valid samples. Drive changed raw host evidence through the real producer and evaluator, not just `compareWindow` or handcrafted passing reports. Assert the affected requirement and reasons, not merely overall Q non-pass.

## DB2 — one owned run directory and safe publication

Require the supplied run directory to be absent, with an existing resolvable parent; create it exclusively. Existing empty, partial, failed or complete directories are all refused without modifying anything. This deliberate compatibility tightening replaces the three-filename heuristic. Resolve aliases and reject symlink/dangling destinations; never clean a previous run to retry. Inputs, bench assets, old reports and arbitrary output paths remain read-only. Build outputs may remain in their designated disposable build locations, outside the run-evidence ownership claim.

Publish every completed JSON report, manifest, raw host evidence and result atomically without replacement. Use the existing TypeScript publication primitive for launcher artifacts without pretending raw reports are evaluator decisions; preserve decision schema/version. For native evidence, stage a complete file in the owned directory then publish with an atomic no-replace operation, with no truncating/overwriting fallback. The launcher must not treat a partially written file as completion. Finish is single-shot; a second finish cannot replace the first evidence. Streaming logs are exclusively created, bounded, closed at completion and never used as an authoritative completion marker. Publication failure exits as an instrument failure; if no safe diagnostic can be written, report that fact on stderr.

X11 policy: an existing reachable pathname socket may be used read-only, never removed; an existing unreachable/ambiguous path causes a prerequisite failure, never deletion. Only create a relay by exclusive bind to an absent path when needed for the current display. Record ownership and remove only that same owned socket after closing connections/server; if ownership cannot be established or has changed, leave the path and report cleanup failure. Tests use temporary sockets, never a real user's X11 socket. No host firewall/system configuration changes.

Decisive tests: a directory containing only an old q2 report is refused byte-for-byte intact; empty directory, symlink and creation race also refuse; injected write/link failure leaves no published partial report; repeated finish preserves the first evidence; live and unreachable foreign sockets survive; owned relay cleanup works on success and error. Exercise the real publisher and launcher orchestration, not a replacement policy in tests.

## DB3 — complete the pilot's lifecycle contract

The launcher owns the child process group, timers/polls, log descriptor, relay connections and run outputs. One terminal path handles success, build/launch failure, malformed evidence, asset mismatch, signal, timeout and publication failure. In `finally`, stop scheduling, clear every timer/poll, close descriptors and relay connections and stop/join run-owned processes. Handle signal termination as completion of a child, not only a numeric `exitCode`. No pending interval may keep a failed launcher alive.

The WebView owns exactly one worker and its pending requests. Worker error/messageerror, native rejection, cancellation and normal completion all settle the run once. Messages and replies carry run/handle/request identity; stale replies cannot update a settled or different run. Transfer returned buffers rather than cloning them. The worker guards `CogStream.free()` once in cleanup, bounds windows to 1024² before allocation, and clears retained tiles/pending work. Cancellation stops scheduling immediately; after at most five seconds force worker termination and host-process cleanup, and fail the pilot if cooperative release did not complete. This establishes pilot safety only, not Q-CANCEL/Q-TEARDOWN qualification.

Native fixture admission/hash/read/publication work uses the existing executor. Return a renderer-safe run description, not the path-bearing launcher `RunSpec`. Keep paths and output authority native-side. Validate the caller's run nonce rather than supplying the current nonce on its behalf. Reserve request identity before asynchronous queuing, so two overlapping identical IDs cannot both execute; release reservations on every terminal path. Keep limits at two active and 32 waiting reads with excess rejected. Use short state locks for reservation/accounting, not a global lock across blocking I/O. Use safe positional reads or per-descriptor serialization so concurrent intervals cannot share a seek cursor unsafely. Native high-water counters must observe actual queued/active transitions.

Closing a handle prevents new reads; teardown revokes all handles, cancels queued work and drops host-owned fixture descriptors after in-flight work settles. Immutable fixture metadata/ledger may outlive descriptors for reporting. Forced process exit is the last bounded cleanup fallback, not evidence that graceful release occurred. Retain 4 MiB per read, positive overflow-safe within-file intervals, no whole-artifact requests, separately counted preflight hashing, header 64 KiB growing only on actual shortage to at most 1 MiB, and 128 MiB retention ceiling. Retain the ten-minute pilot deadline (build compilation excluded) and 256 MiB generated-fixture/run-output cap; bound writers/logs and subprocess output, not just a final size report. Cap/deadline failure must stop the run and preserve existing inputs.

Decisive tests: error before/after worker startup; late reply after cancellation; double disposal; queued duplicate ID; actual queue saturation; close/teardown while a read is in flight; unknown/wrong-run/closed handle; dropped caller releases reservations; native I/O failure; timeout and signal leave no run-owned worker/process/poll/socket active. Use controllable I/O/process boundaries to demonstrate lifetimes; manually inserting into a private set is not proof that the real command path reserves requests. The full host adapter and actual executor must participate in relevant concurrency tests. Exceed cap/deadline with small injected test limits, not expensive experiments.

## DB4 — reproducible build and truthful terminal result

The documented launcher command builds current evaluator/producer TypeScript into a fresh owned build directory using installed tooling and invokes that exact output. It must work when ignored `ts/dist` is absent and must not silently run stale output. Missing prerequisites fail before the pilot starts with the exact unavailable command; no dependency installation or engine fallback. Preserve embedded-asset digest verification and engine/source-pin limitations.

Define launcher exits independently of the evaluator's whole-Q exit:

| Launcher exit | Meaning |
| --- | --- |
| 0 | This bounded pilot completed, its required comparisons/safety checks passed, a valid current-run decision was published, Q-LOCAL-1 and Q-HOST-1 pass, and no evaluated requirement fails; other requirements may remain inconclusive |
| 1 | An actual pilot measurement/required check failed or required positive pilot evidence is incomplete; preserve failures and gaps separately |
| 2 | Instrument/build/input/publication/evaluator failure, including missing/malformed decision, wrong profile/version or inconsistent exit/document; never a successful measurement |

Cancellation and deadline abort are instrument failures (exit 2), with reason recorded, not fabricated scientific violations. Unknown whole-Q evidence remains inconclusive. The evaluator's ordinary exit 1 for a coherent incomplete-Q decision is expected and alone must not fail a successful bounded pilot. A measured requirement failure is exit 1; a missing decision is exit 2 regardless of subprocess status. Do not change evaluator semantics.

Read `verdict` and existing reason fields from the actual decision schema; retain per-requirement diagnostics in the pilot summary. A fallback `rejected-input` document is not a decision. Verify profile and correspondence to the current raw sources before summarizing. The CLI wrapper propagates this terminal result.

Decisive tests: clean-build success without `dist`; deliberately stale output ignored; evaluator exits without a decision; malformed/rejected decision; measurement failure; expected full-Q inconclusive with both pilot requirements passing; summary preserves actual verdict/reasons; error plus cleanup failure retains both diagnostics and never exits zero. Run subprocess tests on the real launcher with controlled external host/build boundaries; these stubs are not Desktop capability evidence.

## Execution, verification and stop

Proceed serially without courier checkpoints: first DB1 producer regressions and repair; then DB2/DB3 ownership and failure paths; then DB4 clean-build/exit integration. This ordering has one final acceptance boundary, not four deliveries. Capture first meaningful RED and GREEN for each family, with a passing control. Perform one bounded adversarial pass across raw host evidence, output ownership, cancellation and terminal outcomes. Use isolated guard removal to prove each detector fails on its intended assertion; report redundancy or zero results honestly. Repair same-family counterexamples within scope before delivery.

Run tooling TypeScript compilation and all emitted Node tests (including new producer/launcher tests), `python3 -W ignore::ResourceWarning -m unittest discover -s scripts/raster-qualification/tests`, `bash scripts/raster-qualification/tests/test_runner_exit.sh`, host frontend typecheck, isolated host cargo test/check/clippy offline and formatting, `python3 scripts/check_docs.py`, syntax checks for touched launchers and `git diff --check`. Preserve frozen Python; it is not the authority for new behavior. Follow AGENTS.md for repository Rust CI-parity and post-rebase gates; isolation is not a waiver. Record unavailable commands and dirty-baseline formatting separately; do not change user work to obtain green checks. Document exact commands for newly introduced test entry points in the host README.

Only after deterministic gates pass, attempt the authorized small Desktop run(s) with bundled assets and network denial in fresh directories. Record exact source/build/artifact identity and raw source hashes. Do not regenerate historical runs. If the environment is unavailable, deliver implemented/tested versus unmeasured separately; no invented acceptance. Full Q remains unqualified even if both pilot requirements pass. No new Q capability is claimed merely from this safety repair.

Update one revision-labelled section of `q-typescript-receipt.md`, the standing review's implementer response, index, LiDAR/current-Q routing and the debrief. For DB1–DB4 include the violated original contract, detector through the real boundary, self-review counterexample, coverage limit and remaining authority needed. Do not mark your own work independently accepted. Retire this prompt after delivery but retain its design decisions in the maintained host guide; a retired assignment is not proof of completion.

Follow tracker/export/commit/push rules, preserve accepted ancestry and leave the Q bead open. Return baseline/delivery commits, commands and outcomes, the bounded pilot verdict separately from overall Q, untouched user files and next blocked dependency. Stop for one independent review through the user. If the architecture above cannot meet its constraints, return the smallest concrete conflict and recommendation; do not invent a new route or enter an unlimited repair loop.
