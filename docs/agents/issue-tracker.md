# Issue Tracker

Canopi uses **bd (beads)** for task, bug, feature, epic, chore, and decision tracking.

## Rules

- Create follow-up work with `bd create`; do not use markdown TODO lists as the source of truth.
- Claim implementation work with `bd update <id> --claim` before editing for that bead.
- Use bd types deliberately: `bug`, `feature`, `task`, `epic`, `chore`, or `decision`.
- Use dependencies for real ordering constraints and parents for PRD or epic breakdowns.
- Use `decision` beads for durable scope and rejection memory; search them with `--status all`.
- Use `bd remember` for terse cross-session memory, not full briefs or specifications.
- Keep the durable problem statement or request in the bead `description`.
- Store AFK-ready handoff briefs, fix plans, and implementation guidance in the bead `design` field.
- Store concrete, observable completion checklists in the bead `acceptance` field.
- When batch creation flows cannot express `design`, `acceptance`, or readiness labels directly, backfill those fields immediately.
- Use labels only for workflow hints such as triage readiness; status still comes from bd.
- Close completed work with `bd close <id>` after verification.

Direct `main` work is acceptable only for explicitly requested mainline maintenance, small docs-only updates, or repository administration. Feature, refactor, and bug-fix implementation work should use a scoped branch.

## Useful Commands

```bash
bd ready
bd show <id>
bd update <id> --claim
bd create --title "<title>" --description "<body>" --type=task --priority=2
bd create --graph <path-to-plan-json>
bd search "<concept>" --type decision --status all
bd memories "<keyword>"
bd dep add <issue> <depends-on>
bd close <id>
```

## Session Close

At the end of a coding session, sync both code and beads:

```bash
git pull --rebase
bd dolt push
git push
git status --short --branch
```
