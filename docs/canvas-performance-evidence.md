# Dense canvas performance evidence

Bead: `canopi-mxam`. Baseline: `b4ce8878`. Updated implementation: `fix/dense-canvas-performance`.

The local orchard design contained 2,201 botanical plants, 100 zones, 127 annotations and 113 measurement guides. The file was read without modification and is not included in this repository.

## Method

Ran `scripts/canvas-performance/run.mjs` against separate Vite servers for the baseline and updated working tree. Both used Chrome 150 headless, a 1200×800 CSS-pixel surface, DPR 1, Pixi/WebGL, and ANGLE SwiftShader software rendering. Each operation used five warm-up updates followed by 30 timed updates, one per requested animation frame. The recorder was inactive; identical Graphics clear/Application render counters were installed in both runs.

These are synchronous renderer/hit-test workload durations. They exclude GPU completion, native IPC, document transactions, history and the full pointer pipeline. They must not be interpreted as native Tauri frame rates. System load and software WebGL introduce timing variation; work counts provide additional evidence independent of wall time.

## Matched results

| Operation | Baseline median / p95 (ms) | Updated median / p95 (ms) | Median reduction |
|---|---:|---:|---:|
| Pan | 56.9 / 69.2 | 12.0 / 18.7 | 79% |
| Zoom | 91.0 / 113.3 | 57.7 / 87.0 | 37% |
| Detailed zoom | 126.1 / 141.6 | 27.4 / 35.9 | 78% |
| Hover including hit testing | 61.2 / 73.9 | 16.1 / 19.7 | 74% |
| Selection rendering | 59.8 / 72.8 | 14.7 / 18.6 | 75% |
| Immutable plant movement rendering | 66.5 / 91.0 | 27.3 / 36.0 | 59% |
| Scene entirely offscreen | 58.7 / 119.2 | 7.2 / 16.9 | 88% |

Pan graphics clears fell from 2,528 to 114 per update. Selection fell from 2,528 to 116. The remaining pan clears include annotation decorations and stack badges. Zoom continues to rebuild geometry when footprints/stroke widths change; the closer-view gain includes skipping offscreen plant paths. The benchmark invokes renderer operations directly, so it does not count the additional benefit of frame-coalesced invalidation or avoiding scheduler-triggered duplicate draws.

## Correctness evidence

- Real Pixi before/after screenshots at scales 10 and 100 were pixel-identical. At scale 30, five of 960,000 pixels differed by more than 12 channel levels; average absolute channel difference was 0.00015 on a 0–255 scale. Botanical appearance, positions and labels were retained.
- `scripts/canvas-performance/interactions.mjs` passed real pointer pan, wheel zoom, hover/selection, plant dragging, undo and teardown through SceneCanvasRuntime using the same design in memory. Pixi was active.
- Focused regressions protect geometry and style invalidation, offscreen re-entry, pan-independent name admission, frame coalescing, stale-render fencing and teardown. The final full frontend suite passed: 245 files, 2,248 tests. TypeScript checking and `npm run build:web` also passed. The production Web Edition output contains no profiling registry.

## Remaining measurement

The actual hardware-accelerated Tauri/WebKitGTK session has not been profiled. Follow-up `canopi-74q9` tracks this validation. The optional Playwright WebKit run could not start: installed Playwright expected `webkit-2358`, while the cached browser was `webkit-2248`. Browser timings above establish renderer improvements, not a native end-to-end latency guarantee. Use the development trace adapter and native Web Inspector described in [the performance guide](agent/canvas-performance.md) to capture that final environment, especially remaining zoom and movement cost.


## Canvas2D follow-up

Bead: `canopi-22na`. Baseline: `8bbebf70`. Updated implementation: `fix/canvas2d-performance`.

The same orchard was measured with `--backend canvas2d` on Chrome 150 headless, 1200×800 CSS pixels and DPR 1. Both sides used the updated runner with five warm-up and 30 measured updates, including identical Canvas2D fill/stroke/fillText counters. The repeated baseline used a separate checkout/server; the updated run followed it serially. The development recorder was inactive. Canvas2D GPU acceleration was not established (`gpu: null`). These results are synchronous submission costs, not native frame times or a comparison of Canvas2D against hardware Pixi.

| Operation | Baseline median / p95 (ms) | Updated median / p95 (ms) |
|---|---:|---:|
| Pan | 8.0 / 12.1 | 8.6 / 13.7 |
| Detailed pan | 16.2 / 43.8 | 4.1 / 14.1 |
| Zoom | 11.0 / 18.0 | 7.6 / 9.9 |
| Detailed zoom | 15.8 / 22.3 | 11.4 / 19.1 |
| Hover including hit testing | 10.5 / 15.4 | 9.6 / 11.9 |
| Selection rendering | 10.5 / 16.5 | 8.4 / 10.1 |
| Immutable plant movement rendering | 17.6 / 24.1 | 17.3 / 38.7 |
| Scene entirely offscreen | 15.4 / 42.0 | 3.3 / 5.8 |

Timing noise was substantial in exploratory runs: ordinary-pan medians ranged from 6.9 to 21.3 ms. Do not claim an ordinary-pan or movement improvement from these results. The repeated run supports detailed-pan and zoom improvements, while deterministic work counts establish the mechanism: detailed-pan drawing calls fell from 5,276 to about 1,250 (76%), and offscreen calls fell from 3,648 to 455 (88%). Ordinary-pan calls fell only from 3,648 to 3,628 because almost every plant fits in that viewport. The remaining offscreen submissions include Zones, Measurement Guides and Annotation decorations.

Culling alone produced pixel-identical orchard screenshots at scales 10, 30 and 100; adding pan-label reuse preserved that exact equality. Regression tests exercise edge footprints, offscreen neighbour spacing, re-entry, fractional-DPR name translation and admission invalidation on zoom and localized-name refresh. Existing tests retain pinned names, selection, layer opacity, botanical symbols and guides. No symbol bitmap/Path2D cache or rendering dependency was added: the measured gain supports the smaller change, and further cache cost/invalidation complexity is not yet justified.

The forced-fallback pointer runner passed pan, wheel zoom, hover/selection, dragging, undo and teardown with `canvas2d` confirmed active. The full frontend suite passed 245 files and 2,251 tests; TypeScript checking and `npm run build:web` passed.

Native follow-up `canopi-74q9` remains open. The running Tauri/WebKitGTK process was found, but it had no configured remote inspector endpoint. Its active canvas backend/GPU and complete input latency were not obtained. Native Web Inspector capture is still required; browser evidence must not close that task.
