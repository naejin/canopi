# Dock panels

Read the [design system](../system.md) first. Workbench and dock ownership: [frontend guide](../../docs/guides/frontend.md). Gallery: `?surface=workspace` (add `edition=web`), or `?surface=key|layers|library|favorites|notebook` with empty and long states.

## Dock

`WorkspaceComposition` validates the shell command projection against its edition's surfaces, chooses the primary surface and mounts one `SidePanelDock`. The side-surface wrapper is a bounded-height column flex container; keep it, because Catalog, Favorites and planning panels rely on it for internal scrolling and virtualization. Default width 352px within the minimum and viewport maximum; a user resize wins. Web keeps its narrow-screen stacked layout.

`SidePanelDock` owns pointer and keyboard resize. `DockPanelHeader` gives a sentence-case title, quiet count and close, and returns focus to the rail button. The shell owns which panel is open; opening or switching panels keeps the canvas mounted.

## Species Key

`SurfaceSearch`, then the show-codes toggle and plant total. Rows show the placed species: every effective glyph variant, names through `SpeciesIdentity`, a quiet mono code, count and a separate details action. The row toggles species focus without selecting or editing plants; focus stays clearable while searching or switching panels. Distinguish an empty Design from no search matches. No tall introduction.

## Layers

The scene stack (top to bottom) comes first, then Site references (basemap, satellite, the Design's LiDAR items, contours, hillshade) in map band order. Each row: visibility icon button, a neutral layer icon, the name as the activation target, a live object count where it applies, and a lock icon button when supported. Row icon buttons use `--control-size-sm` and name their row in `aria-label`.

The active layer has an ochre edge; locked inactive layers do not get an active-looking fill; hidden, locked and active stay independent. Active-layer details sit below the complete stack so switching does not move rows: opacity, basemap style, the optional Google key, contour interval, hillshade, and for LiDAR items units/legend, Fit, Inspect and Remove from Design. Sliders show their value and have accessible names.

## Data Library

Data Library manages reusable inputs and results; Layers manages the current Design's references, visibility and order. Do not duplicate library management in Layers or nest results under sources.

- Import, search and a simple type filter sit above the list. Rows: small preview, readable name, quiet type and resolution, and Add to Design or Added.
- Name or preview opens details in the same dock; Back restores query, scroll and focus. Rename and Delete live in `ActionMenu`. Removing from a Design keeps the library item.
- Calculate slope opens a small contextual form and publishes a reusable result. Progress, errors and Cancel/Retry stay with the affected operation; Escape dismisses an unsubmitted form, only Cancel stops a running job.
- No dataset history, source-priority editor, before/after apply flow, library undo or separate Analysis navigation.

## Planning: Calendar, Budget, Consortium

They read Planning Projection models and write through their workbenches into Design Edit. Search, filter, sort, month, expansion and scroll belong to the session-scoped Planning View and reset only when the Design Session changes.

- Calendar: mini month with agenda; Expand temporarily widens the dock and shows the full month above 640px of content; Reduce or a manual resize returns to the saved width.
- Budget: searchable species ledger with inline unit costs and a persistent totals and export footer.
- Consortium: fixed stratum-by-phase matrix filtering a grouped compact species list.
- Hover goes through Target Presentation; identity actions go through Species Focus. On narrow Web layouts these panels get the larger stacked share, and Budget and Consortium fall back to whole-panel scrolling at short heights.
- Chart labels choose black or white against the composited bar colour (including bar opacity and row stripes); authored species colours never change.

## Favorites

Plants and Saved stamps are sibling frames with equal heading and count treatment and a resizable split (a user setting, persisted on release, respecting both minimums).

- Plants: search, common and scientific names only, visible Place and favourite actions, a separate information chevron that opens plant details across the dock. Back restores search, scroll and the initiating button, and stays available through loading and error. The row body drags to the canvas. Web keeps Recently Viewed instead of Saved stamps.
- Saved stamps: ruled rows with a six-dot reorder grip, the user's name and a composition summary, a plus icon for Place and `ActionMenu` for Export, Rename and Delete. Import is a compact header action; Save selection is a left-aligned outlined action whose tooltip explains unavailability. Inline rename and delete confirmation, hover preview, body drag placement and pointer or keyboard reorder. Rows keep natural height when names wrap. Never show generated codes instead of user names. French uses planche/Planches; tampon stays for stamping tools.

## Design Notebook

`DockPanelHeader`, then compact Add current design and New section commands above one sectioned ledger. Add current design stays visible but disabled when already included and keeps save-before-add; it adds to the first section (or Unsectioned) with no destination dropdown. Ruled rows: document icon, saved name, quiet date and plant count, removal action; the active reference has an ochre edge and Open now, with the full path in its tooltip. Drag reorders rows and sections. Removal removes only the reference. The header's title and actions wrap into separate rows when narrow; actions never cover the title. No file-manager split, invented statuses or browser-local notebook.
