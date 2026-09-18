# Raster rework handoffs and debrief

Status: active — supporting handoffs and review evidence, not a replacement implementation plan.
Tracking: `canopi-j571`; qualification `canopi-kqpp`.
Current guidance: [implementation plan](../raster-data-analysis-rework.md), [LiDAR guide](../../agent/lidar.md), and [delivery workflow](../../workflow/delivery.md).

This folder collects bounded agent handoffs and their review context for the raster rework. The user requested retaining this material to support a later tooling and methodology debrief. The plan owns intended behavior; bd owns execution status; receipts own measured evidence. Existing plan and receipt paths stay unchanged.

| Artifact | Purpose |
| --- | --- |
| [Implementation plan](../raster-data-analysis-rework.md) | Scope, approved UI references, slice dependencies, contracts and qualification gates |
| [Initial Q receipt](../raster-qualification-q.md) | Agent-reported experiments; independent review did not accept Q as qualified |
| [Q correction prompt](q-correction-agent-prompt.md) | Full handoff after review of `fd86de68`, including targeted GeoLibre reuse investigation |

For the debrief, compare requested assertions with the implementation actually measured, machine-readable verdicts, review findings and subsequent corrections. Separate missing instructions from failures to follow explicit instructions; do not infer a general model limitation from one run. Tie conclusions to commits, commands and regression tests rather than conversational impressions.

When a handoff is completed or superseded, mark it retired and link its outcome. Retain it as user-requested debrief evidence, not live execution authority. Promote validated, reusable lessons into tests, tooling or operating guides; do not create a parallel Markdown task tracker here.
