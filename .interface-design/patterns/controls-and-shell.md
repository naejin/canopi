# Controls and shell

Read the [design contract](../system.md) first.

## Title Bar
- 36px tall, background `--color-bg` (blends with canvas area)
- Left: logo (16px) + menu; central drag region: Design name and dirty indicator
- Right: locale picker (custom dropdown, 3-column grid) + theme toggle (sun/moon SVG) + window controls
- Theme: light/dark only (no system option) — simple toggle


## Welcome Screen
- Logo (96px), no text headings, centered vertically
- Two action buttons: primary (ochre) + secondary (surface with border)
- Desktop has a Recent Designs section below with document icon, name, and relative date; Web Edition omits it
- Buttons have warm shadow, subtle lift on hover


## Panel Bar (right edge)
- 44px wide via `--chrome-rail-width`, always visible
- Commands come from the application command graph: Design Notebook, Species Catalog, and Favorites side panels
- Active state: ochre right border + ochre icon color
- Primary commands switch workspace; side commands toggle the corresponding panel


## Location Workspace
- Keep the search field and its one placement action together on one row at the upper left of the map.
- Label the action **Confirm location** for a provisional Design and **Move design here** for a confirmed Design. Disable it until the current map center or pending candidate would change the committed placement.
- A search result or map click enters a reversible **Selected location** preview. The action commits that candidate; without a preview, it commits the current map center. Escape or leaving Location aborts a preview.
- A compact bordered status surface at the lower left identifies the provisional, selected, or confirmed location. Provisional copy must state that local Design editing remains available.
- Show the saved pin only for a confirmed or pending-confirmed frame. Moving a confirmed Design changes its geographic anchor while preserving all local-metre object coordinates.
- Preserve the map failure overlay while leaving search, actions, status, and Canvas return available.


## Slider Controls
- Inline layout: value/bound label — track — value/bound label (all one 24px row)
- Track: 2px `--color-border` line, fill in `--color-primary`
- Thumb: 12px circle, `--color-primary`, 2px `--color-surface` border, `var(--shadow-sm)`
- WebKitGTK: `margin-top: -6px` on thumb (browser places top edge at center, not center)
- RangeSlider: two overlapping inputs, low z-index 1 / high z-index 2
- ThresholdSlider: tick marks (1px × 8px) positioned in 6px-padded ticks container for thumb alignment


## Custom Dropdown
- No native `<select>` — breaks the field notebook aesthetic
- Trigger: button with current value + `›` chevron (rotates 90° on open)
- Menu: `--color-surface` background, `--color-border` border, `--radius-md`, `--shadow-md`
- Items: `--color-text-muted`, hover `--color-bg`, active `--color-primary` with `--color-primary-bg`
- Close: click outside (`pointerup` listener — not `mousedown`, avoids catching opening click) or item selection
- ARIA: `aria-expanded`, `aria-haspopup="listbox"`, `role="option"`, `aria-selected`
- See `LocalePicker` in `TitleBar.tsx` as reference implementation


## Collapsible Section
- Toggle button: section header pattern (`--text-xs`, uppercase, 600 weight, `--color-text-muted`, 0.06em letter-spacing)
- Icon before label (single character/emoji), chevron `›` after (right-aligned, rotates 90° on open)
- Header: `--color-bg` background, border-bottom on open
- Body: `--color-surface`, padding `--space-3`, flex column with `--space-3` gap
- Animation: chevron uses the shared transition token, `transition: transform var(--transition-normal)`
- Used in: detail card sections, filter drawer sections


## Design Notebook Header
- The title/count and action group wrap into separate rows when the panel is narrow. Actions may wrap within their group; do not let them cover the title or hide commands.


## Chart Labels
- Timeline and Consortium labels choose black or white against the composited bar color, including bar opacity and alternating row backgrounds. Authored species colors remain unchanged. UI primary-button contrast is not suitable for these arbitrary bar colors.


## Drag Handle (panel resize)
- 1px wide, uses `--color-border` — IS the border between canvas and panel
- Hover: expands to 2px, shows `--color-accent`
- Hit target: 9px wide via `::before` pseudo-element
