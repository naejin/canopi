# Finish ordered COG display and asynchronous panel settlement

Status: active — sole current raster implementation assignment; bounded correction after independent review of `524eef55`.
Tracking: `canopi-jv8a.4`; related `canopi-kko3`; parent `canopi-jv8a`, epic `canopi-j571`.
Current guidance: [current findings R12–R14](ordered-cog-review.md#current-disposition-at-524eef55), [fixed design](ordered-cog-design.md), [collaboration](collaboration-protocol.md), [LiDAR](../../agent/lidar.md), [debrief](review-and-debrief.md#ordered-cog-delivery-and-final-debrief), [delivery](../../workflow/delivery.md).

## Finish the outcome in one run

Repair the three reproduced failures: reduced tile footprints lose contributing sources; navigating during a pending edit leaves controls disabled; late same-layer reads replace newer state. Then complete the mounted-map smoke that the panel/catalogue pass did not establish. Preserve the ordered COG architecture, the eleven-group repairs, source/history compatibility and recompute-after-Undo. Do not restart the original implementation or re-open settled design decisions.

You own focused diagnosis, implementation, regressions, local factoring, isolated Desktop verification, self-review, documentation and task-local improvements through one consolidated delivery. Continue through internal phases without routine permission requests. Context boundaries and long tests require resumable bd checkpoints, not a new prompt. Resolve facts from the repository yourself. Escalate only a demonstrated need to change product/scientific/compatibility/resource contracts, perform destructive handling, add a dependency/engine or obtain external authority. Explain evidence, recommendation and blocked work; continue independent work. No subagents, integration, release or branch deletion.

## Start and preserve

1. Read repository instructions, current review and design. Inspect status in both checkouts; inspect/claim the existing bead. Continue `feature/bounded-raster-generations` from `524eef55`, preserving `64050896`, its docs merges and accepted predecessors. Do not branch anew from main. Record this prompt as the current brief.
2. Incorporate the forwarded documentation commit. Preserve the delivery branch's newer `ordered-cog-receipt.md`, live evidence, debrief outcomes and operating-guide inventories. Keep one current prompt/review/design; historical outcomes remain revision-labelled. Correct current text claiming the live workflow is wholly unavailable or that the delivery checkout lacks implementation.
3. The primary checkout's dirty `desktop/src/native_operation.rs` and `.beads.gate.lock` remain user-owned; do not read, stash, stage or reset them. Use the established implementation checkout. Diagnostic scratch is optional, never an input required for production tests.

## Implement and verify the three local corrections

Begin with the review's failing cases in ordinary tests. `tiles.rs` owns candidate bounds and reduction reads; `LidarLayersSection.tsx` owns view request/loading state and pending edits. Reuse existing resolver, awaited edit commands, library refresh and test fixtures. The design's completion/read-identity and incremental-consumer sections settle ownership and behavior; exact counters/helper names are yours.

For R12, derive candidate bounds from all native/reduced windows the tile actually consumes, including both interpolation neighbours and level-dependent footprints. Retain spatial filtering and read limits. Verify the actual ordered tile renders the 2×2 edge fixture and correct values/validity with contributing overlap; preserve native-scale and chunked-reader controls. Passing an unfiltered read is diagnosis only, not the fix. No extra raster cache or renderer.

For R13/R14, separate mutation lifetime from view/traversal lifetime. Keep navigation usable during an edit; its eventual success/failure must always settle the owned pending state, while obsolete view updates stay fenced. Independently track collection and History reads, reset traversals on head/selection changes, reject late pages and keep controls disabled until their required current metadata has settled. Test success and rejection after navigation, old-after-new responses, and a pending page during a same-layer refresh. Unmount prevents local updates but does not cancel an already submitted library edit. Preserve visible named errors and expected-head validation.

Run focused regressions as you work. Then review the diff separately, following the public tile and UI paths through completion, replacement and teardown. Repair adjacent failures in these required behaviors; unrelated enhancements become follow-ups. There is no new scheduler, generic request framework, schema migration, capacity campaign, per-occurrence filename change or legacy GUI migration project in this assignment.

## Complete the missing visible-map evidence

Reuse the successful isolated recipe in the existing receipt: Xephyr `:99` with `-extension GLX`, software GL, fresh profile/runtime, private D-Bus and Vite 1430. Check these display/port names are still free before use; stop only owned processes. The prior evidence lives locally in `.rq-scratch/smoke-repair-K7Qm` and `.rq-scratch/smoke-repair-live.log`; preserve it. Follow the edition guide rather than assuming the user's display or servers are available.

Confirm a Design Location through the existing UI, mount the map and navigate to the imported coverage. Use overlap whose composed output visibly differs between orders under the existing style (avoid two constant surfaces that independently autoscale to the same colour). Observe rendered reorder → Undo → Restore, whole-layer visibility and a zoomed-out edge; the map must update without reopening the panel or restarting. Verify slope becomes current after a numeric edit, and the mounted map survives save/reopen. Exercise navigation during a pending edit/read. Use synthetic fixtures if the external IGN fixture is absent; label them accurately. The prior panel/history pass remains evidence and need not be repeated wholesale.

Capture a few decisive screenshots and correlate them with immutable head/result identities. SQL, source-list order or a fulfilled tile request alone is not a visible-map pass. Do not install dependencies or build a GUI harness. If safe isolation genuinely fails, finish all independent work and record the exact failed command/prerequisite, remaining observation and runnable steps; evidence remains pending. The previously demonstrated isolation is the starting point, not a presumed blocker.

## Gates, improvement and delivery

Follow repository gates for the actual diff: Rust fmt/strict Clippy/check and focused native raster tests; frontend typecheck and focused panel/action/map tests; docs validation. Run workspace/full frontend/shared-contract/edition gates when their repository triggers apply. Do not change IPC/schema merely to justify a new abstraction. Rebase preserving merges under delivery rules, run affected gates on the final candidate, and report exact revision/commands/results. Reuse unchanged evidence with its original revision; do not describe old full-suite totals as new runs.

Use bd for checkpoints and the existing receipt for evidence, with R12/R13/R14 and the map observation mapped to their decisive checks. Keep the earlier review/repair measurements and distinguish your own pre-delivery discoveries from independent escapes. Update affected guide entry points and symbols; remove contradictory current statements. Finish one compact outcome in the existing debrief using its current correction fields.

You may fix small, reversible task-local test/script/diagnostic problems when an observed failure blocks trustworthy work, using existing dependencies and a failing/healthy check. Record whether the next use improved; then return to product work. Broader workflow/skill/tool proposals need a follow-up bead and evidence, not installation or another framework here. Cost/time remains unknown unless measured. Prefer a concrete regression or a corrected existing command over more instructions.

Commit/export intended bead/doc/code changes and push the existing implementation branch to its configured remotes. Keep `canopi-jv8a.4` open for independent disposition; retain the positive `canopi-kko3` caller evidence without claiming broad acceptance. Return one concise handoff: commit/branch, receipt, three fixes and regressions, visible-map evidence, gates/pending observations, improvements applied versus untested proposals, remaining decisions/follow-ups and untouched user files. Main-agent review and the user's integration decision follow; no routine continuation prompt is needed before this handoff.
