# Documentation map

Start with the narrowest authority for the task.

| Need | Authority |
| --- | --- |
| Repository workflow, quality gates, architecture rules | [`AGENTS.md`](../AGENTS.md) |
| Architecture: principles, authorities, geolocation model, map stack, GeoLibre reuse, editions | [`architecture.md`](architecture.md) |
| Durable decisions and their rationale | [`adr/`](adr/) |
| Domain vocabulary | [`CONTEXT.md`](../CONTEXT.md) |
| Subsystem implementation guidance | [`agent/`](agent/) via the links in `AGENTS.md` |
| Desktop/Web/gallery daily development | [Edition development](agent/edition-development.md) |
| Issue tracking, triage, ownership and delivery | [`workflow/`](workflow/delivery.md), [architecture ownership](workflow/architecture-ownership.md) |
| UI hierarchy and interaction patterns | [`.interface-design/system.md`](../.interface-design/system.md) |
| Release operation | [`release.md`](release.md) and [build and release](agent/build-release.md) |
| Canvas PDF acceptance behaviour | [`canvas-pdf.md`](canvas-pdf.md) |
| Canopi v2 execution steps (deleted at the v2.0 release) | [`v2-plan.md`](v2-plan.md) |

## Historical material

`docs/design/`, `docs/evidence/`, `docs/assets/` and the dated evidence reports at the top of `docs/` describe v1 work. They are not operating contracts and are deleted during the v2 documentation rewrite. Where they disagree with `architecture.md`, an ADR or a guide, the current doc wins. Release notes in [`release-notes/`](release-notes/) describe shipped versions and stay.

## Placement rules

- Current subsystem contracts go in `docs/agent/`; update the guide in the same change as the code. Delete superseded guidance instead of appending exceptions.
- Durable architectural choices go in `docs/adr/` (≤60 lines, `Status:` header). A replaced ADR is deleted or rewritten, not kept as history.
- Task state and execution receipts belong in bd, not in docs.
- Keep only material that helps implement, verify, release or maintain the project. Link rather than duplicate commands or constants owned elsewhere.
- Run `python3 scripts/check_docs.py` for local links, section anchors and lifecycle headers.
