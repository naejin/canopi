---
status: accepted
---

# Shared Canvas PDF export on desktop and Web

Canopi will offer Canvas PDF export for sharing and field printing on Linux, macOS, Windows, and Web Edition through shared browser-compatible print layout and PDF generation, with edition-specific file saving or downloading. Small Designs fit on one page; larger or denser Designs can use an overview plus numbered detail pages focused on selected Zones or Print Areas when needed to preserve paper readability, including a plant-identification legend. The first release focuses on the canvas; Timeline, Budget, and Consortium PDF sections are deferred to later work.

Users choose which Layers appear in the Canvas PDF through print-specific selection. A new print setup initially selects the Layers currently visible on the canvas; users can then change that selection independently in the export preview. These export choices do not change the Design's saved Layer visibility.

The first release offers an optional street-basemap background as a selectable print Layer on all four platforms for Designs with a saved Location. Satellite imagery, terrain contours, and hillshade in PDF are deferred. Web Location editing remains deferred under [ADR 0016](0016-web-edition-omits-geocoding.md).

If required basemap tiles fail to load, Canopi pauses PDF export and offers Retry or Export without map. Continuing requires an explicit user choice; the exporter must not silently produce an incomplete map or remove the background automatically. Both paths preserve the selected pages and physical scales. Export without map removes the background from the export without changing the Design.

A new print setup starts with the overview only, with no Zones preselected for detail pages. The overview covers the full extent of the Design, including areas outside the current view. Canvas pan and zoom do not determine the exported area. Users add detail pages by selecting Zones or drawing Print Areas in the export preview, which shows the resulting page count. Each detail page focuses on one chosen Zone or Print Area. Zone detail views use a rectangular frame around the Zone with some surrounding context, including nearby Plants and paths from the chosen print Layers beyond the Zone boundary. These selections control detail coverage while the overview retains the whole-Design context.

Alongside existing Zones, the first release lets users draw temporary rectangular Print Areas in the export preview. This provides detail coverage even when a Design contains no Zones. Print Areas belong to the export setup and do not create or modify the Design's spatial features.

The first release supports A4 and US Letter paper. Canopi automatically chooses portrait or landscape to minimize page count at the selected scale, with a manual orientation override.

Detail pages offer six initial real-world scale presets: 1:20, 1:50, 1:100, 1:200, 1:500, and 1:1000. Users choose a common detail-page scale for the export and can override it for individual Zones or Print Areas, allowing dense beds and sparse plantings to use different levels of detail. Users can measure Design distances with a ruler when printing at actual size. An oversized Zone or Print Area spans several numbered detail sheets while preserving its chosen scale. The overview fits its page. All pages showing canvas content include a scale bar.

Neighbouring sheets covering the same Zone or Print Area overlap slightly by default and show neighbouring page references at their adjoining edges. This repeats context to help users follow paths and planting rows between sheets, at the possible cost of additional pages.

Canvas PDF renders authored Annotation text and explicitly Pinned Plant Names from the selected print Layers regardless of canvas zoom. The interactive canvas's zoom-dependent text fading does not suppress this text in the PDF. The Design's text and pinning choices remain unchanged.

Each detail page uses a wide canvas column beside a narrower plant-identification legend column with readable text. The legend is limited to the Species shown on that page, reflecting the Plant Symbols and colours used there. Each entry shows the Common Name in the selected language when available; otherwise it shows the full Canonical Name. Only one name is shown, to conserve column space. Detail-page coverage accounts for the legend column's space while preserving the chosen physical scale, which may require more detail sheets. Export does not add a species code beside every Plant by default, to avoid clutter in dense plantings.

When no detail pages are selected, the overview uses the same canvas-and-legend layout and naming policy as detail pages. The whole Design fits into the available canvas column, and the legend covers the Species shown on that overview. When detail pages are included, the overview serves as a navigation page: numbered outlines show the coverage of each detail sheet, labelled with that sheet's page number. Species legends belong to the detail sheets and any linked continuation pages.

If a Species list cannot fit its legend column at a readable size, the export preview offers clearly linked legend continuation pages as an explicit user option. The narrow column remains the normal layout; continuation pages are offered only for overflow and are not added automatically. Each continuation identifies the overview or detail page whose legend it continues. Added pages count in the preview's total, and overview navigation and neighbouring-sheet references use the resulting page numbers.

**Consequences**:
Including Web Edition in the first release makes consistent print output a shared capability and accepts the additional browser testing, memory, and asset-loading work. Layout and PDF generation must work within the [static Web bundle](0012-web-edition-static-app-bundle.md), while saving and downloading follow the [compile-time platform adapter boundary](0021-web-edition-compile-time-adapters.md). Canvas PDF is derived from the Design's existing authorities and does not become another editable Design model or replace `.canopi` persistence.

Canvas PDF preserves the Design's chosen Plant Symbols and Plant Colors, including when different Species share the same appearance. The exporter must not automatically substitute symbols or colours to distinguish Species, even only in the PDF. For each overview or detail page with a plant-identification legend, the export preview flags distinct Species in that page's canvas view that share identical Plant Symbols and Plant Colors, including Species whose legend entries continue on another page. This ambiguity notice does not itself block export and makes no automatic changes; users can return to the Design to edit plant presentation themselves or proceed with export.

This decision revises the restriction on new PDF export in [ADR 0011](0011-remove-design-report-export-and-display-modes.md) and supersedes [ADR 0019](0019-web-edition-canopi-export-only.md) by adding Canvas PDF alongside `.canopi` download in Web Edition. The previous structured Design Report implementation and its Rust `printpdf` choice remain retired; ADR 0011's plant-presentation decisions remain in force. PNG, SVG, CSV, Diagnostic Bundle export, and native file-management flows remain outside the approved Web export scope; Saved Object Stamp portability still requires its own decision. Timeline, Budget, and Consortium PDF sections are release deferrals, not permanent exclusions.

Printed basemaps must retain required attribution and use a provider-compatible export path within the [Web map scope](0013-web-edition-map-scope.md). Current interactive tile use does not establish suitability for the planned print coverage and resolution. Local PDF generation does not imply an [offline-first Web app](0022-web-edition-not-offline-first.md).

This records an approved direction; the shared Canvas PDF feature is not implemented yet. The initial default scale remains unresolved. Printed examples must validate text and symbol readability and inform the default scale and column widths. The PDF library, vector/raster strategy, paper defaults, margins, overlap size, Zone context padding, handling of declined legend continuations, and validation of the print map source and rendering approach also remain unresolved.
