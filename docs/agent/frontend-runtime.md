# Frontend runtime

Use the [frontend guide](frontend-patterns.md) to select the relevant reference.

## State And Import Direction

- Reactive state uses `@preact/signals` at module level.
- Components call controllers/actions; controllers/actions mutate state.
- Controller/action modules should not import other controller/action modules.
- `currentCanvasSession` stores runtime surfaces. App code should consume command/query/document facades, not renderer internals.
- Do not preserve the legacy shortcut behavior where `unlockSelected()` unlocks all Design Objects when no selection is present. `Cmd/Ctrl+L` should affect the current editable selection only; any unlock-all behavior should be an explicit command with clear labeling.
- Grouping is a long-term canvas feature, not a shortcut-only hidden command. Selection UX should expose coherent Group/Ungroup affordances for flat Object Groups, including cross-Layer groups made from placed plants, zones, and annotations.
- `desktop/web/src/commands/registry.ts` is the public App Command Graph seam and should delegate through the internal `commands/graph` root. Internal command catalog, projection adapters, and shortcut adapter live under `desktop/web/src/commands/graph/`; chrome, component, and shortcut callers must not import that internal directory directly. `MenuBar`, `CommandPalette`, `PanelBar`, `CanvasToolbar`, and `shortcuts/manager.ts` should consume the registry seam instead of duplicating command actions, availability checks, active state, shortcut maps, or internal command definitions.
- Platform-neutral shell command identity, label keys, shortcut matching, ordering, and chrome projection live in `app/shell-commands/`. The Desktop command catalog and `web/browser-shell-commands.ts` compose that catalog from explicit capabilities; native Open/Save/Exit and browser Open/Download remain distinct capabilities. Desktop keyboard dispatch matches the composed catalog instead of maintaining File or Panel command switches. Keep the neutral module free of Tauri, Web, IPC, persistence, and settings adapters.
- Command execution availability and projection availability are not always identical. In particular, the Plant Database navigation command must remain runnable from the welcome/no-Design state for shortcut dispatch, while the PanelBar projection may still expose its inactive entry point as disabled when no Design is open. Active side-panel chrome must stay enabled so the user can toggle the panel closed.
- Canvas tool commands should navigate to the canvas only when invoked from a non-canvas primary panel. When `activePanel` is already `canvas`, tool changes must preserve any open side panel.


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
- Mutable Workbenches that combine snapshot loads with writes must admit writes through a local mutation tail, invalidate older load epochs when a write is admitted, and check their lifetime after every await before publishing. Keep that coordination inside the concrete Workbench; do not introduce a generic Workbench framework.


## Panel And Canvas Reactivity

- Location UI and map-readiness callers should consume the Location Workbench from `app/location/workbench.ts` for saved Location state, north-bearing presentation, search-result map previews, altitude-preserving map commits, saved-site summaries, and map pin/readiness helpers. Components should not import `currentDesign` or `utils/location` directly for saved-location presentation.
- Web Edition v1 omits visible Location editing entirely. The desktop Location panel owns the search-capable Location Workbench and commits a pending search preview through the map-editing host. See `docs/adr/0016-web-edition-omits-geocoding.md`.
- Location input surfaces should register their search dropdown host through the Location Workbench search lifecycle and should not install their own outside-click listeners or dispose the geocoding search controller directly.
- Location map editing uses `useLocationMapEditingHost()` from `app/location/map-editing.ts` for saved pin projection, pending search-result preview, drag clearing, initialization failure state, and map-center commits. MapLibre setup/teardown and resize observation go through the MapLibre Host; `LocationTab` should render the Location host model instead of importing MapLibre or basemap setup directly.
- Layer chrome should consume Canvas Layer Presentation from `app/canvas-layer-presentation/presentation.ts` for visible Layer rows and layer row commands. Components should not hard-code scene/map/terrain Layer authority or special-case `base`, `contours`, and `hillshading` outside that seam.
- Planning surfaces that combine Design planning entries, placed plants, and localized names should go through `desktop/web/src/app/planning-projection/`.
- Budget UI should consume the Budget Item Workbench from `app/budget/workbench.ts`; that workbench consumes Planning Projection read models and owns price draft lifecycle, currency commands, export behavior, formatting, and Budget Target presentation.
- Calendar UI should consume `app/timeline/calendar-workbench.ts`; it owns editor drafts, civil-date form mapping, completion commands, Target presentation, and predecessor-Design guards. Calendar date grouping and month-grid inputs belong in Planning Projection; civil-date parsing and arithmetic belong in `app/timeline/civil-date.ts`.
- Consortium dock UI should consume `app/consortium/dock-workbench.ts`; it owns row editor drafts, matrix/list filters, Target presentation, and predecessor-Design guards. Fixed matrix counts and grouped rows belong in Planning Projection.
- The Planning Projection module owns derived planning rows, Calendar grouping, target labels and picker options, Budget ledger rows, and Consortium matrix/list read models. It must not re-export or own Target Presentation lifecycle.
- Cross-mount planning view state belongs to `app/planning-view/state.ts` and is scoped to `DesignSessionStore.sessionIdentity`. Components and workbenches keep edit drafts outside that owner.
- Pure Target identity, resolution, domain adapters, and map projection live in `desktop/web/src/target/`. Do not reintroduce root `panel-target*` modules.
- `app/panel-targets/presentation.ts` owns Target Presentation state and origin-aware hover/selection lifecycle for Budget Item, Timeline Action, and Consortium workbenches. It is also the seam shared by the canvas runtime adapter and map surface controller. Components and adapters should not import `app/panel-targets/state.ts` directly.
- Budget, Calendar, and Consortium app modules should use origin-aware Target Presentation controllers/helpers from `app/panel-targets/presentation.ts`; they should not route hover/selection lifecycle through Planning Projection.
- Planning surfaces should use the Planning Projection runtime hooks for placed plants and localized Species names; do not read `currentCanvasQuerySurface`, `sceneEntityRevision`, or `plantNamesRevision` directly in Budget, Calendar, or Consortium UI.
- Planning panels own DOM rendering and local edit state. Non-canvas Design writes for Location, Budget Items, Timeline Actions, and Consortiums go through `app/design-edit/`.
- Timeline Action create/update/delete and form-to-Target mapping belong in `app/design-edit/`. The Calendar workbench invokes that seam; Calendar components do not import Design Edit or raw Design Session state.
- Consortium Succession Phase order, Stratum order, default entry timing, label/duration keys, and phase/stratum clamping belong in `app/consortium/time-model.ts`. The matrix, compact rows, and editor consume that seam; they do not copy the phase facts.
- Right-dock planning components that read canvas-derived data must subscribe through the relevant Workbench or Planning Projection seam; app code should not import runtime mirror revision signals directly.
- Panels that only read non-canvas document state should not subscribe to canvas revisions.
- Timeline, budget, and consortium identity uses typed `PanelTarget` wire values through the Target module. Do not reintroduce string matching against descriptions, legacy plant arrays, budget descriptions, or canonical-name fields.
- Panel-origin hover/selection is presentation state and must not mutate real canvas selection, labels, dirty state, or history.
- Canvas-origin hover uses `hoveredCanvasTargets` and remains separate.
- Planning panel width uses the shared side-dock setting. Calendar expansion is temporary view state and manual resizing exits expansion before persisting the normal dock width.

## Budget And Numeric Inputs

- Do not use `parseFloat(v) || 0` for optional numeric inputs. It conflates empty input with zero.
- Use `Number.isFinite(parsed) && parsed >= 0` style guards.
- Check entry existence with `priceMap.has(key)` when distinguishing unset from price `0`.
- Updaters must compare fields before spreading to avoid dirtying on no-op updates.
- Budget CSV serialization belongs in `app/budget/export.ts`; native save-dialog and text-write I/O crosses the focused `ipc/export.ts` adapter, not the Design persistence IPC module.
