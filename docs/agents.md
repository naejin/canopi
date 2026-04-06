# Agent Guide

Use this as the default entry point when coding with agents in this repo.

Token rule: search first, then read only the smallest set of owning docs needed to answer the task. Do not open `docs/archive/` unless the task explicitly needs history.

## Read Order

1. [`Docs Index`](./README.md)
2. [`Active Work Tracker`](./todo.md) for current and deferred work
3. [`Architecture Review`](./code-quality-architecture-review-2026-04-05.md) for architectural rationale and tradeoffs
4. [`Release Verification`](./release-verification.md) and [`Release Operations`](./release-operations.md) when the task touches release or packaging
5. [`Renderer`](./renderer/README.md) for canvas or retained-surface work
6. [`Database`](./db/README.md) for schema, search, or DB pipeline work
7. [`Docs Maintenance`](./maintenance.md) when you are updating docs or changing the read path
8. [`Archive`](./archive/README.md) only when you need historical context

## Canonical Sources

- `docs/todo.md` — active and deferred work tracker
- `docs/code-quality-architecture-review-2026-04-05.md` — architecture review with rationale
- `docs/product-definition.md` — product scope lock
- `docs/release-verification.md` — signed-off beta verification record
- `docs/release-operations.md` — operator runbook for DB publishing, RC, promotion
- `docs/renderer/renderer.md` — renderer-specific validation checklist
- `docs/db/README.md` — database guidance and data quality audits
- `docs/maintenance.md` — how to update docs without rereading the archive
- `docs/archive/roadmap.md` — historical roadmap (reference for deferred QA/DC/SG phase details)

## What To Ignore First

- archived phase notes unless the task explicitly needs history
- review artifacts unless you are checking how a previous decision was made
- the roadmap is archived — actionable items have been extracted into `docs/todo.md`

## Rules Of Thumb

- Prefer one active source of truth per topic.
- If a document says it is historical or archived, do not treat it as current implementation guidance.
- If the same fact appears in multiple active docs, keep the most operational one and make the others point at it.
- When editing docs, search first, open only the owning files, and update the index or agent guide if the read path changes.
