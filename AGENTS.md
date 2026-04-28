# Agent Operating Contract

These instructions are for AI agents working in this repository. Optimize for long-term project health, reviewable changes, and reliable handoff over local speed.

## Operating Priorities
- Preserve user work. Check `git status --short --branch` before editing, and treat pre-existing dirty or untracked files as user-owned unless explicitly told otherwise.
- Track all work in `bd`. Do not use markdown TODO lists, TodoWrite, TaskCreate, or ad hoc task trackers.
- Keep scope narrow. Implement the claimed bead; create follow-up beads for new work instead of silently expanding scope.
- Prefer small, reversible changes. Avoid broad rewrites unless the bead explicitly calls for one.
- Never weaken tests, type checks, lint rules, or architecture guardrails just to make a gate pass. If a guardrail is wrong, document why and replace it with an equivalent or stronger guardrail.
- Do not introduce runtime dependencies unless the bead or PR explains why existing project patterns are insufficient.

## Repository Map
- `desktop/src/`: Rust Tauri backend, IPC commands, DB access, platform code, and services.
- `desktop/web/src/`: Preact frontend, canvas runtime, UI components, app controllers, and `__tests__/`.
- `desktop/web/src/app/`: frontend orchestration and application coordination.
- `common-types/`: shared Rust and TypeScript contracts. Regenerate bindings when these change.
- `bindings-gen/`: codegen for frontend transport bindings.
- `scripts/`: database preparation and release tooling.
- `docs/`: active documentation. Historical material belongs under `docs/archive/`.

## Common Commands
- `cargo tauri dev`: run the full desktop app from the repository root.
- `cd desktop/web && npm run dev`: run the frontend only with Vite.
- `cd desktop/web && npm test`: run frontend tests with Vitest.
- `cd desktop/web && npx tsc --noEmit`: run the TypeScript check.
- `cd desktop/web && npm run gen:types`: regenerate shared TypeScript bindings.
- `cd desktop/web && npm run check:types`: verify generated bindings are committed.
- `CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace`: check the Rust workspace without the bundled plant DB.
- `cargo test --workspace`: run the Rust test suite.

## Start-of-Session Workflow
- Run `bd prime` when you need the full issue workflow or command reference.
- Run `git status --short --branch` before making changes.
- Inspect available work with `bd ready`, or inspect the requested bead with `bd show <id>`.
- Claim work before coding with `bd update <id> --claim`.
- For implementation beads, start from `main`, run `git pull --rebase`, then create a scoped branch such as `refactor/document-session-transition`.
- Direct `main` work is acceptable only for explicitly requested mainline maintenance, small docs-only updates, or repository administration.

## Branch And Git Hygiene
- Use one branch per implementation bead unless the user explicitly requests otherwise.
- Name branches by intent: `feature/...`, `fix/...`, `refactor/...`, `test/...`, or `docs/...`.
- Stage only files you intentionally changed for the bead. Do not stage unrelated dirty files.
- If unrelated tracked changes block rebase, testing, or push, ask before stashing unless the user has already approved autostash for that operation.
- Never use destructive git commands such as `git reset --hard` or `git checkout -- <file>` unless the user explicitly requests them.
- Keep generated files in the same commit as the source change that produced them.
- Use commit messages matching the existing style, for example `fix(frontend): ...`, `test(frontend): ...`, `docs: ...`, or `refactor(backend): ...`.

## Architecture Boundaries
- Canvas scene state is authoritative in the canvas runtime.
- Non-canvas document state is authoritative in the document layer.
- Do not reintroduce duplicate state, competing lifecycle owners, or direct component-to-IPC workflow logic.
- Keep Preact components presentation-focused. Put orchestration, workflow coordination, and application services under `desktop/web/src/app/*`.
- Use `preact`, `preact/hooks`, and `@preact/signals`; do not introduce `react`.
- IPC and persistence boundaries must use shared contracts instead of ad hoc transport shapes.
- When changing architecture boundaries, persistence contracts, IPC contracts, or domain language, update the relevant active docs in `docs/` or create an ADR in the same branch.

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
- Rust changes require `CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace`.
- Persistence, database, IPC, or shared type changes require the relevant frontend checks plus `cargo test --workspace`.
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
- File beads for remaining follow-up work before ending the session.
- Run the required quality gates for the files changed.
- Commit all intended changes, including `.beads/issues.jsonl` when bead metadata changed.
- Pull with rebase before pushing unless doing so would disturb user-owned work.
- Push the current branch. For feature/refactor beads, push the bead branch with upstream tracking; push `main` only for intentional mainline work.
- Run `git status --short --branch` after pushing and verify the branch is up to date with its upstream.
- Final handoff must include the bead id, commit hash, branch pushed, tests run or skipped, and any user-owned files left untouched.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
