# Raster qualification reviews and methodology debrief

Status: evidence — three implementation handoffs reviewed; final methodology conclusions pending.
Tracking: `canopi-kqpp`, parent `canopi-j571`; bd remains the execution tracker.
Current guidance: [implementation plan](../raster-data-analysis-rework.md), [current handoff](q-evidence-integrity-agent-prompt.md), and [delivery workflow](../../workflow/delivery.md).

## Purpose and evidence discipline

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
| [Evidence integrity prompt](q-evidence-integrity-agent-prompt.md) | Raw-report-to-gate regression controls, evidence admission and correspondence | Next bounded assignment; no implementation or acceptance claimed. |

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

## Final debrief procedure

At completion or a deliberate stop, compare the reviewed revisions with repair receipts and independently verified outcomes. For each recurring issue, distinguish missing/ambiguous instruction, failure to follow explicit instruction, environment limitation, implementation defect, measurement defect and reviewer/handoff defect. Record a contributing cause only when evidence supports it; otherwise retain it as a hypothesis.

Summarize which work was reusable, which needed rework, and what the review caught. Use observed command/run/review counts and durations only where logs exist; leave unavailable cost/time/model-setting data unknown. Do not reconstruct token usage, skill invocation or RED/GREEN history from a final commit.

Evaluate candidate improvements by falsifiable outcomes: wrong evidence rejected, regression detects guard removal, failed shell step cannot exit zero, actual route demonstrably exercised, fewer recurring review findings. Separate experiment/test success from capability qualification and integration/release throughout.

Promote confirmed lessons into the narrowest appropriate regression test, report schema, reusable checker, skill improvement or operating guide through a separately scoped bead. Link that delivered change and its verification here. Do not silently edit skills, relax Q, or convert this folder into an append-only conversation log. The final synthesis should retain decisive evidence and retire obsolete execution instructions while preserving their historical revision identity.
