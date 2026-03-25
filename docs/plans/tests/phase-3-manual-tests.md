# Phase 3 — Manual Test Checklist

Run with `cargo tauri dev`. Check each box after verifying.

## 3-pre: Persistent Plant IDs

- [x] Place 3 plants on canvas
- [x] Save design (Ctrl+S)
- [x] Close and reopen the design (Ctrl+O)
- [x] Verify plants are in the same positions (no drift)
- [x] Copy a plant (Ctrl+C, Ctrl+V) — verify the copy has a different ID than the original

## 3a: Guides & Smart Guides

- [x] Drag from the horizontal ruler down onto the canvas — a horizontal guide line appears
- [x] Drag from the vertical ruler right onto the canvas — a vertical guide line appears
- [x] Move a shape near a guide — it snaps to the guide when snap-to-guides is enabled
- [x] Toggle snap-to-guides off in toolbar — shapes no longer snap to guides
- [ ] Drag a shape near another shape — smart guide alignment lines appear (red dashed)
i tried with rectangles and i don't see any alignment behavior nor red dashed lines
- [ ] Release the shape — smart guide lines disappear
can't test
- [ ] Save design, reload — guides are preserved
guids are preserved, however zoom level and position are reset. that can be annoying for the user and is not good ux. need better default like. on open the user should see all the shapes and plants.

- [x] Pan and zoom — guide lines extend across the full viewport

## 3b: Align & Distribute

- [x] Select 2+ shapes — align buttons appear in the toolbar
we have to implement ctrl+click to select multiple shapes. selected shapes should be highlighted with better ux, having a big rectangle around all the selected shapes is bad ux.
- [x] Click "Align Left" — all shapes' left edges align
- [x] Click "Align Center" — shapes center horizontally
- [x] Click "Align Right" — right edges align
- [x] Undo (Ctrl+Z) — shapes return to original positions
- [x] Select 3+ shapes — distribute buttons appear
- [ ] Click "Distribute Horizontally" — even spacing between shapes
i don't think distribute works as expected.
- [ ] Click "Distribute Vertically" — even vertical spacing
i don't think distribute works as expected


## 3c: Group / Ungroup

- [x] Select 2+ shapes on the same layer
- [ ] Press Ctrl+G — shapes group and move as one unit
does not work. i tried with two plants. the selection rectangle surround the two plants. however only one plan moves. same with rectangles zones
- [ ] Drag the group — all members move together
same issue
- [ ] Press Ctrl+Shift+G — shapes ungroup, each independently selectable
that's strange, this command is actually grouping, and then i can move the grouped shapes as one unit.
- [ ] Group some plants + zones, save, reload — group membership preserved
not saved
- [ ] Copy/paste a group — the copy is a separate group with new IDs
i copied the group but i can't check the id.
- [ ] Undo group — shapes revert to independent
doesn't seem to work

## 3d: Plant Stamp Tool

- [ ] Open the Plant DB sidebar
stamp tool not visible, cant
- [x] Click the "+" button on a plant row — tool switches to plant stamp, cursor becomes crosshair
- [x] Click on the canvas 5 times — 5 plants placed at click positions
- [x] Each plant has the correct species name and color
- [x] Press ESC — stamp mode deactivated, back to select tool
- [x] Undo 5 times — all 5 plants removed one by one

## 3e: Pattern Fill & Spacing

### Pattern Fill
- [x] Draw a rectangle zone
- [x] Set a species as stamp (click "+" on a plant row)
- [x] Switch to Pattern Fill tool in toolbar
- [ ] Click the zone — spacing prompt appears
nothing appears when i click
- [ ] Enter "2" for spacing, "hex" for pattern — plants fill the zone interior
can't test
- [ ] Verify plants are only inside the zone boundary
can't test
can't test

### Spacing Tool
- [x] Set a species as stamp
- [x] Switch to Spacing tool in toolbar
- [ ] Click start point, then end point — count prompt appears
nothing appears
- [ ] Enter "5" — 5 plants placed evenly along the line
nothing appears
- [ ] Undo — all 5 removed at once

not sure about this ux for pattern fill and spacing. the discovery seems bizarre. the tools are visible even without stamp. it seems more intuitive for spacing to click on + sign in db panel then click drag, then prompt appear aftex release and enter number of plants evenly spaced between first click and last clik. for pattern fill i don't think it will be used to be honest.

## 3f: Arrow & Callout

### Arrow
- [x] Select Arrow tool from toolbar
- [ ] Click start point, then end point — arrow appears with arrowhead
nothing appears
- [ ] Arrow has correct direction (head at second click point)
can't test
- [ ] Arrow is draggable and selectable
can't test
- [x] Press ESC during drawing — cancels without creating

### Callout
- [x] Select Callout tool from toolbar
- [x] Click on canvas — callout box appears with "Note" text
- [ ] Double-click the callout — text editing textarea opens
doesn't work. doesn't work
- [ ] Type new text, press Enter — callout updates
can't test
- [ ] Press Escape during edit — cancels edit
can't test
- [ ] Callout is draggable
does not work

why do we have calloud and text? seems redundant. what do you think?

## 3g: Dimension Lines

- [x] Select Dimension tool from toolbar
- [x] Click two points on canvas — dimension line appears with distance label in meters
- [ ] Click on a shape for start, then another shape for end — dimension attaches to both
does not attach reliably, should have a highlight to see if it's going to attach before clicking.
- [ ] Drag one attached shape — dimension updates (line redraws, distance recalculates)
it works but the attach point moves even though it's still on the shape. the attch point is not the same anymore
- [x] Resize/rotate an attached shape via Transformer — dimension also updates
- [x] Dimension label shows correct distance

one issue is I can't delete the dimension line object
it also has overlap with measure tool that cant snap to object, but is seems like bad ux. 

## 3h: Plant Display Modes

- [x] Place several plants with different strata
- [x] Select "Canopy" from the display mode dropdown — circles resize to real canopy spread
- [x] Labels remain readable at all zoom levels (not too large or too small)
- [ ] Select "By Stratum" — circles recolor by stratum
all same color
- [x] Select "By Hardiness" — circles recolor by hardiness zone (blue → red gradient)
- [x] Select "Default" — circles return to fixed-size strata colors
- [x] Save and reload — display mode resets to default (it's runtime-only)

## 3i: Minimap

- [ ] Toggle minimap on via toolbar button — minimap appears in bottom-right corner
toggle does not work
- [x] Zones appear as green rectangles, plants as colored dots
- [x] Viewport rectangle shows current view area
- [ ] Pan the main canvas — viewport rectangle moves in minimap
does not update
- [x] Click on the minimap — main canvas navigates to that position
- [ ] Toggle minimap off — minimap disappears
does not work

i think the minimap should be below the compass or to left of the compass, choose the best ux. the compass is a little too high, when rulers are active, they hide the top of the N for north.

## 3j: Location & MapLibre

- [x] Navigate to World Map panel (Ctrl+3)
- [x] Enter latitude (e.g., 48.8566) and longitude (e.g., 2.3522)
- [x] Click "Set Location" — current location displayed
- [ ] Check "Show map layer" — map tiles load behind the canvas
canvas becomes blank
- [ ] Pan the canvas — map follows (no drift)
can't test
- [ ] Zoom the canvas — map zooms in sync
can't test
- [ ] Switch map style to "Terrain" — tiles change
can't test
- [ ] Uncheck "Show map layer" — map disappears, opaque background returns
map stays blank
- [ ] Draw zones on top of the map — visible correctly
can't test
- [ ] Save design, reload — location preserved, map can be re-enabled
does not work
- [ ] Click "Clear" — location removed
canvas is blank

it seems like bad ux to switch to world map to set location. it seems better to add a tab in the bottom panel to do that. btw the tabs timeline, consortium, budget should still be visible after collapse. better dicovery. we can remove the arrow to expand. keep the collapse button.

## 3k: Celestial Dial

- [x] Set a design location (World Map panel)
- [x] Open the Timeline tab in the bottom panel
- [ ] Add a timeline action with a start date (e.g., 2026-06-21)
can't test
- [ ] Click the timeline row — celestial dial appears around the compass
can't test
- [ ] Ring shows colored segments: dawn (amber), day (yellow), dusk (orange), night (blue)
can't test
- [ ] Sun dot points in the correct compass direction for the date/location
can't test
- [ ] Moon phase icon shows on the opposite side
can't test
- [ ] Click a different dated action — dial updates to new date
can't test
- [ ] Remove location — dial disappears
can't test

## 3l: Consortium Builder

- [x] Place 3+ plants on canvas
- [x] Open Consortium tab in bottom panel
- [ ] Click "+ Add Consortium", name it, enter plant IDs (comma-separated)
- [ ] Save — dashed boundary hull appears around member plants
- [ ] Move a member plant — hull boundary updates
- [ ] Edit consortium membership — hull re-renders
- [ ] Delete consortium — hull disappears
- [ ] Save design, reload — consortium membership preserved

discard consortium, just keep the tab and write a placeholder "Work in progress", that's not at all what we are looking for.

## 3m: Interactive Timeline

- [x] Open Timeline tab — Gantt view appears above the detail editor
- [x] Add actions with start/end dates — colored bars appear in swim lanes
adding dates should stick to best practices, when i click on a date, the calendar should disappear and the date should be updated, i should not have to click on esc to make the calendar disappear.
- [x] Mouse wheel zooms the timeline (Ctrl+wheel)
- [x] Horizontal scroll/shift+wheel pans the timeline
- [ ] Click an action bar — it highlights, detail editor shows below
didn't test
- [x] Today marker (red dashed line) visible at current date
- [x] Middle-click drag to pan
- [ ] Completed actions appear dimmed/strikethrough
didn't test

when we drag the tab to make it higher, the timeline strecthes and the police becomes strecthed. very bad ui. the ux is so bad, research how gantz chart are made and improve this, this is horrible ui/ux regarding the actions with ui bugs all around like the actions list is not visible, i should be able to reliably add an action an modify it directly in the gantz chart with standard best practice.

## 3n: GeoJSON & Budget Export

### GeoJSON
- [x] Set a design location
- [x] Place plants and draw zones
- [x] Open command palette → "Export as GeoJSON"
- [ ] Save file, open in geojson.io — zones and plants at correct geographic positions
it says wrong long lat on the website. it should be between -90 and 90 although i entered 0 and 0
- [ ] Grouped/rotated zones export at correct world positions
can't test

### Budget CSV
- [ ] Add budget items in the Budget tab
- [ ] Open command palette → "Export Budget (CSV)"
- [ ] Open the CSV — categories, quantities, unit costs, totals correct
- [ ] Grand total row at the bottom
discard this, this is not what i have in mind. it should display a list of unique plants on canvas, user should be able to assign price for each plant and the app should calculate reliably the total price.

## Cross-Feature Integration

- [x] Group plants → save → reload → verify group positions stable
- [ ] Group plants → export GeoJSON → verify plant positions are absolute (not group-relative)
can't test
- [ ] Set location + enable map + draw on canvas + save → reload → map re-enables at correct viewport
can't test
- [ ] Create consortium with grouped plants → move group → hull updates
can't test
- [x] All 6 languages: switch locale → verify new toolbar buttons, display mode dropdown, location form labels update

## Other issues
why do we always have display issue when we create a new feature on the canvas? is that an architecture issue. it 
click and drag to select multiple rectangle, sometime the rectangle stays visible after releasing the mouse.
