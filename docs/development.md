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

## Frontend Settings Projection

Rust `Settings` from the user DB is the settings authority. The frontend mirrors those values into runtime signals through `desktop/web/src/app/settings/projection.ts`; settings-backed callers should use `mutateSettingsProjection()` with an explicit persistence mode instead of writing signals and persisting separately.

`hydrateSettingsProjection()` is the bootstrap boundary, `snapshotSettingsProjection()` maps the current projection back to Rust `Settings`, and `flushSettingsProjection()` is the teardown boundary for queued writes. The first-paint theme cache remains separate from settings authority: it may prime the theme signal before bootstrap, but Rust settings overwrite the projection when hydration completes.

## Plant Filter Field Schema

Plant filter field metadata is owned by `common-types/plant-filter-fields.json`. Run `cd desktop/web && npm run gen:types` after changing it; the generator emits the frontend adapter at `desktop/web/src/generated/plant-filter-fields.ts` and the Rust SQL allowlist adapter at `desktop/src/db/plant_filter_fields.rs`.

The frontend adapter intentionally omits SQL columns. More Filters should use `dynamicFilterFieldsForCategory()` and related helpers for grouping, strip placement, field kind, color token, and option ordering. Rust SQL filtering should continue to go through `validated_column()` and `filter_field_kind()` so the generated static allowlist remains the security boundary.

Plant-search verification when touching `desktop/web/src/app/plant-browser/*` or `desktop/web/src/components/plant-db/ResultsList.tsx`:

```bash
# Focused frontend regression tests
cd desktop/web
npx vitest run src/__tests__/results-list.test.tsx src/__tests__/plant-db-controller.test.ts
```

Manual check:
- In plant search, type a narrow prefix such as `asr`, delete back to `as`, and confirm the list expands normally without needing a locale change or list/card toggle to recover.
