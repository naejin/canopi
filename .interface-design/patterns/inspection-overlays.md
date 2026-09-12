# Inspection overlays

Read the [design contract](../system.md). Gallery: ?surface=lens, including dense/empty/long states, both themes and short viewports.

The Inspection Lens is a view-only preview initialized at the main canvas centre, then follows pointer movement over the canvas. Its launcher opens shared title/expand/close chrome, a spatial preview, name totals, explicit recenter and magnification controls. Hide the launcher while open. There are no Hold/Follow controls or modes. Pointer movement over canvas artwork updates the inspected location automatically. Moving onto the lens or other controls leaves the view at its last inspected location, so its names and controls remain usable. Ignore canvas editing drags. Recenter explicitly samples the current canvas centre.

Labels remain attached to plant positions with collision-aware placement and connectors. Hover/focus identifies the same plant in preview and main canvas. Activating a name centres only the lens. Drag the preview or use arrow keys to pan; Shift takes larger keyboard steps. Ignore name buttons when starting a drag. Stop dragging on pointer release, cancellation, lost capture, window blur and teardown. Preserve actual magnification percentage.

Outline the source area with a solid ochre rectangle using runtime preview scale, point and frame, transformed through the main viewport. The noninteractive outline disappears on close and never becomes a persisted selection, species focus, or Design object.

SceneCanvasInspectionOwner owns the inspected location, recentering, rendering, scheduling, resize/font listeners, hover cleanup and disposal. CanvasInspectionHandle exposes read-only state and view actions; the component owns the canvas pointer listener, preview gestures, focus and source overlay. Pass host-relative CSS pixels through inspectAtScreenPoint; the runtime owns viewport-to-world conversion. Remove the pointer listener on close or host replacement. Avoid renderer imports or duplicated spatial layout in UI.

Escape closes and restores launcher focus. Preserve unavailable-preview and no-plants feedback. Verify mouse-following, control exclusion, pointer-listener cleanup, recentering, hover identity, zoom, keyboard/drag pan, expansion, resize and teardown. Inspection must not dirty the Design, alter selection, or move the main camera.
