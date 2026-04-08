# Frontend (Preact + Signals + CSS Modules)

## State
- **`unlockSelected()` is actually `unlockAll()`**: The function clears all locked objects, not just selected ones. This is intentional — the sole call site (`Ctrl+L` shortcut) uses it as a toggle: selection present → lock selected, no selection → unlock all. Do not "fix" this without updating the shortcut manager
- All reactive state as `@preact/signals` at module level
- **Two document authorities** — see root `CLAUDE.md` Document Authority Rule:
  - `SceneStore` owns canvas scene state (plants, zones, annotations, groups, layers, plant-species-colors)
  - `state/design.ts` + `state/document.ts` own non-canvas document state (consortiums, timeline, budget, `budget_currency`, location, description, extra)
- UI signals for canvas state (`selectedObjectIds`, `plantSizeMode`, `plantColorByAttr`) are mirrors of `SceneStore.session`, not authority. Prefer reading from the runtime via a query interface over syncing into standalone signals
- **Canvas seam**: App code must not reach into renderer implementations or `SceneCanvasRuntime` internals. `currentCanvasSession` stores `CanvasRuntime | null`; the old 1:1 `CanvasSession` pass-through class is gone. As the panel/map surface grows, consider splitting `CanvasRuntime` into an interaction interface (tools, selection, history) and a state-query/projection interface (entity reads for panels, bounds/features for map sync)
- **Panel target bridges are presentation-only**: Bottom-panel hover/selection uses typed `PanelTarget[]` (`hoveredPanelTargets`, `selectedPanelTargets`, `selectedPanelTargetOrigin`) and the runtime resolves them into highlights. Do not mutate real canvas selection/history or reintroduce string matching for timeline/budget/consortium identity
- **Map projection seam is pure**: `projectPanelTargetsToMapFeatures()` resolves typed targets through `resolvePanelTargets()` and `worldToGeo()`. It does not import MapLibre, write signals, or own document/canvas state; rendered overlays should consume it rather than duplicating identity logic

## ErrorBoundary
- `ErrorBoundary` class component in `components/shared/ErrorBoundary.tsx` wraps `<App />` in `main.tsx`
- Catches render-time errors only (not event handlers, async, or `setTimeout`)
- Import `ErrorInfo` from `preact` for `componentDidCatch` — don't redeclare the type inline
- **No `t()` fallback strings**: i18next with `fallbackLng: 'en'` never returns falsy for existing keys. `t('key') || 'fallback'` is dead code — use `t('key')` directly

## PanelBar State
- PanelBar is visible on the welcome screen (no design loaded) — location, plant-db, and favorites buttons are `disabled` when `currentDesign` is null. Only the canvas button is always active

## i18n
- ALL user-visible strings must go through `t()` from `../i18n` — no hardcoded text in components
- Add keys to all 11 locale files (en, fr, es, pt, it, zh, de, ja, ko, nl, ru) when adding new strings
- **Unit strings must be i18n keys**: Never hardcode "yr", "d", "in" etc. in NumAttr/formatters. Use `t('plantDetail.yearUnit')` pattern. Scientific units (mg, mm, cm, g/g) are universal and don't need translation
- **CSV/file export headers must use `t()`**: Table column headers in the UI use i18n, but export code easily misses this. Reuse the same `t()` keys for both

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

## Canvas2D Component Patterns
- **Drag handlers must use `useCallback([])` with refs**, not signal-derived deps. A `renderState` object literal in `useCallback` deps causes the callback to be a new reference every render → document-level event listeners re-register mid-drag
- **Canvas `onMouseMove` must skip during drag**: When both document-level and canvas-element `mousemove` handlers exist, the canvas handler must early-return if drag is active (`if (!dragState.current) handleMouseMove(e)`) — otherwise `handleMouseMove` fires twice per event during drag
- **Cache cumulative row offsets in a ref**: Compute `rowOffsets` via `useMemo` from `rowHeights`, store in a `rowOffsetsRef`, pass to renderers and hit-testers as an optional param — avoids per-frame array allocation at 60fps
- **Snapshot mutable values at drag start**: Values that can change mid-drag (e.g., `pxPerDay`, zoom level) must be captured in `DragState` at `mousedown`, not read live from signals during `mousemove`
- **`useMemo` for layout computation** (e.g., `buildConsortiumBars`), not inline in the component body — prevents O(n) layout work on every hover
- **`useMemo` for derived table aggregates**: Table components with inline editing (e.g., BudgetTab) must memoize `countPlants`, `buildPriceMap`, and aggregate reduces — otherwise they re-run on every keypress during editing
- **Canvas `onMouseMove` must be `useCallback`**: Both `ConsortiumChart` and `InteractiveTimeline` need `useCallback([handleMouseMove])` wrappers for the drag-guard lambda (`if (!dragState.current) handleMouseMove(e)`) — inline arrows create a new function reference per render, causing Preact to re-patch the event listener at 60fps
- **Drag cleanup must track `hasMutated`**: Add a `hasMutated: boolean` field to `DragState`, set it `true` when a mutation actually fires (e.g., `moveConsortiumEntry`, `reorderConsortiumEntry`). Both `handleMouseUp` and unmount cleanup should only call `markDocumentDirty()` if `hasMutated` is true — prevents spurious dirty marks on mousedown-then-release or mousedown-then-tab-switch without movement
- **Multi-signal action functions must use `batch()`**: When an action writes multiple signals (e.g., `openBottomPanel` writes tab + open + height), wrap in `batch()` from `@preact/signals` to prevent intermediate re-renders. Exception: 60fps hot paths where individual writes are already guarded
- **Change guards before `moveConsortiumEntry` during drag** — skip no-op updates when phase/stratum haven't changed to avoid unconditional signal writes at 60fps
- **`getPlacedPlants()` returns a fresh array reference every call** — never list it directly in `useMemo` deps. Store the result in a ref, use `sceneEntityRevision.value` as the trigger dep. Same applies to `getLocalizedCommonNames()`. See `ConsortiumChart.tsx` for the pattern
- **Action module updater wrappers must check reference identity**: Shared helpers like `updateConsortiums(updater)` that wrap `mutateCurrentDesign` must check `if (next === design.field) return design` before spreading — otherwise no-op updaters (e.g., `reorderConsortiumEntry` with same index) still create new design objects, bypassing `mutateCurrentDesign`'s identity guard and causing spurious dirty marks. This applies to ALL array methods: `.map()` and `.filter()` both always return new arrays — add `findIndex`/`some` guards before mutating
- **Upsert updaters must field-compare before spreading**: `upsertConsortiumEntry`-style functions that do `updated[idx] = entry` must compare all mutable fields first — spreading always creates a new object, bypassing `updateDesignArray`'s identity guard even when nothing changed
- **Field-compare guards must cover ALL `TimelineAction` fields**: `updateTimelineAction`'s identity guard compares every field including `targets` and `depends_on` (reference equality). Omitting array fields causes silent data loss when a future caller patches only those fields
- **60fps resize must bypass signals**: Panel resize handlers must set height directly on a DOM ref during drag (`panelRef.current.style.height`), NOT write to a signal at 60fps. Commit the final value to the signal via a dedicated action (e.g., `commitBottomPanelHeight`) on mouseup only — prevents parent re-rendering all children at 60fps during drag
- **Cache `getBoundingClientRect()` in a ref for hover path**: Use `cachedRectRef = useRef<DOMRect | null>(null)` invalidated by `ResizeObserver`. In `handleMouseMove`: `drag?.cachedRect ?? (cachedRectRef.current ??= canvas.getBoundingClientRect())`. Avoids forced layout reflow at 60fps during hover. Both `ConsortiumChart` and `InteractiveTimeline` follow this pattern
- **Resize handles must use pointer capture**: Use `setPointerCapture()`/`lostpointercapture` on the handle element instead of document-level `mousemove`/`mouseup` listeners — guarantees cleanup even when mouse is released outside the browser window. See `BottomPanel.tsx` `ResizeHandle`
- **`Date.now()` in `useMemo`-feeding functions defeats memoization**: If a function's result feeds into `useMemo` deps, using `Date.now()` as a seed makes the dep non-deterministic → continuous redraw. Use `Infinity` with a stable fallback instead
- **Canvas2D interactive components must have `onMouseLeave`**: Both `ConsortiumChart` and `InteractiveTimeline` use `hoveredX` signals for hover highlight — if the pointer exits the canvas without a final no-hit `mousemove` (fast exit between frames), the signal stays non-null. Add `onMouseLeave` with a `useCallback([])` that clears hover signals and resets `cursor` to `'default'`
- **`localeCompare()` in sort functions needs `locale.value` as a useMemo dep**: When `countPlants` or similar sort helpers use `.localeCompare()` (which implicitly reads the browser locale), the calling component's `useMemo` must include `locale.value` in its deps — otherwise sort order is stale after locale switch
- **`useCanvasRenderer` ResizeObserver must use `cachedRectRefInternal.current.ref`** (not the direct `cachedRectRef` parameter) to stay consistent with the `doRedraw` ref indirection — the parameter is captured at mount time, the internal ref tracks the latest value
- **Document-level `keydown` handlers must guard with `isEditableTarget(event.target)`** from `canvas/runtime/interaction/pointer-utils.ts` — prevents capturing Delete/Backspace/etc. when the user is typing in form inputs. Import the shared utility; do not inline the check

## Shared Utilities
- **`canvas/plant-grouping.ts`**: `groupPlantsBySpecies(plants, localizedNames)` — shared between `budget-helpers.ts` (BudgetTab) and `consortium-renderer.ts`. Do not duplicate plant-counting loops
- **`Intl.NumberFormat` must be cached**: Construction is expensive (~0.5ms each). `budget-helpers.ts` caches formatters per currency string in a module-level `Map`. Do not create `new Intl.NumberFormat()` in render loops

## Canvas Overlay Styling
- Canvas runtime overlay modules (`.ts`, not `.tsx`) use **inline styles with CSS custom properties** — no CSS Module imports from plain `.ts` files (only `.tsx` components use CSS Modules in this project)

## Preact / Signals Gotchas
- **Stale async guard: one monotonic counter ref is enough**: For async effects that fire-and-forget (image loads, IPC calls), a single `useRef` counter incremented on each effect run guards against all staleness — across both prop changes and internal state changes. Don't layer a second ref tracking the prop value; the counter already subsumes it
- **JSX `onWheel` is passive by default**: Browsers register JSX wheel handlers as passive — `preventDefault()` silently fails. Use imperative `addEventListener('wheel', handler, { passive: false })` in a `useEffect` instead
- **Signal reads before early returns subscribe unnecessarily**: `const height = signal.value` before `if (!open) return null` subscribes the component even when closed. Move signal reads to after the guard. When `useRef` or other hooks prevent moving reads below the guard, split into a thin wrapper (reads only the guard signal, returns `null` or `<Inner />`) and an inner component (reads the rest). See `BottomPanel.tsx` for the pattern
- **Interface parameter types must match implementation invariants**: If a method throws on null, the type must be non-null — push the guard to call sites for compile-time safety instead of runtime assertions. See `serializeDocument` in `runtime.ts`
- **Preact Vite plugin**: Package is `@preact/preset-vite` (not `@preactjs/preset-vite`)
- **HMR safety**: Module-level `effect()` and `addEventListener` must store disposers and clean up via `import.meta.hot.dispose()`
- **Signals + hooks**: Use `useSignalEffect` (not `useEffect`) when subscribing to signals inside components
- **Never put `signal.value` in a `useEffect` dependency array**: It captures the value at render time, not a live reference. It may work incidentally if `void signal.value` elsewhere triggers re-renders, but breaks silently when that line is removed. Use `useSignalEffect` instead
- **Effect subscription**: Effects only subscribe to signals **read during execution**. An early `return` before reading a signal = never re-runs. Read ALL dependencies BEFORE conditional returns
- **`void signal.value` in parent components**: Unnecessary when all child components subscribe to the signal independently. Safe to remove — children re-render on their own signal subscriptions
- **`locale.value` in Canvas2D components**: Prefer adding `locale.value` to `useCanvasRenderer` deps over `void locale.value` at component top-level — it's more explicit about what triggers the redraw and avoids a full component re-render
- **`updateDesignArray<K>()` in `document-mutations.ts`** is the generic helper for mutating array fields on `CanopiFile`. Action modules should use it instead of duplicating the identity-guard + spread pattern. Pass `options` through directly — don't re-evaluate `markDirty !== false`
- **Signal retry pattern**: Setting a signal to its current value is a no-op (`Object.is` equality). To force a re-fetch, use a dedicated `retryCount` signal: read it in the effect, increment it in the retry handler
- **`SceneHistory` truncation must mirror in both paths**: `execute()` and `record()` both trim `_past` at 500-cap. Both must set `_savedPosition = -1` when truncation passes the saved point, or dirty tracking breaks
- **Stable empty fallback in component bodies**: `currentDesign.value?.timeline ?? []` creates a new reference every render, defeating `useMemo`. Use a module-level `const EMPTY_ACTIONS: T[] = []` as the fallback. This applies equally to `useMemo` deps — `design?.budget ?? []`, `session?.getPlacedPlants() ?? []`, and `session?.getLocalizedCommonNames() ?? new Map()` all need module-level stable constants (`EMPTY_BUDGET`, `EMPTY_PLANTS`, `EMPTY_NAMES`)
- **Vitest partial mocks + signals**: When `vi.mock` replaces a module that exports signals, use `importOriginal` spread (`vi.mock(path, async (importOriginal) => ({ ...await importOriginal(), ...overrides }))`) — partial mocks that omit signal exports cause "no export defined" errors in downstream effect consumers
- **`useEffect` needs a dependency array**: Omitting `[]` or `[dep]` runs the effect every render — causes listener leaks and duplicate subscriptions. Always provide explicit deps, even in Preact
- **`display: flex` on `<td>` is unreliable in WebKitGTK**: Wrap flex content in a `<div>` inside the `<td>` — don't apply flex directly to table cells
- **Pointer capture cleanup needs a guard boolean**: `releasePointerCapture()` in `pointerup` causes `lostpointercapture` to fire — cleanup runs twice without a `let cleaned = false` guard. Both `onUp` and `onLost` call `cleanup(true)`, so the guard prevents double `persistCurrentSettings` writes
- **No `Math.max(...array.map())` for unbounded arrays**: Spread passes each element as a function argument — blows the call stack on large arrays. Use a `for` loop: `let max = -1; for (const a of arr) if (a.val > max) max = a.val`
- **Dropdown `menuDirection`**: Use `"up"` for controls at screen bottom (canvas bar), `"down"` for controls inside panel headers. Match direction to available space, not habit

## Dynamic Filter State
- **Error tracking**: `dynamicOptionsErrors` signal tracks per-locale per-field IPC errors. `DYNAMIC_OPTIONS_BACKEND_MISMATCH_ERROR` distinguishes permanent backend mismatch (field not in running binary) from transient errors (network, timeout). Only transient errors show a retry button in the UI. Errors are cleared on successful retry

## Plant Detail Sections
- **Extracted section components**: `UsesSection.tsx` and `RiskDistributionSection.tsx` are standalone components extracted from `PlantDetailCard.tsx`. Each owns its visibility guard, takes `d: SpeciesDetail` + `expanded: Set<string>` + `onToggle` props, imports `PlantDetail.module.css`. Follow this pattern when extracting more sections to reduce the monolith
- **Image source display**: `PhotoCarousel.tsx` maps raw `species_images.source` values to display names via `IMAGE_SOURCE_DISPLAY` constant (proper nouns, not i18n). Add new sources there when canopi-data introduces them

## Testing (Vitest)
- **i18n in Vitest**: The i18n module eagerly loads all 11 locale files at import time — `t()` returns real translations in tests without mocking. `locale.value` changes trigger `i18n.changeLanguage()` synchronously via module-level `effect()`
