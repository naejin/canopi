# Canopi interface design system

Canopi is a field notebook for designing a living landscape on a map: parchment, ink, restrained ochre, dense useful controls. The map workspace is the visual reference; extend its hierarchy, spacing, borders and interaction rhythm to every new surface.

Read this file, then the one pattern file for the surface you touch:

| Surface | Pattern |
| --- | --- |
| Map canvas, toolbar, canvas controls, notices, inspection lens, Plant Color and Plant Symbol editors | [Canvas workspace](patterns/canvas-workspace.md) |
| Species Key, Layers, Data Library, Calendar, Budget, Consortium, Favorites, Design Notebook | [Dock panels](patterns/dock-panels.md) |
| Species Catalog, filters, species detail, photos | [Catalog and details](patterns/catalog-and-details.md) |
| Title bar, welcome screen, panel bar, dropdowns, sliders, collapsible sections, charts | [Controls and shell](patterns/controls-and-shell.md) |

Code ownership and frontend rules: [frontend guide](../docs/guides/frontend.md). Map, camera and scene runtime: [map workspace guide](../docs/guides/map-workspace.md). Principles and authorities: [architecture](../docs/architecture.md) and [AGENTS.md](../AGENTS.md).

## Direction

- Parchment, ink and ochre. The accent is ochre (`--color-accent`, `--color-primary`); never write the hex.
- Green never appears in UI chrome. It is reserved for plant artwork and semantic plant data.
- Light and dark themes only; no system option.
- Depth is borders-first. Shadows stay restrained and only where a floating-control pattern already uses them.
- The map is the canvas: basemap, satellite, LiDAR and terrain are the background of the design surface. There is no separate local canvas and no location setup screen.

## Workspace layout

- Centre: the map canvas. Top right, floating: the inspection lens (loupe) launcher, with the place-search (pin) launcher directly below it.
- Left: the canvas toolbar rail (tools, history, plant colour and symbol, grid/snap/ruler toggles).
- Right: the `PanelBar` rail and one resizable `SidePanelDock` (Species Key, Layers, Data Library, Calendar, Budget, Consortium, Design Notebook, Species Catalog, Favorites).
- Bottom: the canvas bar with zoom controls on the right.
- Title bar: logo, menus, Design name, locale and theme toggles, window controls.

## Tokens and hierarchy

`desktop/web/src/styles/global.css` is the single source for palette, spacing, type, radii, control and icon sizes, transitions and semantic data colours. Do not copy token tables into docs or add a parallel theme. CSS Modules use tokens only: no raw `rgba()`, `white` or `black`, and font weights 400 and 600 only.

- Parchment is the workspace; surfaces (`--color-surface`) hold controls and panels. Borders group; ochre signals active state, focus and primary actions; danger tokens mark destructive actions.
- Surface titles are sentence case and semibold. Do not turn every label into an uppercase heading or every count into an accent badge.
- Species rows lead with the common name, then a muted italic scientific name (alone when there is no common name). Counts and codes are quiet: tabular numerals or mono.
- Plant glyphs come from `PlantSymbolGlyph` and the shared symbol recipes. Effective appearance is used for identity and preview; symbol choices use neutral ink.

## Icons

The icon set is in-house, inline SVG. Do not add an icon font or icon package.

- `components/canvas/toolbar-icons.tsx`: canvas tools and actions (select, hand, shapes, text, measurement guide, stamps, spacing, undo/redo, grid, snap, rulers, palette, plant symbol). 20×20 view box.
- `components/shared/PanelIcon.tsx`: one icon per dock panel, used by `PanelBar`. 24×24 view box, 1.5 stroke.
- Small control glyphs (zoom ±, fit, close, loupe, pin, recentre, expand, lock, eye) stay inline next to their one caller; move a glyph into one of the two modules above when a second caller needs it.
- Every icon uses `currentColor`, has `aria-hidden="true"`, and uses native SVG attribute spellings (`stroke-width`). Stroke icons use round caps and joins at 1.2–1.5 stroke. Icon size follows `--icon-size-*`; the rail uses `--icon-size-lg`.
- Never use emoji or text characters (`✕`, `↗`, `+`) as a control's icon.

## Icon-only buttons

An icon-only button shows no visible text. Every one of them:

1. Has a non-empty, localized `aria-label` naming the action (include the object when a row repeats the button, e.g. `Lock layer: Plants`).
2. Contains a `ButtonTooltip` (`components/shared/ButtonTooltip.tsx`) with the same label; never use `title`. Pick `side` so the tooltip stays inside the viewport: `left` on the right edge, `right` from the left rail, `top` in bottom bars.
3. Shows its shortcut when one exists: pass the display string from `shortcuts/definitions.ts` or the command catalog (`command.shortcut`) as the tooltip `shortcut`, and set `aria-keyshortcuts`. Never retype a shortcut string. Escape dismissal is universal and not hinted.
4. Has a visible focus ring: `outline: 2px solid var(--color-accent)` on `:focus-visible` (offset 2px, or -2px inside a rail or bar).
5. Uses a size token: `--control-size-md` for floating and bar controls; `--control-size-sm` inside dense rows, row headers and status cards; the toolbar rail fills its width at `--control-size-xl` height.
6. Hovers with `background: var(--color-control-hover)`; pressed or active state uses `--color-control-active` with ochre ink; disabled drops to muted ink without hover.
7. Is `position: relative` (or already positioned) so the tooltip anchors to it.

Listbox options that are pure swatches (Plant Color palette) are choices, not commands: they keep `role="option"`, `aria-label` and `aria-selected`, and are exempt from the tooltip rule. `desktop/web/src/__tests__/canvas-icon-buttons.test.tsx` enforces these rules for the canvas controls; extend it when adding one.

## Layout and interaction

- Keep the canvas visible and useful. A panel has one clear title, an obvious close action, compact task controls and a scrollable body; apply actions stay visible when choices scroll. Preserve user-resized dimensions.
- Separate preview from mutation. Appearance choices preview until the user picks an apply scope. Species focus, inspection and hover are independent of selection and document edits. Each action keeps its command or workbench authority.
- Selection gets restrained ochre feedback. Visibility, locks, active layer, focus and selection are different states with different treatments. Prefer ruled rows and quiet metadata over nested cards.
- Keyboard access is part of the design: labelled controls, visible focus, logical tab order, Escape dismissal with focus return, arrow navigation in custom grids, a keyboard path for every pointer control. Popups fit the viewport and are not clipped by a scroll parent. Wrap long translated names; do not truncate essential commands.
- Search has a clear action and a useful empty result.

## Reuse before adding a pattern

Shared building blocks live in `desktop/web/src/components/shared/`: `SurfaceHeader`, `DockPanelHeader`, `SurfaceSearch`, `SpeciesIdentity`, `ActionMenu`, `Dropdown`, `DatePicker`, `ButtonTooltip`, `usePointerResize`, `usePointerReorder`. They own presentation or an interaction lifecycle; callers keep domain actions. Add a shared component only when several real callers need the same behaviour. No universal panel framework.

## Working method

1. Inspect the affected surface live next to the main workspace. Read its pattern file, component, authority seam and tests only.
2. State the user task, the capabilities to preserve and any consequential design uncertainty. Prototype only when a consequential layout remains undecided.
3. Implement through existing authorities. Write focused behavioural tests; no CSS-spelling snapshots.
4. Review populated, empty, mixed and long-translation states, light and dark, narrow and short viewports, keyboard and pointer paths, focus return and overlays near edges.
5. Update the pattern file and a gallery fixture when the change sets a reusable decision.

## Executable reference

`cd desktop/web && npm run dev:ui`, then open `http://127.0.0.1:1422/`. `?surface=workspace` mounts the Desktop workspace composition; add `edition=web` for Web. Direct surfaces: `?surface=color|symbol|key|layers|library|favorites|notebook|lens`, with `state=empty|mixed|long|located|dense|overview|max-zoom|lidar-progress`, `theme=dark` or `locale=fr`. The gallery mounts production components and a real canvas runtime on deterministic memory data; reload resets it, and `npm run check:ui` type-checks it. Native file dialogs are simulated.

Accepted reasoning lives here or in a pattern file, reproducible states in gallery fixtures, exact values in tokens.
