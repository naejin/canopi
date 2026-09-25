# Documentation map

Start with the narrowest authority for the task. Code shows current behaviour; these documents state the intended contracts.

| Need | Authority |
| --- | --- |
| Workflow, quality gates, architecture rules | [`AGENTS.md`](../AGENTS.md) |
| Principles, authorities, geolocation, map stack, GeoLibre reuse, editions | [`architecture.md`](architecture.md) |
| Durable decisions and their rationale | [`adr/`](adr/) |
| Domain vocabulary | [`CONTEXT.md`](../CONTEXT.md) |
| Map canvas, scene runtime, renderer, place search | [Map workspace](guides/map-workspace.md) |
| `.canopi` format, lifecycle, GeoJSON, Design Edit, settings | [Design document](guides/design-document.md) |
| LiDAR Data Library | [Data library](guides/data-library.md) |
| Frontend structure, commands, localization, tests | [Frontend](guides/frontend.md) |
| Desktop, Web and UI gallery development | [Editions](guides/editions.md) |
| Plant DB, search, Web catalog publication | [Species catalog](guides/species-catalog.md) |
| Canvas PDF | [PDF export](guides/pdf-export.md) |
| Native rules, build, release, problem reports | [Native and release](guides/native-and-release.md) |
| bd, triage, branches, delivery, ownership | [`workflow.md`](workflow.md) |
| UI hierarchy and interaction patterns | [`.interface-design/system.md`](../.interface-design/system.md) |
| Shipped versions | [`release-notes/`](release-notes/) |

## Placement rules

- Current subsystem contracts go in `docs/guides/`; update the guide in the same change as the code. Replace or delete superseded text instead of appending exceptions.
- Durable architectural choices go in `docs/adr/` (≤60 lines, `Status:` header). A replaced ADR is rewritten or deleted, not kept as history.
- Task state and execution receipts belong in bd, not in docs. No evidence reports, receipts or dated investigations in the repository.
- Link rather than duplicate commands or constants owned elsewhere.
- Run `python3 scripts/check_docs.py` for local links, section anchors, ADR status, docs placement and line budgets.
