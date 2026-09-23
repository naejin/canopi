# Finish the raster candidate through verified production workflows

Status: active — sole implementation prompt; continue reviewed candidate `291d0773`.
Tracking: `canopi-j571.1` under `canopi-j571`; existing `feature/raster-rework-completion`.
Current guidance: [ownership correction](completion-ownership-design.md), [C0–C5 contract](completion-design.md), [source-import amendment](source-import-design.md), [protocol](collaboration-protocol.md), [receipt](completion-receipt.md).

## Assignment and first actions

Finish the authorized whole-rework candidate, not just the newest review examples.
Users must be able to import supported numeric sources, manage ordered Data Layers,
run/retry slope, inspect physical values, save/reopen independent presentation,
and use Web Location/shared basemaps. Preserve Float32/NoData, originals, immutable
history, legacy compatibility and the selected GDAL/native-reader architecture.
Acceptance, primary-checkout integration and release remain separate.

Inspect `git status --short --branch`, worktrees, ancestry and
`bd show canopi-j571.1`; claim/resume that bead in the candidate worktree. Merge
this committed documentation handoff with history preserved. Start from
`291d0773` or its verified successor, retaining `34e4ded4`, `f61f8494` and subsequent
accepted repairs. Do not restart from the older documentation checkout. Its
`.beads/issues.jsonl`, `desktop/src/native_operation.rs` and `.beads.gate.lock`
are user-owned: do not stage, stash, overwrite or discard them.

Read the ownership correction, C0–C5 and the source-import amendment once.
The ownership correction is the current seam-specific authority; older reviews
are historical evidence where their sequencing differs.
Use relevant subsystem guides as each slice requires; older review records are
supporting evidence, not a stack of alternate assignments. Reconcile the existing
bead design/acceptance links to this prompt; do not create another completion bead.
Inventory disk, existing fixture paths/generators, isolated GUI tooling, package
assets and non-publishing platform checks early, then continue local work.

## Execute through these internal milestones

| Order | Outcome and owned surfaces | Exit before continuing |
| --- | --- | --- |
| 1 | Consolidate the complete basemap lifecycle under one owner: `maplibre/basemap-*`, three map owners and their existing tests | TDD the M acceptance cases, starting with initial mount without events; migrate Canvas/Location/WorldMap and verify actual control ownership, coverage, replacement and disposal |
| 2 | Consolidate ordered library reads and workflow-owned settlement; complete targeted Retry and inspection currency: `app/lidar`, Analysis panel, IPC/native LiDAR owners | TDD the L acceptance cases with real store/workflow, including rejected-read recovery and overlapping completions; named two-definition Retry and native in-flight/early-NoData cases pass |
| 3 | Complete resource safety and available C1/R27/R43 evidence: existing admission, analysis, process and fixture seams | Capacity loss during output, real write fault, finite chunk timeout/uncapped source cancellation and retry pass; perform all available live resource/fixture measurements |
| 4 | Demonstrate the combined product and deliver it: existing Desktop/Web/gallery recipes, receipt and guides | C0–C5 caller audit, required final-tree gates and available driven workflows complete; unsupported claims corrected and exact external gaps recorded |

These are checkpoints, not requests for permission or separate deliveries.
Dependencies may justify reordering. Keep one writer; subagents are not authorized.
Routine helper/API organization inside the named owners, small test gates, diagnosis,
regressions, i18n and contract-preserving fixes are delegated. Keep all eleven
locales aligned if copy changes. Reuse accepted controls; no new analysis editor.

Use the repository TDD skill for every changed behavior: write one regression,
run and inspect its intended RED, implement the smallest coherent GREEN, then
refactor while green. Record the compact evidence required by the ownership
correction; do not substitute a final test total for TDD. First reproduce each concrete failure, then fix
it and examine its adjacent success/failure/replacement/disposal behavior. Do not
mock away the owner or capability being verified. Record actual red/green evidence;
source-traced findings without a reproduction are not retrospectively red tests.
The supplied probes are starting points: committed tests must use the normal test
runner and cannot depend on `/tmp` or ignored scratch artifacts.

Use the pinned GeoLibre references in the ownership correction for lifecycle and
reconciliation patterns; no further toolkit survey is needed. Preserve existing
`wbgeotiff` adoption. No engine search, whole-toolkit import, geometry dependency,
generic scheduler, new qualification harness or speculative abstraction.

## Continue independently; escalate only material decisions

Work until all authorized, available implementation and verification is complete.
Do not hand back after focused green tests, one milestone, a context checkpoint,
or a missing unrelated fixture. Use bd checkpoints with revision, observed outcome,
remaining blocker and next executable command, then resume. Do not create Markdown
progress lists or a second task tracker.

Unset fixture variables are discovery work: inspect the documented existing inputs
and reuse bounded generators where authorized. Missing real inputs, disk, keys or
hosts block only their evidence. Small queue, capacity, clock and fault tests and
local broad gates are work to perform, not external prerequisites by default.
Never fabricate real-fixture accuracy from synthetic inputs or lift ceilings by
removing guards without the amendment's bounded evidence. Record a specific failed
command/prerequisite once; retry only after a relevant condition changes.

Escalate only an actual conflict with fixed scientific/compatibility behavior,
shared ownership/persistence/dependency decisions, consequential product scope,
or authorization. Provide revision, counterexample, blocked scope, smallest
alternatives and recommendation; continue unaffected work. Ordinary failing tests,
local helper changes and small verification-tool repairs do not require approval.
The main reviewer owns omitted decisions and overprescription in this handoff.

## Self-review, improvement and delivery

Before returning, trace each changed production caller through settlement or
teardown and audit all remaining C0–C5 obligations. Repair in-scope defects found
there. Optional cleanup/new features go to bd follow-ups without delaying closure.
Run the complete [C5 gate set](completion-design.md#c5--final-candidate-independent-review-and-debrief)
on the final combined code and after any required rebase preserving merges:
full frontend tests/typecheck, gallery and both editions, generated bindings,
Rust fmt/strict workspace clippy/check/tests/native policy, docs, and available
fixture/package lanes. Earlier-tip or focused gates cannot substitute. Do not
repeat broad gates for unchanged code solely because the receipt was edited.

Use the existing [receipt](completion-receipt.md#current-correction-acceptance):
for each obligation report code revision, named regression/caller, exact command
and outcome, observation level and remaining limitation. Distinguish implemented,
locally verified, independently accepted, integrated and released. Missing required
proof remains partial. Keep code defects separate from missing proof and actual
external prerequisites; leave the bead open while its acceptance is unmet.

Apply small demonstrated improvements to existing tests/scripts/guides during work,
verify their failure case and healthy control, then return to product work. Record
material discoveries as they occur; finish the [six-question debrief](review-and-debrief.md#final-correction-debrief-to-deliver)
after gates. Evaluate next-use benefit and unnecessary machinery, including this
prompt's cost. No new skills, model router, metrics service or automation platform.

Commit intended changes and bead records without touching unrelated work. Push the
candidate to both configured destinations and verify matching tips/upstream status.
Return one consolidated handoff with revisions/branch, R44–R51 and R27/R43/C0–C5
dispositions, required gates, actual driven workflows, exact remaining blockers,
self-review discoveries and tested versus proposed improvements. Stop there for
independent acceptance. Do not integrate, release or clean branches automatically.
