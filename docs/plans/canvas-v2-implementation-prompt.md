Status: agreed (2026-09-29); scope amended 2026-10-01 (one release; plan §1, "Decisions of 2026-10-01"); phase 0 and phase F done (2026-10-02); phase 1 done (2026-10-03); 2.0 bug fixes next; completed for a new session 2026-10-02; deleted with the plan at the release close

# Canvas v2: implementation prompt

Trimmed 2026-10-02 at the phase-F close; the text before it is at commit 7f3baadd, the full planning text at 76bd08a659d916069a340fc06e670e54e32f54c7.

You are the main agent implementing Canopi's canvas v2 in the integration worktree. Phases 0, F and 1 are done (section 4). This prompt covers what remains: the 2.0 bug fixes, 2, 3, R and the release close, then the hand-over to the release. A new session starts at section 15. Read it to the end before you touch anything. Paths in backticks are relative to the repository root unless they start with `canvas/`, `app/`, `components/`, `maplibre/`, `web/`, `shortcuts/`, `commands/`, `platform/`, `generated/`, `i18n/` or `__tests__/`, which are under `desktop/web/src/` (the plan's rows use the same base, so rows copied from it keep their meaning). `scene/` is short for `desktop/web/src/canvas/runtime/scene/`. `view/`, `input/`, `tools/`, `renderers/`, `chrome/`, `scene-runtime/` and `interaction/` are short for `desktop/web/src/canvas/runtime/<dir>/`; bare `key-chord`, `keymap`, `escape-chain`, `arming`, `focus-owner` and `key-router` modules and tests are under `desktop/web/src/app/keyboard/`.

## 1. Why this matters

Canopi's canvas was north-up and its controls contradicted each other: left-drag panned in some modes and selected in others, right-drag opened the menu at press on Linux and macOS, Shift+drag meant different things per tool, and a dozen modules each derived their own world-to-screen transform, listened to raw input and moved focus on their own. Users compare Canopi with GeoLibre, where the map turns. The user asked for rotation like GeoLibre and for the controls, rotation and the view, input and tool architecture to be designed together, without letting existing shortcuts hold the design back.

The design is finished and agreed. Your job is to build it phase by phase, keeping every step green, and to stop and amend the design (section 9) rather than bend the code when it proves wrong.

## 2. What exists and the read order

Read in this order before starting:

1. `AGENTS.md`: the operating contract. It overrides anything here that conflicts, except where this prompt names a rule the user already changed.
2. `docs/plans/canvas-v2-plan.md`: phase order, file ownership per phase, entry and exit, named tests, live and Web checks, docs per phase, beads (section 7) and what the user hears at each handoff (section 8). This is your working document.
3. `docs/adr/0015-rotating-map-and-canvas-controls.md`: the product decisions (rotation and controls). Then ADRs 0016 (one view transform), 0017 (input pipeline and gestures), 0018 (narrow tool interface), 0019 (rendering and the view transform), 0020 (focus and keyboard ownership). Each lists the alternatives rejected.
4. `docs/plans/canvas-v2-spec.md`: typed interfaces (section 1), gesture vocabulary (2), binding tables (3), rotation behaviour (4), synthetic event-sequence fixtures A–J (5), pitch readiness (6), out of scope (7), stored data (8), user-facing strings per phase (9). Read the sections your phase uses; the module tables (1.8, 1.9) say what still moves.
5. `docs/plans/canvas-v2-inventory.md`: every north-up, axis-aligned and entangled site today, with a stable ID (`INV-CAM`, `INV-XF`, `INV-TOOL`, `INV-REN`, `INV-ENT`, `INV-LSN`, `INV-WR`, `INV-KEY`, `INV-FOC`, `INV-DATA`, `INV-DOC`, `INV-TEST`) and the phase that clears it. A phase does not close with one of its rows open unless the inventory re-homes it.
6. The durable documents already rewritten to the target by the planning change: `docs/guides/map-workspace.md`, `docs/guides/frontend.md`, `docs/architecture.md`, `.interface-design/system.md`, `.interface-design/patterns/canvas-navigation.md`, `canvas-workspace.md`, `controls-and-shell.md`, and the boards under `.interface-design/boards/`. Where a rule is not built yet, the guide names the module that holds the role today. The release close checks them against the code once (plan section 6); no phase rewrites them.

Point agents at these files instead of restating them. Do not duplicate the spec in beads, commit messages or briefs; cite the section. One exception: you note spec section 6's last paragraph (the pitch recipe) on canopi-f47t.11 ("Pitch and 3D view"; plan section 4, "Later: pitch"), because pitch would be built after the spec is gone.

## 3. Decisions that must not be reopened

The user made these decisions on 2026-09-29. They are recorded in ADR 0015 with their reasons. Build them; do not ask again and do not offer alternatives unless building proves one impossible (then section 9 applies).

- The map rotates (bearing), like GeoLibre. Editing stays top-down; pitch, 3D and globe are not built, but the camera keeps a pitch slot. There is no setting to turn rotation off.
- Rotation starts only from deliberate gestures: Shift+right-drag and Shift+middle-drag about the pointer, the compass ring, two-finger twist past a threshold, the macOS trackpad rotate gesture past 10°, Shift+←/→ in 15° steps. No Alt+wheel. Reset north: compass click, N (follows the single-key switch), Shift+N (always), Shift+↑; about 300 ms. Free gestures snap to north within 7° on release; 15° absolute steps come from Ctrl/Cmd added during a Shift+drag, and Shift on the compass ring.
- Left click and left drag always select or draw; left-drag never pans (Pan tool excepted); Shift+drag is never box zoom. Right-drag, middle-drag and Space+drag pan in every tool; a still right-click opens the canvas menu, on release. Overview left-drag becomes band select.
- Arrows nudge the selection 10 cm along screen directions, or pan with nothing selected; Ctrl/Cmd+arrow is the large step. Cycle labels moves to Shift+L.
- Grid, snapping and guides stay on true east/north and turn with the map; rulers show only at north, else the hint "Rulers show when north is up".
- Zones, notes and Print Areas are map objects that turn with the map. Rectangles, ellipses and notes drawn on a rotated map are level with the screen and store the bearing as `rotationDeg`; polygons, lines and rows store their vertices. Spec §4.7. Plant names, readouts, badges and handles stay upright.
- PDF: "Map orientation: North up / As on screen", default North up, with one angle for the whole layout (2026-10-01); the north arrow always points to true north.
- The Pan tool (H) stays, off the main rail (View and Tools menus, palette, phone strip). "Pointing device: Mouse / Trackpad" reuses the stored `scroll_wheel` field. Linux trackpad pinch is unsupported for now.
- Single-key shortcuts work anywhere except text fields and dialogs. Esc belongs to the active tool first.
- Stored data: `LastView.bearing` (settings, default 0) is the only stored change, a defaulted settings field the user approved; the approved Print Area angle is dropped with the per-area angle (2026-10-01), and nothing replaces it: PDF setups are not saved, so the layout angle lives in memory only (decided with the user, 2026-10-01; do not ask again). Two users; the maintainer converts `.canopi` files by hand: Canopi 2.0 has no migrations (ADR 0021). Any other stored change may be made when it improves the project and is named in the handoff (section 9); the plant catalog never changes.
- Architecture before performance; no performance gates. Phase R records measurements as evidence only.
- 2.0 is the canvas phases plus the open bugs of the other 2.0 work, and no other feature (user, 2026-10-02); every other open feature or task waits for after 2.0, and canopi-224j (the whole-codebase audit) comes after 2.0.
- Before cutting code, a seam or a planned behaviour, check the roadmap (hydrology, tree and crown detection, LiDAR reading) as plan section 1, "How a step is chosen", says; what the roadmap needs is kept and adapted.

**Decisions of 2026-10-01 to 2026-10-03** (plan section 1, U1–U19, each with where it applies): one release, with the per-phase release tasks run once at the release close; no pan with a second button during a left drag; one map angle for the whole PDF layout; no edge highlight for "Turn view to this edge"; a panel drag over the map hides the tool's preview; LiDAR's Return to Design keeps the exact view; Esc with focus in a side panel does not clear the map selection, and no Esc closes the side panel; the PDF page editor's arrows keep today's direction; on macOS every shortcut label reads Cmd, from phase 1 (U13); canopi-0p2n gets Retry plus a notice (U14); canopi-gaxi is in 2.0, and canopi-f47t.9 is measured in R and fixed after 2.0 (U15); phase 2's design check adds ADR 0020's key admission during a live pointer gesture and ADR 0017's one modifier-state source, and phase 2 runs 3–4 vertical feature streams (U16); phase 3 moves the compass drag onto `input/thresholds.ts` (U17); one bottom-chrome layout in R or the release close (U18); the Frontend gate runs the suite once, and a seam change gets a real-implementation test (U19). The audit's remaining cuts are in R and the release close. Plan section 1, "How a step is chosen", holds the rules that came out of it; "Reviews" holds the review rules of section 7.

**Conventions** are details the planner chose where the user did not decide; the spec marks them "(convention)" or "(spec)". Plan section 8 lists them per phase. At the handoff of the phase that ships each one, name it so the user can confirm or overturn it. Do not ask about them mid-phase.

## 4. Phase order

```
phase 0 (done) ─▶ F (done) ─▶ 1 (done) ─▶ 2.0 bug fixes ─▶ 2 ─▶ 3 ─▶ R ─▶ 2.0 release close ─▶ (after 2.0) canopi-224j
```

- **Done.** Phase 0, the behaviour-preserving refactor (canopi-f47t.5 and canopi-f47t.5.1 closed): one camera driver host and view transform, one input pipeline, one tool host with narrow tools, a renderer split into `syncScene` and `setView`, and the unused-code check. Canopi 2.0 drops stored-data migrations (ADR 0021; canopi-v2mg closed). Phase F (canopi-f47t.6.1 closed): the key router, Esc chain, focus owner and `armCanvasTool` in their target form, the 3 px mouse and pen drag threshold, the hover end, window listeners only during an owned session, the selection-drag guard. canopi-f47t.6 stays open only for canopi-f47t.6.2, the Windows hand check (section 15). Phase 1 (canopi-f47t.7): the map rotates, keys follow the screen, the view keeps its bearing, one PDF Map orientation (plan section 4, "Phase 1: rotation (done)"). Plan section 4 has what shipped, what each later phase finds already built ("Already built" in each phase), and what changed for users.
- **Next, in this default order** (plan section 2). **2.0 bug fixes** (plan section 4; canopi-h90p.67, canopi-h90p.68, canopi-0p2n, canopi-gaxi, canopi-e3ym, canopi-dfc0, canopi-pj62), between phases, never while one is open. **2** controls (canopi-f47t.1). **3** touch (canopi-f47t.3). **R** retained rendering (canopi-f47t.8), one sequential stream while no phase is open (it shares files with 1 and 3), after 3 by default. **Release close** (canopi-f47t): the bindings hard-coded, the 2.0 Web scenario, the docs check, gallery, release notes, the durable rules moved into `AGENTS.md`, the plans deleted, then the hand-over to the release beads canopi-2v5a and canopi-fxil.12, whose merge, smoke test and publication are the user's. After 2.0: canopi-224j.
- **Left standing from phase 0** (plan section 4, "Left standing"): 0B-5 items 7 and 18 (`setTool` typed `ToolId` with its source-text pin), 9 (the press-capture hold-back), 19 (the session's construction rollback), and the admission detail. A step that touches that code re-checks them first; otherwise they go to canopi-224j.
- Phases 1, 2 and 3 each edit the one bindings constant in place; "ROTATION", "V2" and "TOUCH" in the spec name expectation columns, never constants. Every step ends with the gates green and is pushed after its review. Everything ships together as 2.0 (user, 2026-10-01): no phase is a release candidate on its own.
- Anything a user could notice lands in its own commit with its regression test written first, and the phase's handoff names it (plan section 8).

## 5. File ownership for parallel agents

One file has one owner per phase. No two agents edit the same file, and streams run in parallel only on areas that share no file; coupled work is one sequential stream. No agent reverts another's work. In the 11 locale files (`desktop/web/src/i18n/*.json`) an agent adds or removes only its own keys; you integrate. A needed edit outside an agent's list comes back to you. The full lists are in plan section 4, per phase; brief each agent with its row copied from there, not this summary.

| Phase | Streams (plan section) | Owns, in short |
|---|---|---|
| 2 | 3–4 vertical feature streams (U16), cut by its design check from the "Phase 2" table | the bindings constant's phase-2 fields (no nested navigation), select and drawing rules, keymap, the View › Pan entry in `app/shell-commands/menus.ts`, `settings.rs` doc comments (Keyboard alone), rail, cards, settings, F1's static gesture list |
| 3 | Input, D1, D3, Components ("Phase 3" table) | the bindings constant's touch fields, handle targets, one-finger Pan, phone Fit |
| R | Renderer ("Phase R"), one sequential stream while no phase is open | `renderers/**`, presentation, the selection-model cache, `scene-runtime/render-scheduler.ts`, the tooltip's lines (R2); `move-drag.ts`, `scene-runtime/drag-state.ts` and `chrome/**` |
| 2.0 bug fixes | one agent per bead ("2.0 bug fixes") | the files the step's design check finds, disjoint between agents running at once; strings of canopi-h90p.68 and canopi-0p2n in 11 locales |
| Release close | you, with agents for step 1 (bindings) and the docs check | plan section 4, "2.0 release close" |

You own: `__tests__/frontend-architecture-policies.test.ts`, `__tests__/canvas-boundaries.test.ts` (the policy tests of plan section 5; P9b, P13 and P15 are not written), `__tests__/unused-code.test.ts` with its snapshot, locale integration, every `bd` write and the worktree's `.beads/issues.jsonl` (plan section 7, "JSONL"), the Playwright scenarios (`desktop/web/e2e/**`, the release close's `v2.spec.ts` included) and every end-of-phase deletion. R runs between phases, never beside one (plan section 2).

## 6. Gates at every phase

Run the gates for the changed area, from `AGENTS.md`, on the integration branch at the end of every step and before every push:

| Change | Run |
|---|---|
| Rust | `cargo fmt --all -- --check`; `CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings`; `CANOPI_SKIP_BUNDLED_DB=1 cargo test --workspace`; `cargo cov` above its floor; `python3 scripts/check_unused_crates.py` |
| A `#[tauri::command]` | `CANOPI_SKIP_BUNDLED_DB=1 cargo test -p canopi-desktop native_command_policy::tests` |
| Shared contracts (`common-types/`) | `cd desktop/web && npm run gen:types && npm run check:types` |
| Frontend | `cd desktop/web && npx tsc --noEmit && npm run test:coverage -- --maxWorkers=4 && npm run test:policies && npm run check:ui && npm run build && npm run build:web` |
| Docs | `python3 scripts/check_docs.py` (validator changes: `python3 -m unittest scripts.test_check_docs`) |

Every canvas step runs the Frontend row. Phases 1 and 2 add the Rust and Shared contracts rows (phase 1: `LastView.bearing`; phase 2: the `settings.rs` doc comments, which `bindings-gen` copies into `generated/contracts.ts`), and the regenerated `generated/contracts.ts` is committed with the change. Docs commits run the Docs row. Coverage floors are raised at milestones, never lowered. A gate you cannot run is recorded in the bead and the handoff with the command, the reason and the residual risk. No performance gates.

## 7. Review, live check and Web check at every phase

**Reviews** (user, 2026-10-02; plan section 1, "Reviews"). Each step's diff gets one review round by one reviewer that did not write the code (Opus high, read-only), reporting only findings with a concrete failing scenario. A separate agent verifies each finding (read-only, refuted unless shown) before anyone fixes it; the fix is test first. The fix diff is always re-reviewed on its own. A full second round runs on work that touches the user's files or stored data, on rotation's core, and when the first round found a blocker or a major; never more than two full rounds on one diff (a third points at the design or the tests). Reviews also check that the docs still say what the user decided. **Before every push**, a review of exactly the diff since the last push (the `/code-review` skill at high effort, or a review stage of the workflow); fix every confirmed finding, re-run the gates, and record in the bead that it ran and what it changed. No push without it.

**Live check** through the MCP bridge on an isolated review instance, after the merged gates pass: plan section 3.1 and `.rq-scratch/screenshots/phase-0/PROCEDURE.md` (with `drag-helper.js` for dispatched drags), then the phase's live-check steps from plan section 4. Run it from a detached worktree no other agent edits (`git worktree add --detach /home/daylon/projects/canopi/.rq-scratch/canvas-v2-live <commit>`, removed afterwards), since the review instance hot-reloads any edit. Profile `.rq-scratch/reference/<phase>/` (phase F's, basemap off, is `.rq-scratch/reference/phase-F`); copy the read-only master `.rq-scratch/reference/orchard.canopi` into it and never open the master or the user's files. Never drive the user's own app: check who owns the bridge port first. Record in the bead which host each step drove (dispatched `PointerEvent`s or native input).

**Web check** (plan section 3.2) on every merge that touches the renderer, camera, input or map, before the push: in phase 0 it alone caught a crash of the real renderer. From the worktree root, after `cd desktop/web && npm run build:web`: `docker run --rm --ipc=host -v "$PWD":/work -w /work/desktop/web --user $(id -u):$(id -g) -e HOME=/tmp mcr.microsoft.com/playwright:v1.63.0-noble npx playwright test e2e/canvas --reporter=line`. The CI job (canopi-9x95) runs the same scenarios in Chromium and WebKit on every push; every phase ends with it green on the pushed commit. The later phases' Web steps are automated once, at the release close, in `desktop/web/e2e/canvas/v2.spec.ts` (you own it); list each phase's Web steps in its bead. Known limits: multi-touch Chromium-only; WebKit trackpad `gesture*` events covered by fixtures E9 and E10.

## 8. Worktrees, branch and disk

- Never pull, commit, stage or push in the main checkout `/home/daylon/projects/canopi`: it is the user's (`cargo tauri dev` runs there; untracked `.beads.gate.lock` is theirs). Read-only commands only.
- The integration worktree is `/home/daylon/projects/canopi/.rq-scratch/canvas-v2` on `canvas-v2/integration`, which tracks `origin/feature/geolibre-adoption`. Before each bead: `git fetch`, then `git rebase --rebase-merges origin/feature/geolibre-adoption` if behind (a plain rebase flattens the stream merges). Push with `git push origin HEAD:feature/geolibre-adoption` (origin pushes to GitHub and Codeberg). Only one agent works in the integration worktree at a time.
- Every worktree uses `CARGO_TARGET_DIR=/home/daylon/projects/canopi/.rq-scratch/shared-build/target` (the last component must be `target`). Say so in every implementation brief.
- Tools in `/home/daylon/projects/canopi/.rq-scratch/tools/`: `mkwt.sh <stream> [base]` makes `.rq-scratch/canvas-v2-<stream>` on `canvas-v2/<stream>` from `canvas-v2/integration` with `npm ci` (which installs the pre-commit hook), the PDF fonts and the catalog DB copy; `quiet-gates.sh <worktree> quick|full` runs the Frontend gates printing only failures and totals (logs in `.rq-scratch/gate-logs/`; the Rust gates are section 6's row); `journal.py <run-id> [--full LABEL]` summarises a workflow journal; `imgdiff.py` diffs two screenshots by pixel; `x11-dialog.py <winid> <path>` drives a native GTK file dialog by X11 `send_event`; `wf-f.js` and `wf-0e.js` are example workflow scripts (section 11).
- Run `df -h /` before launching agents or heavy builds; clean up below about 50 GB free. Remove a merged worktree and its caches (`/tmp/canopi-*`, headless browser profiles); keep screenshots. Review profiles under `.rq-scratch/reference/<phase>/` go only when the phase's bead closes (plan section 3.1, step 6). Never delete the main checkout's `target/` without asking the user.
- The git stash stack is shared; set work aside with a WIP commit. Never amend.
- Commits: `refactor(frontend): …`, `fix(frontend): …`, `feat(frontend): …`, `test(frontend): …`, `docs: …`; stage only your files; generated files go with the commit that produced them.

## 9. Stop and amend

If building shows that the design is wrong (an interface cannot carry a case, a MapLibre assumption fails, a policy cannot be written, a phase cannot ship alone), the agent that finds it stops, does not work around it in code, and reports to you. You amend the ADR and the spec in one docs commit, say what changed and why, and tell the user before work resumes. The `.canopi` format and local data (the user DB, Drafts, Web storage, the LiDAR catalogue) may change when that improves the project, without asking the user first, and each change is named in the handoff (ADR 0021, "Later format changes"; user, 2026-10-02); after 2.0 a format change decides between refusing older files and a migration case by case, with no ladder by default. A new settings field with a default is not a format change. The plant catalog (`canopi-core.db`) never changes. Under the user's standing permission (2026-09-28), a process rule in `AGENTS.md`, a guide or an ADR that blocks a better fix is rewritten in the same change and named in the handoff; safety rules (preserve user work, plant catalog data, secrets, test first) stay.

## 10. Beads

Run `bd prime` for the commands. Plan section 7 maps every phase to its bead id, blockers and acceptance; do not file them again. The epic is canopi-f47t; open: 2 canopi-f47t.1, 3 canopi-f47t.3, R canopi-f47t.8, canopi-f47t.6.2 (the Windows hand check, under the epic), canopi-f47t.2 and .4, which close with phase 2, and the 2.0 bug-fix beads (plan section 4); phase 1's canopi-f47t.7 closes with its receipt at the phase-1 close. Read with `bd show`, `bd dep tree canopi-f47t`, `bd list --parent canopi-f47t` and `bd ready`. Every phase bead's acceptance predates U1 and is stale: `bd update <id> --claim --acceptance "…"` replaces it with the plan section 7 row and the current core exit when a phase starts; `bd note` for receipts in progress; `bd close` with a receipt: what shipped, commits, gates, inventory rows cleared, the unused-code check's result, string keys added or removed, which host each live check drove, limits recorded, the review, and the retrospective (section 12). File a new bead only for work the plan does not list. After any `bd` write, run `bd export -o .beads/issues.jsonl` in the integration worktree and commit it with the change; never touch the main checkout's `.beads/issues.jsonl`. Subagents make no `bd` writes.

## 11. Using ultracode workflows

Run each phase as a workflow (load the `workflow-authoring` skill before writing a script). `.rq-scratch/tools/wf-1.js` (the latest), `wf-f.js` and `wf-0e.js` show the shape (design check, streams, `reviewAndFix` with fix re-review, serial merges, Web check); the two older ones point at an old job folder, so point their tool paths at `.rq-scratch/tools/`. Stages, in order:

1. **Design check** (Opus high, read-only). Re-verify the phase's plan rows, inventory rows and owned files against the code at HEAD; return drift (moved lines, new importers, what earlier phases changed), design problems and a short list of questions only the user can answer. You ask the user all of them in one `AskUserQuestion` batch, then wait.
2. **Amendment** (Opus medium). One docs commit applying the design check and the user's answers to the plan and spec, in place; drift that changes the design follows section 9. Record dated answers in plan section 1.
3. **Implement.** One agent per stream from the plan's table, each in its own worktree from `mkwt.sh` (never the workflow's `isolation: worktree`, which branches from `main` outside `.rq-scratch/`), with its file list, the spec sections and named tests (written first), the shared `CARGO_TARGET_DIR` and `quiet-gates.sh <worktree> quick` after each commit. Streams run in parallel only on disjoint files; coupled work is one sequential stream.
4. **Review** each stream as section 7 says, before it merges.
5. **Merge** serially, one merge agent at a time in the integration worktree: `git merge --no-ff`, your policy and locale commits, `quiet-gates.sh <integration> full` (plus the Rust and shared-contract rows when they apply), and the Web check.
6. **Live check** from `.rq-scratch/canvas-v2-live`, then the **pre-push review**, then you push.

Models: Opus high for complex work, reviews, verification of hard findings and fixes; Opus medium for simpler or mechanical coding; Sonnet only for very simple tasks; never Fable or any other model.

When a usage limit stops agents, do not schedule check-ins to resume them: the user types "Resume", and you then continue each stopped agent where it stopped. Workflow gotchas: the STOPPED check is `/^\s*\**STOPPED(?! (was|is) not)/i` (an agent writing "STOPPED was not needed" or "STOPPED is not needed" is not stopped); resuming a workflow re-runs every agent after the first `agent()` call whose text changed, so only stages later than every finished agent may be edited before a resume (`resumeFromRunId`); `.rq-scratch/tools/wf-1.js` shows the build-slot semaphore (at most 4 mutating agents on this 8-CPU host) and the serial merges; never `SendMessage` a workflow agent (it spawns a duplicate); never let two agents work in the integration worktree at once. Keep briefs short and point at plan sections. Subagents never push, close beads or edit locale keys that are not theirs.

## 12. Handoff

At the end of every phase, from `AGENTS.md`:

1. Gates for the changed area passed, or are recorded as skipped with the reason.
2. Bead closed with a receipt; follow-up beads filed.
3. Affected guide, pattern, ADR or release notes updated, or the handoff says none were needed.
4. Committed, pulled with rebase, pushed; `git status --short --branch` clean and up to date.
5. Final message: bead id, commit hash, branch, gates run or skipped, user-owned files left untouched, and what to try in `cargo tauri dev`.

Add: the unused-code check's result (what it found and deleted, or why an entry stays), the conventions and "(spec)" details this phase shipped (plan section 8), any design amendment made under section 9, the inventory rows cleared, the Web-check engines and limits, the pre-push review outcome, any planned behaviour dropped because no user path or roadmap item needed it, and the phase's entries for the release close (Web steps, docs to check, gallery, release-note lines).

**Retrospective (every phase close).** The bead receipt carries a "Process" section of a few lines: tokens spent and calendar days; stop-and-amend and fix rounds; review findings that were real bugs versus noise, per review lens; what the live or Web check caught that unit tests missed. Then one or two changes, each made permanent rather than remembered: a rule in `AGENTS.md` or plan section 1 (rewritten, not appended), a script, or a test. Tune by results: a review lens that finds nothing real for two phases goes; a stage whose Sonnet output needs repeated fix rounds moves to Opus; a step that stops on design questions gets a deeper design check first. Delete the finished parts of the plan and spec, so later briefs stay short. Batch the user's questions at the start of the next phase, after its design check. Every few phases, check each rule in `AGENTS.md` and plan section 1 still earns its cost.

## 13. Definition of done (verbatim)

- Behaviour-preserving refactor merged first; the full gates in AGENTS.md pass at every phase.
- One view transform used everywhere; the policy tests enforcing it pass.
- The map rotates with the specified gestures, compass and reset. Selection, snapping, drawing, rulers, grid, labels, saved views, stories, snapshots and PDF all behave as specified when rotated.
- The controls behave as specified: right-drag pan, still-right-click menu, the Mouse/Trackpad setting, selection and drawing rules, and touch on the Web Edition.
- The known issues linked in the plan are fixed or explicitly moved to named beads.
- Every phase was code-reviewed before push, checked live through the MCP bridge on an isolated instance, and driven in Chromium and WebKit for the Web Edition.
- The docs, patterns, ADRs and the in-app hints and F1 dialog describe the new controls in all 11 locales.
- If building a phase shows that the design is wrong, the agent stops and amends the ADR and spec (and tells the user) instead of working around it in code. The user allows changing docs and ADRs when a rule blocks a better design.
- Each phase ends with a Web Edition cross-engine smoke test in Chromium and WebKit, committed as a CI job (bead canopi-9x95), so Windows and macOS webviews stay covered without hardware.

How the definition of done reads under the user's 2026-10-01 decision (one release): the docs, gallery, release notes and the cross-engine scenario of the later phases are done once, at the release close; every phase still ends with the CI job green in Chromium and WebKit on its pushed commit, and with its review and live check.

## 14. Operational notes (verbatim)

Review instance. The user's own `cargo tauri dev` usually runs from the main checkout on port 1420. Run a review instance from a worktree with its own identity and port, and check which process owns the bridge port before driving it: `cargo tauri dev -f mcp-bridge --config '{"identifier":"com.canopi.review","build":{"devUrl":"http://localhost:1431","beforeDevCommand":{"script":"npx vite --port 1431 --strictPort","cwd":"web"}}}'`. Run it with `XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` pointed at a scratch profile.
Worktree setup. Worktrees need `npm ci`, `npm run prepare:pdf-fonts` (or the PDF tests fail with ENOENT), and a copy of `desktop/resources/canopi-core.db`. Use the shared `CARGO_TARGET_DIR` (`.rq-scratch/shared-build/target`). Check `df -h /` first.
The bridge. It works only in debug-profile builds, because `desktop/build.rs` grants its capability only then. In builds with the production CSP it cannot inject its helper. For optimised measurement use `cargo tauri build --debug --no-bundle` with `CARGO_PROFILE_DEV_OPT_LEVEL=3` and a separate target folder.
The window's Close button. The only button labelled "Close" in the app is the window's close button. Clicking it quits the app, and on Linux with NVIDIA the WebKitGTK web process then segfaults harmlessly (canopi-pj62). Close panels with their rail button instead.
Shell pitfalls. The shell is zsh with noclobber: use `>|` to overwrite files. `pkill -f` and `pgrep -f` patterns match the calling shell's own command line and kill it. Stop processes by PID after checking `/proc/<pid>/exe`.
CI. It runs the native tests on Windows and macOS runners and checks the Windows manifest. Pushing to the pull request cancels in-progress pull-request runs; push runs are not cancelled.
Native dialogs. They can be driven for tests by sending X11 key events to the dialog window only, using python-xlib `send_event`, never global input.
Also: the user requires a code review of every change before each push. Work in worktrees under .rq-scratch/, commit to feature/geolibre-adoption. Use ultracode workflows.

## 15. What to do first

A new session continues from the 2.0 bug fixes (plan section 4, "2.0 bug fixes"):

1. Read-only, in the main checkout: `git -C /home/daylon/projects/canopi status --short --branch` (the user's `.beads.gate.lock` is expected; touch nothing there), `df -h /`, `bd show canopi-f47t.7` (phase 1 closed with its receipt; if not, the phase-1 close comes first), `bd show canopi-h90p.67 canopi-h90p.68 canopi-0p2n canopi-e3ym canopi-dfc0 canopi-pj62 canopi-gaxi`.
2. Work only in the integration worktree `/home/daylon/projects/canopi/.rq-scratch/canvas-v2`: `git status --short --branch` (clean), `git fetch`, `git rev-list --left-right --count HEAD...origin/feature/geolibre-adoption`. Behind: rebase as section 8 says. Ahead: unpushed commits from the last session, which go out with the next reviewed push.
3. Read this prompt to the end, then plan sections 1 and 2 and its "2.0 bug fixes" section (the beads, owners, tests written first, gates and live checks).
4. The step: canopi-h90p.67, canopi-h90p.68, canopi-0p2n (Retry after a lost WebGL context plus a notice when the basemap download fails, U14), canopi-e3ym, canopi-dfc0, canopi-pj62 and canopi-gaxi (in 2.0, U15; canopi-f47t.9 is measured in phase R and fixed after 2.0). First its design check (Opus high, read-only): each bead re-read against the code at HEAD, the files of each fix found and kept disjoint between agents running at once, the satellite `moveend` candidate confirmed or dropped, and the user's questions returned. Then one `AskUserQuestion` batch holding those questions and the open items below; then the amendment commit, the claims, and the workflow of section 11, one agent per bead.
5. Before each later step, name in its brief the user path or roadmap item behind every planned behaviour and drop what has none (plan section 1, "How a step is chosen").

Every later step (phases 2 and 3, R, the release close) starts the same way: steps 1 and 2, its plan section 4 entry (its "Already built" bullet first) and section 8 lines, its design check (phase 2's carries U16), one batch of the user's questions (plan section 8, "Asked in the next batches"), the amendment commit, the claim with the acceptance replaced, then the workflow of section 11. At each close: the handoff and retrospective of section 12, the profile cleanup of plan section 3.1, step 6, and the plan's and spec's finished parts trimmed.

Open items for the user:

- **Windows hand check** (canopi-f47t.6.2, U9): on Windows, drag a plant from the catalog and a saved stamp from Favorites onto the map. If it works, close canopi-f47t.6.2; if blocked, a separate bead rebuilds panel drags on pointer events. Not run yet; it alone gates the release close.
- **Saved-view go-to rule** (spec §4.10), if the user has not answered it at the phase-1 handoff: going to a saved view or story step uses its camera zoom, so a view saved in a large window reopens closer in a small one. If overturned, saved views gain an optional saved-window size. INV-CAM-20 stays open until it is answered.
- Known minor, for the record: during a polygon draft with focus on a map control outside the host, Backspace deletes the selection (pre-F behaviour). Old v1 saved stamps in a 2.0-schema user DB stay listed but cannot be placed until canopi-h90p.68 (ADR 0021).
