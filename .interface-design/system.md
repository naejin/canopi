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
- Right: language select (10px uppercase) + theme toggle (sun/moon SVG) + window controls
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
- Search-first: full-width search input at top, filter toggle icon (funnel) right
- Filter drawer: collapsible below search, max-height 280px, scrollable
- Plant rows: compact (38px estimated), two lines:
  - Line 1: *botanical name* + common name (inline, baseline-aligned)
  - Line 2: colored tags separated by `·` (family=brown, hardiness=blue, height=stone, stratum=ochre, edible=moss)
- Row actions (+, star) appear on hover only
- Whole row is draggable to canvas
- Background: `--color-bg` (parchment, matches canvas area)

### Learning Panel
- Placeholder: centered book icon + "Coming soon" + description
- Background: `--color-bg`

### Drag Handle (panel resize)
- 1px wide, uses `--color-border` — IS the border between canvas and panel
- Hover: expands to 2px, shows `--color-accent`
- Hit target: 9px wide via `::before` pseudo-element
