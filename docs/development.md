# Development

See root `CLAUDE.md` for the full command reference.

Key commands:

```bash
# Full app dev (from project root — NOT desktop/)
cargo tauri dev

# Frontend only (from desktop/web/)
npm run dev

# TypeScript check (from desktop/web/)
npx tsc --noEmit

# Frontend tests (from desktop/web/)
npm test

# Rust workspace check (without plant DB)
CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace
```

**Gotcha**: Do not use `cargo run dev` — it passes `dev` as an app argument, not as a Tauri dev workflow.
