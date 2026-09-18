# Consolidated qualification admission review

Status: evidence — review of `9fea1931` through `5becb043`; admission not accepted, Q unqualified.
Tracking: `canopi-kqpp`, parent `canopi-j571`.
Current guidance: [stable acceptance contract](q-admission-acceptance.md), [next prompt](q-consolidated-agent-prompt.md), [debrief](review-and-debrief.md).

## Scope and method

User authorized a consolidated review to end the one-counterexample/one-handoff cycle. Inspected declaration parsing, raw report loading, admission, all requirement mappings, display/resource reductions, bundle evaluation, CLI wiring and runner termination. This is an admission-boundary review, not a requalification of engines or a proof no defects remain.

Reproductions start from committed `passing_reports()`/`assembly()` or the gate's `passing_evidence()` helper. Reviewer intercepted only file I/O, used independent report copies, and ran the real assembler/gate. Synthetic inputs were not published as qualification evidence. Source-path exceptions are reproduced in process; runner routing is source-traced, not a private benchmark run. Review did not change harness code or private reports.

## Retained and independently checked repairs

The R5 controls now work: missing declared hash is inconclusive, a conflicting duplicate declaration fails, a hash conflict survives missing runId with both reasons, and a positive failure survives absent result. These specific repairs are accepted and must be preserved. This does not imply every earlier test or requirement is independently accepted.

The 209-test suite and documentation validator were independently rerun successfully in both the preceding focused review and this consolidated review. TemporaryDirectory cleanup warnings do not invalidate passing assertions but should be reported. No browser, Desktop host, private evidence reconciliation or sensitivity mutation was rerun here.

## Consolidated blockers

IDs map directly to the stable acceptance matrix, not a second task tracker. bd owns execution status.

| ID | Evidence at reviewed revision | Impact |
| --- | --- | --- |
| C1 | `ok: "false"` and `ok: 1` on numeric assertions still pass; precondition `met: "false"` also passes. Duplicate assertion names are accepted. | Schema confusion can create false positive capabilities. Strict booleans and unique keyed evidence are required. |
| C2 | Nonempty list-valued identity/serverLedger/artifact metadata raises AttributeError; null measurements raises TypeError. Missing q1 data reaches uninitialized `art_unpinned_names`. Invalid JSON becomes “missing”/inconclusive. | Missing/malformed inputs can crash or lose their classification instead of producing diagnostics. Loader must preserve absence versus corruption. |
| C3 | Changing both numeric experiment identifiers to `q1-artifacts` still passes. Removing expected numeric transport and observing `http-range` still passes. CLI supplies no routeId, expected environment identity or expected transport. | Admission's optional comparisons are not sufficient when normal callers omit the expectations. Source identity must be tied to the declared role. |
| C4 | Numeric window bound passes by absence of an “exceeds the” failure; no positive size observation is required. Artifact control with matching declared pins fails if the prose note “no published artifact matches” is removed. | Requirement mapping is partly based on missing failures/prose rather than positive, applicable evidence. Other mappings need the same obligation audit. |
| C5 | Setting candidate decoded cache to 1 GiB still passes Q-RES-1 despite the plan's 128 MiB cache bound. Appending an unsampled candidate memory record also passes. A known 900 ms display stall fails alone but becomes inconclusive after adding an optional producer field. | Limits and failure precedence are not preserved across all runs/measurements; unrelated metadata can hide a measured violation. |
| C6 | `evaluate(passing_evidence())` returns overall pass without any admission/declaration/provenance block. A failing assertion plus missing route becomes inconclusive. List-valued assertion verdict raises TypeError. | The public gate path can bypass the admission repair, erase failure or crash. Strong assembler checks do not protect direct bundle ingestion. |
| C7 | Source inspection: `run_all_experiments.sh` ends with `measure.py compare` and checks `q-summary.json`; it never invokes gate-assemble/gate. The comparison summarizes experiment reports, not the requirement contract. | The documented qualification runner can finish without the authoritative eligibility decision. Repair the final routing, not benchmark behavior. |
| C8 | The prior controls cover many isolated defects but not the cross-boundary cases above. Existing combined-fault tests did fix the specific R5 early return. | Preserve those fixes and test the same invariants across loaders, mapping, aggregation and CLI before another handoff. |

### Reproduction anchors

All paths below are relative to `scripts/raster-qualification/`; recover source with `git show 9fea1931:<path>` if later edits move symbols.

| Boundary | Entry points / mutation |
| --- | --- |
| C1–C3 | `qualification_evidence.assemble` with `tests/test_qualification_gate.py` controls: mutate q2 assertions/preconditions, identity, serverLedger, experiment; remove `numericExpectedTransport` from the declaration. |
| C4 | Inspect numeric `window-size-within-contract-limit` mapping; remove q1 notes from the matching-source control. |
| C5 | Mutate q6 first candidate `decodedCacheBytes` to `2**30`; append `{routeRole: candidate, route: candidate, incrementalPeakRssMiB: 1}`. Invoke `display_trace_assertions(valid_trace(long_task_ms=900))`, then add an optional run field. |
| C6 | Invoke `qualification_gate.evaluate` with helper `passing_evidence()`: it has no admission blocks. Separately set a Q-LOCAL assertion to fail and delete route; separately set that verdict to a list. |
| C7 | Trace runner `step19` and final aggregate check against `measure.py` `cmd_compare`, `cmd_gate_assemble`, `cmd_gate`. |

Do not copy the bare passing-bundle helper into new production-style controls. It demonstrates the missing boundary, not adequate evidence. Integration controls must cover the actual path and test-only synthetic mode must remain separate from qualification.

## Follow-ups, not repair blockers

Temporary-directory warning cleanup, unused variables, comment/naming polish and optional module splitting are non-blocking unless needed for a matrix behavior. No generic schema framework, new fuzzing dependency or cryptographic attestation is required. Malicious filesystem races, hostile resource-exhaustion inputs and benchmark performance of the validator are outside this bounded review.

Missing real worker/host/lifecycle/resource observations, unresolved source correspondence and broader platform qualification remain Q gaps; they are not reasons to fabricate reports or build engines during the repair. A sound gate may continue to report all requirements non-passing. Fixing the gate is not qualifying Q.

## Review exit policy

The next implementation is reviewed against the single acceptance matrix, not a succession of new prompt-local rules. False eligibility, lost known failures, invalid valid-control rejection and missing diagnostic output are blockers. Cosmetic/optional hardening items are filed separately. New material findings must identify a violated matrix invariant or explicitly justify a scope change. This is not a promise of zero further defects; it is a bounded acceptance process.
