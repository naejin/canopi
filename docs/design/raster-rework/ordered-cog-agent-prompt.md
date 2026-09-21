# Implement ordered COG Data Layers through the real Desktop workflow

Status: active — sole current raster implementation assignment; replaces the materialized-source-merge completion prompt.
Tracking: `canopi-jv8a.4`; reconcile `canopi-kko3`; parent `canopi-jv8a`, epic `canopi-j571`.
Current guidance: [fixed design](ordered-cog-design.md), [collaboration protocol](collaboration-protocol.md), [LiDAR](../../agent/lidar.md), [debrief](review-and-debrief.md#ordered-cog-delivery-and-final-debrief), [delivery](../../workflow/delivery.md).

## Your assignment

The user selected an ordered collection of independently prepared COGs instead of materializing merged source rasters. Implement the [design](ordered-cog-design.md) end to end: add GeoTIFFs to a Data Layer, move sources up/down, toggle the whole layer, and use the same topmost-valid composition for display and slope. Remove the obsolete merge/overlap-decision workflow for new work. Preserve existing libraries and useful source preparation, native reader, ownership, scientific and bounded-I/O code. No alternatives study or new engine selection.

You own implementation, focused diagnosis, tests, routine local design, UI adaptation within the fixed contract, documentation reconciliation, and self-review. One authorization covers all internal phases and execution windows. Complete as much of the authorized outcome as the environment permits before one consolidated delivery. Do not stop after a green backend slice, receipt draft or routine checkpoint; those are not completion. Repair normal-workflow failures within this assignment, including live Undo/map/History refresh and stale slope. The design settles recomputation after Undo; it is not an unresolved product choice.

## Start and preserve

1. Read repository instructions, the fixed design and relevant subsystem guides. Run `git status --short --branch` in both the active and implementation checkout; inspect `bd show canopi-jv8a.4` and `bd show canopi-kko3`.
2. Continue `feature/bounded-raster-generations` from the delivered `0696bd3d` stack, preserving accepted `a5fc7d7b` and C1/C2. Re-scope/claim the existing bead to this handoff; do not restart at main or the old `6a5130b3` baseline and lose delivered fixes. Record the design link and acceptance in bd. This is continuation of the existing bead/branch, not a new untracked project.
3. Incorporate the forwarded documentation commit, preserving newer branch-specific receipt evidence and guide inventories. Resolve routine docs conflicts by keeping this current assignment and revision-labelled historical evidence. The primary checkout's dirty `desktop/src/native_operation.rs` and `.beads.gate.lock` are not yours; do not stash, reset or stage them.
4. Start with the actual collection caller + migration/read seam, then proceed through the four design phases. Use existing tooling and fixtures. Read code before choosing helper names or removing old paths.

## Fixed boundaries and delegated decisions

The design fixes top-first priority, source-specific NoData, shared display/analysis meaning, immutable collection snapshots, conservative historical-composition adapters, snapshot history, current limits, library/Design authority and resource ownership. Source ordering is numeric library state; group visibility is presentation. Do not weaken these to make a gate pass.

You may choose private modules, SQL schema details, typed function names, compatible additive transport fields, test fixtures, commit divisions, and ordinary UI layout within existing components. Remove redundant new-write merge machinery once replacement callers and compatibility tests pass. Keep necessary legacy readers; do not pursue a purity rewrite or generic abstraction. Reuse the current scheduler, cache, journal and migration mechanisms where their contracts fit.

You may fix task-local scripts, diagnostics or test fixtures when a demonstrated defect blocks trustworthy delivery. Keep changes small, tested and associated with the behavior they improve; document the failed command or false claim they address. Update affected operating guides immediately when a command or recurring rule changes. Do not introduce a new reporting framework, modify installed skills, rewrite repo-wide workflow, install dependencies, change engines or broaden the frozen Q work. Wider tooling/skill proposals belong in a follow-up bead with evidence for the final debrief.

Escalate only a demonstrated conflict requiring different product semantics, destructive data handling, changed scientific/compatibility/resource guarantees, new dependency/engine, or external authority. State the observed evidence, minimal decision, recommendation and exact blocked work; continue independent work. Routine failures, known in-scope bugs, source-code surprises with a contract-preserving solution, long runtimes and execution-window boundaries are not new permission gates. No subagents unless separately authorized.

## Verify, improve and deliver

Use the design's concrete examples and real caller boundaries. Prove tests establish their claims; an equal-content collision fixture must actually have equal bytes and distinct file identity. Use a focused sensitivity check if a critical detector is doubtful, not a mutation quota. Retain meaningful scientific and ownership tests when replacing old merge-specific tests.

Run focused tests while developing. Run required Rust/frontend/shared-contract/documentation gates on the final candidate and rerun affected gates after code/rebase changes. Exercise the real Desktop workflow in an isolated profile, preserving the user's instance, data and ports. Do not substitute a helper test, gallery or database inspection for a claimed live map action. Missing prerequisites mean explicit pending evidence and a runnable handoff, not invented success or an unrelated harness project.

Use bd for checkpoints: last verified revision, completed caller behavior, unresolved blocker if any, and next executable action. No parallel Markdown task tracker. Keep one current `ordered-cog-receipt.md` and one compact outcome in the existing debrief. Record discoveries and tool friction when they occur so the final debrief does not reconstruct them from memory. Distinguish your own repairs from independent-review escapes and main-agent design omissions. Cost/time is unknown unless actually recorded; the user's reason for delegating execution is not measured evidence of savings.

Before delivery, independently reread the final diff against the design, fix in-scope findings, reconcile docs/status links, and remove obsolete live instructions. Export intended bd changes, commit and push the existing implementation branch under repository Git hygiene, preserving merges and accepted commits. Keep `canopi-jv8a.4` open for independent disposition; record resolution evidence for `canopi-kko3` without claiming independent acceptance. No integration, release, branch deletion or capacity change.

Return one handoff: final commit/branch, receipt, demonstrated user workflows, exact verification and unavailable evidence, remaining decisions/follow-ups, documentation/tooling improvements with evidence, and untouched user-owned files. Main-agent independent review and the user's integration decision come next; you are authorized to finish all preceding work without another routine continuation prompt.
