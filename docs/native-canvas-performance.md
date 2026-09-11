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

**`canopi-da6x`** addresses this cache mismatch; the follow-up verification below records its implementation and measurements. Operation-scoped snapshot reuse remains separate work in `canopi-u8am`.

## Allocation observations

The optimised drag heap capture ended with about 12,025 more plain Objects and 1,281 more Arrays, while summed snapshot node sizes decreased from about 205.5 MB to 204.0 MB. Pan's totals decreased from about 207.5 MB to 206.7 MB. These whole-WebView snapshots include JIT, WebGL, cached page resources and garbage-collection effects. They support investigating allocation churn alongside cloning, but neither prove a leak nor measure total allocation volume. Node field interpretation follows [WebKit's heap snapshot reader](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebInspectorUI/UserInterface/Workers/HeapSnapshot/HeapSnapshot.js).

## Validation and handoff

The CSS discovery regression failed with locale collation and passed after code-unit sorting; all declarations remained covered. On the integrated checkout, focused CSS/architecture/Canvas2D coverage passed 43 tests, followed by TypeScript checking and the full frontend suite: 245 files, 2,252 tests. Native investigation changes only documentation and bead records, so no Rust gates were required. The previously validated Canvas2D and Pixi commits remain in this checkout.

The initial native profiling completed `canopi-74q9`; it did not claim all lag was fixed. It identified `canopi-da6x` as the next measured optimisation. Temporary native app data, private traces, input scripts, screenshots, servers and baseline checkouts are removed after recording this evidence.


## Spacing-cache follow-up (2026-09-11, canopi-da6x)

The spacing module now shares indices across four recent geometries using exact ordered coordinate comparison, while retaining its WeakMap fast path for immutable arrays. The cache owns coordinate copies. No SceneStore ownership, renderer interface, persistence format, or dependency changes were needed. Movement, addition and removal select a different geometry; metadata-only edits can reuse the index. A fresh snapshot incurs a linear coordinate comparison once, followed by cached queries. Reordering may miss the cache but cannot return an incorrect index.

A string-based geometry key was tried locally and rejected: its construction left the combined native query median at 7 ms. Direct coordinate comparison avoided that conversion/allocation cost.

The comparison used baseline `b12e53d3` and the final implementation in the same isolated Tauri/WebKitGTK window, with the same copied 2,201-Plant Design, 1,280 × 800 window, DPR 1, and native backend. Separate Vite servers supplied the frontend versions. The copied file remained byte-identical to the original after replay. No full-suite tests ran during the final timings.

- Forty fresh `getSceneSnapshot()` + spacing queries: baseline median **7 ms**, maximum **11 ms**; final implementation median **2 ms**, maximum **4 ms**. Results agreed within each run. An earlier final-code run measured a 1 ms median; use the uncontended 2 ms result for comparison.
- Five batches of forty spacing queries against separately pre-created snapshots, excluding snapshot cloning: baseline totals **528, 436, 643, 420, 400 ms**; final totals **13, 12, 10, 9, 9 ms**. This intentionally retains forty snapshots and stresses the cache mismatch; it is not an input latency or frame-rate benchmark. Separate snapshot-cloning totals remained **65–165 ms** per batch in the baseline and **91–134 ms** after the change.

Actual XTest input replay used twenty middle-button pan moves, twelve wheel-up clicks, twenty hover moves, then a 200 × 100 CSS-pixel Plant drag and undo. Pan displacement and final zoom matched; the intended Plant was selected and moved, and undo restored its position in both versions. Instrumentation counted coordinate-array sort calls, which expose the recursive spacing-tree construction work:

| Gesture | Baseline sort calls | Final sort calls |
| --- | ---: | ---: |
| Pan | 8,804 | 0 |
| Wheel zoom | 22,010 | 0 |
| Hover | 46,221 | 0 |
| Plant drag | 81,437 | 24,211 |

Native event coalescing and received pointer-event counts varied, so the drag counts are evidence of reduced repeated construction, not a stable percentage latency claim. Position changes still require new spacing geometry. These measurements verify reduced CPU work during zoom and other operations; they do not prove all visible lag is eliminated or measure GPU completion.

The fresh-SceneStore-read regression failed before the fix and passed afterward without tree rebuilding. Regression coverage also verifies move/add/remove, metadata edits, hydration, defensive ownership, coincident centres, empty scenes and placement previews. Final validation: **246 frontend test files / 2,256 tests**, `npx tsc --noEmit`, and `git diff --check` passed. Rust gates were not required because only frontend geometry caching, tests and documentation changed. The canvas runtime agent guide now describes the cache and snapshot immutability contract.

`canopi-u8am` tracks investigation of remaining repeated scene cloning. Temporary profiling scripts, copied Design, isolated app data, servers and baseline worktree are removed after verification.

## Scene-query cloning follow-up (2026-09-11, canopi-u8am)

Baseline `00fc06a9` already includes the spacing cache. Instrumenting the actual native `SceneStore.persisted` getter showed two defensive scene reads per selection query: one for the selection model and another inside `createPlantPresentationContext`. Four independently refreshed selection overlays amplified that cost during pan, including when nothing was selected. A three-round diagnostic of forty empty-selection queries recorded 80 scene reads per round, with 50–72 ms spent inside the cloning getter.

The fix remains local to each synchronous query. Nonempty selection and settled print capture pass their existing snapshot's Plants into presentation context construction. Empty selection returns fresh empty results without reading persisted state. There is no cross-call cache, changed SceneStore authority, or snapshot retained across edits. Hover-path consolidation and shared overlay refresh caching were considered but were unnecessary to achieve this measured reduction.

The same isolated Tauri/WebKitGTK window and copied 2,201-Plant Design were used before and after the change. The existing user app and Vite server were not instrumented or managed by this run; only the isolated window was instrumented. Five batches of forty queries measured the real query surface, with a temporary getter wrapper counting reads but without stack capture. A temporary internal selection fixture selected one Plant for the selected-query batches and restored the previous selection afterward.

| Query batch (40 calls) | Baseline scene reads | Final scene reads | Baseline median batch time | Final median batch time |
| --- | ---: | ---: | ---: | ---: |
| Empty selection | 80 | 0 | 110 ms | below 1 ms |
| One selected Plant | 80 | 40 | 89 ms | 73 ms |

All five batch timings in milliseconds: empty baseline `155, 236, 110, 70, 75`, final `1, 0, 0, 0, 0`; selected baseline `89, 76, 108, 121, 83`, final `277, 77, 73, 69, 68`. The final selected run includes a substantial first-batch outlier; these are diagnostic timings, not stable frame-rate or input-latency thresholds.

A separate matched XTest replay activated the isolated native window and sent twenty middle-button pan moves at 120 ms intervals, totaling 40 × 20 CSS pixels. Getter instrumentation recorded call stacks after timing the clone itself:

| Pan capture | Baseline | Final |
| --- | ---: | ---: |
| Full scene clones | 464 | 120 |
| Time inside scene-cloning getter | 488 ms | 145 ms |
| Reads attributable to selection queries/presentation | 344 | 0 |

This removes 74% of observed scene clones in this empty-selection pan. It does not mean every pan is 74% faster. The remaining capture includes 80 map-projection reads, 20 viewport-chrome reads, and 20 setup/hover/scene-render reads. `canopi-zr86` tracks that separate investigation; broader snapshot caching is not part of this change.

Regression tests first failed for the duplicate selection read, empty-selection reads and duplicate print read, then passed. Additional checks exercise live-preview movement, abort and commit, viewport-dependent bounds, defensive ownership of returned results, and refusal of print capture during an active edit. The copied Design remained byte-identical to the original; temporary scripts and isolated app data are removed after recording the aggregate evidence.

Final validation for `canopi-u8am`: **247 test files / 2,261 tests**, `npx tsc --noEmit`, `npm run build`, `npm run build:web` (including browser boundary checks), and `git diff --check` passed. The focused selection/presentation/interaction/print run passed 304 tests. Rust gates were not needed for this frontend-only read-path change. The canvas runtime agent guide documents operation-local snapshot reuse and its freshness boundary.

## Map and chrome follow-up (2026-09-11, canopi-zr86)

The `7b747448` native pan capture above established the baseline: 100 of its 120 full Scene reads came from camera-driven map/chrome work (five reads per pan step). Inspection confirmed those reads requested much more data than the callers needed:

- Map settings built Scene layer rows twice. `readCanvasMapLayerPresentation()` now projects map and terrain settings independently of Scene rows.
- Precision cloned the Scene before deriving its radial extent. `getScenePhysicalExtentMeters()` now returns the current scalar computed within SceneStore, using the existing physical-extent algorithm and projection precision policy.
- Empty Target overlays read geometry before constructing empty overlays. They now clear directly; active overlays retain their current-geometry query path.
- Chrome cloned the Scene for guides. It now receives a defensive copy of only the guide list.

These changes do not add a cross-edit snapshot cache or camera deadband. Physical extent reads observe live edits; guides remain owned copies. Read-side runtime interfaces and their test adapters were updated together.

An isolated native Tauri window loaded the same copied 2,201-Plant Design. The same twenty XTest pan moves at 120 ms intervals changed the camera by exactly 40 × 20 CSS pixels at unchanged scale. Instrumenting `SceneStore.persisted` recorded **zero full Scene reads** in the final capture; all 100 map/chrome reads identified in the baseline were eliminated. The baseline also included 20 incidental setup/hover/render reads absent from this capture, so its 120-to-zero total must not be described as a universal per-gesture reduction. Narrow geometry calculations, rendering, and other input work still consume CPU.

A controlled comparison in the same native WebView ran forty precision queries per batch, five batches. The previous path (`computeScenePhysicalExtentMeters(getSceneSnapshot())`) took **37, 35, 33, 32, 32 ms**, versus **5, 4, 6, 5, 3 ms** through the new scalar query: median **33 → 5 ms** per batch, with identical values in every comparison. This isolates avoided cloning; it does not measure GPU completion or frame rate.

Regression coverage verifies settings-only map reads, current precision and camera synchronization without whole-scene reads, clearing existing overlays when targets become empty, live-edit/abort extent freshness, and guide-copy ownership. Existing MapLibre tests retain exact small camera movements, active Target projection, terrain and lifecycle behavior. The isolated copied Design, instrumentation and app data are temporary and removed after recording aggregate evidence.

Final validation for `canopi-zr86`: **247 test files / 2,266 tests**, `npx tsc --noEmit`, and `git diff --check` passed; focused map/lifecycle/query/store coverage passed 44 tests. Runtime and MapLibre agent guides describe the narrow read surfaces. No Rust or transport contract changed, so Rust gates were not required for this bead.
