Status: agreed (2026-09-29); scope amended 2026-10-01 (one release; plan §1, "Decisions of 2026-10-01"); deleted with the plan at the release close

# Canvas v2: implementation prompt

Trimmed 2026-10-01; the full earlier text is at commit e9245f5ee712c52967a49260d4eb7a0d8cc1669d.

You are the main agent implementing Canopi's canvas v2 in the integration worktree. Phase 0 is shipped through 0B-5 (28w8, the seams, canopi-9x95, 0A, 0D1, 0B and 0B-5 are merged; plan section 4 has each phase's "Shipped" line and merge commit). This prompt now covers what remains: the 0D2 hand-off, 0D2, 0E, F (with the keyboard work folded in), 1, 2, 3, R and the release close. Read it to the end before you touch anything. Paths in backticks are relative to the repository root unless they start with `canvas/`, `app/`, `components/`, `maplibre/`, `web/`, `shortcuts/`, `commands/`, `platform/`, `generated/`, `i18n/` or `__tests__/`, which are under `desktop/web/src/` (the plan's rows use the same base, so rows copied from it keep their meaning). `scene/` is short for `desktop/web/src/canvas/runtime/scene/`. `view/`, `input/`, `tools/`, `renderers/`, `chrome/`, `scene-runtime/` and `interaction/` are short for `desktop/web/src/canvas/runtime/<dir>/`; bare `key-chord`, `keymap`, `escape-chain`, `arming`, `focus-owner` and `key-router` modules and tests are under `desktop/web/src/app/keyboard/`.

## 1. Why this matters

Canopi's canvas was north-up and its controls contradicted each other: left-drag panned in some modes and selected in others, right-drag opened the menu at press on Linux and macOS, Shift+drag meant different things per tool, and a dozen modules each derived their own world-to-screen transform, listened to raw input and moved focus on their own. Users compare Canopi with GeoLibre, where the map turns. The user asked for rotation like GeoLibre and for the controls, rotation and the view, input and tool architecture to be designed together, without letting existing shortcuts hold the design back.

The design is finished and agreed. Your job is to build it phase by phase, keeping every phase shippable, and to stop and amend the design (section 9) rather than bend the code when it proves wrong.

## 2. What exists and the read order

Read in this order before starting:

1. `AGENTS.md`: the operating contract. It overrides anything here that conflicts, except where this prompt names a rule the user already changed.
2. `docs/plans/canvas-v2-plan.md`: phase order, file ownership per sub-phase, entry and exit, named tests, live and Web checks, docs per phase, beads (section 7) and what the user hears at each handoff (section 8). This is your working document.
3. `docs/adr/0015-rotating-map-and-canvas-controls.md`: the product decisions (rotation and controls). Then ADRs 0016 (one view transform), 0017 (input pipeline and gestures), 0018 (narrow tool interface), 0019 (rendering and the view transform), 0020 (focus and keyboard ownership). Each lists the alternatives rejected.
4. `docs/plans/canvas-v2-spec.md`: typed interfaces (section 1), gesture vocabulary (2), binding tables (3), rotation behaviour (4), synthetic event-sequence fixtures A–J (5), pitch readiness (6), out of scope (7), stored data (8), user-facing strings per phase (9). Read the sections your phase uses; the module tables (1.8, 1.9) say what still moves.
5. `docs/plans/canvas-v2-inventory.md`: every north-up, axis-aligned and entangled site today, with a stable ID (`INV-CAM`, `INV-XF`, `INV-TOOL`, `INV-REN`, `INV-ENT`, `INV-LSN`, `INV-WR`, `INV-KEY`, `INV-FOC`, `INV-DATA`, `INV-PDF`, `INV-DOC`, `INV-TEST`) and the phase that clears it. A phase does not close with one of its rows open unless the inventory re-homes it.
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
- Stored data: `LastView.bearing` (settings, default 0) is the only format change, a one-line default the user approved; the approved Print Area angle is dropped with the per-area angle (2026-10-01), and nothing replaces it: PDF setups are not saved, so the layout angle lives in memory only (decided with the user, 2026-10-01; do not ask again). Two users; the maintainer converts `.canopi` files by hand: no migration machinery. Any other stored change goes to the user first.
- Architecture before performance; no performance gates. Phase R records measurements as evidence only.

**Decisions of 2026-10-01** (the value audit; plan section 1 lists each with where it is applied): one release, with the per-phase release tasks run once at the release close; no pan with a second button during a left drag; one map angle for the whole PDF layout; no edge highlight for "Turn view to this edge"; a panel drag over the map hides the tool's preview; the new hover end lands in F; 0C folds into F (the keyboard is built once, in its target form); LiDAR's Return to Design keeps the exact view. The audit's cuts in landed code are step 0B-5; its later cuts are in 0E, R and the release close. Plan section 1 "How a step is chosen" holds the rules that came out of it.

**Conventions** are details the planner chose where the user did not decide; the spec marks them "(convention)" or "(spec)". Plan section 8 lists them per phase. At the handoff of the phase that ships each one, name it so the user can confirm or overturn it. Do not ask about them mid-phase.

## 4. Phase order and the phase-0 rule

```
28w8 fix ─▶ seams + 9x95 ─▶ 0A ∥ 0D1 ─▶ 0B ─▶ 0B-5 ─▶ hand-off ─▶ 0D2 ─▶ 0E ─▶ F ─▶ 1 ─▶ 2 ─▶ 3 ─▶ release close
                                                                                 R: between F, 1, 2 and 3 (after 0E)
```

- **Done.** 28w8, the seams commit, canopi-9x95, 0A, 0D1, 0B (0B-1 to 0B-4) and 0B-5 are merged. Plan section 4 has each phase's "Shipped" line and merge commit; `bd show canopi-f47t.5` has the open receipt. Phase 0 continues with the hand-off commit, 0D2 and 0E.
- **The hand-off commit (you, before 0D2).** Mechanical, no behaviour change: `SceneRendererV2` renamed `SceneRenderer`, `CanvasInspectionHandle.sourceQuad` with a `null` stub, and `ViewReadSurface.settledRevision` — the three pieces of the former 0C hand-off that 0D2 needs.
- **The legacy camera surface — the contract 0D2 and 0E inherit.** `canvas/runtime/camera.ts` re-exports the constructible `CameraController` shim of `canvas/runtime/legacy-camera-facade.ts` (outside `view/`, reaches no MapLibre); `maplibre/workspace-camera.ts` declares the `MapLibreWorkspaceCameraOwner` shim itself (plan section 4, 0A "Legacy surface"). Both live until 0E, after the renderer — their last outside reader — has moved off them in 0D2. `SceneViewportState` stays the renderer's input until 0D2 and is deleted in 0E. `maplibre/scene-camera-transform.ts` and its test live until 0D2, because `maplibre/shared-scene-layer.ts` runs its derivation every render until the Renderer moves the layer onto the frame and deletes both in that commit (P2 carries one named entry for it until the Renderer's merge). Phase 0 builds no keyboard: 0B's keyboard port keeps today's key handling until F.
- **0D2, 0E: still a behaviour-preserving refactor, with one named exception left to build.** The two named exceptions that ship inside 0B (world drag starts and live previews; drafts drawn in Pixi) and 0B-5's overview pointerup fix are done. 0E's camera cut is still ahead: `runtime.init` fits instead of the 100 m frame (a start-screen open shows the empty overview until its load's fit), LiDAR's Fit to data keeps the latest fit's bookmark, the plant finder's Zoom to them sets none, and Return to Design without one frames the Design — its own commit, regression test written first. 0D2's by-eye conventions (plan section 1) are compared by eye, never pixel-matched.
- **F:** the key router, Esc chain, focus owner and arming built once (the former 0C), with the focus, Esc and key fixes and the hover end. **1:** rotation. **2:** controls. **3:** touch. Each edits the one bindings constant in place. **R:** retained rendering, after 0E, its sub-phases between phases (it shares files with F, 1 and 3). **Release close:** the bindings hard-coded, the 2.0 Web scenario, the docs check, gallery, release notes, and the plans deleted.
- Every step ends with the gates green and is pushed after its review. Everything ships together as 2.0 (user, 2026-10-01): no phase is a release candidate on its own.

**Refactor first, behaviour unchanged.** The rest of phase 0 (0D2, 0E) changes structure only, runs at bearing 0 under `LEGACY_BINDINGS`, and passes every behavioural test with only mechanical harness edits (0E's one named exception, in the counting guard, is the only exception left); `__tests__/pixi-scene.test.ts` mocks `pixi.js` and is one of 0D2's named rewrites. Apart from 0E's named exception, anything a user could notice waits for phase F or later, in its own commit with its regression test written first. A phase-0 commit that needs a behaviour change to go green is wrong: stop and apply section 9.

**The counting guard** (plan section 3.4) still runs at the end of every phase-0 sub-phase (0D2, 0E). `desktop/web/scripts/count-vitest-tests.mjs` compares `npx vitest list --json=<file>` against the committed baseline, `desktop/web/scripts/canvas-v2-test-baseline.json`, and the replacement map, `desktop/web/scripts/canvas-v2-test-replacements.json`, which the 0D2 and 0E streams (and you, at a merge) extend in the commit that replaces a test: every baseline name is present, mapped to a replacement that is present, or retired with the reason no user sees what it checked. The phase-0 receipt carries its final numbers; the script and both JSON files are deleted when the phase-0 bead closes.

## 5. File ownership for parallel agents

One file has one owner per sub-phase. No two agents edit the same file, and streams run in parallel only on areas that share no file; coupled work is one sequential stream. No agent reverts another's work. In the 11 locale files (`desktop/web/src/i18n/*.json`) an agent adds or removes only its own keys; you integrate. A needed edit outside an agent's list comes back to you. The full lists are in plan section 4, per sub-phase; brief each agent with its row copied from there, not this summary.

28w8, the seams, canopi-9x95, 0A, 0D1, 0B (0B-1 to 0B-4) and 0B-5 are shipped; their file lists and merge commits are in plan section 4, under each phase's own heading, and need no repeating here.

| Sub-phase | Streams (plan section) | Owns, in short |
|---|---|---|
| hand-off | you, after 0B-5 | `SceneRendererV2` renamed `SceneRenderer`, `CanvasInspectionHandle.sourceQuad` with a `null` stub, `ViewReadSurface.settledRevision` |
| 0D2 | Renderer, then Components-0D2, you at the Renderer's merge ("0D2" table) | `renderers/**` (`draft-layer.ts` kept, with two roots) and the renderer-API test suites (INV-TEST-14), presentation, selection, labels, guides, the lens drawing and layout, the view-scene capture, the shared scene layer (deleting `maplibre/scene-camera-transform.ts`), `coverage.ts`; zoom, overview, chips, lens component (its outline a `<polygon>`); you remove P2's entry and land P12. The selection-model cache is R's |
| 0E | View (plan "0E"), after 0D2; you at its merge | only the camera behaviour users need (plan 0E, "Kept and cut"): the host's policy at the plane's latitude, the attached re-origin in the runtime's plane effect, the navigation's one LiDAR bookmark and `frameBounds`, exception 3's start frame and temporary-focus commits, the session, command, document and query surfaces, the chrome on `ViewFrame`, the composition and activation on `cameraHost`, `subscribePointerWorld` with the screen point (R1); the audit's later cuts: a geographic headless driver, no injected clock (Vitest fake timers), no revision counts, non-null pitch-0 types, one last-view debounce; deletes the facade, `camera.ts`, `maplibre/workspace-camera.ts`, `SceneViewportState` and `CanvasQuerySurface.viewport` and moves their importers (incl. `desktop/web/scripts/pdf-validation/fixtures.ts`, checked with `npm run build:pdf-validation`); you land P3, P3b, P10 and P11's camera part and drop P4's symbol rule |
| F | one sequential keyboard stream (Keyboard, then Components on the caller files), beside the Input, View and D1 rows ("Phase F" table) | the key router, keymap, chords, Esc chain (popover layers in the same window), focus owner and `armCanvasTool` built once in their target form (the former 0C: `app/keyboard/**`, commands, shortcuts, the canvas key path, the callers); the named fixes; the hover end (U6); you land P8, P9, P14 and the keyboard policy re-points |
| 1 | View, Input, D1–D4, Renderer, Keyboard, Components ("Phase 1" table); you first add the context-menu request's `turnViewToEdge` field in a hand-off commit | rotation per stream; `common-types/src/settings.rs` for `LastView` and its single-key doc comment (View alone); one PDF layout angle; the View menu rotation rows and `KeyboardShortcutsDialog.tsx`'s F1 rows in phase 1 |
| 2 | same streams ("Phase 2" table) | the bindings constant's phase-2 fields (no nested navigation), select and drawing rules, keymap, the View › Pan entry in `app/shell-commands/menus.ts`, `settings.rs` doc comments (Keyboard alone), rail, cards, settings, F1's static gesture list |
| 3 | Input, D1, D3, Components ("Phase 3" table) | the bindings constant's touch fields, handle targets, one-finger Pan, phone Fit |
| R | Renderer ("Phase R"), between phases | `renderers/**`, presentation, the selection-model cache, the tooltip's lines (R2); `move-drag.ts`, `scene-runtime/drag-state.ts` and `chrome/**` while no phase is open |

You own: `__tests__/frontend-architecture-policies.test.ts`, `__tests__/canvas-boundaries.test.ts` (the policy tests of plan section 5; P9b, P13 and P15 are not written), the seams, the test split, the counting guard, locale integration, every `bd` write and the worktree's `.beads/issues.jsonl` (plan section 7, "JSONL"), the Playwright scenarios (phase 0's and the release close's `desktop/web/e2e/canvas/v2.spec.ts`) and every end-of-sub-phase deletion. R runs between phases, never beside one (plan section 2).

## 6. Gates at every phase

Run the gates for the changed area, from `AGENTS.md`, on the integration branch at the end of every sub-phase and before every push:

| Change | Run |
|---|---|
| Rust | `cargo fmt --all -- --check`; `CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings`; `CANOPI_SKIP_BUNDLED_DB=1 cargo test --workspace`; `cargo cov` above its floor |
| A `#[tauri::command]` | `CANOPI_SKIP_BUNDLED_DB=1 cargo test -p canopi-desktop native_command_policy::tests` |
| Shared contracts (`common-types/`) | `cd desktop/web && npm run gen:types && npm run check:types` |
| Frontend | `cd desktop/web && npx tsc --noEmit && npx vitest run --maxWorkers=4 && npm run test:coverage -- --maxWorkers=4 && npm run check:ui && npm run build && npm run build:web` |
| Docs | `python3 scripts/check_docs.py` (validator changes: `python3 -m unittest scripts.test_check_docs`) |

Every canvas sub-phase runs the Frontend row. Phases 1 and 2 add the Rust and Shared contracts rows (phase 1: `LastView.bearing`; phase 2: the `settings.rs` doc comments, which `bindings-gen` copies into `generated/contracts.ts`), and the regenerated `generated/contracts.ts` is committed with the change. Docs commits run the Docs row. Coverage floors are raised at milestones, never lowered. A gate you cannot run is recorded in the bead and the handoff with the command, the reason and the residual risk. No performance gates.

## 7. Review, live check and Web check at every phase

**Code review before every push.** The user requires it. Before each push, review the diff since the last push (for example the `/code-review` skill at high effort on the branch diff, or a review stage in the phase workflow with at least one reviewer agent that did not write the code). Fix every confirmed finding, re-run the gates, and record in the bead that the review ran and what it changed. No push without a review of exactly what is pushed.

**Live check through the MCP bridge on an isolated review instance.** Follow plan section 3.1 (it carries the review-instance command of the operational notes below: identifier `com.canopi.review`, port 1431, scratch `XDG_*` profile, shared `CARGO_TARGET_DIR`), and run the phase's live-check steps from plan section 4. Never drive the user's own app: check who owns the bridge port before driving it. The reference orchard (format v9, 2,200 plants, 24 zones, 106 notes) is `/home/daylon/projects/canopi/.rq-scratch/reference/orchard.canopi`, a git-ignored, read-only master: copy it into each review profile and never open the master in the app; never open the user's working files. Record in the bead which host each step drove (dispatched `PointerEvent`s or native input).

**Web Edition in Chromium and WebKit.** Bead canopi-9x95's Playwright job (shipped beside the seams) serves the built Web Edition and drives it in Chromium and WebKit on every push; every phase from 0A on ends with the CI job green on the pushed commit (`base.spec.ts` and `phase-0-refactor.spec.ts`, the core exit, plan section 1). Since v2 ships as one release (2026-10-01), the later phases' Web-check steps are automated once, at the release close, in `desktop/web/e2e/canvas/v2.spec.ts` (you own it); list each phase's Web steps in its bead for the release close. Record the known limits (multi-touch Chromium-only; WebKit trackpad `gesture*` events covered by fixtures E9 and E10).

## 8. Worktrees, branch and disk

- Run `git status --short --branch` first; pre-existing dirty or untracked files (for example `.beads.gate.lock`) are the user's. Never stage, revert or stash them.
- Canvas v2 lives on `feature/geolibre-adoption`. In the integration worktree, run `git fetch` and `git rebase --rebase-merges origin/feature/geolibre-adoption` before starting each bead (a plain rebase would flatten the stream merges and replay their resolved conflicts); commit there; push after each bead with `git push origin HEAD:feature/geolibre-adoption` (the integration worktree sits on `canvas-v2/integration`, which has no upstream of its own). Never pull, commit or push in the main checkout.
- Implement in worktrees under `/home/daylon/projects/canopi/.rq-scratch/`, never in the main checkout, where the user runs `cargo tauri dev`. Keep one integration worktree for yourself; each parallel mutating agent gets its own worktree on a branch you merge.
- Every worktree uses `CARGO_TARGET_DIR=/home/daylon/projects/canopi/.rq-scratch/shared-build/target` (the last component must be `target`). Say so in every implementation brief.
- Run `df -h /` before launching agents or heavy builds; clean up below about 50 GB free. Remove a merged worktree and its caches (`/tmp/canopi-*`, headless browser profiles); keep screenshots. Review profiles live under `.rq-scratch/reference/<phase>/`, not `/tmp`, and are removed only when the phase's bead closes (plan section 3.1, step 6), so the pre-phase references survive every sub-phase merge. Never delete the main checkout's `target/` without asking the user.
- The git stash stack is shared; set work aside with a WIP commit.
- Commits: `refactor(frontend): …`, `fix(frontend): …`, `feat(frontend): …`, `test(frontend): …`, `docs: …`; stage only your files; generated files go with the commit that produced them.

## 9. Stop and amend

If building shows that the design is wrong (an interface cannot carry a case, a MapLibre assumption fails, a policy cannot be written, a phase cannot ship alone), the agent that finds it stops, does not work around it in code, and reports to you. You amend the ADR and the spec in one docs commit, say what changed and why, and tell the user before work resumes. A change to the `.canopi` format or the user's local data (user DB, settings, LiDAR catalogue) may be made when it improves the project (user, 2026-10-02), through ADR 0013 migrations, and is named in the handoff; the plant catalog (`canopi-core.db`) never changes. Under the user's standing permission (2026-09-28), a process rule in `AGENTS.md`, a guide or an ADR that blocks a better fix is rewritten in the same change and named in the handoff; safety rules (preserve user work, plant catalog data, secrets, test first) stay.

## 10. Beads

Run `bd prime` for the commands. The beads are filed (2026-09-29); plan section 7 maps every phase to its bead id, blockers and acceptance. The epic is canopi-f47t: phase 0 is canopi-f47t.5 (0D2 is canopi-f47t.5.1; 0E belongs to canopi-f47t.5 itself), F canopi-f47t.6, 1 canopi-f47t.7, 2 canopi-f47t.1, 3 canopi-f47t.3, R canopi-f47t.8; canopi-f47t.2 and .4 ship items in 0B, F and 2 and close with phase 2; canopi-9x95 is the CI job. Do not file them again. Use `bd show`, `bd dep tree canopi-f47t`, `bd list --parent canopi-f47t` and `bd ready` to read; `bd update <id> --claim` when a phase starts (for canopi-9x95 and canopi-28w8, which have no acceptance field, add `--acceptance` with the plan section 7 row in the same call); `bd note` for receipts in progress; `bd close` with a receipt: what shipped, commits, gates run, inventory rows cleared, counting-guard numbers (phase 0), string keys added or removed, which host each live check drove, limits recorded, and the review. File a new bead only for work the plan does not list. After any `bd` write, run `bd export -o .beads/issues.jsonl` in the integration worktree and commit it with the change (plan section 7, "JSONL"); never touch the main checkout's `.beads/issues.jsonl`. Subagents make no `bd` writes. Beads track user-visible work and decisions, not sub-steps.

## 11. Using ultracode workflows

Run each phase as a workflow (load the `workflow-authoring` skill before writing a script) with four stages:

1. **Research.** Read-only agents re-verify the phase's inventory rows and the files in the ownership table against the current code, and report drift (a moved line, a new importer) before anyone edits. Drift that changes the design goes to section 9.
2. **Implement.** One agent per stream from the plan's table for that sub-phase, each with its explicit file list, the spec sections it implements, the named tests it writes first, the shared `CARGO_TARGET_DIR`, and the rule that it edits nothing outside its list. Parallel mutating agents never share a checkout. Create each stream's worktree yourself before launching it: `git worktree add -b canvas-v2/<stream> /home/daylon/projects/canopi/.rq-scratch/canvas-v2-<stream> canvas-v2/integration`, then in it `cd desktop/web && npm ci && npm run prepare:pdf-fonts` (without `npm ci` the husky pre-commit hook is not installed), and copy `desktop/resources/canopi-core.db` from the main checkout. Each brief names that absolute path as the agent's working directory, the shared `CARGO_TARGET_DIR` and the branch to commit on. Do not rely on the workflow's `isolation: worktree` option: by the harness's documented default it creates its worktree under `.claude/worktrees/` from the default branch (`main`), not from `canvas-v2/integration`, and outside `.rq-scratch/`. Respect intra-phase order (section 4 and plan section 4 give each phase's own).
3. **Review.** A reviewer agent that did not write the code reviews each stream's diff against the spec, the ADRs and the policy tests; the implementer fixes confirmed findings.
4. **Verify.** You merge the streams into the integration worktree, run the counting guard (phase 0), the full gates, the live check and the Web check, then the pre-push review of the merged diff.

Keep briefs short and point at plan sections. Subagents never push, close beads or edit locale keys that are not theirs.

## 12. Handoff

At the end of every phase, from `AGENTS.md`:

1. Gates for the changed area passed, or are recorded as skipped with the reason.
2. Bead closed with a receipt; follow-up beads filed.
3. Affected guide, pattern, ADR or release notes updated, or the handoff says none were needed.
4. Committed, pulled with rebase, pushed; `git status --short --branch` clean and up to date.
5. Final message: bead id, commit hash, branch, gates run or skipped, user-owned files left untouched, and what to try in `cargo tauri dev`.

Add: the conventions and "(spec)" details this phase shipped (plan section 8), any design amendment made under section 9, the inventory rows cleared, the Web-check engines and limits, the pre-push review outcome, any planned behaviour dropped because no user path or roadmap item needed it, and the phase's entries for the release close (Web steps, docs to check, gallery, release-note lines).

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

Phase 0 is shipped through 0B-5 (section 4). Resuming from the 0D2 hand-off:

1. In the integration worktree: `git status --short --branch` (note the user's files), `df -h /`, `bd show canopi-f47t.5` for the open receipt, `bd dep tree canopi-f47t`. Confirm 0B-5's merge commit (plan section 4) is on the branch tip you are building from.
2. Run the Frontend gates (section 6) once to confirm the tip is green before editing.
3. **Hand-off commit (you alone, section 4).** `SceneRendererV2` renamed `SceneRenderer`, `CanvasInspectionHandle.sourceQuad` with a `null` stub, `ViewReadSurface.settledRevision`; `tsc` and `vitest` green; gates, review, push.
4. **0D2**, as one workflow (section 11): the Renderer stream, then Components-0D2 (section 5; plan section 4's "0D2" table has the full file lists, entry, exit and tests). Merge at the Renderer's merge, run the counting guard, the gates, the live check and the Web check, review, push.
5. **0E**, after 0D2 merges (section 5; plan section 4's "0E"). Then continue in order: F needs the phase-0 bead closed (0E included); 1 needs F; 2 needs 1; 3 needs 2; an R sub-phase needs 0E merged and runs only while no phase is open; the release close needs 3 and R closed. Before each step, name in its brief the user path or roadmap item behind every planned behaviour, and drop what has none (plan section 1, "How a step is chosen").
