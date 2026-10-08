# Site data

Read the [design system](../system.md) first; ownership: [data library guide](../../docs/guides/data-library.md). Desktop only. Boards: SiteData, SiteDataValues, SiteDataMissing, SiteDataProfile, SiteDataDark, Import, AnalyzeDialog, Library, LibraryDark; WaterFlow shows planned hydrology.

## Panel

- Its own rail button under Layers (topographic rings, Ctrl 2), 440 px. Header: "Site data", Library (opens the Data library), close; a pinned point adds its coordinates and Unpin. Toolbar: Import…, Analyze…, Profile (pressed while armed).
- Analyze… and Profile stay in place when unusable: disabled, with a tooltip naming what to add or show first.
- View state (open item, collapsed sources, filter, scroll) survives switching panels and clears with the Design; the pin and the profile end whenever Site data stops being the open panel (switching panels, closing it, switching Design).
- A filter appears above more than 8 items; it keeps a match's source visible and turns reordering off.
- While the Layers eye hides all site data, a strip says "Site data is hidden from the map" with Show.
- Empty: "No site data yet" with Import files… and Open the Data library; in Layers the row reads "None yet" and still opens the panel.

## Rows

- One line, 32 px (44 under a coarse pointer): grip (always shown, muted), chevron on rows with results, eye, ramp swatch with a strong edge (dimmed when hidden), name, then one trailing item: the value, Preparing, Display failed, Missing, Refreshing, or Refresh on an out-of-date result.
- The list is the draw order, front first. Results sit under their source; collapse (chevron only, expanded by default, per session) hides them in the panel only. Drag the grip or press Alt ↑/↓ to reorder among siblings; the list reflows live and the map changes on drop.
- Pending imports sit at the top with a progress line, calculations under their source; each has Cancel.

## Values

- With the panel open, each visible row shows its value under the pointer: metres to 2 decimals, degrees and percent to 1, localised, tabular figures; "—" (read as "No data") where there is none. Values come from the stored data, never the display tiles.
- A click no tool uses (Select on empty ground, any Pan tap) pins a point: a two-tone dot on the map and "48.851230° N, 2.352110° E" (6 decimals, localised) with Unpin in the header. Over the map the rows follow the pointer; off it they show the pin. Esc or Unpin clears it.

## Open item

- A name opens its settings under the row and closes the other: Colors (the kind's three ramps as swatches, Reverse, legend with ≤/≥ at clipped ends), Range (Data range, Cut outliers, Custom with Minimum and Maximum always showing the values in use), Opacity, then Fit to data, Details, Remove from Design.
- Ramps, default first: elevation Terrain, Earth, Gray; height Greens, Magma, Gray; slope Yellow–red, Magma, Gray (0–30°, shown as Custom); other values Magma, Yellow–red, Gray. Blue ramps belong to water kinds only; differences use purple–orange. A test enforces it.
- Colors and range apply on click, Enter or leaving the field, never while dragging; opacity is live. Reset, shown when anything differs from the kind's default, restores colors, Reverse and range. All are saved with the Design.

## Missing item

- The stored name, an alert in the eye's place, Missing at the right; opened, the reason naming its fix ("Not in this computer's Data library", "The Data library needs a newer Canopi", "The Data library couldn't be opened. Restart Canopi.") and Remove from Design only.

## Profile

- Profile, or "Profile this line" on a Line zone's or Measure guide's menu, arms a line tool: click points; double-click, Enter or Finish shape ends; Backspace removes a point; Esc cancels. The tool returns to Select; the line stays until ×, Esc, a new line, or Site data stops being the open panel. Never saved, printed or captured.
- The chart is pinned under the rows: elevation curves above, height curves in their own strip, sharing distance and cursor; ink, ochre, green, plum, a fifth curve dashed; min and max labels, gaps for no data, the length.
- Per curve: Rise (signed net change) and Steepest % over 2 m, which moves the cursor there; height curves give Highest. Hovering the chart moves a hollow ring on the line. Copy values copies tab-separated text with local decimals.

## Dialogs and library

- Import: single-band GeoTIFF, name, what the values measure, ordered files; a coverage notice never blocks; the import joins this Design.
- Analyze (ADR 0011 registry): Source (defaults to the open item), one-line explanations, inline parameters, "Already in Site data" with Show in Site data; results join this Design when it shows the source.
- Data library: a large sheet centred over the dimmed workspace, opened from the Site data header, Details, File and the palette. List rows: 56 × 42 preview, name, type caption ("· In this Design"), state; results under their source; sort by Name or Recently added; the selected row has a pale fill and an ochre bar. Below 760 px one pane shows at a time, with Back.
- Details: Rename…, the actions (Add to Design or Show in Site data, Run again with changes… on results, Delete everywhere confirmed in place), preview, facts with Added, provenance links, saved results, files, history. Footer: items, disk use, Show in folder. Import and Analyze open over the sheet and return to it unchanged.
- The empty library offers Import…, which adds to the open Design and is disabled without one.
