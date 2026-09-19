# Raster qualification reviews and methodology debrief

Status: evidence — seven implementation handoffs reviewed, plus one migration slice delivered through two repair rounds; final methodology conclusions pending.
Tracking: `canopi-kqpp`, parent `canopi-j571`; bd remains the execution tracker.
Current guidance: [implementation plan](../raster-data-analysis-rework.md), [consolidated repair receipt](q-consolidated-repair-receipt.md), [stable acceptance contract](q-admission-acceptance.md), and [delivery workflow](../../workflow/delivery.md).

## Purpose and evidence discipline

Current disposition: existing TypeScript remains unaccepted after Round 2. Reassessment `55d6f485` exposed useful causes but retained five design gaps. The user delegated design ownership to the reviewer, who resolved the [current design](q-typescript-reassessment.md) and prepared one [implementation handoff](q-typescript-implementation-agent-prompt.md). The implementation agent executes and tests that fixed design; the user remains the courier for independent review.

Round 1 debrief evidence: 127 TypeScript tests, 261 Python regressions and 14 runner checks independently pass, yet additional family-level CLI mutations still produce false passes and lost failures. Permanent resource gaps can conceal incorrect individual assertions. Declaring one reducer does not prevent comparisons omitted upstream. Earlier reviews also missed existing paths; distinguish expanded review coverage from new requirements or regressions. Full reproductions, retained fixes, environment details and unmeasured evidence are recorded once in the standing review. No time/cost improvement or language-effect claim is established by this round.

## Consolidated independent review and migration baseline

### Round 2 reassessment evidence

At `6a98cd33`, the reviewer independently reran compilation, 177 TypeScript tests, 261 Python regressions, 14 runner checks and docs/diff checks successfully. CLI perturbations nevertheless exposed R2-A–R2-D: missing fields hid independently known display/artifact failures; consistent request/render counters did not establish the required number of tile samples; and rejected-input publication overwrote a disposable source report. Exact mutations and limits live in the standing review rather than being duplicated here.

The escaped invariant families recur across rounds: failure retention, semantic sufficiency and input preservation. The final output-safety example extends review into the rejection path; a successful-path collision test was insufficient. Earlier implementer sweeps and independent reviews both missed sibling paths. This is evidence of inadequate coverage, not evidence that TypeScript or a particular model caused the failure.

The approved process response is a design checkpoint. The reassessment must trace which independent checks execute before reduction, compare bounded alternatives and propose a test matrix derived from obligations and dependencies. The hypothesis is that making omitted comparisons harder and testing failure-plus-gap combinations systematically will reduce escaped families; it is not yet a measured improvement. Preserve positive controls and accepted fixes. Keep implementation approval separate from approving the reassessment assignment.

For the final debrief compare baseline, Round 1, Round 2 and any later explicitly authorized work by escaped invariant family, self-review discoveries, invalid controls, coverage omissions, user handoffs and review outcome. Record elapsed effort/cost only where measured (currently not established); do not use line counts, test counts or mutation totals as proxies for correctness or efficiency. Success means independently accepted behavior with fewer recurring escapes, not merely fewer messages. No additional implementation round is authorized by this measurement plan.

### User-mediated repair protocol

The user explicitly retained the courier role. The process change is fewer, fuller handoffs, not less oversight: one standing prompt, one review record, one updated implementation receipt, and fixed C1–C8 criteria. Baseline TypeScript review is round 0; count subsequent consolidated repair deliveries plus independent reviews as rounds 1 and 2. After two unsuccessful rounds, report the structural problem and options to the user instead of silently extending the loop. An accepted round stops the repair assignment, not the qualification gate.

At final debrief, compare escaped invariant families and user handoffs before/after this protocol. Record self-review discoveries, mutations attempted and omissions, invalid positive controls, reason-preservation failures, sandbox-only failures and optional findings kept out of acceptance. Independent review must cover the full agreed boundary before returning one consolidated result, distinguish accepted/blocked/unreviewed behavior, and cite C IDs for new blockers. The reviewer must not substitute incremental example reviews or cosmetic demands for the agreed contract. Preserve unknown time/cost as unknown; do not claim the new workflow reduced effort without evidence.


At `3a7ec9eb` the reviewer independently ran 261 Python tests, 13/13 stub-runner checks, documentation validation and diff checks successfully. Small in-memory controls through the real assembler/evaluator nevertheless reproduced:

| Contract | Starting control and perturbation | Observed defect |
| --- | --- | --- |
| C6 | `passing_evidence()` with admission labels but no supporting declarations/provenance | Overall pass through the public evaluator |
| C6/C8 | Set an entry's admission verdict to fail and `sourceAdmitted` to true | Requirement still passes |
| C2/C6 | NaN bundle generation time; separately, unadmitted entry with list-valued `observed` | NaN passes; list causes `AttributeError` |
| C5 | Passing candidate run split into two records, one lacking queue depth and the other active reads | Incomplete records combine into a passing resource requirement |
| C5 | Append a second otherwise complete candidate run with 900 ms sampling after a 100 ms control | Resource requirement passes using first-record sampling |

Reproduction entry points at that revision: `test_qualification_gate.passing_evidence`, `passing_reports`, `assembly`, `qualification_evidence.assemble`, and `qualification_gate.evaluate`. The reviewer intercepted fixture filesystem access in memory, not admission/verdict logic. No private evidence or engine experiments were rerun. The implementation's fourteen sensitivity probes and private one-fail/eleven-inconclusive reconciliation were not independently rerun. These findings do not invalidate every repaired case; they prevent acceptance of the complete boundary.

### Final debrief evidence to collect

The migration is a user-selected maintenance direction, not proof that Python caused the defects. Testable hypotheses: independently specified valid controls, one parsing/reduction path and per-run reductions will reduce escaped false passes; reuse of the existing TypeScript toolchain will reduce tooling fragmentation. A language port without those changes may preserve the defects.

For the TypeScript receipt, record baseline/final source and test size, direct dependencies, number of authoritative evaluator entry points, contract assertions with traceable positive evidence or explicit gaps, independent-review rounds and escaped invariant failures. Record elapsed effort/cost only if measured; do not infer it from test count or model names. Retain exact commands and sanitized RED/GREEN, mutation and CLI counterexamples. Track implementation work in bd, not this table.

At final debrief, distinguish requirement omissions, implementation violations, fixture/oracle defects and reviewer coverage gaps. The reviewer also contributed to earlier back-and-forth by reviewing narrow examples rather than the complete boundary. Compare whether the stable matrix reduced handoffs, not just whether the test count rose. The implementer's reported aspirational evidence map (32 of 42 prefixes absent before correction) is a provenance lesson: name coverage is not semantic adequacy. Audit mappings against actual producer observations.

Promote only demonstrated improvements into regression tests/tooling or existing operating guides. No skill changes are authorized by this handoff. Retire the replacement prompt after delivery; preserve one migration receipt with measured outcomes and independent disposition. Do not declare the approach successful until independent acceptance, and do not confuse harness acceptance with Q qualification.

Retain the user-requested basis for a final debrief without confusing agent claims with accepted results. References below identify the reviewed revisions; local file links identify the relevant code but may move as repairs land. Use `git show <revision>:<path>` to recover the exact reviewed source. The current Q receipt is a living report, not an immutable history of earlier claims.

The reviewer inspected source and ran targeted in-memory verdict reproductions. The second review additionally ran all 14 committed qualification regression tests successfully. Neither review reran the complete large-fixture/browser pipeline or independently verified the implementer's entire reported quality-gate run. Execution transcripts and proof of which skills the implementer loaded were not available to the reviewer. No claim about intent or general model capability follows from these observations.

## Review sequence

| Revision / artifact | Implementer claim | Independent finding / disposition |
| --- | --- | --- |
| `0e696722`, approval recorded in `ab2f7d25` | Seven HTML reference surfaces prepared | User explicitly approved the UI proposal. This does not qualify the engine. |
| `fd86de68`, first Q receipt | Several experiments passed; two engine decisions requested | Q not accepted. Decoder failure/no windows and inconclusive aggregation reproduced as pass. Numeric I/O preloaded files; cancellation, CRS and resource checks were proxies. Native GDAL slope and preparation were already allowed, so those questions were mis-framed. |
| [First correction prompt](q-correction-agent-prompt.md), saved in `8dcb1c70` | Broad request to repair and complete Q, including GeoLibre reuse investigation | Historical instructions. Asked for tests first but did not explicitly require skill invocation or valid positive controls for every negative test. |
| `cfbb0c35`, corrected Q receipt | Ten experiments and aggregate pass; 218 assertions; 14 regression tests pass | Regression suite independently passes. Q still not accepted: missing mandatory evidence remains outside verdicts, cancellation still tests a substitute, and new Q6 false passes reproduced. |
| [Gate-only repair prompt](q-gate-repair-agent-prompt.md), `f637de31` | Narrow evaluator repair, explicit TDD/craft and evidence mapping | Executed in `95310b85`, `99832cc5`, `47b9d508`; now retired. |
| [Gate repair receipt](q-gate-repair-receipt.md), reviewed at `47b9d508` | Requirement contract; overall fail, 1 fail / 7 inconclusive / 4 pass; 64 tests green | Reviewer independently reran all 64 tests, docs validation and diff checks successfully. Repair not accepted: R3 false passes remain, including unsupported individual passing requirements. No private experiments rerun. |
| [Evidence integrity prompt](q-evidence-integrity-agent-prompt.md), `0cc3b8fa` | Raw-report-to-gate regression controls, evidence admission and correspondence | Executed in `2c830b0d`, with bead records through `d963f755`; retired. |
| [Evidence integrity receipt](q-evidence-integrity-receipt.md), reviewed at `d963f755` | 115 passing tests, nine reported sensitivity checks; existing records yield 12 inconclusive | Reviewer independently reran all 115 tests, docs and diff checks successfully. Repair not accepted: R4 findings below. Private report reconciliation and sensitivity checks were not independently rerun. |
| [Admission completeness prompt](q-admission-completeness-agent-prompt.md), `c94b7c7f` | Explicit required-set coverage, run provenance and monotonic failure precedence | Executed in `50c1211e`, with delivery records through `578e3bdb`; retired. |
| [Admission completeness receipt](q-admission-completeness-receipt.md), reviewed through `578e3bdb` | 168 tests, ten reported sensitivity checks and captured cycle excerpts; existing evidence twelve-inconclusive | All 168 tests and docs/diff checks independently pass. Repair not accepted: R5 findings below. Private evidence reconciliation and sensitivity mutations not independently rerun. |
| [Declaration/precedence prompt](q-declaration-precedence-agent-prompt.md), `35c6166b` | Validate both declarations and observations; test independent failure/gap combinations | Executed in the declaration/precedence repair; prompt retired. |
| [Declaration/precedence receipt](q-declaration-precedence-receipt.md), reviewed at `5becb043` | One validated declaration path for CLI and assembly; gap-based early return removed; findings read independently of `result`; 209 tests, four reported sensitivity probes and captured cycle excerpts; existing evidence twelve-inconclusive | Exact R5 reproductions independently fixed; retain those repairs. Full admission remained blocked by consolidated C1–C8 findings. Private reconciliation and sensitivity mutations not independently rerun. |
| [Consolidated repair receipt](q-consolidated-repair-receipt.md), reviewed at `3a7ec9eb` | C1–C8 repaired; 261 tests, sensitivity probes and adversarial self-review; existing evidence one fail and eleven inconclusive | Tests and stub runner independently pass, but C5/C6/C8 counterexamples above remain. Complete gate not accepted. Superseded as the qualification authority by the TypeScript decision path. |
| [TypeScript migration receipt](q-typescript-receipt.md), delivered from `3a7ec9eb` | Decision path replaced in TypeScript: 2,632 source lines, 74 emitted tests, no dependencies, no Python in the decision path, 10 sensitivity probes, an adversarial pass and a read-only reconciliation matching the Python baseline on all twelve requirements | Implementer report. Not yet independently reviewed. |

## TypeScript decision-path migration

The user selected TypeScript for qualification orchestration and Rust for native raster operations. The
migration replaced raw-byte parsing, declaration validation, admission, requirement mapping, per-run
reduction, the requirement verdict and the CLI exit. The Python decision path is frozen for comparison
and is no longer the authority: the runner's final step invokes the emitted TypeScript CLI.

What is claimed, and what is not:

* the five review counterexamples all reproduced against the Python baseline and none against the
  TypeScript path ([receipt](q-typescript-receipt.md));
* this is consistent with the hypothesis that one parsing/reduction path and per-run reductions reduce
  escaped false passes, but the TypeScript path was written knowing those counterexamples and Python
  was not, so the comparison does not isolate language from architecture;
* the two paths agree on all twelve requirements for the existing records. That is evidence of a
  faithful port, not of correctness: Python is not an oracle, and no verdict distribution is
  prescribed;
* two sensitivity probes are reported as **zero results**, and one of them (S1d) exposed that the suite
  checked a verdict without checking that the discarded failure was explained. Reason-preservation
  tests were added and the re-probe bites.

Remaining Python experiment orchestration, fixture/bootstrap/server and reference helpers are staged
for separate replacement and were not touched. No Python was deleted.

### Round 2 debrief inputs

Round 1 was independently reviewed at `8ab1fff7` and retained its repairs while listing six remaining
families; round 2 addresses all six. For the final synthesis:

| Dimension | Observation |
| --- | --- |
| Reviewer-discovered versus self-review | All six round-2 families were found by the independent reviewer. The implementer's own sweep and adversarial passes in round 1 found none of them, including the two that were pre-existing contract paths — the wrong transport declaration and the envelope/identity disagreement. Round 2's own adversarial pass again found no production counterexample |
| Repeated defect family | The recurring pattern across T1–T4 and R1-A–R1-F is **evidence discarded before it reaches the reduction**: an early return at the first gap, a declaration passed but never read, a filtered list paired by stale index, or a required set inferred from what was supplied. Round 2 addressed the instances; the pattern itself is the main lesson |
| Input mutations attempted | 32 in the round-1 sweep plus 13 sibling cases in round 2, over declarations, source identity, per-run fields, artifact correspondence, sidecar policy, display runs, CLI arguments and the programmatic entry point |
| False individual passes hidden by overall gaps | Every round-2 family was one. Permanent gaps already prevented overall qualification, which is exactly why an "overall non-pass" check could not see them. The receipt's cases assert individual requirement and assertion verdicts for this reason |
| Controls that proved invalid | Two committed tests encoded `http-range` as the expected transport, i.e. the defect itself, and were rewritten against the plan. One round-1 sweep case asserted an interaction that cannot occur. Both are recorded rather than quietly corrected |
| Guard-removal probes | 11 in round 1 (one zero), 13 in round 2 (two zero). Both round-2 zeros are redundant defence, confirmed load-bearing only as pairs, and are reported as redundancy rather than coverage |
| Environment failures | The reviewer's `EPERM` on sandboxed subprocess capture did not recur in round 2. One probe reading was a measurement artifact (instrumenting captured stderr) and was re-measured before being believed |
| Review rounds | Round 0 baseline discovery, round 1 delivered and reviewed, round 2 delivered. The standing prompt allows no third round without the user's decision |
| Measured effort | Not measured; not inferred from test count |

Architecture, language, implementation and review-process effects remain separable. Round 2 changed no
architecture and no language, so its repairs are attributable to the findings and the tests rather
than to either.

### Reassessment debrief inputs

The bounded [design reassessment](q-typescript-reassessment.md) at `82184e6c` delivered evidence for the
final synthesis in addition to the Round 2 inputs above. No further repair round followed it; the
instrument for the next authorized implementation is the proposed seam, not a third sweep.

| Dimension | Observation |
| --- | --- |
| Escaped invariant families | Two crossed both repair rounds and the Round 2 review: **a check whose reachability is decided by imperative control flow** (mutually exclusive chains, early returns, conjunctions of independent preconditions), and **a claim inferred from supplied data instead of the declaration** (tile counts from a sample list, a reference label from a missing role). The reassessment reproduced four Round 2 instances and added two more, one of them a false *assertion* pass (`reference-measurements-labelled-separately`) that no whole-requirement check could see |
| Self-review findings | Dead code that reads like a discard (`decide.ts`'s `void gap` loop over merged shape gaps) and an unused `assertionVerdicts` local; two duplicated doc comments left by hand-applied repairs (`resources.ts`, `preparation.ts`); admission reasons published twice per requirement because `decideRequirement` concatenates the admission's reasons with a `Findings` list that already contains them. Each is small; together they show that per-site repairs were applied and reviewed where the last finding pointed rather than across the file |
| Invalid controls | The first directory-mode case was labelled a rejected-input case but validated successfully and became the negative control for the pair; a driver label printed an unchanged report as `writtenKind=decision`; an early `assertionsOf` helper iterated a captured array and silently wrote the unmutated reports, producing a first N-1 reading that was re-measured and corrected. Every reading quoted in the reassessment is from a re-run after those driver fixes |
| Hypothesis that did not survive measurement | `decide.ts` merging the shape's gaps and then discarding them in a no-op loop looked like the same family. Measurement refuted it: admission reports those gaps, and a deleted `identity.runId` does reach the decision. Recorded because a source reading that is not re-measured is not evidence |
| Reviewer coverage gaps | The Round 2 sweep and adversarial pass did not reach `evidence/resources.ts` route attribution or the directory-mode publication path, and their oracle assertions were requirement-level, so an individual assertion wrongly promoted to `pass` could not be seen. The reassessment also compared the TypeScript rules with the retained Python gate and found two TypeScript behaviours that are regressions against rules Python still enforces and tests — a comparison neither the implementer rounds nor the review performed |
| Guards that prevent recurrence | The proposed totality check (every contract assertion decided by at least one check, enforced by the driver) prevents silently undecided assertions; per-check negative fixtures prevent a check that stops running from passing unnoticed; the `reads`-based retention sweep makes "a finding survives an unrelated missing observation" mechanical instead of family-by-family; the migration oracle (per-requirement decision comparison) makes an unintended verdict change visible in the slice that causes it; the publication read-set makes input protection independent of validation success. None of these is claimed to be complete |
| Language, architecture, implementation, test oracle | The reassessment separates them: R2-C's sample/count reconciliation and N-1's undeclared-role rule are **implementation/migration** regressions with a retained oracle; R2-A's page-error check is a **new implementation** check that no retained path performs and that was gated behind a sibling; R2-B's conjunction and R2-D's derivation order are **architecture/design** defects present in the retained implementation too; the requirement-level oracle in the retained Python test is a **test-oracle** error, not a language effect. No language change is recommended, and no family was caused by TypeScript as a language |
| Measured effort | Not measured for this reassessment beyond the command list in the document; not inferred from test counts |

Success for the next authorized implementation is defined as **fewer escaped invariant families at
independent review**, not a higher test count. No reduction in handoffs is promised: two repair rounds
were followed by a design reassessment, and whether the seam shortens the next cycle is a prediction
this evidence does not support.

### Implementation debrief inputs

The settled design was implemented at `5878f80e` (S1 `2b0a02c7`, S2 `70e51534`, S3 `1fb1d064`, S4
`8a85fc3a`, S5 `567e6d29`, verification `5878f80e`). Independently reported inputs for the synthesis:

| Dimension | Observation |
| --- | --- |
| Escaped families addressed | All five demonstrated families (R2-A to R2-D, N-1) are reproduced as failing cases first and pass after the migration. The migration oracle shows all twelve requirements and all 68 assertions unchanged on the coherent corpus, with version 1 → 2 and check receipts added |
| Independence of the test oracle | The acceptance cases were derived from C1–C8, the plan and the findings, not from the check inventory: the inventory is compared with `requirements.json` by a separate guard, and the expected outcomes are literals in the tests |
| Fixture corrections | The positive display control was physically inconsistent — 128 requests and renders with 100 latency samples, while the producer records one latency per rendered tile. It is now 100/100/100 and the old shape is a failing case. The previous control was not blessed as an oracle |
| Guard-removal results | Eight guards removed one at a time in isolated copies; six were detected immediately. Two were zero results because each publication guard made the other unreachable; two deterministic cases (read-only parent, injected competing creator) were added and both probes are now detected. No zero-result probe remains |
| Self-review discoveries | Three implementation defects were found by the retained tests rather than by the new ones: dropped gaps beside failures, a non-object sidecar record gapping instead of failing, and a lost incompleteness summary. Each was fixed in scope rather than by relaxing the test |
| Behaviour changes | A missing output parent is refused rather than created; an unrecoverable read-set never writes to the requested destination; and the new per-run relationships will fail a real run whose producer records fewer latencies than rendered tiles. All three are recorded in the receipt, not discovered at review time |
| Unavailable observations | No producer, engine, browser or private experiment ran. `Q-HOST-1`'s accepted-host rule is implemented but unreachable through the CLI, and the resource disk-cache/staging bounds and the lifecycle/member/value/host obligations remain explicit gaps |
| Measured effort | Not measured; test count is not used as a proxy |

## C1–C8 repair report

Repair code: `qualification_evidence.py`, `qualification_gate.py`, `measure.py`, `qual_lib.py` and
`run_all_experiments.sh`; tests in `tests/test_acceptance_contract.py` plus the existing suites.
Captured cycles, sensitivity probes, self-review cases and the read-only reconciliation are in
[q-consolidated-repair-cycles.txt](evidence/q-consolidated-repair-cycles.txt); the row-by-row coverage
table and the minimum-decisive-case trace are in the [receipt](q-consolidated-repair-receipt.md).
The table below records implementer claims and test names, not whole-family acceptance. The independent review above supersedes blanket coverage claims.

| ID | Repair reported by the implementer | Check that now detects a regression |
| --- | --- | --- |
| C1 | Boolean-only leaves for assertion `ok` and precondition `met`; a present null is malformed while an absent key stays a gap; duplicate assertion and precondition names fail | `C1StrictLeaves` (9 wrong leaves x both leaf kinds), sensitivity probe S1 |
| C2 | Report field container shapes validated at the parse seam; `SourceDocument.present` separates absence from corruption and preserves the reason; the unbound `art_unpinned_names` and eight `AttributeError` paths are gone; one parse per source | `C2LoaderTotality` (9 roles missing, 48 shape combinations, truncated JSON), sensitivity probe S11 |
| C3 | Experiment and transport expectations derived from the source role, so omission blocks instead of withdrawing the comparison; the CLI declares the expected environment and transports | `C3RoleIdentity`, sensitivity probe S6 |
| C4 | The numeric window bound is decided from recorded window sizes rather than the absence of a failure string; artifact correspondence is decided from the inventory rather than a prose note; the mapping is written down and guarded against drift | `C4AssertionEvidence`, `C4MappingDrift`, sensitivity probes S7 and S14 |
| C5 | Plan budgets enforced per counter on sampled candidate records only; a measured budget violation outranks a missing counter; a 900 ms stall survives an unrecognised optional field | `C5QuantitativeBudgets`, `C5DisplayBudgets`, sensitivity probes S8–S10 |
| C6 | Admission block required and shape-checked; assertion verdict types validated before membership; entry-level gaps no longer return early; a missing route cannot hide a fail | `C6AssertionVerdictTypes`, `C6AdmissionRequired`, `C6FailureOutranksGap`, sensitivity probes S3–S5 |
| C7 | The runner assembles a bundle and exits with the requirement gate's status; the experiment summary is a labelled diagnostic; an unwritable destination exits non-zero with a clear error instead of a traceback | `test_runner_exit.sh` cases 1–7, `C7OutputFailure`, sensitivity probe S12 |
| C8 | Four fault kinds crossed with four independent gap kinds in both orders; a measured requirement violation raises the reduced admission severity; an observed failure keeps its severity in an unadmitted entry | `C8CrossLayerInvariants`, `C8ObservedFailureSeverity`, sensitivity probe S13 |

Two behaviours changed verdict deliberately and are documented rather than adjusted away: the
recorded trace's `one-cold-and-three-warm-runs` now fails because the trace holds one cold and one
warm run where the plan requires three warm, and an unusable record's already-recorded failure keeps
its failure severity instead of grading down to a gap.

One sensitivity probe is reported as a **zero result**: removing either of the two independent
duplicate-name checks alone leaves the suite green because the other still refuses the duplicate.
Removing both fails. That is recorded honestly rather than presented as coverage.
| [Consolidated review](q-consolidated-admission-review.md) and [prompt](q-consolidated-agent-prompt.md) | User-approved change from example-by-example handoffs to one stable acceptance matrix and adversarial self-review | Review completed without harness changes. Execution remains separate; Q and N1 gates unchanged. |

## R5 repair report

Repair code: `scripts/raster-qualification/qualification_evidence.py` and `measure.py`; tests in
`tests/test_qualification_gate.py` and `tests/test_cli_integration.py`. Captured cycles, sensitivity
probes and the read-only evidence reconciliation are in
[q-declaration-precedence-cycles.txt](evidence/q-declaration-precedence-cycles.txt); the acceptance
table is in the [receipt](q-declaration-precedence-receipt.md). Nothing below is independently
verified yet.

| ID | Repair reported by the implementer | Check that now detects a regression |
| --- | --- | --- |
| R5-01 | Declarations are validated before anything is indexed from them: missing hash or manifest is inconclusive; malformed type/value, duplicate identity (including identical), conflicting entries, undeclared required reference, repeated JSON object key and an explicit empty required list fail. Both entry points call the same validators, and a rejected declaration stops the CLI with a nonzero result and a diagnostic artifact. The same-class pin bypass was found and repaired | `DeclarationValidationTest`, `CliDeclarationValidation`, and a guard-removal probe that replaces both CLI loaders with `json.loads` |
| R5-02 | No section of `admit_report` sets a verdict; failures, gaps, conflicts and blocked comparisons are collected and reduced once at the end, so a wrong hash stays a failure alongside a missing `runId`/time/command and every contributing source's failure reaches a combined requirement | Table-driven conflict-kind × gap-kind cross products in both orders, a metamorphic invariant over every gap kind, and a combined-fault probe that fails under both an early return and a dropped conflict list |
| R5-03 | Recorded failures, failed assertions and failed preconditions are read independently of `result`; an absent key stays a gap while a present-but-unusable value (including explicit `null`) is invalid; every container is shape-checked, so a malformed one is an input failure rather than a silent empty list, and the `TypeError` that escaped `assemble` is gone | `ResultIndependentFailures`, the malformed-container tests, and a container-shape probe |

Two existing tests changed expectation rather than being weakened:
`FixtureCoverage.test_malformed_hash_is_not_a_valid_identity` now expects `fail` because R5-01
reclassifies a malformed declared digest from a gap to a malformed declaration, and the
declaration-level duplicate assertions were reworded to match the emitted messages. Both are recorded
in the receipt.

## R2 findings and reported repairs

These identifiers label review evidence, not a second task tracker. Implementation status belongs in bd. Append a revision/test/independent result when resolved; retain the original finding for comparison.

Each repair below is reported by the implementer and is **not** resolved until independently verified. The linked tests are the evidence that the repair exists; they are not proof that the original finding is closed.

| ID | Evidence at `cfbb0c35` | Impact / verification required | Implementer report at `47b9d508` |
| --- | --- | --- | --- |
| R2-01 | [Display producer](../../../scripts/raster-qualification/run_display_trace.mjs) emits `longTaskMaxMs`; [evaluator](../../../scripts/raster-qualification/measure.py) reads `maxLongTaskMs` and permits missing values | 900 ms UI work can pass a 50 ms gate. Verify shared schema/contract and a one-condition regression.  | **Repair implemented, pending verification**: producer/consumer field agreement asserted, unrecognised fields reported, 900 ms fails with values. |
| R2-02 | `cmd_q6_resources` does not require nonempty complete runs, successful rendering, or a true run `ok` | Empty trace passed; failed run with 127 failures out of 128 attempts passed. Require positive controls, run completeness and observation validity.  | **Repair implemented, pending verification**: run completeness, successful rendering and observation support required. |
| R2-03 | `cmd_q5_lifecycle` turns “not evaluated” cases into limitations; Q6 checks candidate request bytes but measures memory only for the reference reader | Missing mandatory evidence does not prevent a gate pass. Derive eligibility from original requirements, independently of probe result counts.  | **Repair implemented, pending verification**: eligibility derived from the contract; limitations cannot waive a requirement. |
| R2-04 | [Lifecycle probe](../../../scripts/raster-qualification/lifecycle_probe.mjs) preloads the file, slices a resident array, changes dispose flags, and terminates a separate Node loop | Does not prove candidate decoding cancellation or release. Its `operationsBeforeCancel` counts completed operations, not concurrent in-flight work. Verify the actual proposed route in a later authorized experiment.  | **Verdict repaired, experiment unresolved**: cancellation and teardown are inconclusive; a later authorized experiment must measure the proposed route. |
| R2-05 | [Aggregate runner](../../../scripts/raster-qualification/run_all_experiments.sh) records `FAILED` but finishes with summary printing without returning failure | CLI automation may report success despite failed steps. Exercise actual shell exit handling with controlled command outcomes.  | **Repair implemented, pending verification**: accumulated failures and a non-passing aggregate both exit non-zero. |
| R2-06 | Receipt defers candidate memory/cache/queue/temp-disk measurement, Desktop worker hosting and overview precedence; pinned-source build not attempted | Q requirements cannot be reassigned to successors without a decision. Requirement matrix must retain these evidence gaps.  | **Repair implemented, pending verification**: the gaps are contract requirements and remain blocking. |
| R2-07 | [Regression tests](../../../scripts/raster-qualification/tests/test_qualification_verdicts.py) construct several negative cases with additional missing fixture/hash/ledger preconditions and assert a generic failure | Tests can pass for an unrelated reason. Not proof all tests are ineffective: verify each from an otherwise passing control and perform a targeted sensitivity check.  | **Repair implemented, pending verification**: negative cases start from a passing control and name the failing requirement. |

### Third review findings

| ID | Evidence at `47b9d508` | Impact / verification required | Status |
| --- | --- | --- | --- |
| R3-01 | Assertions were selected by name prefix; a report's own `result`, failure list and failed preconditions were not consulted | A failing fixture-hash precondition could still supply passing observations | **Repair implemented, pending verification**: admission refuses the source and keeps its measurements visible but unpromoted. |
| R3-02 | Identity fields were caller-supplied labels; fixture hashes and conflicting versions/routes/environments were not compared | An unlabelled or mismatched report could be described as the declared route | **Repair implemented, pending verification**: identity is read from the report and compared; missing is a gap, conflicting is a failure with both values named. |
| R3-03 | Transport sufficiency and artifact/source correspondence were satisfied by strings | HTTP-only evidence could stand for the required local bridge; recording a revision mismatch was treated as correspondence | **Repair implemented, pending verification**: transport is declared and compared structurally; a different source revision fails without a reproducible build from the pin. |
| R3-04 | Sidecar absence was silent | An unobserved sidecar could be assumed absent | **Repair implemented, pending verification**: `measured` / `not_applicable` / `unmeasured` are distinguished and only an explicit policy settles the assertion. |
| R3-05 | Reported statistics were trusted; attempts could count as rendering | A physically inconsistent trace could pass | **Repair implemented, pending verification**: counters must be whole and consistent with the samples, and median/p95/max are recomputed from individual latencies under a frozen hand-verified convention. |
| R3-06 | The cleaned Q receipt still presented four requirements as passing and the contract was missing two plan obligations | A stale four-pass table contradicted the eligibility result | **Repair implemented, pending verification**: the receipt now reports the corrected verdict and the contract carries `apis-called-and-worker-target-recorded` and `required-fixture-classes-covered`. |

### Fourth review findings

| ID | Evidence at `d963f755` | Impact / verification required | Status |
| --- | --- | --- | --- |
| R4-01 | Fixture comparison was subset-only against a flat list; an unexpected fixture was ignored, a missing required fixture was not a gap, duplicates collapsed in a dict, and the CLI passed an empty fixture list | Coverage could not be established, yet nothing blocked | **Repair implemented, pending verification**: coverage is judged against a declared per-role manifest; undeclared fixtures conflict, missing required fixtures are gaps, duplicates fail, and the CLI loads the declaration. |
| R4-02 | Correspondence iterated the supplied records and took the expected pin from the record being checked | An unrelated record satisfied a required artifact, and a report could invent its own expectation | **Repair implemented, pending verification**: coverage iterates the required artifact/version pairs against the pin declared in the candidate manifest; a revision mismatch needs real build evidence tied to the measured artifact. |
| R4-03 | No run identity, timestamp, age or digest check existed; freshness applied only to the bundle stamp | Reassembly refreshed old evidence, and any digest string was accepted | **Repair implemented, pending verification**: `runId` and a finite non-boolean `recordedAt` are required, age uses the shared seven-day limit at one injected clock, and the digest is computed from the bytes read. |
| R4-04 | A missing identity block returned early, discarding recorded failures and failed preconditions | A known failure could be erased by a provenance gap | **Repair implemented, pending verification**: failures and gaps accumulate and `fail > inconclusive > pass` applies once; a requirement drawing on several sources inherits any contributing source's failure. |

### Reproduced Q6 failure cases

Reviewer invoked the real `cmd_q6_resources` with in-memory injected browser/report input and an intercepted report writer; no fixture or report files were changed. Browser input carried an available/ok Chromium result, a transport ledger, and candidate transport totals with a 64-byte largest request. No reference fixture was supplied. Two trace inputs independently produced exit `0` and verdict `pass`:

```json
{"runs": []}
```

```json
{"runs": [{"name": "cold", "ok": false, "tileRequests": 128, "tilesRendered": 1, "failedTiles": 127, "p95Ms": 1, "longTaskMaxMs": 900, "longTaskObserverSupported": true}]}
```

These reproduce false passes, not physical performance observations. The repair must turn each constituent fault into a separate regression with a valid positive control; the second input intentionally combines defects and is not itself a well-isolated TDD fixture.

## R3 independent findings at `47b9d508`

These findings supersede blanket claims that the R2 families are resolved. The new contract and honest non-passing overall result are useful retained work; their existence does not establish sound evidence admission. No implementation changes were made during this review.

| ID | Independently inspected or reproduced evidence | Required correction |
| --- | --- | --- |
| R3-01 | With the committed passing raw numeric control, adding a failed fixture-hash assertion, `result: fail`, and a hash failure still leaves every assembled `Q-LOCAL-1` assertion passing | Preserve source precondition failures through assembly and eligibility; selected assertion prefixes cannot erase them. |
| R3-02 | Starting from `passing_evidence()`, independently removing numeric fixture identities, changing its route to an unrelated whole-file reader, or replacing its artifact with an unrelated version each still yields overall pass | Validate correspondence, not just nonempty identity strings. The CLI currently supplies empty fixtures and stamps source reports with caller-declared identities. |
| R3-03 | Source inspection: `testedWindows > 0` proves the local-transport assertion; the CLI declares HTTP Range. Artifact assertions reward a note saying no published artifact matches, without requiring source correspondence or a reproducible build | Keep HTTP capability and inventory findings, but neither satisfies the corresponding original Q requirement. Do not silently select a new pin. |
| R3-04 | Remove `sidecar-unchanged` from the committed preparation control: assembled assertion remains pass through an explicit `else PASS` | Missing evidence must be inconclusive; no-sidecar applicability needs explicit fixture evidence. |
| R3-05 | `valid_trace()` passes. Changing its runs to one rendered/requested tile while retaining 128 samples and setting p95 to 9999 still leaves all seven display assertions passing | Reconcile samples with request/success counters and calculate/check statistics. The original control itself reports p95 16.7 despite all its individual values being at most 2.3 ms. |

Reproduction entry points: `qualification_evidence.assemble`, `display_trace_assertions`, `qualification_gate.evaluate`, and helpers `passing_reports`, `passing_evidence`, `valid_trace` in `tests/test_qualification_gate.py`. Reviewer intercepted `Path.write_text` to capture raw synthetic reports in memory and used an in-memory path for evaluation; private evidence and working files were untouched. Each identity change was tested separately; the combined display counter/statistic example must be split into separate regression cases in the repair. The first assembler reproduction attempt failed because the review interceptor retained JSON text instead of decoding it; after correcting that review setup, the reported false pass reproduced. That setup error is not a harness finding.

Additional inspected behavior: the synthetic marker is reported but does not prevent an overall production-style pass. This was reproduced from a passing bundle and is included in the next handoff's publication boundary. It does not allege that synthetic evidence was submitted as real evidence.

Skill usage remains implementer-reported. The repair receipt names TDD/craft/codebase-design and describes sensitivity checks, including an initially masked mutation; no captured RED/GREEN transcript was supplied. Green tests and reported skill loading cannot establish workflow adherence independently.

## R4 independent findings at `d963f755`

Code revision `2c830b0d`; subsequent `c2f5eb79` and `d963f755` are bead records. Reproductions used the committed `passing_reports()` controls, the real assembler and gate, intercepted file I/O and independent deep copies of each report. Controls passed the affected requirements. No source files or private evidence changed. The clean checkout was in sync with upstream.

| ID | Single-case evidence | Observed outcome / required correction |
| --- | --- | --- |
| R4-01 | Change the numeric fixture name to an unlisted name and hash to another hash | `Q-LOCAL-1` still passes. `_fixture_problems` compares hashes only for names already in the expected manifest; verify membership and required coverage, not intersection alone. |
| R4-02 | Replace source correspondence with one matching revision pair for an unrelated artifact | `Q-ART-1` still passes. `_source_correspondence` does not use its required `artifacts` argument to establish coverage. |
| R4-03 | Independently set numeric `recordedAt` to `1`, or remove both `recordedAt` and `runId` | `Q-LOCAL-1` still passes in both cases. Fields are carried into provenance but not checked; fresh assembly time must not renew source evidence. |
| R4-04 | Remove identity from a numeric report explicitly marked fail with a failed fixture-hash assertion | Requirement becomes inconclusive and only the identity gap is explained. Early return bypasses failure evaluation; preserve known failure precedence. |

These findings do not establish that real fixture measurements were fabricated or that every prior repair failed. They establish remaining false admission and failure-classification paths. The implementer reported improved display/sidecar checks and nine sensitivity checks, but independent acceptance of the complete boundary remains outstanding.

The latest receipt again reports no captured RED/GREEN transcript despite the previous prompt requesting one. It also reports fixture defects discovered during implementation: shared mutable assembly configuration, a `TestCase.run` override, an `evaluate()` shadow and physically inconsistent fixtures. These are implementer-reported process observations, not independently reconstructed execution history. Preserve them for the final debrief without inferring skill adherence, intent or model capability.

## R5 independent findings through `578e3bdb`

Repair code: `50c1211e`; subsequent delivery records: `b7112847`, `578e3bdb`. Reproductions used `passing_reports()` and fresh `assembly()` controls with the real assembler/gate. File I/O was intercepted in memory; no private experiments or working files changed. The affected requirement control passed before mutations. The wrong observed fixture hash alone now correctly fails, demonstrating a retained improvement.

| ID | Independent reproduction | Observed result / remaining defect |
| --- | --- | --- |
| R5-01 | Remove `sha256` from `fixture_manifest.declared[0]`; separately insert a conflicting duplicate declaration before the original | `Q-LOCAL-1` passes both. Declaration dict conversion silently accepts missing expected hashes and overwrites duplicate names. Validate declarations before lookup construction. |
| R5-02 | Wrong observed numeric hash fails; retain it and remove `identity.runId` | Verdict becomes inconclusive with only the runId gap. An early return still skips the available hash comparison, contradicting the claimed single final reduction. |
| R5-03 | Remove numeric `result` and supply a positive `failures` entry | Verdict is inconclusive; failure list evaluation is nested under the recognized-result branch. Missing summary does not erase independently recorded failure. |

The next handoff separates declaration-input validity from physical engine behavior and adds combined-fault controls. None of these reproductions establishes a real engine failure, fabricated measurement or general model limitation. Current Q remains unqualified for independent reasons.

The latest receipt includes a linked trimmed cycle log, an improvement over earlier uncaptured reports. Its ten sensitivity results and reported implementation/fixture mistakes remain implementer evidence until independently checked; merely having the log is not proof the tests cover every branch. Keep the log for comparison with the R5 combined-fault regressions.

## Process hypotheses, not settled conclusions

| Hypothesis | Supporting observation | Evidence still needed / proposed intervention |
| --- | --- | --- |
| Scope was too broad for a reliable correction cycle | First correction added substantial harness work while leaving eligibility gaps | Try gate-only repair and compare review/rework outcomes. Do not equate changed line count with wasted effort. |
| Test-first sequencing was treated as sufficient proof | Green regression suite coexists with false qualification passes | Explicit vertical TDD, passing controls, named failure reasons and guard-sensitivity evidence. Transcript needed to assess actual workflow. |
| Implementer-controlled requirements drifted toward measured subsets | Required omissions appear as limitations while overall results remain pass | Requirements-to-evidence contract derived from the accepted plan and independently reviewed before more experiments. |
| Handoff instructions could have been more operational | Earlier prompt said tests first but omitted explicit skill use and positive-control discipline | New prompt names skills and demands observable cycles. Skill invocation alone is not evidence of compliance. |
| Independent review caught issues cheap validation did not | Tiny injected reports reproduced false passes despite unit suite success | Add adversarial report/runner tests and preserve independent review. Measure whether those tests catch future regressions. |
| Test controls were accepted by code but not coherent with the scientific contract | R3 display control has statistics inconsistent with samples; gate controls prefill every required assertion as pass | Test raw-report admission end to end and use independently calculated control values. Success criterion: isolated identity, precondition and statistical mutations are rejected for the intended reason. |
| A narrower prompt and named skills were insufficient on their own | Gate-only repair still lost report failures and omitted identity comparisons explicitly requested in the earlier prompt | Distinguish instruction-following failure from handoff design: the prior handoff did not make cross-layer coherent controls sufficiently concrete. Next receipt must capture actual cycles; do not infer a general model limitation. |
| Checks cover supplied fields but not the required set | R4 unknown fixture and unrelated artifact records pass | Required-set controls with two members, missing/extra/duplicate cases, and a regression proving unrelated additions cannot satisfy obligations. |
| Early returns accidentally change verdict precedence | Removing identity downgrades explicit failure to inconclusive | Table-driven mixed failure/gap cases; deleting evidence must not improve eligibility or erase failure reasons. |
| Handoff evidence requirements are not being enforced at delivery | Two receipts describe RED/GREEN work without the requested captured transcript | Require a small sanitized command/output artifact in the next receipt. Separate independently rerun GREEN from reported RED and sensitivity history. |
| Validating observations left their expected declarations implicitly trusted | R5-01 missing/duplicate expected hashes pass despite observed-fixture coverage checks | One declaration validation path shared by CLI and assembly; independently demonstrate missing, malformed, duplicate and conflicting declaration rejection. |
| Isolated negative tests missed interactions already prohibited by the contract | R5-02 wrong hash fails alone but loses failure when runId is removed; previous prompt explicitly required failure monotonicity | Bounded failure-kind × independent-gap-kind tests and an early-return mutation. Credit only detection, not additional test count. |
| A compatibility exception was broader than its intended purpose | R5-03 treating absent result as a gap also suppresses a present positive failure | Check gap-only and gap-plus-failure cases separately. Debrief should distinguish the reasonable compatibility decision from its incorrect control flow. |

## Consolidated-cycle methodology decision

The preceding workflow generated repeated small repair/review round trips. Reviewer contribution: stopping after a few counterexamples and writing a narrow next prompt left adjacent boundaries unaudited, including direct gate ingestion and final runner routing. Implementer contribution: isolated green examples and local sensitivity checks did not establish a complete input contract or cross-layer invariants. These observations concern this workflow; model capability, cost and settings remain unmeasured.

The new cycle has one [input/acceptance matrix](q-admission-acceptance.md), one [execution prompt](q-consolidated-agent-prompt.md) and one future implementation receipt. The consolidated review identifies confirmed counterexamples separately from source-traced paths and unmeasured engine capabilities. Preserve verified R5 repairs; require a full adversarial self-review through the CLI before delivery. Block only false eligibility, lost known failures, invalid rejection of a valid control, broken diagnostics and qualification bypass. File warning cleanup and optional restructuring separately.

Debrief this intervention using evidence: matrix rows actually exercised, counterexamples found by self-review versus independent review, materially new blockers after delivery, repeated findings tied to previously explicit instructions, and actual logged time/rework when available. Increased test count, longer prompts and skill-name lists are not success metrics. A later review may still find a defect; require it to identify the violated matrix invariant or justify a scope change rather than silently extending the assignment.

Latest independent checks at `5becb043`: 209 tests pass with TemporaryDirectory warnings; docs validation passes. R5 controls preserve expected outcomes. New reproduction families and their code entry points are recorded once in the consolidated review, not duplicated in a new chronological task list here. No private qualification experiments or production changes occurred during this review.

## Final debrief procedure

### Reviewer-owned design intervention

After `55d6f485`, the user separated responsibilities: the reviewer resolves engineering design; the implementation agent executes it, tests it and supplies evidence; the user remains the courier and scope authority. The five design-review gaps and their closure are recorded in the [standing review](q-typescript-review.md#reassessment-design-review-and-closure). The previous proposal is recoverable in Git; its D-A–D-F questions are not outstanding decisions.

The [current design](q-typescript-reassessment.md) is the intervention to evaluate, not a proven improvement. Record one consolidated delivery/review per implementation assignment, not per internal phase. In the existing receipt, record revision, fixed acceptance family, intended behavior change, independently derived test/control, self-review discovery, reviewer-discovered escape, actual command evidence and unavailable observations. In the final synthesis compare recurrence of failure loss, false positive evidence and unsafe publication before/after this intervention. Separate true code regressions from invalid fixtures and test-oracle defects.

Acceptance requires zero known blockers under C1–C8; “fewer defects” alone does not pass the gate. Test counts, check registrations, longer plans, skill names and green aggregate verdicts are not efficacy evidence. Record effort/cost only where measured, otherwise unknown. Preserve the possibility that the new seam adds complexity without reducing escaped defects. Changes to skills or general tooling require a separately authorized follow-up supported by observed results, not a causal claim about model capability or language.

At completion or a deliberate stop, compare the reviewed revisions with repair receipts and independently verified outcomes. For each recurring issue, distinguish missing/ambiguous instruction, failure to follow explicit instruction, environment limitation, implementation defect, measurement defect and reviewer/handoff defect. Record a contributing cause only when evidence supports it; otherwise retain it as a hypothesis.

Summarize which work was reusable, which needed rework, and what the review caught. Use observed command/run/review counts and durations only where logs exist; leave unavailable cost/time/model-setting data unknown. Do not reconstruct token usage, skill invocation or RED/GREEN history from a final commit.

Evaluate candidate improvements by falsifiable outcomes: wrong evidence rejected, regression detects guard removal, failed shell step cannot exit zero, actual route demonstrably exercised, fewer recurring review findings. Separate experiment/test success from capability qualification and integration/release throughout.

For each proposed tooling/method change, retain a compact evaluation record: triggering review IDs; whether the preceding prompt already required the behavior; delivered regression or tooling revision; independently observed detection; subsequent recurrence or no evidence yet. Compare example-only tests with the new set-coverage and failure-precedence invariants. Do not call an intervention effective merely because the suite grew from 14 to 64 to 115 tests. Record reviewer omissions and overly broad handoffs alongside implementer defects; final conclusions should explain which boundary was missed and which check now catches it, not rank models from unavailable cost/settings data.

Promote confirmed lessons into the narrowest appropriate regression test, report schema, reusable checker, skill improvement or operating guide through a separately scoped bead. Link that delivered change and its verification here. Do not silently edit skills, relax Q, or convert this folder into an append-only conversation log. The final synthesis should retain decisive evidence and retire obsolete execution instructions while preserving their historical revision identity.
