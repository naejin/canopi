# Canvas performance

Use this guide for dense-design lag. Keep renderer costs separate from document edits, hit testing, native IPC, and GPU completion. A WebGL backend may still be software rendered.

## Repeatable renderer benchmark

The standalone runner uses the real RendererHost, scene hydration, Pixi implementation and hit-testing code. It runs pan, zoom, detailed zoom, hover, selection, movement and offscreen scenarios. Movement exercises immutable positioned-plant replacement and renderer updates; it does not include the document transaction, history, snapping or pointer event pipeline. Timings include synchronous submission, not GPU completion or end-to-end input latency.

Playwright is an external development tool, not an application dependency. Point `CANOPI_PLAYWRIGHT_MODULE` at an existing Playwright package directory, or install it in a temporary tools directory. Chromium runs the installed Chrome channel; WebKit and Firefox require the corresponding Playwright browser binaries.

From `desktop/web`, start a separate local server:

```bash
npm exec vite -- --mode web --host 127.0.0.1 --port 1431
```

In another terminal:

```bash
CANOPI_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
  node scripts/canvas-performance/run.mjs \
  --file '/path/to/design.canopi' --output /tmp/canvas-trace.json
```

Omit `--file` to generate a deterministic 2,200-plant botanical scene. Options include `--url`, `--browser chromium|webkit|firefox`, `--dpr 1|1.5|2`, `--headed`, and `--screenshots /tmp/canvas-comparison` (PNG files for scales 10, 30 and 100). Input files stay local and unchanged. Do not commit private fixtures or screenshots. Output contains aggregate counts, environment metadata and timing events, without design names or content.

Run the separate pointer smoke check against a design containing editable plants:

```bash
CANOPI_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
  node scripts/canvas-performance/interactions.mjs --file '/path/to/design.canopi'
```

This mounts the real SceneCanvasRuntime with its detached app adapter, exercises pointer pan, wheel zoom, selection, plant dragging, undo and teardown, and asserts their state transitions. It changes only the isolated in-memory scene. It is a correctness check rather than a native input-latency benchmark.

Use separate worktrees and servers for before/after runs. Keep browser, GPU, DPR, dimensions, fixture, warm-up and sample counts equal. Run serially on an otherwise quiet machine; repeat if results vary. Check `metadata.backend` and `metadata.gpu` before interpreting timings. Never present SwiftShader results as native hardware frame rates. The trace JSON can be opened in Perfetto.

## Native development profiling

In a development app, open the native Web Inspector (`Ctrl+Shift+I` on Linux/Windows). The canvas has a `data-canopi-renderer` attribute for backend identification in all builds. Development builds additionally register mounted renderers in `window.__CANOPI_CANVAS_PROFILING__`.

Select the main canvas (an inspection lens can register another renderer), then run:

```js
const canvas = document.querySelector('canvas[data-canopi-renderer]')
const profile = window.__CANOPI_CANVAS_PROFILING__.get(canvas)
profile.start()
// Perform one reproducible interaction, then:
const trace = profile.stop()
JSON.stringify(trace)
```

Save the returned JSON locally and open it in Perfetto. Traces record scene, viewport and resize durations; metadata includes the actual backend, backing dimensions, DPR and the WebGL renderer where available. Captures stop growing after 10,000 events and report dropped events. No scene payloads, labels, file paths or IPC arguments are recorded. Disposal unregisters each renderer; HMR clears the registry. The recorder is absent from production renderer wiring.

Use Web Inspector's CPU/allocations timelines to explain expensive spans. For WebGL commands and buffer/texture churn, load a locally installed Spector.js standalone bundle in a development session and capture this canvas. It works without porting a browser extension or forking Spector. Keep capture disabled during timing comparisons. Use CrabNebula or a native sampling profiler only when measurements point to IPC/native work.

## Rendering invariants

- Invalidation is frame-coalesced, with scene updates taking precedence over viewport updates. Explicit awaited scene renders remain immediate for document settlement. New scene invalidations fence older in-flight preparations immediately; teardown cancels the pending animation frame.
- Resize changes backing dimensions only. Callers follow it with a scene or viewport update; resizing must not render an obsolete snapshot. RendererHost fallback instances receive their own size tracking.
- Plant geometry uses CSS-pixel local origins and position transforms. Geometry cache keys include footprint, symbol/LOD, colour, interaction appearance, focus opacity and theme edge styling. Changes to those facts must invalidate geometry.
- Plant culling includes a margin for interaction rings and stack badges. Spacing queries retain the full scene, including offscreen neighbours. Preserve display order and refresh hidden plants on re-entry.
- Zone/Measurement Guide geometry is reusable during pans; zoom changes screen-weight strokes and dash spacing. Text styles are retained until their effective properties change. Pure pans translate admitted names; full scene and zoom updates recompute admission.
- Keep performance assertions about work counts beside visual/state assertions. A faster renderer that drops selection, changes botanical appearance or publishes stale state is a regression.
