# Frontend validation

Use the [frontend guide](frontend-patterns.md) to select the relevant reference.

## i18n

- All user-visible strings must go through `t()` from `../i18n`.
- Add keys to all 11 locale files: en, fr, es, pt, it, zh, de, ja, ko, nl, ru.
- `t()` is the application translation authority: every call observes `locale` and resolves through a fixed translator for that exact locale. Components must not read `locale.value` only to force translated text to rerender; keep explicit locale reads when they select localized data, drive searches, format dates, or notify imperative runtime adapters.
- Imperative Canvas Runtime chrome receives that authority through `CanvasRuntimeAppAdapter.translate`; runtime modules must not import `i18n` directly. The adapter locale subscription asks the mounted interaction session to refresh existing translated nodes in place.
- Canvas2D renderers receive `t` as a parameter; do not hardcode user-visible strings.
- Unit strings such as "yr", "d", and "in" need i18n keys. Scientific units such as mg, mm, cm, and g/g do not need translation.
- CSV and file export headers must reuse the same i18n keys as UI table headers.
- Translations should use proper diacritics; do not use ASCII approximations in locale JSON.
- Use `Intl.RelativeTimeFormat` and `Intl.DateTimeFormat` with `locale.value` for date display.


## Testing

- Add Vitest tests under `desktop/web/src/__tests__/`. The full suite also discovers existing colocated `*.test.ts` files under `src/app/` and `src/canvas/runtime/`; include those tests when auditing coverage.
- `frontend-architecture-policies.test.ts` is the declarative dependency and ownership guard. Its TypeScript source graph discovers `.ts`, `.tsx`, `.mts`, and `.cts` files recursively, parses imports and re-exports through the compiler AST, follows named/default/namespace/star and transparent imported-alias export identity, and reports the named policy, importer, and resolved target. Add a compact policy there when introducing or changing a durable module boundary; retain a source-symbol policy on a protected public barrel when wrappers must not mention a private capability, and do not add implementation-shaped substring snapshots.
- Use `source-tombstones` only for deliberately retired files and symbol policies only for durable capability ownership that imports alone cannot express. Behavior and layout belong in focused tests, not architecture policy tables.
- `css-module-policies.test.ts` discovers every CSS Module recursively in normalized path order using UTF-16 code-unit comparison, independent of locale collation. New modules are covered automatically. Raw spacing, typography, radius, and transition values need shared tokens or an exact file/at-rule/rule/property/value exception with a durable reason; duplicate, repeated-use, unexplained, and unused exceptions fail the suite. Design-scale custom properties are declared globally and must not be shadowed in a CSS Module.
- Parser behavior belongs in `architecture-harness.test.ts`. When a policy failure looks wrong, reproduce the syntax there before changing the parser or weakening a policy.
- The i18n module loads real locale files in tests; do not mock it unless the test specifically needs to.
- `i18n-completeness.test.ts` enforces exact key-tree parity with English; add and remove translation keys in all 11 locales together.
- For Vitest partial mocks of modules exporting signals, use `importOriginal` spread and override only what the test owns.
- `@preact/preset-vite` is the Vite plugin package.
- `display: flex` on `<td>` is unreliable in WebKitGTK; wrap flex content inside the cell.
