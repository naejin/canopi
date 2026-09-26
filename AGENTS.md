# Agent Operating Contract

Rules for AI agents working in this repository. Optimize for long-term project health, reviewable changes and reliable handoff over local speed. Architecture: [`docs/architecture.md`](docs/architecture.md). Decisions: [`docs/adr/`](docs/adr/).

## Priorities

- Preserve user work. Run `git status --short --branch` before editing; treat pre-existing dirty or untracked files as user-owned. Never stage, revert or stash them.
- Track work in `bd` (`bd prime` for the command reference). No markdown TODO lists or other trackers. Use `bd remember` for durable project knowledge.
- Keep scope to the claimed bead; file follow-up beads for new work.
- Prefer small, reversible changes. Never weaken tests, type checks, lint rules or guardrails to pass a gate; replace a wrong guardrail with an equal or stronger one and say why.
- Add runtime dependencies only when the bead or commit explains why existing code and GeoLibre modules are insufficient.
- The user decides product, priority, scope and consequential risk. The main agent owns architectural coherence and review; see [architecture ownership](docs/workflow.md#architecture-ownership).

## The five v2 principles

1. **The map is the canvas.** Basemap, satellite, LiDAR and terrain are the background of the design surface. No separate local canvas, no Design location.
2. **Every design object is geolocated.** Files store WGS84 lon/lat; metres exist only in the runtime's session plane.
3. **Reuse GeoLibre before writing code.** Copy framework-free modules with attribution or depend on light packages; never fork the app or import its React code.
4. **No backward compatibility.** No migrations, legacy readers, compatibility shims or old-format fixtures. Old data is refused, set aside or deleted.
5. **Delete, don't deprecate.** Remove dead code, docs, tests, scripts and dependencies in the change that makes them dead.

## Repository map

- `desktop/src/`: Rust Tauri backend: IPC commands, services, DB access.
- `desktop/web/src/`: Preact frontend: `app/` orchestration and workbenches, `canvas/` scene runtime, `maplibre/` map integration, `components/`, `web/` Web adapters, `__tests__/`.
- `common-types/`: authored cross-language contracts; regenerate checked-in outputs when they change.
- `bindings-gen/`: TypeScript transport codegen. `scripts/`: DB preparation, docs check, release tooling.
- `docs/`: [documentation map](docs/README.md). `.interface-design/`: UI design system.

## Guides

- [Map workspace](docs/guides/map-workspace.md): map canvas, map layers, place search, scene runtime, renderer, interaction.
- [Design document](docs/guides/design-document.md): `.canopi` format, lifecycle, dirty state, GeoJSON, Design Edit, settings.
- [Data library](docs/guides/data-library.md): LiDAR import, display, slope, native lanes.
- [Frontend](docs/guides/frontend.md): structure, action layer, commands, chrome, localization, tests.
- [Editions](docs/guides/editions.md): Desktop/Web/gallery setup, ports, fixtures, Web publishing.
- [Species catalog](docs/guides/species-catalog.md): plant DB, query builder, FTS, translations, Web catalog.
- [PDF export](docs/guides/pdf-export.md): print layout, fonts, preview, delivery.
- [Native and release](docs/guides/native-and-release.md): native rules, build/check commands, release, problem reports.
- [Workflow](docs/workflow.md): bd, triage, branches, delivery, ownership.
- UI/UX: start at [.interface-design/system.md](.interface-design/system.md), then one pattern file. Inspect real components with `cd desktop/web && npm run dev:ui`.

Read the relevant guide before changing an area. Code shows current behaviour; accepted contracts show intended behaviour. Fix stale guidance; track a code violation of a contract in bd.

## Branch and git

- **All Canopi v2 work is on `feature/geolibre-adoption`.** Commit every v2 bead there; do not open per-bead branches. Pull with `git pull --rebase=merges` before starting and push after each bead.
- Non-v2 maintenance: start from `main`, branch by intent (`feature/`, `fix/`, `refactor/`, `test/`, `docs/`).
- Prefer a separate worktree for implementation so the user's `cargo tauri dev` checkout is not disturbed; ask the user to pull.
- Stage only files you changed. Keep generated files in the commit that produced them. Ask before stashing unrelated changes.
- Never run destructive git commands (`reset --hard`, `checkout -- <file>`) unless the user asks.
- Commit messages follow the existing style: `fix(frontend): ...`, `refactor(backend): ...`, `docs: ...`.

## Subagents

Subagents are allowed without asking for exploration, verification or disjoint implementation slices. Give each implementation subagent explicit file ownership, never let two agents edit the same file, and tell them not to revert others' changes. The main agent owns integration, review, gates, beads and push.

## Quality gates

| Change | Gates |
|---|---|
| Any Rust | `cargo fmt --all -- --check`; `CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings`; `CANOPI_SKIP_BUNDLED_DB=1 cargo test --workspace`; `CANOPI_SKIP_BUNDLED_DB=1 cargo cov` stays above the Rust coverage floor (raise it, never lower it) |
| Native commands | `CANOPI_SKIP_BUNDLED_DB=1 cargo test -p canopi-desktop native_command_policy::tests` |
| Shared contracts | `cd desktop/web && npm run gen:types && npm run check:types` |
| Frontend | `cd desktop/web && npx tsc --noEmit && npm test` (zero failures, zero unhandled errors); `npm run test:coverage` must stay above the ratchet in `vite.config.ts` (raise it, never lower it) |
| Shared composition | `cd desktop/web && npm run check:ui && npm run build && npm run build:web` |
| Species catalog contract | `python3 scripts/species_catalog_contract.py check` plus the focused Python tests |
| LiDAR | GDAL + GeoLibre ignored lanes; see the [data library guide](docs/guides/data-library.md) |
| Docs | `python3 scripts/check_docs.py` (validator changes: `python3 -m unittest scripts.test_check_docs`) |

- Write the failing behavioural test first. Bug fixes need a focused regression test. Frontend tests live in `desktop/web/src/__tests__/` as `*.test.ts(x)`.
- Docs-only changes skip code tests; say so in the handoff.
- A gate that cannot run is recorded with the exact command, reason and residual risk in the bead and handoff.

## Architecture rules

- **Authorities.** The scene runtime (`SceneStore` via `SceneCanvasRuntime`) owns design objects and mutates through runtime transactions. Design Edit (`app/design-edit/`) owns budget, currency, timeline, consortiums, description and extra. The map layer store owns map layers. Settings own last view, basemap, device key, locale and theme. Neither document authority duplicates the other; panels read canvas entities through read-only runtime queries.
- **Coordinates.** Persisted positions are lon/lat. Runtime geometry uses metres in the session plane. Camera moves never move objects.
- **Action layer.** Import direction is components → actions/controllers/workbenches → Design Edit or state. `app/*/controller.ts` modules are leaves and never import each other; cross-concern orchestration lives in workflow modules that own their `effect()` disposers (`installX()` / `disposeX()`).
- **Resource ownership.** Every resource (runtime, renderer, MapLibre instance, timer, listener, cancellation token, DOM overlay) has one lifecycle owner for setup, update and teardown. Module-level `effect()` and listeners store disposers and clean up under `import.meta.hot.dispose()`.
- **Native execution.** Every `#[tauri::command]` is registered once and is executor-backed async or a reviewed bounded synchronous command in `desktop/src/native_command_policy.rs`. No synchronous filesystem, SQLite, network, rendering, encoding, compression, process, sleeping or unbounded CPU work. Global blocking-pool calls only in `desktop/src/native_operation.rs`.
- **Species fields.** A new filterable field updates `common-types/plant-filter-fields.json`, regenerated bindings, all 11 locale files and the detail UI if shown.

## Banned patterns

- React (use `preact`, `preact/hooks`, `preact/compat`), Tailwind (use CSS Modules), Zustand/Redux/MobX (use `@preact/signals`), react-i18next (use `import { t } from '../i18n'`).
- rusqlite connection pools (use `Mutex<Connection>`), typeshare (use `specta::Type`), string-formatted SQL (use placeholders).
- Raw `rgba()` in CSS Modules (use colour tokens) and `font-weight: 500` (use 400 or 600).

## Style

Follow the surrounding file. TypeScript/Preact: 2-space indent, `PascalCase` components, `camelCase` functions and signals, `kebab-case` CSS module files. Rust: standard style. Comment only non-obvious behaviour, invariants and boundaries. UI direction (Field Atlas: parchment, ink and ochre floating over the map; no green chrome; ADR 0010) is in [.interface-design/system.md](.interface-design/system.md).

## Docs

`AGENTS.md`, `docs/architecture.md`, `docs/guides/` and `docs/workflow.md` are living docs: update them in the same change when code, commands, gates or boundaries move. Replace or delete stale text instead of adding exceptions. Record durable decisions as ADRs. No one-off bug notes here; use a test or a code comment.

## Handoff checklist

1. Gates for the changed files run and pass (or are recorded as skipped with reason).
2. Follow-up beads filed; bead closed with a receipt: what shipped, commits, tests run or skipped.
3. Affected guides, architecture and ADRs updated, or the handoff says none were needed.
4. Intended files committed (including `.beads/issues.jsonl` when bead metadata changed); pull with rebase; push.
5. `git status --short --branch` shows the branch up to date with its upstream.
6. Final message: bead id, commit hash, branch pushed, tests run or skipped, user-owned files left untouched, what to try in `cargo tauri dev`.
