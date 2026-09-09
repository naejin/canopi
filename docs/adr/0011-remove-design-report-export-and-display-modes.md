# Remove Design Report PDF export and plant display modes

Status: Accepted

The restriction on new Canvas PDF export is revised by [ADR 0024](0024-shared-canvas-pdf-export.md). The historical report removal and plant-presentation decisions below remain in force.

Canopi no longer maintains the structured Design Report PDF export or the general plant Display by / Color by presentation controls.

The Design Report export added a separate report read model, frontend save-dialog IPC, a Rust `printpdf` renderer, bundled report fonts, and report-specific tests. That surface duplicated document and canvas concerns while adding package size and maintenance cost. At removal time, the remaining PDF code was native canvas snapshot export under `services::export` and `platform::export_pdf`. That snapshot-PDF command and its platform renderers were also removed after Canvas PDF approval. The new Canvas PDF workflow uses the shared browser-compatible pipeline described in ADR 0024 and the [implementation guide](../agent/canvas-pdf.md). It does not restore the retired Design Report renderer.

Plant presentation now has one production path: symbolic Placed Plant markers sized by the Visual Footprint curve and local plant spacing, colored by explicit Plant Color, species Plant Color, or stratum fallback, and decorated by Plant Symbol. Species canopy spread can still be stored/backfilled as plant metadata for spacing and data quality, but it is not a display mode. Automatic Detail reveals full symbols and collision-aware names, Annotations, and Measurement Guide distances as screen space permits. The optional Inspection Lens magnifies a local view and identifies nearby Plants. These are transient reading aids within the same production path: they do not change positions, colours, symbols, pins, or Design history. Pinned Plant Names remain an explicit persisted choice and take precedence over automatic names; PDF output follows ADR 0024 and does not inherit screen decluttering. See the [dense Canvas guide](../agent/dense-canvas.md) for the implemented policy.

ADR 0024 authorizes a new shared Canvas PDF pipeline and the PDF dependency selected for it. The old `app/design-report`, `ipc/design-report`, `commands::design_report`, and `services::design_report` implementation remains retired; the former `printpdf` selection is historical. Timeline, Budget, and Consortium PDF sections are deferred under ADR 0024. General Display by / Color by controls still require a new decision record.
