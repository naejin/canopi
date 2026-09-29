# Rotating map and canvas controls

Status: Accepted (2026-09-29, Canopi v2)

Amends [ADR 0010](0010-map-first-interface.md) (single-key shortcut scope, compass in the zoom group) and [ADR 0001](0001-geolocated-map-canvas.md), [0004](0004-one-renderer.md), [0008](0008-canvas-pdf-export.md) and [0011](0011-analyses-provenance-and-stories.md) where they assumed north-up or a tool that switches navigation off. The architecture that carries these rules is in ADRs [0016](0016-one-view-transform.md) to [0020](0020-focus-and-keyboard-ownership.md).

## Context

The canvas was north-up and left-drag panned in some modes but selected in others; right-drag opened the menu at press on Linux and macOS; Shift+drag meant different things per tool. Users compare Canopi with GeoLibre, where the map turns. The user asked for rotation like GeoLibre and for controls, rotation and canvas architecture to be planned together, without letting existing shortcuts hold the design back (decisions of 2026-09-29).

## Decision

**Rotation (user).**
- The map rotates (bearing). Editing stays top-down; pitch, 3D and globe are not built now but the camera keeps a pitch slot. There is no setting to turn rotation off.
- Rotation starts only from deliberate gestures: Shift+right-drag and Shift+middle-drag about the pointer, dragging the compass ring, two-finger twist past a threshold, the macOS trackpad rotate gesture past 10°, Shift+←/→ (15° steps). No Alt+wheel.
- Reset north: compass click, N (follows the single-key switch), Shift+N (always on) and Shift+↑. Keys and compass animate about 300 ms.
- Free gestures snap to north on release within 7°. While dragging, 15° absolute steps come from Ctrl (Cmd on Mac) added during a Shift+drag, and from Shift on the compass ring (recorded resolution: Shift is already held for the drag). Explicit targets (saved views, stories, "Turn view to this edge", last view) are never snapped.
- Grid, snapping and guides stay on true east/north and turn with the map. Rulers show only when north is up, else the hint "Rulers show when north is up".
- Zones, notes and Print Areas are map objects and turn with the map. Rectangles, ellipses and notes drawn on a rotated map are level with the screen and store the bearing as their rotation; polygons, lines and rows store their corners; a Print Area stores its page's angle (the captured bearing on an As on screen page, 0 on a North up page). Plant names, readouts, badges, handles and other labels stay upright.
- "Turn view to this edge" on a zone edge (canvas menu). Saved views store bearing; reopening a Design with content restores the device's last bearing (`LastView.bearing`, default 0); a new or empty Design opens north-up (convention).
- PDF: "Map orientation: North up / As on screen", default North up; the north arrow always points to true north.

**Controls (user).**
- Left click and left drag always select or draw; left-drag never pans (the Pan tool excepted) and Shift+drag is never box zoom. Overview left-drag becomes band select.
- Right-drag pans in every tool, as do middle-drag and Space+drag; a still right-click opens the canvas menu on release (release on every OS: convention). Wheel zoom and right-drag pan stay live during a drawing drag (convention).
- The Pan tool (H) stays for barrel-less pens and one-finger users, off the main rail: View and Tools menus, palette, phone strip.
- A "Pointing device: Mouse / Trackpad" setting reuses the stored `scroll_wheel` field. Linux trackpad pinch is unsupported for now (Ctrl+scroll zooms).
- Single-key shortcuts work anywhere except text fields and modals, and stay switchable off. Esc belongs to the active tool first.
- Arrows nudge the selection 10 cm along screen directions, or pan with nothing selected; Ctrl/Cmd+arrow is the large step.

**Conventions** (planner-decided; the user may overturn them): macOS Ctrl+click is a right-click and Ctrl+drag pans; Cycle labels moves from N to Shift+L; Shift+↓ is reserved for tilt; Shift constrains every drawing tool against screen axes; Plant a row's no-snap moves to Ctrl/Cmd; Esc drops a held stamp pick before leaving the tool; the inspection lens turns with the view; the World map stays north-up.

## Options considered

- **MapLibre's own handlers** (left-drag pan, right-drag rotate, Shift box zoom): contradict "left always selects" and bypass tools.
- **A setting to disable rotation**: rejected by the user; deliberate gestures and snap-to-north keep accidental turns rare.
- **Snap every rotation to north**: would undo "Turn view to this edge" and near-north saved views.
- **Steps relative to the start bearing** (the old rotate-handle rule): north and the 15° grid become unreachable from, say, 22°.
- **Delete the Pan tool**: overruled; some pens and one-finger users have no other pan.
- **Polygon finishes on a still right-click**: contradicts the menu rule; the menu offers "Finish shape" first.
- **Single keys only while the map has focus** (ADR 0010 as written): the code never did this, and Esc after arming from the rail must work.
- **Hide the compass at north**: removes the ring users rotate with.

## Consequences

- Moved bindings: Shift+arrows no longer nudge; N no longer cycles labels; Shift+right-drag no longer opens the menu; overview left-drag no longer pans; Mac Ctrl+click no longer toggles selection.
- Stored data: `.canopi` unchanged (saved-view `bearing` already exists); settings `LastView` gains `bearing` with a one-line default; Print Areas gain an optional angle (in memory today).
- Phases, strings and tests are in [`canvas-v2-plan.md`](../plans/canvas-v2-plan.md) and [`canvas-v2-spec.md`](../plans/canvas-v2-spec.md).
