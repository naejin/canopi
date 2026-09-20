# TypeScript qualification — standing independent review

Status: evidence — numeric completion/MR1 accepted at `579880be`; Desktop completion `f9b5c10c` independently reviewed as partial with remaining DB3/DB4 blockers. Q remains unqualified.
Tracking: `canopi-kqpp`, parent `canopi-j571`; bd owns work status.
Current guidance: [migration receipt](q-typescript-receipt.md), [collaboration protocol](collaboration-protocol.md), [decision-complete design](q-typescript-reassessment.md), [C1–C8 contract](q-admission-acceptance.md), [debrief](review-and-debrief.md), [retired Desktop bridge handoff](q-desktop-bridge-agent-prompt.md).

This is the single review record for the bounded TypeScript repair. Update it in place after each user-forwarded independent review. Implementers may append responses with revision/test references, but must not mark their own changes independently accepted. Preserve revision-linked findings; use bd for execution tracking rather than adding Markdown task lists.

## Instrument completion independent disposition

Reviewed `f9b5c10c` on `4564acc7`: **partial, not accepted**. Preserve observed-window regression coverage, exclusive roots/no-replace publication and fresh compilation. This is a remaining DB3/DB4 repair, not a reopened evaluator redesign. The [lifecycle handoff](q-desktop-lifecycle-agent-prompt.md) owns the next bounded assignment when forwarded by the user.

| Family / severity | Evidence and method | Existing contract violated |
| --- | --- | --- |
| L1 / high — cancellation | Executed the actual worker module with only its module-load dependency delayed: send run, send cancel, resolve import; observed `cancelled` followed by native `read` request `r0`. Source inspection: native reservation settlement exists only inside the executor closure; a dropped queued future cannot execute it. `start` does not reject teardown and `revoke_all` does not cancel queued closures | DB3 stops scheduling after cancellation, settles abandoned reservations and prevents queued work after revocation |
| L2 / high — final outcomes | Replayed the real launcher with its existing coherent environment fixture. Control exits/saves 0. Evaluator exit 2 with the same matching decision also exits/saves 0. Cleanup failure returns 2 but saved `pilot-result.json` still records 0 | DB4 rejects inconsistent evaluator process/document outcomes and publishes the final instrument classification |
| L3 / high — process/output limits | Source-traced, not a resource-exhaustion experiment: 256 MiB comparison reads only declared fixture bytes after preparation; total tree bytes are logged only. Fixture/evaluator synchronous subprocesses have no timeout; host alone has the experiment timer | DB3 bounds all non-compilation experiment work and aggregate generated/run outputs, not a final size report |

Independently rechecked saved retry `pilot-1789907442506-21`: 81,920 cells, two nodata cells, zero mismatches; decision contains Q-LOCAL-1/Q-HOST-1 pass and ten inconclusive. No new Desktop experiment was run. Tooling compilation, 328 Node tests, 20 isolated Rust tests, docs and diff checks passed. This review did not rerun frozen Python, runner stubs or repository Rust CI parity; the implementation report's skipped parity reason (isolation) is not the waiver the contract explicitly disallowed. User-owned `desktop/src/native_operation.rs` remains untouched.

The preceding intervention did not achieve one-pass acceptance. These findings cite already fixed behavior, not optional hardening. Process-adapter and suspended-operation tests remain necessary: a test that replaces the adapter cannot prove its cancellation or deadline behavior. Review remains finite; acceptance of retained progress does not establish an exhaustive safety proof. No files were changed during the diagnostic review; this disposition is recorded in the subsequent user-authorized documentation handoff.

## Desktop bridge independent disposition

Reviewed implementation `fab0c381` and delivery through `bf65c479` on checkout `b95b8d1d`: **partial, not accepted as a complete instrument**. The earlier numeric/evaluator acceptance remains intact. The [completion handoff](q-desktop-bridge-completion-agent-prompt.md) settles the next repair's design; execution requires the user to forward it.

Read-only inspection of saved `final-e` evidence independently checked all 81,920 cells against the specified formula, including two nodata cells, with no mismatch. Native/worker totals reconcile: 12 reads, 11,599,872 candidate bytes, maximum read 1,048,576 bytes. This is genuine exploratory progress, not full-Q qualification. No new Desktop run was performed during review.

| ID / severity | Existing contract and evidence | Acceptance blocked |
| --- | --- | --- |
| DB1 / high | The original assignment requires every requested cell to be compared. Replaying the actual producer construction over saved host evidence with five `{id: origin, x: 0, y: 0, w: 0, h: 0, values: []}` windows yielded `result: pass`, no failures, zero checked cells and 81,920 claimed measured cells. `runPilot.mjs` checks list length and mismatch counts, then builds measured windows from requests | Trustworthy producer coverage, not the correctness of the original saved cells |
| DB2 / high | Existing no-overwrite and ownership contract: the launcher guards only three names and directly overwrites other reports; native evidence is directly written while its existence is polled. An existing X11 socket is removed after connection failure without ownership proof. These are source-traced paths, not destructive experiments on user files | Safe publication and foreign-resource preservation |
| DB3 / high | Original pilot lifecycle requires bounded cancellation, guarded disposal, native executor use and run ownership. WebView/worker lack guaranteed termination/disposal; native revocation retains descriptors; fixture admission hashes directly inside the async command. Source inspection also shows request reservation occurs inside serialized I/O and queue high water is not observed | Pilot safety; not a demand for full Q-CANCEL/Q-TEARDOWN capability evidence |
| DB4 / medium | The promised reproducible command invokes disposable evaluator output without building it, catches evaluator failure and continues with a null decision. Summary reads `status` instead of `verdict`. Source-traced; a clean-checkout Desktop experiment was not run | Reproducible command and truthful terminal status |

Review gates passed: emitted Node suite, 16 isolated Rust tests, 261 frozen Python tests, 18 runner checks, tooling TypeScript compilation, docs and diff checks. Repository Rust CI parity and fresh Desktop runs were not independently repeated. The pre-existing `desktop/src/native_operation.rs` edit was untouched. Passing helper suites do not cover DB1's real producer counterexample. This finite review does not establish absence of other defects.

Disposition: retain the measured evidence and implementation; complete these four families in one bounded repair. Do not restart evaluator architecture work, relax requirements or advance to N1. The design now explicitly settles exclusive run roots, lifecycle completion and launcher exit semantics; its acceptance examples are reviewer-owned. New requirements outside this contract return through the user, not a retroactive repair demand.

## Numeric completion independent acceptance

Reviewed `579880be`, implementation `e1f7ac95`: **accepted for the bounded NC1–NC2/MR1 slice**, with no remaining blocker found in that review. An independently generated 125-case real-CLI matrix over absent/null/fractional/zero/positive values for each of the three counters matched all expected ledger verdicts. Compilation, 279 TypeScript tests, 261 frozen Python regressions, 18 runner checks, docs, syntax and diff checks passed. Fresh-output compilation and real qualification experiments were not independently repeated. No files were changed during review.

This closes the agreed tooling repair loop, not every possible evaluator defect and not Q qualification. Retain accepted behavior; the bounded positive Desktop bridge slice followed and is delivered at `fab0c381` (see the response below), with TS/Rust producer work and evidence separate from full-Q acceptance. No new real Q capability was demonstrated by the numeric repair. User-forwarded execution remains required.

## Settled-design independent disposition

The latest review is [numeric completion acceptance](#numeric-completion-independent-acceptance); the following baseline is retained as revision-linked evidence.

Reviewed delivery: `d6b3f8e1`, including implementation `70f97f30` and design `ac68fb64`. This historical disposition led to the now-retired [boundary-repair handoff](q-final-boundary-repair-agent-prompt.md). See the newer disposition below for current blockers.

These reproductions used fresh small synthetic reports through the real emitted CLI, starting from `roleReports()`, `SOURCE_ROLES`, `NOW`, the real contract and declarations in `ts/tests/{contractFixture,fixtures}.ts`, and `TempRoot`/`runCli`. They demonstrate incorrect individual requirement verdicts and input-path creation, not an overall Q pass or overwriting existing data.

| ID / existing contract | Minimal mutation and observed result | Required result / location |
| --- | --- | --- |
| B1 / D3, C7 | Create `alias` symlink to an existing `actual` directory. Declare absent q2 input `alias/not-yet.json`; request output `actual/not-yet.json`. CLI exits 1 and creates that input containing a version-2 decision | Refuse with exit 2; input remains absent. `publication.ts:canonicalInput` lexically resolves missing paths without resolving existing ancestor aliases |
| B2 / D1–D2, C8 | Set `q2.windows[0].window.w=2048`: Q-LOCAL-1 fails. Delete `h`: becomes inconclusive. Separately set `serverLedger.fixtureBytesServed=-1`: fails; delete `fixtureRequests`: becomes inconclusive | Independently known width/negative-byte violations and their reasons remain failures; missing operands also remain gaps. `evidence/numericTransport.ts` returns before independent checks |
| B2 / D1–D2, C8 | q3prepare: identity sidecar policy `measured`; sidecar `{expectedSha256: "a" repeated 64 times, sha256: same, before: true, after: false}` fails Q-PREP-1. Delete `identity.sidecarPolicy`: becomes inconclusive and loses disappearance reason | Recorded disappearance remains fail alongside the policy gap. `evidence/preparation.ts:sidecarSurvival` exits on policy absence before reading survival |
| B3 / D2, C1 | Set q2 window width to `"bad"`, or q6resources first measurement `routeRole=null`: corresponding requirement becomes inconclusive | Supplied malformed leaves fail; genuinely absent leaves gap. `numericTransport.ts:windowBounds`; `resources.ts:roleLabels` ignores the parsed malformed-role distinction |

Independently retained: a failed display tile plus missing `ok` now keeps the failure; a wrong artifact version plus missing another artifact keeps the failure. Compilation, 239 TypeScript tests (approved unrestricted rerun after sandbox failures), 261 Python tests, 18 runner checks, documentation validation, shell syntax and diff checks passed. The review did not independently repeat fresh-outDir testing or real/private qualification experiments. Worktree remained unchanged. Passing tests do not cover the counterexamples above.

Disposition: finish these boundaries under the settled design, not another architecture migration. Review the repair and bounded same-family sweep together. Do not expand acceptance to optional hardening. Any further blocker must demonstrate a violation of an existing validity or input-preservation invariant; otherwise track it separately. Q remains unqualified and N1 unstarted.

## Boundary-repair independent disposition

Reviewed checkout `933fb593`, implementation `95028481`. Original B1–B3 examples are independently repaired, but the slice is **not accepted**: two numeric cases still violate D1–D2/C1/C8. These are bounded same-family findings, not new architecture requirements. The [numeric completion handoff](q-numeric-counter-repair-agent-prompt.md) is the sole next assignment when forwarded by the user.

Real-CLI reproductions used the same coherent `roleReports()` control, real contract/declarations and fresh temporary sources as the prior review:

| Finding | Mutation / observation | Required result |
| --- | --- | --- |
| NC1 — discrete counters | Independently set q2 `serverLedger.fixtureRequests=0.5` or `testedWindows=0.5`: Q-LOCAL-1 **passes** | Malformed count fails with identifying reason. `readCounter` now checks finiteness but lost whole-number validity |
| NC2 — true comparison operands | With nine validated windows, set `serverLedger.fixtureBytesServed=0` and delete `fixtureRequests`: Q-LOCAL-1 becomes **inconclusive** | Ledger contradiction fails despite unrelated request-count gap. Its comparison currently waits for all three operands |
| MR1 — readiness semantics | Receipt describes `q2-local-bridge` as a produced scoped-bridge capability needing wiring | `measure.py:cmd_q2_local_bridge` explicitly checks `bounded-range-rejected` and prefix metadata for stripped input. This negative control cannot qualify successful Desktop bridge access by changing roles or report paths |

Independently retained: alias reproduction exits 2 and preserves absence; width 2048 without height, negative bytes without requests, disappearance without sidecar policy, and null route role all fail correctly with applicable gaps retained. Compilation, 266 TypeScript tests, 261 Python regressions, 18 stub-runner checks, docs, shell syntax and diff checks passed. Fresh-output compilation and private runs were not independently repeated. No source/doc changes occurred during review; no overall Q pass was demonstrated. This documentation update records that completed review, not another test run.

Correct NC1–NC2 and MR1 under the existing design; no broader audit or producer implementation is requested. Q remains unqualified and production N1 unstarted.

## Baseline evidence and retained work

### Reassessment design review and closure

The delivered proposal in `55d6f485` was useful evidence, not implementation-ready design. Independent review identified five gaps: a void/no-op check could appear successful through empty findings; a fixed sibling diagnostic could still overwrite evidence; retention tests derived from production `reads` missed within-check dependencies; the proposed migration did not cover all named mappings; and deferring reproducible-build admission weakened an existing contract. These are design findings, not new measured engine failures.

The user then delegated engineering design ownership to the reviewer. The current [D1–D5 design](q-typescript-reassessment.md) resolves those points: explicit evidence-backed outcomes and runtime rejection of invalid outcomes; immutable publication with uniquely owned fallback diagnostics; independently derived same/cross-record failure-plus-gap cases; complete mapping ownership and removal of the transition adapter; and retained pinned-build correspondence tied to measured artifact digests. Decision schema version 2 and fresh outputs are deliberate tooling compatibility choices. No implementation has yet proved them.

Implementation now follows one [fixed handoff](q-typescript-implementation-agent-prompt.md), not the retired Round 1/2 prompt. Design clarity does not establish acceptance: independent review must still verify behavior against C1–C8. Do not convert this design closure into a passing qualification receipt.

The reviewer independently verified the TypeScript build, 74 emitted tests, 14 stub-runner checks, documentation validation and diff checks. The initial sandboxed test run failed because child-process stderr capture returned `EPERM`; an authorized unrestricted rerun passed all 74. Record environment failures separately from code failures; never weaken stderr assertions to accommodate the sandbox.

Retain TypeScript, source-byte parsing, recomputation instead of bundle trust, the runner's TypeScript decision routing, the strict boolean/JSON regressions and previously accepted R5 behaviors. Passing these checks is not acceptance of every invariant. No private qualification experiment or read-only private reconciliation was independently rerun in this review. The 261 retained Python tests were reported by the implementer, not rerun in this TypeScript review.

## Blocking families within C1–C8

All examples used the emitted real CLI with fresh small temporary reports. Start from `roleReports()`, `SOURCE_ROLES`, `NOW`, the real contract and fixture/pin declarations in `ts/tests/{contractFixture,fixtures}.ts`, and `TempRoot`/`runCli` in `helpers.ts`. Assert the target requirement and reason, not just overall exit 1: permanent gaps already prevent overall qualification.

| Family / contract | Reproduction at baseline | Required behavior and family scope |
| --- | --- | --- |
| T1 — keyed identity, C1/C8 | Add a second `q2` source: a failed source before a passing source yields `Q-LOCAL-1=pass`; reversing order yields fail. `decide.ts` constructs `byRole` with last-write-wins | Identical and conflicting duplicate source roles are invalid, independent of order. Check every keyed source/run/artifact/declaration collection before indexing, with failure reasons retained. Do not merely reverse which duplicate wins |
| T2 — per-run completeness and precedence, C5/C8 | Append an otherwise complete candidate run without `incrementalPeakRssMiB`: `Q-RES-1` passes. Set decoded cache to 1 GiB and remove `sampleCount`: a known 128 MiB violation becomes inconclusive | Missing mandatory memory for any applicable run is a gap; any independently recorded over-limit value remains fail despite sampling gaps. Check all per-run fields, sampling, invalid values, attribution and permutations. A shared reduction cannot repair evidence silently discarded before it reaches the reduction |
| T3 — required artifact coverage, C3/C4 | Delete `integrity:cog-tiler-wasm`, or replace integrity assertions with only `integrity:unrelated`: `Q-ART-1` passes. Set preparation's recorded artifact to `{name: "unrelated-engine", version: "999"}`: `Q-PREP-1` passes | Required sets come from declarations, not the supplied prefix matches. Every required artifact needs applicable integrity/version/license/correspondence evidence. Native preparation/slope/CRS roles also need declared applicable identity checks; an unpinned source revision does not mean any engine identity is acceptable |
| T4 — sidecar evidence, C2/C4 | Declare measured sidecar with `{expectedSha256: "x", sha256: "x"}` and no survival observation: `Q-PREP-1` passes | Malformed digests fail; missing survival/before-after evidence is a gap, and false survival or conflicting hashes fail. Check measured/not-applicable/unmeasured policies and all consumed nested leaves without promoting arbitrary equality into preservation evidence |

Additional T2 scope already required by C5: display disk-cache compliance (512 MiB) and the plan's staging/free-space policy are not established by the current reducer. Supplying an extra `displayDiskCacheBytes=1 GiB` leaves the baseline passing; this is not proof that the producer defines that field. Establish and validate the actual observation contract, or return inconclusive if unsupported. Do not invent a universal temporary-disk cap or run a new producer experiment. Missing policy evidence must not yield a resource pass.

These are false **individual requirement** passes and lost failures, not an observed overall Q pass. Source locations at the reviewed revision: `ts/src/decide.ts`, `reduce.ts`, `declared/route.ts`, and `evidence/{resources,artifactCorrespondence,preparation}.ts`. Recover exact baseline code with `git show abf502b6:<path>`; line numbers may change.

## Review protocol and round record

The user remains the courier and approval point. No direct implementation/reviewer delegation is authorized. The [standing prompt](q-typescript-repair-agent-prompt.md) defines the two-round limit and self-review requirements. The baseline discovery review is round 0. Round 1 is delivered and independently reviewed below; Round 2 has not been authorized by this review.

For each reviewed delivery, append a compact evidence entry: starting/final commit; family-level response; commands actually run; independently accepted behaviors; remaining blockers with C IDs, minimal input and expected/observed result; optional follow-ups; environment and unavailable evidence. Review all C1–C8 boundaries in one pass before handoff and explicitly identify unreviewed portions. New blocker examples must cite an existing invariant; changing the acceptance contract requires user approval. Never imply exhaustive proof from a finite sweep.

## Round 1 implementation response (implementer, not acceptance)

Delivered from `abf502b6`/`df54b314`; section appended to the [migration receipt](q-typescript-receipt.md#round-1--repair-against-the-standing-review-at-abf502b6) and the reproduction/mutation log is [q-typescript-repair-round1.txt](evidence/q-typescript-repair-round1.txt). Awaiting independent review; nothing below is accepted on the implementer's authority.

| Family | Family-level response | Evidence |
| --- | --- | --- |
| T1 | Source roles are counted before indexing; a role claimed more than once is rejected outright and omitted from the index, and the ambiguity reaches the requirement as a failure rather than a gap. Order no longer decides the verdict. | `t1DuplicateRoles.test.ts`; Q-VALUE-1's two-source case in `adversarialRound1.test.ts` |
| T2 | Memory became a mandatory per-run observation; every leaf is classified usable / present-but-unusable / absent; the budget check reads every record that recorded the counter, so a measured over-limit value survives a sampling gap in the same record. | `t2RunReduction.test.ts` |
| T3 | Required sets come from the declarations: each required artifact's own version, integrity and license record is looked up by name, and the retained-engine roles declare native GDAL with the name compared and the version recorded. | `t3ArtifactCoverage.test.ts` |
| T4 | Malformed digests fail, absent ones are gaps; hash equality is no longer treated as survival evidence, so a measured record must observe presence before and after. | `t4Sidecar.test.ts` |

Two review notes are answered explicitly rather than deferred. The plan's 512 MiB display disk-cache bound and its staging/free-space policy have no producer observation, so the requirement now carries an unconditional gap and a caller cannot move it by inventing a field name; `Q-RES-1` moved out of the fixture's supported set as a recorded consequence. The reviewer's environment note did not recur: child-process capture worked for every case in this round.

Reported honestly for review: eleven guard-removal probes were run, and **one (G4) was a genuine gap in the implementer's tests** — reverting the budget check to sampled records left the suite green because every over-limit case had a second healthy run. Two cases were added and the re-probe now fails. The sweep and adversarial pass also surfaced three defects in the implementer's own expectations and two in its fixtures, all recorded in the log. No claim of exhaustive coverage is made from a 32-mutation sweep.

## Round 1 independent disposition

Reviewed checkout: `8ab1fff7`, implementation `73a7b214`. **Not accepted as a complete decision path.** This review preserves the fixed baseline cases; it does not request another architecture/language migration or new experiments. Remaining blockers below are instances of the unchanged C1–C8 contract, including existing paths not caught by the earlier narrower reviews.

### Independently verified and retained

- TypeScript build succeeds; all **127 emitted tests**, **261 retained Python tests**, **14 stub-runner checks**, docs validation and diff checks pass. Node tests ran with approved unrestricted subprocess capture because the baseline environment had a demonstrated sandbox stderr restriction. Python ran with ResourceWarning display suppressed, not assertions suppressed. No claim of an independently repeated empty-dist build.
- Real CLI reproducers confirm duplicate `q2` roles now fail, an unsampled decoded-cache violation remains fail, missing cog-tiler integrity now blocks Q-ART-1, and malformed measured sidecar digests fail. Retain those fixes and the additional committed regression cases.
- Missing display disk-cache evidence honestly blocks Q-RES-1. New producer observations and remaining Python migration are outside this repair. The absence of a universal temporary-disk cap is not a reason to invent one.
- Retain no bundle input, TypeScript runner routing, strict boolean/duplicate-key cases, raw source recomputation and the existing engine/UI approval gates.

### Consolidated remaining blockers

Every mutation below used fresh temporary fixture reports and the emitted CLI, except the explicitly labelled direct API check. Unmodified controls passed the target requirement where the contract permits it. The exact authoritative Q contract was used except for the **explicitly labelled synthetic-isolation control**. Overall Q stayed non-pass in the full-contract cases; individual false passes and lost failure severity remain blockers.

| Family / contract | Minimal change and observed result | Required correction |
| --- | --- | --- |
| R1-A — T1/T3 declaration correspondence, C1/C3/C4 | Remove request `pins`: Q-ART-1 still passes. Set both revisions of each `q1.sourceCorrespondence` entry to forty zeroes with `matches=true`: passes against unchanged declared pins. Change a correspondence version to `999`: passes. Prepend a wrong-version duplicate to `verifiedArtifacts` before the valid record: passes | Compare every required artifact/version/revision against independent declarations, reject duplicate identities before indexing, and retain required-set completeness. `declaredPins` reaches admission but is not consulted; comparing two report-owned revision strings is not pin verification. Preserve reproducible-build correspondence requirements rather than accepting a boolean |
| R1-B — T2/T4 and admission failure retention, C2/C5/C8 | Set resource sampling to 900 ms and remove `sampleCount`: Q-RES-1 becomes inconclusive, losing the known cadence violation. Put a 2048 MiB candidate record after a leading `null` measurement: memory assertion passes and Q-RES-1 is only inconclusive. Declare measured sidecar `{expectedSha256: 'a' repeated 64, before:true, after:false}` with missing observed hash: Q-PREP-1 becomes inconclusive instead of fail. Append a declared fixture with missing hash and independently change q2's existing fixture hash to a conflicting valid digest: Q-LOCAL-1 becomes inconclusive, losing the conflict | Collect independently evaluable failures before gaps. Do not filter records and then reuse pre-filter indexes (`resources.ts` reads the reference memory at the candidate's old index). Partial declarations must retain usable expectations for independent comparisons. A central reducer cannot recover findings callers discarded |
| R1-C — complete display/local scientific evidence, C3/C4/C5 | Set first display run to `tilesRendered=1`, `tileRequests=999`, retaining 100 valid samples: Q-DISPLAY-1 passes. Set all latency samples and median/p95/max to -1: passes. Set numeric server ledger to zero bytes and zero requests while retaining validated windows: Q-LOCAL-1 passes. Set window width to 0.5: passes. Unmodified q2 control declares `http-range`, yet passes the proposed-local-transport assertion | Reconcile render/request/failure/sample counts per run; reject negative durations and fractional cell dimensions; actually reconcile client/server byte ledgers. HTTP Range capability is not the plan's Desktop/native scoped local bridge. Require appropriate route evidence or an explicit gap without running a new experiment. Audit all mappings for sufficiency, not names alone: preparation maps bounded tiling to `derived-tiled` although the producer has a separate `derived-block-bounded` check |
| R1-D — admission and policy boundary completeness, C1/C2/C3/C8 | Add `q2.preconditions=[{name:'hash-valid'}]` without `met`: Q-LOCAL-1 passes. `preconditions:null` also passes. Add `failures=['window read failed']` and `negativeControlScopes=['window']`: passes. Change only q2's top-level `experiment` to `not-q2`: passes despite identity contradiction. Insert `1e999` as an optional raw JSON value: passes. Equal valid sidecar hashes with `after:true` but no `before` pass | Missing precondition outcomes must block, present malformed containers fail, arbitrary report-owned prefixes cannot exempt positive failures, and envelope/identity disagreement must be detected. Reject numeric overflow after JSON decoding as well as bare nonstandard tokens. Require the promised before/after sidecar observation independently; do not confuse valid equal strings with a complete preservation measurement |
| R1-E — synthetic/public entry-point isolation, C6 | Restrict a temporary control contract to Q-ART-1 with coherent reports: normal control exits 0; adding request `synthetic:true` still exits 0 and publishes overall pass. This is **not** a claimed pass of the full Q contract. Direct `runQualification` with otherwise validated inputs and an unknown source role throws instead of returning its structured error outcome | Enforce synthetic exclusion independently of unrelated permanent gaps and centralize applicable CLI/programmatic boundary validation. No new CLI bypass for synthetic qualification. Preserve the full authoritative production contract; use the reduced control solely to expose the ignored marker |
| R1-F — output safety and diagnostics, C7 | Point `--out` at the temporary q2 source path: it is overwritten by the decision. Set request `pins=7` and use a writable fresh output path: exits 2 without a diagnostic artifact | Refuse output/input collisions and unintended overwrite; preserve source bytes and fresh-output safety. For readable malformed requests/declarations, emit a structured non-qualifying diagnostic at a writable destination. Do not equate a diagnostic artifact with a qualifying decision or leave errors solely on stderr |

Additional precision for R1-B: the current resource reducer checks some counters per run, but the separate memory reader still skips missing values and the sampling mapper still returns at the first gap. Thus its five assertions are **not** established as universally correct merely because the requirement now has a permanent disk-cache gap. Validate assertion verdicts as well as requirement verdicts. For staging/free-space policy, document its distinct missing evidence explicitly; the current unconditional resource reason names display disk cache only.

### Reproduction method

Use the existing emitted helpers; no private fixtures or engine run is required. Build first, then execute a small Node ESM driver importing `TempRoot/runCli`, `roleReports/SOURCE_ROLES/NOW/realContractPath`, and `fixtureManifest/candidatePins` from `ts/dist/tests/`. Load the real contract, construct fresh reports for each case, apply the table's mutation, write each role via `TempRoot.write`, and write `{contract,fixtureManifest,pins,now:NOW,sources}` as the request. Invoke `runCli(requestPath, outputPath)` and inspect `decision.requirements.find(r => r.id === target)` plus its assertions/reasons. Clean only that helper-created temporary root. For `1e999`, use `writeRaw` because `JSON.stringify(Infinity)` writes null. The output-collision reproduction used only a disposable report, never user evidence.

Source locations at `73a7b214`: `evidence/artifactCorrespondence.ts` (`verifiedVersions`, `pinnedCorrespondence`); `admit.ts` (`admitReport`, `applyFixtureChecks`, `negativeControlScopes`); `evidence/resources.ts` (`candidateMemory`, `sampling`); `reduce.ts`; `evidence/preparation.ts` (`sidecarVerdict`); `evidence/display.ts`; `evidence/numericTransport.ts`; `report.ts`; `json.ts`; `qualification.ts`; `cli.ts`. Recover the exact source using `git show 73a7b214:scripts/raster-qualification/ts/src/<path>`.

### Coverage, limits and next gate

This review inspected the parsing, declaration/admission, source indexing, all requirement mappings, reduction, CLI and runner boundaries, reran the committed suites and performed the targeted perturbations above across C1–C8. It did not independently rerun all eleven guard-removal probes, private reconciliation, engine measurements, a clean dependency install or packaged-platform tests. The sweep is finite, not proof against all inputs. Optional naming, dead imports, refactoring and toolchain coupling do not block this review.

The main residual pattern is incomplete semantics at the evidence boundary: declarations are passed but unused, required sets are inferred from observations, or early returns/filtering discard evidence before reduction. The previous reviewer also missed these existing paths; they are not newly introduced scientific obligations. Do not respond by adding more independent validators without tracing which source each assertion actually proves.

Round 1 is unsuccessful for whole-boundary acceptance. If the user elects to continue, forward this record with the **same standing prompt** for Round 2. Retain the accepted repairs, repair all six families and inspect their sibling paths before the next consolidated handoff. Stop for review again. If blockers remain after Round 2, the standing reassessment rule applies; no automatic Round 3, producer work, Python deletion, Q qualification or N1.

## Round 2 implementation response (implementer, not acceptance)

Delivered from `8ab1fff7`/`73a7b214`; round-2 section appended to the [migration receipt](q-typescript-receipt.md#round-2--repair-against-the-round-1-independent-disposition) and the reproduction/sensitivity log is [q-typescript-repair-round2.txt](evidence/q-typescript-repair-round2.txt). Awaiting independent review; nothing below is accepted on the implementer's authority.

| Family | Family-level response | Evidence |
| --- | --- | --- |
| R1-A | Correspondence is compared against the declaration at three independent points — the record's version must be the declared version, its claimed pin must be the declared pin, and its built revision must equal that pin — with the required set taken from the declaration. Duplicate verified identities fail before indexing and an absent pin declaration blocks rather than passes. `SourceView` carries the declared expectations, which is what let a mapping consult the declaration at all | `r1aCorrespondence.test.ts`; `SourceView` in `decide.ts` |
| R1-B | Four separate discarding mechanisms fixed where the finding was lost: the sampling reduction collects violations and gaps independently; the memory reader keys off the record instead of pairing differently-filtered lists by position; a recorded non-survival is read before any missing-hash gap; and a partly incomplete fixture declaration keeps its resolved members so they are still compared | `t2RunReduction.test.ts`, `round2Families.test.ts` |
| R1-C | Render counts must reconcile with requests and page errors must be empty; negative durations fail; the ledger must account for the windows the report claims; window dimensions must be whole positive cell counts; the declared transport is now the plan's scoped local bridge rather than `http-range`; and the preparation obligation combines the producer's separate tiling and block-bounding checks | `round2Families.test.ts`, `boundaries.test.ts` |
| R1-D | A precondition without `met` blocks; null containers are malformed rather than absent; a negative-control scope must be an explicit `expected-rejection:` declaration; the envelope must agree with its identity; numeric overflow is rejected after decoding; preservation requires both observations | `round2Families.test.ts` |
| R1-E | The synthetic marker blocks a qualifying verdict on the decision itself rather than relying on unrelated permanent gaps, and an unknown source role returns a structured outcome instead of throwing | `round2Families.test.ts` (including a direct programmatic call) |
| R1-F | The output path is compared against every file the run reads and a collision is refused with the source bytes intact; a refused input writes an explicitly labelled `kind: "rejected-input"` document that carries no requirement verdicts | `round2Families.test.ts` |

The transport item was a wrong **declaration**, not a missing comparison: the plan requires the scoped local bridge and rules out a remote HTTP demo, while the route expected `http-range`. Two committed tests had encoded the wrong expectation and were rewritten against the plan, which is reported in the receipt as a correction of the tests rather than of the code.

Reported honestly: thirteen guard-removal probes were run and **two are zero results**. The pin comparison does not fail the suite alone because the built-revision comparison immediately after it catches the same inputs, and the envelope/identity check is redundant with identity verification; the pin pair is load-bearing only together, which a combined probe confirms. One early probe reading was a measurement artifact — it instrumented `process.stderr`, which the test runner captures — and was re-measured before being believed.

Reviewer coverage note: the R1-C local-bridge item and the R1-D envelope agreement are existing contract paths that neither the implementer's sweep nor the earlier reviews reached. They are recorded as such rather than presented as newly discovered requirements.

## Round 2 independent disposition

Reviewed checkout `6a98cd33`, implementation `c76d1b2e`. **Not accepted.** The two-round stopping condition applies. The user subsequently authorized the [bounded design reassessment](q-typescript-reassessment-agent-prompt.md), not another repair round. Preserve delivered fixes; no rollback, engine change, Python work, Q experiment or N1 follows from this review.

Independently rerun: TypeScript compilation, **177 emitted Node tests**, **261 retained Python tests**, **14 stub-runner checks**, documentation validation and `git diff --check`, all passing. Node tests used approved unrestricted subprocess capture. This review did not independently repeat the clean-empty-dist build, sensitivity probes, private reconciliation or platform/engine measurements. The private `fail` distribution remains implementer-reported. No source files were changed during review.

### Reproduced blockers under unchanged C1–C8

All cases used the real emitted CLI, the authoritative contract and fresh `TempRoot` synthetic reports. The existing `roleReports()` control passed the target requirement. Overall Q remained non-pass; that does not excuse incorrect individual outcomes. These cases extend the previous families, not the requirements.

| Finding / contract | Minimal mutation and observation | Demonstrated cause |
| --- | --- | --- |
| R2-A — C5/C8 failure retention | Set `trace.runs[0].failedTiles=1`: Q-DISPLAY-1 fails. Also delete that run's `ok`: becomes inconclusive and the tile failure reason disappears. Independently, set `pageErrors=['render crashed']` and delete `tilesRendered`: page error is lost behind the missing count | `evidence/display.ts` rendering checks use an `if/else if` chain; page errors are examined only in the final successful-count branch |
| R2-B — C3/C8 artifact comparisons | Set `q1.verifiedArtifacts[0].version='999'`: Q-ART-1 fails. Also remove the second artifact record: becomes inconclusive, losing the wrong-version comparison. Separately set `q1.sourceCorrespondence[0].pinnedRevision` to forty zeroes and delete `artifactRevision`: the present pin conflict becomes only a missing-revision gap | `verifiedVersions` returns on missing coverage before comparing present versions. `pinnedCorrespondence` requires both revisions before independently comparing the present claimed pin to the declaration |
| R2-C — C4/C5 observation sufficiency | Set the first trace run's `tilesRendered=1` and `tileRequests=1`, retaining its 100 latency samples and zero failed tiles: Q-DISPLAY-1 passes | Render/request equality is checked, but sample/count consistency and the plan's minimum 100 tile requests per run are not established |
| R2-D — C7 source preservation | In a disposable request with valid source paths, set `now='invalid'` and `--out` equal to its q2 source path: CLI exits 2, but replaces source bytes with `kind:'rejected-input'` | `cli.ts` registers source paths only after request validation succeeds; the rejection publication path knows only the request/declaration paths |

These four families encompass the five examples in the user-facing review (wrong version and wrong pin are separate examples of R2-B). Reproduction method is the Round 1 method above: existing emitted `TempRoot/runCli`, `roleReports/SOURCE_ROLES/NOW/realContractPath`, and `fixtureManifest/candidatePins`; fresh control per mutation. For R2-D capture source bytes before/after and parse the written document's `kind`; only a disposable report is overwritten. For R2-C preserve the control's recorded statistics and samples—no engine measurement is claimed.

### Structural reassessment and retained work

The demonstrated defect is not the precedence table: independently decidable facts never reach it. Central reduction cannot preserve a failure an earlier branch skipped. Separately, independent counters are not enough without relationships that establish what was measured. The output safety defect is an ownership boundary that applies only after successful admission, despite rejection also writing a file.

Retain TypeScript, raw-source snapshots, the no-bundle-input boundary, runner authority, strict parsing regressions, accepted historical fixes, and honestly unsupported observations. Existing tests remain useful but are not a sufficient acceptance oracle. Do not infer that all six Round 1 families are complete from the passing suite. This review was targeted and finite; it did not independently establish the absence of sibling defects across the whole boundary.

The approved next activity is evidence-backed comparison of bounded mapping repair versus a focused finding/publication seam change, with a recommendation, migration proposal and independent verification strategy. It is not an approved redesign. No third repair round is authorized. User-mediated independent design review must precede implementation.

## Reassessment delivered at `82184e6c` (proposed, awaiting design review)

The authorized reassessment is delivered as [q-typescript-reassessment.md](q-typescript-reassessment.md). It is documentation only: no source, test, producer, requirement, tolerance, pin, budget or UI change, and `canopi-kqpp` stays open. This review's status moves from "repair rounds exhausted" to "awaiting user-mediated independent design review of a proposed bounded change". The four Round 2 families above remain the accepted record and are neither withdrawn nor superseded.

The reassessment re-reproduced R2-A to R2-D from the coherent synthetic control through the emitted CLI and verified its own build identity by recompiling the inspected source and diffing the emitted output. It added two families that neither the implementer rounds nor this review reported, both in the same defect class but outside the three files this review attributed:

| Finding / contract | Minimal mutation and observation | Demonstrated cause |
| --- | --- | --- |
| N-1 — C4/C8 route attribution | Reduce `q6resources.measurements` to the labelled candidate record: `reference-measurements-labelled-separately=inconclusive`, `measurement-is-of-candidate-route=pass`. Delete that record's `routeRole`: `measurement-is-of-candidate-route=inconclusive` and `reference-measurements-labelled-separately=**pass**` | `evidence/resources.ts` treats every record whose `routeRole` is not `candidate` — including a record with no role at all — as a separately labelled reference measurement |
| N-2 — C7 publication in `--reports` mode | Valid contract with `--out` on a declared report file: refused, file preserved, nothing written. Unreadable contract, same destination: the declared report file is replaced by a `kind:'rejected-input'` document | the same derivation order as R2-D — report paths are registered only once the request builds, although the nine report file names are statically declared and need no validation |

Retained as evidence by the reassessment: the recompilation build-identity check; the refuted `void gap` hypothesis (admission reports the merged shape's gaps, so a missing `identity.runId` does reach the decision — dead code, not a lost finding); and the comparison against the retained Python gate, which shows R2-C's sample/count reconciliation and N-1's undeclared-role rule are migration regressions that the retained implementation still enforces and tests, while R2-A's page-error check is a new TypeScript check that no retained path performs.

Review-coverage gaps recorded for the debrief: the Round 2 sweep and adversarial pass did not reach `resources.ts` route attribution or the directory-mode publication path, and the retained Python oracle for the undeclared-role rule asserts the *requirement* verdict, which stays `inconclusive` in the TypeScript path even when the individual assertion is wrongly promoted to `pass`. A whole-requirement non-pass is therefore not a sufficient oracle for individual assertions, in tests as well as in reviews.

No independent design review has examined the reassessment. Implementation, Q experiments, remaining Python migration and N1 remain unauthorized.

## Implementation response at `5878f80e` (implementer, not acceptance)

The settled design's S1–S5 are implemented in the commits `2b0a02c7`, `70e51534`, `1fb1d064`,
`8a85fc3a`, `567e6d29`, `5878f80e`. The implementer's evidence is the new section of the
[migration receipt](q-typescript-receipt.md#implementation-of-the-settled-design-s1s5); the design is
[q-typescript-reassessment.md](q-typescript-reassessment.md). Implementing a design is not accepting it,
and this response claims no resolution of the findings above.

Summary of the response to each family this review recorded:

| Family | Response |
| --- | --- |
| R2-A display failure retention | The display requirement is fourteen independent checks; failed tiles, page errors, reconciliation, the request minimum and the sample/render relationship each run whatever else is missing. The tile failure and the page error both now fail the assertion when a sibling count is removed, and the gaps are retained beside them |
| R2-B artifact comparisons | Coverage, present versions, the claimed pin and the built revision are separate checks. A wrong version fails even when another artifact has no record; a present wrong claimed pin fails even when the built revision is missing; and the design's reproducible-build route is admitted only with the full identity and digest chain |
| R2-C display sufficiency | The plan's per-run relationships are enforced: at least 100 requests, at least 100 usable latencies, samples equal to rendered, rendered plus failed equal to requested. The old 128-render/100-sample control is corrected and now fails |
| R2-D / N-2 publication | `publication.ts` never replaces an existing path, refuses a destination that is or resolves to a known input even when absent, refuses to use the requested path when the read-set is unknown, and publishes a diagnostic into a freshly owned directory with its real path on stderr. The runner refuses a stale final output before any producer step |
| N-1 route attribution | Only an explicit `candidate` or `reference` label attributes a measurement; an absent role gaps, an invalid or self-contradicting label fails, and an unlabelled record can never be counted as a separated reference measurement |

Also recorded as responses, not resolutions: the decision document's version is 2 with per-requirement
check receipts; the ledger of test-expectation corrections is in the receipt; two publication guards are
redundant in the single-creator case and are proven as a pair by a read-only-parent case and an injected
competitor; and the guard-removal probe pass found those two zero results, fixed them, and reports no
remaining zero results.

Unchanged by this response: `canopi-kqpp` stays open, Q is not qualified, no independent review has
examined the implementation, and no experiment, producer migration, engine work, Python deletion or N1
is authorized.

## B1–B3 implementation response at `95028481` (implementer, not acceptance)

The bounded repair is delivered; the implementer's evidence is the [repair section of the migration
receipt](q-typescript-receipt.md#b1b3-boundary-repair-implementation-response). Implementing a repair is
not accepting it, and this response resolves nothing above.

| Review finding | Response |
| --- | --- |
| B1 absent-input aliases | An absent input is canonicalized through its nearest existing ancestor with the unresolved suffix appended, and compared with the destination in the same canonical space. The reported reproduction now refuses with exit 2 and leaves the input absent; a genuine absence whose existing ancestor cannot be resolved (a dangling link) refuses publication instead of guessing; no directory is created. Existing-file, dangling-link and creation-race guards are unchanged and their tests still pass |
| B2 numeric independent failures | Dimensions and ledger counters are parsed and judged individually before any cross-field comparison. `w=2048` without `h` fails on the edge bound and records the missing height as a gap; `fixtureBytesServed=-1` without `fixtureRequests` fails on the byte count and records the missing operand as a gap. Area and corroboration comparisons without operands gap without erasing either |
| B2 sidecar independence | Survival is read whatever the policy says: a disappearance observed after recorded presence fails, and a missing policy is recorded as a gap beside it. A genuinely not-applicable declaration without contradicting observations still passes |
| B3 malformed versus absent | A present unusable leaf fails; absence gaps. Window width `"bad"` and `routeRole: null` now fail, with the full matrix exercised (null, wrong primitive and container types, zero, fractional, negative, unknown label) plus valid boundary controls. No coercion or truthiness |

Two further counterexamples were found by the bounded sweep and fixed in scope: negative counters were
admitted as measurements, and — against the retained producer report shapes — ordinary missing-field
gaps were classified as internal-check defects, which made a read-only reconciliation over real reports
exit input-class. The second is a validity threat of the same family, so it was repaired here and is
reported in the receipt.

Known and reported rather than hidden: the directory-mode alias case is protected by the output-side
canonicalization alone, so the input-side normalization is redundant in that direction; and the
measurement-readiness handoff records that no producer currently writes the `identity` block admission
requires, which is a prerequisite for any fresh qualification evidence and is outside this slice.

## NC1–NC2 implementation response at `e1f7ac95` (implementer, not acceptance)

The numeric completion is delivered; the implementer's evidence is the [numeric counter
section of the migration receipt](q-typescript-receipt.md#nc1nc2-numeric-counter-completion-implementation-response).
This response resolves nothing above.

| Review finding | Response |
| --- | --- |
| NC1 discrete counters | The three counters now require finite non-negative integers. `testedWindows=0.5`, `fixtureBytesServed=0.5` and `fixtureRequests=0.5` each fail on their relevant assertion and on Q-LOCAL-1 with the field and value in the reason; `null`, strings, booleans, lists and objects fail the same way; absent values still gap; zero remains a valid value and `T=0` still demonstrates no successful numeric read. Nothing is coerced or rounded, and a negative count keeps its own recorded-impossibility wording |
| NC2 true comparison operands | Each ledger relationship is decided from its own two operands. `T=9, B=0` with `R` absent fails on zero bytes and retains the missing-`R` gap; `T=9, R=0` with `B` absent is symmetric; `T=0` with recorded bytes or requests contradicts one operand at a time; an unusable value never enters the arithmetic; positive counters with one counter absent and no contradiction stay inconclusive rather than failed; and a pass still requires both relationships to be decided coherently |
| MR1 readiness semantics | Verified against `measure.py:cmd_q2_local_bridge`: it records `stripped-layout`, `bounded-range-rejected` and `metadata-from-prefix` checks and describes the stripped-file rejection as its negative control, so the corrected reading stands. The debrief's remaining wiring claim is corrected, and no producer was implemented |

Sensitivity: three isolated guard removals (integer validation, each relationship gated on the third
counter) were each detected by the intended cases, with no zero results. Two retained sweep expectations
were corrected for the new malformed-count wording without changing any verdict. **This tooling-only
slice adds zero real Q capabilities**, and the measurement-readiness handoff still requires a positive
local-bridge producer, the identity envelope and a declared host role before any fresh evidence.

## Desktop bridge transport slice at `fab0c381` (implementer, not acceptance)

The bounded transport slice is delivered; the implementer's evidence is the
[Desktop bridge section of the migration receipt](q-typescript-receipt.md#desktop-bridge-transport-slice-implementation-response).
This response resolves nothing above and claims no acceptance. Two things are different in
kind from every earlier slice, and both are for the reviewer to test rather than to take on
trust:

* **Real observations exist.** Q-LOCAL-1 and Q-HOST-1 pass in two repeatable runs at this
  revision, on a generated fixture, with the native ledger reconciled against the worker's
  own counters and four declared refusal controls refused through the real adapter path.
  The claim is bounded: the fixture is synthetic, the engine is the published artifact that
  does not correspond to the source pin, and the other ten requirements stay inconclusive.
* **The harness verifies its own inputs.** Embedded bundle digests are re-hashed inside the
  binary, and the launcher refuses a run directory that already holds results. Both exist
  because a stale or reused artifact produced a *passing-looking* run during development,
  which is exactly the failure mode a transport measurement must not have.

Sensitivity evidence is recorded with the delivery: breaking the analytic expectation after
the fixture was written turns the decision into `fail`, neutering the comparison turns it
back into `pass`, removing the read cap fails a bridge test, a wrong declared digest fails
the run, neutering the host digest comparison lets it pass, and a refusal control with the
wrong expected code fails Q-LOCAL-1.

Review coverage limit stated plainly: the probes were run by the implementer on the same
harness they exercise, the network namespace was exercised with a local X11 relay rather
than a firewall rule, and no independent reproduction of these two runs has happened yet.

## DB1–DB4 instrument completion (implementer, not acceptance)

Delivered on `feature/raster-html-references` after baseline `b95b8d1d`; evidence is the
[completion section of the migration receipt](q-typescript-receipt.md#desktop-bridge-instrument-completion-db1db4-implementation-response).
This response resolves nothing in the disposition above and claims no acceptance.

Each family now has a trace from its original contract through the real caller to the detector that fails when the
guard is removed, recorded in the receipt. The two points most worth independent attack:

* **The reviewer's counterexample is a test now.** Five empty duplicate windows flow through the real producer and
  the real evaluator CLI and are refused on the duplicate identity and the missing dimensions; the run exits `1`
  with the reasons preserved, not `0` with a claimed pass.
* **The instrument can no longer publish what it did not own.** An existing run directory of any shape is refused
  byte-for-byte, publication never replaces, the host publishes its own evidence atomically and once, and the
  launcher only summarises a decision that cites this run's report bytes.

One verification run of the repaired instrument completed with exit `0`: Q-LOCAL-1 and Q-HOST-1 pass, 81 920 of
81 920 cells exact, 2 of 2 nodata cells, four of four refusal controls matched by declared request identity, six of
six bundled assets verified, ledger reconciled. Q is still unqualified and no requirement is newly qualified.

Coverage limit, stated plainly: the runs are the implementer's own; cancellation is covered by unit tests and a
declared deadline rather than an observed mid-flight cancellation; the native reservation path is covered by bridge
tests and the real run rather than by a concurrent real-read test; and the verification run preceded a
whitespace-only `rustfmt` pass over the host sources.
