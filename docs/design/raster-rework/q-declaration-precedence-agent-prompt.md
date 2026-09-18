# Q declaration validation and verdict precedence — agent prompt

Status: retired — R5 reproductions independently fixed; complete admission remains blocked. Retained as debrief evidence, not execution authority. See the [repair receipt](q-declaration-precedence-receipt.md); do not re-execute this prompt.
Tracking: `canopi-kqpp`, parent `canopi-j571`; bd owns execution status.
Current guidance: [implementation plan](../raster-data-analysis-rework.md), [review/debrief](review-and-debrief.md), [repository contract](../../../AGENTS.md).

This prompt authorized only the historical repair below. The [consolidated prompt](q-consolidated-agent-prompt.md) now owns the next assignment; do not accumulate this prompt's instructions as a parallel checklist. Q remains unqualified; N1 must not start. See the [receipt](q-declaration-precedence-receipt.md) for verified R5 fixes and remaining gate limitations.

## Start, ownership and retained work

Read AGENTS.md, the plan's Q requirements, the LiDAR guide, this folder's review/debrief and latest receipt. Inspect `git status --short --branch` and `bd show canopi-kqpp`; record this bounded scope and claim before coding. Preserve the existing `feature/raster-html-references` stack through `578e3bdb`, including `50c1211e`, earlier repairs and approved UI `0e696722`. Do not reset to main or discard accepted work.

Read and apply **tdd** and **craft** with their required references; use **codebase-design** when changing the admission seam. Announce the concrete constraints and report unavailable skills honestly. No subagents or skill edits.

Own only qualification declaration loading/validation, evidence admission/aggregation, focused tests and directly affected documentation. Reuse `SourceDocument`, `Admission`, the existing assembler and gate. Preserve working fixture coverage, source correspondence, timestamp, display, sidecar, multi-source and synthetic-publication checks. No generic validation framework, dependencies, production Rust/frontend, scientific-contract changes, pin/engine selection, builds, new qualification experiments or private evidence regeneration. Native GDAL preparation/slope remain allowed; the user's engine-decision and prototype-approval gates remain intact.

## Outcome: validate both sides, then combine findings

The R5 review reproduced three defects, not new Q requirements. Repair the common control flow rather than adding exceptions for these exact inputs. Declarations are inputs too: do not assume they are valid because the evaluator owns the caller. A known conflict must remain a failure when an unrelated field is missing. Decide each requirement only after collecting all independently evaluable findings.

Use `fail > inconclusive > pass`. Missing information prevents the specific comparison that needs it; it must not prevent unrelated checks. Invalid declarations are evaluator-input failures, not measured engine failures: label them accordingly. Keep unaffected requirement verdicts unchanged unless they share the invalid declaration/source. Never invent facts or missing hashes to complete a comparison.

### R5-01 — validate declarations before lookup construction

Validate fixture-manifest structure and members before converting them to a dict or set. Require nonempty string names, valid SHA-256 hashes, unique identities and valid per-role required lists referencing declared fixtures. Missing manifest or missing required hash is inconclusive; malformed types/values, duplicate declaration identities (including identical duplicates), conflicting entries and undeclared required references fail. Check duplicate JSON object keys while reading, before normal JSON decoding can hide them. An explicit empty raster requirement set must not waive required raster evidence. Artifact-only roles retain their explicit no-raster policy.

Use one validated declaration path for the real CLI and programmatic assembly. Tests must not exercise a stronger validation path than production. Audit the adjacent artifact/pin declarations for the same last-write-wins or absent-expectation bypass and repair that same-class defect within this boundary; do not change candidate pins or add new roles. Unknown optional fields may remain forward-compatible but cannot redefine a required field.

### R5-02 — no gap-based early return before available comparisons

An observed wrong fixture hash is still a conflict when `runId`, timestamp, command or another unrelated identity field is missing. Apply the same rule to available artifact, route and environment conflicts. Collect diagnostics and reduce once; do not short-circuit on a gap and skip comparisons whose operands are present. When a malformed container makes a comparison impossible, report that defect and continue only checks that are safe and meaningful.

This applies across declaration validation, report admission and requirement aggregation, not just one helper. Keep failures from every contributing source for combined requirements; do not replace them with another source's gap. Keep partial measured observations separate from eligible evidence. Stop after a safe bounded repair; broad engine/transport work is not authorized.

### R5-03 — reported failures are independent of `result`

Always inspect positive failures, failed assertions and failed preconditions when their structure is usable. Missing `result` alone is a gap; it does not suppress an explicit failure list. Present-but-unusable `result` (including explicit null) is invalid, not the same as an absent key. A failed assertion remains failure with an absent or inconclusive summary. Malformed containers are input failures, not silent empty lists. Expected negative-control rejection stays scoped separately; it cannot excuse a positive failure or establish a positive capability.

Do not weaken previous legacy compatibility: gap-only legacy reports remain readable and inconclusive. Preserve known failures and explanatory details even if provenance is absent. No target verdict distribution is prescribed for the existing records.

## Acceptance cases and test strategy

Use one vertical RED → GREEN → refactor cycle per behavior, from a proven coherent control through **raw report → real assembler → real gate**. Independently fix the expected values; never calculate the oracle with the code under test. Synthetic controls remain labelled, not qualification evidence.

| Family | Change from passing affected-requirement control | Expected observation |
| --- | --- | --- |
| R5-01 | Remove expected fixture hash | Inconclusive, missing declaration field named; never pass. |
| R5-01 | Insert conflicting duplicate declaration before or after the valid member | Fail in either order; both conflicting values identified. Identical duplicates also fail. |
| R5-01 | Invalid member types/hash, unknown required reference, duplicate JSON key | Named invalid declaration; nonzero CLI result with a diagnostic artifact, not an unhandled traceback. |
| R5-02 | Wrong observed hash | Fail naming expected/observed hash. |
| R5-02 | Retain wrong hash and independently remove runId, time or command | Still fail; both conflict and gap remain visible. Repeat with available artifact/route/environment conflicts. |
| R5-03 | Positive failure list with missing result | Fail with the source failure named. |
| R5-03 | Failed assertion/precondition with absent or inconclusive result | Fail; gap does not erase failure. |
| Compatibility | No result, no known failures, missing provenance | Inconclusive, not manufactured failure. |
| Isolation | Invalid report/declaration scoped to numeric evidence | All contributing requirements reflect it; unrelated valid requirements keep their prior verdicts. |

Add a small explicit cross-product over the named failure kinds and independent gap kinds. Test both field/member orders where relevant. Verify the invariant: adding an unrelated gap to a known failure never downgrades it or deletes its reason. Distinguish this from removing the only evidence of a failure, which cannot prove that failure remains. Keep this bounded to the admission fields above; no fuzzing infrastructure is needed.

Exercise actual CLI declaration loading and report output in fresh temporary roots, with no mocked assembler or gate. Retain existing regression and runner-exit tests. For each R5 family capture RED's intended reason, GREEN, and an isolated guard-removal sensitivity check. Include a combined-fault sensitivity check that would detect reintroducing a gap-based early return. Keep sanitized command/output excerpts in a small linked text artifact; do not infer cycles from the final green suite.

## Verification, evidence and delivery

Run:

```sh
python3 -m unittest discover -s scripts/raster-qualification/tests -v
bash scripts/raster-qualification/tests/test_runner_exit.sh
python3 scripts/check_docs.py
git diff --check
```

Run applicable syntax/repository gates for files changed. Do not run `run_all_experiments.sh` against private evidence. Existing reports may be evaluated read-only into a fresh temporary root, recording source digests and commands; if unavailable, state that. No source report is rewritten to add identity or make it pass. Do not preserve the previous 12-inconclusive distribution as an acceptance target.

Create `q-declaration-precedence-receipt.md` here and link it from the index. Record baseline/delivery revisions, R5 acceptance outcomes, captured cycle evidence, exact checks, actual evidence verdicts and unavailable measurements. Mark repairs **implemented, pending independent verification**, not resolved. Update the review/debrief, affected Q receipt/LiDAR guidance and bd records; retire this prompt after delivery. Keep Q open and N1 unstarted. Follow repository commit/export/push rules and report delivery state without implying integration.

For the final debrief, distinguish what this prompt newly specifies from requirements already explicit in the previous handoff. Record which combined-fault tests catch what the prior isolated tests missed, and whether declaration validation now covers both normal entry points. Keep reported skill usage, captured execution evidence and independently rerun checks separate. Propose reusable tooling/method changes with a detection criterion, but do not edit skills or repository-wide workflow in this task.

Stop for independent review after the bounded repair. Escalate if completion requires broader architecture, new experiments or a changed scientific/engine decision; those are not authorized by this handoff.
