# Finish the raster candidate with bounded ownership repairs

Status: active — sole implementation prompt; continue reviewed candidate `592e04ed`.
Tracking: `canopi-j571.1` under `canopi-j571`; existing `feature/raster-rework-completion`.
Current guidance: [current repair decisions and tests](completion-review-592e04ed.md), [C0–C5](completion-design.md), [ownership contract](completion-ownership-design.md), [source-import amendment](source-import-design.md), [receipt](completion-receipt.md), [debrief](review-and-debrief.md#final-correction-debrief-to-deliver).

## Assignment

Finish all locally executable authorized work before one consolidated handoff.
Repair F1 installation/attempt ownership and F2 retained listener cleanup; close
R50 saved-definition action/IPC/native proof; audit and complete remaining C0–C5
and R27/R43 evidence where prerequisites exist. The linked repair decisions settle
behavior and test boundaries. Make ordinary implementation choices locally.
Preserve numeric/NoData behavior, immutable history, compatibility, source-only
import, ordered presentation and all accepted repairs. No architecture rewrite,
new dependencies, runtime framework, new Python code, or renewed GeoLibre research.
Use TypeScript and Rust for new tests/tooling; existing repository Python validators
remain allowed. Do not replace working existing tooling merely because it is Python.

## Start and execute

Inspect status/worktrees and `bd show canopi-j571.1`; claim/resume the existing bead
in the candidate checkout. Merge this documentation handoff preserving history.
Continue from `592e04ed` or its verified successor; retain test handoff `0a3a29f4`,
its five repairs, foundations `34e4ded4`/`f61f8494` and later accepted fixes. Do not
start implementation from this older documentation checkout. The primary checkout's
`.beads/issues.jsonl`, `desktop/src/native_operation.rs` and `.beads.gate.lock`
are user-owned; do not stage, stash or overwrite them.

1. Reproduce F1 with the supplied test; write and validate F2's retention detector.
   Repair each in a vertical RED → GREEN → refactor cycle with healthy controls.
   Add the adjacent replacement/finally cases specified in the repair decisions.
2. Complete R50 at the actual boundaries. Preserve passing production behavior;
   record baseline GREEN honestly when no repair is necessary.
3. Trace the changed owners and direct callers through setup, reuse, failure,
   replacement and teardown. Fix in-scope discoveries and rerun affected checks.
   Check both visible effects and retained ownership; do not stop at helper tests.
4. Audit existing whole-candidate requirements, run feasible remaining local proof,
   then final C5 gates. Required unavailable evidence remains explicitly partial.

Do not weaken assertions, mock the owner under test, fabricate RED through a broken
fixture, or add sleeps to force ordering. Keep tests in normal Vitest/Rust suites.
Use bounded fault seams already present. Record meaningful expected/actual failures
and named GREEN commands in the receipt; no transcript quota or new tracker.
Keep bd checkpoints resumable: revision, remaining obligation, last failure, next
command. Finish ordinary repairs, gates and docs without asking for continuation.

## Gates and delivery

Use the [acceptance packet commands](completion-acceptance-tests.md) plus the new
cases. Run the complete [C5 gates](completion-design.md#c5--final-candidate-independent-review-and-debrief)
on the final combined code, including any required rebase preserving merges.
This includes frontend typecheck/full tests, gallery/both builds, bindings, native
fmt/strict workspace Clippy/check/tests/policy, docs and available fixture/workflow
lanes. Rerun affected gates after fixes; unchanged code does not need repeated broad
gates solely for receipt edits. Never silently repair unrelated mainline failures.

Update current receipt rows in place: code revision, exact command/result, real
boundary, residual limitation. Separate defects, unwritten local proof and actual
external prerequisites. Retain capacity measurements with their original scope.
Update affected agent guides and current-guidance links. Complete the existing
six-question debrief with its current next-use evaluation; remove expired instructions.

Escalate only a material conflict with scientific/compatibility, shared ownership,
persistence/dependency or product-scope decisions. Give the counterexample, blocked
work, smallest alternatives and recommendation; continue unaffected work. Missing
external prerequisites do not block unrelated local completion. Optional new work
goes to bd follow-ups, not silent scope expansion. Keep the bead open while required
acceptance remains unmet; do not equate passing the supplied tests with acceptance.

Commit intended files and authorized bead updates; push the candidate to both
configured destinations and verify matching tips. Return revision/branch, F1/F2/R50
results, R27/R43 and C0–C5 disposition, gates, driven workflows, exact blockers and
the concise debrief. Stop for independent review; do not integrate, release or clean
branches. The user remains courier; no automatic delegation is authorized.
