# Canvas navigation

Read the [design system](../system.md) first. Decisions: [ADR 0015](../../docs/adr/0015-rotating-map-and-canvas-controls.md) (rotation and controls), [ADR 0017](../../docs/adr/0017-input-pipeline-and-gestures.md) (gestures), [ADR 0020](../../docs/adr/0020-focus-and-keyboard-ownership.md) (keys). These rules are the Canvas v2 target; [the plan](../../docs/plans/canvas-v2-plan.md) says which phase ships each. Boards: Navigation, NavigationSettings, NavigationPhone, Shortcuts, Menus, Rules.

## Moving the view

- Left click and left drag always select or draw; a left drag never pans, except with the Pan tool. Shift + drag is never box zoom.
- Right-drag, middle-drag and Space + drag pan in every tool. Right- and middle-drag also pan in the middle of a drawing, move or band drag, and the draft stays under the pointer; Space must be held before the press. A still right-click (under 3 px) opens the canvas menu on release; a right-drag never opens it. On a Mac, Control-click is a right-click and Control-drag pans.
- Pointing device (Settings › Canvas): Mouse, the wheel zooms about the pointer and Shift + wheel pans; Trackpad, two fingers pan. Pinch and Ctrl + wheel always zoom. A wheel notch, the zoom buttons and + / − change zoom by one step. On Linux a trackpad pinch does not reach the map; F1 says to use Ctrl + scroll.
- Touch: one finger edits, two fingers pan, pinch and turn the view, press and hold opens the menu.
- Pan tool (H) is for pens without a barrel button and one-finger use: a left drag pans. It is not on the main rail; it lives in View and Tools, the command palette and the phone tool strip. While it is armed no rail button is pressed and its tool card says "Drag to move the map" with the Esc line.

## Turning the map

- The map turns like a map app; editing stays top-down. North up is the default: a new Design opens north up, a Design with content reopens at the last bearing.
- Only deliberate gestures turn it: Shift + right-drag or Shift + middle-drag about the press point (horizontal travel), the compass, a two-finger twist past 25 px of arc, a macOS trackpad twist past 10°. Adding Ctrl (Cmd on Mac) during a turn drag steps by 15°; on the compass Shift steps. No setting turns rotation off.
- Keys: Shift ← and Shift → turn to the next 15° step; N, Shift N (always, even with single keys off), Shift ↑ and a compass click reset north. Key turns take 300 ms, and jump when reduced motion is requested. Esc during a turn drag restores the starting view.
- A free turn (drag, twist, compass ring) that ends within 7° of north settles on north. Explicit targets never snap: saved views, stories, Turn view to this edge, the last view.
- Turns with the map: imagery, zones, text notes, the grid, snapping and ruler guides (true east and north). Stays upright: plant symbols and names, measurements, stack badges, handles, chips and all chrome. The hillshade light stays top-left on screen, so relief reads the same at any bearing.
- Arrows nudge and pan along the screen. Rectangles, ellipses, notes and saved-stamp picks start level to the screen, and an Object stamp pick keeps its source's orientation (a Print Area takes the layout's angle); Shift keeps squares, circles and 45° against the screen axes.
- Rulers show only when north is up. Turned with Rulers on, they hide and a quiet glass pill above the view chip reads "Rulers show when north is up" with a Reset north link; the plant names legend and the raster inspection status rise above it; guides already placed stay and turn; new guides are pulled only while north is up. Rulers stay pressed in the view chip.
- Turn view to this edge: a polygon, rectangle or line zone right-clicked within 8 px of an edge (22 px for a long press) adds this item to the canvas menu, as the first group of the empty-map menu and before Lock in the selection menu; the edge is not highlighted. Choosing it turns the view by the smaller angle until that edge is level. It is pointer-only, the one exception to the keyboard-path rule: from the keyboard, Shift ← and Shift → turn the view.
- Saved views, stories and snapshots keep their bearing; the inspection lens turns with the view; the World map for finding a site stays north up.

## Compass

- Always visible, never folded: the last button of the zoom group, after Fit to Design and a divider; on phones the last button of the zoom column. It shares the group's layer and visible-map-area registration; it adds none of its own.
- A 28 px ghost icon button (44 px on touch) with a 20 px glyph: a fixed ring and a needle whose north half is filled and south half outlined, turned by the view's bearing so it always points to true north. No "N" letter.
- North up: the needle is `--color-text-muted`, the button stays enabled (a drag still turns the view). Turned: the north half is `--color-accent`, the south half `--color-text`. Hover uses the icon-button hover; during a drag the face takes `--color-accent-soft` and a grabbing cursor. Light and dark come from tokens only.
- A click (under 3 px travel, 8 px for a finger) turns back to north; at north it does nothing. A drag anywhere on the face turns the view about the map centre, the needle following the pointer; Shift steps 15°; release within 7° settles on north.
- Keyboard: a stop in the zoom group; Enter or Space resets north; Shift ← and → turn as anywhere; the blue focus ring as on every control.
- Name: `aria-label` "Reset north", `aria-keyshortcuts="N Shift+N"`, a `ButtonTooltip` "Reset north" with N over a second line "Click to reset north. Drag the ring to turn the view; hold Shift for 15° steps.", and a description "View turned 30° from north" or "North is up" (degrees through `Intl`).

## Settings › Canvas

One setting: Pointing device as a segmented Mouse: the wheel zooms / Trackpad: two fingers pan, stored as today's scroll-wheel choice, with the hint "Pinch and Ctrl + wheel always zoom. Shift + wheel pans." The Select tool card follows it ("wheel zooms" or "pinch zooms").

## Keyboard shortcuts (F1)

- Keys: the tools heading reads "(anywhere except text fields)"; Map and workspace adds Turn the view 15° (Shift ← · Shift →), Reset north (N · Shift N · Shift ↑), nudge 10 cm on screen (arrows) and 1 m (Ctrl or Cmd + arrows), Labels (Shift L), zoom one step (+ · −), Fit the Design (Home · Shift F · Ctrl 0), Zoom to selection (Shift 2).
- Mouse, trackpad and pen: Right-drag, middle-drag or Space + drag · Pan the map; Shift + right-drag or Shift + middle-drag · Turn the view, add Ctrl (Cmd on Mac) for 15° steps; Compass · Click to reset north, drag to turn the view; Right-click (Control-click on Mac) · Open the menu; Scroll wheel, Pinch or Ctrl + wheel · Zoom; Alt + click · Remove from the selection.
- Touch (touch devices only): Two fingers · Pan, zoom and turn the view; Press and hold · Open the menu.
- Notes under the lists: "Shift N works even when single-key shortcuts are off."; the Linux pinch note on Linux only. Rows come from the active bindings, so the dialog never lists a gesture the build does not have.

## Export planting plan

Map orientation, a segmented North up (default) / As on screen, sits under Plant colours; it is not the paper Orientation of a page. The north arrow always points to true north: upright on north-up pages, turned on As on screen pages. The whole layout shares one angle, so a Print Area has none of its own; switching Map orientation turns each area about its centre.

## Phones

The zoom column holds zoom in, zoom out, Fit to Design and the compass as 44 px buttons; the phone View menu has Reset north. The tool strip keeps Pan. Two-finger twist turns the view; nothing on a phone turns it by accident.
