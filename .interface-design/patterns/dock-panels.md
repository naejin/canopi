# Dock panels

Read the [design contract](../system.md). Gallery: `?surface=workspace` exercises the complete Desktop composition; add `edition=web` for the Web composition. Direct panel review remains available through `?surface=key|layers|favorites|notebook`; include empty and long states.

`WorkspaceComposition` validates the shell command projection against its edition's registered surfaces, chooses the primary surface, and mounts the single `SidePanelDock`. Its side-surface wrapper is a column flex container with bounded height; preserve that containing block because Catalog, Favorites, and planning panels depend on it for internal scrolling and virtualization. Default dock width is 352px, bounded by the existing minimum and viewport maximum; explicit user resize takes precedence. Web retains its narrow-screen stacked layout. `SidePanelDock` owns the pointer and keyboard resize lifecycle. `DockPanelHeader` uses shared sentence-case title/quiet count/close chrome and restores focus to the corresponding rail button. The shell owns which panel is open. Species Key and Layers are followed by Calendar, Budget, and Consortium in the Design group; opening or switching them keeps the canvas mounted.

## Planning

Calendar, Budget, and Consortium consume Planning Projection read models and write through their feature workbenches into Design Edit. Their search, filter, sort, month, expansion, and scroll state belongs to the session-scoped Planning View owner and resets only when the Design Session identity changes.

Calendar uses a mini month with an agenda at normal dock widths. Expand temporarily grows the same dock and shows the full month grid above the 640px content threshold; Reduce or a manual resize returns to the normal saved width. Budget is a searchable species ledger with inline unit costs and a persistent totals/export footer. Consortium uses a fixed stratum-by-phase matrix to filter a grouped compact species list. Hover presentation routes through Target Presentation, and identity actions route through Species Focus.

On narrow Web layouts, planning panels receive the larger stacked-dock share. Budget and Consortium fall back to whole-panel scrolling so their rows, editors, and totals remain reachable at short heights; Budget keeps its footer visible when the viewport has room and lets it join that scroll on short viewports.

## Species Key

SurfaceSearch precedes the show-codes toggle and plant total. Rows read actual placed species: effective glyph variants, common/scientific names through SpeciesIdentity, quiet mono code, count, separate detail action. Preserve every appearance variant.

The main row toggles species focus without editing or selecting plants. Details opens the existing detail surface. Focus remains clearable while searching or switching panels; the canvas chip is independent of panel lifetime. Distinguish an empty Design from no search matches. Avoid a tall explanatory introduction.

## Layers

Show the scene stack before Site references. Each row has visibility, a neutral layer icon, name/active target, a live scene-object count where applicable, and a separate lock when supported. Label the scene stack top-to-bottom; Site references are independent of scene order. Active layer has an ochre edge; locked inactive layers do not receive another active-looking row fill.

Active-layer settings stay below the complete stack so switching layers does not move rows. Preserve scene opacity, location setup, map opacity, contour interval and hillshade controls. Sliders have visible values and accessible names. Hidden and locked remain independent from active; controls remain readable.

## Favorites

Plants and Saved stamps are sibling frames with equal section-heading/count treatment and a resizable split. Retain Favorites navigation. Plants get search, only common/scientific names, and visible Place/favorite actions. Omit climate, life cycle, alternate common names and other metadata from these compact rows; those belong in plant information. A separate information chevron opens plant database information across the whole dock, like Species Key. Keep the underlying list mounted; Back restores its search, scroll and initiating button (or search if that row disappeared). Keep Back available through loading/error states. The row body retains drag-to-canvas. Web Favorites uses the same detail navigation and retains Recently Viewed instead of adding desktop Saved Stamps.

Saved stamps use ruled rows: six-dot reorder grip, user name/composition summary, a plus icon for Place, and ActionMenu containing Export/Rename/Delete. Import is a compact header action; Save selection is a left-aligned outlined action with a plus icon and the existing availability rule. Explain an unavailable selection in its tooltip, without an extra strip above the rows. Keep inline rename/delete confirmation, hover/focus recognition preview, separate body placement drag, and pointer/keyboard reorder. Rows keep their natural height when names wrap; scroll the list instead of compressing row content. Never substitute generated codes for user names.

Split height is a user setting, not Design state. Pointer resize previews locally and persists on completion. Respect both frames' minimum height and available panel size. French library copy uses planche/Planches; tampon remains for stamping tools.

Persistence queues, cancellation and preview cleanup: [frontend workbenches](../../docs/agent/frontend-workbenches.md#saved-object-stamps).

## Design notebook

Use DockPanelHeader for sentence-case title, quiet count and close. Compact Add current design / New section commands precede a single open sectioned ledger. Keep Add current design visible but disabled when already included; preserve save-before-add. Add directly to the first section (or Unsectioned when none exists), without a destination dropdown. Reorganize entries by dragging within the ledger. Each ruled row has a document icon, saved name, quiet date/plant count, and removal action. Mark the active reference with an ochre edge and Open now; keep the full path in its tooltip for disambiguation.

Preserve direct row/section-title ordering, section creation/rename/removal, and Design Session navigation. Removal only removes the notebook reference. No file-manager split, invented statuses, separate notebook labels or browser-local Notebook. See the workbench guide for authority and edition boundaries.

## Data Library and data layers

The accepted [GeoLibre migration UX](../../docs/design/raster-rework/geolibre-adoption-plan.md#6-user-experience-across-the-application) replaces the earlier Data/Analysis/source-history flow. It is the target for migration, not a claim that production already matches it. The current implementation still has Data/Analysis panels and history/source controls; its ownership and qualification are routed through the [LiDAR guide](../../docs/agent/lidar.md).

Use two surfaces: Data Library manages reusable inputs and results; Layers manages current-Design references, visibility and drawing order. Library rows use a small preview, readable name, quiet type/resolution and Add to Design or Added. Put Import, search and a simple type filter above the list. Name/preview opens details in the same dock; Back restores query, scroll and focus. Rename/Delete belong in ActionMenu. Progress, errors and Cancel/Retry stay with the affected operation.

Layers uses flat compact rows in actual data-band order with independent eyes. Selected details contain opacity, units/legend, Fit, Inspect and Remove from Design; removal retains the library item. Do not nest results under sources or duplicate library management in Layers. Keep botanical layer behavior and scene selection independent.

No dataset History, source-priority editor, before/after Apply flow, library Undo, automatic-refresh dashboard or separate primary Analysis navigation. Later, Calculate slope opens a small contextual form and publishes a reusable result. The adoption plan owns import grouping, attachment, deletion, scientific and failure semantics; do not infer them from a visual fixture.

Reuse the existing dock header, search, menus, tokens and responsive layout. Keep the canvas mounted; use compact ruled rows rather than nested cards. Drive Import → find → preview → add → inspect → remove → reuse in another Design with keyboard, short/narrow windows, long translations and light/dark states. Escape dismisses an unsubmitted form or inspection; only explicit Cancel cancels a running job.
