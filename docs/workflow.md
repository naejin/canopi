# Workflow

How work is tracked, owned, delivered and handed off. The rules themselves are in [`AGENTS.md`](../AGENTS.md); this page holds the mechanics.

## Beads (bd)

bd tracks user-visible work, bugs, epics and decisions; sub-steps of one bead stay in the agent's head. `bd prime` prints the command reference.

```bash
bd ready                                   # dependencies clear
bd show <id>
bd update <id> --claim
bd create --title "<title>" --description "<problem>" --type=task --priority=2
bd dep add <issue> <depends-on>
bd search "<concept>" --type decision --status all
bd close <id> --reason="<what shipped, commits, gates>"
bd export -o .beads/issues.jsonl            # then commit the file
```

- `description` holds the problem, `design` the brief, `acceptance` the observable checklist.
- `--notes` replaces; `--append-notes` adds.
- `decision` beads hold scope and rejection memory; search them before proposing again.
- Bead changes update Dolt, not the tracked snapshot: export and commit `.beads/issues.jsonl` with the change.

### Triage

An open bead carries one readiness label: `needs-triage` (default), `needs-info`, `ready-for-agent` (outcome clear, acceptance observable, blockers as dependencies, no open product or policy decision) or `ready-for-human`. `wontfix` closes it. `in_progress` means claimed, not triaged. Change a label in two calls (remove, then add) and verify.

## Branches and worktrees

- Canopi v2 lives on `feature/geolibre-adoption` until it ships. Maintenance starts from `main` on `feature/`, `fix/`, `refactor/`, `test/` or `docs/` branches.
- Implement in a worktree under `.rq-scratch/`; link `desktop/web/node_modules` and `desktop/web/public/pdf-fonts` from the integration worktree instead of installing again.
- All worktrees share `CARGO_TARGET_DIR=…/.rq-scratch/shared-build/target`. Run `cargo clean -p common-types` there when a test binary seems to carry an older format version.
- Remove a worktree and its caches (Chrome profiles, Vite caches under `/tmp/canopi-*`) once its branch is integrated. Check `df -h /` before parallel builds.

## Ownership

- The **user** decides direction, priority, product behaviour, scope and consequential risk, and owns data decisions (the plant catalog is never changed).
- The **main agent** owns interfaces and IPC, persistence and formats, authorities and resource ownership, dependency direction, security boundaries and cross-edition behaviour. It writes the briefs, integrates, runs the gates, closes beads and pushes.
- **Implementation agents** implement a brief within named files, choose internal details, write the tests, and stop and report when a local choice would change a contract. No two agents edit the same file; in locale files each adds only its own keys.
- A brief names the outcome, the files owned, the fixed decisions, the gates, and the stop conditions.

## Delivery

| State | Evidence |
| --- | --- |
| Implemented | The behaviour exists in named commits. |
| Verified | The gates passed on the delivered tree; limits are recorded. |
| Integrated | The commits are ancestors of the integration branch. |
| Released | A separately authorised release was published ([native and release](guides/native-and-release.md#release-workflow)). |

- Before integrating, rebase onto the integration branch, resolve conflicts keeping both sides' intent, rerun the gates, then push. Coverage floors keep the higher value.
- Verify in the running app when the change is visible: `cargo tauri dev -f mcp-bridge` from the integration worktree with a separate `XDG_*` profile and a scratch copy of a Design.
- Session close: `git pull --rebase=merges`, `bd dolt push`, `git push`, `git status --short --branch`. The final message gives the bead id, commit, branch, gates run or skipped, user-owned files untouched, and what to try.

## Documents

- [`docs/README.md`](README.md) maps every document to the question it answers and states the writing rules.
- When code and an accepted guide or ADR disagree, file a bead; never quietly weaken the contract.
- Run `python3 scripts/check_docs.py` after any docs change.
