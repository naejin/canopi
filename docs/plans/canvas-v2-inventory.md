# Canvas v2 inventory: what exists today and what happens to it

Trimmed 2026-10-02 at the phase-0 close (full earlier text at commit 76bd08a659d916069a340fc06e670e54e32f54c7) and at the phase-F close (text before it at `99bbe615`) and at the phase-1 close (text before it at `da12600b`).

Status: agreed (2026-09-29); scope amended 2026-10-01 (plan §1, "Decisions of 2026-10-01"); phase 0 and phase F done (2026-10-02); phase 1 done (2026-10-03), its cleared rows deleted; input to docs/plans/canvas-v2-plan.md

This is the current-state inventory behind `docs/plans/canvas-v2-plan.md` and `docs/plans/canvas-v2-spec.md`. It covers every place that assumes a north-up or axis-aligned screen, and every copy of the world-to-screen transform. It also lists where input, tools, camera and rendering are entangled, every raw input listener, camera writer and focus or keyboard handler on the canvas path, every document statement of north-up or the old controls, and the stored data that touches bearing. Each row has a stable ID, so the plan, the beads and the reviewers can cite it (for example `INV-CAM-20`). Rows that phases 0, F and 1 cleared are deleted, and a kept row's phase column names only the work left; what phase 0 changed is in the plan's phase-0 summary, the phase-0 bead's receipt and git history at the commit above.

## How to read it

- **Paths.** Code paths are relative to `desktop/web/src/` unless they start with `common-types/`, `desktop/`, `docs/` or `.interface-design/`.
- **Fate.** `keep` (true under rotation and the new controls), `change` (the file stays, the behaviour or wiring changes) or `delete` (removed, with its replacement named).
- **Phase.** `1`, `2`, `3`, `R`, `release close`, as defined in `docs/plans/canvas-v2-plan.md`; `plan` means the planning change that added this inventory (the release close checks those documents against the code); `canopi-224j` means left standing for the audit after 2.0 (plan §4, phase 0, "Left standing"); `—` means no work is needed, ever. INV-CAM-20 is re-homed to the 2.0 bug fixes (canopi-f47t.17, U21).
- **Moved files.** Phase 0 deleted files many rows still cite; their line numbers are of the old file, and each brief finds the code at its entry HEAD. `canvas/runtime/scene-interaction.ts` → `canvas/runtime/interaction-session.ts`, `input/{dom-input-source,recognise}.ts`, `tools/tool-host.ts`, `canvas/runtime/keyboard-port.ts`; `interaction/shared-gestures.ts` → `input/recognise.ts`, `input/thresholds.ts`, `tools/select/{click,band,move-drag}.ts`; `interaction/hit-testing.ts` → `tools/{hit-testing,spatial-index}.ts`; `interaction/zone-drawing-tool.ts` → `tools/{zone-drag,polygon,measurement-guide}.ts`; `interaction/plant-spacing-tool.ts` → `tools/plant-row.ts`; `interaction/pointer-utils.ts` → `tools/tool-host.ts`; `interaction/text-annotation-tool.ts` → `tools/text-note.ts`; `interaction/{object-stamp-tool,saved-object-stamp-tool}.ts` → `tools/{object-stamp,saved-object-stamp,plant-stamp}.ts`; `interaction/selection-rotation-handle.ts` → `tools/select/rotate-handle.ts`, `chrome/handle-layer.ts`; `interaction/plant-placement-preview.ts` → `tools/plant-stamp.ts`, `renderers/draft-layer.ts`; `interaction/annotation-inline-editor.ts` → `tools/select/note-edit.ts`, `chrome/text-entry-host.ts`; `interaction/tool-actions.ts` → `tools/tool-actions.ts`; `control-point-overlay.ts` → `chrome/handle-layer.ts`; `drag-ops.ts` → `scene-runtime/drag-state.ts`, `tools/select/move-drag.ts`; `plant-drag-distance-overlay.ts` → `tools/distance-guides.ts`; `canvas/runtime/camera.ts` and `maplibre/workspace-camera.ts` → `view/{navigation,camera-driver,headless-driver}.ts`, `maplibre/camera-driver.ts`; `canvas/rulers.ts` → `chrome/rulers.ts`; `shortcuts/manager.ts`, `web/canvas-shortcuts.ts`, `app/shell/focus-regions.ts` → `app/keyboard/**`. `interaction/` keeps `canvas-context-menu.ts` and `contextual-selection-actions.ts`; `layer-guards.ts` goes in the 2.0 cleanup (S12).
- **Decisions.** ADR 0015 (rotating map and canvas controls), 0016 (one view transform), 0017 (input pipeline and gestures), 0018 (narrow tool interface), 0019 (rendering and the view transform), 0020 (focus and keyboard ownership). New module names (`view/`, `input/`, `tools/`, `chrome/`, `renderers/`, `app/keyboard/`) are the spec's; `view/` means `canvas/runtime/view/`, and so on for `input/`, `tools/`, `chrome/`.

## 1. Camera and view transform (INV-CAM)

| ID | Where | Assumes or does today | Fate | Phase |
|---|---|---|---|---|
| INV-CAM-16 | `canvas/projection.ts:84-93` | `stageScaleToMapZoom` / `mapZoomToStageScale` | keep (bearing-free; pitch-0 only, noted in ADR 0016) | — |
| INV-CAM-17 | `canvas/session-plane.ts:126-158` | Session plane: local Mercator, x east, y south; `transformTo` has no rotation | keep (the plane stays north-aligned at any bearing, ADR 0001) | — |
| INV-CAM-20 | `canvas/session-plane.ts:111-124`; callers `app/saved-views/current-view.ts:98-104` (`savedViewZoomFor`), `snapshot.ts:71` | `mapZoomToFitExtent` fits a north-up box to an unrotated frame; go-to, story restore and thumbnails fit the stored extent to the window | change; phase 1 made going to a view, story steps and thumbnails use the camera zoom; U21 replaces that: they store the visible ground size in the view's turned frame and fit that turned rectangle inside the window at the saved bearing, never zooming in past the saved zoom, falling back to the camera zoom without it (spec §4.10) | 2.0 bug fixes (canopi-f47t.17) |
| INV-CAM-29 | `maplibre/workspace-map.ts:25-41` | Map built with `bearing: 0`, `interactive: false`, `pitchWithRotate`/`dragRotate`/`touchZoomRotate: false` | keep; the driver's attach sets the bearing (`view/driver-host.ts` jumps to the runtime camera, bearing included), so `workspace-map.ts` needs no opening bearing (phase-1 drop 2) | — |
| INV-CAM-33 | `maplibre/host.ts:10-14` | `MapLibreHostViewState.bearing?` already exists | keep | — |
| INV-CAM-34 | `maplibre/world-map.ts:55-84`, `:108-114` | World map: interactive, drag and touch rotation off, NavigationControl without compass; `readWorldMapViewState` drops bearing (its keyboard no longer turns or tilts it since phase 1) | keep north-up and left-drag pan (convention); change: `boxZoom: false` | 2 |

## 2. Copies of the world-to-screen transform (INV-XF)

Every row re-implements `p·scale + t` or its inverse from a bearing-blind `{x, y, scale}`. All route through the one `ViewTransform` (ADR 0016); policy P3b forbids the arithmetic outside `view/**`, with a named allowlist (scene chrome, rulers) emptied in phase 1, a permanent size-only allowlist, and a permanent exemption for `app/canvas-pdf/**`, whose paper projection maps page to ground, not the view (ADR 0008; today 1 match, `layout.ts:243`).

| ID | Where | What it computes | Fate | Phase |
|---|---|---|---|---|
| INV-XF-06 | `canvas/runtime/plant-presentation.ts:111`, `:158-159`, `:182`, `:277` | `screenPoint` in every `PlantPresentationEntry` (couples presentation to pan); radius in px from scale | change; world anchors, billboards projected in bulk | R |
| INV-XF-19 | `canvas/runtime/renderers/pixi-scene.ts:780-785`, `:817`, `:948`, `:995-996`, `:1016-1017`, `:1116-1118`, `:1131`, `:1153`, `:1184`, `:1226` | Per-object CPU projection for culling, glyphs, rings, badges, notes, markers, outlines and labels | change; `renderers/billboard-layer.ts` via `projectAnchors` | R |
| INV-XF-20 | `canvas/runtime/renderers/pixi-scene.ts:982-984`, `:440-461`, `:492-505`, `:596-598` | `screenPxToWorldPx`: stroke widths and dashes baked in world units per exact scale | change; geometry per zoom band (drift ≤ 12 %, convention) | R |

## 3. Tools, hit testing and snapping under a bearing (INV-TOOL)

| ID | Where | Assumes today | Fate | Phase |
|---|---|---|---|---|
| INV-TOOL-03 | `canvas/runtime/interaction/zone-drawing-tool.ts:166-177`; `tool-actions.ts:18-72` (`rotationDeg: 0` at `:32`, `:61`) | Rectangle and ellipse commit the world AABB, north-aligned | change; screen-aligned shapes store `rotationDeg` = bearing (done in phase 1); left: Shift gives square and circle on the screen axes (convention) | 2 |
| INV-TOOL-09 | `canvas/runtime/interaction/pointer-utils.ts:36-49`; `zone-drawing-tool.ts:219-222`, `:530`, `:535`; `plant-spacing-tool.ts:433-442` | Shift 45° constraint in world angles (north-relative) | change; screen-frame constraint (convention); phase 1 passes the screen axes to Polygon and Plant a row; left: every other drawing tool | 2 |
| INV-TOOL-10 | `canvas/runtime/interaction/plant-spacing-tool.ts:305-322`, `:437-441` | Plant a row: Shift is both 45° and no-snap | change; no-snap on mod held during the drag (convention) | 2 |
| INV-TOOL-17 | `canvas/runtime/scene-runtime/mutations.ts:87`, `:335`, `:913-914` | Paste and Duplicate offset copies 1 m east | keep (north-relative, convention) | — |
| INV-TOOL-18 | `canvas/saved-object-stamp-payload.ts:32-52`, `:141-179` | Saved stamps store world rotations | keep; thumbnails stay north-up | — |
| INV-TOOL-19 | `canvas/runtime/interaction/selection-rotation-handle.ts:283-292`; `canvas/runtime/scene-runtime/selection-rotation.ts:43-52`, `:125-130` | Handle angle is a world delta; Shift snaps the delta to 15°; pivot = world AABB centre | keep | — |
| INV-TOOL-22 | `canvas/runtime/interaction/plant-placement-preview.ts:70`, `:86`; `plant-spacing-overlay.ts:151-157` | Labels offset screen-up or screen-down | keep (upright on purpose) | — |
| INV-TOOL-23 | `canvas/runtime/interaction/hit-testing.ts:228-251`, `:300-319` | Zones hit on the outline only; a band counts the interior | change; zone fill rules (canopi-f47t.2) | 2 |
| INV-TOOL-26 | `canvas/contours.ts:158` | Hillshade `illumination-anchor: 'viewport'`: the light stays top-left as the map turns | keep (not decided by the design; a phase-1 convention, named at the phase-1 handoff (plan §8)) | — |
| INV-TOOL-27 | `canvas/plants.ts:19-27` | Plant LOD bands at 0.5 and 5 px/m | keep; natural zoom bands for retained glyphs | R |
| INV-TOOL-28 | `canvas/runtime/interaction/pointer-utils.ts:17-18` (used by `shared-gestures.ts:179`) | `hasAdditiveModifier`: Shift, Ctrl or Meta toggle the selection | change; additive is Shift or mod (on Mac a physical Ctrl is a right-click, never additive); Alt is subtractive (spec §2.3); the rule lives in `tools/tool-host.ts` modifier resolution (D1) | 2 |

## 4. Rendering, chrome and per-frame work (INV-REN)

| ID | Where | Does today | Fate | Phase |
|---|---|---|---|---|
| INV-REN-04 | `canvas/runtime/renderers/pixi-scene.ts:729-830`, `:947-951`, `:993-1000`, `:1132` | Plant loop over all plants each frame; rings, badges and note decorations `clear()`ed and redrawn every frame | change; retained per state and band | R |
| INV-REN-05 | `canvas/runtime/plant-presentation.ts:273-291`; `pixi-scene.ts:930-935`; `scene-visuals.ts:139-165`, `:195-215`; `canvas/plant-colors.ts:50-60`; `canvas/plant-spacing.ts:11`, `:33` | Glyph radius continuous in scale (every zoom frame re-tessellates); key strings, contrast and spacing lookups per plant per frame | change; radius bands, memoised colour and spacing (canopi-p32r) | R |
| INV-REN-06 | `canvas/runtime/plant-symbol-recipes.ts:35`, `:397` | Plant glyphs are side-view pictograms on a ground line | keep upright (billboards) | — |
| INV-REN-07 | `canvas/runtime/plant-presentation.ts:84-87` | Stack badge offset top-right on screen | keep | — |
| INV-REN-11 | `canvas/runtime/scene-runtime.ts:266-271` | Every `viewport` invalidation synchronously calls `interaction.refreshMeasurements()` | change; the refresh runs from the frame (phase 0; test "a zoom with a selected plant keeps the rotation handle above the plant's top"); left: overlays move by `translate` from phase R | R |
| INV-REN-12 | `canvas/runtime/scene-runtime.ts:307-320` | A hover change invalidates the whole scene | change; targeted restyle through `SceneChangeSet.hover` | R |
| INV-REN-16 | `canvas/runtime/automatic-detail.ts:74-120` | Detail layout cached by exact float scale, two entries, "Pan does not affect admission" | change in R: admission on settle and on a zoom-band change, with no bearing-bucket cache (cut 2026-10-01); until then the exact-scale key, which hit testing, `selection.ts` and `scene-extent.ts` share, stays | R |
| INV-REN-19 | `maplibre/panel-target-overlays.ts:66-135` | Panel targets as MapLibre layers | keep (they rotate natively) | — |
| INV-REN-21 | `maplibre/map-background.ts:215-220`; `maplibre/raster-display/adapter.ts:292-327`; `maplibre/satellite-bind.ts:366-374`; `app/canvas-map-surface/workspace-map-contributions.ts:379-380` | `getBounds()` for tiles, satellite metadata and LiDAR view bounds | keep (AABB of the rotated view; slight over-fetch) | — |
| INV-REN-23 | `canvas/runtime/plant-display.ts:150-163` | Module-level `plantDisplay` global read by drawing, bounds and labels | keep; retained geometry invalidates on it | R |

## 5. Where input, tools, camera and rendering are entangled (INV-ENT)

| ID | Where | Entanglement | Fate | Phase |
|---|---|---|---|---|
| INV-ENT-01 | `canvas/runtime/scene-interaction.ts:130`, `:830-856` | Wheel policy (deltaMode, 0.002 rate, Shift rules, Scroll wheel setting) lives in the input session, which calls the camera, renders and refreshes overlays | change; recogniser produces `zoom`/`pan`, `ViewNavigation` applies them | Pointing device setting 2 |
| INV-ENT-04 | `canvas/runtime/scene-interaction.ts:573-582` | Overview mode: any left or middle press pans, whatever the tool | change; `LEGACY`/`ROTATION` keep it for plain presses, and from 1 a Shift+middle-drag turns the view in overview as in site mode; `V2` makes left click and band select (user) | 2 |
| INV-ENT-14 | `canvas/runtime/scene-interaction.ts:1254-1281`; `control-point-overlay.ts:114-142`; `selection-rotation-handle.ts:129-143` | Each camera frame rebuilds handle DOM and the selection model (three builds) | change; handles move in `onViewFrame('overlays')` with no element created, by `translate` from phase R; selection model cached in phase R | R |
| INV-ENT-15 | `canvas/runtime/interaction/shared-gestures.ts:274-291`; `drag-ops.ts:85-153`; `plant-drag-distance-overlay.ts:88-101`; `canvas/runtime/scene-commands.ts:129-134` | A move-drag remaps every array per move, sorts all plants for distance, renders the whole scene; history by `JSON.stringify` | change; `setSelectionPreview` and spatial-index queries; the distance guides come from `tools/distance-guides.ts` (the two nearest by distance, then id, a linear scan as today) | R |
| INV-ENT-17 | `canvas/runtime/scene-interaction.ts:1336-1339`; `canvas/runtime/scene-runtime.ts:72-74`, `:202`; `canvas/runtime/command-surface.ts:254-257`; `canvas/session-state.ts:4-18` | Tools switch the app's tool state; any string is a tool id | change; `ToolEffects.switchTool`; typed `ToolId` end to end with no "no tool armed" state (`canvas/session-state.ts` included; 0B-5's open item 7, with item 18, plan §4); arming through `app/keyboard/arming.ts` (F) | canopi-224j (left standing, plan §4 phase 0) |
| INV-ENT-21 | `components/canvas/ZoomControls.tsx:39`; `CanvasOverview.tsx:16`; `SelectionChip.tsx:27`; `ToolCard.tsx:55`; `InspectionLens.tsx:110` | Preact components re-render on every camera frame | change; `ViewReadSurface` signals (P10, phase 0); left: the zoom group's render-count test | R |

## 6. Raw input listeners on the canvas path (INV-LSN)

| ID | Where | Listener | Fate | Phase |
|---|---|---|---|---|
| INV-LSN-01 | `canvas/runtime/scene-interaction.ts:1572` (`:535-635`) | `pointerdown`, map host, capture: drops buttons other than 0 and 1 (`:537`), focuses, captures, routes overview, handles, pan, inspection, tool, selection | delete; `input/dom-input-source.ts` | right button 2 |
| INV-LSN-07 | `canvas/runtime/scene-interaction.ts:1581` (`:858-879`) | `contextmenu` on the host: the menu opens on the native event (press on Linux and macOS, release on Windows) | delete; source; under `V2` the menu opens on right-button release after ≤ 3 px (convention) | 2 |
| INV-LSN-18 | `canvas/runtime/inspection-lens.ts:141-143` | `document.fonts` `loadingdone`, `ResizeObserver` | keep (P6 allowlist, commented) | — |
| INV-LSN-19 | `components/canvas/InspectionLens.tsx:81-101` | Lens frame drag: `pointerdown`, document `pointermove`/`pointerup`/`pointercancel`, window `blur` | keep (own element; lens mini-camera) | — |
| INV-LSN-21 | `components/shared/ActionMenu.tsx:92-93`, `:152-156`; `Dropdown.tsx:90-91`; `DatePicker.tsx:179-180`; `MenuBar.tsx:68`; `SaveStatusLabel.tsx:132`; `components/canvas/ZoomControls.tsx:113`; `components/plant-db/MoreFiltersPanel.tsx:47` | Document `pointerup` "outside" closers; only the context menu ignores button 2 (`ActionMenu.tsx:152`) | keep; a pan that ends outside closes popovers (one rule, stated in the spec) | 2 |
| INV-LSN-22 | `components/shared/usePointerResize.ts:73-75`; `usePointerReorder.ts:32-34` | Document pointer listeners for panel resize and reorder | keep (panel chrome, FAP) | — |
| INV-LSN-25 | `components/panels/FavoritesPanel.tsx:621`, `:832-833`; `components/plant-db/PlantRow.tsx:45-46`, `:67`; `web/WebSpeciesCatalogPanel.tsx:226` | HTML5 `dragstart` sources for drops on the map | keep | — |
| INV-LSN-28 | `components/panels/Panels.module.css:45-51` | The map host sets no `touch-action`; only handles and the lens preview do | change; `touch-action: none` asserted | 3 |

## 7. Camera writers (INV-WR)

Every call that moves the camera. Only `maplibre/camera-driver.ts` (and the World map) calls MapLibre camera methods (policy P1); everything else commands through `ViewNavigation` or `ViewCommandSurface`.

| ID | Where | Writer | Fate | Phase |
|---|---|---|---|---|
| INV-WR-03 | `components/world-map/WorldMapSurface.tsx:147`, `:148`, `:167` | World map `fitBounds`, `resize`, `flyTo` | keep (P1 exception); the `:148` resize and the host's resize hook for this request stay here (the World map has no camera driver) | — |
| INV-WR-16 | `app/shell/visible-map-area.ts:180-188` | `setFramingInsets` effect | keep (screen-space insets) | — |
| INV-WR-18 | new | Rotation writers: Shift+right- or middle-drag, Shift+←/→, N / Shift+N / Shift+↑, compass button and ring, two-finger twist, trackpad rotate, "Turn view to this edge", saved views | new; all through `ViewNavigation` and one `RotationSession`; phase 1 built Shift+middle-drag, the keys, the compass, the trackpad twist, "Turn view to this edge" and saved views; left: Shift+right-drag (2) and the two-finger twist (3) | 2, 3 |

## 8. Keyboard and focus (INV-KEY, INV-FOC)

Phase F cleared the key router, Esc chain, focus owner and arming rows (plan §4, phase F); the rows left are the later phases' key changes.

| ID | Where | Handler | Fate | Phase |
|---|---|---|---|---|
| INV-KEY-06 | `app/canvas-commands/index.ts:314-397` | Keymap: tool letters V H P W K Z R E L T M, Cycle labels `N` (`:366`), zoom `Ctrl+Plus`/`Ctrl+Minus` (`:361-362`), Fit `Shift+F`/`Ctrl+0`, Rotate… `Ctrl+Alt+R` (`:356`), Grid/Snap/Rulers `Shift+G/S/R` | change; done in phase 1: N, Shift+N, Shift+←/→, Shift+↑, Cycle labels on Shift+L (convention), Shift+↓ unbound, mod+arrow large step; left: zoom step, `+`/`−`, Shift+2, Home | 2 |
| INV-KEY-09 | `canvas/runtime/interaction/zone-drawing-tool.ts:231-252`; `object-stamp-tool.ts:316-328`; `saved-object-stamp-tool.ts:151-165`; `plant-spacing-tool.ts:205-211`, `:521-526`; `stamp-rotation.ts:22-33` | Tool keys by `isEditableTarget` only, so they act with focus on `<body>`; Place a stamp leaves on Esc with a pick held | change; tool commands from the keymap (until F the keyboard port with today's gating, Plant a row's Esc as today); every tool drops its transient first (convention) | 2 |
| INV-KEY-14 | `app/tool-card/content.ts:69-74`, `:91` | Tool-card Esc meaning and the Select hint follow the Scroll wheel setting | change; the hints and F1's gesture rows as a static list with three platform notes (no `describeBindings`, cut 2026-10-01) | 2 |
| INV-KEY-20 | `components/canvas/StampChooser.tsx:49-54`; `SpeciesChooser.tsx:86-90`; `SiteOnboarding.tsx:42-46`; `components/canvas/InspectionLens.tsx:121`; `ZoomControls.tsx:138-168`; `components/shared/ActionMenu.tsx:262-281`; `web/BrowserAppShell.tsx:199-203` (`PhoneSearch`, the phone search card) | Local widget keys (JSX `onKeyDown` on the widget's own element) | keep; the one-Esc rule is held by `app/keyboard/escape-chain.test.ts` (plan section 5, behaviour tests; no P13 allowlist is written). Their arrows are checked against the router's arrow-owning rule in INV-KEY-23 | — |
| INV-KEY-25 | `app/shell-commands/shortcut-text.ts`: `matchesShortcut` (Ctrl and Cmd are one modifier; used by `app/canvas-commands/index.ts:407`, `app/shell-commands/index.ts:329`, `commands/graph/shortcuts.ts:26`, `:46`, `web/canvas-shortcuts.ts:48`; tests `shell-command-catalog.test.ts:4`, `:82`, `canvas-command-projection.test.ts:3`, `:80-104`, `:170`), `isCharacterKeyShortcut` (`canvas-commands/index.ts:274`: classes `Shift+N` as a single key the switch turns off), `formatShortcut` and `ariaKeyShortcuts` (menus, F1, palette, tooltips, `SelectionChip`, `PlaceSearch`, the welcome screens); `Plus` and `Minus` already name the bare + and − keys, but no arrow or Home names exist (`Shift+ArrowLeft` would read "Shift ArrowLeft") | The shared matcher disagrees with `KeyChord` (mod versus a physical Mac Ctrl) and with `KeyBinding.singleKey` (Shift+N is always on) | change; `matchesShortcut` deleted (F); arrow glyphs and Cmd for mod on macOS (U13) shipped in phase 1; `isCharacterKeyShortcut` stays (display and the switch); left: Home as `shortcutKeys.home` | 2 |

## 9. Stored data that touches bearing (INV-DATA)

None of these changes the `.canopi` format. Settings gain one defaulted field, `LastView.bearing` (shipped in phase 1; ADR 0021: new settings fields have defaults, which is not a migration); the per-area PDF angle was dropped (U3). Any other stored-format change may be made when it improves the project and is named in the handoff (ADR 0021, "Later format changes").

| ID | Where | Today | Fate | Phase |
|---|---|---|---|---|
| INV-DATA-04 | `common-types/src/views.rs:199-220` | Story steps hold only a view id | keep (steps inherit the view's bearing) | — |
| INV-DATA-11 | `common-types/src/settings.rs:77-79`, `:207-216` | `scroll_wheel: zoom \| pan` | keep the stored values; the UI becomes "Pointing device: Mouse / Trackpad" over the same field | 2 |
| INV-DATA-16 | `canvas/runtime/scene/codec.ts:348-368` | Ruler guides stored as latitudes and longitudes in `extra.guides` | keep (no angle field; guides stay parallels and meridians) | — |
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
| INV-DOC-09 | `docs/architecture.md:26`, `:41` | Settings list (no `scroll_wheel`); "Pan, zoom, fit and place search move the camera only" | change: pointing device; add rotate | release close, 2 |
| INV-DOC-10 | `docs/guides/design-document.md:11`, `:49` | Settings own `scroll_wheel`; Do not "persist… an anchor or a bearing" | change: pointing device (2); "a Design-level bearing; a saved view's bearing is allowed" (1) | release close, 2 |
| INV-DOC-12 | `docs/guides/frontend.md:12`, `:13`, `:28`, `:45`, `:58-59` | Two shortcut dispatchers; `focus-regions.ts` owns F6; "the map's Esc chain owns" Esc | change: one key router, focus owner and Esc chain | 2 |
| INV-DOC-13 | `docs/guides/editions.md:20`, `:22` | Browser-reserved shortcuts; phone layout | keep; check new keys against the reserved list | release close |
| INV-DOC-17 | `.interface-design/patterns/canvas-workspace.md:24`, `:26-27` | "square corner handles" (they do not exist); right-click opens the menu | change: no corner handles (F); a still right-click opens the menu, right-drag pans (2) | 2 |
| INV-DOC-18 | `.interface-design/patterns/canvas-workspace.md:36`, `:41`, `:42`, `:50`, `:54` | Select card "Space + drag or H pans · wheel zooms"; Shift keeps 45°; "Space pans temporarily"; lens source rectangle; stories fly | change: pan hints per bindings, screen-relative constraints, lens and story bearing | release close, 2 |
| INV-DOC-19 | `.interface-design/patterns/controls-and-shell.md:9`, `:34`, `:56` | View menu without rotation commands; Settings "Scroll wheel"; phone strip Select, Pan, Place plants, Polygon | change: Reset north, Turn view left/right 15° (1); Pointing device (2); phone keeps Pan, adds compass (1) | release close, 2 |
| INV-DOC-20 | `.interface-design/patterns/controls-and-shell.md:15`, `:42`, `:44` | Recent sketch "north up"; PDF sheet; preview displacement by drag and arrows | keep `:15`; change `:42`, `:44` for Map orientation | release close |
| INV-DOC-21 | `CONTEXT.md:31`, `:39`, `:41`, `:43`, `:75` | Settings › Canvas names Scroll wheel; "Only the camera moves"; Last view; Saved view "camera position"; right-click menu | change: Pointing device; position and direction; last view keeps the bearing; "a still right-click"; glossary term for the compass | release close, 2 |
| INV-DOC-22 | `docs/review-checklist.md:21`, `:24`, `:27`, `:28`, `:87-88` | Pan, zoom, search; Esc; right-click; arrows with Shift; Scroll wheel | change: rotation checks, right-drag, mod large step, Pointing device | release close, 2 |
| INV-DOC-23 | `docs/release-notes/v2.0.0.md:3`, `:12`, `:14`, `:56` | "Pan, zoom and search move only the view"; right-click; nudge 1 m with Shift; Scroll wheel setting | change in the release that ships each phase (2.0 is on hold) | release close, 2 |
| INV-DOC-24 | `docs/plans/canvas-controls.md:1-65` | Draft controls plan, superseded by the rotation decision | delete; replaced by `canvas-v2-plan.md`, `canvas-v2-spec.md` and this inventory | plan |
| INV-DOC-25 | `.interface-design/boards/boards_a.py:79`, `:83` (Rules board) | "Single-letter tool keys work only while the map has focus… lets people remap them"; Web binds shortcuts only with map focus | change: anywhere except text fields; no remapping | release close |
| INV-DOC-26 | `.interface-design/boards/boards_b.py:523-525` (Shortcuts board) | "Tools (while the map has focus)"; "Pan · H · hold Space"; zoom `Ctrl + · Ctrl −` | change: heading (F); pointer and rotation rows, zoom keys (1, 2) | release close, 2 |
| INV-DOC-27 | `.interface-design/boards/boards_b.py:493` (Settings board) | Section list has no Canvas section | change: add Canvas with Pointing device | 2 |
| INV-DOC-31 | `en.json:770-771` (`canvas.toolCard.selectHint`, `selectHintPan`); `:777` (`polygonKeys`); `:785` (`rowKeys`) | "Space + drag or H pans · wheel zooms"; "Shift keeps 45° angles" | change: generated pan hints; screen-relative wording | 2 |
| INV-DOC-33 | `en.json:1746-1750` (`shortcuts.nudge`, `nudgeLarge`, `pan`, `panLarge`, `rotateStamp`); `components/shared/KeyboardShortcutsDialog.tsx:33-44` | Hand-written F1 rows: Shift arrows for large steps; no pointer gestures | change: mod arrows and the rotation rows done in phase 1; left: gestures as a static list with three platform notes | 2 |
| INV-DOC-34 | `en.json:1767-1770` (`settings.scrollWheel*`); `components/shared/SettingsDialog.tsx:177-194` | Scroll wheel: Zooms the map / Pans the map | delete the keys; `settings.pointingDevice*` | 2 |
| INV-DOC-36 | `en.json:1840` (`gettingStarted.menu`) | "Right-click anything on the map for its commands" | change: a still right-click; a pan and turn line | 2 |
| INV-DOC-37 | `en.json:1942` (`presentation.keysHint`) | Space moves a presentation step | keep; the presenter's own handler owns Space | — |

All locale keys exist in 11 files with the same line layout, so an `en.json` line locates the key everywhere; every change lands in all 11 in one commit.

## 11. Tests that encode today's behaviour (INV-TEST)

| ID | Where | Encodes | Fate | Phase |
|---|---|---|---|---|
| INV-TEST-09 | `__tests__/tool-card.test.tsx`, `settings-sections.test.tsx`, `settings-projection.test.ts`, `web-canvas-shortcuts.test.ts`, `commands-registry.test.ts` | Scroll wheel copy, single-key routing, F1 contents | change with their phases | 2 |

## 12. Open items for the plan

1. **Tauri `dragDropEnabled`** stays at its default (`desktop/tauri.conf.json`), so native file-path drops keep working (R4). Whether Windows lets HTML5 panel drops reach the map is not checked by hand (U9, U20): canopi-f47t.6.2 stays open as a known unverified item; if a Windows user reports them blocked, a separate bead rebuilds panel drags on pointer events.

## 13. Retired rows

Rows phases 0, F and 1 cleared are deleted (full text at the commits above). Two cleared rows still state a rule a later phase needs:

| ID | Fate |
|---|---|
| INV-LSN-13 | the rotation handle's `click` stop and `keydown` swallow moved to `chrome/handle-layer.ts:8` as is; handling only its own keys is a later behaviour change, not scheduled |
| INV-KEY-18 | element keydown on runtime-owned controls and fields stays the P8 allowlist: `chrome/handle-layer.ts`, `chrome/text-entry-host.ts`, `chrome/locked-affordance.ts` |
