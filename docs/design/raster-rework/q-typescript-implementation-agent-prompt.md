# TypeScript qualification — implementation handoff

Status: retired — executed through `d6b3f8e1`; [independent review](q-typescript-review.md#settled-design-independent-disposition) requires B1–B3 repairs under the [next handoff](q-final-boundary-repair-agent-prompt.md). Kept for the assignment record; it authorizes nothing further.
Tracking: `canopi-kqpp`, parent `canopi-j571`.
Current guidance: [implementation receipt](q-typescript-receipt.md#implementation-of-the-settled-design-s1s5), [decision-complete design](q-typescript-reassessment.md), [C1–C8 acceptance](q-admission-acceptance.md), [standing review](q-typescript-review.md#implementation-response-at-5878f80e-implementer-not-acceptance).

Delivered under this assignment: S1–S5 in `2b0a02c7`, `70e51534`, `1fb1d064`, `8a85fc3a`, `567e6d29`,
`5878f80e`; 239 TypeScript tests, 261 retained Python tests, 18 runner stub checks, coverage/drift/parity
guards and a guard-removal pass with no zero-result probes. Q remains unqualified and `canopi-kqpp` stays
open. The text below is the historical assignment, not a current instruction.

## Assignment

Implement the linked design, D1–D5 and phases S1–S5, against unchanged C1–C8. The reviewing agent owns the design; you own implementation, tests and evidence. The user remains the courier. Do not redesign the scope, contact another agent, spawn subagents or ask for approval between internal phases. Resolve routine coding choices locally; escalate a genuine authority/compatibility conflict with concrete evidence.

This prompt becomes the execution assignment when the user forwards it. It authorizes only the TypeScript qualification decision path, safe output publication, associated tests/thin runner and docs. It does not authorize experiments, producer migration, Python edits/deletion, native engine work, dependencies, production frontend/Rust changes, N1, integration or release. Q remains unqualified. Material UI changes and engine decisions stay with the user.

## Start

Read AGENTS.md and its relevant workflow/LiDAR guides, then the full linked design and C1–C8 contract. Read and apply **tdd**, **craft** and **codebase-design**, including required references. Do not edit skills. Inspect git status, ancestry and `bd show canopi-kqpp`; claim and record this bounded scope before coding. Preserve the current `feature/raster-html-references` stack through `55d6f485`, all earlier fixes and UI `0e696722`. Do not reset to main or discard existing work. Identify any intervening source changes before reusing baseline reproductions.

The reassessment's original proposal is superseded by the current design. Old D-A–D-F questions are resolved; historical prompts add no assignments. In particular: explicit evidence-backed check outcomes, no-overwrite publication, decision version 2, preserved reproducible-build admission, full mapping migration and independent test expectations are fixed decisions.

## Execution and verification

Use vertical RED → GREEN → refactor cycles. First reproduce the relevant failing behavior from a coherent control; observe the intended RED, not an import/fixture/sandbox failure. Implement S1 publication before verdict migration, then use the whole display requirement as the first checked requirement. Continue through all remaining mappings and remove the temporary adapter before delivery. One consolidated handoff after S5, not one handoff per phase.

The design owns acceptance examples, publication recovery, compatibility and gates. Required behavior includes:

- No implicit pass from a check that ran, returned nothing, or recorded no applicable evidence.
- Every independent known failure/reason survives missing or malformed siblings, including fields in the same check/record and different records of the same shape.
- Physically consistent positive controls; the old 128-render/100-sample fixture is corrected, not blessed as an oracle.
- Reproducible pinned builds are supported only with the full identity/digest chain; no engine build is run.
- Valid and rejected requests cannot replace existing inputs or outputs; fallback diagnostics are newly owned, not a fixed sibling filename.
- Every requirement/assertion is migrated or explicitly unsupported. Missing real producer/platform observations remain gaps.

Derive the test-case inventory from the contract and source semantics independently of production `reads`/check lists. Test assertion, requirement and identifying reason plus unaffected requirements. Use the real CLI for domain families and publication; narrow driver tests cover malformed check outcomes. Preserve meaningful Python regressions as frozen reference material. Baseline decision diffs reveal changes; they are not the correctness oracle.

Fix in-scope counterexamples found during the work before delivery. Run a distinct final adversarial pass and behavior-removal checks in isolated copies; report zero-result probes, fixture corrections and unavailable evidence honestly. No private `run_all_experiments.sh` invocation, no identity synthesis for old reports, no incidental real benchmark. Use only small synthetic inputs and owned temporary outputs.

Run the exact final gates in the design, including fresh-output-directory compilation/tests, retained Python regressions, stub runner tests, syntax, docs and diff checks. Use normal approval procedures for sandbox restrictions; never weaken tests to pass. If a required gate cannot run, record its command, reason and residual risk.

## Delivery and stop

Update the existing `q-typescript-receipt.md` with a revision-labelled implementation section, the standing review with responses (not independent acceptance), evidence map, index, relevant Q/LiDAR guidance and debrief. Retire this prompt after delivery and point to the receipt. Do not create another per-defect prompt, receipt or Markdown task tracker. Record RED/GREEN commands, coverage/omissions, original versus corrected controls, semantic decision diffs, actual self-review discoveries and final gates. Time/cost remains unknown unless measured.

Commit only intended files, preserve unrelated work, update/export/sync bd and follow repository delivery rules. Keep `canopi-kqpp` open because this tooling slice does not qualify Q. Final handoff: bead/branch/commits, S1–S5 coverage, accepted behavior retained / implemented pending review / unavailable observations, checks, deviations and actual counterexamples discovered. Stop for independent review through the user; no auto-resume or next phase.
