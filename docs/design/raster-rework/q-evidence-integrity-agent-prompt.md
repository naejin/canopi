# Q evidence integrity repair — agent prompt

Status: retired — executed in `2c830b0d`; independent review requires further repair. Q remains unqualified.
Tracking: `canopi-kqpp`, parent `canopi-j571`; bd owns execution status.
Current guidance: [implementation plan](../raster-data-analysis-rework.md), [review and debrief](review-and-debrief.md), [repository contract](../../../AGENTS.md).

Historical instructions retained for the requested debrief; do not execute again. The [admission completeness prompt](q-admission-completeness-agent-prompt.md) supersedes this handoff. See the [implementation receipt](q-evidence-integrity-receipt.md) and [independent review](review-and-debrief.md) for outcomes.

## Mandate and first action

Repair evidence admission across **raw report → assembler → gate → CLI**. Stop for independent review after delivery. Do not finish Q, select an engine, or start N1.

Read AGENTS.md, the full raster rework plan (especially the six Q experiments), the LiDAR guide, the review/debrief record and previous repair receipt. Inspect `git status --short --branch`, `bd show canopi-kqpp`, and current harness/tests before edits. Baseline reviewed: `47b9d508`, with `99832cc5` and `95310b85` atop `f637de31`. Preserve this stack and all prior accepted work, including approved UI `0e696722`. Continue the existing Q branch/scope under repository rules; do not reset it to main or discard fixes. Record this bounded scope in bd and claim before coding. Reconcile stale bead design text: preparation-gating and native GDAL slope are already allowed, not new user decisions; the route is not qualified.

Use **tdd** and **craft** explicitly, reading their full instructions and required references. Use **codebase-design** when changing the evidence interface/seam. Record what each constrained, not just its name. No subagents, new dependencies, or skill edits. If unavailable, report the limitation instead of claiming invocation.

Own only `scripts/raster-qualification/` admission/evaluation code, requirement mappings, small tests, minimal report-schema changes, and directly affected receipts/guidance. Reuse the existing modules and stable requirement IDs; do not build a generic validation framework or replace the harness wholesale. No production Rust/frontend, engine/build/transport/worker implementation, UI change, new benchmarks, or private fixture regeneration. Preserve the user's prototype approval gate and engine-decision gate.

## Required contract

The plan owns requirements; `requirements.json` encodes them and must not narrow them to current observations. The assembler extracts evidence; the gate decides eligibility. Successful expected rejection is not positive capability evidence. Neither strings naming a route nor prefilled `pass` assertions establish that the measured route matches it.

Keep `fail > inconclusive > pass` and exit zero only for eligible evidence. Measured violations, corrupt input and conflicting identities fail. Missing evidence or evidence from an explicitly insufficient route is inconclusive. Keep partial measured successes visible without promoting them to satisfied requirements. Existing honest gaps (Desktop hosting, lifecycle, overview precedence, candidate resources) must remain blocking.

Admission must retain source report identity and provenance: schema/experiment, source digest, run identity or recorded time, fixture name/hash where applicable, measured artifact/version/source correspondence, measured route, environment and command. Compare these with the declared selected route and fixture manifest; do not copy caller-supplied labels onto unlabelled reports. Artifact-only requirements may explicitly have no raster fixture; numeric/preparation/display evidence may not. Legacy reports missing fields remain readable as incomplete evidence, never silently upgraded. A newly assembled timestamp is not proof old source evidence is current. No need for cryptographic attestation: the purpose is consistent, traceable evidence, not proving measurements cannot be fabricated.

Known report failures cannot disappear when selecting assertion prefixes. Validate required preconditions and the complete report result/failure list before promoting its observations. Reject conflicting or duplicate identifiers rather than allowing last-write-wins. A failure in a separate, explicitly identified negative control is not a failure of the positive run; distinguish those scopes structurally, not by ignoring failures. Missing sidecar evidence is inconclusive; an explicit fixture policy may establish no sidecar applies, but absence alone cannot. Preserve unrelated passing requirements when one source fails.

Synthetic controls must be clearly labelled and usable for evaluator tests, but cannot yield a production qualification pass. Provide an explicit test-only evaluation boundary if needed; normal CLI publication must reject synthetic qualification. Do not claim synthetic input is physically measured evidence.

## Acceptance cases and implementation order

Implement one vertical RED → GREEN → refactor cycle at a time. Before each negative, prove the same coherent control passes the relevant requirement through raw-report assembly and gate evaluation. Other genuinely unmeasured requirements may remain inconclusive; do not fabricate them to obtain a green overall qualification. Gate-combination tests may use separately labelled synthetic complete bundles.

| Review ID | Starting control and single change | Required observable outcome |
| --- | --- | --- |
| R3-01 | Valid numeric report; change recorded fixture-hash check to failure and report result to fail | `Q-LOCAL-1` fails with the source report and failed precondition named, even if selected value/window assertions pass. Also test an inconclusive source and a report/result contradiction. |
| R3-02 | Matching evidence identities; remove required fixture hashes | Affected requirement is inconclusive, never pass. |
| R3-02 | Matching identities; change artifact version, fixture hash, route, or environment in one source | Each conflict is rejected with expected/observed identity. Empty labels are not the only negative cases. Reassembly cannot launder the mismatch or stale source into fresh evidence. |
| R3-03 | Bounded HTTP-window evidence but no intended scoped Desktop/native/worker bridge evidence | Preserve HTTP capability observations; `Q-LOCAL-1` remains inconclusive. Positive bridge control must describe actual required observations, not merely a renamed route string. No bridge implementation in this task. |
| R3-03 | Artifact inventory records a published artifact at a different source revision; no pinned-source build or approved alternative | `Q-ART-1` cannot pass. Recording the mismatch is not satisfying correspondence. Test matching-source and reproducible-build evidence controls; do not attempt that build or choose an alternate pin here. |
| R3-04 | Passing preparation report with sidecar observation; remove that observation | `Q-PREP-1` becomes inconclusive with the missing evidence named. A changed sidecar fails. An explicit no-sidecar fixture is distinct from an unobserved sidecar. |
| R3-05 | Coherent one-cold/three-warm trace with >=100 successful tiles and matching samples per run | Pass the display requirement; sample-derived statistics and successful request counts agree. |
| R3-05 | Change one run to one rendered/requested tile while retaining 128 samples | Reject inconsistent counts; attempts are not successes. Separately test missing counters, invalid/noninteger counts, one failed tile, invalid latency values and count/sample mismatch. |
| R3-05 | Change only reported p95 to an inconsistent value | Reject it or recompute and use the sample-derived statistic while explicitly reporting the inconsistency as failure. Never accept an unrelated finite number as proof of sample-derived p95. |

For display statistics, inspect the existing producer's percentile convention and freeze that convention independently in tests with hand-calculated small examples (including boundary rounding); do not invoke the implementation under test to generate expected values. Normal complete traces must have internally consistent median/p95/max and counters. Preserve the existing 50 ms bound, observation-support rule, cold/warm counts and plan-required per-fixture coverage. Unknown optional producer fields must not mask a known measured violation.

Audit neighbouring mappings for the same admission mistake, particularly unconditional CRS assertions and memory measurements accepted merely because their route does not start with `reference`. Correct this same-class evidence-admission defect within scope; do not implement the missing experiments. Audit the contract against all six original experiments, including required fixture coverage, metadata/sidecars and source correspondence. Unmeasured requirements stay explicit; do not infer them from adjacent passing assertions.

## Verification and review checkpoint

Exercise the real assembler and evaluator together using small raw-report fixtures, plus the normal CLI in a fresh temporary output root. No monkeypatching the verdict function or substituting a fake assembler in these integration regressions. Mocks may intercept external I/O; they must not replace the behavior being proved. Retain useful existing tests and runner exit tests.

For each R3 family, record the first RED's intended failure, GREEN, and a narrowly targeted sensitivity check in an isolated copy. A disabled guard must be detected by the corresponding test, without an unrelated gap explaining the failure. Capture compact command/output evidence now; do not reconstruct earlier RED history. Synthetic controls with physically inconsistent counts/statistics are invalid controls even if the old code accepts them.

Run:

```sh
python3 -m unittest discover -s scripts/raster-qualification/tests -v
bash scripts/raster-qualification/tests/test_runner_exit.sh
python3 scripts/check_docs.py
git diff --check
```

Run shell/JavaScript syntax checks for files changed, and all further repository gates triggered by changed surfaces. Do not run `run_all_experiments.sh` against the existing private evidence directory. Existing reports may be evaluated read-only into a fresh temporary root; record their original identities/digests and the exact evaluator commands. If inaccessible, report that rather than replacing them with synthetic evidence. No target count of passing requirements is prescribed: report the actual corrected verdict.

Stop and ask if satisfying an acceptance case requires changing the scientific contract, choosing an engine/pin, building a missing route, or obtaining new user approval. Missing qualification evidence is expected, not permission to expand scope. Finish the gate repair that remains possible without those decisions.

## Documentation, delivery and debrief evidence

Add `q-evidence-integrity-receipt.md` in this folder and link it from the index. Record baseline/delivered revisions, owned files, source evidence evaluated (or unavailable), requirement verdict changes with reasons, commands, RED/GREEN/sensitivity evidence, and remaining limits. Mark R3 findings **implemented, pending independent verification**, not resolved. Keep Q open and N1 unstarted. Reconcile the Q receipt, affected LiDAR guidance and bead design/notes so no stale four-pass table or claimed qualified bridge contradicts the result. Retire this prompt when superseded or delivered, retaining its historical revision for the user-requested debrief.

Update the review/debrief record with observed outcomes, not a fresh narrative transcript. Distinguish a flawed control, lost report failure, omitted identity comparison, contract narrowing, environment limitation and reviewer/handoff omission. Track actual extra cycles and logged time only when available; do not infer model settings, costs or skill adherence from test totals. Propose reusable tooling changes with a regression-based success criterion; implement skill/workflow changes only under separately authorized scope.

Follow repository commit/push and bead-export rules, preserving unrelated work. Final handoff names bead, commit, branch, delivery state, tests, unavailable evidence, doc updates and unmodified user files. **Stop for independent review; neither green tests nor a repaired gate authorizes N1.**
