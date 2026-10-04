# Rendering and the view transform

Status: Accepted (2026-09-29, Canopi v2); amended 2026-10-01

Refines [ADR 0004](0004-one-renderer.md) (still one PixiJS renderer inside MapLibre) with how the renderer receives [ADR 0016](0016-one-view-transform.md)'s view transform. Product rules: [ADR 0015](0015-rotating-map-and-canvas-controls.md).

## Context

The scene snapshot carried a north-up viewport and per-plant screen points, so every pan or zoom rebuilt geometry, colours and labels for the whole Design (canopi-p32r) and recomputed selection measurements per frame (canopi-wx8w). Rotation adds a second requirement: map content must turn with the map while plant glyphs and labels stay upright.

## Decision

- **Two entries.** `syncScene(snapshot, changes)` for data, selection, hover, style and label admission, never called for a pan; `setView(view)` is the only per-frame entry. `setDraft` and `setSelectionPreview` carry tool output. The snapshot has no camera; presentation entries are world-space.
- **World root.** Grid, zones, ruler and measurement guides and the selection preview are retained in metres under one container whose matrix comes from the transform's affine: one write per frame. World drafts use a second container with the same matrix, stacked above the billboards, so drafts stay on top of the scene as today's DOM previews are. The grid moves into this root and turns with the map.
- **Upright billboards.** Plants, rings, badges, notes and labels live in an identity root (draft billboards in their own identity root above the world drafts) and are placed each frame by bulk projection of world anchors (typed arrays, visible set only). Nothing upright sits under a rotating container. Note text is drawn at `rotationDeg − bearing`, so notes turn with the map. A selection preview moves both: world shapes in the world root, selected anchors (and note angles) before projection in the billboard root.
- **Stored angles are clockwise from true north**; a null note angle reads as 0, as today.
- **DOM overlays** (selection handles, the text-entry host, hover tooltip, locked-object affordance) stay DOM for focus and `aria-label`, follow the frame in the overlays frame phase (by `translate` from phase R; phase 0 places them by `left` and `top`), and rebuild only when their set changes. Canvas2D rulers draw only when north is up.
- **Label admission** runs on the settled frame and on zoom-band change, with no admission cache (phase R; until then labels are admitted again on every scale change, as today).
- **Retained rendering may quantise** stroke widths and glyph sizes per zoom band (about 12 % drift) as the p32r fix (convention).
- **Pitch** later adds a projective world root when the affine is null; nothing is built for it now.

## Options considered

- **Handles and control points as Pixi billboards**: lose `aria-label` and keyboard focus.
- **DOM overlays for drafts, or a temporary DOM draft renderer**: duplicate the renderer; drafts go to Pixi once.
- **Render-to-texture for all world content now**: resampling cost for an unscheduled feature.
- **Notes upright when their angle is null**: contradicts the decision that notes are map objects and changes stored meaning.
- **A DOM node or MapLibre style layer per plant**: ADR 0004 forbids it.

## Consequences

- Per camera frame: O(1) transform and root matrix, O(visible) anchor projection, `translate` of overlays (from phase R); the app does nothing unless a coarse signal's value changed. canopi-p32r and canopi-wx8w become fixable (retained geometry, cached selection model, selection preview instead of remapping arrays).
- The renderer learns the camera one way; policy tests forbid `worldToScreen` in the world layers.
- PDF and the inspection lens stay renderer-neutral. The lens builds its own `ViewTransform` at the live bearing, and its source outline on the main map is the turned quad from the start. PDF capture reads the camera on screen when the PDF workspace opens (`captureView`, the live frame, like saved views and the story restore point; only the last view uses the settled camera) and turns plan geometry with its own page frame (`PdfPageFrame`), not a view transform.
- Details: [`canvas-v2-spec.md`](../plans/canvas-v2-spec.md).
