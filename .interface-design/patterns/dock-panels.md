# Dock panels

Read the [design contract](../system.md). Gallery: ?surface=key, layers, favorites, or notebook; include empty and long states.

SidePanelDock is the single resizable dock. Default width is 352px, bounded by the existing minimum and viewport maximum; explicit user resize takes precedence. Web retains its narrow-screen stacked layout. DockPanelHeader uses shared sentence-case title/quiet count/close chrome and restores focus to the corresponding rail button. The shell owns which panel is open.

## Species Key

SurfaceSearch precedes the show-codes toggle and plant total. Rows read actual placed species: effective glyph variants, common/scientific names through SpeciesIdentity, quiet mono code, count, separate detail action. Preserve every appearance variant.

The main row toggles species focus without editing or selecting plants. Details opens the existing detail surface. Focus remains clearable while searching or switching panels; the canvas chip is independent of panel lifetime. Distinguish an empty Design from no search matches. Avoid a tall explanatory introduction.

## Layers

Show the scene stack before Site references. Each row has visibility, a neutral layer icon, name/active target, a live scene-object count where applicable, and a separate lock when supported. Label the scene stack top-to-bottom; Site references are independent of scene order. Active layer has an ochre edge; locked inactive layers do not receive another active-looking row fill.

Active-layer settings stay below the complete stack so switching layers does not move rows. Preserve scene opacity, location setup, map opacity, contour interval and hillshade controls. Sliders have visible values and accessible names. Hidden and locked remain independent from active; controls remain readable.

## Favorites

Plants and Saved stamps are sibling frames with equal section-heading/count treatment and a resizable split. Retain Favorites navigation. Plants get search, two-line identity, and visible Place/favorite actions. A separate information chevron opens plant database information across the whole dock, like Species Key. Keep the underlying list mounted; Back restores its search, scroll and initiating button (or search if that row disappeared). Keep Back available through loading/error states. The row body retains drag-to-canvas. Web Favorites uses the same detail navigation and retains Recently Viewed instead of adding desktop Saved Stamps.

Saved stamps use ruled rows: six-dot reorder grip, user name/composition summary, visible Place, and ActionMenu containing Export/Rename/Delete. Import is a compact header action; Save selection is a secondary section action with the existing availability rule. Keep inline rename/delete confirmation, hover/focus recognition preview, separate body placement drag, and pointer/keyboard reorder. Never substitute generated codes for user names.

Split height is a user setting, not Design state. Pointer resize previews locally and persists on completion. Respect both frames' minimum height and available panel size. French library copy uses planche/Planches; tampon remains for stamping tools.

Persistence queues, cancellation and preview cleanup: [frontend workbenches](../../docs/agent/frontend-workbenches.md#saved-object-stamps).

## Design notebook

Use DockPanelHeader for sentence-case title, quiet count and close. Compact Add current design / New section commands precede a single open sectioned ledger. Keep Add current design visible but disabled when already included; preserve save-before-add and the destination-section choice. Each ruled row has a document icon, saved name, quiet date/plant count, and removal action. Mark the active reference with an ochre edge and Open now; keep the full path in its tooltip for disambiguation.

Preserve direct row/section-title ordering, section creation/rename/removal, and Design Session navigation. Removal only removes the notebook reference. No file-manager split, invented statuses, separate notebook labels or browser-local Notebook. See the workbench guide for authority and edition boundaries.
