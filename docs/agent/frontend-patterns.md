# Frontend Patterns

Use this guide when changing Preact components, signals, i18n, CSS, panels, bottom tabs, form controls, or frontend tests.

## State And Import Direction

- Reactive state uses `@preact/signals` at module level.
- Components call controllers/actions; controllers/actions mutate state.
- Controller/action modules should not import other controller/action modules.
- `currentCanvasSession` stores runtime surfaces. App code should consume command/query/document facades, not renderer internals.
- `unlockSelected()` intentionally unlocks all objects when no selection is present; update the shortcut behavior before changing that semantic.

## Signals And Hooks

- Use `useSignalEffect` when subscribing to signals inside components.
- Do not put `signal.value` in a `useEffect` dependency array.
- Effects subscribe only to signals read during execution; read dependencies before conditional returns.
- Avoid signal reads before early returns when closed UI should not subscribe. Split into wrapper and inner components when hooks require it.
- Use `.peek()` in workflow effects when reading signals that should not be dependencies.
- Setting a signal to its current value is a no-op. Use a dedicated retry signal when a retry must refetch.
- Use `batch()` for action functions that write multiple signals.
- Stable empty fallbacks should be module-level constants; `currentDesign.value?.timeline ?? []` in component bodies creates a fresh array.
- `getPlacedPlants()` returns a fresh array. Do not list it directly in `useMemo` deps; use `sceneEntityRevision` as the trigger.

## Hot Paths

- Never write signals unconditionally at 60fps. Compare with `.peek()` before writing.
- Cache `getBoundingClientRect()` in pointer/hover loops.
- Resize handlers should set DOM style directly during drag and commit the final value to a signal on pointer-up.
- Prefer pointer capture for resize handles and drag handles.
- Guard pointer capture cleanup with a boolean because `releasePointerCapture()` can trigger `lostpointercapture`.
- Avoid per-frame array allocation in Canvas2D hit testing and hover paths.

## Async Surface Pattern

- When stale data intentionally remains visible while async work is in flight, separate intent state from committed data state.
- Scroll reset, virtualizer reset, and measurement reset should key off committed data revisions.
- Pagination appends should update measurements in place without forcing full resets.
- A single monotonic counter ref is enough for stale async guards in fire-and-forget effects.

## Species Catalog Filters

- Species Catalog UI modules should consume `speciesCatalogWorkbench` from `app/plant-browser/workbench.ts` for search intent/results, filter state, dynamic filter options, favorites, and Species detail selection. Do not wire PlantDb/Favorites/detail UI directly to `plantSearchSession`, `selectedCanonicalName`, or favorite/dynamic-option signals unless the workbench seam is being changed.
- `app/plant-browser/species-catalog-filters.ts` owns Species Catalog Filter behavior for strip placement, active-chip formatting, activity counts, and fixed-field adapters.
- `plantFilterModel.createEmpty()` must derive fixed filter defaults from the Species Catalog Filter catalog, not hand-list `SpeciesFilter` fields.
- Components such as `FilterStrip` and `ActiveChips` should consume `plantFilterCatalog` instead of hardcoding fixed filter rows or chip metadata.
- Strip rows should come from `stripControls()`; active chips should come from `activeArrayChipFields()`, `activeBooleanChipFields()`, and `activeNumericChipFields()`.
- Keep the shared `SpeciesFilter` request shape stable unless the bead explicitly changes frontend/backend contracts.
- Site Adaptation is a sibling Design workflow, not a mode inside the Species Catalog Workbench. It may share Species Catalog read adapters, but it must not depend on plant-browser UI state.
- `app/plant-browser/search-session.ts` owns Species Catalog short-query policy: empty text browses with an exact count, one normalized text character clears locally without backend search, and active text searches of two or more normalized characters omit exact first-page counts so the count chip stays hidden.
- Species Catalog active text searches default to visible `Best match` backed by `Sort::Relevance`; explicit active-text sort selections override it, while the browse sort is preserved for empty text.

## Panel And Canvas Reactivity

- Planning surfaces that combine Design planning entries, placed plants, localized names, and Target hover/selection state should go through `desktop/web/src/app/planning-projection/`.
- The Planning Projection module owns derived planning rows, Timeline Action grouping/layout read-models, and Timeline species picker options for timeline, budget, and consortium views.
- Pure Target identity, resolution, domain adapters, and map projection live in `desktop/web/src/target/`. Do not reintroduce root `panel-target*` modules.
- `app/panel-targets/presentation.ts` owns Target presentation state and is the seam shared by Planning Projection, the canvas runtime adapter, and map surface controller. Components and adapters should not import `app/panel-targets/state.ts` directly.
- Planning surfaces should use the Planning Projection runtime hooks for placed plants and localized Species names; do not read `currentCanvasQuerySurface`, `sceneEntityRevision`, or `plantNamesRevision` directly in Budget, Timeline, or Consortium UI.
- Planning views still own rendering, pointer geometry, local edit state, and calls to feature controllers such as budget/timeline/consortium mutations. Drag preview/commit behavior should sit behind the relevant interaction module before reaching document edit transactions.
- Timeline Action date mutation and form-to-Target mapping belong in `app/timeline/editing.ts`; Timeline canvas gesture behavior, auto-scroll speed, and frozen-origin scroll compensation belong in `app/timeline/interaction.ts`.
- Timeline Action add/edit/delete popover orchestration and Timeline-owned Target presentation cleanup belong in `app/timeline/workbench.ts`; `InteractiveTimeline` should call that workbench seam instead of importing Timeline controllers or form-mapping helpers directly.
- Consortium canvas drag preview/commit behavior belongs in `app/consortium/interaction.ts`; `ConsortiumChart` should pass hit/layout snapshots to that module instead of owning document edit transactions directly.
- Bottom panel components that read canvas-derived data must subscribe to `sceneEntityRevision`.
- Panels that only read non-canvas document state should not subscribe to canvas revisions.
- Timeline, budget, and consortium identity uses typed `PanelTarget` wire values through the Target module. Do not reintroduce string matching against descriptions, legacy plant arrays, budget descriptions, or canonical-name fields.
- Panel-origin hover/selection is presentation state and must not mutate real canvas selection, labels, dirty state, or history.
- Canvas-origin hover uses `hoveredCanvasTargets` and remains separate.

## i18n

- All user-visible strings must go through `t()` from `../i18n`.
- Add keys to all 11 locale files: en, fr, es, pt, it, zh, de, ja, ko, nl, ru.
- Components using `t()` must subscribe to `locale`, either by reading `locale.value` or through renderer deps.
- Canvas2D renderers receive `t` as a parameter; do not hardcode user-visible strings.
- Unit strings such as "yr", "d", and "in" need i18n keys. Scientific units such as mg, mm, cm, and g/g do not need translation.
- CSV and file export headers must reuse the same i18n keys as UI table headers.
- Translations should use proper diacritics; do not use ASCII approximations in locale JSON.
- Use `Intl.RelativeTimeFormat` and `Intl.DateTimeFormat` with `locale.value` for date display.

## CSS And UI Chrome

- Use CSS Modules and tokens from `desktop/web/src/styles/global.css`.
- Do not use Tailwind or global component styles for new UI.
- Dark theme uses `[data-theme="dark"]` on `<html>`.
- Use CSS module `composes:` for modifier classes that mostly share a base class.
- No native `<select>` in UI chrome; use `Dropdown`.
- No native `<input type="date">` in UI chrome; use `DatePicker`.
- No `window.prompt()`, `confirm()`, or `alert()`; WebView blocks these.
- Hide WebKit search input clear buttons when using a custom clear button.
- Use `pointerup` for click-outside-to-close, not `mousedown`.
- Controls that should not dismiss overlays use `data-preserve-overlays="true"`.
- Nested overlay Escape handling belongs on the inner dialog DOM element, not a document-level listener.
- `role="dialog"` elements should focus the first interactive element after mount.
- Floating element positioning should be synchronous; avoid post-render rAF corrections that visibly snap.
- Use `Dropdown.tsx` and `utils/floating-position.ts` for viewport-aware dropdown behavior.
- Do not use raw `white`, `black`, or raw `rgba()` in CSS Modules. Use tokens.
- Use only font weights `400` and `600`.
- Use spacing, font-size, radius, control-size, slider, and transition tokens. If a component needs a one-off size, define a scoped CSS custom property.

## Canvas2D Components

- Use `components/canvas/useCanvasRenderer.ts` for DPR-aware canvas setup.
- `useCanvasRenderer` deps must include `theme.value` when renderer reads CSS theme tokens.
- Include upstream data sources in deps even if renderers consume them through refs.
- Canvas DPR sizing should use `Math.round()`.
- Use `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`, not accumulating `ctx.scale()`.
- Use `canvas2d-utils.ts` for cached `cssVar()` and `roundRect()`.
- `grid.ts` exports `NICE_DISTANCES`; derive subsets with `.filter()`, not independent copies.
- Canvas2D interactive components need `onMouseLeave` to clear hover state.
- Drag handlers should use `useCallback([])` with refs rather than signal-derived deps that re-register listeners mid-drag.

## Budget And Numeric Inputs

- Do not use `parseFloat(v) || 0` for optional numeric inputs. It conflates empty input with zero.
- Use `Number.isFinite(parsed) && parsed >= 0` style guards.
- Check entry existence with `priceMap.has(key)` when distinguishing unset from price `0`.
- Updaters must compare fields before spreading to avoid dirtying on no-op updates.

## Testing

- Vitest tests live in `desktop/web/src/__tests__/`.
- The i18n module loads real locale files in tests; do not mock it unless the test specifically needs to.
- For Vitest partial mocks of modules exporting signals, use `importOriginal` spread and override only what the test owns.
- `@preact/preset-vite` is the Vite plugin package.
- `display: flex` on `<td>` is unreliable in WebKitGTK; wrap flex content inside the cell.
