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

Run the isolated shared-workspace interaction check against a temporary v2 Design with editable Plants:

```bash
CANOPI_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
  node scripts/canvas-performance/workspace-interactions.mjs \
  --file '/path/to/temporary-v2-design.canopi'
```

It composes the real `SceneCanvasRuntime`, `WorkspaceActivationCoordinator`, `MapLibreWorkspaceCameraOwner`, and the production non-interactive workspace map shell. It uses an offline map contribution, changes only in-memory Scene state, and reports aggregate pass names for pointer pan, wheel, selection, tool drag, undo, capture loss, and teardown. It does not qualify physical two-contact pinch, `touch-action`, edition mounting, native WebKit input delivery, or input-to-visible latency.

For the isolated v2 MapLibre-owned renderer experiment, run the production Pixi baseline first and pass its JSON back to the shared runner. The shared runner requires the real fixture and uses an offline style. It fails when alignment, ordering, input ownership, context ownership, style/context recovery, teardown, or repeat-mount checks fail:

```bash
DISPLAY=:0 CANOPI_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
  node scripts/canvas-performance/run.mjs \
  --file '/path/to/design.canopi' --backend pixi --dpr 1 --headed \
  --output /tmp/canopi-pixi-dpr1.json

DISPLAY=:0 CANOPI_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
  node scripts/canvas-performance/shared-map-scene.mjs \
  --file '/path/to/design.canopi' --baseline /tmp/canopi-pixi-dpr1.json \
  --dpr 1 --headed --output /tmp/canopi-shared-dpr1.json
```

Repeat at DPR 2. `performanceComparison` compares synchronous botanical renderer submission for the same local-metre viewports, dimensions, warm-up, and 30 samples. `performance` also records full MapLibre frame wall time. Neither duration is GPU completion or input-to-visible latency. The global WebGL context count includes MapLibre's detached capability probe; `connectedWebglCanvasCount` and `mapCanvasContextCount` are the ownership checks. Read the private fixture with `fixture-receipt.mjs` before and after the run, and keep all JSON and screenshots outside the repository.

Use separate worktrees and servers for before/after runs. Keep browser, GPU, DPR, dimensions, fixture, warm-up and sample counts equal. Run serially on an otherwise quiet machine; repeat if results vary. Check `metadata.backend` and `metadata.gpu` before interpreting timings. Never present SwiftShader results as native hardware frame rates. The trace JSON can be opened in Perfetto.

## Private fixture receipts and capacity derivatives

Use the aggregate-only receipt tool before and after measuring a private Design. Supply the accepted hash and every relevant expected count so the run stops on the wrong input:

```bash
node scripts/canvas-performance/fixture-receipt.mjs \
  --file '/path/to/design.canopi' \
  --expected-sha256 '<accepted-sha256>' \
  --expected-plants 2201 \
  --expected-zones 24 \
  --expected-annotations 106 \
  --expected-measurement-guides 134 \
  --expected-layers 8 \
  --expected-guides 2 \
  --expected-consortiums 124 \
  --expected-budget 117
```

The receipt contains only hash, byte size, version, aggregate counts, and reference-integrity totals. Errors omit the supplied path. Do not commit the source, receipt path, screenshots, traces, or generated content from a private Design.

Add `--derivative dense` or `--derivative dispersed` to verify a deterministic 10,000-Plant capacity fixture. The derivative preserves source Plant appearance, assigns unique IDs, remaps Plant references, and changes local positions according to the requested layout. Its temporary directory is managed by the helper and removed before the aggregate-only receipt is returned. Recheck the original receipt afterward. Never move the derivative into the repository or treat it as representative correctness evidence.

## Production workspace capacity harness

Use `production-workspace.mjs` for the shared production composition rather
than constructing its camera, renderer, activation coordinator, or controls in
a benchmark. It uses detached in-memory app, panel-target, contribution,
snapshot, and offline-basemap adapters. The runner loads the Design through
`composition.surfaces.documents` before `start()`.

Start a local Web Vite server, then run one named scenario or all four serially:

```bash
CANOPI_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
  node scripts/canvas-performance/production-workspace.mjs \
  --file '<private-v5-design.canopi>' --scenario all --headed
```

The scenarios are `representative` (shared renderer), `fallback` (forced
Canvas2D fallback), `dense` (synthetic dense 10,000 Plants), and `dispersed`
(synthetic dispersed 10,000 Plants). The in-browser development preparation
changes a v5 file only by setting `version: 6` and adding
`newDesignSpatialFrame()`; it is not a shipping converter.

Every scenario also runs the real production camera through site → overview →
Return → zoom 27 → Return. The aggregate `correctness.worldCamera` record checks
single-world constructor state, overview admission, blocked overview deletion,
100 exhausted zoom inputs at each limit, exact no-op frame identity/revision,
Return behavior, and the public MapLibre zoom/min/max values. Keep these checks
inside the production composition; do not reconstruct its camera or weaken the
private representative receipt when that fixture is unavailable.

The interaction check ranks unlocked, ungrouped Plants that are safely inside
the viewport by distance from its centre. It attempts up to six candidates
through real pointer selection and uses the first exact pointer-selected Plant
for drag and undo. Candidate IDs and positions stay inside the browser-run
scope and are never emitted. No pointer-selectable candidate is a failed
interaction check.

`--headed` is optional; the default is headless Chrome. The JSON is
aggregate-only. It records the source receipt, environment, viewport/DPR,
navigation warm-up and sample counts, p50/p95/p99 navigation
frame-opportunity intervals, stalls above 100 ms, and an
input-to-second-animation-frame proxy. Each navigation frame sample dispatches
an alternating wheel event before the animation-frame callback; it is not an
idle RAF measurement.
These are browser proxies, not native timings or GPU completion. Renderer work
and render counters are `unavailable` unless an existing production-observable
surface provides them. The proxy classifier compares directly with the plan's
16.7 ms frame reference, 50 ms feedback reference, and no run of two or more
consecutive intervals above 100 ms. It always reports native qualification as
unavailable. A proxy miss remains a miss; a proxy pass does not certify native
presented-frame or input-to-visible performance.

Pass `--profile-work` only for a matched diagnostic run. It adds bounded,
aggregate development measurements for synchronous wheel dispatch, the shared
custom-layer callback, Pixi WebGL submission, `Graphics.clear()` calls,
viewport presentation, Plant presentation stages, and MapLibre repaint
requests. It restores every temporary wrapper after the scenario. These spans
can locate browser-thread work, but they do not measure GPU completion or
native input-to-visible latency. Canvas2D correctly reports shared-layer work
as unavailable.

When a scenario fails after source integrity and cleanup have been established,
the runner records its fixed failure code and continues the remaining independent
scenarios. It prints the completed and failed aggregate records before exiting
nonzero, so one failure does not discard earlier measurements.

The harness temporarily instruments public MapLibre prototype methods to capture
the map passed to `addLayer`, read `getLayersOrder()`, and count `remove()`
calls. It also tracks persistent DOM listeners on the window, document,
workspace container, and workspace canvases using DOM listener identity rules,
including capture and duplicate-add behavior. The patch is restored in its
disposal `finally` block. A passing cleanup requires one shared-map removal, or
zero to one removal when fallback rejects WebGL2 before map construction, plus
zero scoped persistent DOM listeners, zero connected canvases, and unchanged
public viewport state after settled post-disposal wheel/pointer events. MapLibre Evented
registrations remaining after `remove()` are recorded as internal/unavailable
and are not treated as resource-listener leaks. A fallback Canvas2D scenario
records semantic ordering as not applicable because it has no MapLibre stack.

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
- Pixi Plant geometry uses CSS-pixel local origins and position transforms. Plants with exactly equal effective geometry share a `GraphicsContext`; the presentation owns and destroys those contexts. New Plant `Graphics` start on one presentation-owned empty external context so they do not allocate unused per-Plant contexts. Before removing a Plant or disposing the presentation, rebind its `Graphics` through Pixi's public setter and destroy the temporary context; Pixi does not detach destroyed `Graphics` listeners from an externally owned context by itself. The cache retains the current and two prior exact generations so A/B/A zoom movement can reuse geometry while continuous zoom churn remains bounded. Geometry cache keys include the exact footprint, symbol/LOD, colour, interaction appearance, focus opacity and theme edge styling. Changes to those facts must invalidate geometry; do not quantize botanical appearance to improve cache hits.
- Coincident-Plant stack counts may be retained only while the ordered visible Plant identities and selected Plant IDs match. Plant edits replace entity identities and must invalidate this cache.
- Plant culling includes a margin for interaction rings and stack badges. Spacing queries retain the full scene, including offscreen neighbours. Preserve display order and refresh hidden plants on re-entry.
- Zone/Measurement Guide geometry is reusable during pans; zoom changes screen-weight strokes and dash spacing. Text styles are retained until their effective properties change. Pure pans translate admitted names; full scene and zoom updates recompute admission.
- Keep performance assertions about work counts beside visual/state assertions. A faster renderer that drops selection, changes botanical appearance or publishes stale state is a regression.
