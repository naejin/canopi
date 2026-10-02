# Agent operating contract

Rules for agents working in Canopi. Optimise for user work preserved, reviewable changes and reliable handoff. A rule that matters has a test; a rule without one is marked (advice). Architecture: [`docs/architecture.md`](docs/architecture.md). Decisions and their reasons: [`docs/adr/`](docs/adr/). Documentation map: [`docs/README.md`](docs/README.md).

## Read first

1. [`docs/README.md`](docs/README.md): which document answers which question.
2. The one guide for your area under `docs/guides/`, and the one pattern file under [`.interface-design/`](.interface-design/system.md) for the surface you touch.
3. The ADR behind any rule you are about to bend. Code shows current behaviour; ADRs and guides show intended boundaries. When they disagree, file a bead; never weaken the contract to match the code.

## Rules

- **Preserve user work.** Run `git status --short --branch` before editing; pre-existing dirty or untracked files are the user's. Never stage, revert or stash them, and never run `reset --hard` or `checkout -- <file>` unless asked. The git stash stack is shared with the user; if you must set work aside, make a WIP commit.
- **Behavioural test first, then the fix.** Bug fixes carry a regression test. Frontend tests live in `desktop/web/src/__tests__/` or beside their module as `*.test.ts(x)`; Rust tests beside their module.
- **Gates run on the changed area** (table below). A gate you cannot run is recorded in the bead and handoff with the command, the reason and the residual risk. Coverage floors (`desktop/web/vite.config.ts`, `.cargo/config.toml`) are raised at milestones, never lowered; on a merge conflict keep the higher number.
- **Authorities are exclusive.** The scene runtime owns design objects and mutates through runtime transactions; Design Edit (`app/design-edit/`) owns budget, timeline, consortiums, views, stories and `extra`; the map layer store owns map layers; settings own device state. Panels read canvas state through read-only runtime queries. Enforced by `frontend-architecture-policies.test.ts`.
- **Coordinates.** Files store WGS84 lon/lat; runtime geometry is metres in the session plane; camera moves never move objects (ADR 0001).
- **Native execution.** Every `#[tauri::command]` is executor-backed async or a reviewed bounded synchronous command; no synchronous filesystem, SQLite, network, process or unbounded CPU work in a command. Enforced by `native_command_policy::tests`.
- **Secrets.** The Google Maps key never reaches Designs, exports, snapshots, logs, diagnostics or the page markup while masked. Map errors go through `maplibre/redact-credentials.ts`. Enforced by `settings-sections.test.tsx`, `map-background.test.ts`, `map-error-redaction.test.ts`, `app/canvas-map-surface/workspace-map-controls.test.ts` and `problem-report-diagnostics.test.ts`.
- **Layering and chrome.** Popups use the stacking scale in `global.css`; floating chrome registers with the visible-map-area seam so framing and chips avoid it. Enforced by `stacking-order.test.ts`, `canvas-chrome-layering.test.ts` (the scale) and `visible-map-area.test.tsx` (the seam).
- **Localisation.** Every user-facing string exists in all 11 locales; English is sentence case and placeholders fit their field. Enforced by `i18n-completeness.test.ts` and `i18n-copy.test.ts`. The glossary's terms and `Intl` for numbers, dates and units (advice, reviewed by hand).
- **Data.** Never change the plant catalog's data (`canopi-core.db`; user rule). Canopi 2.0 breaks stored data (ADR 0021, user decision 2026-10-02): there are no migration ladders. A `.canopi` older than the current version is refused with the typed "Canopi 2.0 and later can’t open it" message and left unchanged; older local data (user DB, Drafts, Web storage) is moved aside under a `before-2.0` name, never deleted, and the user is told once; a LiDAR catalogue bump keeps `source_meta.rs` complete so the library rebuilds. Any further stored-format change goes to the user first.
- **Reuse before writing** (ADR 0002): depend on light GeoLibre packages or copy framework-free modules with attribution; never import its React code. A new runtime dependency needs a bead saying why existing code is insufficient.
- **Delete, don't deprecate.** Dead code, tests, docs and dependencies go in the change that kills them.
- **Banned:** React, Tailwind, Zustand/Redux/MobX, react-i18next (use preact, CSS Modules, `@preact/signals`, `import { t } from '../i18n'`); rusqlite pools, typeshare, string-formatted SQL; raw `rgba()`/`white`/`black` and `font-weight: 500` in CSS Modules.

## Quality gates

| Change | Run |
|---|---|
| Rust | `cargo fmt --all -- --check`; `CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings`; `CANOPI_SKIP_BUNDLED_DB=1 cargo test --workspace`; `cargo cov` above its floor; `python3 scripts/check_unused_crates.py` (validator changes: `python3 -m unittest scripts.test_check_unused_crates`) |
| A `#[tauri::command]` | `CANOPI_SKIP_BUNDLED_DB=1 cargo test -p canopi-desktop native_command_policy::tests` |
| Shared contracts (`common-types/`) | `cd desktop/web && npm run gen:types && npm run check:types` |
| Frontend | `cd desktop/web && npx tsc --noEmit && npx vitest run --maxWorkers=4 && npm run test:coverage -- --maxWorkers=4 && npm run check:ui && npm run build && npm run build:web` |
| Species catalog queries | `python3 scripts/species_catalog_contract.py check` and its Python tests |
| LiDAR services | the GeoLibre ignored lane and the engine comparison lane ([data library](docs/guides/data-library.md)) |
| Docs | `python3 scripts/check_docs.py` (validator changes: `python3 -m unittest scripts.test_check_docs`) |

Docs-only changes skip code gates; say so in the handoff.

## Working method

- **Beads** (`bd prime` for commands) track user-visible work, bugs and decisions, not sub-steps. Close with a receipt: what shipped, commits, gates. Commit `.beads/issues.jsonl` when bead metadata changed.
- **Branch.** Canopi v2 lives on `feature/geolibre-adoption` until it ships; commit there, `git pull --rebase=merges` before starting, push after each bead. Maintenance starts from `main` on an intent-named branch.
- **Worktrees.** Implement in a worktree under `.rq-scratch/` so the user's `cargo tauri dev` checkout is undisturbed. All worktrees share `CARGO_TARGET_DIR=…/.rq-scratch/shared-build/target` (the last component must be `target`, or Tauri reads resources from the installed app). Check `df -h /` first; remove a merged worktree and its caches; never delete the user's `target/` without asking.
- **Scope** (advice; lessons of the v2 value audit). Before building a step, name the user path or roadmap item behind each planned behaviour; drop what has none. A refactor keeps what users see, not internal mechanisms. Never rebuild behaviour a later step of the same release replaces. Delete the old path in the change that replaces it; no dual-running. Specs state contracts and user-visible rules; briefs carry line numbers.
- **Subagents** run in parallel only on areas that share no files (coupled work is one sequential stream; advice), get explicit file ownership; no two edit the same file; none reverts another's work. In locale files an agent adds or removes only its own keys. The main agent integrates, runs gates, closes beads and pushes.
- **Live review.** `cargo tauri dev -f mcp-bridge` exposes the debug-only MCP bridge on `127.0.0.1:9223` (the plugin's default base port; it moves up when that port is taken); drive it from a separate `XDG_*` profile with a scratch copy of a Design, and check the port's owner so you never drive the user's own app. Canopi runs one instance at a time.
- **Commits** follow `fix(frontend): …`, `refactor(backend): …`, `docs: …`; stage only your files; generated files go with the commit that produced them.

## Documentation

Documents answer four questions: what must never change and why (this file, ADRs); what the finished thing looks like (`.interface-design/`, its boards, the UI gallery); where an area's boundary is (one guide per area); what changed for users (release notes). Wiring is not documented in prose; it lives in module comments and policy tests.

A guide changes when a rule or boundary changes, and the section is rewritten, not appended; `check_docs.py` enforces the size budgets. Plans for unbuilt work sit in `docs/plans/` with a `Status:` line and are deleted when built. Docs are reviewed against the code once per release.

## Handoff

1. Gates for the changed area passed, or are recorded as skipped with the reason.
2. Bead closed with a receipt; follow-up beads filed.
3. Affected guide, pattern, ADR or release notes updated, or the handoff says none were needed.
4. Committed, pulled with rebase, pushed; `git status --short --branch` clean and up to date.
5. Final message: bead id, commit hash, branch, gates run or skipped, user-owned files left untouched, and what to try in `cargo tauri dev`.
