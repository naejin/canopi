# Inspection overlays

Read the [design contract](../system.md). Gallery: ?surface=lens, including empty/long states, both themes and short viewports.

The Inspection Lens is view-only. Keep its launcher, shared title/expand/close header, Follow pointer / Hold view controls, spatial preview, name/plant totals and magnification controls. Preview uses available height; controls stay usable in compact and expanded sizes.

Labels remain attached to plant positions with collision-aware placement and connectors. Hover/focus identifies the same plant in preview and main canvas. Activating a name centers and holds the lens. Focus the preview and press arrows to pan and hold; Shift takes larger steps. Preserve actual magnification percentage.

Outline the source area on the canvas using runtime preview scale, point and frame, transformed through the main viewport. Following is dashed; held is solid. The noninteractive outline disappears on close and never becomes a persisted selection, species focus, or Design object.

SceneCanvasInspectionOwner owns rendering, scheduling, resize/font listeners, hover cleanup and disposal. CanvasInspectionHandle exposes read-only state and view actions; the component owns pointer tracking, focus and its source overlay. Avoid renderer imports or duplicated spatial layout in UI.

Escape closes and restores launcher focus. Preserve unavailable-preview and no-plants feedback. Verify follow/hold, hover identity, independent zoom, keyboard pan, expansion, resize and teardown. Inspection must not dirty the Design, alter selection, or move the main camera.
