# Canvas performance

Use this guide for dense-design lag. Keep renderer costs separate from document edits, hit testing, native IPC, and GPU completion. A WebGL backend may still be software rendered.

The scripted benchmark harness was deleted with the single-renderer change; a v2 harness is tracked with the deferred optimisation work in bd.

## Native development profiling

In a development app, open the native Web Inspector (`Ctrl+Shift+I` on Linux/Windows). The scene draws inside MapLibre's own canvas (`.maplibregl-canvas`) through the shared custom layer; there is no separate renderer canvas or renderer profiling registry.

For unattended native investigation on Linux, an isolated debug executable can expose WebKit's built-in HTTP inspector using `WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9231`. Use a private `dbus-run-session` and temporary `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_CACHE_HOME` so the single-instance plugin and user app data stay separate. Profile a copied Design. The HTTP target page links to the native inspector; WebKit protocol clients route commands through `Target.sendMessageToTarget` to the frame target, rather than assuming Chromium's debugging protocol. Wait for canvas readiness before replaying input. Activate/raise the native window through the window manager before physical pointer automation.

GPU strings may be generic: this Linux WebKit returned `Apple GPU` while `nvidia-smi pmon` attributed its process to a GTX 1080 Ti. Corroborate hardware with OS process attribution. Capture timing and CPU/heap separately, exclude setup, prefer short per-operation captures, and reject gestures whose expected state transitions did not occur. A second animation-frame callback is a frame-opportunity proxy, not GPU completion. See [native evidence and remaining cost](../native-canvas-performance.md).

Use Web Inspector's CPU/allocations timelines to explain expensive spans. For WebGL commands and buffer/texture churn, load a locally installed Spector.js standalone bundle in a development session and capture this canvas. It works without porting a browser extension or forking Spector. Keep capture disabled during timing comparisons. Use CrabNebula or a native sampling profiler only when measurements point to IPC/native work.

## Rendering invariants

- Invalidation is frame-coalesced, with scene updates taking precedence over viewport updates. Explicit awaited scene renders remain immediate for document settlement. New scene invalidations fence older in-flight preparations immediately; teardown cancels the pending animation frame.
- MapLibre owns the drawing surface size. A runtime resize is a camera-only viewport update and must not render an obsolete snapshot.
- The Inspection Lens preview culls Plant drawing with the same CSS-pixel margin as Pixi while retaining all Plants for spacing. It is stateless and uncached.
- Pixi Plant geometry uses CSS-pixel local origins and position transforms. Plants with exactly equal effective geometry share a `GraphicsContext`; the presentation owns and destroys those contexts. New Plant `Graphics` start on one presentation-owned empty external context so they do not allocate unused per-Plant contexts. Before removing a Plant or disposing the presentation, rebind its `Graphics` through Pixi's public setter and destroy the temporary context; Pixi does not detach destroyed `Graphics` listeners from an externally owned context by itself. The cache retains the current and two prior exact generations so A/B/A zoom movement can reuse geometry while continuous zoom churn remains bounded. Geometry cache keys include the exact footprint, symbol/LOD, colour, interaction appearance, focus opacity and theme edge styling. Changes to those facts must invalidate geometry; do not quantize botanical appearance to improve cache hits.
- Coincident-Plant stack counts may be retained only while the ordered visible Plant identities and selected Plant IDs match. Plant edits replace entity identities and must invalidate this cache.
- Plant culling includes a margin for interaction rings and stack badges. Spacing queries retain the full scene, including offscreen neighbours. Preserve display order and refresh hidden plants on re-entry.
- Zone/Measurement Guide geometry is reusable during pans; zoom changes screen-weight strokes and dash spacing. Text styles are retained until their effective properties change. Pure pans translate admitted names; full scene and zoom updates recompute admission.
- Keep performance assertions about work counts beside visual/state assertions. A faster renderer that drops selection, changes botanical appearance or publishes stale state is a regression.
