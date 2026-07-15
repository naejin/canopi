# Frontend Patterns

Use this guide when changing Preact components, signals, i18n, CSS, panels, bottom tabs, form controls, or frontend tests.

## State And Import Direction

- Reactive state uses `@preact/signals` at module level.
- Components call controllers/actions; controllers/actions mutate state.
- Controller/action modules should not import other controller/action modules.
- `currentCanvasSession` stores runtime surfaces. App code should consume command/query/document facades, not renderer internals.
- Do not preserve the legacy shortcut behavior where `unlockSelected()` unlocks all Design Objects when no selection is present. `Cmd/Ctrl+L` should affect the current editable selection only; any unlock-all behavior should be an explicit command with clear labeling.
- Grouping is a long-term canvas feature, not a shortcut-only hidden command. Selection UX should expose coherent Group/Ungroup affordances for flat Object Groups, including cross-Layer groups made from placed plants, zones, and annotations.
- `desktop/web/src/commands/registry.ts` is the public App Command Graph seam and should delegate through the internal `commands/graph` root. Internal command catalog, projection adapters, and shortcut adapter live under `desktop/web/src/commands/graph/`; chrome, component, and shortcut callers must not import that internal directory directly. `MenuBar`, `CommandPalette`, `PanelBar`, `CanvasToolbar`, and `shortcuts/manager.ts` should consume the registry seam instead of duplicating command actions, availability checks, active state, shortcut maps, or internal command definitions.
- Command execution availability and projection availability are not always identical. In particular, the Plant Database navigation command must remain runnable from the welcome/no-Design state for shortcut dispatch, while the PanelBar projection may still expose its inactive entry point as disabled when no Design is open. Active side-panel chrome must stay enabled so the user can toggle the panel closed.
- Canvas tool commands should navigate to the canvas only when invoked from a non-canvas primary panel. When `activePanel` is already `canvas`, tool changes must preserve any open side panel.

## Browser App Shell

- Web Edition v1 uses a Browser App Shell instead of the desktop `TitleBar`, `MenuBar`, native window controls, native File menu, or native Recent Design path menus. See `docs/adr/0020-web-edition-browser-app-shell.md`.
- The v1 browser shell command set is New, Open `.canopi`, Download `.canopi`, language/theme, and panel toggles. Browser Drafts remain internal autosave/recovery state; do not expose a visible Drafts command or list. Do not expose reveal-in-file-manager, updater, Problem Report, native save/save-as, direct save-back, Design Location, or desktop-style export commands in the web shell.
- The Web Edition Browser App Shell should preserve desktop chrome muscle memory: desktop-style top bar structure, menu/dropdown interaction, centered Design identity, and the right-side PanelBar pattern. Match the desktop UX shape while backing it with browser-safe shell and panel projections.
- Keep the shell thin: it should receive caller-shaped command handlers/projections from Web Edition app seams, Design Session actions, browser file/storage adapters, settings seams, and panel chrome projections rather than duplicating command availability checks or importing the desktop command registry, Tauri IPC, IndexedDB, localStorage, or browser file APIs in generic components.
- The Browser App Shell is app chrome, not website navigation and not a reduced catalog widget. It should preserve the real Canopi workspace while making explicit `.canopi` download/export clear.
- Browser-local Web Edition app data lives behind `desktop/web/src/web/browser-app-data.ts`. Its synchronous caller API projects four independent v2 storage records for Drafts, Settings, Species activity, and Saved Object Stamps; callers must not depend on keys, migration progress, or the committed authority tombstone, and must not reconstruct the former v1 aggregate. `browser-partition-storage.ts` is the sole owner of staged authority, quota reservation, cross-tab revalidation, and interrupted-finalization recovery; keep resource schemas and normalization in `browser-app-data.ts`. A valid v2 record immediately owns its resource, missing or unsupported resources read through v1, and v1 is removed only after all four records validate and the separate tombstone commits. Quota failure may keep an untransitioned resource live on v1. The compile-time browser settings adapter loads and saves the complete shared `Settings` contract through that store; `WebApp` owns only the browser Design Session autosave observer. Browser shell and Canvas settings commands mutate `app/settings/projection.ts` instead of receiving persistence callbacks or importing `localStorage`, file adapters, or app-data stores directly.
- Web Edition no-Design state should use a desktop-style Welcome Screen with New Design and Open Design actions, but omit Recent Designs/Recent Files from the browser home surface.
- Web Edition canvas mounting lives under `desktop/web/src/web/`. Use `WebCanvasWorkspace`, `WebCanvasToolbar`, and `browser-canvas-runtime.ts` instead of desktop `CanvasPanel`, `CanvasToolbar`, `BottomPanel`, `DisplayLegend`, `CommandPalette`, command registry, desktop LayerPanel, or desktop Design Session lifecycle/state-machine modules. `WebCanvasWorkspace` attaches the runtime once through `browser-design-session.ts`; resolved New/Open/Template/Draft replacements then cross the platform-neutral `app/document-session/replacement.ts` seam.
- Do not observe ordinary Web Edition `currentDesign` snapshot changes to call canvas `loadDocument()` or `replaceDocument()`. Non-canvas Design Edit changes must leave live SceneStore-owned canvas state and history intact.
- Web Edition Species UI mounts through `WebSpeciesCatalogPanel`, not the desktop `PlantDbPanel`, `FavoritesPanel`, or full `PlantDetailCard`. It consumes the shared Species Catalog Workbench projection for text search, generated Web-supported filters, active chips, detail, favorites, and recently viewed Species. Unsupported desktop-only filters are absent rather than disabled, browser-local favorites/recently viewed Species stay Web-specific, and Web Edition Plant Detail remains reduced instead of importing the desktop `PlantDetailCard`.
- At viewport widths up to 860px, `WebSpeciesCatalogPanel` collapses supported filters into a one-line summary that reports active-filter state and expands on demand. Species rows expose a touch-friendly Place action that starts Plant Stamp so the user can tap the canvas; pointer devices may also use drag/drop.
- Web Edition v1 does not mount a visible Location Workbench, Design Location panel, coordinate form, or map-picking UI. Do not add `nav.location`, `WebLocationWorkspace`, or Web imports of `app/location/coordinate-workbench.ts`; saved `.canopi` Location data should still round-trip through the document model.
- Web Edition source should stay in this repository as a browser Vite entry/build that shares app modules with desktop. `canopi-website` should publish the built artifact only and must not import shared Canopi frontend modules directly.
- Desktop and Web Edition entries should select their platform adapters at compile time. Do not put runtime `isWeb`/`isTauri` branches in shared app modules to choose IPC, browser storage, file, catalog, or shell behavior. See `docs/adr/0021-web-edition-compile-time-adapters.md`.
- Settings bootstrap follows that same composition rule: `platform/settings.desktop.ts` delegates to typed IPC, `platform/settings.browser.ts` validates browser app-data against generated Rust defaults/catalogs, and each `platform/*.ts` entry installs its adapter into the platform-neutral Settings Projection before rendering. Keep concrete storage imports out of `app/settings/projection.ts`.
- Both HTML entries own the tiny guarded `canopi-theme` cache read that sets `<html data-theme>` before module loading and first paint. `utils/theme.ts` then owns reactive DOM/cache synchronization for the active module lifetime; components and browser settings adapters must not duplicate it.
- Web Edition v1 is not offline-first. Do not add service workers, PWA install prompts, app-managed precache logic, or offline map/image promises to the browser shell without a later decision. See `docs/adr/0022-web-edition-not-offline-first.md`.

## Signals And Hooks

- Use `useSignalEffect` when subscribing to signals inside components.
- Do not put `signal.value` in a `useEffect` dependency array.
- Effects subscribe only to signals read during execution; read dependencies before conditional returns.
- Avoid signal reads before early returns when closed UI should not subscribe. Split into wrapper and inner components when hooks require it.
- Use `.peek()` in workflow effects when reading signals that should not be dependencies.
- Setting a signal to its current value is a no-op. Use a dedicated retry signal when a retry must refetch.
- Use `batch()` for action functions that write multiple signals.
- Stable empty fallbacks should be module-level constants; `currentDesign.value?.timeline ?? []` in component bodies creates a fresh array.
- `getPlacedPlants()` returns a fresh array. Do not list it directly in `useMemo` deps; use `CanvasQuerySurface.revision.scene.value` through the owning app seam as the trigger.

## Hot Paths

- Never write signals unconditionally at 60fps. Compare with `.peek()` before writing.
- Cache `getBoundingClientRect()` in pointer/hover loops.
- Desktop panel resize handles use `components/shared/usePointerResize.ts` for serialized global ownership, pointer identity, capture, document listeners, cancel/lost-capture ordering, exact body-style restoration, effective-change behavior, and layout-time owner cleanup. Keep each surface's geometry, direct DOM preview, rollback, and settings commit policy in its component; the preview callback reports whether the effective value differs from the gesture's starting value.
- Resize previews should set DOM style directly during drag and commit the final value to a signal only when a moved gesture ends. Keep the hook in the conditionally mounted handle component so closing a panel disposes an active gesture.
- Other drag owners that manage pointer capture must still guard release ordering because `releasePointerCapture()` can synchronously trigger `lostpointercapture`.
- Avoid per-frame array allocation in Canvas2D hit testing and hover paths.

## Async Surface Pattern

- When stale data intentionally remains visible while async work is in flight, separate intent state from committed data state.
- Scroll reset, virtualizer reset, and measurement reset should key off committed data revisions.
- Pagination appends should update measurements in place without forcing full resets.
- A single monotonic counter ref is enough for stale async guards in fire-and-forget effects.

## Species Catalog Filters

- Species Catalog UI modules should consume `speciesCatalogWorkbench` from `app/plant-browser/workbench.ts` for search intent/results, filter state, dynamic filter options, favorites, recently viewed Species, view mode, lifecycle, and Species detail selection. The Workbench owns those UI signals and exposes read-only reactive projections plus commands.
- Species Catalog UI modules that start Plant Stamp placement should call `canvas/plant-stamp-source.ts`; they must not assemble drag JSON or write Plant Stamp Source state directly.
- Do not reintroduce `app/plant-browser/state.ts` or `app/plant-browser/controller.ts`, and do not export lower-level search-session signals from `app/plant-browser/index.ts`. Focused Workbench implementation tests may use `createSpeciesCatalogWorkbench()`, but UI modules and broad tests should use the Workbench interface.
- `app/plant-browser/species-catalog-filters.ts` owns Species Catalog Filter behavior for strip placement, active-chip formatting, activity counts, and fixed-field adapters.
- `plantFilterModel.createEmpty()` must derive fixed filter defaults from the Species Catalog Filter catalog, not hand-list `SpeciesFilter` fields.
- Components such as `FilterStrip` and `ActiveChips` should consume `plantFilterCatalog` instead of hardcoding fixed filter rows or chip metadata.
- Strip rows should come from `stripControls()`; active chips should come from `activeArrayChipFields()`, `activeBooleanChipFields()`, and `activeNumericChipFields()`.
- Web Edition filter chrome should consume the generated Web-supported filter projection from the Web catalog adapter. Do not hardcode the current Web-supported filters in components, and do not render unsupported desktop-only filters as disabled controls.
- Always-visible choice rows should use the same natural flex-wrapping ribbon behavior as More Filters chip rows. Do not use equal-track grid layouts or strip-only chip sizing for row-height behavior; Climate Zone has enough choices that grid tracks can make the row appear fixed instead of fitting the visible ribbons.
- Keep the shared `SpeciesFilter` request shape stable unless the bead explicitly changes frontend/backend contracts.
- Dormant Site Adaptation was retired by ADR 0023. If Site Adaptation returns, implement it as a sibling Design workflow, not a mode inside the Species Catalog Workbench; it may share Species Catalog read adapters, but it must not depend on plant-browser UI state.
- `components/plant-db/` and `components/plant-detail/` are Workbench-owned UI modules. A future Site Adaptation workflow should not import them; if shared prop-only Species presentation becomes useful, extract it to a neutral module outside Workbench-owned directories.
- Web Edition v1 Plant Detail is rendered by `web/WebSpeciesCatalogPanel.tsx` from the Workbench `detail` projection and the reduced catalog reader in `web/reduced-species-catalog.ts`. It must not import `components/plant-detail/`, `app/plant-detail/`, or `ipc/species`.
- Web Edition v1 Plant Detail may show one lazy-loaded remote hero image per Species when metadata is available. Do not render source/credit/license metadata in the reduced detail surface, tolerate missing or failed images cleanly, and do not assume the desktop native image cache exists in the web build.
- Web Edition v1 Plant Detail should render only hero image, Canonical Name, Common Names, climate zone, habit or growth form, and life cycle. Hide desktop-only detail sections rather than shipping empty shells for dimensions, hardiness, uses, soil, ecology, propagation, risk, related species, or extended taxonomy.
- In the Favorites side panel, Species favorite rows should emphasize climate zone and life cycle for quick planning context, not edibility ratings or USDA hardiness shorthand. Keep botanical names available as secondary text.
- `app/plant-browser/search-session.ts` owns Species Catalog short-query policy: empty text browses with an exact count, one normalized text character clears locally without backend search, and active text searches of two or more normalized characters omit exact first-page counts so the count chip stays hidden.
- `app/plant-browser/search-session.ts` should call search adapters with the structured generated `SpeciesSearchRequest`; `ipc/species.ts` is the flat Tauri argument adapter.
- Species Catalog active text searches always use relevance ordering; browse mode uses deterministic Canonical Name ordering. Do not expose user-facing sort controls in the Species Catalog Workbench.

## Panel And Canvas Reactivity

- Location UI and map-readiness callers should consume the Location Workbench from `app/location/workbench.ts` for saved Location state, north-bearing presentation, search-result map previews, altitude-preserving map commits, saved-site summaries, and map pin/readiness helpers. Components should not import `currentDesign` or `utils/location` directly for saved-location presentation.
- Web Edition v1 omits visible Location editing entirely. The desktop Location panel owns the search-capable Location Workbench and commits a pending search preview through the map-editing host. See `docs/adr/0016-web-edition-omits-geocoding.md`.
- Location input surfaces should register their search dropdown host through the Location Workbench search lifecycle and should not install their own outside-click listeners or dispose the geocoding search controller directly.
- Location map editing uses `useLocationMapEditingHost()` from `app/location/map-editing.ts` for saved pin projection, pending search-result preview, drag clearing, initialization failure state, and map-center commits. MapLibre setup/teardown and resize observation go through the MapLibre Host; `LocationTab` should render the Location host model instead of importing MapLibre or basemap setup directly.
- Layer chrome should consume Canvas Layer Presentation from `app/canvas-layer-presentation/presentation.ts` for visible Layer rows and layer row commands. Components should not hard-code scene/map/terrain Layer authority or special-case `base`, `contours`, and `hillshading` outside that seam.
- Planning surfaces that combine Design planning entries, placed plants, and localized names should go through `desktop/web/src/app/planning-projection/`.
- Budget UI should consume the Budget Item Workbench from `app/budget/workbench.ts`; that workbench consumes Planning Projection read models and owns price draft lifecycle, currency commands, export behavior, formatting, and budget Target presentation.
- Timeline and Consortium UI should consume the Planning Projection surface hooks (`useTimelinePlanningSurface()` through the Timeline Action Workbench and `useConsortiumPlanningSurface()`) instead of importing `currentDesign`, canvas query surfaces, runtime mirror revisions, or Target presentation helpers directly.
- The Planning Projection module owns derived planning rows, Timeline Action grouping/layout read-models, Timeline species picker options, and runtime input assembly. It must not re-export or own Target Presentation lifecycle.
- Pure Target identity, resolution, domain adapters, and map projection live in `desktop/web/src/target/`. Do not reintroduce root `panel-target*` modules.
- `app/panel-targets/presentation.ts` owns Target Presentation state and origin-aware hover/selection lifecycle for Budget Item, Timeline Action, and Consortium workbenches. It is also the seam shared by the canvas runtime adapter and map surface controller. Components and adapters should not import `app/panel-targets/state.ts` directly.
- Budget, Timeline, and Consortium app modules should use origin-aware Target Presentation controllers/helpers from `app/panel-targets/presentation.ts`; they should not route hover/selection lifecycle through Planning Projection.
- Planning surfaces should use the Planning Projection runtime hooks for placed plants and localized Species names; do not read `currentCanvasQuerySurface`, `sceneEntityRevision`, or `plantNamesRevision` directly in Budget, Timeline, or Consortium UI.
- Planning views still own rendering, pointer geometry, and local edit state. Non-canvas Design writes for Location, Budget Items, Timeline Actions, and Consortiums should go through `app/design-edit/`; drag preview/commit behavior should sit behind the relevant interaction module before reaching Design Edit transactions.
- Planning Canvas Interaction Frame (`app/planning-canvas/interaction-frame.ts`) owns shared planning-surface document listener lifetime, active drag finish/abort ordering, hover/selection Target Presentation write ordering, stale visible-item cleanup, and disposal cleanup. It is separate from the Scene Interaction Session (`canvas/runtime/scene-interaction.ts`), which owns scene-canvas listeners, routing, cancellation, refresh, and teardown. Timeline and Consortium adapters supply surface-specific hit testing, geometry, local hover/selection state, drag lifecycle delegates, and form/workbench commands.
- Timeline Action add/edit/delete document mutations, drag preview transactions, and form-to-Target mapping belong in `app/design-edit/`. Timeline drag math, auto-scroll speed, and frozen-origin scroll compensation belong in `app/timeline/interaction.ts` and `app/timeline/editing.ts`.
- Timeline Action Canvas behavior lives behind `app/timeline/canvas/`. `InteractiveTimeline` should import only that directory and consume `useTimelineActionCanvasHostModel()` plus the shared Canvas2D renderer hook. `app/timeline/canvas/geometry.ts` owns row offsets, canvas height, action bounds, sidebar/ruler dimensions, and action-type row lookup; renderer and interaction-frame code should consume that geometry instead of duplicating row math. `app/timeline/canvas/host-model.ts` owns Planning Projection input assembly, canvas sizing, render callback/dependency assembly, frame listener installation, and tooltip/popover host-model projection. `app/timeline/canvas/controller.ts` owns Preact-facing interaction state, geometry/render-state refs, frame delegate assembly, and the small frame adapter seam. `app/timeline/canvas/interaction-frame.ts` owns Timeline-specific canvas input ordering, selected Timeline Action identity, popover open/save/delete orchestration, keyboard delete handling, Timeline-specific drag cleanup delegates, and composition of the Planning Canvas Interaction Frame for document listener lifetime, active drag finish/abort ordering, Target Presentation writes, and stale identity cleanup. Components should not import Timeline renderers, settings signals, interaction internals, controllers, or popover workbench helpers directly. Do not reintroduce hidden Timeline ruler-control hit testing; if Today or granularity controls return, render and hit-test explicit geometry entries from the same geometry model.
- Timeline Action popover presentation and target presentation belong in `app/timeline/workbench.ts`; app-layer timeline modules may call that seam, but components should not import Design Edit or form-mapping helpers directly.
- Consortium canvas event ordering, hover bridge behavior, drag lifecycle delegates, and the Planning Canvas Interaction Frame adapter belong in `app/consortium/workbench.ts`; shared document listener lifetime, active drag finish/abort ordering, stale hover cleanup, and Target Presentation writes route through the frame. Consortium drag preview/commit math remains in `app/consortium/interaction.ts` and crosses into Design Edit for document transactions; `ConsortiumChart` should stay a canvas host plus render call.
- Consortium Succession Phase order, Stratum order, default entry timing, label/duration keys, and phase/stratum clamping belong in `app/consortium/time-model.ts`. Canvas2D renderers and interaction modules consume that seam; they do not own those domain facts.
- Consortium lanes are derived presentation. Planning Projection should pack Consortium Entries into the fewest lanes per Stratum based on inclusive Succession Phase overlap, using saved consortium order only as a deterministic tie-breaker; lane numbers should not become saved Design state or user-managed ordering.
- Bottom panel components that read canvas-derived data must subscribe through the relevant Workbench or Planning Projection seam; app code should not import runtime mirror revision signals directly.
- Panels that only read non-canvas document state should not subscribe to canvas revisions.
- Timeline, budget, and consortium identity uses typed `PanelTarget` wire values through the Target module. Do not reintroduce string matching against descriptions, legacy plant arrays, budget descriptions, or canonical-name fields.
- Panel-origin hover/selection is presentation state and must not mutate real canvas selection, labels, dirty state, or history.
- Canvas-origin hover uses `hoveredCanvasTargets` and remains separate.
- Bottom panel height is a per-tab settings preference. Read the active resolved height through `bottomPanelView`; commit manual resize through `commitBottomPanelHeight()` so only the active Bottom Panel Tab receives the concrete height.

## Design Notebook

- In the desktop app, the Design Notebook is an app-level side panel, enabled even on the Welcome Screen. It should be exposed through the App Command Graph and PanelBar like other right-rail panels, but it is not design-dependent like Favorites.
- Web Edition v1 must not mount the Design Notebook or a visible browser-local Drafts list. Browser Drafts remain internal autosave/recovery state; do not add Notebook Sections, saved path references, file reveal actions, or notebook-style organization to the web build.
- A Design Notebook Workbench should own frontend state for saved Design references, Notebook Sections, manual ordering, active-path projection, Recent Designs, and refresh/error states. Components, MenuBar projections, and panel rows should consume that workbench instead of calling Design IPC or Recent Design controllers directly.
- Desktop File menu Recent Designs should appear as a normal `Open Recent` submenu entry below Open Design, capped to five entries. Keep the `Open Recent` entry visible but disabled when there are no Recent Designs. The parent item only opens its submenu on hover, focus, or ArrowRight; it should not open a Design directly. Recent Design submenu entries should not become palette commands or shortcut targets.
- Notebook switching must call the Design Session action seam such as `openDesignFromPath()`. The notebook panel should stay open after switching and highlight the active row by saved path, not by Design name.
- The notebook panel should use a command header plus one sectioned ledger, not a two-pane file-manager layout, search surface, notebook-view switcher, or stack of unrelated strips. The header owns the title/count and compact actions such as Add Current Design and New Section. The ledger below owns Notebook Section headers and dense rows. Follow `.interface-design/system.md`: parchment/ochre chrome, ruled separators, tokenized spacing/type, no green UI chrome, no nested card stacks.
- Notebook rows are navigation items: row click opens that Design, and dragging the row itself reorders it within a Notebook Section or moves it into another Notebook Section. Notebook Sections are reordered by dragging the section title directly. Do not add six-dot row handles, Pin/Unpin, Pinned/All views, search, section move dropdowns, or one-item overflow menus. Row actions should stay direct and minimal; Remove from Notebook is a visible delete icon and must not delete the `.canopi` Design file. Notebook Section names are renamed by double-clicking the section title; do not add a separate rename button. Do not add Reveal in File Manager until a validated backend command exists.
- Notebook entry names come from the saved Design file. Do not add a separate notebook label for a Design; only Notebook Section names are user-owned editable text.

## Saved Object Stamps

- Saved Object Stamps are personal reusable arrangements, not Design Templates and not Species favorites. Keep them in the existing Favorites side panel as a section below Species favorites; do not add a separate PanelBar route unless a later product decision changes the navigation model.
- A Saved Object Stamp Workbench should own library state, manual ordering, inline rename/delete, import/export, current-selection save, default-name generation, and placement intent. Components should consume that workbench instead of calling IPC, Design Session actions, or canvas internals directly.
- Web Edition v1 keeps Saved Object Stamps browser-local only. Do not expose Saved Object Stamp import/export in the web build.
- Saving a selection as a Saved Object Stamp should be available from the Selection Action Toolbar, the Canvas Context Menu, and the Saved Stamps section. The panel action should be enabled only when the current canvas selection can produce a saved stamp, with unavailable states explained through panel copy or tooltips.
- Default stamp names are generated once at save/import time and then become user-owned text. Use the three most frequent selected plant species names at most, displayed by localized Common Name with Canonical Name fallback; ties follow first appearance in the saved arrangement. If no plants are present, use Zone and Annotation counts.
- The Saved Stamps section should feel like part of the Favorites side panel, not a pasted-in widget: use the same header rhythm, ruled borders, dense spacing, and field-notebook chrome as Species favorites. Keep library-level Save Selection and Import commands as text buttons in the Saved Stamps frame header, and keep row-level stamp actions as icons. Use dense ledger-style rows that prioritize the user-owned stamp name, with composition counts in the secondary summary rather than fixed metric columns; do not use generated stamp codes such as `ST-01` or inline thumbnails. Put a compact six-dot reorder grip at the left; the reorder grip only reorders within the panel, while dragging the stamp body starts canvas placement. Keep right-side icon actions always visible in this order: Place, Export, Rename, Delete.
- Saved Object Stamp row clicks should be inert: hover previews the arrangement, body drag places by drag/drop, and the Place icon arms click-to-place mode. Do not use plain row click to arm placement, select a stamp, or open a detail view.
- The Favorites panel owns the Saved Object Stamp recognition thumbnail overlay. Show it beside the panel from delayed row-body hover or keyboard focus on the row body/Place action, but not from Export, Rename, Delete, inputs, delete-confirm controls, or the reorder grip. Render it as a fixed-size visual-only spatial signature from the stamp payload, without duplicating row names, counts, metadata, or actions. Start with a roughly 180px by 150px frame, clamped to the viewport, drawing the largest two or three Zones, up to about 24 representative Plants or cluster marks, and up to four Annotation strokes.
- Species favorites and Saved Stamps are sibling frames inside one Favorites side panel; do not rename the panel or navigation concept to Library. Species favorites are plants the designer reuses, Saved Stamps are arrangements the designer reuses. Use compact frame labels such as Plants and Stamps in English. In French Saved Object Stamp library copy should use planche/Planches, not tampon/Tampons; keep tampon for Plant Stamp and Object Stamp tool interactions. They share a vertically resizable split, not a primary list with a pasted-on lower widget. Store the Saved Stamps frame height as a per-user pixel preference, not Design state; default to 220px, clamp that height to the available panel space at render time, keep both Species favorites and Saved Stamps at least 120px tall, and commit manual resize at the end of the drag.
- Delete uses an inline two-step confirmation state, not `window.confirm()`. While confirming delete, keep the row in place, replace the name/summary area with concise danger copy, and show only Confirm Delete and Cancel actions. Rename uses an in-place text field; while renaming, keep Place and Export available, replace Rename with Confirm and Delete with Cancel, let Enter confirm, Escape cancel, blur confirm non-empty names, and revert empty names. Import and export actions use frontend file dialogs and remain scoped to stamp library behavior, not main Design open/save behavior.
- User-visible strings for Saved Object Stamps, including empty states, action labels, import/export status, and errors, must go through `t()` and be added to all 11 locale files.

## Design Template Import

- `app/design-template-import/workflow.ts` owns Design Template import orchestration: resolve the template asset, then hand it to the Design Session action seam.
- Design Template catalog and import resolution use compile-time adapters: `#design-template-catalog` resolves to `app/community/catalog.desktop.ts` or `app/community/catalog.browser.ts`, and `#design-template-import-workflow` resolves to `app/design-template-import/workflow.desktop.ts` or `app/design-template-import/workflow.browser.ts`. Shared Community code should import these aliases, not IPC modules or browser modules directly.
- Web Edition v1 may keep the Community/Design Template world map only for templates shipped as known static `.canopi` assets. Do not port the desktop native temp-file download assumption into the web build; template import should fetch static assets and then use the normal Design Session template-open flow. See `docs/adr/0017-web-edition-static-design-templates.md`.
- Web Edition static template configuration lives in `desktop/web/src/web/static-design-templates.ts`. The default empty set hides the Browser Shell template entry point; adding templates later requires committed `.canopi` assets or an explicitly allowed static asset origin that still passes Web Edition packaging limits.
- Web Edition v1 omits Site Adaptation, compatibility checks, and replacement suggestions. Static templates import as-is in the web build. See `docs/adr/0018-web-edition-omits-site-adaptation.md`.
- `app/community/controller.ts` owns Design Template catalog, preview, filters, selection, and import status only. It should call the Design Template import workflow instead of importing Design Session actions or `downloadTemplate` directly.
- The workflow is a sibling of Community catalog state and Design Session lifecycle; do not move catalog state into Design Session, and do not put Design Session dirty-guard ordering in the Community module.

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
- Use spacing, font-size, radius, control-size, slider, and transition tokens. Add a shared token when a visual value belongs to one of those design scales; do not hide a raw scale value behind arithmetic or a scoped custom property. Keep unavoidable structural geometry or deliberately off-scale component behavior as a narrow, reviewed policy exception.
- Icon-only chrome buttons with hover/focus tooltips should use `components/shared/ButtonTooltip.tsx` instead of native `title`, especially in rail toolbars and panel bars where locale changes must update immediately.
- Plant Symbol selection should use a separate toolbar button/popover next to Plant Color, with Plant Color first and Plant Symbol second. The symbol popover grid is icon-only with tooltips, grouped as a five-symbol Plant Habit row (`tree`, `shrub`, `herbaceous`, `climber`, `groundcover`) and a five-symbol abstract row (`round`, `square`, `triangle`, `cross`, `wave`); use explicit apply actions for selection vs species default, matching Plant Color intent.
- Plant Symbol picker options should render in neutral UI ink, with a separate preview showing the chosen symbol in the effective plant color. The toolbar button may show the current shared symbol when selected editable plants agree; mixed selections use a generic symbol affordance and explain the mixed/inherited state in the popover.
- Plant Color and Plant Symbol popovers display selected Placed Plant Common Names from the canvas query surface. They must subscribe to plant-name query revision changes so open popovers update when localized Common Names refresh after a language change.
- Plant Color and Plant Symbol popovers intentionally stop after the two explicit apply buttons: apply to the current Placed Plant selection and apply to the selected species default. Do not put clear actions or species-default hint text below those buttons.

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
- Budget CSV serialization belongs in `app/budget/export.ts`; native save-dialog and text-write I/O crosses the focused `ipc/export.ts` adapter, not the Design persistence IPC module.

## Testing

- Vitest tests live in `desktop/web/src/__tests__/`.
- `frontend-architecture-policies.test.ts` is the declarative dependency and ownership guard. Its TypeScript source graph discovers `.ts`, `.tsx`, `.mts`, and `.cts` files recursively, parses imports and re-exports through the compiler AST, follows named/default/namespace/star and transparent imported-alias export identity, and reports the named policy, importer, and resolved target. Add a compact policy there when introducing or changing a durable module boundary; retain a source-symbol policy on a protected public barrel when wrappers must not mention a private capability, and do not add implementation-shaped substring snapshots.
- Use `source-tombstones` only for deliberately retired files and symbol policies only for durable capability ownership that imports alone cannot express. Behavior and layout belong in focused tests, not architecture policy tables.
- `css-module-policies.test.ts` discovers every CSS Module recursively. New modules are covered automatically. Raw spacing, typography, radius, and transition values need shared tokens or an exact file/at-rule/rule/property/value exception with a durable reason; duplicate, repeated-use, unexplained, and unused exceptions fail the suite. Design-scale custom properties are declared globally and must not be shadowed in a CSS Module.
- Parser behavior belongs in `architecture-harness.test.ts`. When a policy failure looks wrong, reproduce the syntax there before changing the parser or weakening a policy.
- The i18n module loads real locale files in tests; do not mock it unless the test specifically needs to.
- `i18n-completeness.test.ts` enforces exact key-tree parity with English; add and remove translation keys in all 11 locales together.
- For Vitest partial mocks of modules exporting signals, use `importOriginal` spread and override only what the test owns.
- `@preact/preset-vite` is the Vite plugin package.
- `display: flex` on `<td>` is unreliable in WebKitGTK; wrap flex content inside the cell.
