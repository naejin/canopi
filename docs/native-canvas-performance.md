# Native dense-canvas profiling

Bead: `canopi-74q9`. CSS ordering repair: `canopi-ds25` (`33f7ef39`).

## Environment and scope

Measured an isolated instance of the actual `canopi-desktop` debug executable, using system WebKitGTK 2.52.6 on Linux/X11. It loaded a temporary copy of the orchard containing 2,201 Plants, 100 Zones, 127 Annotations and 113 Measurement Guides. The original Design and the user's app data were not modified.

The active renderer was Pixi/WebGL at DPR 1, with a 1192×730 CSS-pixel canvas in a 1280×800 native window. `nvidia-smi pmon` identified the isolated WebKit WebProcess as a graphics client on an NVIDIA GeForce GTX 1080 Ti, driver 580.173.02. WebKit returned the generic string `Apple GPU` to JavaScript; that string did not identify the physical GPU. OS process attribution was necessary.

Both frontend revisions ran in the same native executable and window: baseline `b4ce8878`, before the dense-canvas changes, and the integrated `49a25632` tree containing Pixi, Canvas2D and CSS fixes. Separate local Vite servers supplied each revision; navigating the isolated WebView preserved the same native backend. Native file loading and Tauri availability were verified on both origins. These are development-build measurements, not release-build guarantees.

## Method and limits

WebKit's HTTP inspector was enabled on loopback with `WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9231`. The isolated process used a private D-Bus session and temporary XDG config/data/cache directories. The inspector's `Target` messages exposed the frame target; `Runtime.evaluate`/`Runtime.awaitPromise` and the Timeline, ScriptProfiler and Heap domains operated on that target. This adapts WebKit's existing inspector, without adding an app dependency or shipping another profiler. See [WebKit's inspector environment variables](https://trac.webkit.org/wiki/EnvironmentVariables).

Native XTest mouse input exercised pan, detailed pan, wheel zoom, hover, alternating selections and Plant dragging. The copied Design was reopened before each final scenario, and zoom-to-fit established the starting view; detailed pan and Plant interactions used approximately 100 CSS pixels/metre. Dragging used a large enough displacement to exceed grid snapping and was undone. Captures that missed the isolated window or failed to move the intended Plant were discarded. The window manager must activate and raise the test window; setting keyboard focus alone was insufficient.

Unprofiled runs counted `Graphics.clear` calls and timed synchronous `Application.render` submission. A trusted-event observer recorded event age until a second animation-frame callback. This is an input-to-frame-opportunity proxy, including event queueing and application scheduling; it is **not** GPU completion or physical input-to-photon latency. The observer runs after existing window capture listeners, so its initial event-age value includes earlier handler work and must not be called pure queue time. Event coalescing, small sample counts, and desktop activity limit latency comparisons.

CPU and heap captures ran separately. The initial broad baseline capture also included setup, so its sample distribution is used to locate expensive code, not as a per-operation percentage comparison. The short optimised captures exclude setup and file loading. A later combined baseline capture exceeded its time limit and was discarded. Heap tracking reports live-object snapshots and changes, not total allocated bytes over the interval. Raw private heap snapshots, input captures and screenshots are temporary; only aggregate evidence belongs in this repository.

## Results

The final baseline and optimised replay used the same geometry, native window, input rates, and reset procedure. All final scenarios exercised their intended operations; the intended Plant moved during dragging and undo restored it. Counters include every application render during the gesture, including duplicate baseline submissions.

| Operation | Baseline median render submission (ms) | Optimised median (ms) | Baseline / optimised render count |
|---|---:|---:|---:|
| Pan | 13.5 | 7.0 | 12 / 9 |
| Detailed pan | 82.5 | 4.0 | 10 / 7 |
| Wheel zoom | 87.5 | 64.0 | 12 / 7 |
| Hover | 50.0 | 4.5 | 12 / 8 |
| Selection | 45.0 | 4.0 | 24 / 17 |
| Drag | 44.0 | 4.0 | 22 / 8 |

Geometry clears per render fell from 2,541 to 127 during pan, and from 2,508 to about 95 during detailed pan. This validates retained geometry and culling in actual hardware-backed Tauri, beyond the earlier SwiftShader measurements.

The median event-to-frame-opportunity proxies were much noisier: pan 223→235.5 ms, detailed pan 375→568 ms, zoom 866→386 ms, hover 438.5→432.5 ms, selection 2,040.5→1,421 ms, and drag 11,771→960 ms. These small, coalesced samples do **not** establish a stable latency percentage or a frame-rate guarantee. In particular, ordinary and detailed panning did not show consistent end-to-end improvement despite much cheaper renderer submission. The very large event ages warrant a better bounded replay before using them as a release performance threshold.

## Remaining cost and verified cause

The broad baseline CPU capture contained 44,100 sampled stacks. Frequent leaf functions included Pixi `buildLine`, `buildSimpleUvs` and `round`, consistent with rebuilding botanical geometry. It also exposed plant-spacing and selection-measurement work outside rendering.

Short optimised captures isolated actual input work after setup:

- Pan: 1,190 stacks; `cloneScenePersistedState` appeared in 387 (32.5%, inclusive). Pointer-driven measurement refresh and query selection were prominent alongside viewport rendering.
- Drag: 1,598 stacks; `nearestPlantSpacing` appeared in 638 (39.9%, inclusive), and `getDesignObjectSelectionModel` in 440 (27.5%, inclusive). Inclusive percentages overlap and must not be added. Frequent leaf operations included sorting, object cloning, Map construction and nearest-neighbour searches.
- Native IPC command counting recorded zero invokes during every final baseline gesture, and during the short optimised pan/drag captures. Loading was outside recording. These samples point to frontend computation; they do not justify moving work into Rust or adding native IPC profiling dependencies.

The cache mismatch is concrete: `canvas/plant-spacing.ts` caches its spacing index in a WeakMap keyed by the Plant array. `SceneStore.persisted` defensively clones the entire persisted scene on every read. Presentation and selection-bound paths request those snapshots repeatedly, so equivalent geometry often reaches the cache under a new identity. In the native WebView, two consecutive query snapshots had different Plant arrays. Twenty spacing queries using fresh query snapshots took a median 9 ms, maximum 35 ms; twenty queries against one warmed snapshot were below the 1 ms timer resolution. Both paths returned identical spacing. This microcheck includes snapshot creation and index construction, matching the problematic caller pattern; it is not a claim that the index alone takes 9 ms.

Follow-up **`canopi-da6x` (P1)** owns reusable spacing work across unchanged scene revisions. Preserve defensive-copy authority and invalidation on Plant movement/addition/removal; do not fix performance by exposing mutable authoritative arrays. Reuse a runtime-owned geometry read context/index and avoid repeated selection-bound computation within one input update. Verify with caller-pattern regressions and the native replay before widening the change.

## Allocation observations

The optimised drag heap capture ended with about 12,025 more plain Objects and 1,281 more Arrays, while summed snapshot node sizes decreased from about 205.5 MB to 204.0 MB. Pan's totals decreased from about 207.5 MB to 206.7 MB. These whole-WebView snapshots include JIT, WebGL, cached page resources and garbage-collection effects. They support investigating allocation churn alongside cloning, but neither prove a leak nor measure total allocation volume. Node field interpretation follows [WebKit's heap snapshot reader](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebInspectorUI/UserInterface/Workers/HeapSnapshot/HeapSnapshot.js).

## Validation and handoff

The CSS discovery regression failed with locale collation and passed after code-unit sorting; all declarations remained covered. On the integrated checkout, focused CSS/architecture/Canvas2D coverage passed 43 tests, followed by TypeScript checking and the full frontend suite: 245 files, 2,252 tests. Native investigation changes only documentation and bead records, so no Rust gates were required. The previously validated Canvas2D and Pixi commits remain in this checkout.

Native profiling completes `canopi-74q9`; it does not claim all lag is fixed. `canopi-da6x` tracks the next measured optimisation. Temporary native app data, private traces, input scripts, screenshots, servers and baseline checkouts are removed after recording this evidence.
