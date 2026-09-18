# Raster qualification reviews and methodology debrief

Status: evidence — two qualification handoffs reviewed; final methodology conclusions pending.
Tracking: `canopi-kqpp`, parent `canopi-j571`; bd remains the execution tracker.
Current guidance: [implementation plan](../raster-data-analysis-rework.md), [current handoff](q-gate-repair-agent-prompt.md), and [delivery workflow](../../workflow/delivery.md).

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
| [Gate-only repair prompt](q-gate-repair-agent-prompt.md) | Narrow evaluator repair, explicit TDD/craft and evidence mapping | Proposed next assignment. No implementation or independent acceptance recorded yet. |
| [Gate repair receipt](q-gate-repair-receipt.md) | Requirement contract, fail-closed evaluator, tests, honest evidence reconciliation | **Implemented, pending independent verification.** 63 gate tests pass. The gate now refuses qualification for the current evidence (overall `fail`: 1 fail, 7 inconclusive, 4 pass). No review acceptance claimed. |

## Findings to carry into independent verification

These identifiers label review evidence, not a second task tracker. Implementation status belongs in bd. Append a revision/test/independent result when resolved; retain the original finding for comparison.

Each repair below is reported by the implementer and is **not** resolved until independently verified. The linked tests are the evidence that the repair exists; they are not proof that the original finding is closed.

| ID | Evidence at `cfbb0c35` | Impact / verification required |
| --- | --- | --- |
| R2-01 | [Display producer](../../../scripts/raster-qualification/run_display_trace.mjs) emits `longTaskMaxMs`; [evaluator](../../../scripts/raster-qualification/measure.py) reads `maxLongTaskMs` and permits missing values | 900 ms UI work can pass a 50 ms gate. Verify shared schema/contract and a one-condition regression.  | **Repair implemented, pending verification**: producer/consumer field agreement asserted, unrecognised fields reported, 900 ms fails with values. |
| R2-02 | `cmd_q6_resources` does not require nonempty complete runs, successful rendering, or a true run `ok` | Empty trace passed; failed run with 127 failures out of 128 attempts passed. Require positive controls, run completeness and observation validity.  | **Repair implemented, pending verification**: run completeness, successful rendering and observation support required. |
| R2-03 | `cmd_q5_lifecycle` turns “not evaluated” cases into limitations; Q6 checks candidate request bytes but measures memory only for the reference reader | Missing mandatory evidence does not prevent a gate pass. Derive eligibility from original requirements, independently of probe result counts.  | **Repair implemented, pending verification**: eligibility derived from the contract; limitations cannot waive a requirement. |
| R2-04 | [Lifecycle probe](../../../scripts/raster-qualification/lifecycle_probe.mjs) preloads the file, slices a resident array, changes dispose flags, and terminates a separate Node loop | Does not prove candidate decoding cancellation or release. Its `operationsBeforeCancel` counts completed operations, not concurrent in-flight work. Verify the actual proposed route in a later authorized experiment.  | **Verdict repaired, experiment unresolved**: cancellation and teardown are inconclusive; a later authorized experiment must measure the proposed route. |
| R2-05 | [Aggregate runner](../../../scripts/raster-qualification/run_all_experiments.sh) records `FAILED` but finishes with summary printing without returning failure | CLI automation may report success despite failed steps. Exercise actual shell exit handling with controlled command outcomes.  | **Repair implemented, pending verification**: accumulated failures and a non-passing aggregate both exit non-zero. |
| R2-06 | Receipt defers candidate memory/cache/queue/temp-disk measurement, Desktop worker hosting and overview precedence; pinned-source build not attempted | Q requirements cannot be reassigned to successors without a decision. Requirement matrix must retain these evidence gaps.  | **Repair implemented, pending verification**: the gaps are contract requirements and remain blocking. |
| R2-07 | [Regression tests](../../../scripts/raster-qualification/tests/test_qualification_verdicts.py) construct several negative cases with additional missing fixture/hash/ledger preconditions and assert a generic failure | Tests can pass for an unrelated reason. Not proof all tests are ineffective: verify each from an otherwise passing control and perform a targeted sensitivity check.  | **Repair implemented, pending verification**: negative cases start from a passing control and name the failing requirement. |

### Reproduced Q6 failure cases

Reviewer invoked the real `cmd_q6_resources` with in-memory injected browser/report input and an intercepted report writer; no fixture or report files were changed. Browser input carried an available/ok Chromium result, a transport ledger, and candidate transport totals with a 64-byte largest request. No reference fixture was supplied. Two trace inputs independently produced exit `0` and verdict `pass`:

```json
{"runs": []}
```

```json
{"runs": [{"name": "cold", "ok": false, "tileRequests": 128, "tilesRendered": 1, "failedTiles": 127, "p95Ms": 1, "longTaskMaxMs": 900, "longTaskObserverSupported": true}]}
```

These reproduce false passes, not physical performance observations. The repair must turn each constituent fault into a separate regression with a valid positive control; the second input intentionally combines defects and is not itself a well-isolated TDD fixture.

## Process hypotheses, not settled conclusions

| Hypothesis | Supporting observation | Evidence still needed / proposed intervention |
| --- | --- | --- |
| Scope was too broad for a reliable correction cycle | First correction added substantial harness work while leaving eligibility gaps | Try gate-only repair and compare review/rework outcomes. Do not equate changed line count with wasted effort. |
| Test-first sequencing was treated as sufficient proof | Green regression suite coexists with false qualification passes | Explicit vertical TDD, passing controls, named failure reasons and guard-sensitivity evidence. Transcript needed to assess actual workflow. |
| Implementer-controlled requirements drifted toward measured subsets | Required omissions appear as limitations while overall results remain pass | Requirements-to-evidence contract derived from the accepted plan and independently reviewed before more experiments. |
| Handoff instructions could have been more operational | Earlier prompt said tests first but omitted explicit skill use and positive-control discipline | New prompt names skills and demands observable cycles. Skill invocation alone is not evidence of compliance. |
| Independent review caught issues cheap validation did not | Tiny injected reports reproduced false passes despite unit suite success | Add adversarial report/runner tests and preserve independent review. Measure whether those tests catch future regressions. |

## Final debrief procedure

At completion or a deliberate stop, compare the reviewed revisions with repair receipts and independently verified outcomes. For each recurring issue, distinguish missing/ambiguous instruction, failure to follow explicit instruction, environment limitation, implementation defect, measurement defect and reviewer/handoff defect. Record a contributing cause only when evidence supports it; otherwise retain it as a hypothesis.

Summarize which work was reusable, which needed rework, and what the review caught. Use observed command/run/review counts and durations only where logs exist; leave unavailable cost/time/model-setting data unknown. Do not reconstruct token usage, skill invocation or RED/GREEN history from a final commit.

Evaluate candidate improvements by falsifiable outcomes: wrong evidence rejected, regression detects guard removal, failed shell step cannot exit zero, actual route demonstrably exercised, fewer recurring review findings. Separate experiment/test success from capability qualification and integration/release throughout.

Promote confirmed lessons into the narrowest appropriate regression test, report schema, reusable checker, skill improvement or operating guide through a separately scoped bead. Link that delivered change and its verification here. Do not silently edit skills, relax Q, or convert this folder into an append-only conversation log. The final synthesis should retain decisive evidence and retire obsolete execution instructions while preserving their historical revision identity.
