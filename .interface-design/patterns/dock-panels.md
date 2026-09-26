# Dock panels

Read the [design system](../system.md) first. Workbench and dock ownership: [frontend guide](../../docs/guides/frontend.md). Canvas boards: Workspace, FindPlants, SelectedToList, Layers, AddDataMenu, AddData, ImportProgress, AnalyzeDialog, SlopeAnalysis, Library, Calendar, CalendarAction, Budget, Consortium, Notebook, Favorites.

## Panel frame

A floating panel on the right (top 72, right 76, bottom 64): Literata 18 title, optional muted subtitle, head actions (Expand, Back on the left), close. Body scrolls; footers hold totals and apply actions. Width 380, or 440 for Budget and Consortium. `SidePanelDock` owns resize; a user width wins. Opening or switching panels keeps the map mounted.

## The plant finder

Every panel that lists plants starts with the finder (see the design system): search, quick filters, count. Panel-specific filters follow "Selected on map": Budget adds "Missing a price · N" and sort; Consortium marks every cell containing a match with a dot; Calendar targets use it as a multi-select picker with "Add all N".

- `components/shared/PlantFinder.tsx`: the field (placeholder "Find plants: name, scientific name or code", Ctrl F key cap until there is text), a "Quick filters" group of pressed-toggle chips, and one `role="status"` line: "Showing results for **pommier** · 2 species · 7 plants" when the matcher corrected a typo, "1 species · 3 plants selected on the map" under the selection filter, nothing while the list is unfiltered.
- Matches are marked with `<mark>` (`--color-mark`) in the common and scientific names; rows keep the one species row layout from the shared `species-row.module.css`.
- Found and filtered-out states use `EmptyState` with `status` so the reason is announced; the panel empties (no plants yet) use `EmptyState` with the panel icon and one action, usually "Open plant catalog".
- Only Plants in this Design rings its matches on the map, with the top chip "N plants match “q” · Zoom to them · Select all N · Clear". Other lists filter without touching the map; their rows still highlight on hover.

## Plants in this Design

Title with a muted "N plants · N species" subtitle, then a collapsible "Display on the map" section (Color by Species / Stratum / One color, Symbol size, Outline Light / Dark / None, Labels None / Codes / Names, Soften background), then species rows with a colour swatch first. A swatch recolours the whole species (or stratum, or all plants). Activating a row highlights that species on the map with a top chip: "Framboisier · 142 plants highlighted · Select these plants · Clear". "In the catalog, not in this Design" lists close matches with Open in catalog.

## Layers, data and analysis

- One list: **Design** (Plants, Zones, Notes and measurements, with counts, eye and lock), **Site data** (library items added to this Design, results nested under their source with "from Terrain"), **Background** (radio: Satellite · Google, Map · OpenFreeMap, None).
- "Add data" (the only entry) opens a menu: Terrain or height from files…, Design objects from GeoJSON…, items from your library ("In this Design" when added), Data library….
- The active site item has a footer: legend with range, Opacity, Fit, Read values (pressed while active), Analyze… on sources, Remove from Design.
- Import dialog: name (duplicate names refused with a suggestion), measure and unit, ordered files with Move up/down, a coverage check against the Design ("Covers your site"). Progress shows on its own row under Site data with Cancel import; the rest of Layers stays usable.
- Analyze dialog is generated from the analysis registry (ADR 0011): options with one-line explanations, existing results marked "Already in Layers", parameters inline, a primary action naming the result ("Add contours").
- Data library (dialog): search, type filter, Import…; rows with preview, kind, resolution and "In this Design" or Add to Design; Delete everywhere confirms and names the Designs that use the item. Removing from a Design keeps the library item.
- Web: no terrain import; Site data shows why ("needs Canopi Desktop, kept in this Design"); Add GeoJSON… sits on the Design section.

## Planning

- **Calendar:** month grid (week start from the locale) with single-day marks and range bars, today underlined, a selected day as a ringed cell; action types have a colour and a shape. Agenda for the selected day with done checkboxes and Edit; "Add action on <date>"; footer "N actions without a date · Show". New action: Title, type (radio chips), Start and End date fields, Repeat every year, targets (Species with the finder picker, Selected plants, Zone, Whole Design), a plant count.
- **Budget:** finder with Missing a price and sort; rows with code, plant count, unit cost field (locale decimals) and total; footer with plants and "N of M species priced", the grand total, a meter that filters to unpriced species, currency and Export CSV…, and the note that changing currency relabels prices.
- **Consortium:** "N species · N have no stratum yet" (a link that lists them with a stratum and phase picker); finder; a stratum × phase table with grouped phase headers and durations in words, a neutral bark heat ramp, dots on cells with matches, a selected cell with an outer ink ring; the list below shows the cell or the matches with full phase names.
- Planning views keep their search, filters and scroll per Design Session.

## Favorites and stamps

Search; Plants (star first, row opens details, Place and More); Saved stamps (reorder handle with Alt ↑/↓, glyph group, name, "N plants · N species", Place and More with Rename, Export…, Delete); Import… and Save as stamp…. Web keeps stamps browser-local and shows Recently viewed instead of stamps.

## Design notebook

A shortcut list of saved Designs in sections (Desktop). "This Design is in the notebook" or Add this Design; New section; rows with reorder handle, file icon, name, plant count and date, "Open now" on the current row; More: Open, Show in folder, Move to section, Remove from notebook (never deletes the file).
