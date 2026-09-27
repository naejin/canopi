# Catalog and details

Read the [design system](../system.md) first. Catalog data, filters and translations: [species catalog guide](../../docs/guides/species-catalog.md). Canvas boards: Catalog, CatalogFilters, SpeciesDetail, CatalogDark.

## Plant catalog

- Header "Plant catalog" with close (`DockPanelHeader`), then the finder (`PlantFinder`: "Search by common or scientific name", Ctrl F key cap). It searches the catalog, not the list in memory, and the line under the list says what it searched ("Searched common names in English, scientific names, families and uses").
- Quick filters as pressed toggles: Edible (edibility 3+), Nitrogen fixer, Trees, Shrubs, each shown only when the edition serves that filter. Then "Filters (n)", a disclosure (`aria-expanded`) holding every filter row from the Species Catalog Filter catalog (never a hard-coded list) and, on Desktop, More filters. Filters are collapsed by default.
- Active filters as removable tokens (neutral fill, "Remove filter: …").
- A result line with the count, a Sort dropdown (Recommended, Name, Height, Edibility; Web: Recommended, Name) and Clear filters. Sort hides while a search ranks by relevance. The count is grouped for the interface language and agrees in number ("175,473 species", "175 473 espèces", "1 species"); a search with more pages reads "50+ species".
- Rows (62 px, one line each): glyph (the Design's symbol and colour when the species is in this Design, otherwise a muted glyph for its growth habit) · common name (600; a species with no name in the interface language shows its English name marked "(en)", as in Favorites and every species row) over italic scientific name (`lang="la"`) over a quiet facts line (form, height, USDA hardiness, edibility) · code when the species is in this Design · Place (shown on the active row, always in the tab order) · favourite star (filled ochre when on). The row body is the Details button and drags onto the map. Search matches are marked. "Codes appear on species already in this Design." shows under the list when the Design has plants.
- Empty states say why: no match for the text, the filters or both (with Clear filters), a one-letter search, or a catalog that could not load (Retry).
- Both editions wrap the same list (`CatalogBrowser`); header, detail and Favorites stay per edition.

## Species detail

Both editions share the presentation (`components/species-detail/`: `SpeciesDetailLayout`, `FactsGrid`, `PhotoViewer`); each loads its own data (Desktop `PlantDetailCard` over the plant DB, Web `WebSpeciesDetail` over the reduced catalog).

- Header: Back (focused when the detail opens, returns focus to the row that opened it), favourite star and Close (closes the panel, focus to its rail button). Under them the glyph (the Design's symbol and colour when the species is in this Design, otherwise the muted habit glyph), the common name (Literata 600) over the italic scientific name (`lang="la"`) and family, and the code when the species is in this Design.
- A species without a name in the interface language shows its English name marked "(en)", as the PDF key does; without either, the scientific name is the title.
- Photos (below), then other names in the interface language ("Also called", more than four fold behind "Show all n").
- Key facts, a two-column grid that always shows every cell, with "Not recorded" for a gap: habit, stratum, height, width, hardiness ("USDA 3–8 · to −40 °C", the temperature being the lower bound of the coldest zone), light, soil (texture and pH), moisture, drought tolerance, growth (rate, age at maturity, lifespan), succession, then the edible, medicinal and other-uses ratings ("5 of 5"). Numbers and units go through `Intl`. Web shows only the facts its catalog carries (habit, life cycle, climate zones).
- Uses as read-only tags (not chips) from the catalog's use categories.
- Collapsible sections in designer order (Use notes, Life cycle, Light and climate, Soil, Ecology, Growth form, Propagation, Fruit and seed, Leaf, Reproduction, Risk and distribution, Identity) with a chevron and `aria-expanded`; closed until opened, shown in full when open; unrecorded fields and empty sections do not render.
- Footer: "N in this Design · Select them · Zoom to them" when the species is in the open Design (the plant finder's map actions), and Place (primary).

## Photos

3:2 frame with `--radius-lg`; shimmer while loading; a photo that fails keeps the frame and says so. Previous and next arrows sit on the photo and dots under it (Left, Right, Home and End move between photos when focus is in the viewer); the line under the photo names the credit, the source and the license, and says "not recorded" for what the catalog lacks. Desktop loads from the Rust image cache (asset protocol scoped to the cache) and names the source from the photo's host (Wikimedia Commons, iNaturalist), since the plant DB records no credit or license; Web shows the catalog metadata and links the source page. A species without photos shows a small quiet placeholder and "No photos available".
