# Frontend

This guide covers the Preact frontend in `desktop/web/src/`: state, the action layer, resource ownership, commands, workbenches, chrome, localization and tests. Visual direction lives in [the design system](../../.interface-design/system.md). Edition composition is in [editions](editions.md), document authority in [design document](design-document.md), and the map and scene runtime in [map workspace](map-workspace.md).

## Stack and layout

- Preact (`preact`, `preact/hooks`, `preact/compat`), `@preact/signals`, TypeScript, Vite (`@preact/preset-vite`), CSS Modules and i18next core. React, Tailwind, Zustand/Redux/MobX and react-i18next are banned.
- `app/` holds orchestration: actions, controllers, workbenches, workflows, Design Edit and the document session. `canvas/` is the scene runtime, `maplibre/` the map integration, `components/` the Preact UI, `web/` the Web adapters, `ipc/` the Tauri transport wrappers, `platform/` the edition roots, `generated/` the bindings output (never edited by hand) and `__tests__/` the Vitest suites.

## State and the action layer

- Reactive state is module-level `@preact/signals`. Import direction: components → actions/controllers/workbenches → Design Edit or state. `components/**` never imports `ipc/**` or `@tauri-apps/**` (native access goes through `app/` modules such as `app/shell/window-actions.ts`), and `app/**` never imports `components/**`.
- `app/*/controller.ts` and action modules are leaves. They never import each other (a policy enforces this for `app/*/controller.ts`). Cross-concern orchestration lives in workflow modules that own their `effect()` disposers behind `installX()` / `disposeX()` (for example `app/lidar/workflow.ts`, `app/consortium/workflow.ts`, `app/document-session/workflows.ts`).
- Canvas edits go through runtime commands. Non-canvas Design edits go through `app/design-edit/`. A view must not mirror an authority's state just to restyle it.
- `currentCanvasSession` (`canvas/session.ts`) holds role-specific runtime surfaces (query, command, document). App code uses those facades, never renderer internals or a raw `SceneCanvasRuntime`.
- `Cmd/Ctrl+L` affects only the current editable selection. Grouping (flat, cross-layer Object Groups) is exposed through selection affordances, not hidden shortcuts.

### Signals and hooks

- Use `useSignalEffect` in components. Never put `signal.value` in a `useEffect` dependency array.
- An effect subscribes only to the signals it reads, so read dependencies before conditional returns. Split wrapper and inner components when a closed UI should not subscribe.
- Use `.peek()` in workflow effects for non-dependencies. Use `batch()` when an action writes several signals.
- Setting a signal to its current value is a no-op. Use a dedicated retry signal to force a refetch.
- Keep stable empty fallbacks as module constants (`currentDesign.value?.timeline ?? []` in a component body makes a fresh array). `getPlacedPlants()` returns a fresh array, so key memoization on the scene revision exposed by the owning seam.

### Hot paths

- Never write signals unconditionally at 60 fps. Compare with `.peek()` first. Cache `getBoundingClientRect()` in pointer loops and avoid per-frame allocation in hit testing and hover.
- Panel resize uses `components/shared/usePointerResize.ts` (pointer identity, capture, cancel ordering, body-style restoration). Preview by setting DOM style during the drag and commit the signal at gesture end. `components/shared/usePointerReorder.ts` owns Notebook and Saved Stamp reorder gestures. `releasePointerCapture()` can fire `lostpointercapture` synchronously, so guard release ordering.

### Async surfaces

- When stale data stays visible during a load, keep intent state separate from committed data state. Scroll, virtualizer and measurement resets follow committed revisions. A monotonic counter ref is enough to guard fire-and-forget effects.
- A mutable workbench that mixes snapshot loads with writes admits writes through a local mutation tail, invalidates older load epochs and checks its lifetime after every await. Keep this inside the concrete workbench, with no generic framework.

## Resource ownership

Every resource (runtime, renderer, MapLibre instance, timer, listener, observer, worker, cancellation token, DOM overlay) has exactly one lifecycle owner for setup, update and teardown. Module-level `effect()` calls and listeners store their disposers and clean up under `import.meta.hot.dispose()`. Application-lifetime owners are installed by the platform bootstrap (`platform/desktop.ts`, `platform/browser.ts`) with stored disposers, never by a component effect. Live singletons such as the Saved Object Stamp workbench (`app/saved-object-stamps/index.ts`) and the Web catalog runtime (`app/plant-browser/browser-runtime.ts`) dispose themselves on HMR. Workbench factories stay separately testable.

## Commands and shortcuts

- `commands/registry.ts` is the public App Command Graph seam. The catalog, projections and shortcut adapter live in `commands/graph/`, which callers never import directly. `MenuBar`, `CommandPalette`, the panel bar, `CanvasToolbar` and `shortcuts/manager.ts` all consume the registry and never duplicate actions, availability, active state or shortcut maps.
- A modal dialog is modal: while the save dialog (`app/document-session/save-problem.ts`) is open, `handleAppCommandKeyDown`, the Web canvas shortcuts, the plant finder's Ctrl F and the command palette do nothing.
- Ctrl F focuses the open panel's plant finder (`app/plant-finder/focus.ts`, routed before the command graph by `shortcuts/manager.ts` and `web/canvas-shortcuts.ts`); place search is Ctrl K (`VIEW_SHORTCUTS.searchPlace`).
- `app/shell-commands/index.ts` owns platform-neutral shell command ids (`file.new`, `file.open`, `file.save`, `file.saveAs`, `file.revert`, `file.downloadCanopi`, `file.exportCanvasPdf`, `file.importGeoJson`, `file.exportGeoJson`, panel navigation), label keys, shortcut matching and chrome projection. Desktop and `web/browser-shell-commands.ts` compose it from explicit capabilities. The module stays free of Tauri, Web, IPC, persistence and settings adapters.
- Execution availability can differ from projection availability. The Plant Database command runs from the welcome state, and an active side-panel entry stays enabled so it can close.
- A canvas tool command navigates to the canvas only when it is invoked from another primary panel, and it preserves an open side panel.

## Workbenches and the dock

- `components/workspace/WorkspaceComposition.tsx` owns primary/side routing, `SidePanelDock` mounting, responsive sizing, Calendar expansion reset, lazy fallbacks and shared workspace dialogs (Canvas PDF). It validates registered surfaces against the shell projection, so command capabilities stay the authority on which panels exist. `DesktopWorkspace.tsx` and `web/WebWorkspace.tsx` are the concrete adapters.
- Panels from `app/shell-commands/index.ts`:
  - **primary:** Canvas, then Templates (Web only).
  - **design:** Plants in this Design (`species-key`), Data, Layers, Calendar, Budget, Consortium.
  - **side:** Design Notebook (Desktop), Plant Database, Favorites.
- Only one side panel is open at a time. The dock starts closed. Design-dependent entries are disabled with no Design, except an open entry, which can still close. There is no Location panel: place search is the pin button on the canvas controls (see [map workspace](map-workspace.md)).
- Layer chrome consumes `app/canvas-layer-presentation/presentation.ts`; both editions' Layers panels share `app/canvas-layer-presentation/panel-actions.ts`. The LiDAR section is Desktop-only and enters through the Desktop `LayersPanel` as `referenceItems`. Scene layers are Design edits. Basemap, Satellite, Contours and Hillshade belong to `app/map-layers/`. Data (LiDAR library and analysis) reads and mutates through `app/lidar/actions.ts`; see [data library](data-library.md).
- **Species Catalog:** UI consumes `speciesCatalogWorkbench` from `app/plant-browser/index.ts` (selected per edition through `#species-catalog-live`). Views call `mount('catalog' | 'favorites')` and release the returned disposer. Filter rows and chips come from the generated filter catalog (`app/plant-browser/species-catalog-filters.ts`). Web renders only the generated supported filters. Plant Stamp placement starts through `canvas/plant-stamp-source.ts`. Desktop and Web list and detail components stay separate; share behaviour only at the workbench or a narrow helper such as `components/plant-db/favorite-species-presentation.ts`. See [species catalog](species-catalog.md).
- **Planning:** Budget uses `app/budget/workbench.ts`, Calendar `app/timeline/calendar-workbench.ts` and Consortium `app/consortium/dock-workbench.ts`. They read derived rows from `app/planning-projection/` and write through `app/design-edit/`. Target identity lives in `target/`, and hover/selection presentation in `app/panel-targets/presentation.ts`. Panel-origin hover never touches canvas selection, dirty state or history. Consortium phase and stratum facts live in `app/consortium/time-model.ts`, civil dates in `app/timeline/civil-date.ts` and Budget CSV in `app/budget/export.ts` (delivered through `#budget-export-platform`). Optional numeric inputs use `Number.isFinite(x) && x >= 0`, never `parseFloat(v) || 0`.
- **Plants in this Design** (`SpeciesKeyPanel`, panel id `species-key`) reads runtime queries for names, codes, counts and appearance variants. Focus is Scene session state and never edits the Design. A species swatch recolours the species through the plant presentation commands; the Labels choice is the species-focus `showCodes` flag.
- **Plant finder.** Every plant list uses `components/shared/PlantFinder.tsx` over `app/plant-finder/`: `matcher.ts` is pure (a policy keeps it on the search normalization authority only) and returns hits, marked ranges and the typo correction; `use-plant-finder.ts` matches a list's species by every catalog language (`catalog-names.ts`, through the workbench's `resolveCommonNames`); `selection.ts` turns the canvas selection into the "Selected on map" filter through read-only runtime queries; `focus.ts` owns Ctrl F (the most recently mounted finder takes it; both editions' key routing call `runFindPlantsShortcut`). Only Plants in this Design rings its matches on the map: `map-matches.ts` publishes them as `matchedPanelTargets` (a highlight channel that never selects or dirties) and owns the chip's actions, Zoom to them (`focusTemporaryBounds`, camera only) and Select all (`sceneEdits.selectSpecies`). Lists keep their query and filters per Design Session in `app/planning-view/state.ts`; list filters take the matcher's key set rather than re-implementing search.
- **Design Notebook** (Desktop only) is a workbench over the user DB (`app/design-notebook/`): one sectioned ledger with manual order. Rows open Designs through the Design Session actions. Remove never deletes the file. Recent Designs appear as an `Open Recent` submenu capped at five entries.
- **Saved Object Stamps** live in the Favorites panel as a sibling frame below Species favorites (`app/saved-object-stamps/`). Row hover previews, dragging the body places, and the Place icon arms click-to-place. The handle reorders by pointer or Alt ↑/↓. Delete confirms inline. Web keeps stamps browser-local with no import or export.
- **Design Templates** are Web-only static assets (`web/static-design-templates.ts`, `app/community/controller.ts`, `app/design-template-import/`). The template entry is hidden when none are configured.

## Chrome

- Use CSS Modules with tokens from `styles/global.css`. No raw `white`, `black` or `rgba()`. Font weights 400 and 600 only. Use the spacing, type, radius, control-size and transition tokens. Dark theme is `[data-theme="dark"]` on `<html>`.
- Use `Dropdown` (with `utils/floating-position.ts`) instead of a native `<select>` and `DatePicker` instead of `<input type="date">`. Never use `window.prompt()`, `confirm()` or `alert()` (WebView blocks them). Do not wrap `Dropdown` or `DatePicker` in a native `label`.
- Icon-only buttons use `components/shared/ButtonTooltip.tsx`, not `title`, and carry an `aria-label`. Icons come from `components/canvas/toolbar-icons`, `components/shared/PanelIcon.tsx` and, for control glyphs (chevrons, check, close, search, notice icons), `components/shared/ControlIcon.tsx`.
- Interface fonts (Literata, Source Sans 3, IBM Plex Mono; latin, latin-ext and cyrillic subsets) are bundled from `@fontsource` by `styles/fonts.css`, imported by `styles/global.css`, so Desktop needs no network for them. Never load fonts from a CDN.
- Close on click-outside with `pointerup`. Controls that must not dismiss overlays carry `data-preserve-overlays="true"`. Nested Escape handling belongs on the inner dialog element. Move focus into dialogs after mount. Position floating elements synchronously.
- Preact SVG uses native attribute spellings (`stroke-width`, `clip-path`, `tabindex`).
- `display: flex` on `<td>` is unreliable in WebKitGTK, so wrap flex content inside the cell.

## Localization

- Every user-visible string goes through `t()` from `i18n`. Add each key to all 11 locale files in `desktop/web/src/i18n/`: en, fr, es, pt, it, zh, de, ja, ko, nl, ru. Use proper diacritics.
- `t()` observes `locale` itself, so components do not read `locale.value` just to re-render text. Read it only to select localized data, drive searches or format dates (`Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`).
- Runtime chrome gets translation through `CanvasRuntimeAppAdapter.translate`. Drawing code (rulers, inspection lens, PDF) receives `t` as a parameter. Runtime modules never import `i18n`.
- Unit abbreviations such as "yr", "d" and "in" need keys. Scientific units do not. CSV and file export headers reuse the UI table keys.
- Remove retired keys from every locale together, after checking generated and prefixed keys (layer ids, plant symbols, action types, strata, filter values, PDF errors).

## Tests and guardrails

- Write the failing behavioural test first. Suites live in `desktop/web/src/__tests__/` as `*.test.ts(x)`. Colocated tests under `src/app/` and `src/canvas/runtime/` also run. Test at the command or interaction boundary with real clicks, focus, keyboard and resize events.
- `frontend-architecture-policies.test.ts` is the declarative dependency and ownership guard. It parses imports and re-exports through the TypeScript AST. Add a compact named policy when you introduce a durable module boundary. Use source tombstones only for deliberately retired files. Transitive runtime-graph policies ignore type-only edges and leave `#edition` aliases unresolved, so an alias is the only allowed route to platform code; the Web entry policy (`src/main.web.tsx` must not reach `@tauri-apps/**` or `ipc/**`) maps aliases to their Web targets through `WEB_EDITION_ALIAS_TARGETS`, which a test keeps in sync with `vite.config.ts` and `tsconfig.json`. Parser behaviour belongs in `architecture-harness.test.ts`: reproduce a suspect failure there before changing the parser. Never weaken a policy to pass.
- `css-module-policies.test.ts` scans every CSS Module. Raw spacing, type, radius and transition values need a token or an exact exception with a reason. Unused or duplicate exceptions fail.
- `i18n-completeness.test.ts` enforces exact key parity across all locales. The i18n module loads real locale files, so do not mock it without a reason.
- For partial mocks of modules that export signals, spread `importOriginal` and override only what the test owns. With compat active, synthetic focus events must be `focusin`/`focusout`. Prefer real `focus()` and `blur()`.
- An unhandled error or rejection fails the run (`dangerouslyIgnoreUnhandledErrors: false` in `vite.config.ts`).
- **Coverage ratchet:** `npm run test:coverage` (run in CI) enforces the floors in `vite.config.ts` `test.coverage.thresholds`. Raise a floor when coverage rises. Never lower it.

Gates (from `desktop/web/`): `npx tsc --noEmit && npm test`. Shared composition also needs `npm run check:ui && npm run build && npm run build:web`. Visual changes need live verification in `npm run dev:ui`.
