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

Omit `--file` to generate a deterministic 2,200-plant botanical scene. Options include `--backend auto|pixi|canvas2d` (default `auto`), `--url`, `--browser chromium|webkit|firefox`, `--dpr 1|1.5|2`, `--headed`, and `--screenshots /tmp/canvas-comparison` (PNG files for scales 10, 30 and 100). Explicit backend selection disables fallback in this benchmark, so comparisons cannot silently switch renderers. Canvas2D reports `canvasDrawCallsPerUpdate` for fill, stroke and text submissions; Pixi clear/render counters are zero for Canvas2D. `gpu: null` for Canvas2D means unknown, not software-only rendering. Input files stay local and unchanged. Do not commit private fixtures or screenshots. Output contains aggregate counts, environment metadata and timing events, without design names or content.

Run the separate pointer smoke check against a design containing editable plants:

```bash
CANOPI_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
  node scripts/canvas-performance/interactions.mjs --file '/path/to/design.canopi'
```

Add `--backend canvas2d` to emulate unavailable WebGL on HTML and Offscreen canvases and assert that the production fallback is active. The default `auto` uses normal backend selection.

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

For unattended native investigation on Linux, an isolated debug executable can expose WebKit's built-in HTTP inspector using `WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9231`. Use a private `dbus-run-session` and temporary `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_CACHE_HOME` so the single-instance plugin and user app data stay separate. Profile a copied Design. The HTTP target page links to the native inspector; WebKit protocol clients route commands through `Target.sendMessageToTarget` to the frame target, rather than assuming Chromium's debugging protocol. Wait for canvas readiness before replaying input. Activate/raise the native window through the window manager before physical pointer automation.

GPU strings may be generic: this Linux WebKit returned `Apple GPU` while `nvidia-smi pmon` attributed its process to a GTX 1080 Ti. Corroborate hardware with OS process attribution. Capture timing and CPU/heap separately, exclude setup, prefer short per-operation captures, and reject gestures whose expected state transitions did not occur. A second animation-frame callback is a frame-opportunity proxy, not GPU completion. See [native evidence and remaining cost](../native-canvas-performance.md).

Use Web Inspector's CPU/allocations timelines to explain expensive spans. For WebGL commands and buffer/texture churn, load a locally installed Spector.js standalone bundle in a development session and capture this canvas. It works without porting a browser extension or forking Spector. Keep capture disabled during timing comparisons. Use CrabNebula or a native sampling profiler only when measurements point to IPC/native work.

## Rendering invariants

- Invalidation is frame-coalesced, with scene updates taking precedence over viewport updates. Explicit awaited scene renders remain immediate for document settlement. New scene invalidations fence older in-flight preparations immediately; teardown cancels the pending animation frame.
- Resize changes backing dimensions only. Callers follow it with a scene or viewport update; resizing must not render an obsolete snapshot. RendererHost fallback instances receive their own size tracking.
- Canvas2D culls Plant drawing with the same CSS-pixel margin as Pixi while retaining all Plants for spacing. Its renderer instance retains admitted names across pure pans, recomputes them on zoom/full scene refresh, and releases them on disposal. The stateless snapshot renderer (also used by inspection) remains uncached.
- Pixi Plant geometry uses CSS-pixel local origins and position transforms. Geometry cache keys include footprint, symbol/LOD, colour, interaction appearance, focus opacity and theme edge styling. Changes to those facts must invalidate geometry.
- Plant culling includes a margin for interaction rings and stack badges. Spacing queries retain the full scene, including offscreen neighbours. Preserve display order and refresh hidden plants on re-entry.
- Zone/Measurement Guide geometry is reusable during pans; zoom changes screen-weight strokes and dash spacing. Text styles are retained until their effective properties change. Pure pans translate admitted names; full scene and zoom updates recompute admission.
- Keep performance assertions about work counts beside visual/state assertions. A faster renderer that drops selection, changes botanical appearance or publishes stale state is a regression.
