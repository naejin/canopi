# Documentation map

Start with the narrowest authority for the task. Current implementation guidance belongs in `docs/agent/`; historical evidence is useful context, not an operating contract.

| Need | Authority |
| --- | --- |
| Repository workflow, quality gates, architecture rules | [`AGENTS.md`](../AGENTS.md) |
| Domain vocabulary | [`CONTEXT.md`](../CONTEXT.md) |
| Subsystem implementation guidance | [`docs/agent/`](agent/) via the links in `AGENTS.md` |
| Desktop/Web/gallery daily development | [`docs/agent/edition-development.md`](agent/edition-development.md) |
| Agent workflow and issue-tracker conventions | [`docs/agents/`](agents/) |
| UI hierarchy and reusable interaction patterns | [`.interface-design/system.md`](../.interface-design/system.md) |
| Durable architecture decisions and supersession history | [`docs/adr/`](adr/) |
| Release operation | [`docs/release.md`](release.md) and [`docs/agent/build-release.md`](agent/build-release.md) |
| User-facing Canvas PDF behavior | [`docs/canvas-pdf.md`](canvas-pdf.md) |

## Evidence and history

Implementation specifications and completed design records live under `docs/design/`. Proposed work must not override current operating guides before implementation. The [completed Desktop/Web convergence record](design/edition-convergence/handoff.md) points to the delivered [edition development guide](agent/edition-development.md); its implementation history remains in bd epic `canopi-dp4s`.

Release notes in [`release-notes/`](release-notes/) describe shipped versions. PDF validation, canvas-performance reports, Web Catalog performance evidence, and the Windows compression benchmark are dated evidence for decisions or release gates. They do not override current agent guides or ADRs. Files under `docs/assets/` and `docs/evidence/` support those records and must not become runtime or test dependencies.

Superseded ADRs remain in place with their status and replacement link. Closed bead metadata remains historical even when it names a prototype or experiment that was intentionally removed after integration.

Two historical records use number `0007`. Refer to them by filename: `0007-design-notebook-user-db-library.md` is the accepted Notebook decision, while `0007-design-report-pdf-renderer.md` is superseded by ADR 0011. Do not renumber either record and invalidate existing links.

## Placement rules

- Update an existing `docs/agent/` guide when code ownership, commands, or recurring implementation constraints change. Delete superseded guidance instead of appending exceptions.
- Record a durable architectural choice in `docs/adr/`; do not use an evidence report as hidden architecture authority.
- Put reproducible current gates beside the code or scripts they validate. Keep large one-time captures and rejected prototypes out of Git once their conclusion is recorded.
- Keep user instructions separate from implementation guidance. Link rather than duplicate commands or numeric constants owned elsewhere.
- Add a new top-level document only when it has a distinct long-lived audience. Link it from this map or the relevant authority so it is discoverable.
