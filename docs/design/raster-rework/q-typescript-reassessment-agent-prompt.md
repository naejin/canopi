# TypeScript qualification — bounded design reassessment

Status: proposed — user-authorized reassessment, not an implementation or Round 3 repair assignment.
Tracking: `canopi-kqpp`, parent `canopi-j571`; bd owns execution status.
Current guidance: [Round 2 independent disposition](q-typescript-review.md#round-2-independent-disposition), [C1–C8 contract](q-admission-acceptance.md), [main plan](../raster-data-analysis-rework.md#qualification-tooling-language-and-migration), [LiDAR guide](../../agent/lidar.md).

## Mandate and stop

Determine why known failures still disappear and inconsistent observations still pass after two repair rounds. Deliver one evidence-backed design recommendation and a decision-complete, **proposed** implementation sequence. Do not implement it. The user remains the courier and approves the next scope after independent review; no direct agent-to-agent loop or subagents. This assignment ends with the reassessment delivered to the user, not with the gate repaired or Q qualified.

The prior standing repair prompt has exhausted its two rounds and is retired. This prompt replaces its execution authority, not the scientific plan or C1–C8. Do not silently start Round 3, rewrite the evaluator, switch languages, or add another evaluator. A passing suite is not acceptance.

## Start, baseline and ownership

Read AGENTS.md, the documentation/delivery/issue-tracker guides, the linked LiDAR guide, acceptance contract, standing review, migration receipt and debrief. Apply **craft**, **codebase-design**, and **write-plan**, including their required references. Use **tdd** when specifying the later implementation's test-first sequence; do not manufacture a RED/GREEN claim for this documentation-only assignment. Read skills yourself; do not modify them.

Inspect `git status --short --branch`, `bd show canopi-kqpp`, and current ancestry. Record this reassessment scope in the existing bead without changing Q's acceptance criteria or closing it. Baseline reviewed: implementation `c76d1b2e`, checkout `6a98cd33`. Preserve the full current stack, prior accepted fixes, and approved UI `0e696722`. If the checkout has advanced, identify relevant changes before reusing a historical reproduction; do not reset it to the old baseline or main.

Owned writes are documentation: create `docs/design/raster-rework/q-typescript-reassessment.md`; update the existing review, receipt, index and debrief to link the result and reconcile status. Update Q/main-plan/LiDAR guidance only where current routing changes. Do not create a new receipt or prompt for each finding. Keep current findings in the standing review, not a parallel Markdown task tracker.

Read source and tests under `scripts/raster-qualification/ts/`, the runner, existing producer schemas, `requirements.json`, candidate declarations and assertion evidence map. You may compile existing TypeScript, run committed tests and use small disposable synthetic reports with the real emitted CLI. No tracked source/test changes, dependency installation, engine downloads/builds, new producer observations, private evidence regeneration, benchmark runs, production changes, or Python repair/deletion. Scratch reproducers must use a fresh helper-owned temporary root and preserve all input bytes except disposable copies intentionally exercising collision behavior. Keep private data and paths out of committed documentation.

## Required investigation

1. Reproduce every Round 2 independent finding from a coherent positive control, including failure-only and failure-plus-gap variants. Record expected assertion and requirement outcomes from C1–C8, observed outcomes and reasons, exit code, revision and source-byte preservation. A whole-Q non-pass does not validate individual requirements. If a reproduction differs, investigate the difference rather than prescribing an outcome.
2. Trace the entire existing path: raw bytes → parsed observations/declarations → admission and mappings → findings → requirement reduction → CLI publication/exit. Inspect all mappings, not only the three files named in the review. Identify where an independent comparison is skipped, a malformed value becomes absence, or a derived claim lacks enough underlying observations. Distinguish demonstrated causes, analogous risks and unavailable evidence. Do not claim an exhaustive proof from a finite sweep.
3. Inventory required consumed evidence and its dependencies. For each obligation identify independent checks, checks genuinely blocked by missing operands, required coverage, applicability/negative-control rules and the source of expected values. Missing built revision may block built-revision comparison; it must not block comparing a present claimed pin to the declared pin. Explicitly preserve the distinction between a producer's successful negative control and demonstrated positive capability.
4. Trace output ownership on **both valid and rejected inputs**: request, declarations, source reports, pre-existing destinations, diagnostic publication, write failure and interruption. Explain why collecting source paths only after successful request validation leaves the reproduced collision unprotected. Propose one publication policy that protects inputs even when validation cannot recover all paths; decide ordinary path aliases and existing-output behavior without inventing a hostile-filesystem threat model. No destructive reproduction against user evidence.

## Design recommendation, not speculative framework

Compare two bounded options in the reassessment: disciplined repairs within existing mappings versus a focused seam change that accumulates independently decidable findings before reduction. Retain one TypeScript authority, current runner routing and source snapshots in both. Recommend one based on demonstrated defect elimination, migration/review cost and reuse—not elegance or line count. Reject a wholesale rewrite or generic validation DSL unless a concrete necessity is established; such expansion still needs user approval.

For the recommended option, specify the interfaces and ownership sufficiently for a later agent to implement without guessing. Explain how each independently decidable failure and its reason survives gaps, how required coverage prevents empty success, and how malformed/missing/applicable/unavailable states remain distinguishable. Identify what can be enforced structurally and what still relies on semantic tests. Do not claim that a type or central reducer proves checks were executed.

Reuse/adapt/reject decisions must name existing modules: at least `sources.ts`, `report.ts`, `admit.ts`, `decide.ts`, `verdict.ts`, `qualification.ts`, `cli.ts`, and the affected evidence mappings. Preserve useful regression tests; do not treat fixtures or Python verdicts as the scientific oracle. Define compatibility of raw producer input, diagnostic output and CLI commands, and inventory consumers before proposing format changes. Missing observations stay gaps; do not add producers to make a design look complete.

## Proposed verification and migration

Specify a deterministic test strategy driven by the obligation/dependency inventory, not by the implementation's list of successful checks. Include failure-only → same failure plus independent gap, permutations, duplicate identities, missing versus malformed fields, unrelated-record substitution, inconsistent sample/request/render counts, and valid/rejected-request output collisions. Assert the target assertion, requirement, retained reason and unaffected requirements; distinguish a genuinely blocked comparison from a lost independent finding. Include legitimate negative controls and positive controls supported by actual producer semantics. Classify uncovered combinations with reasons rather than asserting completeness.

Give a bounded proposed migration sequence with module ownership, retained behavior, rollback, tests-first gates and one independent acceptance checkpoint before any experiments. Each proposed slice must have falsifiable outcomes and preserve the sole decision authority—no parallel evaluator trusted as an oracle. Map all Round 2 findings (R2-A–R2-D, including both artifact examples) to the proposed design/test protection and inspect sibling paths. Existing permanent gaps must stay explicit. No requirement, tolerance, engine pin, resource budget or UI decision changes.

The proposal must include a concise comparison of current versus proposed finding flow and publication flow only where that makes ownership clearer. No implementation code or elaborate pseudocode is required. Material unresolved choices must be labelled as decisions blocking implementation, with a recommendation and trade-off; do not call an unresolved proposal implementation-ready.

## Deliverables, evidence and exit gate

`q-typescript-reassessment.md` must contain: inspected revision; actual reproductions; structural causes versus hypotheses; reuse inventory; options and recommendation; proposed interfaces/ownership; compatibility and safe publication policy; deterministic verification coverage and omissions; ordered implementation/rollback proposal; unavailable evidence; and the precise approval requested. Use the standard Status/Tracking/Current guidance header and mark it **proposed, awaiting user approval**.

Update the existing debrief with escaped invariant families, self-review findings, invalid controls, reviewer coverage gaps and which proposed guard would prevent recurrence. Record time or cost only if measured; otherwise unknown. Separate language effects, architecture, implementation, test-oracle errors and review coverage. Define success for the next authorized implementation as fewer escaped invariant families at independent review, not a higher test count. Do not promise a reduction in handoffs without evidence.

For docs-only delivery run `python3 scripts/check_docs.py` and `git diff --check`. Report actual commands for any diagnostics/build/tests run; otherwise state code tests were skipped because source/tests were unchanged. Do not rerun expensive suites solely to decorate a design receipt. Follow repository commit/push and bead-sync rules, preserve user work, and distinguish delivered from integrated. Keep `canopi-kqpp` open.

Final handoff: document path, revision/commit/branch, reproduced findings and non-reproductions, recommended bounded change and trade-off, exact decision requested, checks and limits. **Stop for user-mediated independent design review.** No implementation, Q experiments, remaining Python migration or N1 is authorized by completion. Engine decisions and material UI deviations remain with the user.
