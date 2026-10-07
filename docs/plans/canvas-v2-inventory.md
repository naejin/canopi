# Canvas v2 inventory: what exists today and what happens to it

Trimmed 2026-10-02 at the phase-0 close (full earlier text at commit 76bd08a659d916069a340fc06e670e54e32f54c7), at the phase-F close (text before it at `99bbe615`), at the phase-1 close (text before it at `da12600b`) and at the phase-2 close (text before it at `f2db5e1a`); the R rows rewritten by phase R's amendment (2026-10-07, design check DR7).

Status: agreed (2026-09-29); scope amended 2026-10-01 (plan §1, "Decisions of 2026-10-01"); phase 0 and phase F done (2026-10-02); phase 1 done (2026-10-03) and phase 2 done (2026-10-06), their cleared rows deleted; input to docs/plans/canvas-v2-plan.md

This is the current-state inventory behind `docs/plans/canvas-v2-plan.md` and `docs/plans/canvas-v2-spec.md`. It covers every place that assumes a north-up or axis-aligned screen, and every copy of the world-to-screen transform. It also lists where input, tools, camera and rendering are entangled, every raw input listener, camera writer and focus or keyboard handler on the canvas path, every document statement of north-up or the old controls, and the stored data that touches bearing. Each row has a stable ID, so the plan, the beads and the reviewers can cite it (for example `INV-CAM-20`). Rows that phases 0, F, 1 and 2 cleared are deleted, and a kept row's phase column names only the work left; what phase 0 changed is in the plan's phase-0 summary, the phase-0 bead's receipt and git history at the commit above.

## How to read it

- **Paths.** Code paths are relative to `desktop/web/src/` unless they start with `common-types/`, `desktop/`, `docs/` or `.interface-design/`.
- **Fate.** `keep` (true under rotation and the new controls), `change` (the file stays, the behaviour or wiring changes) or `delete` (removed, with its replacement named).
- **Phase.** `1`, `2`, `3`, `R`, `release close`, as defined in `docs/plans/canvas-v2-plan.md`; `plan` means the planning change that added this inventory (the release close checks those documents against the code); `canopi-224j` means left standing for the audit after 2.0 (plan §4, phase 0, "Left standing"); `—` means no work is needed, ever. INV-CAM-20 is re-homed to the 2.0 bug fixes (canopi-f47t.17, U21).
- **Moved files.** Phase 0 deleted files many rows still cite; their line numbers are of the old file, and each brief finds the code at its entry HEAD. `canvas/runtime/scene-interaction.ts` → `canvas/runtime/interaction-session.ts`, `input/{dom-input-source,recognise}.ts`, `tools/tool-host.ts`, `canvas/runtime/keyboard-port.ts`; `interaction/shared-gestures.ts` → `input/recognise.ts`, `input/thresholds.ts`, `tools/select/{click,band,move-drag}.ts`; `interaction/hit-testing.ts` → `tools/{hit-testing,spatial-index}.ts`; `interaction/zone-drawing-tool.ts` → `tools/{zone-drag,polygon,measurement-guide}.ts`; `interaction/plant-spacing-tool.ts` → `tools/plant-row.ts`; `interaction/pointer-utils.ts` → `tools/tool-host.ts`; `interaction/text-annotation-tool.ts` → `tools/text-note.ts`; `interaction/{object-stamp-tool,saved-object-stamp-tool}.ts` → `tools/{object-stamp,saved-object-stamp,plant-stamp}.ts`; `interaction/selection-rotation-handle.ts` → `tools/select/rotate-handle.ts`, `chrome/handle-layer.ts`; `interaction/plant-placement-preview.ts` → `tools/plant-stamp.ts`, `renderers/draft-layer.ts`; `interaction/annotation-inline-editor.ts` → `tools/select/note-edit.ts`, `chrome/text-entry-host.ts`; `interaction/tool-actions.ts` → `tools/tool-actions.ts`; `control-point-overlay.ts` → `chrome/handle-layer.ts`; `drag-ops.ts` → `scene-runtime/drag-state.ts`, `tools/select/move-drag.ts`; `plant-drag-distance-overlay.ts` → `tools/distance-guides.ts`; `canvas/runtime/camera.ts` and `maplibre/workspace-camera.ts` → `view/{navigation,camera-driver,headless-driver}.ts`, `maplibre/camera-driver.ts`; `canvas/rulers.ts` → `chrome/rulers.ts`; `shortcuts/manager.ts`, `web/canvas-shortcuts.ts`, `app/shell/focus-regions.ts` → `app/keyboard/**`. `interaction/` keeps `canvas-context-menu.ts` and `contextual-selection-actions.ts`; the 2.0 cleanup deleted `layer-guards.ts` (S12).
- **Decisions.** ADR 0015 (rotating map and canvas controls), 0016 (one view transform), 0017 (input pipeline and gestures), 0018 (narrow tool interface), 0019 (rendering and the view transform), 0020 (focus and keyboard ownership). New module names (`view/`, `input/`, `tools/`, `chrome/`, `renderers/`, `app/keyboard/`) are the spec's; `view/` means `canvas/runtime/view/`, and so on for `input/`, `tools/`, `chrome/`.

## 1. Camera and view transform (INV-CAM)

| ID | Where | Assumes or does today | Fate | Phase |
|---|---|---|---|---|
| INV-CAM-16 | `canvas/projection.ts:84-93` | `stageScaleToMapZoom` / `mapZoomToStageScale` | keep (bearing-free; pitch-0 only, noted in ADR 0016) | — |
| INV-CAM-17 | `canvas/session-plane.ts:126-158` | Session plane: local Mercator, x east, y south; `transformTo` has no rotation | keep (the plane stays north-aligned at any bearing, ADR 0001) | — |
| INV-CAM-20 | `canvas/session-plane.ts:111-124`; callers `app/saved-views/current-view.ts:98-104` (`savedViewZoomFor`), `snapshot.ts:71` | `mapZoomToFitExtent` fits a north-up box to an unrotated frame; go-to, story restore and thumbnails fit the stored extent to the window | change; phase 1 made going to a view, story steps and thumbnails use the camera zoom; U21 replaces that: they store the visible ground size in the view's turned frame and fit that turned rectangle inside the window at the saved bearing, never zooming in past the saved zoom, falling back to the camera zoom without it (spec §4.10) | 2.0 bug fixes (canopi-f47t.17) |
| INV-CAM-29 | `maplibre/workspace-map.ts:25-41` | Map built with `bearing: 0`, `interactive: false`, `pitchWithRotate`/`dragRotate`/`touchZoomRotate: false` | keep; the driver's attach sets the bearing (`view/driver-host.ts` jumps to the runtime camera, bearing included), so `workspace-map.ts` needs no opening bearing (phase-1 drop 2) | — |
| INV-CAM-33 | `maplibre/host.ts:10-14` | `MapLibreHostViewState.bearing?` already exists | keep; the path follows S51's one map surface (M4) | — |

## 2. Copies of the world-to-screen transform (INV-XF)

Every row re-implements `p·scale + t` or its inverse from a bearing-blind `{x, y, scale}`. All route through the one `ViewTransform` (ADR 0016); policy P3b forbids the arithmetic outside `view/**`, with a named allowlist (scene chrome, rulers) emptied in phase 1, a permanent size-only allowlist, and a permanent exemption for `app/canvas-pdf/**`, whose paper projection maps page to ground, not the view (ADR 0008; today 1 match, `layout.ts:243`).

| ID | Where | What it computes | Fate | Phase |
|---|---|---|---|---|
| INV-XF-06 | `canvas/runtime/plant-presentation.ts` (entries), `renderers/billboard-layer.ts` | Entries rebuilt per frame with a radius from the exact scale | change; build() on a scene sync makes the entries, place() per frame projects all anchors, culls and sets the radius from cached spacing when the scale changed (A8) | R |
| INV-XF-20 | `canvas/runtime/renderers/world-layers.ts`, `pixi-scene.ts` (zone ghost width) | Zone, guide and grid stroke widths and dashes traced at the exact scale; every zoom frame re-traces them | change; traced at the zoom band's centre scale from `view/frame-source.ts`'s one band function, the ghost through the same width helper (A6, A9; drift ≤ 12 %, convention) | R |

## 3. Tools, hit testing and snapping under a bearing (INV-TOOL)

| ID | Where | Assumes today | Fate | Phase |
|---|---|---|---|---|
| INV-TOOL-17 | `canvas/runtime/scene-runtime/mutations.ts:87`, `:335`, `:913-914` | Paste and Duplicate offset copies 1 m east | keep (north-relative, convention) | — |
| INV-TOOL-18 | `canvas/saved-object-stamp-payload.ts:32-52`, `:141-179` | Saved stamps store world rotations | keep; thumbnails stay north-up | — |
| INV-TOOL-19 | `canvas/runtime/interaction/selection-rotation-handle.ts:283-292`; `canvas/runtime/scene-runtime/selection-rotation.ts:43-52`, `:125-130` | Handle angle is a world delta; Shift snaps the delta to 15°; pivot = world AABB centre | keep | — |
| INV-TOOL-22 | `canvas/runtime/interaction/plant-placement-preview.ts:70`, `:86`; `plant-spacing-overlay.ts:151-157` | Labels offset screen-up or screen-down | keep (upright on purpose) | — |
| INV-TOOL-26 | `canvas/contours.ts:158` | Hillshade `illumination-anchor: 'viewport'`: the light stays top-left as the map turns | keep (not decided by the design; a phase-1 convention, named at the phase-1 handoff (plan §8)) | — |
| INV-TOOL-27 | `canvas/plants.ts` (`PlantLOD`) | Plant LOD bands at 0.5 and 5 px/m | change; S40 keeps only the dot switch (`isDotScale`, below 0.5 px/m), evaluated on the rounded radius; glyph contexts are keyed by the radius rounded to 0.25 px (A7), not by LOD band | R |

## 4. Rendering, chrome and per-frame work (INV-REN)

| ID | Where | Does today | Fate | Phase |
|---|---|---|---|---|
| INV-REN-04 | `canvas/runtime/renderers/billboard-layer.ts` (the present pass) | Every pan frame redraws rings, badges, note markers and outlines, rebuilds the entries and restyles note text and measurement labels | change; shared ring, badge and marker contexts keyed by state, rounded radius and resolved colours, placed per frame; the note outline drawn once in local px (A7, A8) | R |
| INV-REN-05 | `canvas/runtime/renderers/billboard-layer.ts` (glyph context key), `plant-presentation.ts` | One glyph context per exact radius, so every zoom frame tessellates; contrast and spacing per plant per frame | change; radius rounded to 0.25 px in the key and the drawing, contexts warm once; spacing and contrast computed in build() (A7, A8; canopi-p32r) | R |
| INV-REN-06 | `canvas/runtime/plant-symbol-recipes.ts:35`, `:397` | Plant glyphs are side-view pictograms on a ground line | keep upright (billboards) | — |
| INV-REN-07 | `canvas/runtime/plant-presentation.ts:84-87` | Stack badge offset top-right on screen | keep | — |
| INV-REN-11 | `canvas/runtime/scene-runtime.ts` (`_invalidate('viewport')`) | Every viewport invalidation synchronously calls `refreshMeasurements()`, so each camera frame with Select armed and a selection rebuilds the selection model and handles | change; the synchronous refresh goes, the tools phase's own frame subscription follows the view (A22, R4; runtime test "a pan calls no `setHandles`"); overlays stay on `left`/`top` (U44, Q1) | R |
| INV-REN-12 | `canvas/runtime/scene-runtime.ts` (hover), `tools/tool-host.ts` (re-emit) | A hover change is a whole scene sync; under a resting pointer every camera frame re-runs the passive hover | change; no change set (P9, P12); a camera frame re-emits only the tool's hover and hides the tooltip, and the passive hover stays on its object until the next pointer move (Q3 D, R8); hover-only syncs stay whole (A18) | R |
| INV-REN-16 | `canvas/runtime/automatic-detail.ts` | Detail layout memoised per Scene at the exact scale; plant-name admission on every frame, the hovered plant first | change; the exact-scale memo stays the one layout that drawing, hit testing, `selection.ts` and `scene-extent.ts` read (P13), keyed also by the note measure epoch (A1); plant names admitted on settle, band change and scene sync (A11), with no hover priority (Q4) | R |
| INV-REN-19 | `maplibre/panel-target-overlays.ts:66-135` | Panel targets as MapLibre layers | keep (they rotate natively) | — |
| INV-REN-21 | `maplibre/map-background.ts:215-220`; `maplibre/raster-display/adapter.ts:292-327`; `maplibre/satellite-bind.ts:366-374`; `app/canvas-map-surface/workspace-map-contributions.ts:379-380` | `getBounds()` for tiles, satellite metadata and LiDAR view bounds | keep (AABB of the rotated view; slight over-fetch) | — |
| INV-REN-23 | `canvas/runtime/plant-display.ts:150-163` | Module-level `plantDisplay` global read by drawing, bounds and labels | keep; retained geometry invalidates on it | R |

## 5. Where input, tools, camera and rendering are entangled (INV-ENT)

| ID | Where | Entanglement | Fate | Phase |
|---|---|---|---|---|
| INV-ENT-14 | `canvas/runtime/scene-runtime/selection.ts`, `chrome/handle-layer.ts` | The selection model is built per call, 2-4 times per selection change and on every pan frame | change; handles already move in `onViewFrame('overlays')` by `left`/`top` with no element created (kept, U44); left: the selection model memoised by reference with its dev build counter (A4, R4) | R |
| INV-ENT-15 | `tools/select/move-drag.ts`; `canvas/runtime/scene-commands.ts` | A move-drag mutates the Scene per move; history by `JSON.stringify` | change; no `setSelectionPreview` (P9): the move-drag is measured on the orchard and recorded on canopi-f47t.9 in R; the history half stays open after R (canopi-f47t.9, after 2.0) | R |
| INV-ENT-17 | `canvas/runtime/scene-interaction.ts:1336-1339`; `canvas/runtime/scene-runtime.ts:72-74`, `:202`; `canvas/runtime/command-surface.ts:254-257`; `canvas/session-state.ts:4-18` | Tools switch the app's tool state; any string is a tool id | change; `ToolEffects.switchTool`; typed `ToolId` end to end with no "no tool armed" state (`canvas/session-state.ts` included; 0B-5's open item 7, with item 18, plan §4); arming through `app/keyboard/arming.ts` (F) | canopi-224j (left standing, plan §4 phase 0) |
| INV-ENT-21 | `components/canvas/ZoomControls.tsx` | The zoom group reads only `zoomLimit` and `groundMetresPerPixel` (the property holds) | change; the render-count guard "an east-west pan at a constant zoom does not re-render the zoom group" (A17, R9) | R |

## 6. Raw input listeners on the canvas path (INV-LSN)

| ID | Where | Listener | Fate | Phase |
|---|---|---|---|---|
| INV-LSN-18 | `canvas/runtime/inspection-lens.ts:141-143` | `document.fonts` `loadingdone`, `ResizeObserver` | keep (P6 allowlist, commented) | — |
| INV-LSN-19 | `components/canvas/InspectionLens.tsx:81-101` | Lens frame drag: `pointerdown`, document `pointermove`/`pointerup`/`pointercancel`, window `blur` | keep (own element; lens mini-camera) | — |
| INV-LSN-21 | `components/shared/ActionMenu.tsx:92-93`, `:152-156`; `Dropdown.tsx:90-91`; `DatePicker.tsx:179-180`; `MenuBar.tsx:68`; `SaveStatusLabel.tsx:132`; `components/canvas/ZoomControls.tsx:113`; `components/plant-db/MoreFiltersPanel.tsx:47` | Document `pointerup` "outside" closers; only the context menu ignores button 2 (`ActionMenu.tsx:152`) | keep; a pan that ends outside closes popovers (one rule, stated in the spec), and the context menu's closer still ignores a secondary release, so a still right-click's own release opens or replaces the menu (phase 2) | — |
| INV-LSN-22 | `components/shared/usePointerResize.ts:73-75`; `usePointerReorder.ts:32-34` | Document pointer listeners for panel resize and reorder | keep (panel chrome, FAP) | — |
| INV-LSN-25 | `components/panels/FavoritesPanel.tsx:621`, `:832-833`; `components/plant-db/PlantRow.tsx:45-46`, `:67`; `web/WebSpeciesCatalogPanel.tsx:226` | HTML5 `dragstart` sources for drops on the map | keep | — |
| INV-LSN-28 | `components/panels/Panels.module.css:45-51` | The map host sets no `touch-action`; only handles and the lens preview do | change; `touch-action: none` asserted | 3 |

## 7. Camera writers (INV-WR)

Every call that moves the camera. Only `maplibre/camera-driver.ts` (and the World map) calls MapLibre camera methods (policy P1); everything else commands through `ViewNavigation` or `ViewCommandSurface`.

| ID | Where | Writer | Fate | Phase |
|---|---|---|---|---|
| INV-WR-03 | `components/world-map/WorldMapSurface.tsx:147`, `:148`, `:167` | World map `fitBounds`, `resize`, `flyTo` | keep (P1 exception); the `:148` resize and the host's resize hook for this request stay here (the World map has no camera driver) | — |
| INV-WR-16 | `app/shell/visible-map-area.ts:180-188` | `setFramingInsets` effect | keep (screen-space insets) | — |
| INV-WR-18 | new | Rotation writers: Shift+right- or middle-drag, Shift+←/→, N / Shift+N / Shift+↑, compass button and ring, two-finger twist, trackpad rotate, "Turn view to this edge", saved views | new; all through `ViewNavigation` and one `RotationSession`; phase 1 built Shift+middle-drag, the keys, the compass, the trackpad twist, "Turn view to this edge" and saved views; phase 2 built Shift+right-drag; left: the two-finger twist | 3 |

## 8. Keyboard and focus (INV-KEY, INV-FOC)

Phase F cleared the key router, Esc chain, focus owner and arming rows (plan §4, phase F); the rows left are the later phases' key changes.

| ID | Where | Handler | Fate | Phase |
|---|---|---|---|---|
| INV-KEY-20 | `components/canvas/StampChooser.tsx:49-54`; `SpeciesChooser.tsx:86-90`; `SiteOnboarding.tsx:42-46`; `components/canvas/InspectionLens.tsx:121`; `ZoomControls.tsx:138-168`; `components/shared/ActionMenu.tsx:262-281`; `web/BrowserAppShell.tsx:199-203` (`PhoneSearch`, the phone search card) | Local widget keys (JSX `onKeyDown` on the widget's own element) | keep; the one-Esc rule is held by `app/keyboard/escape-chain.test.ts` (plan section 5, behaviour tests; no P13 allowlist is written). Their arrows are checked against the router's arrow-owning rule in INV-KEY-23 | — |

## 9. Stored data that touches bearing (INV-DATA)

None of these changes the `.canopi` format. Settings lost `snap_to_guides` and `LastView.bearing`, which phase 1 added (phase 2's cut stage, U33), and `scroll_wheel` keeps its values under "Pointing device: Mouse / Trackpad"; the per-area PDF angle was dropped (U3). Any other stored-format change may be made when it improves the project and is named in the handoff (ADR 0021, "Later format changes").

| ID | Where | Today | Fate | Phase |
|---|---|---|---|---|
| INV-DATA-04 | `common-types/src/views.rs:199-220` | Story steps hold only a view id | keep (steps inherit the view's bearing) | — |
| INV-DATA-19 | `common-types/src/design.rs:14`; `generated/canopi-design-format.ts:18` | `north_bearing_deg` (v1 Design anchor) refused as a root key | keep refused; never reuse the name | — |

## 10. Documents, patterns, boards and locales (INV-DOC)

Line numbers are hints at the planning commit. Since U1 every document row is checked and corrected once, at the release close (plan §4, "2.0 release close", step 3): a row's phase names the phase whose code makes its statement true, not a phase that edits the document. Locale rows (`i18n/*.json`) are the exception: their strings land with their phase (spec §9). Rows marked `plan` are documents the planning change rewrote to the target.

| ID | Where | Statement (abridged) | Fate | Phase |
|---|---|---|---|---|
| INV-DOC-01 | `docs/guides/map-workspace.md:11` | "The camera owner (`maplibre/workspace-camera.ts`) is the only writer… The map is north-up, pan/zoom only: no bearing, pitch or rotation anywhere." | change: one camera driver; centre, zoom, bearing; pitch 0 but assumed nowhere | plan |
| INV-DOC-02 | `docs/guides/map-workspace.md:14`, `:31`, `:32`, `:33` | DOM pointer owner is `scene-interaction.ts`; tools are `SceneToolAdapter`; nudge 1 m with Shift; Scroll wheel rules | change: input pipeline, narrow tools, mod large step, bindings | plan |
| INV-DOC-03 | `docs/adr/0001-geolocated-map-canvas.md:15` | "Pan, zoom, fit and place search move only the camera." | change: adds rotation; bearing is a view property; the plane stays north-aligned | plan |
| INV-DOC-04 | `docs/adr/0004-one-renderer.md:14`, `:16` | MapLibre "owns… camera"; "a tool-owned gesture disables map navigation until it ends" | change: MapLibre holds the camera state, Canopi computes every move through one driver; navigation stays live during a tool's drag | plan |
| INV-DOC-05 | `docs/adr/0008-canvas-pdf-export.md:14` | PDF layout in session-plane metres at exact ground scale (implicitly north-up) | change: map orientation option and Print Area angle | plan |
| INV-DOC-06 | `docs/adr/0010-map-first-interface.md:12`, `:19`, `:24` | Floating chrome without a compass; "single-key shortcuts only while the map has focus"; "Rotate is Ctrl Alt R" | change: compass in the zoom group, Pan tool off the rail, single keys anywhere except text fields, view rotation keys distinct from object Rotate… | plan |
| INV-DOC-07 | `docs/adr/0011-analyses-provenance-and-stories.md:19` | Saved views: camera (lon, lat, zoom, bearing) and framed ground | change: views and stories restore their bearing; extent from four corners | plan |
| INV-DOC-08 | `docs/architecture.md:37` | "There is no anchor, north bearing, placement status or altitude" | change: say it is the Design-level bearing; a view's bearing is view state | release close |
| INV-DOC-09 | `docs/architecture.md:26`, `:41` | Settings list (no `scroll_wheel`); "Pan, zoom, fit and place search move the camera only" | change: pointing device; add rotate | release close |
| INV-DOC-10 | `docs/guides/design-document.md:11`, `:49` | Settings own `scroll_wheel`; Do not "persist… an anchor or a bearing" | change: pointing device (2); "a Design-level bearing; a saved view's bearing is allowed" (1) | release close |
| INV-DOC-12 | `docs/guides/frontend.md:12`, `:13`, `:28`, `:45`, `:58-59` | Two shortcut dispatchers; `focus-regions.ts` owns F6; "the map's Esc chain owns" Esc | change: one key router, focus owner and Esc chain | release close |
| INV-DOC-13 | `docs/guides/editions.md:20`, `:22` | Browser-reserved shortcuts; phone layout | keep; check new keys against the reserved list | release close |
| INV-DOC-17 | `.interface-design/patterns/canvas-workspace.md:24`, `:26-27` | "square corner handles" (they do not exist); right-click opens the menu | change: no corner handles (F); a still right-click opens the menu, right-drag pans (2) | release close |
| INV-DOC-18 | `.interface-design/patterns/canvas-workspace.md:36`, `:41`, `:42`, `:50`, `:54` | Select card "Space + drag or H pans · wheel zooms"; Shift keeps 45°; "Space pans temporarily"; lens source rectangle; stories fly | change: pan hints per bindings, screen-relative constraints, lens and story bearing | release close |
| INV-DOC-19 | `.interface-design/patterns/controls-and-shell.md:9`, `:34`, `:56` | View menu without rotation commands; Settings "Scroll wheel"; phone strip Select, Pan, Place plants, Polygon | change: Reset north, Turn view left/right 15° (1); Pointing device (2); phone keeps Pan, adds compass (1) | release close |
| INV-DOC-20 | `.interface-design/patterns/controls-and-shell.md:15`, `:42`, `:44` | Recent sketch "north up"; PDF sheet; preview displacement by drag and arrows | keep `:15`; change `:42`, `:44` for Map orientation | release close |
| INV-DOC-21 | `CONTEXT.md:31`, `:39`, `:41`, `:43`, `:75` | Settings › Canvas names Scroll wheel; "Only the camera moves"; Last view; Saved view "camera position"; right-click menu | change: Pointing device; position and direction; last view keeps centre and zoom; "a still right-click"; glossary term for the compass | release close |
| INV-DOC-22 | `docs/review-checklist.md:21`, `:24`, `:27`, `:28`, `:87-88` | Pan, zoom, search; Esc; right-click; arrows with Shift; Scroll wheel | change: rotation checks, right-drag, mod large step, Pointing device | release close |
| INV-DOC-23 | `docs/release-notes/v2.0.0.md:3`, `:12`, `:14`, `:56` | "Pan, zoom and search move only the view"; right-click; nudge 1 m with Shift; Scroll wheel setting | change in the release that ships each phase (2.0 is on hold) | release close |
| INV-DOC-24 | `docs/plans/canvas-controls.md:1-65` | Draft controls plan, superseded by the rotation decision | delete; replaced by `canvas-v2-plan.md`, `canvas-v2-spec.md` and this inventory | plan |
| INV-DOC-25 | `.interface-design/boards/boards_a.py:79`, `:83` (Rules board) | "Single-letter tool keys work only while the map has focus… lets people remap them"; Web binds shortcuts only with map focus | change: anywhere except text fields; no remapping | release close |
| INV-DOC-26 | `.interface-design/boards/boards_b.py:523-525` (Shortcuts board) | "Tools (while the map has focus)"; "Pan · H · hold Space"; zoom `Ctrl + · Ctrl −` | change: heading (F); pointer and rotation rows, zoom keys (1, 2) | release close |
| INV-DOC-36 | `en.json:1840` (`gettingStarted.menu`) | "Right-click anything on the map for its commands" | kept as is in phase 2 (a still right-click still opens the menu, on release); whether a pan and turn line is added is the release close's | release close |
| INV-DOC-37 | `en.json:1942` (`presentation.keysHint`) | Space moves a presentation step | keep; the presenter's own handler owns Space | — |

All locale keys exist in 11 files with the same line layout, so an `en.json` line locates the key everywhere; every change lands in all 11 in one commit.

## 11. Tests that encode today's behaviour (INV-TEST)

Phase 2 cleared the last row (INV-TEST-09); each later phase's plan section names the tests it rewrites.

## 12. Open items for the plan

1. **Tauri `dragDropEnabled`** stays at its default (`desktop/tauri.conf.json`), so native file-path drops keep working (R4). Whether Windows lets HTML5 panel drops reach the map is not checked by hand (U9, U20): canopi-f47t.6.2 stays open as a known unverified item; if a Windows user reports them blocked, a separate bead rebuilds panel drags on pointer events.

## 13. Retired rows

Rows phases 0, F, 1 and 2 cleared are deleted (full text at the commits above). Three cleared rows still state a rule a later phase needs:

| ID | Fate |
|---|---|
| INV-LSN-13 | the rotation handle's `click` stop and `keydown` swallow moved to `chrome/handle-layer.ts:8` as is; handling only its own keys is a later behaviour change, not scheduled |
| INV-ENT-04 | overview (phase 2, U36): a left press pans in every tool, for every pointer, and nothing is selectable there; a Shift+middle-drag turns the view; a long press opens no menu, so phase 3's touch rules keep one-finger pan there |
| INV-KEY-18 | element keydown on runtime-owned controls and fields stays the P8 allowlist: `chrome/handle-layer.ts`, `chrome/text-entry-host.ts` |
