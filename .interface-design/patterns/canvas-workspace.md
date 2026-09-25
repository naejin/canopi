# Canvas workspace

Read the [design system](../system.md) first. Runtime ownership, gestures and rendering: [map workspace guide](../../docs/guides/map-workspace.md). Gallery: `?surface=workspace`, `?surface=lens`, `?surface=color`, `?surface=symbol`.

## Chrome

- Toolbar rail on the left (`--canvas-toolbar-width`): command-graph tool groups separated by rules; the active tool has an ochre left edge and `--color-control-active`. Arrow keys move between tools (roving tabindex).
- Floating launchers at the top right: loupe, then pin directly below it, each `--control-size-md` on `--color-surface` with a border. A launcher hides while its panel is open and regains focus when the panel closes.
- Bottom canvas bar (`--control-size-xl` tall) with zoom out, level, zoom in and fit on the right. Zoom buttons show tooltips above (`side="top"`) with their View shortcuts.
- 100 % zoom is 20 CSS px per metre, independent of viewport size. Below 0.1 px/m the level reads **Overview**, authored content and local chrome are suppressed, a top-centre notice offers **Return to Design**, and the on-screen Design origin is one clickable marker using the same command. Map-unavailable overview never implies geographic scale.
- Scale bar bottom left in `--color-text-muted`; rulers use `--canvas-ruler-bg`, close to the canvas, with no harsh L-frame.

## Place search

The pin opens an inline search (place name or coordinates). Enter searches, never typing; choosing a result moves the view only, never design objects. An empty Design with no remembered view shows a quiet prompt next to the pin. Attribution for the geocoder stays visible under results. Escape closes and returns focus to the pin.

## Notices

- Notices sit in safe overlay slots that reserve the rulers, ruler corner and scale bar, never at raw canvas edges.
- Tool HUDs use the top-left slot and outrank informational notices; under pressure they keep their primary instruction.
- The map notice (loading, ready, map or terrain error) uses the bottom-left slot as one family: above the scale bar, then right of it when height is tight, then compacted to one line with its status dot before disappearing.
- Notices use `--canvas-ruler-bg` or `--color-surface`, a 1px `--color-border` border, `--radius-md`, and no dramatic shadow or green.
- Plant Spacing HUD: the sampled plant name is the primary line; generated count is one line (`128 generated`), in `--color-primary` and semibold above the dense threshold, never a danger colour and never a confirmation step. No visible Cancel: a muted `Esc to exit` before sampling and `Esc to cancel` after, kept visible while the interval input has focus.

## Canvas overlays

- Pinned plant-name legend: a floating card above the scale-bar reservation, past the ruler gutter, shown only when pinned names exist. Entries show effective symbol and colour, localized name and a count when shared; it scrolls within the canvas and its entrance respects `prefers-reduced-motion`.
- Plant hover tooltip: a runtime-owned, pointer-transparent `<div>` on `--color-surface` with a border and `--radius-md`; common name (`--text-sm`, 600) over the italic muted scientific name. Clamped to the container, built with `textContent`, hidden on leave, drag, cancel or disposal.
- Species focus chip: top centre, ochre border, the focused species code, its count and a clear mark; activating it clears focus without touching selection.
- Selection Action Toolbar stays inside the canvas with an 8px margin, flips near edges and stays attached to the selection; rotatable selections keep the Rotation Handle above and the toolbar below. Both hide during a drag and return afterwards.
- Selection highlight states come from `canvas/runtime/scene-visuals.ts`: hover is lighter than selected, and locked-object and locked-layer strokes never look editable.

## Tool expectations

- Drawing tools: drag previews and release commits; the tool stays active. Leaving the canvas clamps the shape to the edge; release outside commits at the clamp. Shift constrains proportions and angles; Escape cancels the preview. Drawing tools never move existing objects.
- Select: click selects, Shift+click toggles, drag on empty canvas draws a band, drag on a selection moves it as one edit, Delete removes.
- Hand and Space+drag pan; releasing Space returns to the previous tool.
- Text: click places a textarea; Enter or click elsewhere commits, Shift+Enter breaks a line, Escape restores the previous text, empty text is discarded.
- Plant stamp: each click places a plant; Escape clears the species, not the tool.

## Inspection lens

A view-only preview opened from the loupe. It starts at the canvas centre and follows pointer movement over artwork; moving onto the lens or other controls keeps the last location, and editing drags never redirect it. The panel has `SurfaceHeader` title, expand and close, the preview, and a control row with recentre, widen, magnification level and magnify, all icon buttons that follow the icon-only rules.

- Labels stay attached to plant positions with collision-aware placement and connectors. Hover or focus identifies the plant in both preview and canvas; activating a name centres only the lens.
- Drag the preview or use arrow keys to pan (Shift for larger steps). Name buttons never start a drag. Dragging stops on release, cancel, lost capture, blur and teardown.
- The source area is outlined on the main canvas with a solid ochre rectangle that disappears on close and never becomes selection, focus or a Design object.
- Escape closes and returns focus to the loupe. Unavailable-preview and no-plants states stay explicit. Inspection never dirties the Design, alters selection or moves the main camera.

The raster reading card (numeric LiDAR inspection) sits bottom left: title, layer name, dismiss icon button, readout, Sample centre action, coordinates and a muted Escape hint.

## Plant Color and Plant Symbol editors

Both are popovers anchored to their toolbar buttons and share `SurfaceHeader`, `AppearanceSelection` and `appearance.module.css`: title and close, one effective glyph with the species or selection band, scrolling choices and a fixed apply footer. Width 328px, clamped to the viewport; no large preview card.

- Color: twelve swatches in six columns, a quiet selectable suggestion and a Custom colour disclosure (saturation/lightness square, hue strip, validated hex). Choices only preview; invalid hex disables both apply actions.
- Symbol: twelve Botanical and four Abstract choices in one three-column keyboard listbox of 56px tiles; labels wrap at word boundaries; choices use neutral ink, selection uses ochre; arrow keys preview and only the active choice is a tab stop.
- Footer actions distinguish the selected plants from all placed instances of one species; the species action is hidden for mixed selections. No reset actions below the footer.
- `useAppearancePopover` owns synchronous positioning, focus on open and resize/scroll cleanup; Escape returns focus to the toolbar button. Custom drags release on cancel, blur, selection change, disclosure close and unmount. Mutations stay in the plant-presentation commands; open editors refresh names on locale change.
- Glyph artwork lives in the shared plant-symbol recipes used by canvas, UI and PDF; pass the rendered size so small marks omit fine detail.
