# Agent Operating Contract

These instructions are for AI agents working in this repository. Optimize for long-term project health, reviewable changes, and reliable handoff over local speed.

## Operating Priorities

- Preserve user work. Run `git status --short --branch` before editing, and treat pre-existing dirty or untracked files as user-owned unless explicitly told otherwise.
- Track implementation work in `bd`. Do not use markdown TODO lists, TodoWrite, TaskCreate, or ad hoc task trackers.
- Keep scope narrow. Implement the claimed bead; create follow-up beads for new work instead of silently expanding scope.
- Prefer small, reversible changes. Avoid broad rewrites unless the bead explicitly calls for one.
- Never weaken tests, type checks, lint rules, or architecture guardrails just to make a gate pass. If a guardrail is wrong, document why and replace it with an equivalent or stronger guardrail.
- Do not introduce runtime dependencies unless the bead or PR explains why existing project patterns are insufficient.

## Agent Docs Maintenance

- Treat `AGENTS.md` and `docs/agent/*.md` as living operating docs, not append-only notes.
- Update agent docs in the same change when code moves, architecture boundaries change, commands change, quality gates change, or a repeated gotcha becomes a durable rule.
- Prefer replacing or deleting stale instructions over adding exceptions. If two rules conflict, resolve the conflict before ending the work.
- Keep `AGENTS.md` focused on repo-wide rules. Put subsystem-specific details in `docs/agent/*.md` and link to them from here.
- Do not add one-off bug memories to `AGENTS.md`. Add a regression test, a code comment near the invariant, or a focused subsystem note instead.
- Before closing an implementation bead, check whether the change invalidates `AGENTS.md` or `docs/agent/*.md`.
- In the final handoff, mention agent-doc updates made, or explicitly say none were needed when the work changed architecture, commands, generated files, or quality gates.

## Repository Map

- `desktop/src/`: Rust Tauri backend, IPC commands, DB access, platform code, and services.
- `desktop/web/src/`: Preact frontend, canvas runtime, UI components, app controllers, and `__tests__/`.
- `desktop/web/src/app/`: frontend orchestration and application coordination.
- `common-types/`: shared Rust and TypeScript contracts. Regenerate bindings when these change.
- `bindings-gen/`: codegen for frontend transport bindings.
- `scripts/`: database preparation and release tooling.
- `docs/agent/`: subsystem-specific guidance for future agents.
- `.interface-design/`: design system documentation.

## Subsystem Guides

- [Document lifecycle](docs/agent/document-lifecycle.md): document authority, save/load, dirty state, settings persistence.
- [Frontend patterns](docs/agent/frontend-patterns.md): Preact, signals, i18n, CSS, UI behavior, testing gotchas.
- [Canvas runtime](docs/agent/canvas-runtime.md): runtime seams, scene ownership, rendering, interaction, panel target projection.
- [MapLibre](docs/agent/maplibre.md): basemap and terrain integration, projection, camera sync.
- [Database](docs/agent/database.md): plant DB schema, query builder, FTS, translations, canopi-data export.
- [Build and release](docs/agent/build-release.md): build commands, release workflow, platform/native rules.

Read the relevant subsystem guide before changing that area. If a guide disagrees with current code, trust the code, fix the guide, and note it in the handoff.

## Common Commands

```bash
# Full app dev, from project root
cargo tauri dev

# Frontend only, from desktop/web
npm run dev

# Frontend tests
cd desktop/web && npm test

# TypeScript check
cd desktop/web && npx tsc --noEmit

# Rust formatting check matching CI
cargo fmt --all -- --check

# Rust lint gate matching CI
CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings

# Regenerate shared TypeScript bindings
cd desktop/web && npm run gen:types

# Verify generated bindings are committed
cd desktop/web && npm run check:types

# Rust workspace check without plant DB
CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace

# Rust tests
cargo test --workspace

# Generate plant DB
python3 scripts/prepare-db.py

# Build release
cargo build --release
```

## Start Workflow

1. Run `bd prime` when you need the full issue workflow or command reference.
2. Run `git status --short --branch` before making changes.
3. For implementation work, inspect available work with `bd ready`, or inspect the requested bead with `bd show <id>`.
4. Claim implementation work before coding with `bd update <id> --claim`.
5. For implementation beads, start from `main`, run `git pull --rebase`, then create a scoped branch such as `refactor/document-session-transition`.
6. Direct `main` work is acceptable only for explicitly requested mainline maintenance, small docs-only updates, or repository administration.
7. Reviews, planning, diagnostics, and purely advisory work do not require a bead, branch, commit, or push unless files change.

## Branch And Git Hygiene

- Use one branch per implementation bead unless the user explicitly requests otherwise.
- Name branches by intent: `feature/...`, `fix/...`, `refactor/...`, `test/...`, or `docs/...`.
- Stage only files intentionally changed for the bead. Do not stage unrelated dirty files.
- If unrelated tracked changes block rebase, testing, or push, ask before stashing unless the user has already approved autostash for that operation.
- Never use destructive git commands such as `git reset --hard` or `git checkout -- <file>` unless the user explicitly requests them.
- Keep generated files in the same commit as the source change that produced them.
- Use commit messages matching the existing style, for example `fix(frontend): ...`, `test(frontend): ...`, `docs: ...`, or `refactor(backend): ...`.

## Coding Style

- Follow existing file style; do not reformat unrelated code.
- TypeScript and Preact use 2-space indentation.
- Preact components use `PascalCase`; functions and signals use `camelCase`; CSS module files use `kebab-case`.
- Rust follows standard Rust style: `snake_case` for functions/modules and `CamelCase` for types.
- Add comments only when they clarify non-obvious behavior, invariants, or architecture boundaries.

## Quality Gates

- Docs-only changes do not require code tests, but the final handoff must say tests were skipped because the change was docs-only.
- Frontend tests live in `desktop/web/src/__tests__/` as `*.test.ts` or `*.test.tsx`.
- Bug fixes require focused regression tests, especially around document lifecycle, canvas runtime, IPC boundaries, persistence, and shared contracts.
- Frontend changes require `cd desktop/web && npx tsc --noEmit` and focused Vitest coverage.
- Run `cd desktop/web && npm test` when the frontend surface area is broad or the change touches shared runtime behavior.
- Shared contract changes require `cd desktop/web && npm run gen:types` and `cd desktop/web && npm run check:types`.
- Rust changes require `cargo fmt --all -- --check`, `CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings`, and `CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace`.
- Persistence, database, IPC, or shared type changes require the relevant frontend checks plus `cargo test --workspace`.
- Before pushing Rust, shared-contract, or mixed architecture branches, rebase or pull onto latest `main` and rerun the relevant CI-parity gates after that rebase.
- If `main` already fails formatting, Clippy, generated-binding, or typecheck gates, create a separate maintenance bead and land the baseline repair before rebasing feature branches. Do not hide pre-existing gate repairs inside unrelated feature commits.
- If a required gate cannot be run, record the exact command, failure reason, and residual risk in the bead and final handoff.

## Subagent Rules

- Use subagents only when the user explicitly asks for delegation or parallel agent work.
- Use subagents for bounded exploration, independent verification, or disjoint implementation slices.
- Give each implementation subagent explicit file or module ownership.
- Do not let two agents edit the same files in parallel.
- Tell subagents they are not alone in the codebase and must not revert other agents' or user changes.
- The main agent remains responsible for integration, final review, quality gates, bead updates, and push.

## Bead Lifecycle

- Keep the bead status accurate: claim before coding, update when scope changes, and close only after acceptance criteria and local quality gates are satisfied.
- Create follow-up beads for deferred work, discovered bugs, missing tests, or architectural cleanup that is outside the current scope.
- Use `bd remember` for durable project knowledge. Do not create memory files.
- When closing a bead, include a concrete reason that mentions the shipped outcome and any tests run or skipped.

## Handoff Expectations

- File beads for remaining follow-up work before ending an implementation session.
- Run the required quality gates for the files changed.
- Commit all intended changes, including `.beads/issues.jsonl` when bead metadata changed.
- Pull with rebase before pushing unless doing so would disturb user-owned work.
- Push the current branch. For feature/refactor beads, push the bead branch with upstream tracking; push `main` only for intentional mainline work.
- Run `git status --short --branch` after pushing and verify the branch is up to date with its upstream.
- Final handoff for committed work must include the bead id, commit hash, branch pushed, tests run or skipped, and any user-owned files left untouched.

## Project Overview

### Tech Stack

- Backend: Rust workspace (Tauri v2 + rusqlite + specta)
- Frontend: Preact + `@preact/signals` + TypeScript + Vite + CSS Modules
- Canvas: PixiJS primary renderer + Canvas2D fallback, scene-owned runtime via `SceneCanvasRuntime`
- i18n: i18next core, not react-i18next, with 11 UI languages
- Maps: MapLibre GL JS + maplibre-contour
- Native: lib-c on Linux, macOS/Windows stubs

### Current Layout

- Left: canvas toolbar with drawing tools, plant color action, and grid/snap/ruler toggles.
- Center: canvas workspace.
- Right: `PanelBar` plus sliding plant search and favorites panels.
- Bottom: bottom panel with Timeline, Budget, and Consortium tabs.
- Title bar: logo, file name, lang/theme toggle, menu controls, and window controls.
- Legacy activity/status bar components may exist in the tree; check `App.tsx` before assuming a component is mounted.

### Design Direction

- Field notebook aesthetic: parchment, ink, ochre palette. Use `desktop/web/src/styles/global.css` tokens.
- Green never belongs in UI chrome; green is reserved for canvas plant symbols. UI accent is ochre `#A06B1F`.
- Theme is light/dark only, no system option.
- Depth is borders-first, without dramatic shadows.

## Architecture Rules

### Document Authority

- The `.canopi` file has two authorities.
- Canvas scene state is owned by `SceneStore`: plants, zones, annotations, groups, plant species colors, and layers. Mutations flow through the canvas runtime.
- Non-canvas document state is owned by the document layer: consortiums, timeline, budget, `budget_currency`, location, description, and extra. Mutations flow through `mutateCurrentDesign()` plus feature controllers under `app/*/controller.ts`.
- Save composition happens through the document-session/runtime boundary and the canvas document surface. Neither authority should duplicate the other's data.
- Panels that read canvas entities should use read-only runtime query surfaces, not mirrored signals, unless the guide documents an intentional mirror.

### Action Layer

- Controller/action modules must not import other controller/action modules. Write boundaries under `app/*/controller.ts` should stay leaf modules.
- Import direction is components -> actions/controllers -> state.
- Cross-concern orchestration belongs in a higher workflow module, such as `app/document-session/workflows.ts`, not in leaf action modules.
- Workflow modules that install `effect()` own their disposer with an `installX()` / `disposeX()` module-level singleton.

### Resource Ownership

- Every resource-owning surface must have one explicit lifecycle owner for setup, update, and teardown.
- Applies to canvas runtime, renderer host, MapLibre instances, timers, listeners, async cancellation tokens, and DOM overlays.
- Module-level `effect()` and `addEventListener` must store disposers and clean up via `import.meta.hot.dispose()` when used under Vite HMR.

## Before Writing Code

- Explore the codebase first with `rg`/`rg --files` and read the files you will reference or edit.
- Use external docs only when changing library/API behavior or when local code is insufficient. Prefer official docs.
- If Context7, taoki, `/simplify`, or other assistant-specific tools are available, use them only when they help; do not block on them when they are absent.
- For UI work, reference the Design Direction section and existing CSS tokens before adding styles.
- For multi-phase or delegated work, define file ownership so only one writer edits a file at a time.
- For multi-feature i18n work, batch all i18n keys in one early phase to reduce 11-file merge conflicts.
- When adding a new filterable species field, update the backend column validation, query filter kind, generated/registry frontend metadata, all 11 locale files, and detail UI if the field is shown there.

## Banned Patterns

- No React: import from `preact`, `preact/hooks`, or `preact/compat`, never `react`.
- No Konva. Canvas rendering goes through `SceneCanvasRuntime` + `RendererHost`.
- No Tailwind. Use CSS Modules.
- No Zustand/Redux/MobX. Use `@preact/signals`.
- No react-i18next. Use `import { t } from '../i18n'`.
- No connection pools for rusqlite. Use `Mutex<Connection>`.
- No typeshare. Use `specta::Type`.
- No string-formatted SQL. Use prepared statements with placeholders.
- No raw `rgba()` in CSS Modules. Use color tokens.
- No `font-weight: 500`. Use `400` or `600`.
