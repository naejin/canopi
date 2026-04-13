# Scene Renderer Architecture

**Date**: 2026-04-05
**Status**: live production renderer path

This file describes the renderer architecture that is actually mounted by the app today.
For the full canvas runtime architecture, see `desktop/web/src/canvas/CLAUDE.md`.

## Current Production Path

The live world renderer is scene-owned:
- `CanvasPanel` mounts `SceneCanvasRuntime`
- `SceneCanvasRuntime` owns scene state, camera state, interaction, and history
- `RendererHost` chooses the backend and can fail over between them
- `PixiJS` is the primary backend
- `Canvas2D` is the fallback backend
- App code accesses the runtime through an interface (see `CLAUDE.md` canvas seam guidance)
- MapLibre is a sibling visualization layer managed by a dedicated surface/controller, not part of the renderer path. The current in-canvas basemap lives behind `.canvasContainer`, follows the camera via read-only runtime seams, and reports loading / ready / error feedback plus pure panel-target overlays. Treat `docs/todo.md` (`MapLibre / geo`) as the current-status owner and root `CLAUDE.md` as the authority rule set

The renderer is not the source of truth. `SceneStore` owns canvas scene state.

## Ownership Rules

### What owns what
- `SceneStore` owns persisted and session canvas state
- `CameraController` owns world/screen transforms
- `SceneInteractionController` owns pointer behavior and selection logic
- `RendererHost` owns backend lifecycle and recovery
- backend renderers only draw scene state and interaction overlays
- plant presentation state is scene-session-owned and precomputed before renderer draw calls
- UI signals are mirrors for components; renderers must not treat them as authoritative runtime input
- Selection should always reflect `SceneStore.session.selectedEntityIds`, not UI signal mirrors
- Document replacement resets transient runtime state before the replacement scene is hydrated

### What renderers must not own
- document persistence
- selection truth
- drag truth
- history state
- save/load authority
- plant size/color mode authority
- plant geometry recomputation that diverges from runtime bounds or hit testing

## Rendering Contract

Both backends must stay aligned on:
- plants
- zones
- annotations
- selection affordances
- marquee / transient previews
- camera transforms
- plant size/color presentation
- stack badges for overlapping plants
- hover species highlight ring (from `hoveredCanonicalName` in snapshot)
- selection labels (one per species, from `selectionLabels` in snapshot)

Shared geometry and layout rules should live outside backend implementations whenever possible.

In practice:
- annotations use shared helpers in `annotation-layout.ts`
- plants use the shared presentation rules from `plant-presentation.ts`
- renderers draw decisions; they do not invent plant semantics locally
- viewport-only updates reuse cached scene state inside the renderer; they do not ask the runtime to rebuild the whole scene
- Pixi retains per-entity world objects for plants, zones, and annotations across camera motion; viewport work is limited to transforms plus scale-sensitive overlay/detail updates

## Current Guardrails

- camera motion must be camera-only work, not a full-scene transform walk
- annotation bounds must come from shared annotation layout helpers
- hit testing and selection geometry stay scene-side
- fallback must preserve current scene, camera, and selection state
- scene serialization must not depend on renderer state
- zoom-to-fit, grouping bounds, interaction, and renderers must agree on plant geometry
- do not reintroduce a combined `plantDisplayMode` compatibility path
- do not call `renderScene()` for pure pan/zoom/fit updates
- do not rebuild the retained Pixi scene tree inside `setViewport()`
- scene serialization must not depend on renderer state

## Remaining Renderer Work

- Keep Pixi and Canvas2D behaviorally aligned
- Add performance measurements only when tied to a concrete regression
- Keep plant presentation snapshot ownership centralized in the runtime
- MapLibre chunk isolation: verify `maplibre-gl` is in a separate Vite chunk (see `docs/todo.md` Performance section)

## Validation

When changing renderer behavior, verify:
- `npm test --prefix desktop/web`
- `npm run build --prefix desktop/web`
- live selection, drag, zoom, and text annotation behavior
- fallback startup or failover if backend selection logic changed
