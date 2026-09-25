# Catalog and details

Read the [design system](../system.md) first. Catalog data, filters and translations: [species catalog guide](../../docs/guides/species-catalog.md).

## Species Catalog

- Search first: a full-width search input at the top, on `--color-bg` like the canvas area.
- Filter region: the always-visible `FilterStrip` rows plus the `ActiveChips` strip. Natural height; on very short windows the combined region scrolls at `max-height: min(45vh, 360px)` so results never vanish.
- Filter rows come from the Species Catalog Filter catalog, never a hard-coded list. Each row: a label column of 86px (at most 36 % of the row, wrapping at word boundaries) and a flexible control; 24px minimum height; choice chips wrap naturally without clipping or per-row scrolling.
- "More filters ›" link with a count badge at the bottom of the strip, indented 58px. The More Filters overlay slides over results: header, search, eight collapsible categories with 2px coloured left borders, inline checkboxes for booleans, lazy chip pickers for categories, range sliders for numbers, and a "Done ›" link.
- `ActiveChips`: dismissable `FilterChip` pills for every active filter, indented 58px, with top and bottom borders, inside the same height cap.
- Terms: filter row (always visible), filter choice (one chip), filter category (a More Filters group).
- Plant rows, two lines: common name (12px, 600) then italic muted botanical name (botanical alone when no common name); then tags separated by `·` (family brown, hardiness blue, height stone, stratum ochre, edible moss), heights to at most one decimal, strata via i18n keys. Add and favourite actions appear on hover; the whole row drags to the canvas.
- Desktop and Web keep separate list and detail compositions around the shared workbench because their fields, paging, images and detail depth differ. Favorites share the name matcher and detail focus return. Back restores the initiating action (or the search field if that row was filtered out) without unmounting or scrolling the list.

## FilterChip

Pill (`--radius-full`), 20px tall, 11px 600 text. Inactive: `--color-surface`, transparent border, muted text. Active: the category colour at 12 % (`color-mix`) with that colour for border and text; hover previews the active style. Dismissable chips add a 14px `×` button (opacity 0.6 to 1 on hover). Used in the strip, active chips and More Filters pickers.

## Species detail

- Header: italic botanical name, common name, up to two secondary names (10px, muted) with "+N more", family · genus, Back and favourite star.
- Photo carousel at the top of the scrolling body, then an always-open Dimensions section, then twelve collapsible sections in designer order: Life Cycle, Uses, Light & Climate, Soil, Ecology, Growth Form, Propagation, Fruit & Seed, Risk & Distribution, Leaf, Reproduction, Identity.
- Each section has a 3px semantic left border (taxonomy bark brown, form teal, cultivation moss, harvest amber, biology lavender, caution terracotta, reference graphite), a `--color-bg` header with icon and chevron, and a `--color-surface` body.
- Null fields and empty sections do not render. Field types: `Attr`, `BoolChip`, `NumAttr`, `TextBlock`. Categorical values come from the translated-values table; labels from i18n keys.

## Photo carousel

- 3:2 frame with `--radius-lg` and a `--color-border` outline; shimmer between `--color-surface` and `--color-bg` while loading. Loading and failed states keep the frame.
- Navigation arrows: transparent 32×48px targets with a shadowed chevron, shown on container hover. Dots: 8px, 6px gap, `--color-border` inactive, `--color-primary` active.
- No photo: a small quiet icon with `--space-3` padding and `--control-size-window` minimum height.
- Desktop loads images from the Rust image cache through Tauri's asset protocol (scoped to the cache directory) with a remote fallback; Web loads the remote hero image from catalog metadata.
