# Agent operating contract

Rules for agents in Canopi. Optimise for user work preserved, reviewable changes and reliable handoff. A rule that matters has a test; a rule without one is marked (advice). Architecture: [`docs/architecture.md`](docs/architecture.md). Decisions and their reasons: [`docs/adr/`](docs/adr/).

## Read first

1. [`docs/README.md`](docs/README.md): which document answers which question.
2. The one guide for your area under `docs/guides/`, and the one pattern file under [`.interface-design/`](.interface-design/system.md) for the surface you touch.
3. The ADR behind any rule you are about to bend. Code shows current behaviour; ADRs and guides show intended boundaries. When they disagree, file a bead; never weaken the contract to match the code. A process rule that blocks a better fix is rewritten in the same change, named in the handoff; safety rules stay.

## Rules

- **Preserve user work.** Run `git status --short --branch` before editing; pre-existing dirty or untracked files are the user's. Never stage, revert or stash them, and never run `reset --hard` or `checkout -- <file>` unless asked. The stash stack is shared with the user; to set work aside, make a WIP commit.
- **Behavioural test first, then the fix.** Bug fixes carry a regression test. A seam change (renderer, camera, map, input) also gets a test through the real implementation or browser, since fakes hid seam bugs (advice; user, 2026-10-03). Tests sit beside their module; frontend ones may be in `desktop/web/src/__tests__/`.
- **Gates run on the changed area** (table below). A gate you cannot run goes in the bead and handoff with its command, reason and residual risk. Coverage floors (`desktop/web/vite.config.ts`, `.cargo/config.toml`) are raised at milestones, never lowered; on a merge conflict keep the higher one.
- **Authorities are exclusive.** The scene runtime owns design objects and mutates through runtime transactions; Design Edit (`app/design-edit/`) owns budget, timeline, consortiums, views, stories and `extra`; the map layer store owns map layers; settings own device state. Panels read canvas state through read-only runtime queries. Enforced by `frontend-architecture-policies.test.ts`.
- **Coordinates.** Files store WGS84 lon/lat; runtime geometry is metres in the session plane; camera moves never move objects (ADR 0001).
- **Native execution.** Every `#[tauri::command]` is executor-backed async or a reviewed bounded synchronous command; no blocking filesystem, SQLite, network, process or unbounded CPU work in one. Enforced by `native_command_policy::tests` and `clippy.toml`.
- **Secrets.** The Google Maps key never reaches Designs, exports, snapshots, logs, diagnostics or the page markup while masked; map errors go through `maplibre/redact-credentials.ts`. The location reading (dot, accuracy, time) never reaches a Design, Draft, export, snapshot, saved view, log or diagnostics; a camera saved while following is a view. Enforced by `settings-sections.test.tsx`, `map-background.test.ts`, `map-error-redaction.test.ts`, `workspace-map-controls.test.ts`, `problem-report-diagnostics.test.ts`, `my-location-trust.test.ts` and `e2e/canvas/my-location.spec.ts`.
- **Layering and chrome.** Popups use the stacking scale in `global.css`; floating chrome registers with the visible-map-area seam so framing and chips avoid it; status chrome shown by load state registers with `frames: false`: only chips avoid it. Enforced by `stacking-order.test.ts`, `canvas-chrome-layering.test.ts` and `visible-map-area.test.tsx`.
- **Localisation.** Every user-facing string exists in all 11 locales; English is sentence case and placeholders fit their field. Enforced by `i18n-completeness.test.ts` and `i18n-copy.test.ts`. The glossary's terms and `Intl` for numbers, dates and units (advice).
- **Data.** Never change the plant catalog's data (`canopi-core.db`; user rule). The `.canopi` format and local data may change unasked when that improves the project; name each change in the handoff (ADR 0021, user 2026-10-02). Canopi 2.0 has no migrations: an older `.canopi` is refused with the typed message and left unchanged, older local data is handled as ADR 0021 says, and a LiDAR catalogue bump keeps `source_meta.rs` complete. After 2.0, refuse or migrate is decided per change.
- **Reuse before writing** (ADR 0002): a geo feature's design check studies GeoLibre's design and crates first, follows them or says why not (user, 2026-10-04). Depend on light GeoLibre packages or copy its framework-free modules with attribution, never its React code. A new runtime dependency needs a bead with the reason.
- **Delete, don't deprecate.** Dead code, tests, docs and dependencies go in the change that kills them.
- **Banned:** React, Tailwind, Zustand/Redux/MobX, react-i18next (use preact, CSS Modules, `@preact/signals`, `import { t } from '../i18n'`); rusqlite pools, typeshare, string-formatted SQL; raw `rgba()`/`white`/`black` and `font-weight: 500` in CSS Modules.

## Quality gates

| Change | Run |
|---|---|
| Rust | `cargo fmt --all -- --check`; `CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings`; `CANOPI_SKIP_BUNDLED_DB=1 cargo test --workspace`; `cargo cov` above its floor; `python3 scripts/check_unused_crates.py` (validator changes: `python3 -m unittest scripts.test_check_unused_crates`) |
| A `#[tauri::command]` | `CANOPI_SKIP_BUNDLED_DB=1 cargo test -p canopi-desktop native_command_policy::tests` |
| Shared contracts (`common-types/`) | `cd desktop/web && npm run gen:types && npm run check:types` |
| Frontend | `cd desktop/web && npx tsc --noEmit && npm run test:coverage -- --maxWorkers=4 && npm run test:policies && npm run check:ui && npm run build && npm run build:web` |
| Species catalog queries | `python3 scripts/species_catalog_contract.py check` and its Python tests |
| LiDAR services | the engine lane (CI job `lidar-native`) and the comparison lane ([data library](docs/guides/data-library.md)) |
| Docs | `python3 scripts/check_docs.py` (validator changes: `python3 -m unittest scripts.test_check_docs`) |

Docs-only changes skip code gates; say so in the handoff.

## Working method

- **Beads** (`bd prime` for commands) track user-visible work, bugs and decisions, not sub-steps. Close with a receipt: what shipped, commits, gates. Commit `.beads/issues.jsonl` when bead metadata changed.
- **Branch and worktrees.** Canopi v2 lives on `feature/geolibre-adoption` until it ships; maintenance starts from `main` on an intent-named branch. Implement in a worktree under `.rq-scratch/`, never in the user's `cargo tauri dev` checkout; branch, sync, build-cache and disk mechanics: [agentic delivery](docs/guides/agentic-delivery.md#places). A step is pushed once, after its pre-push review.
- **Scope** (advice; v2 value audit). Before building a step, name the user path or roadmap item behind each planned behaviour; drop what has none. A refactor keeps what users see, not mechanisms. Never build what a later step of the release replaces; delete the old path in the change that replaces it. Specs hold contracts; briefs hold line numbers.
- **Subagents** run in parallel only on disjoint files (coupled work is one sequential stream; advice), each with explicit file ownership; none reverts another's work. A stream owns its feature's locale key namespace in all 11 locales (add, reword, delete); only the merge agent regenerates the unused-code snapshot. The main agent integrates, runs gates, closes beads and pushes.
- **Multi-agent steps** follow the `phased-agentic-delivery` skill; Canopi's places, commands, live checks and tools: [agentic delivery](docs/guides/agentic-delivery.md). Live checks drive an isolated review instance, never the user's app.
- **Commits** follow `fix(frontend): …`, `docs: …`; stage only your files; generated files go with the commit that produced them.

## Documentation

Documents answer four questions: what must never change and why (this file, ADRs); what the finished thing looks like (`.interface-design/`, its boards, the UI gallery); where an area's boundary is (one guide per area); what changed for users (release notes). Wiring lives in module comments and policy tests, not prose.

A guide changes when a rule or boundary changes, and the section is rewritten, not appended; `check_docs.py` enforces size budgets. Plans for unbuilt work sit in `docs/plans/` with a `Status:` line and are deleted when built. Docs are checked against the code each release.

## Handoff

1. Gates for the changed area passed, or are recorded as skipped with the reason.
2. Bead closed with a receipt; follow-up beads filed.
3. Affected guide, pattern, ADR or release notes updated, or the handoff says none were needed.
4. Committed, rebased, pushed (once per step); `git status --short --branch` clean and up to date.
5. Final message: bead id, commit hash, branch, gates run or skipped, user-owned files left untouched, and what to try in `cargo tauri dev`.
