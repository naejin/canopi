# Agent Guide

Use this as the default entry point when coding with agents in this repo.

Token rule: search first, then read only the smallest set of owning docs needed to answer the task. Do not open `docs/archive/` unless the task explicitly needs history.

## Read Order

1. [`Docs Index`](./README.md)
2. [`Docs Maintenance`](./maintenance.md) when you are updating docs or changing the read path
3. [`Rewrite Operational Reference`](./todo.md) for active rewrite work
4. [`Release Verification`](./release-verification.md) and [`Release Operations`](./release-operations.md) when the task touches release or packaging
5. [`Renderer`](./renderer/README.md) for canvas or retained-surface work
6. [`Database`](./db/README.md) for schema, search, or DB pipeline work
7. [`Archive`](./archive/README.md) only when you need historical context

## Canonical Sources

- `docs/todo.md` is the active rewrite and blocker reference
- `docs/release-verification.md` is the signed-off beta verification record
- `docs/release-operations.md` is the operator runbook for DB publishing, release candidates, and promotion
- `docs/renderer/renderer.md` is the renderer-specific validation checklist
- `docs/db/README.md` points to the current database guidance and archived review notes
- `docs/maintenance.md` explains how to update docs efficiently without rereading the archive

## What To Ignore First

- archived phase notes unless the task explicitly needs history
- review artifacts unless you are checking how a previous decision was made
- roadmap detail that is already superseded by `docs/todo.md` or the release docs

## Rules Of Thumb

- Prefer one active source of truth per topic.
- If a document says it is historical or archived, do not treat it as current implementation guidance.
- If the same fact appears in multiple active docs, keep the most operational one and make the others point at it.
- When editing docs, search first, open only the owning files, and update the index or agent guide if the read path changes.
