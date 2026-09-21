# Raster rework handoffs and debrief

Status: active — supporting handoffs and review evidence, not a replacement implementation plan.
Tracking: `canopi-j571`; current ordered COG batch under `canopi-jv8a.4`; accepted predecessor `canopi-jv8a.1` at `a5fc7d7b`; historical qualification `canopi-kqpp`.
Current guidance: [implementation plan](../raster-data-analysis-rework.md), [LiDAR guide](../../agent/lidar.md), and [delivery workflow](../../workflow/delivery.md).

This folder collects bounded agent handoffs and their review context for the raster rework. The user requested retaining this material to support a later tooling and methodology debrief. The plan owns intended behavior; bd owns execution status; receipts own measured evidence. Existing plan and receipt paths stay unchanged.

The current assignment is [ordered COG Data Layers](ordered-cog-agent-prompt.md), under the [fixed design](ordered-cog-design.md). The user selected independent COG sources with explicit priority instead of materialized source merges. Continue from `0696bd3d` on `feature/bounded-raster-generations`; preserve C1/C2 and accepted `a5fc7d7b`. The old product-closure assignment is retired. Neither product closure nor integration was accepted: Undo's stale presentation/analysis becomes required work in the replacement.

The implementation agent owns all four internal phases, routine repairs and task-local tooling improvements through one consolidated delivery. The [protocol](collaboration-protocol.md) sets escalation and review boundaries. The [debrief](review-and-debrief.md#ordered-cog-delivery-and-final-debrief) records measured product progress, escaped defects, design omissions and tested workflow/tooling improvements. Historical records below are evidence, not alternate execution instructions. Q remains frozen/unqualified.

| Artifact | Purpose |
| --- | --- |
| [Ordered COG implementation prompt](ordered-cog-agent-prompt.md) | Sole current assignment: source collection, source priority, display, slope, compatibility and real Desktop delivery |
| [Ordered COG design](ordered-cog-design.md) | Fixed product, persistence, lifecycle, UI and acceptance decisions |
| [Ordered COG ADR](../../adr/0027-ordered-cog-data-layers.md) | User-selected replacement for compulsory merged-source publication |
| [Bounded-generation completion assignment](bounded-generation-completion-agent-prompt.md) | Retired: delivered through `0696bd3d`; C1/C2 accepted in scope, product closure partial |
| [Bounded-generation delivery receipt](bounded-generation-receipt.md) | Branch-local implementer report and measured evidence for B1–B5, BG1–BG8 and C1/C2; lives on `feature/bounded-raster-generations` |
| [GeoLibre integration receipt](geolibre-integration-receipt.md) | Branch-local implementer report for G1–G5 and D1/R1; lives on `feature/geolibre-native-raster-integration` |
| [Delivered BG1–BG5 assignment](bounded-generation-correction-agent-prompt.md) | Retired; preserve the improvements delivered through `9ad85c18` |
| [Bounded-generation independent review](bounded-generation-review.md) | `6a5130b3` disposition, source evidence and limits of independently repeated tests |
| [Bounded-generation initial assignment](bounded-generation-agent-prompt.md) | Retired kickoff; continue the correction, not a new bead or baseline |
| [Bounded-generation design](bounded-generation-design.md) | Historical source-merge design; superseded for new work by the ordered COG design |
| [Sparse-generation ADR](../../adr/0026-sparse-raster-generations.md) | Historical decision; superseded for new source composition by ADR 0027, preserved assets remain readable |
| [GeoLibre review-correction assignment](geolibre-integration-followup-agent-prompt.md) | Retired; D1/R1 accepted at `a5fc7d7b` |
| [GeoLibre independent review](geolibre-integration-review.md) | Original findings and final bounded-scope acceptance, with independently rerun evidence |
| [GeoLibre integration assignment](geolibre-integration-agent-prompt.md) | Retired G1–G5 prompt; correction independently accepted at `a5fc7d7b` |
| [GeoLibre integration design](geolibre-integration-design.md) | Selected native core/pin, private interface, ownership, compatibility, bounds and scope decisions |
| [Qualification reset](qualification-reset.md) | Historical anti-overengineering decision; freeze retained, artifact-first sequencing superseded by selected native integration |
| [Artifact decision handoff](q-engine-decision-agent-prompt.md) | Retired after brief delivery `71abad0f`; no continuing assignment |
| [Desktop lifecycle handoff](q-desktop-lifecycle-agent-prompt.md) | Withdrawn, not completed; original instructions retained in Git at `a162c1a0` |
| [Desktop bridge completion handoff](q-desktop-bridge-completion-agent-prompt.md) | Retired; delivery `f9b5c10c` independently reviewed as partial, with remaining DB3/DB4 blockers |
| [Desktop bridge handoff](q-desktop-bridge-agent-prompt.md) | Retired; delivered in `fab0c381`, independently reviewed as partial with DB1–DB4 blockers |
| [Collaboration protocol](collaboration-protocol.md) | User-mediated design, implementation, review and evidence-driven improvement loop |
| [Numeric completion handoff](q-numeric-counter-repair-agent-prompt.md) | Retired; bounded slice independently accepted at `579880be` |
| [Bounded boundary-repair handoff](q-final-boundary-repair-agent-prompt.md) | Retired assignment; original examples repaired, two numeric blockers remain after independent review |
| [TypeScript implementation handoff](q-typescript-implementation-agent-prompt.md) | Retired S1–S5 assignment; delivery independently reviewed with remaining B1–B3 blockers |
| [TypeScript reassessment prompt](q-typescript-reassessment-agent-prompt.md) | Retired investigation assignment; original delivery remains recoverable in `55d6f485` |
| [TypeScript decision-complete design](q-typescript-reassessment.md) | Reviewer-owned design replacing the reassessment proposal: explicit outcomes, safe publication, compatibility, full migration and verification |
| [Standing TypeScript repair prompt](q-typescript-repair-agent-prompt.md) | Retired after two unsuccessful repair/review rounds; no Round 3 authority |
| [Standing TypeScript review](q-typescript-review.md) | Baseline T1–T4 family reproductions, independent evidence, subsequent round dispositions |
| [Consolidated agent prompt](q-consolidated-agent-prompt.md) | Retired handoff executed in the consolidated admission repair |
| [Consolidated repair receipt](q-consolidated-repair-receipt.md) | Historical implementer report; independent review found remaining blockers despite 261 passing tests |
| [Consolidated repair cycles](evidence/q-consolidated-repair-cycles.txt) | Captured RED/GREEN, sensitivity probes, self-review cases and read-only evidence reconciliation for that repair |
| [TypeScript agent prompt](q-typescript-agent-prompt.md) | Retired handoff executed in the TypeScript decision-path migration |
| [TypeScript repair round 2 log](evidence/q-typescript-repair-round2.txt) | Reproduction of the Round 1 disposition's six families, the transport declaration correction, thirteen guard-removal probes and the three-round reconciliation |
| [TypeScript repair round 1 log](evidence/q-typescript-repair-round1.txt) | Reproduction of the standing review's T1–T4 examples, the mutation sweep, the adversarial pass, eleven guard-removal probes and the read-only reconciliation |
| [TypeScript migration receipt](q-typescript-receipt.md) | Revision-linked implementation reports, now including the [artifact decision brief](q-typescript-receipt.md#artifact-decision-brief-after-qualification-reset); not acceptance |
| [Assertion evidence map](../../../scripts/raster-qualification/assertion_evidence_map.md) | The 68 contract assertions, the evidence that decides each, and the seven that are permanent gaps |
| [Stable admission acceptance contract](q-admission-acceptance.md) | Single C1–C8 input/behavior/test matrix and blocker-versus-follow-up policy |
| [Consolidated admission review](q-consolidated-admission-review.md) | Revision-linked reproductions, reviewed boundaries, retained repairs and evidence limits |
| [Implementation plan](../raster-data-analysis-rework.md) | Scope, approved UI references, slice dependencies, contracts and qualification gates |
| [Historical Q receipt](../raster-qualification-q.md) | Frozen evidence, not a production entry gate; historical versions recoverable at `fd86de68` and `cfbb0c35`. Not independent acceptance. |
| [Q correction prompt](q-correction-agent-prompt.md) | Retired first corrective handoff, executed in `cfbb0c35`; retained for comparison |
| [Q gate repair prompt](q-gate-repair-agent-prompt.md) | Retired handoff executed through `47b9d508`; repair not independently accepted |
| [Q evidence integrity prompt](q-evidence-integrity-agent-prompt.md) | Retired handoff executed in `2c830b0d`; independent review requires further repair |
| [Q evidence integrity receipt](q-evidence-integrity-receipt.md) | Implementer-reported admission repair and 12-inconclusive result; not independent acceptance |
| [Q admission completeness prompt](q-admission-completeness-agent-prompt.md) | Retired handoff delivered in `50c1211e`; independent review requires further repair |
| [Q admission completeness receipt](q-admission-completeness-receipt.md) | Implementer report and captured cycle excerpts; not independent acceptance |
| [Q declaration/precedence prompt](q-declaration-precedence-agent-prompt.md) | Retired handoff delivered in the declaration/precedence repair; retained as debrief evidence |
| [Q declaration/precedence receipt](q-declaration-precedence-receipt.md) | R5 reproductions independently fixed; complete gate still blocked by consolidated findings |
| [Q declaration/precedence cycles](evidence/q-declaration-precedence-cycles.txt) | Captured RED/GREEN, guard-removal sensitivity and read-only evidence reconciliation for that repair |
| [Review and debrief record](review-and-debrief.md) | Revision-linked findings, reproduced false passes, known evidence limits, process hypotheses and final debrief procedure |
| [GeoLibre reuse inventory](geolibre-reuse-inventory.md) | Modules inspected at the pinned revision and the reuse/adapt/reject decision for each |
| [Q gate repair receipt](q-gate-repair-receipt.md) | Historical implementer report for the first gate repair; its four passing requirements are not independently accepted |

For the debrief, compare requested assertions with the implementation actually measured, machine-readable verdicts, review findings and subsequent corrections. Separate missing instructions from failures to follow explicit instructions; do not infer a general model limitation from one run. Tie conclusions to commits, commands and regression tests rather than conversational impressions.

When a handoff is completed or superseded, mark it retired and link its outcome. Retain it as user-requested debrief evidence, not live execution authority. Promote validated, reusable lessons into tests, tooling or operating guides; do not create a parallel Markdown task tracker here.

For the consolidated cycle, update the acceptance matrix and one receipt in place. Preserve row IDs and record material scope changes explicitly. Do not create another prompt for each defect within the agreed boundary. Cosmetic and optional hardening findings are separate follow-ups; they do not reopen verified repairs.
