# Scene Renderer Architecture

**Date**: 2026-04-02  
**Status**: live production renderer path

This file describes the renderer architecture that is actually mounted by the app today.
Any `CanvasEngine` references in this file or its related archive material are historical only.

## Current Production Path

The live world renderer is scene-owned:
- `CanvasPanel` mounts `SceneCanvasRuntime`
- `SceneCanvasRuntime` owns scene state, camera state, interaction, and history
- the location/map experience lives in a separate location shell; it is not part of the canvas renderer path
- `RendererHost` chooses the backend and can fail over between them
- `PixiJS` is the primary backend
- `Canvas2D` is the fallback backend
- `CanvasSession` is the app-facing seam for tool changes and selection-aware actions

The renderer is not the source of truth. `SceneStore` is.

## Ownership Rules

### What owns what
- `SceneStore` owns persisted and session canvas state
- `CameraController` owns world/screen transforms
- `SceneInteractionController` owns pointer behavior and selection logic
- `RendererHost` owns backend lifecycle and recovery
- backend renderers only draw scene state and interaction overlays
- plant presentation state is scene-session-owned and precomputed before renderer draw calls
- UI signals are mirrors for components; renderers must not treat them as authoritative runtime input
- `CanvasSession` selection methods are runtime-backed, so renderer-facing selection should always reflect scene-session state rather than the signal mirror
- document replacement resets transient runtime state in the live runtime path before the replacement scene is hydrated

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
- dense-scene label suppression and stack badges

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
- keep old serializer and engine-era persistence seams quarantined from the live path

## Remaining Renderer Work

The rewrite itself is cut over. Remaining work is maintenance:
- keep Pixi and Canvas2D behaviorally aligned
- remove or isolate dead legacy renderer helpers if they are no longer used
- add performance measurements only when tied to a concrete regression
- keep plant presentation snapshot ownership centralized in the runtime
- avoid reopening architecture churn unless profiling proves a new bottleneck
- keep any remaining `CanvasEngine` mentions quarantined to historical material, not live guidance
- one non-blocking follow-up remains if we want to keep pushing: `maplibre-gl` is still the dominant large chunk, so the next meaningful perf pass is route/panel isolation around the location flow rather than more micro-splitting inside the canvas runtime

## Validation

When changing renderer behavior, verify:
- `npm test --prefix desktop/web`
- `npm run build --prefix desktop/web`
- live selection, drag, zoom, and text annotation behavior
- fallback startup or failover if backend selection logic changed

## Historical Note

Older retained-surface Konva reconciler notes are now historical and superseded by the Scene runtime. Keep them in archive material, not as guidance for new live renderer work.
