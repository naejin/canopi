# Canvas Runtime

Use this guide when changing canvas state, scene runtime, renderer behavior, hit testing, selection, presentation, history, panel target projection, or Canvas2D tab renderers.

## Public Seams

- App code must not reach into renderer implementations or runtime internals.
- The app-facing canvas boundary is split into `CanvasCommandSurface`, `CanvasQuerySurface`, and `CanvasDocumentSurface`.
- Toolbars, shortcuts, menus, and plant color actions consume command surfaces.
- Document session orchestration, save/load, chrome, resize, and teardown consume document surfaces.
- Sibling read-only surfaces consume query surfaces for scene snapshots, viewport queries, selection reads, placed plants, localized names, and presentation context.

## Scene Ownership

- `SceneStore` owns canvas scene state: plants, zones, annotations, groups, layers, plant species colors, selection, viewport, hover, and presentation modes.
- Non-canvas document sections are not owned by `SceneStore`: consortiums, timeline, budget, `budget_currency`, location, description, and document extra.
- Commands, tools, save/load, and document replacement mutate scene state, not renderer objects.
- Canvas-owned document fields serialize from the live scene, not stale document input copies.
- Plant presentation state lives in `SceneStore.session`, not standalone canvas signals.
- Canvas signals such as selected object IDs, size mode, and color mode are UI mirrors, not runtime authority.
- No circular imports between scene store/runtime and document store. Pass document readers or values through seams when needed.

## History And Dirty State

- `SceneHistory` dirty state is checkpoint-based.
- Any history truncation behavior must preserve saved-position semantics in all write paths.
- Selection, hover, presentation-only target highlights, labels, and viewport-only work must not create document history entries unless explicitly designed.
- Auto-fit on document open is expected; both document load paths call `zoomToFit()` after hydration.

## Rendering Ownership

- `RendererHost` owns backend lifecycle, capability probing, and fallback.
- Renderers are projections of scene state, never the source of truth.
- Camera transforms go through `CameraController`.
- The in-canvas basemap is a sibling visualization layer, not part of the renderer contract.
- Screen-space chrome such as rulers stays outside the world renderer.
- Use scene invalidation for content, selection, presentation, locale, theme, and hover changes.
- Use viewport invalidation for pan, zoom, and fit operations.
- Use chrome invalidation for rulers, grid, and guide-only changes.
- Do not route viewport-only work through the full scene render path.
- `renderScene()` is for scene/presentation/selection rebuilds; `setViewport()` is for camera-only updates.

## Interaction Ownership

- `SceneInteractionController` owns live pointer and drag behavior.
- Hit testing and selection geometry must stay scene-side.
- Off-canvas drag continuation, multi-drag, and additive selection behavior are part of the runtime contract.
- Plant hit testing must use the same shared presentation context as renderers and fit/bounds logic.
- Interaction selection writes go through the runtime-owned selection seam.
- Document-level keyboard handlers must guard with `isEditableTarget(event.target)` so Delete/Backspace/etc. do not fire while typing.

## Annotation Rules

- Annotation geometry comes from shared helpers in `runtime/annotation-layout.ts`.
- Use the same annotation bounds for hit testing, band select, grouping, zoom-to-fit, and selection outlines.
- Visible text should win hit testing over underlying zones/plants when it is on top.

## Plant Presentation

- Plant geometry, color, and stack badges come from `runtime/plant-presentation.ts`.
- Do not reintroduce per-plant labels on canvas. Identification is through hover tooltip and per-species selection labels.
- Hover tooltip is an HTML overlay managed by `SceneInteractionController` through `runtime/interaction/hover-tooltip.ts`.
- Hover species highlight flows through renderer snapshots.
- Selection labels are computed per species at centroid by `runtime/selection-labels.ts` and must track viewport changes.
- Size mode and color mode are independent axes. Do not reintroduce a combined plant display mode.
- Default-mode dot sizing is world-proportional with screen caps/floors from existing constants.
- Species-cache backfill may enrich metadata, but production geometry should not depend on ad hoc empty-cache fallbacks.

## Panel Target Projection

- Timeline, budget, and consortium identity uses typed `PanelTarget[]` / `PanelTarget`.
- Do not reintroduce string matching against timeline descriptions, legacy `plants` arrays, budget descriptions, or consortium canonical-name fields.
- Use the panel target resolution helpers to map typed targets to scene plant/zone IDs for canvas highlights.
- `manual` and `none` targets intentionally resolve to empty sets and are not errors.
- Panel-origin hover and selection are presentation inputs. Resolving them must not mutate real canvas selection, labels, dirty state, or history.
- Canvas-origin hover remains separate.

## Canvas2D Tab Components

- Use `useCanvasRenderer` for DPR-aware canvas setup, resize observation, and redraw lifecycle.
- Use shared renderer utilities rather than duplicating drawing helpers.
- Canvas2D renderer functions receive `t` for i18n.
- Cache row offsets and layout computation in refs/memos for pointer paths.
- Snapshot drag-start values that can change mid-drag.
- Track whether a drag actually mutated state before marking documents dirty.
