# Q qualification gate repair — agent prompt

Status: retired — executed through `47b9d508`; independent review requires further repair. Q remains unqualified.
Tracking: `canopi-kqpp`, parent `canopi-j571`.
Current guidance: [implementation plan](../raster-data-analysis-rework.md), [review and debrief record](review-and-debrief.md), and [repository contract](../../../AGENTS.md).

Historical handoff retained for the user-requested debrief; do not execute it again. The [evidence integrity prompt](q-evidence-integrity-agent-prompt.md) supersedes it. The [repair receipt](q-gate-repair-receipt.md) records implementation claims; the [review record](review-and-debrief.md) records remaining false passes.

## Prompt to send

Repair the qualification gate, not the raster engine. Stop for independent review after this bounded task. Do not attempt to finish Q or start N1.

### Baseline and required skills

Read AGENTS.md, the full raster rework plan, the current Q receipt, and `docs/design/raster-rework/review-and-debrief.md`. Inspect current code and bd; preserve user changes and accepted commits, including `cfbb0c35`, `fd86de68`, `ab2f7d25` and approved UI revision `0e696722`.

Use the **tdd** and **craft** skills explicitly. Read each SKILL.md completely and its required routed references before coding. Announce how they constrain the work. Use **codebase-design** if changing the evaluator interface/seam, as those skills direct. If a skill is unavailable, report that and follow the corresponding behavior below; do not claim to have used it. Do not create or modify skills in this assignment. No subagents.

Follow bd and branch rules. Inspect `canopi-kqpp`, record this bounded scope before coding, and preserve the accepted branch stack. Do not close Q when this repair is delivered. Repository scope and authority rules remain controlling.

### Outcome and ownership

Produce a gate that distinguishes:

1. A test or negative control executed as expected.
2. A candidate capability was demonstrated for a specified route, fixture and environment.
3. Every mandatory Q requirement is supported by adequate evidence.

Those are different conclusions. Assertion counts and ten passing experiment names do not establish the third.

Own only the qualification report/evaluation helpers, minimal probe-to-report schema corrections, small tests, aggregate runner exit handling, and directly affected evidence/guidance. Existing probes may be relabeled truthfully; do not build new transport, worker, decoder, slope, preparation or publication implementations. Do not add dependencies or run large/private experiments. No production Rust/frontend changes, engine selection, UI changes or N1 work.

### 1. Define the gate from the accepted contract

Before implementation, derive a compact requirement-to-evidence matrix from the plan's six Q experiments and exit artifact. Assign stable requirement identifiers and map each to the required observable assertions, implementation role, fixture class, environment, units/budget, and evidence source. Commit a machine-readable requirement contract beside the harness; the receipt should refer to it rather than duplicate it.

Do not merely list the ten existing subcommand names or copy the current probes' limitations into exemptions. Explicitly cover candidate artifact correspondence, scoped local numeric transport, bounded preparation, resolved-member/overview precedence, scientific values and exact validity, CRS agreement, active-operation cancellation, owned-worker teardown, required failure injection, local Desktop worker/asset hosting, and route-level resource/display measurements. Preserve the plan's distinction between Q feasibility and later production integration/cross-platform release evidence. Do not require shipped production code to qualify a prototype route, but the measured implementation must be the proposed route, not a substitute loop or reference reader.

Use this verdict contract:

- `pass`: every required assertion has valid, matching evidence and meets its threshold.
- `fail`: measured evidence violates a requirement, or supplied evidence is malformed, inconsistent or corrupt.
- `inconclusive`: required evidence is missing, not run, unsupported by the observation mechanism, or from an insufficient/wrong route or environment.
- Overall precedence: fail, then inconclusive, then pass. Only overall pass exits zero.
- A passing negative control establishes expected rejection only; it cannot satisfy a positive capability requirement.
- A limitations string cannot waive a requirement. Legitimate exceptions require an explicit plan/user decision, not a runtime flag or inferred permission.

Do not invent unavailable measurements. Evidence must identify its artifact/route, fixture identity, environment, command and observation source. Validate mismatches and missing identity fields. Synthetic evaluator fixtures prove gate behavior only; they must never be published as actual qualification evidence.

### 2. Repair one behavior at a time using TDD

Begin with the reproduced Q6 false pass: a trace with a 900 ms `longTaskMaxMs` currently passes because the evaluator reads `maxLongTaskMs`.

For each behavior:

1. Establish an otherwise valid passing control for the interface under test.
2. Change exactly one condition; assert the specific reason/requirement identifier and nonzero verdict. Unrelated missing fixtures, ledgers, hashes or imports must not explain the failure.
3. Observe RED for the intended missing behavior, not a setup or syntax failure.
4. Make the smallest correction, observe GREEN, and rerun the passing control.
5. Check test sensitivity by temporarily removing/bypassing the corresponding guard in an isolated copy or reversible local mutation. Confirm the regression test detects it, restore it, and rerun. Do not leave mutations or touch unrelated user work.
6. Refactor only while green, then proceed to the next behavior.

Do not batch all new tests before all implementation. Existing regression tests remain useful, but strengthen tests whose negative fixture already fails unrelated preconditions. Use real CLI/report boundaries where practical. Expected outcomes come from the plan and independent worked examples, not from reimplementing the evaluator inside assertions.

### 3. Required acceptance examples

| Valid starting control; single change | Required outcome |
| --- | --- |
| Complete synthetic passing gate input; omit candidate RSS | Inconclusive, specifically missing candidate memory; reference RSS cannot substitute |
| Complete input; remove Desktop worker-host evidence | Inconclusive; Chromium or Node worker evidence cannot satisfy it |
| Valid candidate memory; exceed the plan budget | Fail with observed value, units and budget |
| Valid display trace; record `longTaskMaxMs: 900` | Fail the 50 ms requirement; producer and consumer agree on the field |
| Valid display trace; observation unsupported/missing | Inconclusive, not a zero-duration observation |
| Valid trace; one tile fails or run `ok` is false | Fail; attempts do not count as successful rendering |
| Valid trace; remove runs or supply an empty list | Inconclusive; require the plan's one cold and three warm runs and at least 100 valid individual latencies per run |
| Valid measurements; mismatched route, artifact, fixture or environment | Non-pass with a named mismatch; do not combine unrelated runs into a qualified route |
| Mandatory lifecycle case marked not run | Inconclusive even if all other lifecycle assertions pass |
| Negative control correctly rejects stripped input | Negative test passes; route still needs positive bounded-access/preparation evidence |
| All runner steps succeed and aggregate qualifies | Runner exits zero |
| One runner command or aggregate fails | Runner exits nonzero while retaining the diagnostic summary |
| One required report is missing, stale, malformed or duplicated | Non-pass; old output cannot fill the missing run |

Test runner exit handling with small deterministic command fixtures/stubs, not actual browser launches or large files. Keep generated artifacts in a fresh temporary output directory. Never test failure handling by deleting or overwriting existing `.rq-scratch` evidence. Ensure the process exit status reflects accumulated failures even if the final pretty-print command succeeds.

Enforce meaningful observation, not presence of a number: finite/nonnegative durations and sizes, expected units, successful measured operations, matching scope, and valid observation support. A schema can establish consistency, not the truth of arbitrary claims; document which assertions must be derived from raw probe output and independently reviewed.

### 4. Reconcile the current evidence honestly

After the gate is repaired, evaluate existing reports read-only if available. Otherwise record their absence; do not regenerate missing evidence or silently synthesize replacements.

Expected result: the current Q evidence does not qualify. Candidate resource budgets, intended Desktop worker/transport hosting and other explicit gaps identified by the matrix remain unresolved. The in-memory slicing cancellation test cannot qualify the WASM adapter. “Operations completed when cancel fired” is not “operations in flight.” Its flag-only dispose test does not establish native/WASM resource release.

Update `docs/design/raster-qualification-q.md` and any affected LiDAR guidance to separate measured subtests from Q eligibility. Preserve prior claims as revision-linked evidence in the debrief record; do not leave them as current authority. Keep the engine/approval gates and user-approved UI unchanged. Do not promote the alternate Whitebox artifact silently or reopen already-settled native GDAL slope/preparation choices.

### 5. Verification and handoff

Run `python3 -m unittest discover -s scripts/raster-qualification/tests -v`, focused new tests, `python3 scripts/check_docs.py`, and `git diff --check`. Run applicable JavaScript/shell checks if those files change; record exact commands. Do not run `run_all_experiments.sh` against the existing private evidence directory as part of this gate-only assignment. No Rust or production frontend suite is needed unless scope changes, which requires stopping first.

Add a concise implementation receipt in this folder and link it from the index. Include baseline/final commit, bead/branch, owned files, requirement matrix, exact test commands, representative RED/GREEN/sensitivity outcomes, actual skills read/applied, current evidence verdict and unresolved gate IDs. Record missing logs as unavailable; do not retrospectively claim observed RED or skill use without evidence. Retain small sanitized summaries, not private payloads or huge transcripts.

Update the review/debrief record with outcomes linked to code/tests. Do not declare a review finding resolved solely because the implementer says so: mark the repair as implemented/pending independent verification until reviewed. Do not infer broad model capability conclusions or change repository-wide tooling/skills during this task.

Success means a tested gate that cannot award qualification for the identified incomplete/invalid inputs. It does not mean Q is green. Deliver the bounded repair using repository workflow, leave Q open, and stop for independent review before any new qualification experiments or N1 work.
