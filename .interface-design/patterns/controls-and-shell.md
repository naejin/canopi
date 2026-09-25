# Controls and shell

Read the [design system](../system.md) first.

## Title bar

36px tall on `--color-bg` so it blends with the workspace. Left: 16px logo and menus. Centre drag region: Design name and dirty indicator. Right: locale picker (custom dropdown, three-column grid), light/dark theme toggle (sun/moon icon button) and window controls.

## Welcome screen

96px logo, no text headings, vertically centred. Two actions: primary (ochre) and secondary (surface with border). Desktop lists Recent Designs below with a document icon, name and relative date; Web omits it.

## Panel bar

The right rail (`--chrome-rail-width`, always visible) projects commands from the application command graph, one `PanelIcon` each. Every rail button is an icon-only button under the system rules, with its tooltip on the left. Active state: ochre right border and ochre icon. Primary commands switch the workspace; side commands toggle their dock panel.

## Dropdown

No native `<select>`. Use `components/shared/Dropdown.tsx` (the title bar's `LocalePicker` is a compact variant).

- Trigger: button with the current value and a `›` chevron that rotates 90° when open.
- Menu: `--color-surface`, `--color-border`, `--radius-md`, `--shadow-md`. Items are muted; hover `--color-bg`; active `--color-primary` on `--color-primary-bg`.
- Closes on item choice or click outside (`pointerup`, so the opening click is not caught).
- ARIA: `aria-expanded`, `aria-haspopup="listbox"`, `role="option"`, `aria-selected`.

## Sliders

- One 24px row: value or bound label, track, value or bound label.
- Track: 2px `--color-border` line with a `--color-primary` fill. Thumb: 12px `--color-primary` circle, 2px `--color-surface` border, `--shadow-sm`. WebKitGTK needs `margin-top: -6px` on the thumb.
- RangeSlider stacks two inputs (low z-index 1, high 2). ThresholdSlider draws 1×8px ticks in a 6px-padded container so they align with the thumb.

## Collapsible section

- Toggle: section-header style (`--text-xs`, uppercase, 600, muted, 0.06em tracking), a leading icon and a trailing `›` chevron that rotates 90° using `--transition-normal`.
- Header on `--color-bg` with a bottom border when open; body on `--color-surface`, `--space-3` padding and gap.
- Used by species detail sections and the More Filters drawer.

## Resize handle

The 1px `--color-border` line between canvas and dock is the handle. Hover widens it to 2px in `--color-accent`; a 9px `::before` gives the hit target. Keyboard resize is owned by `SidePanelDock`.
