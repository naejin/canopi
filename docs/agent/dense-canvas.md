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
  handles remain. PDF uses its own print projection: automatic screen names and
  the lens are not printed; authored text, pins, and distances remain printable.

At 50%, the real orchard's median 0.27m nearest spacing projects to only 2.7px.
Every name cannot fit there. Automatic Detail keeps positions readable; the lens
provides local identification without repeatedly changing the main camera.

## Ownership and interaction

`plant-spacing.ts` caches a spatial tree and nearest distances on immutable Scene
plant arrays. `plant-presentation.ts` owns the shared footprint and exact-centre
stack policy. Pass the complete Scene plant context into geometry queries.

`automatic-detail.ts` owns collision admission in pan-independent CSS coordinates;
`label-collision.ts` buckets rectangles and bounds cell enumeration for large text.
The layout cache holds two scales per immutable Scene. Both native renderers use
the same decisions on scene and viewport updates. No renderer writes Scene data.

`CanvasDocumentSurface.attachInspectionTo()` returns the disposable handle defined
in `canvas/inspection.ts`. `SceneCanvasInspectionOwner` owns the preview canvas,
signal subscription, ResizeObserver, coalesced animation frame, transient held
location, and its own hover highlight. Attachment failure rolls back resources.
Document replacement resets the held location; view close and runtime destruction
release the resources. Locale/theme updates refresh mounted views.

The shared `InspectionLens` component opens from the Canvas corner. Moving the
pointer inspects its world location; Hold freezes that location, and Follow resumes.
Main Canvas clicks retain normal editing behavior. The preview uses the existing
Canvas2D snapshot renderer at at least 700%, with nearby plant names in a separate
seven-entry list. Hover/focus matches an entry to its position; activation centres
the main camera without changing zoom or selection. Escape inside the panel closes
it and returns focus to its launcher. Names remain usable if 2D preview creation
fails. The preview shows plants and Zones; it does not duplicate the basemap or
crowded note/measurement text.

## Verification and privacy

The local reference contained 2,201 Plants across 117 Species, 127 Annotations,
113 Measurement Guides, and no coincident plant centres. Keep the source file,
its copies, and screenshots outside Git. Tests use anonymous fixtures, including
2,200 Plants at 0.14m by 0.27m spacing through 50/100/200/500/1000/2000%.

Regression coverage exercises distinct positions and coincident stacks, shared hit
and band bounds, collision admission through pan and zoom reversal, pin priority,
hidden Layers, annotation reveal, measurement reveal, renderer viewport updates,
and lens attachment rollback, holding, camera focus, reset, keyboard use, and
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
