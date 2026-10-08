# Dock panels

Read the [design system](../system.md) first; ownership: [frontend guide](../../docs/guides/frontend.md). Boards: Workspace, FindPlants, SelectedToList, Layers, LayersDark, WebPhoneLayers, Calendar, CalendarAction, Budget, Consortium, Notebook, Favorites, StoryAuthor. Site data boards: [site data](site-data.md).

## Panel frame

- A floating panel on the right (top 72, right 76, bottom 64): Literata 18 title, optional muted subtitle, head actions (Expand, Back on the left), close. Body scrolls; footers hold totals and apply actions. Width 380, or 440 for Budget, Consortium and Stories.
- No bare count beside the title: a summary is a labelled sentence ("N plants · N species") in the subtitle or finder line. Counts go through `formatCount`, or `{{count, number}}` with plural forms.

## The plant finder

- Every panel that lists plants starts with the shared `PlantFinder`: the field (label "Find plants", placeholder "Name, scientific name or code", Ctrl F key cap until there is text), a "Quick filters" group of pressed-toggle chips and menu chips, and one `role="status"` line (the correction or the selection filter in words; nothing while unfiltered).
- Plants in this Design, Budget, Consortium and the Place plants chooser follow "Selected on map" with Stratum and Form menus: Stratum is the Design's own (Emergent, High, Mid, Low, No stratum yet), Form the catalog habit (Tree, Shrub, Herbaceous, Climber, Not recorded).
- Matches are marked with `<mark>` (`--color-mark`); rows keep the species row layout (`species-row.module.css`). Found and filtered-out states use `EmptyState` with `status`; panel empties use `EmptyState` with the panel icon and one action, usually "Open plant catalog".
- Only Plants in this Design rings its matches on the map, with the top chip "N plants match “q” · Zoom to them · Select all N · Clear". Other lists filter without touching the map.

## Plants in this Design

- Title with a muted "N plants · N species" subtitle, then a collapsible "Display on the map" section: Color by (Species / Stratum / One color; One color adds a swatch, Stratum a legend whose swatches recolour a whole stratum, with "Reset stratum colors" once one is changed), Symbol size (50–200 %), Outline, Labels (None / Codes / Names with the "Codes shown for …" line, "Zoom in to see codes" when none shows), Soften background ("Kept on this device"), then a one-line hint.
- Species rows with a colour swatch first while colouring by species; the glyph always shows the colour the map draws. A swatch recolours the whole species. Options are saved with the Design, except Soften background. Activating a row highlights that species on the map with a top chip (name · N plants highlighted · Select these plants · Clear).

## Layers

- Front to back: **Design** (Annotations, Plants, Measurement guides, Zones: eye, icon, name, count, lock), one **Site data** row, **Map** (Contour lines, Hillshading, then Background: Satellite, Street map, None with the chosen option's settings always under it). No footer; nothing replaces the list.
- A name opens that row's settings under it (Opacity; Contour lines add Contour interval) and a second click closes it; one row is open at a time, marked by a 3 px amber bar and a semibold name, no fill. Every eye reads "Hide X"/"Show X".
- Site data row (Desktop): one eye for all site data, saved with the Design, that leaves each item's own eye as it was, "N of M shown" or "None yet", and › to the [Site data panel](site-data.md). Web: "N terrain or height layers in this Design · Needs Canopi Desktop", no eye, opens nothing, absent with no site data.

## Planning

- **Calendar:** month grid with single-day marks and range bars, today underlined, the selected day a ringed cell; action types have a colour and a shape. The week starts on the locale's first day (`civilWeekStartDay`). Agenda for the selected day with done checkboxes and Edit; "Add action for this date"; footer "N unscheduled" switches to the agenda.
- **Calendar action editor:** `SurfaceHeader` with Back, title and Close; a multi-line Description, Action type, the schedule as a `SegmentedControl` (Range · One day · Unscheduled) with inclusive Start and End dates, targets (Whole Design, Species with the finder picker and "Add all N", Current selection, Zone), Completed as a `Switch`, then Delete · Cancel · Save.
- **Budget:** finder with "Missing a price · N" and sort; rows with code, plant count, unit cost field (locale decimals) and total in compact columns (6 px gaps, plants 28, unit cost 76, total 72). Footer: plants and "N of M species priced", the grand total, a meter that filters to unpriced species, currency and Export CSV….
- **Consortium:** "N species · N have no stratum yet"; finder (a dot marks every cell containing a match); a stratum × phase table with grouped phase headers and durations in words, a neutral bark heat ramp; the list below shows the cell or the matches with full phase names.

## Favorites and stamps

Search; Plants (star first, row opens details, Place and More); Saved stamps (reorder handle with Alt ↑/↓, glyph group, name, "N plants · N zones · N annotations", Place and More with Rename, Export…, Delete); Import stamps… (icon) and Save selection. Web has Plants and Recently viewed, no stamps.

## Stories

Title "Stories"; a row with the story `Dropdown`, its More menu (Rename story…, Delete story with Undo) and New story. Body: step rows (60 px: reorder handle with Alt ↑/↓, number, a 64 × 40 thumbnail, the title over the first line of its text, More: Duplicate, Move up/down, Move to ▸ another story, Delete with Undo); the selected row is the ochre-edged selected row. Then "Add the current view as a step" (disabled until the Design is on a map).

The selected step's editor card: "Step n", Title, Text (a small toolbar; links only to web and e-mail addresses), Images (thumbnail, a required Description and Remove), "This step shows" tags, then Use the current map view and Go to this view. Footer: "N steps · saved with the Design" and Present (primary; disabled without a step or a map), from the selected step ([Canvas workspace](canvas-workspace.md#presenting-a-story)). No stories yet is an `EmptyState` with New story.

## Design notebook

A shortcut list of saved Designs in sections (Desktop). Add current Design; New section; rows with name, plant count and date, "Open now" on the current row, drag between sections, and a remove button that never deletes the file.
