# Workflow

How work is tracked, triaged, owned, delivered and documented in Canopi. The repository-wide rules (priorities, gates, handoff checklist) are in [`AGENTS.md`](../AGENTS.md). This page expands them.

## Branches

- **All Canopi v2 work is on `feature/geolibre-adoption`.** Commit every v2 bead there. Do not open a branch per bead. Pull with `git pull --rebase=merges` before starting and push after each bead.
- Non-v2 maintenance starts from `main` on a branch named by intent: `feature/`, `fix/`, `refactor/`, `test/` or `docs/`. Commit directly to `main` only for explicitly requested mainline maintenance, small docs-only updates or repository administration.
- Prefer a separate git worktree for implementation so the user's `cargo tauri dev` checkout is not disturbed, then ask the user to pull. Keep one Cargo target directory per worktree.
- Preserve user work. Run `git status --short --branch` before editing and treat pre-existing dirty or untracked files as user-owned. Never stage, revert or stash them. Never run `reset --hard` or `checkout -- <file>` unless the user asks.
- Commit messages follow the existing style (`fix(frontend): ...`, `refactor(backend): ...`, `docs: ...`). Stage only the files you changed. Generated files go in the commit that produced them.

## Issue tracking with bd

Canopi tracks all tasks, bugs, features, epics, chores and decisions in **bd (beads)**. Markdown TODO lists are never the source of truth. `bd prime` prints the command reference.

```bash
bd ready                                   # dependencies clear (not the same as well-specified)
bd show <id>
bd update <id> --claim                     # before editing for a bead
bd create --title "<title>" --description "<body>" --type=task --priority=2
bd create --graph <plan.json>
bd dep add <issue> <depends-on>
bd search "<concept>" --type decision --status all
bd memories "<keyword>"
bd remember "<terse durable fact>"
bd close <id> --reason="<what shipped, commits, tests>"
bd export -o .beads/issues.jsonl
```

- Types: `bug`, `feature`, `task`, `epic`, `chore`, `decision`. Use dependencies for real ordering and parents for epic breakdowns.
- Fields: the durable problem statement goes in `description`, the implementation brief or fix plan in `design`, and the observable completion checklist in `acceptance`. Backfill these immediately when batch creation cannot set them.
- `bd update <id> --notes` **replaces** the notes field. Use `--append-notes` for progress checkpoints.
- `bd remember` holds terse cross-session knowledge, not specifications. `decision` beads hold durable scope and rejection memory.
- Keep to the claimed bead's scope. File follow-up beads for new work instead of expanding the assignment.
- Bead mutations update Dolt, not the tracked `.beads/issues.jsonl`. After the final bead updates, export and commit the intended records with the implementation commit. If the snapshot has unrelated user changes, export to a temporary file and reconcile only your records. Avoid separate claim-only or close-only commits.
- A gate that cannot run is recorded in the bead and in the handoff with the exact command, the reason and the residual risk.

## Triage

Every triaged bead has one bd `type` (category) and exactly one readiness label (state). Resolve conflicting labels first.

| State | bd representation | Meaning |
| --- | --- | --- |
| `needs-triage` | `status=open`, label | A maintainer must evaluate it. Unlabeled open beads start here. |
| `needs-info` | `status=open`, label | Waiting on an answer. Returns to `needs-triage` once the answer arrives. |
| `ready-for-agent` | `status=open`, label | Fully specified and safe for an unattended agent. |
| `ready-for-human` | `status=open`, label | Needs human judgment, access or manual validation. |
| `wontfix` | `status=closed`, optional label | Will not be actioned. |

- `in_progress` means claimed, never a triage state. Unstarted backlog stays open and unassigned.
- Apply an open role in two calls, because removing and adding the same label in one `bd update` can drop it. Verify the result:

```bash
bd update <id> --status open --remove-label needs-triage --remove-label needs-info --remove-label ready-for-agent --remove-label ready-for-human --remove-label wontfix
bd update <id> --add-label <role>
```

- `ready-for-agent` checklist: the outcome is clear, acceptance is observable, blockers are represented as dependencies, no product, design, access or policy decision is unresolved, and test expectations are stated at the behaviour level. The brief goes in `design` and the checklist in `acceptance`.
- Rejection memory: search for an existing `decision` bead (`bd search ... --type decision --status all`, `bd memories`). Reuse or create one, then close the rejected enhancement with a reason.

## Architecture ownership

- The **user** decides direction, priority, product behaviour, scope and consequential risk.
- The **main agent** owns architectural coherence: interfaces and IPC, persistence and schema, authoritative state and resource ownership, cross-module lifecycle and concurrency, dependency direction, runtime dependencies, security and privacy boundaries, and cross-edition behaviour. It settles those before implementation, reviews the result against them, and owns integration, gates, beads and push.
- **Implementation agents or subagents** implement an authorized handoff, choose routine internal details (naming, private helpers, algorithms within fixed limits, test organization), keep tests and guides current, and deliver reproducible evidence. They do not invent missing cross-subsystem contracts or weaken acceptance. If a local choice turns out to change a contract, stop that part and escalate with evidence.
- Subagents are allowed without asking for exploration, verification and disjoint implementation slices. Each implementation subagent gets explicit file ownership. No two agents edit the same file, and none reverts another's changes.
- An architecture-sensitive handoff names the outcome, inspected revision and scope, the fixed decisions (owners, lifecycle, failures, how old data is refused, set aside or deleted), the delegated choices, the evidence and gates required, and the stop conditions. Before prescribing new machinery, it includes a short necessity check: the capability unlocked, the existing or GeoLibre solution inspected, and why it cannot serve unchanged.
- Review is proportional to risk and ends in one disposition: accepted for a named scope, partial with named blockers, or insufficient evidence with the missing proof named. New requirements are not retroactive blockers.
- When code and an accepted contract disagree, track the discrepancy in bd. Never quietly weaken the contract to match the code.

## Delivery

| State | Evidence |
| --- | --- |
| Implemented | The behaviour exists in named commits. |
| Verified | Required gates passed on the delivered tree, and limitations are recorded. |
| Integrated | The commits are ancestors of the integration branch (`feature/geolibre-adoption` for v2, otherwise `main`). |
| Released | A separately authorized public release was published (see [native and release](guides/native-and-release.md#release-workflow)). |

- Closing a verified bead does not mean integrated or released. The receipt names the commits, the branch and any pending integration.
- Before integration, fetch, inspect every worktree's dirty state, confirm accepted branch tips are kept, and rerun gates affected by the rebase. Prefer fast-forward. Delete only explicitly inventoried topic branches whose tips are ancestors of the integrated commit.
- Performance optimization waits for real user reports. Integrity, cancellation and bounded-resource requirements always apply.
- Session close: reconcile guides, export beads, then:

```bash
git pull --rebase=merges
bd dolt push
git push
git status --short --branch
```

The final message gives the bead id, commit hash, branch pushed, tests run or skipped, the user-owned files left untouched, and what to try in `cargo tauri dev`.

## Domain docs

- `CONTEXT.md` is the product glossary. Read the relevant terms before writing, and use them in bead titles and proposals. Update it only when a term or ambiguity is resolved.
- [`docs/architecture.md`](architecture.md) is the lasting architecture. `docs/guides/` holds subsystem operating contracts:
  - [map workspace](guides/map-workspace.md)
  - [design document](guides/design-document.md)
  - [data library](guides/data-library.md)
  - [frontend](guides/frontend.md)
  - [editions](guides/editions.md)
  - [species catalog](guides/species-catalog.md)
  - [PDF export](guides/pdf-export.md)
  - [native and release](guides/native-and-release.md)
- Update the affected guide, the architecture page and `AGENTS.md` in the same change that moves code, commands, gates or boundaries. Replace or delete stale text instead of adding exceptions. One-off bug notes belong in a test or a code comment.
- [ADRs](adr/) record decisions that are hard to reverse, surprising without context and the result of a real trade-off. Each is at most 60 lines with a `Status:` header. A changed decision rewrites or deletes its ADR, which is not kept as history.
- Task state, receipts and evidence live in bd, not in docs. Run `python3 scripts/check_docs.py` after every docs change.
