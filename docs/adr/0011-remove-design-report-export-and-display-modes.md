# Remove Design Report PDF export and plant display modes

Status: Accepted

Canopi no longer maintains the structured Design Report PDF export or the general plant Display by / Color by presentation controls.

The Design Report export added a separate report read model, frontend save-dialog IPC, a Rust `printpdf` renderer, bundled report fonts, and report-specific tests. That surface duplicated document and canvas concerns while adding package size and maintenance cost. The remaining PDF export path is the native canvas snapshot export under `services::export` and `platform::export_pdf`; it is not a structured Design Report renderer.

Plant presentation now has one production path: symbolic Placed Plant markers sized by the Visual Footprint curve, colored by explicit Plant Color, species Plant Color, or stratum fallback, and decorated by Plant Symbol. Species canopy spread can still be stored/backfilled as plant metadata for spacing and data quality, but it is not a display mode. Pinned Plant Names keep their legend because they describe an explicit persisted canvas annotation state.

Do not reintroduce `app/design-report`, `ipc/design-report`, `commands::design_report`, `services::design_report`, report-specific PDF dependencies, or general Display by / Color by controls without a new decision record.
