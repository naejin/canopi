# Agentic delivery

How agents run Canopi work with the user-level `phased-agentic-delivery` skill, whose loop and procedure apply as written. This page holds only Canopi's places, commands, triggers and measured costs; the rules and their reasons are in [`AGENTS.md`](../../AGENTS.md).

## Places

Paths are relative to `/home/daylon/projects/canopi`; use them absolute in commands, since agents work from `.rq-scratch/canvas-v2`.

- **User's checkout** `/home/daylon/projects/canopi`: read-only for agents. The user runs `cargo tauri dev` there; never pull, commit, stage, stash or push in it, and never touch its `target/` without asking.
- **Integration worktree** `.rq-scratch/canvas-v2`, branch `canvas-v2/integration`, tracking `origin/feature/geolibre-adoption`. Before a step: `git fetch`, then `git rebase --rebase-merges origin/feature/geolibre-adoption` if behind. Push once per step, after its pre-push review: `git push origin HEAD:feature/geolibre-adoption` (GitHub and Codeberg). One agent at a time works there.
- **Stream worktrees**: `.rq-scratch/tools/mkwt.sh <stream> [base]` makes `.rq-scratch/canvas-v2-<stream>` on `canvas-v2/<stream>` with `npm ci` (installs the pre-commit hook), the PDF fonts and a copy of the plant catalog DB.
- **Shared build cache**: `CARGO_TARGET_DIR=/home/daylon/projects/canopi/.rq-scratch/shared-build/target` exported in every worktree shell, also for npm scripts that call cargo (`npm run gen:types`); the last component must be `target`, or Tauri reads resources from the installed app; without it a worktree grows its own `target/`.
- **Scratch**: gate logs in `.rq-scratch/gate-logs/`, screenshots in `.rq-scratch/screenshots/<step>/` (kept), review profiles in `.rq-scratch/reference/<step>/` (removed at the step's close). Run `df -h /` before launching agents; clean up below about 50 GB free: remove merged worktrees and their caches (`/tmp/canopi-*`, headless browser profiles), keep screenshots.

## Gates

- **Affected**, after a build or fix agent's last commit: `BASE=<branch it builds on> .rq-scratch/tools/quiet-gates.sh <worktree> affected`: tsc, `check:ui`, `vitest related` on the changed files and the policy tests; from canopi-f47t.52's commit 0 (before its streams) always every source-text policy test (lr-z's `scene-runtime-boundaries` failure passed a selection that skipped it), the locale tests and the stream's own Playwright specs in Chromium and WebKit. **Quick** (the whole suite) is for a worktree with no base.
- **Gate lines** count only from a run started after the last commit; the shell is zsh with noclobber, so overwrite a log with `>|`.
- **Slots**: build agents per `free -g` available, one per 6 GiB above a 4 GiB reserve, at most 4 (8 CPUs), re-checked as each slot is taken; under 8 GiB, `VITEST_WORKERS=2`.
- **Ownership** (built in canopi-f47t.52's commit 0, before its streams): `.rq-scratch/tools/<step>-owners.tsv` (path, stream) from the amendment commit; a stream's gate fails a diff outside its rows, and the plan check fails a needed file nobody owns. Known reds go in `<step>-expected-fail.tsv` (owner, bead), empty before push.
- **Full**, at each merge and before a push: `.rq-scratch/tools/quiet-gates.sh <worktree> full`, the Frontend row of `AGENTS.md` (tsc, coverage as the suite, the policy tests, check:ui, both builds, docs). Add the Rust and shared-contract rows of `AGENTS.md` when those areas change.
- **Web check** on any merge touching the renderer, camera, input or map: `cd desktop/web && npm run build:web`, then from the worktree root `docker run --rm --ipc=host -v "$PWD":/work -w /work/desktop/web --user $(id -u):$(id -g) -e HOME=/tmp mcr.microsoft.com/playwright:v1.63.0-noble npx playwright test e2e/canvas --reporter=line`.
- **CI**: `Build & Test` and `Web Edition browsers` on every push; a push whose changes since the branch's last successful push run touch only `docs/`, `.beads/`, `.interface-design/` or Markdown runs only the `docs` job and skips the browsers; a newer push cancels the branch's older run (main always finishes), so check the newest commit's: `gh run list --branch feature/geolibre-adoption --event push`, then poll `gh run view <id> --json status,conclusion`.
- **CI jobs**: `docs` always; `lint` on code; on a v2 push the Rust jobs (`lint-rust`, `test-rust`, `lidar-native`, `platform-tests`) and packaging run only when a Rust-side path changed, and `test-frontend` when that or `desktop/web/` changed; the path filter in `.github/workflows/build.yml` is the list. Main, PRs and an unknown base run all. Rust caches are saved only from pushes to main and the v2 branch.
- **PRs**: a same-repo PR from main or the v2 branch runs neither workflow; the push run's checks on its head commit show on the PR, so nothing tests v2 merged with main before the merge lands: merge main into v2 and push first.
- **Packaging targets**: a v2 push packages Linux `.deb` and macOS arm, and adds Windows NSIS and Intel macOS (with their sidecar smoke and Common Controls check) when it changes a packaging input (the filter in `build.yml`). Main, other same-repo PRs and Release Candidate package all four in every format; fork PRs package nothing.

## Design check

A planned cut or behaviour whose design-check entry says users notice nothing names the screen surfaces it touches (ghosts and previews, Esc layers, field sizes, menus, focus) and gets a live-check scenario; a planned interaction is checked against what that screen draws; an entry that says "no code" names, for each pointer kind or input it covers, the existing path that already delivers it.

Each stream's first commit probes its riskiest platform assumption in WebKitGTK and Chromium (phase R's untested font assumption cost four fix rounds).

A colour offered in a question carries its contrast on every surface it is drawn on (light and dark map, PDF paper, grayscale print) beside its colour-vision distance: the polish batch's no-stratum grey was chosen on distance alone, printed at 2.25:1 and cost a held review round (U48).

Commit 0 writes each user path's Playwright test (Layers' g3, g5) failing, naming its owner stream and every file its pass needs: in Layers all 7 merge-time gallery failures and 9 of 10 stream holds traced to files no stream owned.

## Review lenses

A stream gets a second round when it changes a seam the tests fake (renderer, map, input) or stored data, or after a round-one blocker or major. It reads the fix commits and the files they touched, with the hold list (Layers' full round 2: 134M for 1 new major).

Known seams that streams share, each reviewed once after the streams on both sides merge: the scene render target (`scene-runtime/render-scheduler.ts`, `maplibre/shared-scene-layer.ts`, `maplibre/shared-scene-renderer.ts`, `app/canvas-map-surface/workspace-activation.ts`), whose create, dispose and Design-switch orders reached phase R's pre-push review twice.

Each stream's lens names the resources its code spends (disk space, memory, the executor lane, worker time) and the numerical assumptions it rests on (scale factors, tolerances, units), besides its inputs and states (U-crs stream B passed two rounds with a too-small free-space check and a scale-blind zoom).

## Stored data within a step

A stored-format version (the LiDAR catalogue, the user DB, `.canopi`) bumps once per push: a later change in the same unpushed work reuses that bump and adds no test for a version that never shipped (U-crs once bumped the catalogue three times in one step).

## Live check

- A scenario the Web build can show (labels, colours, panels, menus) is a Playwright test or a gallery entry; the native instance covers only native paths (file dialogs, LiDAR import, PDF save, WebKitGTK fit). Layers' native check (3 % of input) found 3 failures nothing else had.
- No Windows, Mac or phone hand check gates a step or the release; one not run is recorded as untested with its risk (U20, U41).
- Launch once, then drive each scenario group with a fresh agent against the same instance; assert with `webview_execute_js` values, save screenshots to `.rq-scratch/screenshots/<step>/` and open them only to judge visuals (phase R's one long agent used 30 % of its input).
- Frame times are evidence only from a production build (`cargo tauri build`) or the Web build traced in Playwright: the DEV build freezes every Scene write and the bridge's frame loop runs near 30 Hz.
- The bridge works only in debug-profile builds (`desktop/build.rs` grants its capability only then). The only button labelled "Close" is the window's: it quits the app (canopi-pj62); close panels with their rail button.
- From a detached worktree nobody edits: `git -C /home/daylon/projects/canopi worktree add --detach /home/daylon/projects/canopi/.rq-scratch/canvas-v2-live <commit>` (with `npm ci`, the fonts and the catalog copy), removed afterwards.
- Profile `R=/home/daylon/projects/canopi/.rq-scratch/reference/<step>`, then `mkdir -p $R/{config,data,cache}` (XDG ignores relative values and would fall back to the user's profile); copy the read-only master `.rq-scratch/reference/orchard.canopi` into it (never open the master or the user's files) and turn the basemap off once.
- First check `ss -ltnp | grep -E ':(1420|1431|922[0-9])'`: the user's own app usually holds 1420 and 9223; leave it running and never drive it. If 1431 is held by anything but your own earlier review instance, stop and ask.
- Launch from the worktree's `desktop/` with its own identifier (`com.canopi.review`) and Vite port 1431, because Canopi runs one instance at a time and the single-instance plugin would otherwise hand off to the user's app: `XDG_CONFIG_HOME=$R/config XDG_DATA_HOME=$R/data XDG_CACHE_HOME=$R/cache cargo tauri dev -f mcp-bridge --config '{"identifier":"com.canopi.review","build":{"devUrl":"http://localhost:1431","beforeDevCommand":{"script":"npx vite --port 1431 --strictPort","cwd":"web"}}}'`.
- Before driving, check with `ss -ltnp` and `/proc/<pid>/exe` that the bridge port (9223 or the next free one) belongs to that process. Drive with the Tauri MCP tools; drags and wheels are dispatched DOM events (`/home/daylon/projects/canopi/.rq-scratch/screenshots/phase-0/drag-helper.js`), native file dialogs `x11-dialog.py`. Record which host drove each step. Stop processes by PID, never `pkill -f`.

## Tracker

Beads ([commands](../workflow.md)); read with `bd dep tree <id>` and `bd list --parent <id>` too. The main agent alone writes (`bd update <id> --claim --acceptance "…"`, `bd note`, `bd create … --deps discovered-from:<id>`, `bd close`), then `bd export -o .beads/issues.jsonl` in the integration worktree and commits it.

## Models

Opus at high effort for design checks, complex code, bug reviews, verification and fixes; Opus at medium effort for mechanical work and plan-conformance checks; Sonnet only for trivial checks; no other model. Weekly usage limits are not a reason to slow work; keep the efficiency habits.

## Tools

In `.rq-scratch/tools/`: `mkwt.sh`, `quiet-gates.sh`, `journal.py <run-id> [--full LABEL]` (a run's results by label), `wf-usage.py <run-id>...` (measured cost per stage from the transcripts, for receipts), `imgdiff.py` (pixel diff), `x11-dialog.py`, and `layers-build-results/` (one result file per stage run).

## Workflows and measured cost

One workflow per stage, from the skill's `workflow-step.js`; never resume after a parallel stage: Layers' two resumes cost 326M tokens (13.8 % of 2.36B), 458 agent-minutes and 3.9 h.

When a usage limit stops agents, schedule no check-in to resume them: the user types "Resume". Never stop a running workflow on your own initiative; the user decides.

Layers by stage: design check 19 %, commit 0 15 %, builds 16 %, reviews and verifiers 9 %, pre-push 3 % (3 findings nothing else caught). The release architecture review cost about 41M for 46 findings, 6 of them live or latent bugs; once the target ADR lands it becomes a metrics script plus targeted reading.
