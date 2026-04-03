# Canopi Canvas: Current Work

**Date**: 2026-04-03  
**Status**: v0.2.0 shipped — scene-owned canvas rewrite is cut over

This file tracks what is still left after the runtime cutover.
The only live canvas architecture is `SceneCanvasRuntime` + `CanvasSession`.

## Completed

The following architectural work is done:
- `CanvasPanel` mounts `SceneCanvasRuntime`
- the location/map flow is split into its own full-screen location shell, not embedded in the canvas bottom panel
- `CanvasSession` talks to `CanvasRuntime`, not a live engine escape hatch
- `CanvasSession` selection APIs are runtime-backed and selection signals are UI mirrors only
- tool changes after mount flow through `CanvasSession`
- document replacement resets transient runtime state in the live runtime path
- `SceneStore` is the canonical canvas/document model
- `RendererHost` owns backend selection and recovery
- `PixiJS` primary plus `Canvas2D` fallback are live renderer backends
- scene-native interaction owns selection, drag, rectangle, text, and plant placement
- top-level document `annotations` are part of the schema
- scene history is command/patch based

## Active Remaining Work

### 1. Post-cutover correctness
- keep save/load strictly scene-authoritative
- keep species-color edits stable across save and reload
- keep annotation bounds consistent across selection, grouping, fit, and rendering
- keep annotation hit order intuitive when overlapping with zones or plants
- keep plant presentation geometry consistent across renderers, interaction, grouping, and fit
- keep signal mirrors thin and one-way; do not let them regain runtime authority
- keep `CanvasSession` selection APIs runtime-backed and prevent direct UI-mirror writes from reclaiming authority

### 2. Legacy cleanup — done
- ~~remove or quarantine dead Konva/engine code that still implies live ownership~~ — Konva dependency fully removed
- ~~delete stale adapters and comments that describe the old dual-runtime transition~~ — all Konva factories, typed interfaces, and the `konva` package deleted
- keep any surviving legacy code clearly marked as non-live
- the old `CanvasEngine` / serializer-era seams are historical only and must not regain live authority

### 3. Performance follow-through
- keep viewport-only updates on the renderer fast path
- keep Pixi retained across pan/zoom; avoid reintroducing per-tick scene-tree rebuilds
- add scene-side spatial indexing only when profiling shows hit-testing or marquee is the next bottleneck
- one non-blocking follow-up remains if we want to keep pushing: `maplibre-gl` is still the dominant large chunk, so the next meaningful perf pass is route/panel isolation around the location flow rather than more micro-splitting inside the canvas runtime
### 4. Documentation hygiene
- keep canvas/runtime/renderer docs aligned with the live scene-owned path
- move historical migration detail into archive docs instead of live guidance
- keep the live docs explicit that `CanvasSession` is the app-facing seam and `SceneCanvasRuntime` is the production canvas runtime

### 5. Deferred product work
- featured-design world map / template import
- timeline workflows
- budget workflows
- consortium workflows

## Guardrails

- do not reintroduce renderer-owned truth
- do not add `getEngine()`-style escape hatches back into app code
- do not move annotations back under `extra`
- do not reintroduce `plantDisplayMode` or split plant presentation authority
- do not reintroduce full scene rebuilds on viewport-only updates
- do not mix cleanup work with unrelated product redesign
- do not let legacy serializer or engine seams regain persistence authority

## Exit Criteria For This Cleanup Phase

- save/load integrity regressions are closed
- annotation geometry is shared and consistent everywhere
- plant presentation state is runtime-owned and geometry is shared everywhere
- viewport-only updates stay on the renderer fast path
- live docs describe the current runtime accurately
- remaining legacy seams are either deleted or clearly isolated
