# Docs Maintenance

Use this when updating documentation in this repo.

## Goal

Keep one active source of truth per topic and avoid rereading or rewriting the whole docs tree.

## Before Editing

1. Identify the doc category first:
   - active and deferred work: `docs/todo.md`
   - architecture rationale: `docs/code-quality-architecture-review-2026-04-05.md`
   - release operations: `docs/release-operations.md`
   - release verification: `docs/release-verification.md`
   - historical roadmap: `docs/roadmap.md`
   - product scope lock: `docs/product-definition.md`
   - subsystem guidance: `docs/renderer/`, `docs/db/`
   - history only: `docs/archive/`
2. Search for the exact topic with `rg` before opening more files.
3. Open the smallest set of files that could own the change.

## Editing Rules

- Update the most operational document first.
- If the same fact exists in multiple active docs, keep one canonical statement and turn the others into links or short pointers.
- Do not copy full explanations from one doc to another unless that doc is the new owner of the topic.
- Archive obsolete guidance instead of leaving it in active docs.
- Prefer cross-links over repetition.

## Efficient Agent Workflow

- Read `docs/README.md` first to find the right entry point.
- Read `docs/agents.md` next for the minimal agent path.
- Read only the files named by that path.
- If a task touches one subsystem, do not open unrelated docs.
- If a task touches release flow, read release docs plus any referenced source files, not the whole archive.

## When To Update Indexes

Update `docs/README.md` or `docs/agents.md` when:

- a new active doc is added
- a doc moves between active, subsystem, or archive areas
- the recommended read order changes
- a recurring duplication is removed and the new canonical source should be obvious

## When To Archive

Move or summarize material into `docs/archive/` when:

- it is historical phase guidance
- it is a completed review artifact
- it describes a retired workflow or obsolete status
- it no longer belongs in the active read path
