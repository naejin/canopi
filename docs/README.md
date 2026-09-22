# Documentation map

Start with the narrowest authority for the task. Current implementation guidance belongs in `docs/agent/`; historical evidence is useful context, not an operating contract.

| Need | Authority |
| --- | --- |
| Repository workflow, quality gates, architecture rules | [`AGENTS.md`](../AGENTS.md) |
| Domain vocabulary | [`CONTEXT.md`](../CONTEXT.md) |
| Subsystem implementation guidance | [`docs/agent/`](agent/) via the links in `AGENTS.md` |
| Desktop/Web/gallery daily development | [`docs/agent/edition-development.md`](agent/edition-development.md) |
| Agent workflow, issue tracking, and integration | [`docs/workflow/`](workflow/delivery.md) |
| Architecture ownership, implementation handoffs and user-mediated review | [Architecture ownership](workflow/architecture-ownership.md) |
| UI hierarchy and reusable interaction patterns | [`.interface-design/system.md`](../.interface-design/system.md) |
| Durable architecture decisions and supersession history | [`docs/adr/`](adr/) |
| Release operation | [`docs/release.md`](release.md) and [`docs/agent/build-release.md`](agent/build-release.md) |
| Canvas PDF acceptance behavior | [`docs/canvas-pdf.md`](canvas-pdf.md) |

## Evidence and history

Implementation specifications and completed design records live under `docs/design/`. Proposed work must not override current operating guides before implementation. The [completed Desktop/Web convergence record](design/edition-convergence/handoff.md) points to the delivered [edition development guide](agent/edition-development.md); its implementation history remains in bd epic `canopi-dp4s`.

The [LiDAR guide](agent/lidar.md) routes current implementation work. Its [foundation record](design/lidar-library.md) retains storage and scientific invariants; the rework below replaces the old future-delivery plan, and bd owns executable scope. The [scientific evidence](design/lidar-agroecology/report.md) records measured inputs and interpretation limits.

The [raster, Data and Analysis rework](design/raster-data-analysis-rework.md) retains broader future workbench/Web scope. The user-selected [ordered COG design](design/raster-rework/ordered-cog-design.md) and [implementation prompt](design/raster-rework/ordered-cog-agent-prompt.md) now own the current source-collection, display and slope assignment, replacing materialized source merging. [ADR 0027](adr/0027-ordered-cog-data-layers.md) records the change; historical dense/sparse generations remain readable. The delivered `524eef55` branch stack carries the [independent repair findings](design/raster-rework/ordered-cog-review.md) and the [design's repair contract](design/raster-rework/ordered-cog-design.md#8-repair-contract-after-review-of-783e31e3); the three remaining local corrections (R12–R14) are repaired at `d53f4185` and the mounted-map pass is recorded in the [delivery receipt](design/raster-rework/ordered-cog-receipt.md), which owns the revisions, evidence and limits. Native integration is accepted at `a5fc7d7b`; C1/C2 are accepted in safety scope, but product closure/integration remain pending. Q stays frozen. The [handoff folder](design/raster-rework/README.md) and [debrief](design/raster-rework/review-and-debrief.md) retain revision-linked evidence and tested workflow/tooling improvements; bd owns execution state.

The v2 spatial workspace is implemented. [ADR 0025](adr/0025-always-anchored-spatial-workspace.md) records its accepted contracts; [Canvas runtime](agent/canvas-runtime.md), [MapLibre](agent/maplibre.md), and [Document lifecycle](agent/document-lifecycle.md) route current work. The [completed v2 plan](design/geolibre-spatial-review.md) retains historical contracts and qualification evidence. Do not restart it or recreate its closed epic. Implementation, verification, integration, and public release are distinct states; see [delivery](workflow/delivery.md).

The [Canvas world zoom and overview implementation record](design/canvas-zoom-world-overview.md) defines the delivered zoom-0–27 camera policy, single-world overview safety, Return behavior, shared Desktop/Web chrome, and its browser qualification contract.

Release notes in [`release-notes/`](release-notes/) describe shipped versions. PDF validation, canvas-performance reports, Web Catalog performance evidence, and the Windows compression benchmark are dated evidence for decisions or release gates. They do not override current agent guides or ADRs. Files under `docs/assets/` and `docs/evidence/` support those records and must not become runtime or test dependencies.

Superseded ADRs remain in place with their status and replacement link. Closed bead metadata remains historical even when it names a prototype or experiment that was intentionally removed after integration.

Two historical records use number `0007`. Refer to them by filename: `0007-design-notebook-user-db-library.md` is the accepted Notebook decision, while `0007-design-report-pdf-renderer.md` is superseded by ADR 0011. Do not renumber either record and invalidate existing links.

## Placement rules

- Update an existing `docs/agent/` guide when code ownership, commands, or recurring implementation constraints change. Delete superseded guidance instead of appending exceptions.
- Record a durable architectural choice in `docs/adr/`; do not use an evidence report as hidden architecture authority.
- Put reproducible current gates beside the code or scripts they validate. Keep large one-time captures and rejected prototypes out of Git once their conclusion is recorded.
- Keep only material that helps implement, verify, release, or maintain the project: contracts, rationale for consequential decisions, ownership, commands, fixtures, and measured limitations. Remove conversational history, expired kickoff prompts, model assignments, and checkout-specific instructions after delivery.
- Link rather than duplicate commands, workflow rules, or numeric constants owned elsewhere. Release notes consumed by tooling and evidence supporting current acceptance limits remain useful; do not delete them merely because they are historical.
- Add a new top-level document only when it serves a distinct development or release task. Link it from this map or the relevant authority so it is discoverable.

## Authority and maintenance

Repository workflow belongs in `AGENTS.md` and linked `docs/workflow/` guides; current subsystem contracts belong in `docs/agent/`; rationale and supersession belong in ADRs; task state and execution receipts belong in bd. `CONTEXT.md` owns vocabulary. Historical evidence never overrides those contracts. Code demonstrates current behavior; a mismatch with an accepted contract is a defect to record, not permission to weaken that contract.

Design records carry a `Status:`, `Tracking:`, and `Current guidance:` header. Status is `proposed`, `active`, `partial`, `completed`, `retired`, or `evidence`. Completion retires execution instructions and links to current guides. Preserve original decisions and measured limitations as history, clearly separated from instructions for new work. ADRs carry `Status:` or existing `status` frontmatter; superseded ADRs name an existing `superseded_by` record. Avoid copying live bead statuses throughout prose.

Run `python3 scripts/check_docs.py` for local Markdown targets, section links, and lifecycle headers. It works offline without bd. During bead closure, reconcile the corresponding design record and current guides; during integration, verify branch ancestry and delivered code separately. `docs/agents/` contains compatibility redirects for installed skills; maintain workflow instructions only under `docs/workflow/`.
