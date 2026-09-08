---
status: accepted
---

# Shared Canvas PDF export on desktop and Web

Canopi will offer Canvas PDF export for sharing and field printing on Linux, macOS, Windows, and Web Edition through shared browser-compatible print layout and PDF generation, with edition-specific file saving or downloading. Small Designs fit on one page; larger or denser Designs use an overview plus numbered detail pages when needed to preserve paper readability, including a plant-identification legend. The first release focuses on the canvas; Timeline, Budget, and Consortium PDF sections are deferred to later work.

**Consequences**:
Including Web Edition in the first release makes consistent print output a shared capability and accepts the additional browser testing, memory, and asset-loading work. Layout and PDF generation must work within the [static Web bundle](0012-web-edition-static-app-bundle.md), while saving and downloading follow the [compile-time platform adapter boundary](0021-web-edition-compile-time-adapters.md). Canvas PDF is derived from the Design's existing authorities and does not become another editable Design model or replace `.canopi` persistence.

This decision revises the restriction on new PDF export in [ADR 0011](0011-remove-design-report-export-and-display-modes.md) and supersedes [ADR 0019](0019-web-edition-canopi-export-only.md) by adding Canvas PDF alongside `.canopi` download in Web Edition. The previous structured Design Report implementation and its Rust `printpdf` choice remain retired; ADR 0011's plant-presentation decisions remain in force. PNG, SVG, CSV, Diagnostic Bundle export, and native file-management flows remain outside the approved Web export scope; Saved Object Stamp portability still requires its own decision. Timeline, Budget, and Consortium PDF sections are release deferrals, not permanent exclusions.

This records an approved direction; the shared Canvas PDF feature is not implemented yet. The PDF library, vector/raster strategy, paper settings, scale, label layout, and map inclusion remain unresolved. Any map inclusion must account for the existing [Web map scope](0013-web-edition-map-scope.md), attribution, and provider constraints; local PDF generation does not imply an [offline-first Web app](0022-web-edition-not-offline-first.md).
