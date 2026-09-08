# Canvas zoom calibration

Calibration for `canopi-ms7l`, under PRD `canopi-fido`. These are implementation inputs; the dependent feature beads own production behavior.

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
| Ordinary scrolling | Pan by the negative normalized horizontal/vertical deltas | Content follows scrolling consistently across input devices. |
| Modified wheel/pinch | Multiply scale by `exp(−0.002 × normalizedDeltaY)` | A 120 px gesture changes scale by about 27%, between the tested 13% and 62% alternatives; small gestures remain small. Clamp the exponent to ±1 per event and retain camera limits. |
| Delta units | Pixel: 1; line: 16 CSS px; page: viewport width/height for the matching axis | Explicitly normalize units before interpreting a gesture. Read delta mode before the delta values. Zero and nonfinite input produce no camera movement. |

The existing symbolic Plant Visual Footprint curve (about 2–6.75 px radius), low-scale symbol simplification, Zone strokes, stack badges, selection/hover/lock cue hierarchy, and editing handle sizes remain the baseline. Their screen-space weight remains proportionate when text is removed; no evidence currently justifies a blanket resizing change. Physical Zone and Measurement Guide geometry and measurement visibility remain unchanged. The final coherence bead repeats this judgment with the integrated production behavior and actual interaction overlays.

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

Wheel handling follows the platform's [wheel event semantics](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event) and [delta units](https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent/deltaMode): modified wheel/pinch input must be normalized and consumed by the canvas owner. No device classifier is needed because ordinary scrolling pans for both mouse and trackpad.

Production navigation check (`canopi-84un`): the real SceneCanvasRuntime in headless Chrome with software WebGL started at (100,0), scale 8, reference 20 in a 1000×800 viewport. A browser wheel event (24,−40) panned to (76,40) at scale 8; Ctrl+wheel (0,−120) at pointer (300,250) zoomed to scale 10.169993 while preserving the pointer anchor. Each published one viewport revision; device pixel ratio and browser page scale stayed at 1. The runtime was destroyed after the check. These are browser-generated input events, not physical device measurements.
