# Canvas workspace

Read the [design system](../system.md) first. Runtime: [map workspace guide](../../docs/guides/map-workspace.md). Boards: Workspace, SiteFound, Overview, NamesOnMap, PlacePlants, PlantRow, StampPlace, Selection, Appearance, ZoneDraw, ZoneSelected, MeasureText, StoryPresent, StoryPhone.

## Chrome

- Tool rail: groups separated by rules; the active tool solid ochre with `aria-pressed`; arrow keys move between tools. Labels and key hints show until each tool has been used once (per device), then 52 px icons with labelled tooltips. The labelled rail is a fixed 224 px; it keeps to icons when it would leave less than 360 px of map or when a label would be cut.
- In a short window the last tools fold, in rail order, into More tools before Undo and Redo, which never fold. The rail never scrolls or covers the view chip. The panel rail folds the same way and never covers the inspection launcher or the zoom group.
- View chip: Grid, Snap to grid, Rulers as pressed toggles with a check icon; off by default except Snap.
- Zoom group: scale bar, zoom out, scale ratio (a menu of common scales), zoom in, Fit to Design (Shift F). The attribution pill sits left of it, expanded; it folds into an (i) button only when its band leaves it less than 360 px.
- Below 0.1 px/m the Design is one pin ("Return to …"), editing tools are disabled and a top-centre chip says "Zoom in to edit. Plants are hidden at this scale." with Return to Design.
- The map is a keyboard stop with the focus ring inside its edge, one of the four F6 areas. Arrows nudge the selection 10 cm, 1 m with Shift, one undo per series; locked objects stay put.

## Map annotations

- Measurements: light tag (95% surface, ink, 13/600, tabular); the live value under the cursor: dark tag. Zone names and text notes follow the map, never the UI theme: cream with a dark halo over satellite and the Dark basemap, dark with a cream halo over the light basemap and paper; no pill. Lengths: one decimal below 100 m, none above, two below 1 m; areas in ha or m².
- Every overlay stroke has a dark casing underneath so it reads on bright or dark imagery.
- Highlight rings (finder matches, a panel pointing at plants) are solid ochre, 2 px over a 5 px halo, never under 8 px radius on screen. A panel never marks a plant with a filled disc or a colour of its own.
- Labels (View › Labels ▸ None, Codes, Names; N cycles them): text with a contrasting halo, thinned so no label touches another label or symbol. A saved view records the choice. Pinned names and a single selection's name always show.

## Selection and the right-click menu

- Selection box: 2 px ochre over a 5 px cream casing, square corner handles, an ochre ring on each selected plant. Rotatable selections keep one rotate handle above, the only control drawn on a selection, kept inside the visible map area. No action bar.
- Status chip (bottom centre of the visible map area) names the selection: "Apricot", "12 plants · 3 species · 0.8 m apart", "Zone · Z04 · 118 m² · 46 m", or "4 selected · 2 plants · 1 zone · 1 text note"; groups count as their members. Never an id. It carries Select all of this species (Ctrl Shift A), Rename… (one unlocked zone) and Clear selection; hidden in overview and during "Where is your site?".
- Right-click on an object selects it (unless already selected) and opens the context menu in plain words with the menu bar's shortcuts, under a quiet heading in the chip's words (also its accessible name). Groups: Cut, Copy, Paste, Duplicate · plants: Select all of this species, Plant color ▸, Plant symbol ▸, Show name / Hide name, Species details · Add to calendar…, Set unit cost… · Arrange ▸ (Bring to front, Send to back · Group, Ungroup), Rotate… (Ctrl Alt R), Save as stamp (Desktop) · Lock, Unlock · Delete, last, in danger red.
- Zones get the menu without the plant group and Set unit cost…; a lone zone adds Rename zone… after Duplicate (disabled while locked): a small modal (Name prefilled and selected; empty names the zone by its type and size), one Undo. Right-click on the empty map: Place plants here, Paste (at the pointer), Select all; the selection is kept.
- Items that do not apply stay listed with `aria-disabled`. The menu is as wide as its longest label and shortcut (up to 400 px). It opens at the pointer, or below the selection by keyboard (Menu key, Shift F10), always in view.

## Rotate…

A small modal (Edit › Rotate…, the right-click menu, Ctrl Alt R) titled "Rotate selection": the Angle field in degrees (locale decimals) between −15° and +15° step buttons, a hint (about the centre, positive clockwise), Cancel and Rotate. One Undo.

## Tools

- Tool cards (320 px): the species glyph in its map colour or the stamp icon before the tool name; the subject on its own line (bold) and the instruction under it; key hints ending with the Esc meaning ("Esc to stop placing", "Esc to cancel" during a gesture, otherwise "Esc to go back to Select").
- Place plants arms without a species: the card carries a compact chooser (the plant finder with Stratum and Form, over the species in this Design, then Favorites, then recent picks, and "Open the full catalog"). A click with no species places nothing and focuses the chooser.
- Place plants previews under the pointer: the symbol at 85% opacity, a dashed ring for the catalog's maximum mature width (none when the catalog has none) and a dashed line to the nearest plant within 320 px.
- Plant a row: click a placed plant, drag along the row; the Interval field (focused once picked; Enter keeps it, Esc drops the plant) and the live count (ochre when dense, red with "Increase interval or shorten the line" above the limit); Shift keeps 45°.
- Place a stamp previews the whole stamp as ghosts. [ and ] turn a held stamp by 15° about the pointer; placed objects keep the turn and the card says so.
- Zones: click adds corners, first corner or Enter finishes, Backspace removes the last corner, Shift keeps 45°; live edge lengths and area. Text note: click places a field; Enter finishes, Shift Enter breaks a line, Esc restores. Measure: click two points; the result stays as a guide.
- Drawing never moves existing objects; Space pans temporarily. Esc cancels the gesture, then returns to Select, then clears the selection; closing a field the tool opened returns focus to the map so the chain continues.

## Symbol and colour

Plant color ▸ and Plant symbol ▸ open popovers beside the menu (Escape returns focus to the map). Symbols: tiles in four labelled groups (Plant form, What it gives, What it does, Abstract) as one radio group, 5 columns, 70 px tiles with two-line labels. Colours: named swatches as a radio group plus Custom color. Footer: "Apply to N selected" (secondary) and "Set for all <species>" (primary). Choices preview until applied.

## Inspection lens

A view-only magnified preview with recentre, widen and magnify controls, collision-aware labels, keyboard pan, and an ochre source rectangle on the map (see the map workspace guide).

## Presenting a story

The map fills the window with none of the editing chrome. A floating glass card (420 px, 32 px from the top left, scrolls when long): "<story> · Step n of m" in muted caption, the step title in Literata 28, the text at 18 px, images with descriptions, tags for the highlighted species with counts, then Previous, step dots (the current one a wide ochre bar, `aria-current="step"`), Next (primary) and the key hint. Top right, a glass pill with the story name, Full screen (F) and Leave presentation (Esc). The map flies between steps and rings what the step highlights.

On phones (the phone-layout breakpoints): a top bar with "Step n of m", small dots and Leave (44 px), and the card as a bottom sheet with full-width Previous and Next that stay in reach while the text scrolls, swipe to move, safe-area insets.
