# Rendering and the view transform

Status: Accepted (2026-09-29, Canopi v2); amended 2026-10-01, 2026-10-05 (U33: no rulers, ruler guides or locked-object chip) and 2026-10-07 (U33 P9, P12, P13, P23 as answered in U44: one target slot, no change set or selection preview, overlays by `left`/`top`, the tooltip beside the pointer)

Refines [ADR 0004](0004-one-renderer.md) (still one PixiJS renderer inside MapLibre) with how the renderer receives [ADR 0016](0016-one-view-transform.md)'s view transform. Product rules: [ADR 0015](0015-rotating-map-and-canvas-controls.md).

## Context

The scene snapshot carried a north-up viewport and per-plant screen points, so every pan or zoom rebuilt geometry, colours and labels for the whole Design (canopi-p32r) and recomputed selection measurements per frame (canopi-wx8w). Rotation adds a second requirement: map content must turn with the map while plant glyphs and labels stay upright.

## Decision

- **One target slot, one frame read.** The render scheduler owns one target slot: `connect(target)` returns `disconnect`, a target connected while mounted gets the latest snapshot and draft, and a stale disconnect is ignored; no renderer definition, ids, async mount or generation counters (U33, P12). The snapshot (data, selection, hover, style; no camera) is never sent for a pan; `setDraft` carries tool output. The shared custom layer reads the camera frame in its own `render`.
- **No change set or selection preview.** A move-drag mutates the Scene per move (U33, P9). Presentation entries are world-space.
- **World root.** Grid, zones and measurement guides are retained in metres under one container whose matrix comes from the transform's affine: one write per frame. World drafts use a second container with the same matrix, stacked above the billboards, so drafts stay on top of the scene as today's DOM previews are. The grid moves into this root and turns with the map.
- **Upright billboards.** Plants, rings, badges, notes and labels live in an identity root (draft billboards in their own identity root above the world drafts) and are placed each frame by bulk projection of world anchors (typed arrays), then culled to the visible set. Nothing upright sits under a rotating container. Note text is drawn at `rotationDeg − bearing`, so notes turn with the map.
- **Stored angles are clockwise from true north**; a null note angle reads as 0, as today.
- **DOM overlays** (selection handles, the text-entry host) stay DOM for focus and `aria-label`, are placed by `left` and `top` in the overlays frame phase, in the same publish as the map, on whole pixels, and rebuild only when their set changes (U33, P23; U44). The hover tooltip sits beside the pointer, not on the frame: a camera frame under a resting pointer hides it, and the passive hover stays on its object until the next pointer move (U44, Q3).
- **No rulers, ruler guides or locked-object chip** (user, 2026-10-05, U33). The Canvas2D rulers and the guides pulled from them left the world root; a directly locked object shows its locked hover stroke and is unlocked from the canvas menu or Edit. Each was a special case in the input pipeline and the overlays for little use.
- **Label admission.** Plant names and codes are admitted on the settled frame, on a zoom-band change and on a scene sync (phase R). The note and measurement detail layout stays at the exact scale behind one memo per Scene reference, which drawing, hit testing, selection bounds and the hull read (U33, P13); a note is measured with the browser's 2D-canvas `measureText` (U44, Q6).
- **Retained rendering may quantise** world stroke widths and dashes per zoom band (×1.25 bands, about 12 % drift) as the p32r fix (convention); glyph radii are rounded to 0.25 px, so a drawn plant stays within 0.125 px of the exact size hit testing uses.
- **Pitch** later adds a projective world root when the affine is null; nothing is built for it now.

## Options considered

- **Handles and control points as Pixi billboards**: lose `aria-label` and keyboard focus.
- **DOM overlays for drafts, or a temporary DOM draft renderer**: duplicate the renderer; drafts go to Pixi once.
- **Render-to-texture for all world content now**: resampling cost for an unscheduled feature.
- **Notes upright when their angle is null**: contradicts the decision that notes are map objects and changes stored meaning.
- **A DOM node or MapLibre style layer per plant**: ADR 0004 forbids it.

## Consequences

- Per camera frame: O(1) transform and root matrix, O(n) anchor projection and cull, `left`/`top` writes for overlays; the app does nothing unless a coarse signal's value changed. canopi-p32r and canopi-wx8w become fixable (retained geometry, a memoised selection model); a large move-drag stays a Scene edit per move, measured on canopi-f47t.9.
- The renderer learns the camera one way; policy tests forbid `worldToScreen` in the world layers.
- PDF and the inspection lens stay renderer-neutral. The lens builds its own `ViewTransform` at the live bearing, and its source outline on the main map is the turned quad from the start. PDF capture reads the camera on screen when the PDF workspace opens (`captureView`, the live frame, like saved views and the story restore point; only the last view uses the settled camera) and turns plan geometry with its own page frame (`PdfPageFrame`), not a view transform.
- Details: [`canvas-v2-spec.md`](../plans/canvas-v2-spec.md).
