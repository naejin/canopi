# Canvas workspace

Read the [design contract](../system.md) first.

## Canvas Workspace
- Toolbar left (44px): command-graph tool and action groups separated by dividers
- Bottom canvas bar: 34px (`--control-size-xl`), bottom-panel launcher on the left and Zoom Controls on the right. Text tabs retain their labels and share `--radius-md`, hover fill and ochre active feedback with the rails.
- Scale bar bottom-left: uses `--color-text-muted` for subtlety
- Zoom uses a fixed reference: 100% is 20 CSS pixels per design meter, independent of viewport size. Initial framing and Fit to content select their own scale; see [zoom calibration](../../docs/agent/canvas-zoom-calibration.md).
- Rulers: background `--canvas-ruler-bg` (close to canvas bg, no harsh L-frame)


## Canvas Notice Layout
- Canvas notices must sit inside safe overlay slots, not at raw canvas edges.
- Reserve ruler chrome before placing notices: horizontal ruler, vertical ruler, ruler corner, and scale bar.
- Active Tool HUDs use the top-left safe slot. They provide current interaction guidance and controls, so they have priority over informational notices.
- Location Notices use the bottom-left safe slot. They report site/map readiness and stay visually attached to the canvas workspace, not the canvas bar.
- The scale bar has priority over Location Notices. A Location Notice prefers bottom-left above the scale bar, shifts to the right of the scale bar when vertical space is tight, then compacts before disappearing.
- Location Notices move as one family after a design has a Location: loading, ready, precision warning, and map/terrain error states should not jump between canvas zones. Missing-location setup is not a canvas notice.
- If layout pressure is severe, Tool HUDs keep their primary instruction visible. Location Notices may shrink to a one-line status with ellipsis, but should keep the status dot and shortest useful label visible.
- Notices use `--canvas-ruler-bg` or `--color-surface`, `1px solid --color-border`, `--radius-md`, and no dramatic shadow. They must be clearly readable above canvas content without using green UI chrome.
- Plant Spacing dense counts are warning-only. A physically valid Plant Spacing Interval must not be blocked by a confirmation step; the Tool HUD should emphasize generated counts above the dense threshold while leaving commit behavior direct.
- After Plant Spacing samples a placed plant, the sampled plant name is the Tool HUD's primary line. Do not repeat the tool name or generic selected-state copy inside the HUD.
- Plant Spacing Tool HUDs should not show a visible Cancel button. Use a muted keyboard hint instead: `Esc to exit` before a source is sampled, and `Esc to cancel` after a source is sampled. Keep the hint visible even when the Plant Spacing Interval input is focused.
- Plant Spacing generated counts use normal text below the dense threshold and `--color-primary` with stronger weight above the threshold. Do not use danger/error colors for dense counts because dense Plant Spacing remains physically valid.
- Plant Spacing should show generated-count feedback as one line, such as `128 generated`. Do not add a separate dense-warning sentence when the count crosses the threshold.


## Pinned Plant Name Legend
- Floating reference card above the scale-bar reservation, past the ruler gutter, at `z-index: 19`
- Visible only when one or more pinned Plant-name entries exist
- Entries show the effective Plant symbol and color, localized name, and a count when multiple Plants share an entry
- Height is bounded by the canvas and scrolls when necessary; the entrance animation respects `prefers-reduced-motion`


## Plant Tooltip
- Runtime-owned HTML `<div>` overlay in the canvas container, `pointer-events: none`, `z-index: 20`
- `--color-surface` bg, `--color-border` border, `--radius-md`
- Content: localized common name when available (`--text-sm`/600) and scientific name (`--text-xs`/italic/muted)
- Positioned from pointer coordinates relative to the container, then clamped to the visible container bounds
- Built with safe DOM methods (`createElement`, `textContent`) — no `innerHTML`
- Appears on passive Plant hover and hides on pointer leave, non-Plant hover, drag, cancellation, or disposal



## Canvas Tool Behavior (Figma/Sketch standard)

All canvas tools must follow these behaviors. They are not optional — they are what users expect from any design tool.

### Drawing tools (Rectangle, Ellipse, Line, future shapes)
- Click+drag creates a live preview shape → mouseup commits the shape
- **Mouse leaves canvas**: shape sticks to the canvas edge, continues tracking the cursor direction along the boundary. Origin, cursor, and edge contact point stay aligned
- **Mouseup outside canvas**: commits shape at the edge-clamped position (does not cancel)
- **Escape during draw**: cancels, removes preview
- **Shift during draw**: constrains proportions (square, circle, 45° angles)
- Cannot select or move existing objects — only the select tool admits object-move gestures
- After committing a shape: tool stays active for the next draw (does not auto-switch to select)
- Additional pointer-downs are ignored while the admitted pointer and Scene edit own the active gesture

### Select tool
- Click empty canvas: deselects all, clears highlights
- Click object: selects it, highlights it
- Shift+click: toggles selection membership
- Click+drag on empty canvas: shows a rubber-band preview and commits intersecting objects on release
- Click+drag on selected object: moves it through a Scene edit transaction owned by the shared gesture controller
- Mouse leaving canvas during rubber-band or move: sticks to edge (same as drawing tools)
- Escape during rubber-band: cancels band
- Delete key: removes selected objects
- The contextual Selection Action Toolbar stays inside the visible canvas with an 8px margin, flips when close to an edge, and stays visually attached to the selected object. Single non-rotatable selections use a close above-selection placement. Rotatable selections keep the Rotation Handle above the object and place the toolbar close below by default.
- Click+drag on a selected Design Object hides the Selection Action Toolbar and Rotation Handle while the drag is active, then restores them after release or cancel using the final selection geometry. Passive hover presentation, including the plant Hover Tooltip, clears when a drag starts and does not reappear until the next passive hover movement.

### Hand/Pan tool
- Click+drag: the shared gesture controller pans the viewport through `CameraController.panBy`
- Space+drag from any tool: temporary pan, returns to previous tool on key release

### Text tool
- Click to place text insertion point (HTML textarea overlay)
- Type to enter text
- Click elsewhere or Enter commits text
- Shift+Enter inserts a line break
- Escape cancels editing and restores the previous text when editing an existing Annotation
- Empty text on commit: discarded

### Plant stamp tool
- Click to place plant at cursor position
- Tool stays active for placing more plants
- Escape clears the selected species (does not force-switch to another tool)

### Event routing rules
- **Gesture ownership**: `SceneInteractionSession` records the active pointer and routes the gesture to the tool adapter, shared gesture controller, or active overlay control that admitted it
- **Window-level drag tracking**: capture-phase window `pointermove`/`pointerup`/`pointercancel` listeners keep the admitted gesture alive outside the canvas and clamp tool coordinates to the canvas edge where required
- **Move authority**: `interaction/shared-gestures.ts` owns pan, selection-band, and selected-object move state. Object moves mutate a Scene edit transaction and commit or abort it as one interaction
- **Cancellation**: Escape, pointer cancellation, window blur, and disposal converge on the Scene Interaction cancellation path so transient edits and runtime-owned overlays are released together

## Selection Highlights

Visual feedback is renderer-neutral. `runtime/scene-visuals.ts` defines screen-pixel stroke styles and both Pixi and Canvas2D renderers apply them to plants, zones, annotations, and Measurement Guides.

| State | Visual | When |
|-------|--------|------|
| Hover | 2.5px hover stroke at 0.72 alpha | Pointer is over an interactive object |
| Selected | 4.5px selection stroke | Object belongs to committed Scene selection |
| Locked object | 2.75px locked-object stroke | Direct object lock blocks editing |
| Locked layer | 2.75px locked-layer stroke | Owning Scene layer blocks editing |

The rubber-band itself is a runtime-owned DOM preview. Selection is resolved and committed when the gesture finishes.

### Theme coherence
- Interaction colors resolve through `getCanvasColor()` from the current canvas theme tokens
- Renderer snapshots contain semantic hover/selection/lock state; persisted Scene entities never contain presentation-only highlight attributes
