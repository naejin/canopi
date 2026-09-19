# TypeScript qualification — standing repair prompt

Status: retired — both authorized repair rounds are complete; Round 2 remains unaccepted. Historical instructions below do not authorize Round 3. The user authorized the [bounded design reassessment](q-typescript-reassessment-agent-prompt.md) instead.
Tracking: `canopi-kqpp`, parent `canopi-j571`; bd remains the work tracker.
Current guidance: [standing review](q-typescript-review.md), [C1–C8 acceptance](q-admission-acceptance.md), [main plan](../raster-data-analysis-rework.md#qualification-tooling-language-and-migration), [LiDAR guide](../../agent/lidar.md).

## Mandate, authority and stopping point

Repair the existing TypeScript decision path against the complete, unchanged C1–C8 contract. Address the T1–T4 defect families in the standing review, not just their examples. Retain the current architecture; no language change, wholesale rewrite or second evaluator. The user remains the courier: deliver one consolidated receipt to the user and stop for independent review. Do not contact/delegate to another agent, auto-resume a second round, or treat silence as approval.

At most **two user-forwarded repair/review rounds** are covered by this standing assignment. The baseline review at `abf502b6` is round 0. A round consists of one consolidated implementation delivery followed by independent review; internal RED/GREEN cycles do not count. Round 2 requires the user to forward the review and request continuation. If blockers remain after round 2, stop with a structural diagnosis, retained accepted work, bounded options and the decision needed from the user. Do not silently start round 3, redesign the system, weaken the contract or abandon accepted fixes. Successful acceptance also stops this assignment: it does not authorize Q experiments or N1.

## Start and scope

Read AGENTS.md and linked guidance, inspect git status and `bd show canopi-kqpp`, record scope and claim before coding. Preserve the existing branch/stack through `abf502b6`/`df54b314`, historical fixes and approved UI `0e696722`; do not reset to main. Apply **tdd**, **craft**, and **codebase-design**, reading their required references. No skill modifications or subagents.

Owned surfaces: `scripts/raster-qualification/ts/`, related thin wrappers/stub runner tests, assertion-to-evidence mapping and affected documentation. Keep `requirements.json`, candidate pins, scientific limits and budgets unchanged. Python remains frozen: no repair, port of remaining producers or deletion. No production Rust/frontend changes, new dependencies, engine selection/build/download, UI changes, private experiment runs or regenerated private evidence. Use only small synthetic reports and isolated temporary outputs for tests. Available old reports may be reconciled read-only; do not add identity, refresh timestamps or prescribe their verdict distribution.

First reproduce T1–T4 through the real emitted CLI from coherent positive controls; record actual observations. The standing review is the sole current finding list. Retired prompts explain history but do not add assignments. A required resource observation that current producers do not emit stays inconclusive; missing evidence does not authorize new experiments. The frontend toolchain prerequisite is intentional; verify clean-build prerequisites, but do not introduce a dependency without approval.

## Required work before handoff

1. Inventory consumed declarations, source roles, keyed records, run fields and requirement evidence. Derive required sets and expected outcomes from the plan/declarations, independently of supplied records and mapping implementation. Audit **all** assertion mappings for semantic sufficiency, not just name coverage. Explicitly identify unsupported observations instead of manufacturing passing controls.
2. Implement vertical RED → GREEN → refactor cycles. Preserve accepted behavior and diagnostics. Validate before indexing, reduce each run before combining, and retain independent failures before applying evidence gaps. The no-bundle-input boundary and one authoritative decision operation remain intact.
3. Run a deterministic, parameterized **evidence mutation sweep** over every required consumed record/field in the inventory: remove; duplicate identically/conflictingly; corrupt type/value; substitute unrelated identity; permute order; and combine independent known failures with gaps at declaration/source/run/assertion levels. Mark inapplicable mutations with reasons. Invalid present input fails; absent evidence is inconclusive; known failure survives independent gaps. Preserve legitimate negative controls. Check individual assertion/requirement verdicts and diagnostic reasons, plus unaffected requirements; overall non-pass alone is insufficient.
4. After coding, conduct a distinct adversarial self-review of the entire C1–C8 boundary using the emitted CLI and fresh raw inputs, without mocking admission, mappings or verdicts. Try sibling paths beyond T1–T4. Include direct programmatic entry points where the contract requires parity. Fix same-family violations in scope without another prompt. Guard-removal checks in isolated copies must distinguish redundant defenses from an ineffective test; report zero-result probes and limits honestly. Do not equate a finite sweep with proof of completeness.
5. Run final gates and update one consolidated receipt, `q-typescript-receipt.md`, with revision-labelled round sections. Maintain a small sanitized reproduction/mutation log alongside the existing evidence files, linked from the receipt. Do not create a new prompt or receipt for each finding. The implementer may add responses to the standing review but may not write independent acceptance on the reviewer's behalf.

## Verification and delivery

Run from repository root:

```sh
desktop/web/node_modules/.bin/tsc -p scripts/raster-qualification/ts/tsconfig.json
node --test 'scripts/raster-qualification/ts/dist/tests/*.test.js'
python3 -m unittest discover -s scripts/raster-qualification/tests
bash scripts/raster-qualification/tests/test_runner_exit.sh
python3 scripts/check_docs.py
git diff --check
bash -n scripts/raster-qualification/run_all_experiments.sh
```

Also prove a clean build from source without relying on stale emitted files, run applicable syntax/repository gates for changed files, and exercise actual CLI diagnostics/exit codes. If subprocess capture reports sandbox `EPERM`, reproduce that independently and use the normal approval route for an unrestricted test run; do not remove diagnostic assertions. Record exact unavailable commands and residual risk. No private `run_all_experiments.sh` execution.

Update bd, index, relevant Q/LiDAR guidance and debrief without changing scientific authority. Follow repository commit/push rules, preserving unrelated work and distinguishing delivery from integration. The final user handoff must contain round number, bead/branch/commits, gates, **accepted behavior retained / implemented pending review / unavailable evidence**, T1–T4 family coverage, C1–C8 sweep coverage and omissions, actual counterexamples found during self-review, and optional follow-ups. A green test count is not the acceptance argument.

For debrief, record reviewer-discovered defects versus self-review discoveries, repeated defect families, input mutations attempted, false individual passes hidden by overall gaps, controls that proved invalid, environment failures, review rounds, and measured effort if available. Separate language effects, architectural changes, implementation mistakes, unclear requirements and reviewer coverage gaps. No inferred cost/model limitation claims.

Stop after delivery for the user to inspect and forward. Escalate early only for a material authority/scope blocker: altered engine/scientific contract, necessary new dependency/experiment, unavailable required resource, or irreconcilable instructions. Optional style/refactoring work is a separate bd follow-up, not an acceptance blocker. UI prototype approval and engine decisions remain with the user; Q remains unqualified and N1 unstarted.
