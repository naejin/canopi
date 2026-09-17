# Canvas plant and Target presentation

Part of the [Canvas runtime guide](canvas-runtime.md). Read this guide for species key and focus, plant presentation, target projection. For persistence across runtime lifetimes, use [Document lifecycle](document-lifecycle.md).

## Species Key and Focus

- `species-key.ts` assigns unique canonical-name codes and builds the placed-Species read model. Reservations are persisted by SceneStore, including removed Species; allocation is deterministic and independent of Plant ordering and locale. Counts are placed Plant instances, not their optional quantity metadata.
- `CanvasQuerySurface.getSpeciesFocus()` exposes the Scene Session viewing state. `CanvasCommandSurface.speciesFocus` validates focus against placed Species and changes only session state; it publishes the existing scene query revision and invalidates rendering without history or dirty-state writes. Commands retained after runtime disposal do nothing. A removed focused Species may retain a clearable zero-count chip until cleared or replaced.
- Both renderers dim nonfocused Plant symbols through presentation opacity. Selection and hover outlines retain their normal opacity. Layer visibility/opacity and selected identity remain authoritative. `automatic-detail.ts` admits optional short codes from 50 CSS px/metre through the existing collision index, without replacing pinned names. Inspection snapshots explicitly clear Species Focus and code visibility so the lens retains its local full-name behavior.
- Print snapshots capture the same reserved codes, never session focus or dimming. The PDF detail label planner admits optional codes around authored text and marks; the full page legend pairs codes with names and every authored appearance.

## Plant Presentation

- Plant geometry, color, Plant Symbol resolution, and stack badges come from `runtime/plant-presentation.ts`.
- Visual Footprint is the shared presentation boundary for symbolic plant sizing; rendering, hit testing, band select, grouping bounds, and zoom-to-fit must consume the same computed footprint. Additional click/touch padding is allowed only as an explicit interaction affordance.
- Selected Plant presentation contexts, including Plant Color and Plant Symbol popover contexts, should prefer the active localized Common Name from the runtime presentation cache and fall back to the persisted Placed Plant Common Name only when no localized name is available.
- Plant Symbols use the twelve botanical forms and four abstract shapes (`round`, `square`, `triangle`, `cross`). The old botanical IDs and wave are retired without aliases. `runtime/plant-symbol-recipes.ts` owns compact and detailed closed native contours, fully enclosed counter-wound holes, SVG/PDF path emission and native tracing. Open gaps belong in outlines; do not pass boundary-touching holes to Pixi `cut()`. Fine details appear at a 16 CSS px diameter; compact geometry is used below that. Opaque silhouettes have a thin theme-aware edge without replacing authored color. The neutral glyph uses 80% of the footprint radius for visual balance; its native-circle fast paths match the shared contour, while distant position dots retain their full computed radius. Glyph changes must not alter the circular Visual Footprint, hit testing, band select, grouping bounds, zoom-to-fit, stack placement or interaction rings.
- Render Plant Symbols with Pixi and Canvas2D native primitives rather than runtime SVG parsing, image textures, DOM overlays, or a new icon dependency. When the available radius is below 3.6 CSS px, collapse symbols to solid position dots without an outline. Retain explicit selection and hover cues.
- Plant Symbols apply inside the symbolic marker Visual Footprint. Do not reintroduce a separate canopy-spread display mode or other plant-size display modes without a new decision record.
- Plant Symbols stay upright and ignore placed plant rotation unless a future feature deliberately defines oriented marker symbols.
- Stack badges indicate exact coincident world positions. Distinct neighboring Plants never acquire a count merely because the camera zooms out. Badge placement should derive from the current plant visual radius instead of fixed legacy dot-size assumptions.
- `automatic-detail.ts` admits plant names, Annotation text, and Measurement Guide labels into shared screen space. Automatic plant names become eligible at 500% and 35px nearest-neighbor separation; pinned names have priority. Collision admission is pan-independent. Single-plant Selection Labels and the Hover Tooltip retain explicit identification. Renderers multiply opacity by Layer opacity and recompute presentation on viewport-only updates; never persist automatic name admission.
- Hover tooltip is an HTML overlay managed by the Scene Interaction Session through `runtime/interaction/hover-tooltip.ts`.
- Hover species highlight flows through renderer snapshots.
- Selection Labels are temporary identification for the current selection only. Render them only when the whole canvas selection is exactly one unpinned Placed Plant; multi-selection, mixed-object selection, and selected pinned plants should not render transient plant names.
- Placed Plant markers are symbolic positions, not canopy geometry. Their radius is the existing absolute-scale curve capped to 42% of nearest distinct plant spacing in CSS pixels, with a 0.65px visibility floor. `canvas/plant-spacing.ts` caches nearest distances on immutable positioned-plant arrays and is shared with PDF and lens layout. Pass the full Scene plant context to rendering and interaction queries so their footprints agree; explicit pointer padding chooses the nearest Plant when hit areas overlap.
- Do not reintroduce general Display by or Color by plant presentation controls without a new decision record. Manual Plant Color and per-species Plant Color remain supported.
- Species-cache backfill may enrich metadata, but production geometry should not depend on ad hoc empty-cache fallbacks.

## Target Projection

- Timeline, budget, and consortium identity uses typed `PanelTarget[]` / `PanelTarget` wire values, but frontend callers should import Target helpers from `desktop/web/src/target/`.
- Do not reintroduce string matching against timeline descriptions, legacy `plants` arrays, budget descriptions, or consortium canonical-name fields.
- Use the Target resolution helpers to map typed targets to scene plant/zone IDs for canvas highlights.
- `manual` and `none` targets intentionally resolve to empty sets and are not errors.
- Panel-origin hover and selection are presentation inputs. Resolving them must not mutate real canvas selection, labels, dirty state, or history.
- App-owned Target presentation state is exposed through `app/panel-targets/presentation.ts`; runtime adapters and map surface controllers should consume that seam instead of raw `app/panel-targets/state.ts` signals.
- Target map overlays for Zones must project effective Zone geometry. Rectangular and Elliptical Zone targets use the rotation-aware helpers in `canvas/runtime/zone-geometry.ts`; do not project raw persisted points for oriented Zone types.
- Canvas-origin hover remains separate.
