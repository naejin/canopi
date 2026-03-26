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
| `--color-text-muted` | `#7D6F5E` graphite | `#9A8D7D` | Pencil marks, faded |
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

- Activity bar: 44px wide (compact)
- Status bar: 26px tall
- Canvas toolbar: 38px wide
- Toolbar active indicator: ochre left bar (not green)

## Signature

The **strata separation** — the UI chrome (potting shed) is a completely different color world from the canvas (garden). No green in the chrome. This is the one thing that makes Canopi not look like every other garden app.

## Semantic Colors

Earthy, not neon:
- Success/growth: `#5A7D3A` moss green
- Warning: `#B8860B` dark goldenrod
- Danger: `#B5432A` terracotta red
- Plant attributes use naturally-occurring colors (moss, lavender, pond teal, amber, stone, winter sky, bark)

## Patterns

### Welcome Screen
- Logo (96px), no text, two action buttons + recent files
- Primary button: ochre with warm shadow
- Recent files: compact list with document icon, name, relative date

### Canvas Workspace
- Minimal toolbar (4 tools + 3 toggles)
- Zoom controls floating bottom-right
- No bottom panel, no layer panel (pruned for MVP)

### Activity Bar
- 2 items: Canvas (pencil), Plant DB (leaf)
- Active: ochre left border + ink-colored icon + subtle warm bg
