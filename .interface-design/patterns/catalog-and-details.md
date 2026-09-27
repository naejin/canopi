# Catalog and details

Read the [design system](../system.md) first. Catalog data, filters and translations: [species catalog guide](../../docs/guides/species-catalog.md). Canvas boards: Catalog, CatalogFilters, SpeciesDetail, CatalogDark.

## Plant catalog

- Header "Plant catalog" with close (`DockPanelHeader`), then the finder (`PlantFinder`: "Search by common or scientific name", Ctrl F key cap). It searches the catalog, not the list in memory, and the line under the list says what it searched ("Searched common names in English, scientific names, families and uses").
- Quick filters as pressed toggles: Edible (edibility 3+), Nitrogen fixer, Trees, Shrubs, each shown only when the edition serves that filter. Then "Filters (n)", a disclosure (`aria-expanded`) holding every filter row from the Species Catalog Filter catalog (never a hard-coded list) and, on Desktop, More filters. Filters are collapsed by default.
- Active filters as removable tokens (neutral fill, "Remove filter: …").
- A result line with the count, a Sort dropdown (Recommended, Name, Height, Edibility; Web: Recommended, Name) and Clear filters. Sort hides while a search ranks by relevance. The count is grouped for the interface language and agrees in number ("175,473 species", "175 473 espèces", "1 species"); a search with more pages reads "50+ species".
- Rows (62 px, one line each): glyph (the Design's symbol and colour when the species is in this Design, otherwise a muted glyph for its growth habit) · common name (600) over italic scientific name (`lang="la"`) over a quiet facts line (form, height, USDA hardiness, edibility) · code when the species is in this Design · Place (shown on the active row, always in the tab order) · favourite star (filled ochre when on). The row body is the Details button and drags onto the map. Search matches are marked. "Codes appear on species already in this Design." shows under the list when the Design has plants.
- Empty states say why: no match for the text, the filters or both (with Clear filters), a one-letter search, or a catalog that could not load (Retry).
- Both editions wrap the same list (`CatalogBrowser`); header, detail and Favorites stay per edition.

## Species detail

- Back (left of the title), common name title, italic scientific subtitle aligned with the title, favourite star, close.
- Photo (3:2, quiet placeholder when none), family and genus, other names in the UI language, the Design symbol and colour with the code.
- Facts grid: height, width, hardiness (with its zone system, "USDA 4 · to −30 °C"), light, soil, growth and lifespan, stratum, succession.
- Uses and Ecology as read-only tags (not chips), from the same taxonomy as the filters.
- Collapsible sections in designer order with chevrons and `aria-expanded`; null fields and empty sections do not render.
- Footer: "N in this Design", Select on map, Place (primary).

## Photos

3:2 frame with `--radius-lg`; shimmer while loading; failed and missing states keep the frame. Arrows and dots follow the icon-only rules. Desktop loads from the Rust image cache (asset protocol scoped to the cache), Web from catalog metadata.
