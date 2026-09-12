# Dock panels

Read the [design contract](../system.md). Gallery: ?surface=key, layers, or favorites; include empty and long states.

SidePanelDock is the single resizable dock. Default width is 352px, bounded by the existing minimum and viewport maximum; explicit user resize takes precedence. Web retains its narrow-screen stacked layout. DockPanelHeader uses shared sentence-case title/quiet count/close chrome and restores focus to the corresponding rail button. The shell owns which panel is open.

## Species Key

SurfaceSearch precedes the show-codes toggle and plant total. Rows read actual placed species: effective glyph variants, common/scientific names through SpeciesIdentity, quiet mono code, count, separate detail action. Preserve every appearance variant.

The main row toggles species focus without editing or selecting plants. Details opens the existing detail surface. Focus remains clearable while searching or switching panels; the canvas chip is independent of panel lifetime. Distinguish an empty Design from no search matches. Avoid a tall explanatory introduction.

## Layers

Show the scene stack before Site references. Each row has visibility, name/active target, and a separate lock when supported. Active layer has an ochre edge; locked inactive layers do not receive another active-looking row fill.

Active-layer settings stay below the complete stack so switching layers does not move rows. Preserve scene opacity, location setup, map opacity, contour interval and hillshade controls. Sliders have visible values and accessible names. Hidden and locked remain independent from active; controls remain readable.

## Favorites

Plants and Saved stamps are sibling frames with equal section-heading/count treatment and a resizable split. Retain Favorites navigation. Plants get search, two-line identity, and visible Place/favorite actions. Preserve detail opening and drag-to-canvas.

Saved stamps use ruled rows: six-dot reorder grip, user name/composition summary, visible Place, and ActionMenu containing Export/Rename/Delete. Import is a compact header action; Save selection is a secondary section action with the existing availability rule. Keep inline rename/delete confirmation, hover/focus recognition preview, separate body placement drag, and pointer/keyboard reorder. Never substitute generated codes for user names.

Split height is a user setting, not Design state. Pointer resize previews locally and persists on completion. Respect both frames' minimum height and available panel size. French library copy uses planche/Planches; tampon remains for stamping tools.

Persistence queues, cancellation and preview cleanup: [frontend workbenches](../../docs/agent/frontend-workbenches.md#saved-object-stamps).
