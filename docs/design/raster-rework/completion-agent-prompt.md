# Complete and self-review the raster candidate

Status: active — sole implementation prompt after review of `26eca68a` and the user's approval of repairs before integration.
Tracking: `canopi-j571.1` under `canopi-j571`; continue `feature/raster-rework-completion`.
Current guidance: [correction decisions](completion-correction-design.md), [review R27–R43](completion-review-26eca68a.md), [completion contract](completion-design.md), [source-import amendment](source-import-design.md), [protocol](collaboration-protocol.md).

## Mandate

Deliver one working, thoroughly self-reviewed candidate. Complete the accepted
C0–C5 requirements, repair R27–R43 and related in-scope defects, retain previous
repairs, and obtain every available required verification. The user has approved
sustained execution through these internal steps. Do not stop after a successful
phase, a context checkpoint or routine gate failure to request another prompt.
The main agent's next intervention should be a material architectural decision
or independent acceptance of a concrete delivery, not ordinary debugging.

You own implementation, focused diagnosis, local choices, tests, evidence,
operating-guide reconciliation and small proven task-local tooling improvements.
The main agent owns fixed cross-subsystem design and independent acceptance;
the user remains courier and owns scope and consequential risk. No subagents,
automatic agent handoff, primary-checkout integration, release or branch cleanup
are authorized. Finish repairs on the candidate before integration is considered.

## First actions

1. Read `AGENTS.md`, the correction decisions and review, then C0–C5 and the
   source-import contract. Load subsystem guides only for the slice being changed.
   Older Q records and delivery diaries are historical evidence; read a specific
   section only when a current invariant or unresolved question requires it.
2. Inspect status/worktrees/remotes and `bd show canopi-j571.1`; claim/resume the
   existing bead. Work in `.rq-scratch/wt-candidate` from `26eca68a` or a verified
   successor, preserving `34e4ded4` and `f61f8494` ancestry. Merge this committed
   docs handoff without replacing candidate code or losing measurement history.
3. Preserve the primary checkout's `.beads/issues.jsonl`,
   `desktop/src/native_operation.rs`, `.beads.gate.lock` and other user-owned work.
   The primary checkout intentionally lacks the new Data/Analysis code; do not
   switch or integrate it to make a smoke test display those panels.
4. Reconcile the existing bead's design/acceptance with the active documents.
   Use `--append-notes` for a progress checkpoint; `--notes` replaces history.
   Establish the small lifecycle reproductions, and inventory disk/fixtures,
   installed GUI tooling and available non-publishing platform checks early.

## Execute through one consolidated delivery

Follow [A–D](completion-correction-design.md#a--finish-the-import-and-inspection-lifecycle-first):
repair import/inspection lifecycle and attempt a small real workflow; repair
provider transitions through mounted callers; finish native resource admission
and measurements; then self-review, combined gates and delivery. Repair a known
dependency earlier where necessary. These are execution checkpoints, not approval
barriers. Keep one bead/branch/receipt/debrief, with last verified revision and
next action in bd so context changes are resumable.

The seventeen review examples are minimum counterexamples, not the whole test
plan. For each changed invariant trace a production caller, its owner, a normal
outcome and the material failure/replacement/teardown path. Change state after
initial success: close/reopen, switch Design/head/key/locale, overlap requests,
fail then recover. An initial render or a manually invoked helper does not prove
wiring. Recreate useful scratch probes as ordinary committed regressions. Record
observed red/green and healthy controls; do not invent earlier failures.

Do not weaken contracts to match the candidate. In particular old input ceilings,
uncancellable copy/hash, dense slope admission and missing live peak measurements
are unfinished implementation/evidence, not external prerequisites. Preserve the
one-step import, exact-versus-display distinction and historical library values.
Use existing owners, pages, failpoints and native readers before adding helpers.
A new abstraction needs a concrete caller or resource lifetime it simplifies.

Audit all C0–C5 once from final callers, including obligations not covered by the
new probes (same-definition Analysis Retry and native inspection post-read currency
among them). Repair in-scope self-review discoveries before returning. Use focused
tests while editing; run required broad gates on the final combined tree, and
rerun affected checks after code or rebase changes. No test-count, mutation-count
or repeated full-suite quota. A docs-only revision can reuse unchanged code gates.

If a small tool/guide change removes demonstrated friction, implement and test it
inside the task, then resume product work. Record whether its next actual use
helped. Avoid building another harness, skills package, generic workflow engine
or productivity tracker. Proposed broad tooling changes become scoped follow-ups,
not a detour. Use the [debrief contract](review-and-debrief.md#final-correction-debrief-to-deliver)
throughout; it is not an essay to reconstruct after the work.

## Blockers and return boundary

Continue all independent work around unavailable keys, fixtures, hosts or runners.
Do not repeatedly retry unchanged environment failures. Provide exact missing
prerequisites and runnable remaining observations in one partial delivery only
when available work is exhausted. Time/context limits are checkpoints, not proof
that unfinished code has become an external blocker.

Escalate only a demonstrated conflict with a fixed contract, an unresolvable
scientific/compatibility/ownership decision, new dependency/engine need, or action
outside authorization. Supply revision/reproduction, impact, smallest alternatives,
recommendation and work that can proceed. Routine local implementation decisions
and failed tests remain yours to resolve. Never silently waive acceptance.

At delivery reconcile the receipt, debrief and guides; update/export only intended
bead records, commit and push the candidate to both configured destinations,
verify identical tips and clean status, and retain independent acceptance pending.
Return: revision/branch, user workflows actually observed, R27–R43 dispositions
with regression evidence, actual remaining limits, resource/fault observations,
combined gates and external gaps, self-review discoveries, applied versus proposed
improvements, and preserved user files. Do not claim the whole amendment complete
from a green existing suite or the previously measured 24-file/400M lanes.
