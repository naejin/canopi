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
