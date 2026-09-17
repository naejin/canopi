# Canvas geometry and annotations

Part of the [Canvas runtime guide](canvas-runtime.md). Read this guide for zone geometry, zone measurements, annotation rules. For persistence across runtime lifetimes, use [Document lifecycle](document-lifecycle.md).

## Zone Geometry

- Zone file data carries orientation as `Zone.rotation`; scene runtime entities expose it as `SceneZoneEntity.rotationDeg`. Missing rotation from older documents hydrates to `0`, and new saves serialize an explicit numeric rotation.
- Rectangular and Elliptical Zones are oriented shapes. Rendering, hit testing, band selection, object stamp previews, selection/group bounds, zoom-to-fit, and Zone Measurements must consume the shared helpers in `canvas/runtime/zone-geometry.ts` instead of duplicating axis-aligned bounds.
- Single-click Zone selection uses boundary-proximity hit testing, not filled-area hit testing. Rectangular, Polygonal, and Elliptical Zones should be selected only when the pointer is on or near their Zone boundary; Linear Zones continue to use near-line hit testing. Keep the tolerance screen-space stable, around 6 px, so interior clicks pass through to contained Design Objects or clear selection when nothing else is hit.
- Zone boundary hits must remain lower priority than direct hits on visible contained Design Objects such as Placed Plants or Annotations. When the pointer is over both a Placed Plant and a Zone boundary, selection and drag intent should target the Placed Plant, not the Zone.
- Zone hover presentation should mirror boundary-proximity selection rules. Hover the Zone boundary, not the filled interior; if a Placed Plant or Annotation is also under the pointer, show that Design Object's hover cue instead. Locked or blocked Zone boundary hover may explain blocked state through existing locked affordance rules but must not imply editability.
- Whole-Zone dragging should start from a boundary-proximity Zone hit, not from the filled interior. For selected Zones, interior clicks and drags should still pass through to contained Design Objects or behave as empty canvas when nothing else is hit; Zone Control Points handle reshaping, and Zone boundary drag handles moving.
- Band selection remains area/intersection-based for Zones. Do not use boundary-only logic for selection rectangles.
- Elliptical Zones store `points[0]` as the world center and `points[1]` as the radius vector. Translation-style edits, Paste, Duplicate, and Object Stamp must offset only the center while preserving the radius vector; linear, polygonal, and rectangular Zones continue to translate their world points.
- Linear and Polygonal Zones still derive geometry from their saved points; keep their rotation value at `0` unless a future feature deliberately defines oriented behavior for those Zone types.
- Zone Control Points are screen-space editing affordances for reshaping a single selected editable top-level Zone in the Select tool. Do not show them for multi-selection, Object Group selection, locked Zones, locked Layers, hidden Layers, grouped members, or any structurally blocked selection.
- Zone Control Points should be visible immediately for an eligible selected Zone but remain visually quiet: small, readable, screen-space sized, unlabeled by default, and emphasized only on hover/focus or active drag. They are not persisted Design Objects and must not reduce normal canvas readability.
- Zone Control Points must be pointer-input friendly across mouse, pen, and touch. Keep visible marks visually quiet while using a larger invisible hit target, and suppress browser gestures only for the active Zone Control Point drag path.
- Zone Control Points have pointer priority only for the current single selected editable Zone and only inside their explicit hit target. This priority may beat an overlapping Placed Plant or Annotation so the selected Zone remains reshapeable; outside active Control Point hit targets, direct Design Object hits stay higher priority than Zone boundary hits.
- Zone Control Point identity follows Zone type: Linear Zones expose endpoints; Polygonal Zones expose vertices; Rectangular Zones expose corners while preserving rectangular geometry; Elliptical Zones expose four oriented cardinal radius handles instead of sampled perimeter points.
- Rectangular Zone Control Point drags preserve the Rectangular Zone type. Dragging a corner resizes from the opposite corner in the Zone's local rotated space, keeps rotation as a Rotation Handle concern, and clamps or rejects degenerate width/height rather than converting to a free Polygonal Zone.
- Elliptical Zone Control Point drags preserve the Elliptical Zone type. East/west handles change width, north/south handles change height, the opposite local side stays anchored, center and radius vector are derived from the dragged and anchored sides, and rotation remains a Rotation Handle concern.
- Zone Control Point drags use existing grid and guide snapping rules for live preview and commit. Begin one Scene Edit transaction on pointerdown, mutate live during pointermove, commit one undoable edit on pointerup only when geometry changed, and abort cleanly on Escape, tool switch, document replacement, Session disposal, or tiny/no-op drags.
- Active Zone Control Point drags hide Selection Action Toolbar, Rotation Handle, passive Hover Tooltip, hovered entity projection, and locked-object affordances until the drag commits or cancels. Restore selection-dependent overlays only after the scene and selection-dependent measurements refresh.
- Zone Control Points stack above Zone Measurements and own pointer input priority. Zone Measurement overlays are read-only and must remain pointer-transparent so they cannot block Zone Control Point drags.
- Existing Polygonal Zone editing starts by dragging existing Zone Control Points only. Adding or deleting Polygonal Zone vertices is separate future behavior with its own gesture, undo, and selection rules.

## Zone Measurements

- Zone Measurements are derived presentation for zone geometry, not persisted design objects or annotations.
- Render Zone Measurement labels through a renderer-independent, screen-space overlay so Pixi and Canvas2D backends do not duplicate measurement UI.
- Show Zone Measurements while drawing a zone and for a single selected top-level Zone; suppress them for multi-selection and group selection.
- Zone Measurements update live during Zone Control Point drags and describe the snapped preview geometry, not only the final committed Zone geometry.
- Linear Zones use one edge-length measurement and never show area, width, or height labels.
- Rectangular and polygonal Zones use the same measurement model: horizontal edge-length labels at readable edge midpoints plus one area label for the whole Zone.
- Elliptical Zones use width, height, and area measurements because they have no Zone Edges.
- Linear Zone drawing uses drag-to-endpoint interaction. The snapped drag start and current pointer define the saved endpoints.
- Elliptical Zone drawing uses drag-to-bounding-box interaction. The snapped drag start and current pointer define opposite box corners; the stored geometry derives center and radii from that normalized box.
- Polygonal Zone drawing uses click-to-place vertices. The Zone Draft remains transient until the user closes it; Escape cancels the draft, Backspace removes the last vertex, Undo/Redo step through draft vertices before committed Scene Edit history, and closing creates one scene edit.
- During polygonal Zone drawing, live measurements include committed edge lengths, the active edge to the pointer, and once the preview has enough points to form a polygon, the closing edge back to the first point plus live area.
- Format Zone Measurement values compactly: centimeters for distances below one meter, meters for ordinary distances, square centimeters for areas below one square meter, square meters for ordinary areas, and hectares for large areas.
- Live Zone Measurements must describe the geometry that will actually be created, including snap-to-grid and snap-to-guides effects while drawing.
- Hide edge-length labels for edges that are too short in screen space; zooming in should make them available again. Area labels should remain visible for valid areas.
- Zone Measurement overlays respect Zone layer visibility. Locking does not suppress read-only measurements for an otherwise visible selected Zone.

## Annotation Rules

- Annotation geometry comes from shared helpers in `runtime/annotation-layout.ts`.
- Annotation text is readable presentation anchored to a design position; its visible text bounds are screen-space and should not be treated as physical world geometry.
- Annotation `rotationDeg` rotates readable text, while overview markers stay upright. Renderers and interactive geometry consume the shared presentation helpers; Fit to content consumes authored rotated text bounds.
- Hit testing, band selection, grouping, and selection outlines share visual Annotation bounds, including overview markers. Fit to content uses authored text bounds independently of the current fade; keep both policies in the shared Annotation geometry helpers.
- Visible text should win hit testing over underlying zones/plants when it is on top.
- Creating a new text Annotation is owned by `interaction/text-annotation-tool.ts`; editing an existing text Annotation in place is owned by `interaction/annotation-inline-editor.ts` and is started from Select-tool interaction only after the Design Object selection read model says the target is editable.
- Existing text Annotation inline editing should use a runtime-owned cross-platform double-click recognizer instead of relying only on `PointerEvent.detail`. The recognizer should require the Select tool, primary button, the same editable Annotation target, bounded pointer movement, and a short click interval; additive selection gestures and active drags should not enter inline editing. Starting inline editing selects the Annotation first, then hides Selection Action Toolbar and Rotation Handle until the edit commits or cancels.
