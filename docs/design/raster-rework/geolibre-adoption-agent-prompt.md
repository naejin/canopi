# GeoLibre adoption — implementation agent prompt

Status: proposed — prepared for user assignment; saving this prompt does not start production migration.
Tracking: create and claim production execution beads when assigned; reference `canopi-2c94` is complete. Existing raster qualification remains in `canopi-j571.3` under `canopi-j571.1`.
Current guidance: [adoption plan](geolibre-adoption-plan.md), [architecture ownership](../../workflow/architecture-ownership.md), [delivery](../../workflow/delivery.md), and [repository contract](../../../AGENTS.md).

Use this as the implementation assignment when the user forwards or explicitly invokes it. Retire its execution instructions after delivery and retain the plan, receipt, debrief and current operating guides as the durable record.

Implement the accepted Canopi GeoLibre adoption plan. Carry the authorized work through implementation, testing, self-review and one consolidated handoff. Continue through successful internal milestones without asking for routine confirmation.

## Authoritative handoff

- Repository: `/home/daylon/projects/canopi`
- Plan and reference branch: `feature/data-library-reference`
- Inspected implementation/reference baseline: `d3cd4136`; this prompt is a subsequent documentation addition. Preserve later accepted commits too.
- Existing reference checkout: `.rq-scratch/wt-library-reference`
- Full specification: [geolibre-adoption-plan.md](geolibre-adoption-plan.md)
- Interactive reference: [library-reference.html](../../../desktop/web/ui-gallery/library-reference.html)
- Reference instructions: [UI gallery README](../../../desktop/web/ui-gallery/README.md)

Read AGENTS.md, the full plan, and relevant subsystem guides before changing their areas. Follow the existing architecture-ownership and delivery contracts. When assigned by the user, this assignment authorizes production implementation of S0–S5; update the plan's authorization/status accordingly. It does not authorize integration into main, release, branch cleanup, skill edits, subagents, or experiments on the user's live library.

The reference demonstrates the target interactions. Its files, jobs, terrain and numeric samples are simulated. User visual acceptance remains separate. Reuse its shared controls and layout; do not promote its fixture model into production.

## 1. Start safely

Inspect git status, worktrees, current main and existing beads. Preserve all user-owned changes, especially the primary checkout's:

- `.beads/issues.jsonl`
- `desktop/src/native_operation.rs`
- `.beads.gate.lock`

Use an isolated implementation checkout. Follow repository branch rules, retain the accepted reference commits, and maintain a coherent cumulative candidate containing every completed slice. Do not disturb the user's review checkout or running servers.

Create and claim appropriately scoped implementation beads under a migration epic. Keep execution state and resumable checkpoints in bd. Do not reopen the completed mockup bead for production work or silently replace existing raster qualification obligations.

## 2. Deliver the product workflow

First usable milestone: **Import → find → preview → Add to Design → Fit/Inspect → Remove → reuse in another Design → save/reopen.**

Complete S0–S3 before expanding new analysis:

- Finish the production capability inventory and actual performance baseline.
- Prove the real upstream renderer in the Desktop WebView.
- Implement fixed library items, compatible migration and safe publication.
- Bind Data Library and Layers to real production actions and owners.

Then complete S4 contextual GeoLibre Slope and S5 whole-application qualification.

Keep Canopi's canvas/tools, plant catalog, Calendar, Budget, Consortium, persistence, exports, accessibility and edition capabilities working throughout.

## 3. Keep the accepted design small

Apply the plan's fixed decisions:

- TypeScript/Preact and Rust; no new Python code or tooling.
- Adopt qualified upstream packages and narrow source modules. No GeoLibre application fork, React/Zustand infrastructure, database rewrite, generic GIS framework or replacement tiler.
- One fixed library item per import, referencing separate compatible TIFF assets. No giant merged raster, partial batch publication or later source editing.
- Import creates library data; Add explicitly attaches it to a Design.
- Data Library manages reusable items; Layers manages Design presentation.
- Remove history/Restore/library Undo, published-source mutation, automatic analysis refresh and standalone Analysis navigation.
- Preserve legacy data, exact numeric readers, stable identities and Design undo.
- Upstream display resampling is accepted. Numeric inspection and analysis retain their scientific contracts.
- New Slope uses the qualified GeoLibre method. Existing Horn results and failed-operation recipes retain their meaning.
- Preserve `.canopi` v6 and current Desktop/Web boundaries.

Sections 4–7 of the plan govern ownership, resource limits, migration, deletion, scientific behavior and permitted upstream patches. Do not substitute convenient implementation behavior for those contracts.

## 4. Prove the risky boundaries early

S1 is the first decisive proof. Use the pinned public raster package boundary, a real projected COG, real Tauri range transport and the existing MapLibre/Pixi composition. Verify responsive plant editing, worker execution, offline assets, style reload and teardown during active reads.

If unchanged upstream code satisfies a requirement, use it. Add only necessary adapters or patches within the plan's permitted scope, with provenance and focused proof.

Before building S4 around the engine, execute the real pinned native CLI on the plan's small method-discriminating fixture. A compile check or flat-plane result does not qualify the scientific integration.

## 5. Use behavioral TDD

For changed behavior:

1. Write a focused test through the real owner/caller.
2. Observe and inspect the intended failure.
3. Make the smallest implementation change.
4. Run the test and adjacent cases; then refactor.

Record already-correct behavior as baseline GREEN. Missing-module failures are setup failures, not evidence of a product defect.

Test relevant frontend flows through component/action/workflow/authored IPC boundaries, and native flows through command/executor/temporary library. Control external I/O and timing; do not mock away the owner whose behavior is being proved.

Preserve applicable R48/R50/R51 and F1/F2 protections. Include cancellation, disposal/reinstallation, Design replacement, stale results, mid-write failure, retry identity and migration recovery. Use independent numeric expectations.

Adapt obsolete tests only against explicit accepted scope changes. Never weaken guardrails to make adoption pass.

## 6. Measure actual usability

Compare baseline Canopi, the pinned upstream reference and the migrated route using the same representative inputs, viewport sequence, hardware and stated cache conditions.

Separate preparation time, import-to-useful-view and ready-data display latency. Measure repeat pan/zoom, input stalls and aggregate resources as specified in section 9 of the plan. Do not present mockup timing, tiny-fixture timing or historical cold-tile measurements as first-viewport performance.

Evaluate the plan's proposed performance targets honestly. Report a reproduced miss and its cause; do not silently waive targets or start an unrelated optimization program.

Drive the gallery, actual Desktop application and served Web build. Typechecking and screenshots alone are insufficient.

## 7. Finish without routine courier loops

Resolve ordinary implementation choices and in-scope defects yourself. Run focused checks during development and the applicable combined gates on the final candidate.

Escalate only material contract conflicts, dependency failures outside the allowed patch scope, consequential missing decisions, or genuinely unavailable capabilities. Supply the smallest reproduction, impact, alternatives and recommendation. Continue independent authorized work.

Unavailable platforms or credentials do not excuse runnable local proofs. Report exact remaining evidence without claiming qualification.

Before handoff:

- Drive the complete library journey and retained whole-app workflows.
- Review every changed production caller, not just shared helpers.
- Reconcile affected operating guides and design status.
- Commit intended changes and push the implementation branches under repository rules.
- Verify the delivered candidate contains all required commits.

Return one consolidated receipt with:

- Candidate commit, branches, bead statuses and review checkout.
- Completed user workflows and concrete remaining blockers.
- Upstream code adopted, patched and custom code retired.
- Reproducible performance results and test commands.
- Exact unverified environments and residual risks.
- Instructions for my final `cargo tauri dev` review.
- Confirmation of preserved user-owned work.

Update the existing [debrief](review-and-debrief.md#whole-rework-delivery-and-improvement) with observed defects, detector quality, design omissions versus implementation deviations, and measured effort/courier cycles where available. Recommend only the smallest demonstrated process improvements. Do not claim cost savings from test counts, code volume or prompt length.
