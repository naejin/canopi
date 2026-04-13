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

# Regenerate shared transport bindings (from desktop/web/)
npm run gen:types

# Verify generated transport bindings are up to date (from desktop/web/)
npm run check:types

# Frontend tests (from desktop/web/)
npm test

# Rust workspace check (without plant DB)
CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace
```

**Gotcha**: Do not use `cargo run dev` — it passes `dev` as an app argument, not as a Tauri dev workflow.

Plant-search verification when touching `desktop/web/src/state/plant-db.ts` or `desktop/web/src/components/plant-db/ResultsList.tsx`:

```bash
# Focused frontend regression tests
cd desktop/web
npx vitest run src/__tests__/results-list.test.tsx src/__tests__/plant-db-controller.test.ts
```

Manual check:
- In plant search, type a narrow prefix such as `asr`, delete back to `as`, and confirm the list expands normally without needing a locale change or list/card toggle to recover.
