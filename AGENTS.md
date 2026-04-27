# Repository Guidelines

## Project Structure & Module Organization
- `desktop/src/`: Rust Tauri backend, IPC commands, DB access, platform code, and services.
- `desktop/web/src/`: Preact frontend, canvas runtime, UI components, app controllers, and `__tests__/`.
- `common-types/`: shared Rust/TypeScript contracts. Regenerate bindings when these change.
- `bindings-gen/`: codegen for frontend transport bindings.
- `scripts/`: DB preparation and release tooling.
- `docs/`: active docs; historical material lives under `docs/archive/`.

## Build, Test, and Development Commands
- `cargo tauri dev` (repo root): run the full desktop app.
- `cd desktop/web && npm run dev`: run the frontend only with Vite.
- `cd desktop/web && npm test`: run frontend tests with Vitest.
- `cd desktop/web && npx tsc --noEmit`: TypeScript check.
- `cd desktop/web && npm run gen:types`: regenerate shared TS bindings.
- `cd desktop/web && npm run check:types`: verify generated bindings are committed.
- `CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace`: Rust workspace check without the bundled plant DB.
- `cargo test --workspace`: Rust test suite.

## Coding Style & Naming Conventions
- Follow existing file style instead of reformatting unrelated code.
- TypeScript/Preact: 2-space indentation, `PascalCase` for components, `camelCase` for functions/signals, `kebab-case` for CSS module files.
- Rust: standard Rust style (`snake_case` functions/modules, `CamelCase` types).
- Use `preact`, `preact/hooks`, and `@preact/signals`; do not introduce `react`.
- New frontend orchestration belongs under `desktop/web/src/app/*`; keep components presentation-focused.

## Testing Guidelines
- Frontend tests live in `desktop/web/src/__tests__/` as `*.test.ts` or `*.test.tsx`.
- Add focused regression tests for every bug fix, especially around document lifecycle, canvas runtime, and IPC boundaries.
- When touching shared contracts or persistence, run both `npm test` and `cargo test --workspace`.

## Commit & Pull Request Guidelines
- Match the existing commit style: `fix(frontend): ...`, `test(frontend): ...`, `docs: ...`, `refactor(backend): ...`.
- Keep commits scoped and reviewable; separate code, tests, and docs when practical.
- PRs should include: a short problem/solution summary, test commands run, and screenshots or GIFs for UI changes.

## Architecture Notes
- Canvas scene state is authoritative in the runtime; non-canvas document state is authoritative in the document layer.
- Do not reintroduce duplicate state or direct component-to-IPC workflow logic.

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
