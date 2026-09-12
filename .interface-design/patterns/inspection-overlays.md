# Inspection overlays

Read the [design contract](../system.md). Gallery: ?surface=lens, including dense/empty/long states, both themes and short viewports.

The Inspection Lens is an independent, view-only preview initialized at the main canvas centre. Its launcher opens shared title/expand/close chrome, a spatial preview, name totals, explicit recenter and magnification controls. Hide the launcher while open. There are no follow/hold modes and no canvas pointer tracking. Main camera movement does not move the inspected location; recenter explicitly samples the current canvas centre.

Labels remain attached to plant positions with collision-aware placement and connectors. Hover/focus identifies the same plant in preview and main canvas. Activating a name centres only the lens. Drag the preview or use arrow keys to pan; Shift takes larger keyboard steps. Ignore name buttons when starting a drag. Stop dragging on pointer release, cancellation, lost capture, window blur and teardown. Preserve actual magnification percentage.

Outline the source area with a solid ochre rectangle using runtime preview scale, point and frame, transformed through the main viewport. The noninteractive outline disappears on close and never becomes a persisted selection, species focus, or Design object.

SceneCanvasInspectionOwner owns the inspected location, recentering, rendering, scheduling, resize/font listeners, hover cleanup and disposal. CanvasInspectionHandle exposes read-only state and view actions; the component owns input gestures, focus and its source overlay. Avoid renderer imports or duplicated spatial layout in UI.

Escape closes and restores launcher focus. Preserve unavailable-preview and no-plants feedback. Verify independent location, recentering, hover identity, zoom, keyboard/drag pan, expansion, resize and teardown. Inspection must not dirty the Design, alter selection, or move the main camera.
