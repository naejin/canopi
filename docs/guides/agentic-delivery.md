# Agentic delivery

How agents run Canopi work with the user-level `phased-agentic-delivery` skill: its loop (design check, one question batch, amendment, streams, verified reviews, serial merges, live and Web checks, pre-push review, receipt and retrospective) applies as written. This page holds only Canopi's places and commands; the rules and their reasons are in [`AGENTS.md`](../../AGENTS.md), and the work in progress is in the plan's session brief ([`plans/canvas-v2-implementation-prompt.md`](../plans/canvas-v2-implementation-prompt.md) until 2.0 ships).

## Places

Paths are relative to `/home/daylon/projects/canopi`; use them absolute in commands, since agents work from `.rq-scratch/canvas-v2`.

- **User's checkout** `/home/daylon/projects/canopi`: read-only for agents. The user runs `cargo tauri dev` there; never pull, commit, stage, stash or push in it, and never touch its `target/` without asking.
- **Integration worktree** `.rq-scratch/canvas-v2`, branch `canvas-v2/integration`, tracking `origin/feature/geolibre-adoption`. Before a step: `git fetch`, then `git rebase --rebase-merges origin/feature/geolibre-adoption` if behind. Push with `git push origin HEAD:feature/geolibre-adoption` (GitHub and Codeberg). One agent at a time works there.
- **Stream worktrees**: `/home/daylon/projects/canopi/.rq-scratch/tools/mkwt.sh <stream> [base]` makes `.rq-scratch/canvas-v2-<stream>` on `canvas-v2/<stream>` with `npm ci` (installs the pre-commit hook), the PDF fonts and a copy of the plant catalog DB.
- **Shared build cache**: `CARGO_TARGET_DIR=/home/daylon/projects/canopi/.rq-scratch/shared-build/target` exported in every worktree shell (the last component must be `target`), including for npm scripts that call cargo, such as `npm run gen:types`; without it a worktree grows its own `target/`.
- **Scratch**: gate logs in `.rq-scratch/gate-logs/`, screenshots in `.rq-scratch/screenshots/<step>/` (kept), review profiles in `.rq-scratch/reference/<step>/` (removed at the step's close). Run `df -h /` before launching agents; clean up below about 50 GB free.

## Gates

- **Quick**, after each stream commit: `/home/daylon/projects/canopi/.rq-scratch/tools/quiet-gates.sh <worktree> quick` (tsc, vitest).
- **Full**, at each merge and before a push: `/home/daylon/projects/canopi/.rq-scratch/tools/quiet-gates.sh <worktree> full`, the Frontend row of `AGENTS.md` (tsc, coverage as the suite, the policy tests, check:ui, both builds, docs). Add the Rust and shared-contract rows of `AGENTS.md` when those areas change.
- **Web check** on any merge touching the renderer, camera, input or map: `cd desktop/web && npm run build:web`, then from the worktree root `docker run --rm --ipc=host -v "$PWD":/work -w /work/desktop/web --user $(id -u):$(id -g) -e HOME=/tmp mcr.microsoft.com/playwright:v1.63.0-noble npx playwright test e2e/canvas --reporter=line`.
- **CI**: `Build & Test` and `Web Edition browsers` on every push; `gh run list --branch feature/geolibre-adoption --event push`, then poll `gh run view <id> --json status,conclusion`.

## Live check

- From a detached worktree nobody edits: `git -C /home/daylon/projects/canopi worktree add --detach /home/daylon/projects/canopi/.rq-scratch/canvas-v2-live <commit>` (with `npm ci`, the fonts and the catalog copy), removed afterwards.
- Profile `R=/home/daylon/projects/canopi/.rq-scratch/reference/<step>`, then `mkdir -p $R/{config,data,cache}` (XDG ignores relative values and would fall back to the user's profile); copy the read-only master `/home/daylon/projects/canopi/.rq-scratch/reference/orchard.canopi` into it (never open the master or the user's files) and turn the basemap off once.
- First check `ss -ltnp | grep -E ':(1420|1431|922[0-9])'`; if 1431 is held by something else, stop and ask (plan 3.1 steps 1 and 3).
- Launch from the worktree's `desktop/` with its own identifier (`com.canopi.review`) and Vite port 1431, because Canopi runs one instance at a time and the single-instance plugin would otherwise hand off to the user's app: `XDG_CONFIG_HOME=$R/config XDG_DATA_HOME=$R/data XDG_CACHE_HOME=$R/cache cargo tauri dev -f mcp-bridge --config '{"identifier":"com.canopi.review","build":{"devUrl":"http://localhost:1431","beforeDevCommand":{"script":"npx vite --port 1431 --strictPort","cwd":"web"}}}'`.
- Before driving, check with `ss -ltnp` and `/proc/<pid>/exe` that the bridge port (9223 or the next free one) belongs to that process. Drive with the Tauri MCP tools; drags and wheels are dispatched DOM events (`/home/daylon/projects/canopi/.rq-scratch/screenshots/phase-0/drag-helper.js`), native file dialogs `x11-dialog.py`. Record which host drove each step. Stop processes by PID, never `pkill -f`.

## Tracker

Beads (`bd prime`). Read: `bd show`, `bd ready`, `bd dep tree <id>`, `bd list --parent <id>`. The main agent alone writes (`bd update <id> --claim --acceptance "…"`, `bd note`, `bd create … --parent … --deps discovered-from:<id>`, `bd close <id> --reason "<receipt>"`), then `bd export -o .beads/issues.jsonl` in the integration worktree and commits it.

## Models

Opus at high effort for design checks, complex code, reviews, verification and fixes; Opus at medium effort for mechanical work; Sonnet only for trivial checks; no other model. Weekly usage limits are not a reason to slow work; keep the efficiency habits.

## Tools

In `.rq-scratch/tools/`: `mkwt.sh`, `quiet-gates.sh`, `journal.py <run-id> [--full LABEL]` (summarise a workflow journal), `imgdiff.py` (pixel diff), `x11-dialog.py`, and `wf-1.js` (phase 1's workflow: build cap, serial merges, verified reviews).
