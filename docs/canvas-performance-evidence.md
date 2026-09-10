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
