# Canopi v2 shared renderer feasibility

Bead: `canopi-ltck.3`. Candidate base: `49a2d92f20c631881b05bce4f1acbc7e7cc0b721`. Experiment branch: `experiment/v2-shared-renderer`.

## Decision

Qualify the pinned Pixi shared-context adapter for downstream v2 implementation. MapLibre GL JS 6.4.1 owns the canvas, WebGL2 context, camera, resize, and frame callback. PixiJS 8.17.1 owns retained botanical scene resources and submits them only from the MapLibre custom-layer callback. Production composition remains unchanged in this experiment.

The adapter uses `WebGLRenderer.init({ canvas, context, ... })`, `resetState()`, and `render({ container, clear: false })`. It does not create a Pixi `Application` or ticker. MapLibre style replacement detaches and reattaches the same adapter. MapLibre drops custom layers during context restoration, so the future workspace lifecycle owner must re-add the adapter after `webglcontextrestored` once the restored style is ready. Final Pixi destruction runs inside a MapLibre custom-layer frame, clears Pixi's `loseContext` extension reference first, and never removes the map canvas.

Use the existing Canvas2D scene renderer as the editing fallback when shared WebGL initialization or operation fails. A later production owner must transfer camera ownership once, omit failed geographic contributions, and avoid restart loops. The experiment did not need the focused alternative WebGL renderer.

The qualified code was promoted by `canopi-ltck.6` to `maplibre/shared-scene-layer.ts` and `maplibre/scene-camera-transform.ts`. `maplibre/shared-scene-renderer.ts` now packages the custom layer with the Scene Runtime bridge and mandatory RendererHost failure propagation. The ordinary app composition remains on standalone Pixi plus Canvas2D until the shared workspace lifecycle and camera/input migration are complete.

## Representative evidence

The private Design receipt remained unchanged before and after every run:

| Receipt | Value |
|---|---:|
| SHA-256 | `446c656e12eca21ddf5c03e79cd1f8d7862eae88626c4cb550d55b505d246f40` |
| Format | 5 |
| Plants | 2,201 |
| Zones | 24 |
| Annotations | 106 |
| Measurement Guides | 134 |
| Layers / Guides | 8 / 2 |
| Consortiums / Budget items | 124 / 117 |
| Unique non-empty Plant IDs | 2,201 |
| Dangling Plant references | 0 |

Temporary screenshots on the accepted hardware runs showed the complete planting rows, botanical colours and symbols, Zones, labels, selected Plant, geographic reference, grid, and two distinct LiDAR raster bands. No private screenshot or fixture content is committed.

The actual painter order was:

1. basemap
2. LiDAR source
3. LiDAR analysis
4. geographic reference
5. grid
6. test-only alignment reference
7. Design scene

A LiDAR layer inserted after initial construction was moved back between the existing LiDAR band and geographic reference. The alignment marker is experiment instrumentation; production interaction chrome remains above the Design scene.

## Correctness and lifetime results

Chrome 150 ran headed through ANGLE on an NVIDIA GeForce GTX 1080 Ti, OpenGL 4.5.0, at 1,200 × 800 CSS pixels. Every enforced criterion passed at DPR 1 and DPR 2.

| Check | DPR 1 | DPR 2 |
|---|---:|---:|
| Maximum rendered alignment error | 0.71 CSS px | 0.36 CSS px |
| Connected WebGL canvases | 1 | 1 |
| WebGL contexts on the map canvas | 1 | 1 |
| Pixi initialization count | 1 | 1 |
| Custom-layer framebuffer clears | 0 | 0 |
| External requests | 0 | 0 |
| Teardown context-loss calls | 0 | 0 |

Rendered alignment was measured from thresholded framebuffer bounds, not DOM projection alone, during live pan/zoom and again after resize, full style replacement, and forced WebGL context restoration. Map pointer pan and wheel zoom changed only the MapLibre camera. The tool-owned pointer sequence disabled map pan, moved one Plant through `unproject` plus `geoToWorld`, and left the camera unchanged. A second adapter initialized, rendered, and disposed on the same live map context without duplicate initialization, context loss, or canvas removal. MapLibre rendered a probe layer after each primary disposal.

The production Canvas2D fallback separately passed pointer pan, wheel zoom, selection, Plant drag, undo, and teardown with WebGL deliberately unavailable.

## Matched renderer cost

The production Pixi baseline and shared candidate ran serially in the same headed Chrome, GPU, dimensions, DPR, fixture, local-metre viewport sequence, five warm-ups, and 30 measured updates. Values are synchronous botanical renderer submission time.

| Operation | DPR | Production Pixi p50 / p95 | Shared Pixi p50 / p95 | Candidate ratio p50 / p95 |
|---|---:|---:|---:|---:|
| Pan | 1 | 19.9 / 37.1 ms | 19.1 / 29.3 ms | 0.96 / 0.79 |
| Zoom | 1 | 72.9 / 136.2 ms | 68.0 / 89.0 ms | 0.93 / 0.65 |
| Pan | 2 | 19.8 / 42.2 ms | 18.7 / 27.0 ms | 0.94 / 0.64 |
| Zoom | 2 | 74.7 / 93.0 ms | 71.6 / 95.2 ms | 0.96 / 1.02 |

The shared adapter introduced no material renderer regression on this representative Design. The DPR 2 zoom p95 difference was 2.2 ms while its median improved by 3.1 ms.

Full MapLibre frame wall-time p95 values were 72.3 ms pan and 93.8 ms zoom at DPR 1, and 68.3 ms pan and 114.9 ms zoom at DPR 2. These browser measurements miss the plan's 60 Hz reference target. They also lack GPU completion timing, input-to-visible latency, memory/texture growth, cold/warm real tiles, concurrent LiDAR processing, lower-end hardware, native WebKit/Tauri qualification, and the temporary 10,000-Plant capacity runs. Those remain mandatory Phase F gates; this checkpoint establishes shared-renderer feasibility and a non-regressing renderer seam, not final performance qualification.

## Validation and effort

- `npx vitest run src/__tests__/v2-shared-camera-transform.test.ts src/__tests__/v2-shared-map-scene-layer.test.ts src/__tests__/pixi-scene.test.ts`: 33 passed.
- `npx tsc --noEmit`: passed.
- `scripts/canvas-performance/shared-map-scene.mjs`: all enforced criteria passed on headed NVIDIA runs at DPR 1 and DPR 2.
- `scripts/canvas-performance/interactions.mjs --backend canvas2d`: passed.
- Fixture receipt after validation: unchanged.

Measured lead wall-clock effort from bead claim through accepted evidence and ADR reconciliation was about 75 minutes. Two bounded delegated attempts ran inside that elapsed window and ended at the service usage limit; the integration owner completed and verified the accepted implementation locally.
