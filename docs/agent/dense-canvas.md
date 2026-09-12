# Dense Canvas reading

Automatic Detail and the optional Inspection Lens are shared by Desktop and Web
Edition. The user selected them in `canopi-bzpg`; implementation is `canopi-peyy`.
The planting strip was rejected as unnecessary. Its prototype, variant switcher,
and development route have been removed.

## Presentation policy

- Preserve every authored position, colour, symbol, name pin, lock, and Layer.
  Reading the Canvas creates no Scene Edit, history entry, or dirty state.
- Keep the existing symbolic radius curve as the upper envelope. Cap each radius
  to 42% of its nearest distinct neighbour's screen distance, with a 0.65 CSS px
  visibility floor. Below 3.6px radius, use a solid position dot without an outline;
  otherwise use the authored native symbol recipe. These are position marks, not
  mature canopy sizes. Exact coincident centres alone receive stack counts.
- Use the same footprint for drawing, hit testing, selection bounds, and framing.
  The explicit 4px pointer allowance remains larger than the mark; nearest distance
  resolves overlapping plant hit areas, with existing order breaking ties.
- Admit plant names, Annotation text, and Measurement Guide distances into available
  screen space. Names try below and above the plant. Authored pins take precedence
  over automatic names. Unpinned automatic names become eligible at 500% (100px/m)
  and 35px nearest-neighbour separation. Prefer the localized Common Name, then
  the stored Common Name, then the Botanical Name. Use conservative text envelopes;
  admission does not move authored Annotation positions.
- Keep the calibrated 8–20px/m text fade. Crowded notes retain a quiet 4px square
  at their anchor; notes hidden solely by the overview fade retain the original
  8px note marker. Direct hover or single selection reveals the note. Marker/text
  hit geometry follows the actual presentation; full text remains the stable
  Fit to content envelope. Stamp previews retain their readable authored text.
  Pointer hit queries receive the current typed hover target so revealed text
  remains reachable when the pointer moves away from its marker.
- Measurement Guide lines remain at 0.8 CSS px and 25% opacity in their normal
  state. Admit a distance when its line has enough projected length for the text
  plus 16px and its label is clear of occupied space. Hover and selection reveal
  the distance with the established interaction emphasis.
- Existing Zone geometry/fills, explicit hover/selection/lock cues, and editing
  handles remain. PDF uses physical spacing for marks and checks complete text coverage;
  see [Canvas PDF](canvas-pdf.md). Automatic screen names and the lens are not printed.

At 50%, the real orchard's median 0.27m nearest spacing projects to only 2.7px.
Every name cannot fit there. Automatic Detail keeps positions readable; the lens
provides local identification without repeatedly changing the main camera.

## Ownership and interaction

`canvas/plant-spacing.ts` caches a spatial tree and nearest distances on immutable
positioned-plant arrays, shared by Canvas, lens and PDF projection. `plant-presentation.ts` owns the shared footprint and exact-centre
stack policy. Pass the complete Scene plant context into geometry queries.

`automatic-detail.ts` owns collision admission in pan-independent CSS coordinates;
`canvas/label-collision.ts` buckets rectangles and bounds cell enumeration for large text.
The layout cache holds two scales per immutable Scene. Both native renderers use
the same decisions on scene and viewport updates. No renderer writes Scene data.

`CanvasDocumentSurface.attachInspectionTo()` returns the disposable handle defined
in `canvas/inspection.ts`. `SceneCanvasInspectionOwner` owns the preview canvas,
signal subscription, ResizeObserver, coalesced animation frame, independent inspected
location, and its own hover highlight. Attachment failure rolls back resources.
Document replacement resets the inspected location; view close and runtime destruction
release the resources. Locale/theme updates refresh mounted views.

The shared `InspectionLens` component opens at the Canvas centre. Pointer movement over canvas artwork
updates the view through `inspectAtScreenPoint`, using host-relative CSS pixels.
The runtime converts to world coordinates. Moving onto controls leaves the view
at its last position; canvas editing drags do not redirect the lens. Drag inside the preview
or use arrow keys (Shift for larger steps) to pan. Recenter explicitly samples the
current main Canvas centre. Drag listeners release on up, cancel, lost capture,
window blur and unmount. There are no Hold/Follow controls or modes. The component also releases its canvas
pointer listener on close or host replacement.
Main Canvas clicks retain normal editing behavior. `inspection-layout.ts` selects a
local scale from the nearest distinct planting separation and places full localized
names inside the frame, with short connectors to their exact plant positions. The
layout reserves plant footprints and wraps long names at grapheme boundaries; it
never forces overlapping labels. The name/plant count exposes remaining crowding.
The scale is independent of the main camera; plus/minus adjust local magnification,
and Expand gives the frame more space. Hover/focus highlights the matching position;
activation centres only the lens. No separate plant list remains.

The owner publishes the frame dimensions, all visible plant positions and admitted
name rectangles through `canvas/inspection.ts`. The component renders accessible
name buttons and connector SVGs over the existing Canvas2D snapshot preview, using
the same measured 12px type and 16px line height. The preview shows plants and Zones;
it excludes basemaps, crowded notes and measurements. A failed 2D preview retains
position dots and names in the frame. Escape closes the panel and returns focus to
its launcher. Hidden plant Layers cannot enter the lens. Neither lens interaction
nor expansion changes the Design or the main camera.

The accepted reading prototype (`canopi-j0hd`, decision `canopi-n29c`) is retired.
Use the production lens and PDF workspace in either edition for further review.

## Verification and privacy

The local reference contained 2,201 Plants across 117 Species, 127 Annotations,
113 Measurement Guides, and no coincident plant centres. Keep the source file,
its copies, and screenshots outside Git. Tests use anonymous fixtures, including
2,200 Plants at 0.14m by 0.27m spacing through 50/100/200/500/1000/2000%.

Regression coverage exercises distinct positions and coincident stacks, shared hit
and band bounds, collision admission through pan and zoom reversal, pin priority,
hidden Layers, annotation reveal, measurement reveal, renderer viewport updates,
and lens attachment rollback, mouse-following, control exclusion, recentering, reset, drag/keyboard use, and
disposal. Run TypeScript, the full frontend suite, and both edition builds.

For visual review, import a local reference into the normal Web route and sweep
those six zooms. Compare actual Canvas2D and Pixi at DPR 1, 1.5, and 2 in both
themes, including viewport reversal and disposal. Headless software WebGL checks
do not establish physical GPU, native WebView, or mouse/trackpad performance.

The production check on 2026-09-09 exercised 36 paired configurations (six zooms,
two themes, three DPRs), including viewport reversal and resizing. Both renderers
retained the exact Scene and removed all their canvases on disposal. The normal
Web workspace also passed lens Hold, keyboard locate, Escape/focus return, and
unchanged-Scene checks against the local orchard. Screenshots remain local.

With the 2,201-plant reference, a 560×460 CSS px Canvas2D draw at DPR 1 after five
warmups (30 samples) measured median/p95 milliseconds of 7.3/15.3 at 50%,
7.1/11.1 at 100%, 8.3/19.7 at 200%, 12.2/15.3 at 500%, 16.9/20.0 at 1000%,
and 21.8/31.9 at 2000%. These are local synchronous draw timings under desktop
load, not end-to-end input latency or a cross-device frame-rate guarantee.
