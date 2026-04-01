# Frontend (Preact + Signals + CSS Modules)

## State
- All reactive state as `@preact/signals` at module level
- Canvas state syncs with Konva imperatively via `effect()`

## i18n
- ALL user-visible strings must go through `t()` from `../i18n` — no hardcoded text in components
- Add keys to all 11 locale files (en, fr, es, pt, it, zh, de, ja, ko, nl, ru) when adding new strings
- **Unit strings must be i18n keys**: Never hardcode "yr", "d", "in" etc. in NumAttr/formatters. Use `t('plantDetail.yearUnit')` pattern. Scientific units (mg, mm, cm, g/g) are universal and don't need translation

## CSS
- Design tokens in `global.css` as CSS variables (field notebook palette)
- Components use CSS Modules, reference tokens (never raw values)
- Dark theme via `[data-theme="dark"]` on `<html>`
- **No hardcoded px values**: All spacing must use `var(--space-N)` tokens (4/8/12/16/24/28/32/48px). All font-sizes must use `var(--text-*)` tokens (xs=11/sm=12/base=13/md=14/lg=16/xl=20). All border-radius must use `var(--radius-*)` tokens (sm=3/md=5/lg=7/full=9999). Control sizes must use `var(--control-size-*)` tokens (xs=20/sm=24/md=28/lg=32/xl=34/window=44). Slider dimensions must use `var(--slider-thumb-size)` (12px) and `var(--slider-track-size)` (2px). No invented sizes (6px, 10px, 14px, 22px etc.) — see `.interface-design/system.md` for the allowed scales
- **Transition timing**: Use `var(--transition-fast)` (80ms ease) for color/bg/border hover states, `var(--transition-normal)` (150ms ease) for transform/layout shifts, `var(--transition-enter)` (200ms ease-out) for panel slide/fade enter. Always use `ms` units, never `s`
- **Dark mode token audit**: When adding CSS that uses `--color-*` tokens as foreground text/border, verify the token has a dark mode override in `global.css` `[data-theme="dark"]`. Check contrast ratio >= 4.5:1 against `--color-bg`
- **Click-outside-to-close pattern**: Use `pointerup` (not `mousedown`) to avoid catching the click that opened the panel. No `setTimeout` delays — they create race conditions on rapid toggle. Controls that shouldn't dismiss open panels (e.g., locale picker) use `data-preserve-overlays="true"` — the handler checks `target.closest('[data-preserve-overlays="true"]')` before closing. See `MoreFiltersPanel.tsx`, `Dropdown.tsx`
- **No raw `white`/`black` in CSS Modules**: Use `var(--color-bg)` for white-on-colored backgrounds (badges, pills). Raw color keywords break dark mode just like raw `rgba()` does
- **Section headers**: Uppercase, `var(--text-xs)` (11px), weight 600, `0.06em` letter-spacing, `--color-text-muted`. One pattern everywhere — no 10px/12px/14px variations
- **Non-token sizes**: When a component genuinely needs a size not in the token scale (e.g., 22px swatches), define a scoped CSS custom property on the component root (e.g., `--swatch-size: 22px`) and reference it everywhere. Never scatter raw px values

## Preact / Signals Gotchas
- **Preact Vite plugin**: Package is `@preact/preset-vite` (not `@preactjs/preset-vite`)
- **HMR safety**: Module-level `effect()` and `addEventListener` must store disposers and clean up via `import.meta.hot.dispose()`
- **Signals + hooks**: Use `useSignalEffect` (not `useEffect`) when subscribing to signals inside components
- **Never put `signal.value` in a `useEffect` dependency array**: It captures the value at render time, not a live reference. It may work incidentally if `void signal.value` elsewhere triggers re-renders, but breaks silently when that line is removed. Use `useSignalEffect` instead
- **Effect subscription**: Effects only subscribe to signals **read during execution**. An early `return` before reading a signal = never re-runs. Read ALL dependencies BEFORE conditional returns
- **`void signal.value` in parent components**: Unnecessary when all child components subscribe to the signal independently. Safe to remove — children re-render on their own signal subscriptions
- **Signal retry pattern**: Setting a signal to its current value is a no-op (`Object.is` equality). To force a re-fetch, use a dedicated `retryCount` signal: read it in the effect, increment it in the retry handler
- **`CanvasHistory` truncation must mirror in both paths**: `execute()` and `record()` both trim `_past` at 500-cap. Both must set `_savedPosition = -1` when truncation passes the saved point, or dirty tracking breaks
- **`useEffect` needs a dependency array**: Omitting `[]` or `[dep]` runs the effect every render — causes listener leaks and duplicate subscriptions. Always provide explicit deps, even in Preact

## Dynamic Filter State
- **Error tracking**: `dynamicOptionsErrors` signal tracks per-locale per-field IPC errors. `DYNAMIC_OPTIONS_BACKEND_MISMATCH_ERROR` distinguishes permanent backend mismatch (field not in running binary) from transient errors (network, timeout). Only transient errors show a retry button in the UI. Errors are cleared on successful retry

## Testing (Vitest)
- **Vitest with Konva**: Requires `canvas` npm package as devDependency
- **i18n in Vitest**: The i18n module eagerly loads all 11 locale files at import time — `t()` returns real translations in tests without mocking. `locale.value` changes trigger `i18n.changeLanguage()` synchronously via module-level `effect()`
