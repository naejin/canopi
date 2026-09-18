# Consolidated qualification admission repair — agent prompt

Status: retired — delivered in the consolidated admission repair; retained as debrief evidence, not execution authority. Implementation is recorded in the [consolidated repair receipt](q-consolidated-repair-receipt.md) and awaits independent verification. Do not re-execute this prompt. The [acceptance contract](q-admission-acceptance.md) is unchanged and remains the basis for review.
Tracking: `canopi-kqpp`, parent `canopi-j571`.
Current guidance: [stable acceptance contract](q-admission-acceptance.md), [review evidence](q-consolidated-admission-review.md), [scientific plan](../raster-data-analysis-rework.md).

## Assignment

Repair the complete admission-to-CLI decision path against **C1–C8 in the linked acceptance contract**. That is the acceptance matrix; do not treat retired prompts as accumulating additional assignments. Preserve the independently verified R5 fixes. Stop for independent review after this repair; Q stays open/unqualified and N1 unstarted.

Read AGENTS.md, the LiDAR guide, plan Q requirements, contract and consolidated review. Inspect git status and `bd show canopi-kqpp`; record this scope and claim before coding. Preserve branch `feature/raster-html-references` through `5becb043`/`9fea1931`, prior accepted stack and UI `0e696722`. Do not reset to main. The prototype and engine-decision gates remain with the user; native GDAL preparation/slope were already permitted.

Read/apply **tdd** and **craft**, including required references, and **codebase-design** for any admission seam changes. Report actual constraints and any unavailable skill. No subagents or skill modifications. Use existing admission/declaration types and reusable tests; small structural refactoring is allowed where needed to enforce one parse/one reduction, but no wholesale harness rewrite or generic schema framework.

Owned surfaces: `scripts/raster-qualification/` admission, requirement mapping, bundle gate, CLI/runner routing, small tests and directly affected docs. Unlike the previous narrowly scoped repair, `qualification_gate.py` and the runner are explicitly in scope. Preserve scientific IDs, pins, tolerances and budgets. No dependencies, production code, engine selection/builds, new benchmark/probe runs, UI changes or private evidence regeneration.

## Work sequence

1. Establish baseline gates. Inventory the consumed input fields for C1–C8 and record the test mapping alongside the harness. Separate already-verified cases from uncovered ones. Do not ask for another user round trip merely to implement a listed acceptance case.
2. Implement vertical RED → GREEN → refactor cycles through raw reports, real assembly and real gate. Use coherent fresh positive controls and parameterized wrong-type/absence/duplicate/conflict cases. Capture representative RED/GREEN output and isolated guard-removal sensitivity for the boundary categories, including combined faults. Fix discovered same-class matrix violations within this scope; do not stop after the first two reproducers turn green.
3. Perform a separate **adversarial self-review pass** after implementation: try to cause a false pass, hide a failure or crash the actual CLI using small fresh temporary reports. Check gate without admissions, missing each report, bad nested types, wrong identities, over-limit/missing measurements, failure-plus-gap combinations and runner eligibility bypass. Do not mock assembler/gate in these integration checks. Record discovered counterexamples and repairs, or the exact cases attempted; “all tests pass” is not this review.
4. Reconcile documentation and run final gates. Write one `q-consolidated-repair-receipt.md` here linking the matrix, a small sanitized cycle/self-review log, test names per row and residual gaps. Update this contract/receipt in place if clarification is needed; do not create another prompt per finding. Mark implementation pending independent verification, not accepted on your own authority.

## Verification and evidence safety

Run `python3 -m unittest discover -s scripts/raster-qualification/tests -v`, `bash scripts/raster-qualification/tests/test_runner_exit.sh`, `python3 scripts/check_docs.py`, `git diff --check`, applicable Python/shell/JavaScript syntax checks and other repository gates triggered by changes. No benchmark runner against private evidence. Test runner behavior only with isolated deterministic stubs and fresh roots.

Existing reports may be evaluated read-only into a new temporary output root with source digests and exact commands. Their current non-pass count is not a target. Missing measurements stay missing; do not add identity to old reports or claim a new run occurred. If evidence is unavailable, say so. Keep raw pixels, sensitive absolute paths and large outputs outside Git.

## Delivery and stop rules

Update the folder index, review/debrief, affected Q receipt/LiDAR guidance and bd records without duplicating the acceptance matrix. Distinguish retained accepted repairs, newly implemented cases, independent verification and unavailable real capability evidence. Include the self-review results and genuine lessons about missed boundaries; do not infer model cost/settings or workflow adherence from test counts.

Follow repository commit/export/push rules and preserve unrelated user work. Final handoff names bead, revisions, branch, tests, matrix coverage, actual verdicts, limitations and delivery/integration state. Retire this prompt after delivery; retain the stable contract for independent acceptance.

Only stop early for a material scope/authority blocker (engine/scientific decision, new experiment, required private resource unavailable). Optional hardening/style findings go to separately scoped bd follow-ups and do not block this delivery. Independent review will judge the listed invariants, not introduce cosmetic requirements. A new material defect must cite the matrix invariant it violates or request an explicit scope change.
