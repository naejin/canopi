# Canopi Design System

## Direction: Field Notebook + Dense Professional Tool

A permaculture designer at their desk, planning a food forest. The interface feels like a well-loved field notebook — parchment surfaces, ink text, pencil-line borders. Dense and capable, like a professional drafting tool. Not a toy garden app.

**The key rule:** Green lives on the canvas where plants are. The UI chrome is soil, bark, parchment, ochre. The tool is the potting shed. The canvas is the garden.

## Intent

**Who:** A permaculture designer — someone who understands strata, succession, companion planting. They're at a desk or kitchen table, planning their growing season. They want precision and density, not hand-holding.

**What they do:** Draw zones, place plants, understand spatial relationships. The verbs are: draw, place, search, measure, save.

**Feel:** Warm like a field notebook. Dense like a drafting table. Precise like a plant label. Not sterile, not playful — grounded.

## Palette

| Token | Value (Light) | Value (Dark) | Why |
|-------|--------------|-------------|-----|
| `--color-primary` | `#A06B1F` ochre | `#C89B4A` | Brass highlight — the color you'd mark important things in a notebook |
| `--color-bg` | `#F0EBE1` parchment | `#1E1B17` charcoal parchment | Aged paper, not clinical white |
| `--color-surface` | `#FAF7F2` linen | `#282420` dark linen | Fresh page — one step lighter than parchment |
| `--color-text` | `#2C2418` ink | `#E5DFD4` cream ink | Warm dark brown, not black |
| `--color-text-muted` | `#7D6F5E` graphite | `#A89A88` | Pencil marks, faded (brighter in dark for icon visibility) |
| `--color-border` | `rgba(60,45,30,0.12)` | `rgba(200,180,150,0.12)` | Ruled pencil lines, warm and transparent |
| `--canvas-bg` | `#EDE8DE` | `#1A1714` | Slightly warmer than chrome — the garden surface |

## Depth Strategy: Borders Only

Field notebooks are flat. No dramatic shadows. Structure comes from warm ruled lines.
- Shadows exist but are whisper-quiet and warm-tinted (`rgba(44, 36, 24, ...)`)
- Borders are the primary structural tool — transparent warm brown
- Surface shifts are subtle (parchment → linen = tiny lightness jump, same hue)

## Typography

Inter, but tighter than default.
- `--line-height: 1.45` (not 1.5 — denser)
- Labels at 11px for compact controls
- Professional density throughout

## Spacing

4px base, used aggressively tight. Dense but not cramped.

## Radius

Slightly sharper than typical — technical, precise.
- `--radius-sm: 3px` / `--radius-md: 5px` / `--radius-lg: 7px`

## Layout

```
[toolbar 38px] [───── canvas ─────] [panel?] [bar 36px]
   left              center          slides in   right
   tools            workspace        plant DB    leaf + book
```

- **Left toolbar**: 38px, drawing tools only (Select, Hand, Rectangle, Text + Grid/Snap/Rulers toggles). Active: 2px ochre left bar.
- **Right panel bar**: 36px, always visible. Icons toggle sliding panels. Active: 2px ochre right bar.
- **Right panels**: plant search, learning (future). Slide in between canvas and panel bar. Resizable via drag handle.
- **Title bar**: 36px. Logo left, file name center-left, lang/theme controls + window buttons right.
- **No activity bar** — merged into panel bar.
- **No status bar** — lang/theme moved to title bar.

## Signature

The **strata separation** — the UI chrome (potting shed) is a completely different color world from the canvas (garden). No green in the chrome. This is the one thing that makes Canopi not look like every other garden app.

## Semantic Colors

Earthy, not neon:
- Success/growth: `#5A7D3A` moss green
- Warning: `#B8860B` dark goldenrod
- Danger: `#B5432A` terracotta red
- Plant attributes use naturally-occurring colors (moss, lavender, pond teal, amber, stone, winter sky, bark)

## Patterns

### Title Bar
- 36px tall, background `--color-bg` (blends with canvas area)
- Left: logo (16px) + file name (when saved)
- Right: locale picker (custom dropdown, 3-column grid) + theme toggle (sun/moon SVG) + window controls
- Theme: light/dark only (no system option) — simple toggle

### Welcome Screen
- Logo (96px), no text headings, centered vertically
- Two action buttons: primary (ochre) + secondary (surface with border)
- Recent files section below with document icon, name, relative date
- Buttons have warm shadow, subtle lift on hover

### Canvas Workspace
- Toolbar left (38px): 4 tools + separator + 3 view toggles
- Zoom controls floating bottom-right: semi-transparent, fades in on hover
- Scale bar bottom-left: uses `--color-text-muted` for subtlety
- No compass for MVP (disabled, code on disk)
- Zoom displays relative to initial view (100% = fit 100m in viewport)
- Rulers: background `--canvas-ruler-bg` (close to canvas bg, no harsh L-frame)

### Panel Bar (right edge)
- 36px wide, always visible when canvas is active
- Two icons: leaf (plant DB), book (learning/knowledge)
- Active state: ochre right border + ochre icon color
- Clicking toggles the corresponding panel

### Plant Search Panel
- Search-first: full-width search input at top
- FilterStrip: always-visible compact controls below search. 6 rows:
  - Stratum: multi-select `FilterChip` pills (teal `--color-nitrogen`)
  - Sun: multi-select `FilterChip` pills (amber `--color-sun`)
  - Hardiness: `RangeSlider` (1–13)
  - Edibility: `ThresholdSlider` (0–5 with tick marks)
  - Height: `RangeSlider` (0–50m)
  - N₂ Fixer: toggle switch (24×14px)
- Each row: label 52px right-aligned + control flex-1. All 24px min-height
- "More filters ›" text link + badge count at bottom, 58px left indent
- ActiveChips strip: horizontal wrap of dismissable `FilterChip` pills, 58px left indent matching controls. Shows all active filters from both strip and "More" panel. Border-top + border-bottom separation
- "More Filters" panel: slides in as overlay over results. Header + search + 8 collapsible categories with 2px colored left borders matching detail card sections. Boolean fields: inline checkbox. Categorical: expandable chip picker (lazy-loaded). Numeric: expandable range slider. "Done ›" text link in footer
- Plant rows: compact, two lines:
  - Line 1: **common name** (12px, 500, `--color-text`) + *botanical name* (12px, 400, italic, `--color-text-muted`). Common name leads as the scan target. When no common name, botanical renders alone
  - Line 2: colored tags separated by `·` (family=brown, hardiness=blue, height=stone, stratum=ochre, edible=moss). Heights rounded to 1 decimal max. Stratum values mapped via i18n keys
- Row actions (+, star) appear on hover only
- Whole row is draggable to canvas
- Background: `--color-bg` (parchment, matches canvas area)

### FilterChip
- Pill shape (`--radius-full`), 20px height, 11px text, 500 weight
- Inactive: `--color-surface` background, transparent border, `--color-text-muted` text
- Active: category color 12% opacity background (via `color-mix`), category color border + text
- Clickable: cursor pointer, hover shows active-style background
- Dismissable: `×` button appears, 14px circle, opacity 0.6 → 1.0 on hover
- Used everywhere: filter strip, active chips strip, "More Filters" value pickers

### Slider Controls
- Inline layout: value/bound label — track — value/bound label (all one 24px row)
- Track: 2px `--color-border` line, fill in `--color-primary`
- Thumb: 12px circle, `--color-primary`, 2px `--color-surface` border, `var(--shadow-sm)`
- WebKitGTK: `margin-top: -6px` on thumb (browser places top edge at center, not center)
- RangeSlider: two overlapping inputs, low z-index 1 / high z-index 2
- ThresholdSlider: tick marks (1px × 8px) positioned in 6px-padded ticks container for thumb alignment

### Plant Detail Card
- Header: botanical name (italic), common name, secondary names (10px, muted, 0.75 opacity, max 2 shown + "+N more"), family · genus, back button, favorite star
- Photo carousel at top of scrollable body (see Photo Carousel pattern below)
- Dimensions section always open (h3 title, no toggle)
- 14 collapsible sections below, ordered by designer decision flow: Life Cycle → Uses → Light → Soil → Ecology → Growth Form → Propagation → Fruit & Seed → Risk → Leaf → Reproduction → Notes → Related Species → Identity
- Each section: 3px left accent border (semantic color), uppercase 10px title with icon + chevron, `--color-bg` header, content in `--color-surface` body
- Accent color zones: taxonomy=bark brown, physical form=teal, cultivation=moss green, harvest=amber, biology=lavender, caution=terracotta, reference=graphite
- Null fields hidden — empty sections don't render
- Field types: `Attr` (label + value), `BoolChip` (✓/✗ pill), `NumAttr` (value + unit), `TextBlock` (label + paragraph)
- All categorical values translated via `translated_values` table. All labels via i18n keys

### Custom Dropdown
- No native `<select>` — breaks the field notebook aesthetic
- Trigger: button with current value + `›` chevron (rotates 90° on open)
- Menu: `--color-surface` background, `--color-border` border, `--radius-md`, `--shadow-md`
- Items: `--color-text-muted`, hover `--color-bg`, active `--color-primary` with `--color-primary-bg`
- Close: click outside (`pointerup` listener — not `mousedown`, avoids catching opening click) or item selection
- ARIA: `aria-expanded`, `aria-haspopup="listbox"`, `role="option"`, `aria-selected`
- See `LocalePicker` in `TitleBar.tsx` as reference implementation

### Collapsible Section
- Toggle button: uppercase 10px label, 600 weight, `--color-text-muted`, 0.06em letter-spacing
- Icon before label (single character/emoji), chevron `›` after (right-aligned, rotates 90° on open)
- Header: `--color-bg` background, border-bottom on open
- Body: `--color-surface`, padding `--space-3`, flex column with `--space-3` gap
- Animation: chevron `transition: transform 0.15s ease`
- Used in: detail card sections, filter drawer sections

### Learning Panel
- Placeholder: centered book icon + "Coming soon" + description
- Background: `--color-bg`

### Favorites Panel
- Header: uppercase 10px title (600 weight, `--color-text-muted`, 0.06em tracking) + ochre count badge (`--color-primary` bg, `--color-bg` text, `--radius-full`)
- List: reuses `PlantRow` component. Clicking opens detail card inline (same `detailHidden`/`detailVisible` pattern as PlantDbPanel)
- Empty state: star icon (`--color-primary`, 0.3 opacity), title + hint text, upper-third positioning (not dead-centered)
- Background: `--color-bg`

### Photo Carousel
- 3:2 aspect ratio, `--radius-lg` border, `--color-border` outline
- Shimmer loading state: gradient between `--color-surface` and `--color-bg`
- Nav arrows: transparent 32×48px hit targets, chevron character via `text-shadow`, visible on container hover (0.8 → 1.0 opacity)
- Dot indicators: 8px, 6px gap, `--color-border` inactive, `--color-primary` active with `scale(1.15)`. Minimum size for interactive elements
- Source badge: bottom-right, 9px uppercase, `--color-text` with 0.55 opacity, `pointer-events: none`
- Placeholder: subtle icon (`--color-border`, 0.6 opacity), same 3:2 aspect ratio
- Images served as base64 data URLs from Rust image cache (asset protocol not scoped)

### Display Mode Controls
- Floating toolbar at bottom-left, matches ZoomControls surface treatment: `--canvas-ruler-bg` bg, `1px solid --color-border`, `--radius-md`, `opacity: 0.85` → `1` on hover, `100ms ease` transition
- Two custom dropdowns (DISPLAY + COLOR BY) separated by 1px divider, `z-index: 20`
- Dropdown menu opens upward (above controls), `menuIn` keyframe animation (120ms), Escape closes + returns focus
- Options: bare noun labels (not "By Stratum", just "Stratum")

### Display Legend
- Floating card above display controls (`bottom: 44px`), `z-index: 19` (below controls)
- Only visible when `plantDisplayMode === 'color-by'`
- `legendIn` keyframe animation (150ms), `prefers-reduced-motion` respected
- Entries: 10px color dots + 11px labels, `--space-1` gap, scrollable at 200px max-height
- All labels use `t()` i18n calls — translates when locale changes

### Plant Tooltip
- HTML `<div>` overlay on Konva stage container (not a Konva node), `pointer-events: none`
- `--color-surface` bg, `--color-border` border, `--radius-sm`, `--shadow-md`, `z-index: 50`
- Content: common name (12px/600), botanical name (11px/italic/muted), stratum attribute (10px/muted)
- Positioned via `stage.getAbsoluteTransform()` — world-to-screen coordinate conversion
- Built with safe DOM methods (`createElement`, `textContent`) — no `innerHTML`
- Appears immediately on `mouseover`, hides on `mouseout` with `e.target === stage` early return guard

### Drag Handle (panel resize)
- 1px wide, uses `--color-border` — IS the border between canvas and panel
- Hover: expands to 2px, shows `--color-accent`
- Hit target: 9px wide via `::before` pseudo-element
