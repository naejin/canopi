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
| `--color-bg` | `#E6E0D4` warm bark | `#1C1915` charcoal parchment | The desk surface — darker chrome that recedes behind the canvas |
| `--color-surface` | `#EDE8DD` lighter desk | `#262220` dark linen | Panel interiors — one step lighter than bg |
| `--color-text` | `#2C2418` ink | `#E8E2D8` cream ink | Warm dark brown, not black |
| `--color-text-muted` | `#6B5F4E` graphite | `#B0A292` | Pencil marks — meets 4.5:1 contrast against surface in both themes |
| `--color-border` | `rgba(60,45,30,0.16)` | `rgba(200,180,150,0.16)` | Ruled pencil lines — warm, subtle but perceptible |
| `--canvas-bg` | `#F6F2EA` cream page | `#151210` deep charcoal | The brightest surface in light, the darkest in dark — the workspace paper |

### Surface hierarchy (light theme)

The canvas is the paper. The chrome is the desk. The desk is darker so the paper stands out.

```
brightest → canvas (#F6F2EA)  — the blank page
           → rulers (#EDE8DD) — transition zone
           → surface (#EDE8DD) — panel interiors
           → bg (#E6E0D4)     — the desk frame
darkest
```

Horizontal bars (title bar, canvas bar) use `--color-bg`. Vertical panels (toolbar, layer panel, panel bar) use `--panel-gradient`. The canvas is its own lightest surface.

### Color design rules

- **Text-muted must pass 4.5:1 contrast** against `--color-surface` (the lightest panel background). `#6B5F4E` on `#EDE8DD` is ~4.6:1
- **Canvas is always the lightest surface** in light theme, darkest in dark theme — your eye should go to the workspace first
- **Chrome recedes, canvas dominates** — this is the standard pattern in all professional design tools (Figma, Sketch, Illustrator)
- **Borders at 0.16 opacity** — enough to perceive structure without harsh lines
- **Dark theme zone strokes at 0.65 opacity** — zones must be clearly visible on the dark canvas

## Depth Strategy: Borders Only

Field notebooks are flat. No dramatic shadows. Structure comes from warm ruled lines.
- Shadows exist but are whisper-quiet and warm-tinted (`rgba(44, 36, 24, ...)`)
- Borders are the primary structural tool — transparent warm brown
- Surface shifts are subtle (parchment → linen = tiny lightness jump, same hue)

## Typography

Inter, but tighter than default. `--line-height: 1.45` (not 1.5 — denser).

### Size scale

| Token | Value | Use |
|-------|-------|-----|
| `--text-xs` | 11px | Labels, controls, badges, section headers, compact UI |
| `--text-sm` | 12px | Body text in panels, plant names, descriptions |
| `--text-base` | 13px | Primary content, attribute values |
| `--text-md` | 14px | Panel titles, emphasis |
| `--text-lg` | 16px | Page-level headings |
| `--text-xl` | 20px | Welcome screen, hero text |

**No raw font-size values.** Every `font-size` in CSS must use a `--text-*` token. If a size doesn't fit the scale, use the nearest token — don't invent raw values.

### Weight system: two weights only

The app uses exactly two weights: **400** (regular) for reading, **600** (semibold) for scanning and interacting. Weight 500 is banned — it creates a mushy middle with no clear purpose.

| Role | Size | Weight | Style | Extras | Example |
|------|------|--------|-------|--------|---------|
| **Label** | `--text-xs` | 600 | normal | uppercase, 0.06em tracking, `--color-text-muted` | LAYERS, ZONES, DISPLAY |
| **Name** | `--text-sm` | 600 | normal | `--color-text` | Layer names, plant common names, buttons |
| **Body** | `--text-sm` | 400 | normal | `--color-text` or `--color-text-muted` | Descriptions, tag text, secondary info |
| **Caption** | `--text-xs` | 400 | italic | `--color-text-muted` | Botanical names, keyboard shortcuts |
| **Value** | `--text-xs` | 600 | normal | `font-variant-numeric: tabular-nums` | Zoom %, coordinates, measurements |

**The weight decision is always binary:** is this text something you scan/click (600) or something you read (400)?

### Section Header Pattern

The most-reused typographic pattern in the app. Used for panel headers, filter section titles, collapsible section toggles, layer panel header, and display control labels.

```css
font-size: var(--text-xs);
font-weight: 600;
text-transform: uppercase;
letter-spacing: 0.06em;
color: var(--color-text-muted);
```

**0.06em is canonical** — do not use 0.04em or 0.05em. The tracking is a design decision, not a guess.

## Spacing

4px base, used aggressively tight. Dense but not cramped.

| Token | Value | Use |
|-------|-------|-----|
| `--space-1` | 4px | Tight gaps, icon margins, inline padding |
| `--space-2` | 8px | Standard control gaps, row padding |
| `--space-3` | 12px | Section padding, panel insets |
| `--space-4` | 16px | Card padding, generous insets |
| `--space-6` | 24px | Large section breaks |
| `--space-8` | 32px | Empty state padding |
| `--space-12` | 48px | Hero spacing |

**No raw spacing values.** Every `padding`, `margin`, and `gap` must use a `--space-*` token. The only exceptions are 1-2px structural values (borders, dividers, hit-target offsets) which are visual precision, not spacing.

## Radius

Slightly sharper than typical — technical, precise.

| Token | Value | Use |
|-------|-------|-----|
| `--radius-sm` | 3px | Buttons, inputs, small controls |
| `--radius-md` | 5px | Cards, dropdowns, panels |
| `--radius-lg` | 7px | Map cards, large surfaces |
| `--radius-full` | 9999px | Pills, badges, slider thumbs |

## Transitions

Three timing tiers. Every interactive element must have a transition.

| Duration | Easing | Use |
|----------|--------|-----|
| `80ms ease` | color, background-color, border-color | Hover states, icon color shifts |
| `150ms ease` | transform, layout shifts | Button lift, panel slide, chevron rotation |
| `200ms ease-out` | opacity, visibility | Panel fade-in, legend appear |

Always use `ms` units, never `s`. `prefers-reduced-motion` must disable transitions.

These timings are tokenized in CSS and must be referenced as:
- `--transition-fast`
- `--transition-normal`
- `--transition-enter`

## Controls

All retained rewrite-exit surfaces use four control patterns only:
- **Primary**: filled `--color-primary`, `--color-primary-contrast` text, `--radius-md`, `var(--space-2) var(--space-3)` padding, hover via `--color-primary-hover`
- **Secondary**: `--color-surface` fill, `--color-border` border, `--color-text` text, `--radius-md`, `var(--space-2) var(--space-3)` padding
- **Ghost**: transparent fill, muted text, hover via `--color-control-hover`, `--radius-sm`
- **Icon**: square control using shared `--control-size-*` tokens, transparent fill, `--radius-sm`

Section headers use exactly:
- `font-size: var(--text-xs)`
- `font-weight: 600`
- `text-transform: uppercase`
- `letter-spacing: 0.06em`
- `color: var(--color-text-muted)`

Inputs use exactly:
- `min-height: var(--control-size-md)` unless the context is explicitly compact
- `padding: var(--space-1) var(--space-2)` for compact fields or `0 var(--space-3)` for toolbar/search overlays
- `background: var(--color-surface)`
- `border: 1px solid var(--color-border)` or `var(--color-border-strong)` when the overlay needs stronger separation
- `border-radius: var(--radius-md)`

Context menus use exactly:
- `background: var(--color-surface)`
- `border: 1px solid var(--color-border-strong)`
- `border-radius: var(--radius-md)`
- `box-shadow: var(--shadow-md)`
- `padding: var(--space-1)`
- menu items at `min-height: var(--control-size-md)` with `font-size: var(--text-sm)` and `font-weight: 600`
- hover via `--color-control-hover`, disabled text via `--color-text-muted`

Canvas context menus must be compact, clamp or flip inside the visible canvas, and sit above canvas overlays without covering the app title bar, panels, or editable native controls.

## Component Sizing

These sizes are tokenized and must be reused across retained surfaces.

| Token | Value | Where used |
|---------|------|------------|
| `--title-bar-height` | 36px | App shell |
| `--panel-bar-width` | 36px | Right edge |
| `--panel-width` | 280px | Legacy generic sidebar defaults |
| `--control-size-xs` | 20px | compact badges and close buttons |
| `--control-size-sm` | 24px | zoom buttons, sliders, compact icon controls |
| `--control-size-md` | 28px | standard buttons and inputs |
| `--control-size-lg` | 32px | map overlay actions |
| `--control-size-xl` | 34px | toolbar and panel-bar buttons |
| `--control-size-window` | 44px | window controls |
| `--icon-size-sm` | 12px | inline action icons |
| `--icon-size-md` | 16px | toolbar icons |
| `--icon-size-lg` | 20px | panel-bar icons |
| `--slider-thumb-size` | 12px | opacity, range, threshold sliders |
| `--slider-track-size` | 2px | all sliders |

## Canvas Tool Behavior (Figma/Sketch standard)

All canvas tools must follow these behaviors. They are not optional — they are what users expect from any design tool.

### Drawing tools (Rectangle, Ellipse, Line, future shapes)
- Click+drag creates a live preview shape → mouseup commits the shape
- **Mouse leaves canvas**: shape sticks to the canvas edge, continues tracking the cursor direction along the boundary. Origin, cursor, and edge contact point stay aligned
- **Mouseup outside canvas**: commits shape at the edge-clamped position (does not cancel)
- **Escape during draw**: cancels, removes preview
- **Shift during draw**: constrains proportions (square, circle, 45° angles)
- Cannot select or move existing objects — only the select tool admits object-move gestures
- After committing a shape: tool stays active for the next draw (does not auto-switch to select)
- Additional pointer-downs are ignored while the admitted pointer and Scene edit own the active gesture

### Select tool
- Click empty canvas: deselects all, clears highlights
- Click object: selects it, highlights it
- Shift+click: toggles selection membership
- Click+drag on empty canvas: shows a rubber-band preview and commits intersecting objects on release
- Click+drag on selected object: moves it through a Scene edit transaction owned by the shared gesture controller
- Mouse leaving canvas during rubber-band or move: sticks to edge (same as drawing tools)
- Escape during rubber-band: cancels band
- Delete key: removes selected objects
- The contextual Selection Action Toolbar stays inside the visible canvas with an 8px margin, flips when close to an edge, and stays visually attached to the selected object. Single non-rotatable selections use a close above-selection placement. Rotatable selections keep the Rotation Handle above the object and place the toolbar close below by default.
- Click+drag on a selected Design Object hides the Selection Action Toolbar and Rotation Handle while the drag is active, then restores them after release or cancel using the final selection geometry. Passive hover presentation, including the plant Hover Tooltip, clears when a drag starts and does not reappear until the next passive hover movement.

### Hand/Pan tool
- Click+drag: the shared gesture controller pans the viewport through `CameraController.panBy`
- Space+drag from any tool: temporary pan, returns to previous tool on key release

### Text tool
- Click to place text insertion point (HTML textarea overlay)
- Type to enter text
- Click elsewhere or Enter commits text
- Shift+Enter inserts a line break
- Escape cancels editing and restores the previous text when editing an existing Annotation
- Empty text on commit: discarded

### Plant stamp tool
- Click to place plant at cursor position
- Tool stays active for placing more plants
- Escape clears the selected species (does not force-switch to another tool)

### Event routing rules
- **Gesture ownership**: `SceneInteractionSession` records the active pointer and routes the gesture to the tool adapter, shared gesture controller, or active overlay control that admitted it
- **Window-level drag tracking**: capture-phase window `pointermove`/`pointerup`/`pointercancel` listeners keep the admitted gesture alive outside the canvas and clamp tool coordinates to the canvas edge where required
- **Move authority**: `interaction/shared-gestures.ts` owns pan, selection-band, and selected-object move state. Object moves mutate a Scene edit transaction and commit or abort it as one interaction
- **Cancellation**: Escape, pointer cancellation, window blur, and disposal converge on the Scene Interaction cancellation path so transient edits and runtime-owned overlays are released together

## Selection Highlights

Visual feedback is renderer-neutral. `runtime/scene-visuals.ts` defines screen-pixel stroke styles and both Pixi and Canvas2D renderers apply them to plants, zones, annotations, and Measurement Guides.

| State | Visual | When |
|-------|--------|------|
| Hover | 2.5px hover stroke at 0.72 alpha | Pointer is over an interactive object |
| Selected | 4.5px selection stroke | Object belongs to committed Scene selection |
| Locked object | 2.75px locked-object stroke | Direct object lock blocks editing |
| Locked layer | 2.75px locked-layer stroke | Owning Scene layer blocks editing |

The rubber-band itself is a runtime-owned DOM preview. Selection is resolved and committed when the gesture finishes.

### Theme coherence
- Interaction colors resolve through `getCanvasColor()` from the current canvas theme tokens
- Renderer snapshots contain semantic hover/selection/lock state; persisted Scene entities never contain presentation-only highlight attributes

## Layout

```
[toolbar 38px] [───── canvas ─────] [panel?] [bar 36px]
   left              center          slides in   right
   tools            workspace       side panel   navigation
```

- **Left toolbar**: 38px, grouped command-graph tools, history actions, selected-Plant presentation actions, and Grid/Snap/Ruler toggles. Active: 2px ochre left bar.
- **Right panel bar**: 36px, always visible for Canvas and Location workspaces. Primary commands switch workspace; side commands toggle sliding panels. Active: 2px ochre right bar.
- **Right side panels**: Design Notebook, Species Catalog, and Favorites. They slide in between the workspace and panel bar. First-use width is `clamp(320px, 35vw, 90vw)` so the default remains proportional instead of stopping at a fixed pixel cap; after the user resizes, the explicit pixel width is remembered. Resizable via drag handle.
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
- Toolbar left (38px): command-graph tool and action groups separated by dividers
- Bottom canvas bar: bottom-panel launcher on the left and Zoom Controls on the right
- Scale bar bottom-left: uses `--color-text-muted` for subtlety
- Zoom displays relative to initial view (100% = fit 100m in viewport)
- Rulers: background `--canvas-ruler-bg` (close to canvas bg, no harsh L-frame)

### Canvas Notice Layout
- Canvas notices must sit inside safe overlay slots, not at raw canvas edges.
- Reserve ruler chrome before placing notices: horizontal ruler, vertical ruler, ruler corner, and scale bar.
- Active Tool HUDs use the top-left safe slot. They provide current interaction guidance and controls, so they have priority over informational notices.
- Location Notices use the bottom-left safe slot. They report site/map readiness and stay visually attached to the canvas workspace, not the canvas bar.
- The scale bar has priority over Location Notices. A Location Notice prefers bottom-left above the scale bar, shifts to the right of the scale bar when vertical space is tight, then compacts before disappearing.
- Location Notices move as one family after a design has a Location: loading, ready, precision warning, and map/terrain error states should not jump between canvas zones. Missing-location setup is not a canvas notice.
- If layout pressure is severe, Tool HUDs keep their primary instruction visible. Location Notices may shrink to a one-line status with ellipsis, but should keep the status dot and shortest useful label visible.
- Notices use `--canvas-ruler-bg` or `--color-surface`, `1px solid --color-border`, `--radius-md`, and no dramatic shadow. They must be clearly readable above canvas content without using green UI chrome.
- Plant Spacing dense counts are warning-only. A physically valid Plant Spacing Interval must not be blocked by a confirmation step; the Tool HUD should emphasize generated counts above the dense threshold while leaving commit behavior direct.
- After Plant Spacing samples a placed plant, the sampled plant name is the Tool HUD's primary line. Do not repeat the tool name or generic selected-state copy inside the HUD.
- Plant Spacing Tool HUDs should not show a visible Cancel button. Use a muted keyboard hint instead: `Esc to exit` before a source is sampled, and `Esc to cancel` after a source is sampled. Keep the hint visible even when the Plant Spacing Interval input is focused.
- Plant Spacing generated counts use normal text below the dense threshold and `--color-primary` with stronger weight above the threshold. Do not use danger/error colors for dense counts because dense Plant Spacing remains physically valid.
- Plant Spacing should show generated-count feedback as one line, such as `128 generated`. Do not add a separate dense-warning sentence when the count crosses the threshold.

### Panel Bar (right edge)
- 36px wide, always visible when canvas is active
- Commands come from the application command graph: Canvas/Location primary navigation plus Design Notebook, Species Catalog, and Favorites side panels
- Active state: ochre right border + ochre icon color
- Primary commands switch workspace; side commands toggle the corresponding panel

### Species Catalog Workbench
- Search-first: full-width search input at top
- Filter region: contains the always-visible `FilterStrip` rows and the `ActiveChips` strip. Natural height by default; in extreme small-height cases, the combined region scrolls vertically at `max-height: min(45vh, 360px)` so results never disappear entirely.
- FilterStrip: always-visible compact controls below search. Filter rows come from the Species Catalog Filter catalog; do not hard-code the row list in component layout. Example rows may include Climate Zone, Sun, Habit, Life Cycle, Edibility, Woody, or N₂ Fixer depending on catalog metadata.
- Each filter row: right-aligned label + control flex-1. Rows are 24px min-height, `height: auto`, and grow or shrink based on their own visible filter choices at the current panel width. Choice-chip rows use a responsive chip grid so normal sidebar widths produce real row-count changes instead of appearing stuck at two flex-wrap rows. Filter choices must remain visible rather than clipped. No per-row scrolling.
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

### FilterChip
- Pill shape (`--radius-full`), 20px height, 11px text, 600 weight
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
- 12 collapsible sections below, ordered by designer decision flow: Life Cycle → Uses → Light & Climate → Soil → Ecology → Growth Form → Propagation → Fruit & Seed → Risk & Distribution → Leaf → Reproduction → Identity
- Each section: 3px left accent border (semantic color), section header pattern with icon + chevron, `--color-bg` header, content in `--color-surface` body
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
- Toggle button: section header pattern (`--text-xs`, uppercase, 600 weight, `--color-text-muted`, 0.06em letter-spacing)
- Icon before label (single character/emoji), chevron `›` after (right-aligned, rotates 90° on open)
- Header: `--color-bg` background, border-bottom on open
- Body: `--color-surface`, padding `--space-3`, flex column with `--space-3` gap
- Animation: chevron `transition: transform 0.15s ease`
- Used in: detail card sections, filter drawer sections

### Favorites Panel
- Header: section header pattern + ochre count badge (`--color-primary` bg, `--color-bg` text, `--radius-full`)
- List: reuses `PlantRow` component. Clicking opens detail card inline (same `detailHidden`/`detailVisible` pattern as PlantDbPanel)
- Empty state: star icon (`--color-primary`, 0.3 opacity), title + hint text, upper-third positioning (not dead-centered)
- Background: `--color-bg`

### Photo Carousel
- 3:2 aspect ratio, `--radius-lg` border, `--color-border` outline
- Shimmer loading state: gradient between `--color-surface` and `--color-bg`
- Nav arrows: transparent 32×48px hit targets, chevron character via `text-shadow`, visible on container hover (0.8 → 1.0 opacity)
- Dot indicators: 8px, 6px gap, `--color-border` inactive, `--color-primary` active with `scale(1.15)`. Minimum size for interactive elements
- Placeholder: subtle icon (`--color-border`, 0.6 opacity), same 3:2 aspect ratio
- Images served as base64 data URLs from Rust image cache (asset protocol not scoped)

### Pinned Plant Name Legend
- Floating reference card above the scale-bar reservation, past the ruler gutter, at `z-index: 19`
- Visible only when one or more pinned Plant-name entries exist
- Entries show the effective Plant symbol and color, localized name, and a count when multiple Plants share an entry
- Height is bounded by the canvas and scrolls when necessary; the entrance animation respects `prefers-reduced-motion`

### Plant Tooltip
- Runtime-owned HTML `<div>` overlay in the canvas container, `pointer-events: none`, `z-index: 20`
- `--color-surface` bg, `--color-border` border, `--radius-md`
- Content: localized common name when available (`--text-sm`/600) and scientific name (`--text-xs`/italic/muted)
- Positioned from pointer coordinates relative to the container, then clamped to the visible container bounds
- Built with safe DOM methods (`createElement`, `textContent`) — no `innerHTML`
- Appears on passive Plant hover and hides on pointer leave, non-Plant hover, drag, cancellation, or disposal

### Drag Handle (panel resize)
- 1px wide, uses `--color-border` — IS the border between canvas and panel
- Hover: expands to 2px, shows `--color-accent`
- Hit target: 9px wide via `::before` pseudo-element
