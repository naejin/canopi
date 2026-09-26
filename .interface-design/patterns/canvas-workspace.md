# Canvas workspace

Read the [design system](../system.md) first. Runtime ownership, gestures and rendering: [map workspace guide](../../docs/guides/map-workspace.md). Canvas boards: Workspace, SiteFound, Overview, NamesOnMap, PlacePlants, PlantRow, StampPlace, Selection, Appearance, ZoneDraw, ZoneSelected, MeasureText.

## Chrome

- Tool rail (left, floating): groups separated by rules; the active tool is solid ochre with `aria-pressed`. Arrow keys move between tools (roving tabindex). Labels and key hints show until each tool has been used once (per device), then the rail shrinks to 52 px icons with labelled tooltips on the right. The labelled rail is a fixed 224 px so it does not jump between tools. Until the right-click menu lands, plant colour and symbol stay on the rail when plants are selected.
- View chip (bottom left): Grid, Snap to grid, Rulers as pressed toggles with a check icon; off by default except Snap.
- Zoom group (bottom right): scale bar, zoom out, scale ratio (a menu of common scales), zoom in, Fit to Design (Shift F). The attribution pill sits immediately left of the group so it never collides with panels. Below 0.1 px/m the Design is shown as one pin ("Return to …"), editing tools are disabled and a top-centre chip says "Zoom in to edit" with Return to Design.
- The map is always the background; there is no grid or ruler frame unless turned on.

## Map annotations

- Measurements: light tag (95% surface, ink, 13/600, tabular). The live value under the cursor: dark tag. Zone names: cream text with a dark halo, no pill. Lengths use one decimal below 100 m, none above, two below 1 m; areas in ha or m².
- Every overlay stroke (drawing lines, dashed rings, measurement lines) has a dark casing underneath so it reads on bright or dark imagery. Handles are 10 px with a 44 px touch hit area.
- Labels (N cycles None, Codes, Names): mono 12 cream text with a dark halo, placed right of the symbol, thinned so no label touches another label or another plant's symbol. A chip says how many are shown ("Codes shown for 70 of 282 plants in view").
- The plant hover card has a caret to its plant and a ring on the plant; it also appears on keyboard focus and dismisses with Esc.

## Selection and the right-click menu

- Selection box: 2 px ochre over a 5 px cream casing, square corner handles, and an ochre ring on each selected plant. Rotatable selections keep one rotate handle above (drag, or Rotate… Ctrl Alt R). There is no action bar.
- A status chip at the bottom centre names the selection ("3 selected · Framboisier · 0.52 m apart").
- Right-click opens the context menu in plain words with shortcuts: a heading naming the selection; Cut, Copy, Paste, Duplicate; Symbol and color…, Show names of this species, Select all of this species, Species details; Add to calendar…, Set unit cost…; Group, Arrange ▸, Rotate…, Save as stamp…; Lock (Unlock on locked objects), Delete (danger). Zones get the same menu with zone commands. Every item also lives in the menu bar.

## Tools

- Tool cards (top left, 320 px): tool name, the instruction first ("Pommier cultivé · click the map to place one"), then key hints ending with the Esc meaning ("Esc to stop placing" for repeating tools, "Esc to cancel" while a gesture is in progress). Placing tools offer Change species / Change stamp.
- Place plants shows the mature width ring (typical) and the distance to the nearest plant. Plant a row shows spacing and the live plant count; previews use the real symbol size at 85% opacity. Place a stamp previews the whole group; [ and ] rotate by 15°.
- Zones: click adds corners, first corner or Enter finishes, Backspace removes the last corner, Shift keeps 45°. Live edge lengths and area. A selected zone shows a sheet beside it: name, colour (radio swatches), fill, area and perimeter, Lock, Delete zone.
- Text note: click places a field; Enter finishes (never while an input method composes), Shift Enter breaks a line, Esc restores. Measure: click two points; the result stays as a guide.
- Drawing never moves existing objects; Space pans temporarily.

## Symbol and colour

A non-modal sheet beside the selection: glyph and "Symbol and color" title with the species and selection counts; symbol tiles in three labelled groups (Plant form, What it gives, What it does) as one radio group, 5 columns, 70 px tiles with two-line labels; colour swatches with names as a radio group plus Custom…; footer "Only these N plants" (secondary) and "All N of this species" (primary). Choices preview until applied.

## Inspection lens

Unchanged in behaviour (see the map workspace guide): a view-only magnified preview with recentre, widen and magnify controls, collision-aware labels, keyboard pan, and an ochre source rectangle on the map. It uses the floating panel style and the shared icon-only rules.
