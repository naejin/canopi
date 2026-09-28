# Dock panels

Read the [design system](../system.md) first; ownership: [frontend guide](../../docs/guides/frontend.md). Boards: Workspace, FindPlants, SelectedToList, Layers, AddDataMenu, AddData, ImportProgress, AnalyzeDialog, SlopeAnalysis, Library, AnalyzeWater, WaterFlow, CanopyAnalysis, ResultDetails, LayersDark, Calendar, CalendarAction, Budget, Consortium, Notebook, Favorites, StoryAuthor.

## Panel frame

- A floating panel on the right (top 72, right 76, bottom 64): Literata 18 title, optional muted subtitle, head actions (Expand, Back on the left), close. Body scrolls; footers hold totals and apply actions. Width 380, or 440 for Budget, Consortium and Stories.
- No bare count beside the title: a summary worth reading is a labelled sentence ("N plants · N species") in the subtitle or finder line. Counts go through `formatCount`, or `{{count, number}}` with plural forms inside sentences.

## The plant finder

- Every panel that lists plants starts with the shared `PlantFinder` (see the design system): the field (label "Find plants", placeholder "Name, scientific name or code", Ctrl F key cap until there is text), a "Quick filters" group of pressed-toggle chips and menu chips, and one `role="status"` line (the correction or the selection filter in words; nothing while unfiltered).
- Plants in this Design, Budget, Consortium and the Place plants chooser follow "Selected on map" with Stratum and Form menus: Stratum is the Design's own (Emergent, High, Mid, Low, No stratum yet), Form the catalog habit (Tree, Shrub, Herbaceous, Climber, Not recorded).
- Matches are marked with `<mark>` (`--color-mark`); rows keep the species row layout (`species-row.module.css`). Found and filtered-out states use `EmptyState` with `status`; panel empties use `EmptyState` with the panel icon and one action, usually "Open plant catalog".
- Only Plants in this Design rings its matches on the map, with the top chip "N plants match “q” · Zoom to them · Select all N · Clear". Other lists filter without touching the map.

## Plants in this Design

- Title with a muted "N plants · N species" subtitle, then a collapsible "Display on the map" section: Color by (Species / Stratum / One color; One color adds a swatch, Stratum a legend whose swatches recolour a whole stratum, with "Reset stratum colors" once one is changed), Symbol size (50–200 %), Outline, Labels (None / Codes / Names with the "Codes shown for …" line and "Zoom in to see codes" when none shows), Soften background ("Kept on this device"), then a one-line hint for the colour mode.
- Species rows with a colour swatch first while colouring by species; the glyph always shows the colour the map draws. A swatch recolours the whole species. Options are saved with the Design, except Soften background. Activating a row highlights that species on the map with a top chip (name · N plants highlighted · Select these plants · Clear).

## Layers, data and analysis

- One list in three sections, front to back: **Design** (Annotations, Plants, Measurement guides, Zones, with counts, eye and lock), **Site data** (the Design's terrain and height items; results nest under their source with "from <source> · <units>"; then **Online elevation** with Contour lines and Hillshading), **Background** (one radio group: Satellite, Map, None). No section counts.
- "Add data" (the only entry, beside the Site data heading) opens a menu: Terrain or height from files…, Design objects from GeoJSON…, From your library ▸ (items already here are disabled), Data library….
- One row is active across Layers. The active site item's footer: name and type, out-of-date notice with Refresh, legend with range, Opacity, Fit to data (then Return to Design), Read values (pressed while active), Analyze… on sources, Details, Move forward and back (Alt ↑/↓), and Remove from Design with "Your library keeps the data."
- Details replace the list (Back to Layers): out-of-date notice with Refresh, facts and provenance, Run again with changes…, Rename…, Open in the Data library, Processing history.
- Import dialog (after the native picker): what Canopi accepts (single-band GeoTIFF), name, what the values measure and unit, ordered files. A notice says whether the files cover the Design and never blocks the import. Progress shows on its own row under Site data with Cancel import and "You can keep working."
- Analyze dialog is generated from the analysis registry (ADR 0011): it names its source and where results go, lists options with one-line explanations, marks existing results "Already in Layers", and shows parameters inline.
- Data library (dialog): search, type filter (`Dropdown`), Import…; rows with preview, type and resolution or units, and "In this Design" or Add to Design; the footer counts items and disk space, with Show in folder (ghost) and Done.
- Web: no terrain import; Site data says terrain and height data need Canopi Desktop.

## Planning

- **Calendar:** month grid with single-day marks and range bars, today underlined, the selected day a ringed cell; action types have a colour and a shape. The week starts on the locale's first day (`civilWeekStartDay`). Agenda for the selected day with done checkboxes and Edit; "Add action for this date"; footer "N unscheduled" switches to the agenda.
- **Calendar action editor:** `SurfaceHeader` with Back, title and Close; a multi-line Description, Action type, the schedule as a `SegmentedControl` (Range · One day · Unscheduled) with inclusive Start and End dates, targets (Whole Design, Species with the finder picker and "Add all N", Current selection, Zone), Completed as a `Switch`, then Delete · Cancel · Save.
- **Budget:** finder with "Missing a price · N" and sort; rows with code, plant count, unit cost field (locale decimals) and total in compact columns (6 px gaps, plants 28, unit cost 76, total 72). Footer: plants and "N of M species priced", the grand total, a meter that filters to unpriced species, currency and Export CSV….
- **Consortium:** "N species · N have no stratum yet"; finder (a dot marks every cell containing a match); a stratum × phase table with grouped phase headers and durations in words, a neutral bark heat ramp; the list below shows the cell or the matches with full phase names.
- Planning views keep their search, filters and scroll per Design session.

## Favorites and stamps

Search; Plants (star first, row opens details, Place and More); Saved stamps (reorder handle with Alt ↑/↓, glyph group, name, "N plants · N zones · N annotations", Place and More with Rename, Export…, Delete); Import stamps… (icon) and Save selection. Web has Plants and Recently viewed, no stamps.

## Stories

Title "Stories"; a row with the story `Dropdown`, its More menu (Rename story…, Delete story with Undo) and New story. Body: step rows (60 px: reorder handle with Alt ↑/↓, number, a 64 × 44 thumbnail, the title over the first line of its text, More: Duplicate, Move up/down, Move to ▸ another story, Delete with Undo); the selected row is the ochre-edged selected row. Then "Add the current view as a step" (disabled until the Design is on a map).

The selected step's editor card: "Step n", Title, Text (a small toolbar; links only to web and e-mail addresses), Images (thumbnail, a required Description and Remove), "This step shows" tags, then Use the current map view and Go to this view. Footer: "N steps · saved with the Design" and Present (primary; disabled until the story has a step and the Design is on a map), presenting from the selected step ([Canvas workspace](canvas-workspace.md#presenting-a-story)). No stories yet is an `EmptyState` with New story.

## Design notebook

A shortcut list of saved Designs in sections (Desktop). Add current Design; New section; rows with name, plant count and date, "Open now" on the current row, drag between sections, and a remove button that never deletes the file.
