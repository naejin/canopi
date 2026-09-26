# Catalog and details

Read the [design system](../system.md) first. Catalog data, filters and translations: [species catalog guide](../../docs/guides/species-catalog.md). Canvas boards: Catalog, CatalogFilters, SpeciesDetail, CatalogDark.

## Plant catalog

- The finder at the top ("Search 175,473 species"), then active filters as removable tokens (neutral fill, "Remove filter: …"), then "Add filter".
- Add filter opens a popover anchored under the chip: a search over filters and the filter categories from the Species Catalog Filter catalog (never a hard-coded list): Climate and hardiness, Size and form, Light, Soil and water, Uses, Stratum and succession, Ecology, Risks. A category opens its choices beside the popover (checkboxes, ranges, lists) with Clear; choices apply as they are made.
- A result line with the count, a Sort dropdown (Name, Height, Hardiness) and Clear filters.
- Rows: glyph · common name over italic scientific name over a quiet facts line (form, height, hardiness) · code when the species is in this Design · Place (on the active row) · favourite star (filled ochre when on). The row body opens details and drags onto the map. A hint explains that codes mark species already in the Design.
- Desktop and Web keep separate list and detail compositions around the shared workbench.

## Species detail

- Back (left of the title), common name title, italic scientific subtitle aligned with the title, favourite star, close.
- Photo (3:2, quiet placeholder when none), family and genus, other names in the UI language, the Design symbol and colour with the code.
- Facts grid: height, width, hardiness (with its zone system, "USDA 4 · to −30 °C"), light, soil, growth and lifespan, stratum, succession.
- Uses and Ecology as read-only tags (not chips), from the same taxonomy as the filters.
- Collapsible sections in designer order with chevrons and `aria-expanded`; null fields and empty sections do not render.
- Footer: "N in this Design", Select on map, Place (primary).

## Photos

3:2 frame with `--radius-lg`; shimmer while loading; failed and missing states keep the frame. Arrows and dots follow the icon-only rules. Desktop loads from the Rust image cache (asset protocol scoped to the cache), Web from catalog metadata.
