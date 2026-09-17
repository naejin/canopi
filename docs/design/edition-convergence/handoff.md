# Desktop and Web development convergence

Status: completed 2026-09-13.
Tracking: `canopi-dp4s`.
Current guidance: [Edition development](../../agent/edition-development.md).

This record described implementation from baseline `cfa16e8cab9f06f1dfe37a99fd64c668208cae2c`. The original specification remains available in Git history at `281e8caa`. It is no longer an operating contract; current ownership, commands, and check selection live in the [Desktop and Web edition development guide](../../agent/edition-development.md).

Implementation was tracked by epic `canopi-dp4s` and four ordered child beads:

| Slice | Disposition | Commit |
| --- | --- | --- |
| Development feedback | Added distinct strict-port Desktop, Web, and memory-gallery loops; a combined edition build check; and real Web/gallery CI gates | `146dd228` |
| Workspace composition | Moved common command-to-surface validation, routing, dock sizing, planning-panel mounting, and shared dialog placement into one composition owner with explicit edition adapters | `64280460` |
| Canvas-host lifecycle | Completed the source assessment and retained the two host-sequence adapters around the existing shared runtime lease, cleanup, replacement, and runtime-surface seams | `f92a705a` |
| Catalog presentation | Shared Favorites matching and detail focus return; retained distinct Desktop and reduced Web list/filter/detail presentations around the existing Workbench and compile-time storage adapters | `2adc50c6` |

The resulting authorities are:

- [Edition development](../../agent/edition-development.md) for safe setup, ports, fixtures, isolation, check selection, and handoff.
- [Document lifecycle](../../agent/document-lifecycle.md#canvas-host-lifecycle-assessment) and [Canvas Runtime](../../agent/canvas-runtime.md) for the retained canvas-host boundary.
- [Frontend workbenches](../../agent/frontend-workbenches.md#catalog-presentation-assessment) and [ADR 0008](../../adr/0008-species-catalog-storage-adapters.md) for the catalog presentation and storage boundary.
- [Frontend validation](../../agent/frontend-validation.md) and [build/release](../../agent/build-release.md) for executable gates and their limits.
- [UI gallery](../../../desktop/web/ui-gallery/README.md) for disposable Desktop/Web workspace scenarios.

Exact focused and integrated command results, interaction evidence, and unavailable platform paths are recorded in the epic and child bead notes. The work preserved separate native Save and browser Download/Draft semantics, existing Design replacement and persistence coordinators, SceneStore and Design Edit authority, reduced Web catalog scope, and compile-time infrastructure selection. It did not publish a release or deploy the Web Edition.
