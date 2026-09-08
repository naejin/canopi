# Canvas zoom calibration

Calibration for `canopi-ms7l`, under PRD `canopi-fido`. The selected values are now implemented. The final integrated evidence below records `canopi-lpdp` acceptance and the rendering corrections found during visual comparison.

## Selected defaults

| Presentation | Default | Reason |
| --- | --- | --- |
| 100% zoom | 20 CSS px per design meter | A useful working scale with full text; independent of window dimensions. Initial framing still fits the Design rather than forcing 100%. |
| Text fade | Hidden at or below 8 px/m; fully visible at or above 20 px/m | At 8 px/m the garden's names still overlap strongly. The earlier fade removes that clutter. |
| Fade interpolation | Smoothstep of the clamped scale fraction: `t²(3−2t)` | Continuous endpoints and reversible camera-only behavior, without a timer or a second camera. At 14 px/m text opacity is 0.5. |
| Annotation marker | Upright 8×8 CSS px outlined note with two short ink lines; 1.5 px stroke | Distinct from green Plant Symbols, compact at overview scale, legible in both themes. Center it on the Annotation position. |
| Marker transition | Marker opacity `1 − text opacity`; selected/edited text overrides both | Show text fully and omit the marker for one directly selected Annotation or an Annotation being edited. Group or multiple selection does not force text. |
| Annotation interaction | Below 0.5 text opacity, the marker owns hit geometry; at/above 0.5, text owns hit geometry | Faint text must not intercept clicks across the overview. Use a 4 px interaction allowance around the 8 px marker, distinct from its visible bounds. Coincident markers retain existing topmost-object ordering. |
| Fit to content | Retain full Annotation text as the framing envelope, even when faded | Avoid losing notes or oscillating between marker-sized and text-sized fit solutions. Other interaction/arrangement bounds follow the currently authoritative marker or text presentation. |
| Shift + wheel | Pan by the negative normalized horizontal/vertical deltas | Explicit pan gesture; Space-drag and middle-button pan also remain available. Ctrl/Cmd takes precedence over Shift for zoom. |
| Plain wheel, Ctrl/Cmd + wheel, pinch | Multiply scale by `exp(−0.002 × normalizedDeltaY)` | A 120 px gesture changes scale by about 27%, between the tested 13% and 62% alternatives; small gestures remain small. Clamp the exponent to ±1 per event and retain camera limits. |
| Delta units | Pixel: 1; line: 16 CSS px; page: viewport width/height for the matching axis | Explicitly normalize units before interpreting a gesture. Read delta mode before the delta values. Zero and nonfinite input produce no camera movement. |

The existing symbolic Plant Visual Footprint curve (about 2–6.75 px radius), low-scale symbol simplification, Zone strokes, stack badges, selection/hover/lock cue hierarchy, and editing handle sizes remain the baseline. Their screen-space weight remains proportionate when text is removed; no evidence currently justifies a blanket resizing change. Physical Zone and Measurement Guide geometry and measurement visibility remain unchanged. The final coherence pass retained these numeric values and corrected renderer inconsistencies, as recorded below.

## Evidence and reproduction

`createZoomCalibrationScene()` in the frontend test support provides deterministic synthetic scenes: a 36-plant garden (4 m spacing), 120-plant dense bed (1.5 m spacing), and 1,280-plant site (5 m spacing). Each includes long/localized names, three Annotations including multiline/rotated and locked notes, a rectangular Zone, a Measurement Guide, and an Object Group. Layer hiding and selection/lock scenarios can be applied without any user data.

The disposable experiment rendered actual Canvas2D geometry and text, then composited text separately to simulate four opacity policies: current always-visible text, 1–4 px/m, 4–10 px/m, and 8–20 px/m. Markers were simulated native canvas primitives. These captures are calibration evidence, not screenshots of a shipped feature. The throwaway page is removed after recording the result.

Each comparison is a two-by-two grid in the above order. Per-frame size is 560×460 CSS px, with world origin translated to (28,35) CSS px, except the precision case centered on the first plant. The dark garden uses DPR 1.5; the working/precision cases use DPR 2; the others use DPR 1. Initial exploratory comparisons also used 440×340 frames.

- [Garden at 8 px/m, dark, DPR 1.5](assets/canvas-zoom/garden-8-dark.png): the 4–10 policy leaves 74% opacity and overlapping names; 8–20 reveals the arrangement and keeps notes discoverable.
- [Garden at 14 px/m, light](assets/canvas-zoom/garden-14-light.png): the selected policy returns text at 50% opacity while retaining visible note markers.
- [Garden at 20 px/m, DPR 2](assets/canvas-zoom/garden-20-light.png): all policies restore full readable text. Long names may still overlap in dense planting; collision layout is outside this PRD.
- [Dense bed at 4 px/m](assets/canvas-zoom/dense-4-light.png) and [large site at 2 px/m](assets/canvas-zoom/site-2-light.png): removing overview text makes plant positions, boundaries, and persistent distances readable.
- [Precision at 1,000 px/m, dark, DPR 2](assets/canvas-zoom/garden-1000-dark.png): the existing bounded symbolic marker remains small rather than growing with physical geometry.

To repeat against production, build a renderer snapshot from the fixture, set the documented viewport/theme/DPR, and call the Canvas2D snapshot renderer or the Pixi scene renderer. Repeat viewport-only updates at 8, 14, and 20 px/m in both directions; separately apply single Plant/Annotation selection, multiple/group selection, Annotation editing, and hidden/locked Layers. Validate pointer hit targets at the visible marker/text bounds and keep full-text camera framing as an explicit exception. The final coherence record should use production presentation rather than the simulated compositing experiment.

## Input and performance evidence

Using the real CameraController at 20 px/m with an 800×600 viewport and pointer (263,184), simulated 120 px zoom gestures with sensitivities 0.001, 0.002, and 0.004 produced factors 1.1275, 1.2712, and 1.6161 respectively, with zero measured pointer-anchor displacement. This selects an initial sensitivity based on controlled event magnitude, not a claim of physical trackpad feel.

Canvas2D timing on the 1,280-plant site at 2 px/m, 560×460 CSS px, DPR 2: 5 warmups plus 30 samples gave baseline median/p95 8.6/11.9 ms with names, versus 5.9/7.2 ms with text omitted. This is a local synchronous rendering comparison, not end-to-end frame timing or a cross-device performance target; final verification must repeat the same workload with actual fading/markers.

The initial inspection browser had no WebGL/WebGL2 context, so its visual comparisons exercise Canvas2D. A separate headless Chrome session using ANGLE SwiftShader successfully created WebGL2; use that configuration for Pixi verification alongside renderer regression coverage. Physical mouse/trackpad feel and native WebView gestures cannot be inferred from synthesized browser events; report those checks separately.

Wheel input is normalized and consumed by the canvas owner. Plain vertical scrolling zooms; Shift scrolling pans. Ctrl/Cmd wheel and pinch zoom even with Shift held. The same policy applies to mouse and trackpad events, without guessing the device from delta magnitudes or units. `canopi-ojtj` supersedes the original scroll-to-pan choice after the user reported it broke the expected mouse-wheel zoom interaction.

Original production navigation check (`canopi-84un`, before the `canopi-ojtj` input-policy correction): the real SceneCanvasRuntime in headless Chrome with software WebGL enabled started at (100,0), scale 8, reference 20 in a 1000×800 viewport. A browser wheel event (24,−40) panned to (76,40) at scale 8; Ctrl+wheel (0,−120) at pointer (300,250) zoomed to scale 10.169993 while preserving the pointer anchor. Each published one viewport revision; device pixel ratio and browser page scale stayed at 1. The runtime was destroyed after the check. These are browser-generated input events, not physical device measurements. The correction's regression coverage dispatches WheelEvents through the mounted Scene Interaction listener and real CameraController, checking unmodified zoom in/out and pointer anchoring, pixel/line/page units, Shift pan, and modifier precedence.


## Final integrated verification

The production comparison uses actual renderer instances and `SceneRuntimePresentationController` snapshots from the synthetic corpus. Each pair shows Canvas2D on the left and Pixi on the right, at 560×460 CSS px with the viewport settings in the original calibration. Each renderer traversed 8→14→20→14→8 px/m, returned to the photographed scale, resized to 440×340 and back to 560×460, and refreshed its viewport. Each was disposed afterward. Screenshots are saved at CSS size; backing stores use the listed actual device density. Both backends now agree on density (for example, 1120×920 backing pixels at DPR 2).

| Capture | Theme / DPR | Observation |
| --- | --- | --- |
| [Garden overview, 8 px/m](assets/canvas-zoom/production-garden-8-dark.png) | Dark / 1.5 | Three discoverable note markers, no pinned text, visible distance and plant arrangement. |
| [Garden transition, 14 px/m](assets/canvas-zoom/production-garden-14-light.png) | Light / 2 | Both text types at half opacity, with upright note markers crossfading. |
| [Garden working view, 20 px/m](assets/canvas-zoom/production-garden-20-light.png) | Light / 2 | Readable authored fonts return fully; long pinned names may still overlap (collision layout remains outside scope). |
| [Dense bed, 4 px/m](assets/canvas-zoom/production-dense-4-light.png) | Light / 1 | Overview clarity with compact plant and note symbols. |
| [Large site, 2 px/m](assets/canvas-zoom/production-site-2-light.png) | Light / 1 | 1,280 plants remain spatially identifiable without covering the site with names. |
| [Precision, 1,000 px/m](assets/canvas-zoom/production-garden-1000-dark.png) | Dark / 2 | Plant symbol keeps its bounded radius and curved shape. |
| [Selected note, 4 px/m](assets/canvas-zoom/production-selected-note-4-dark.png) | Dark / 1.25 | One rotated multiline note reveals fully; outline follows its text; other notes remain markers. |
| [Selected group, 4 px/m](assets/canvas-zoom/production-selected-group-4-light.png) | Light / 1 | Member selection cues remain readable without revealing all pinned names. |

### Retained sizes and corrected rendering

No blanket resizing was justified. Retain the symbolic Plant radius curve and dot fallback, 8px note marker, 1.5px note stroke, existing Zone/selection/hover/lock stroke hierarchy, stack badge radius, and editing handle sizes. Physical dimensions and measurement visibility do not change.

The actual backend comparison revealed defects that simulated opacity alone could not expose:

- [Before: transition](assets/canvas-zoom/before-coherence-garden-14-light.png) and [before: selected note](assets/canvas-zoom/before-coherence-selected-note-4-dark.png) show blurred Pixi Annotation text. Pixi rasterized `fontSize / cameraScale`, then enlarged that texture. Text now rasterizes at authored CSS-pixel size, with the same font family and multiline spacing as Canvas2D; badges use the same screen-space approach.
- [Before: precision](assets/canvas-zoom/before-coherence-garden-1000-dark.png) shows a circular Pixi symbol collapsing into a diamond. Pixi now tessellates symbolic geometry at its shared screen footprint, avoiding tiny world-space primitives. Physical geometry keeps the camera transform.
- Pixi now uses the detected device density, instead of a one-pixel backing resolution at every DPR. Canvas2D Zone strokes divide by camera scale alone, so DPR 2 no longer halves their CSS-pixel weight.
- Pixi preserves CSS alpha when converting Zone fills and interaction strokes into numeric colors. This removes the previously heavier Zone fill and restores the same compositing as Canvas2D, including Layer opacity.

These changes follow the renderer's [scene graph coordinates](https://pixijs.com/8.x/guides/concepts/scene-graph), [text resolution behavior](https://pixijs.com/8.x/guides/concepts/performance-tips), and [application density options](https://pixijs.download/v8.14.1/docs/app.ApplicationOptions.html). Shared interaction/physical geometry is unchanged by these rendering corrections.

### Runtime interaction, fallback, and performance

In the actual 1000×800 SceneCanvasRuntime at DPR 2, clicking the overview note at (228,136) selected `note-1`, revealed its multiline text, and displayed the existing [Rotation Handle and Selection Action Toolbar](assets/canvas-zoom/production-runtime-selection.png). F2 opened the [readable 14px editor](assets/canvas-zoom/production-runtime-editing.png). Escape preserved the exact Scene snapshot, left undo unavailable, and destruction removed all canvases. These captures use the naturally selected Canvas2D backend.

The acceptance run discovered a pre-existing capability probe defect, tracked separately as `canopi-o1me`: `detectRendererCapabilities` requests incompatible context types on the same canvas, causing false WebGL negatives after acquiring 2D. This explains why automatic runtime selection uses Canvas2D even in software-WebGL Chrome. For backend verification, fresh independent canvases confirmed WebGL/WebGL2 support, and those measured capability facts were supplied to the existing RendererHost. It initialized actual Pixi, handled a deliberately injected render failure by switching to actual Canvas2D, rendered the same Scene, accepted a viewport-only change to 14 px/m, retained exactly one canvas, and removed it on disposal. This is an injected failure test, not a claim of physical GPU failure testing. The direct paired Pixi captures above do not depend on the faulty automatic probe.

A paired timing run compared the original Canvas2D renderer and pinned-label implementation from `ac30b478` with the final production renderer, using the same synthetic 1,280-plant site, 2 px/m, 560×460 CSS px, DPR 2, and one browser/canvas. After five warmup pairs, 30 samples per version alternated execution order. Baseline median/p95 was **8.2/10.9 ms**; final was **6.2/7.8 ms**. That is about 24% lower median synchronous rendering time. Temporary baseline modules were removed. A separate run during the full test suite measured 11.9/27.8 ms for the final renderer, demonstrating why the paired idle comparison is more useful than comparing unrelated samples. These are local synchronous draw timings, not end-to-end input latency or hardware guarantees.

TypeScript and the full frontend suite passed: **2,058 tests across 213 files**. Coverage includes camera percentage/limits, pointer anchoring and delta units, renderer viewport updates, DPR and fonts, Annotation geometry and text/marker boundaries, singleton versus mixed/group selection, locks/hidden Layers, editing cancellation, context paste after zoom, stable Fit to content from overview and precision scales, renderer-host fallback/lifetime, and exact map-camera projection. Agent guidance now describes implemented behavior; no pending zoom specification remains there.

Physical mouse/trackpad feel and native desktop WebView gesture handling were not exercised in this headless browser environment. Browser-generated wheel/modifier input was verified without changing page scale, while map alignment is supported by the existing map-camera regression suite. Native GPU/driver combinations and real basemap tile rendering were not visually tested. These limits do not imply new tuning settings or require the user to choose numeric defaults.
