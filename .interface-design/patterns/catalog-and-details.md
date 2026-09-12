# Catalog and details

Read the [design contract](../system.md) first.

## Species Catalog Workbench
- Search-first: full-width search input at top
- Filter region: contains the always-visible `FilterStrip` rows and the `ActiveChips` strip. Natural height by default; in extreme small-height cases, the combined region scrolls vertically at `max-height: min(45vh, 360px)` so results never disappear entirely.
- FilterStrip: always-visible compact controls below search. Filter rows come from the Species Catalog Filter catalog; do not hard-code the row list in component layout. Example rows may include Climate Zone, Sun, Habit, Life Cycle, Edibility, Woody, or N₂ Fixer depending on catalog metadata.
- Each filter row: left-aligned label in an 86px column (capped at 36% of the row) + control flex-1. Labels wrap at word boundaries, breaking long words only when necessary. Rows are 24px min-height, `height: auto`, and grow or shrink with the available width. Choice chips form a natural flex-wrapping ribbon rather than equal-width grid tracks. Filter choices remain visible without clipping or per-row scrolling.
- "More filters ›" text link + badge count at bottom of the FilterStrip, 58px left indent
- ActiveChips strip: horizontal wrap of dismissable `FilterChip` pills, 58px left indent matching controls. Shows all active filters from both strip and "More" panel. Border-top + border-bottom separation. It participates in the combined filter-region height cap rather than owning a separate scroll surface.
- Terms: use `filter row` for always-visible controls, `filter choice` for an individual chip/option inside a row, and `filter category` only for More Filters drawer groups such as Climate & Soil or Growth.
- "More Filters" panel: slides in as overlay over results. Header + search + 8 collapsible categories with 2px colored left borders matching detail card sections. Boolean fields: inline checkbox. Categorical: expandable chip picker (lazy-loaded). Numeric: expandable range slider. "Done ›" text link in footer
- Plant rows: compact, two lines:
  - Line 1: **common name** (12px, 600, `--color-text`) + *botanical name* (12px, 400, italic, `--color-text-muted`). Common name leads as the scan target. When no common name, botanical renders alone
  - Line 2: colored tags separated by `·` (family=brown, hardiness=blue, height=stone, stratum=ochre, edible=moss). Heights rounded to 1 decimal max. Stratum values mapped via i18n keys
- Row actions (+, star) appear on hover only
- Whole row is draggable to canvas
- Background: `--color-bg` (parchment, matches canvas area)


## FilterChip
- Pill shape (`--radius-full`), 20px height, 11px text, 600 weight
- Inactive: `--color-surface` background, transparent border, `--color-text-muted` text
- Active: category color 12% opacity background (via `color-mix`), category color border + text
- Clickable: cursor pointer, hover shows active-style background
- Dismissable: `×` button appears, 14px circle, opacity 0.6 → 1.0 on hover
- Used everywhere: filter strip, active chips strip, "More Filters" value pickers


## Plant Detail Card
- Header: botanical name (italic), common name, secondary names (10px, muted, 0.75 opacity, max 2 shown + "+N more"), family · genus, back button, favorite star
- Photo carousel at top of scrollable body (see Photo Carousel pattern below)
- Dimensions section always open (h3 title, no toggle)
- 12 collapsible sections below, ordered by designer decision flow: Life Cycle → Uses → Light & Climate → Soil → Ecology → Growth Form → Propagation → Fruit & Seed → Risk & Distribution → Leaf → Reproduction → Identity
- Each section: 3px left accent border (semantic color), section header pattern with icon + chevron, `--color-bg` header, content in `--color-surface` body
- Accent color zones: taxonomy=bark brown, physical form=teal, cultivation=moss green, harvest=amber, biology=lavender, caution=terracotta, reference=graphite
- Null fields hidden — empty sections don't render
- Field types: `Attr` (label + value), `BoolChip` (✓/✗ pill), `NumAttr` (value + unit), `TextBlock` (label + paragraph)
- All categorical values translated via `translated_values` table. All labels via i18n keys


## Photo Carousel
- 3:2 aspect ratio, `--radius-lg` border, `--color-border` outline
- Shimmer loading state: gradient between `--color-surface` and `--color-bg`
- Nav arrows: transparent 32×48px hit targets, chevron character via `text-shadow`, visible on container hover (0.8 → 1.0 opacity)
- Dot indicators: 8px, 6px gap, `--color-border` inactive, `--color-primary` active with `scale(1.15)`. Minimum size for interactive elements
- No-photo placeholder: compact subtle icon with `--space-3` padding and a `--control-size-window` minimum height. Loading and failed-image states retain the photo frame; loaded photos keep the 3:2 aspect ratio.
- Desktop images use paths from the Rust image cache, converted through Tauri's asset protocol scoped to the app-data image-cache directory, with remote URL fallback. Web Edition loads a remote hero image from catalog metadata; it has no native image cache.
