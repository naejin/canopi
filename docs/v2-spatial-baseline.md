# Canopi v2 representative Design baseline

Bead: `canopi-ltck.2`. Code baseline: `963fe634a808402d05a8c4ed4767ea9568ff5d45`.

## Fixture receipt

The primary fixture is the private representative Design identified in the v2 spatial plan. It was read in place and never written, copied into the repository, or included in screenshots or traces committed here.

| Receipt field | Value |
|---|---:|
| SHA-256 | `446c656e12eca21ddf5c03e79cd1f8d7862eae88626c4cb550d55b505d246f40` |
| Format version | 5 |
| Plants | 2,201 |
| Zones | 24 |
| Annotations | 106 |
| Measurement Guides | 134 |
| Layers | 8 |
| Guides | 2 |
| Consortiums | 124 |
| Budget items | 117 |
| Plant IDs | 2,201 non-empty, 2,201 unique |
| Dangling group references | 0 |

The source hash was checked before and after every receipt, rendering, and pointer-interaction run. It remained unchanged.

## Environment and method

The browser measurements ran on Linux 7.0.0-31-generic with an Intel i7-6700K, 31 GiB RAM, and an NVIDIA GeForce GTX 1080 Ti using driver 580.173.02. Node was 22.22.0, Chrome was 150.0.7871.46, and Playwright was 1.64.0-alpha-2026-09-14.

The existing `scripts/canvas-performance/run.mjs` runner loaded the Design into the actual renderer at 1,200 × 800 CSS pixels. Each scenario used five warm-up updates and 30 measured updates. Screenshots at three zoom levels were inspected locally for botanical content, zones, annotations, guides, names, colours, and symbols. `interactions.mjs` exercised pointer pan, wheel zoom, hover, selection, Plant dragging, undo, and teardown through `SceneCanvasRuntime`.

Chrome selected ANGLE SwiftShader in these headless runs, including on the machine with the discrete GPU. The durations below measure synchronous renderer and hit-test work under software WebGL. They do not establish GPU completion, native input latency, or a release frame-rate threshold. The later shared-renderer candidate must be compared under the same runner and then qualified in hardware-backed Tauri before Phase B is accepted.

## Current rendering baseline

All runs rendered 2,201 Plants, 24 Zones, 106 Annotations, and 134 Measurement Guides.

| Operation | Pixi DPR 1 median / p95 (ms) | Pixi DPR 2 median / p95 (ms) | Canvas2D DPR 1 median / p95 (ms) |
|---|---:|---:|---:|
| Pan | 16.1 / 36.5 | 15.9 / 21.6 | 7.9 / 10.9 |
| Detailed pan | 5.4 / 7.7 | 5.5 / 10.3 | 4.2 / 9.7 |
| Zoom | 67.4 / 97.0 | 68.3 / 116.3 | 8.0 / 10.3 |
| Detailed zoom | 32.2 / 43.2 | 34.8 / 46.7 | 10.0 / 33.0 |
| Hover and hit testing | 19.6 / 23.2 | 21.4 / 47.1 | 9.3 / 19.0 |
| Selection | 18.3 / 26.5 | 18.4 / 25.2 | 8.0 / 29.5 |
| Immutable Plant movement | 28.8 / 38.4 | 31.8 / 41.0 | 17.3 / 20.7 |
| Scene entirely offscreen | 3.0 / 6.5 | 3.0 / 4.1 | 4.0 / 8.7 |

These numbers are a regression comparison point for the bounded shared MapLibre/scene experiment. They are not acceptance targets by themselves. The Phase B evidence must also cover pixel alignment, semantic layer order, interactive camera ownership, device-pixel-ratio changes, resize, style reload, context loss and restoration, teardown, and native resource stability.

## Interaction and appearance receipt

Pixi was the active backend during the primary interaction replay. Pan, zoom, hover, selection, Plant movement, undo, and teardown all passed. The screenshots showed the representative dense planting rows and retained botanical presentation across overview, working, and detail scales. Screenshots remain temporary because they contain private Design content.

Canvas2D was also measured as the existing fallback. No persistence, history, export, projection, renderer-selection, or fixture data was changed by the baseline work.

## Capacity derivative policy

Capacity qualification uses a deterministic 10,000-Plant derivative in a fresh operating-system temporary directory. The derivative copies every source Plant appearance, assigns unique non-empty IDs, and changes only Plant identity and local position. Dense and dispersed layouts are generated separately so culling and close-geometry costs remain distinguishable. The derivative is deleted after the run and is never written under the repository or used as a replacement for the 2,201-Plant acceptance fixture.
