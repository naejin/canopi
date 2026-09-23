# Finish the raster rework: corrections, source import and verified delivery

Status: active — sole implementation assignment after independent review of `5d0a5e0b` and the user's acceptance of the correction/import direction.
Tracking: `canopi-j571.1` under `canopi-j571`; continue that bead and `feature/raster-rework-completion`.
Current guidance: [completion contract](completion-design.md), [source import](source-import-design.md), [R15–R26 review](completion-review-5d0a5e0b.md), [protocol](collaboration-protocol.md), [receipt](completion-receipt.md), [debrief](review-and-debrief.md#whole-rework-delivery-and-improvement).

## Your mandate

Deliver the whole remaining rework as one reviewable candidate. Repair R15–R26,
implement the simplified source import contract, finish the real Desktop/Web
workflows and obtain every available required verification. The user has approved
sustained implementation: continue through routine diagnosis, fixes, tests,
internal phases, documentation and resumable context checkpoints without asking
for another prompt. Return only for a material blocker or consolidated delivery.
The next main-agent intervention should be architectural arbitration or independent
review of working software, not ordinary implementation continuation.

The candidate already contains useful work. Preserve it and the accepted native
foundation; do not restart the project or rewrite the raster engine. The review
found code defects, not merely unavailable live observations. Read its concrete
reproductions before trusting prior green test totals or capability claims.

## Start here

1. Read repository instructions, the completion contract and source-import design.
   Use phase-specific guides routed there. Inspect status/worktrees/remotes and
   `bd show canopi-j571.1`; claim/resume the existing bead. Do not create another
   completion epic, bead or parallel implementation branch.
2. Work from `5d0a5e0b` or its verified successor on
   `feature/raster-rework-completion`, normally `.rq-scratch/wt-candidate`. Verify
   `34e4ded4` and `f61f8494` ancestry. Foundation integration is already complete;
   do not replay it. Merge this committed documentation handoff, retaining the
   candidate's revision-labelled receipt/debrief evidence and current code.
3. Preserve primary-checkout changes to `.beads/issues.jsonl`,
   `desktop/src/native_operation.rs` and `.beads.gate.lock`, and all existing
   evidence/worktrees. Follow the export reconciliation rule for dirty bead data.
4. Update the existing bead's design/acceptance to this contract, then execute
   C0–C5. Inventory fixtures, disk/RAM, isolated GUI setup, non-publishing platform
   CI/package prerequisites and optional Google access early. No credentials in
   chat, Git, reports or tracker. Missing external access blocks only that proof.

## Decisions you should implement, not reopen

- Import is choose files → explicit interpretation → Import → bounded preparation
  → atomic publication. Data owns progress/cancel/retry. No before/after previews,
  second Apply screen or mandatory prior-composition pixel scan.
- No arbitrary input byte/file/cell ceiling on the new streamed route after its
  callers are bounded. Preserve real format/index limits, disk reserve, working
  memory/cache/queue budgets, cancellation and legacy dense guards. Storage and
  analysis have different resource admission.
- Exact composed statistics may be unknown. Preserve old exact values, add a
  separately labelled source-derived display range, and show unknown coverage
  honestly. Do not invent an eager statistics job or substitute sums as union area.
- Inspection uses the existing canvas `worldToGeo`, correct source/result readers
  and units, signed coverage, real cancellation and Design/head/request fencing.
- Official Google needs usable authenticated tile/viewport requests, metadata,
  renewal and correct map lifecycle wiring. A token absent from all outgoing tile
  requests is a defect, not a privacy success. Both editions retain their accepted
  feature boundaries and one map owner.
- Reuse current Data/Analysis/Layers primitives, Design Edit, job owners, native
  GDAL/pinned reader, migrations and generated bindings. No new engine, generic
  workflow framework, Python raster runtime or speculative abstraction. No
  subagent delegation is authorized by this assignment.

The contract settles cross-subsystem changes. Private module layout, helper
extraction, bounded algorithms, test placement and ordinary debugging remain your
judgment. Repair in-scope defects you discover; don't ask the user to choose local
implementation details. Escalate a demonstrated conflict with a fixed scientific,
ownership, compatibility or consequential product decision, not a failing test.

## Work through the actual product

Establish small caller regressions first, then implement C1 and Data wiring. Run a
real small Data import/reopen early; do not defer the first application workflow
until after scale tests. Continue inspection and provider repairs, observing their
live surfaces before the final gate run. Translate required UI strings in one
cohesive pass across all 11 locales. Use the accepted references for visual
components while applying the explicitly amended import interaction.

Make each critical regression demonstrate the failure for the intended reason
and a healthy control. Exercise real publication, map loading, changed keys,
head/Design transitions and physical values. Do not mock the behavior under test,
copy an implementation formula as its oracle, or report a passing assertion whose
trigger never occurred. Reuse review probes where useful, but commit ordinary
regressions independent of scratch paths. Record meaningful red/green evidence;
there is no mutation-count or test-count target.

Use focused checks while editing; run the required combined gates once the code
settles, and rerun affected gates after code/rebase changes. Reuse caches and the
edition guide's isolated GUI recipe; inspect resource/process ownership before
starting or stopping anything. If chooser typing is unreliable, use clipboard
paste or short owned fixture paths. Test the same user workflow rather than
spending repeated rounds on unchanged automation failures.

Keep bd resumable: last verified revision, completed outcome, blocker if any and
next concrete action. Keep one receipt and one debrief, not a round-by-round diary.
A checkpoint/context boundary is not completion. Continue independently useful
work around missing credentials, fixtures or platforms; after exhausting available
work return one partial delivery with exact external prerequisites. Never relabel
required unavailable evidence as passed or repeatedly retry unchanged blockers.

## Scope, review and return

No public release, paid service, user-profile mutation, destructive cleanup,
branch deletion or integration of unaccepted new code is authorized. Follow C5 for
existing non-publishing CI and draft review artifacts. Preserve merges when
updating onto main; run combined gates on the resulting tree. Reclamation,
per-occurrence naming, new analysis types and unrelated optimization remain
follow-ups unless a demonstrated required flow depends on them.

Before returning, review the final diff against the contract from its actual
callers, repair in-scope findings, reconcile guides and current status links, and
commit/push the candidate and intended bead export to both configured destinations.
Verify exact remote revision, ancestry and clean status. Keep independent acceptance
and release pending for their owners.

Return one concise delivery with links to the receipt/debrief: revision/branch,
R15–R26 disposition, new import behavior and actual limits, exact-versus-display
metadata, real Desktop/Web/inspection/provider observations, resource measurements,
gates/platform/package gaps, applied improvements and untested proposals, remaining
material decisions and preserved user files. Full completion requires the contract's
verified candidate; partial delivery must name what is missing and why.

For a material blocker, give the exact revision/reproduction, conflicting contract,
affected work, smallest viable alternatives, your recommendation and work that can
continue. Do not ask for permission again for work this assignment already covers.
