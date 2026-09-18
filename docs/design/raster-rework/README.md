# Raster rework handoffs and debrief

Status: active — supporting handoffs and review evidence, not a replacement implementation plan.
Tracking: `canopi-j571`; qualification `canopi-kqpp`.
Current guidance: [implementation plan](../raster-data-analysis-rework.md), [LiDAR guide](../../agent/lidar.md), and [delivery workflow](../../workflow/delivery.md).

This folder collects bounded agent handoffs and their review context for the raster rework. The user requested retaining this material to support a later tooling and methodology debrief. The plan owns intended behavior; bd owns execution status; receipts own measured evidence. Existing plan and receipt paths stay unchanged.

Next handoff: [Q gate repair](q-gate-repair-agent-prompt.md). It fixes verdict integrity only and explicitly requires TDD and craft; it does not authorize further qualification experiments or N1. Independent review of `cfbb0c35` did not accept Q despite the implementer's ten-pass summary. See the evidence record below rather than inferring qualification from assertion counts.

| Artifact | Purpose |
| --- | --- |
| [Implementation plan](../raster-data-analysis-rework.md) | Scope, approved UI references, slice dependencies, contracts and qualification gates |
| [Current Q receipt](../raster-qualification-q.md) | Living agent-reported evidence; historical versions are recoverable at `fd86de68` and `cfbb0c35`. Not independent acceptance. |
| [Q correction prompt](q-correction-agent-prompt.md) | Retired first corrective handoff, executed in `cfbb0c35`; retained for comparison |
| [Q gate repair prompt](q-gate-repair-agent-prompt.md) | Current bounded handoff, with requirement-driven verdicts and isolated red–green tests |
| [Review and debrief record](review-and-debrief.md) | Revision-linked findings, reproduced false passes, known evidence limits, process hypotheses and final debrief procedure |
| [GeoLibre reuse inventory](geolibre-reuse-inventory.md) | Modules inspected at the pinned revision and the reuse/adapt/reject decision for each |

For the debrief, compare requested assertions with the implementation actually measured, machine-readable verdicts, review findings and subsequent corrections. Separate missing instructions from failures to follow explicit instructions; do not infer a general model limitation from one run. Tie conclusions to commits, commands and regression tests rather than conversational impressions.

When a handoff is completed or superseded, mark it retired and link its outcome. Retain it as user-requested debrief evidence, not live execution authority. Promote validated, reusable lessons into tests, tooling or operating guides; do not create a parallel Markdown task tracker here.
