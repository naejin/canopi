# Raster rework handoffs and debrief

Status: active — supporting handoffs and review evidence, not a replacement implementation plan.
Tracking: `canopi-j571`; qualification `canopi-kqpp`.
Current guidance: [implementation plan](../raster-data-analysis-rework.md), [LiDAR guide](../../agent/lidar.md), and [delivery workflow](../../workflow/delivery.md).

This folder collects bounded agent handoffs and their review context for the raster rework. The user requested retaining this material to support a later tooling and methodology debrief. The plan owns intended behavior; bd owns execution status; receipts own measured evidence. Existing plan and receipt paths stay unchanged.

The settled-design delivery through `d6b3f8e1` has been independently reviewed: three boundary families remain unaccepted. The [bounded boundary-repair handoff](q-final-boundary-repair-agent-prompt.md) is the sole next assignment when forwarded by the user; the [decision-complete design](q-typescript-reassessment.md) is retained. After tooling acceptance, the intended milestone is fresh qualification evidence, prioritizing local bridge and Desktop hosting under a separately authorized assignment. No experiments, Python deletion, production N1 or integration are authorized by this handoff.

| Artifact | Purpose |
| --- | --- |
| [Bounded boundary-repair handoff](q-final-boundary-repair-agent-prompt.md) | Sole next assignment: repair B1–B3, provide measurement readiness, then stop for user-mediated review |
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
| [TypeScript migration receipt](q-typescript-receipt.md) | Revision-linked implementation reports; Round 2 independently unaccepted; preserved for reassessment |
| [Assertion evidence map](../../../scripts/raster-qualification/assertion_evidence_map.md) | The 68 contract assertions, the evidence that decides each, and the seven that are permanent gaps |
| [Stable admission acceptance contract](q-admission-acceptance.md) | Single C1–C8 input/behavior/test matrix and blocker-versus-follow-up policy |
| [Consolidated admission review](q-consolidated-admission-review.md) | Revision-linked reproductions, reviewed boundaries, retained repairs and evidence limits |
| [Implementation plan](../raster-data-analysis-rework.md) | Scope, approved UI references, slice dependencies, contracts and qualification gates |
| [Current Q receipt](../raster-qualification-q.md) | Living agent-reported evidence; historical versions are recoverable at `fd86de68` and `cfbb0c35`. Not independent acceptance. |
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
