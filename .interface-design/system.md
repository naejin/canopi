# Canopi interface design contract

Canopi is a field notebook for designing a living landscape: parchment, ink, restrained ochre, dense useful controls. The main canvas screen is the visual reference. Extend its hierarchy, spacing, border treatment, and interaction rhythm whenever a new surface is introduced.

## Start with the right reference

Read this contract, then the relevant family guide. Do not read every guide or rediscover every component for each task.

| Surface | Reference |
| --- | --- |
| Plant Color and Plant Symbol | [Appearance editors](patterns/appearance-editors.md) |
| Species Key, Layers, Favorites | [Dock panels](patterns/dock-panels.md) |
| Inspection Lens | [Inspection overlays](patterns/inspection-overlays.md) |
| Catalog, filters, species detail and photos | [Catalog and details](patterns/catalog-and-details.md) |
| Main canvas, tools, notices, plant labels | [Canvas workspace](patterns/canvas-workspace.md) |
| Shell, dropdowns, sliders, section toggles, charts | [Controls and shell](patterns/controls-and-shell.md) |

Implementation and ownership rules start at [frontend guidance](../docs/agent/frontend-patterns.md). Domain terms remain in CONTEXT.md; this contract does not redefine them.

## Visual hierarchy

Use existing tokens in desktop/web/src/styles/global.css as the single source for palette, spacing, typography, radii, control sizes, transitions, and semantic data colors. Inspect the relevant declarations when choosing a value. Do not copy token tables into guides or introduce a parallel theme.

Parchment is the workspace; differentiated surfaces support controls and panels. Borders establish grouping and depth. Keep shadows restrained where an existing floating-control pattern needs them; avoid dramatic elevation. Green is reserved for plant artwork and existing semantic plant data, never general UI chrome. Ochre signals active state, focus, and primary actions. Destructive actions use the existing danger tokens.

Use only 400 and 600 font weights. A surface title is sentence case and semibold. Species rows lead with the common name, then a muted italic scientific name; scientific name stands alone when a common name is unavailable. Counts and codes are quiet secondary information with tabular numerals or mono code styling. Do not make every label an uppercase heading or every count an accent badge. Existing specialist section patterns may retain their documented treatment.

Use spacing and control tokens. Structural dimensions can differ by surface when justified by its job, but do not invent new spacing or type scales. Choose borders and shared control states before custom decoration. Plant glyphs come from PlantSymbolGlyph and shared symbol recipes; use effective appearance for identity and preview, neutral ink for symbol choices.

## Layout and interaction

Keep the canvas visible and useful. A panel has one clear title, an obvious close action, compact task controls, and a scrollable content area. Keep apply actions visible when choices scroll. Use progressive disclosure for secondary controls, without hiding the primary task or removing capabilities.

Separate preview from mutation. Appearance choices preview until the user chooses a clear apply scope. Species focus, inspection, and hover are independent of real selection and document edits. Each action must retain its existing command/workbench authority.

A selected item gets restrained ochre feedback. Visibility, locks, active layer, focus, and selection are different states; do not reuse the same treatment for all of them. Prefer quiet metadata and ruled rows over nested cards. Search must have a clear action and useful empty result. Preserve user-resized dimensions.

Keyboard access is part of the design: labelled controls, visible focus, logical tab order, Escape dismissal and focus return. Custom grids need arrow navigation. Custom pointer controls need a keyboard path. A popup must fit its viewport and avoid being clipped by a parent scroll area. Use readable wrapped names and explicit secondary actions instead of overlapping or truncating essential commands.

## Reuse before introducing another pattern

Production building blocks live in desktop/web/src/components/shared/: SurfaceHeader, DockPanelHeader, SurfaceSearch, SpeciesIdentity, ActionMenu, Dropdown, ButtonTooltip, and the pointer lifecycle hooks. Appearance editors share their selection band and layout CSS. These components own presentation or a defined interaction lifecycle; callers retain domain actions.

Prefer these components over copying JSX or CSS from screenshots. Add a shared component when multiple real callers need the same behavior and its interface removes duplication. Avoid a universal panel framework with dozens of options. Reuse should make implementation and review smaller.

## Working method

1. Inspect the affected production surface live alongside the main screen. Read only its family guide, component, authority seam, and relevant tests.
2. State the user task, preserved capabilities, and consequential design uncertainty. Reuse accepted patterns directly. Build an isolated interactive prototype only when a consequential layout or interaction remains undecided.
3. Implement through existing authorities. Use focused behavioral tests for new interactions and regressions; avoid snapshots of CSS spelling or tests that merely repeat implementation.
4. Review real interactions in context: populated and empty states, mixed selections, long translated names, light/dark, narrow and short viewports, keyboard and pointer paths. Check scrolling, persistent controls, focus restoration, and overlays near edges.
5. Perform a fresh combined review, fix findings, and rerun affected checks. Update the relevant guide and gallery fixture when the change establishes a reusable decision. Remove superseded prototypes after accepted behavior exists in production.

## Executable reference

Run `cd desktop/web && npm run dev:ui`, then open http://127.0.0.1:1422/. Direct links use `?surface=color|symbol|key|layers|favorites|lens`; add `state=empty|mixed|long|located`, `theme=dark`, or `locale=fr`.

The gallery mounts production components and a real canvas runtime with deterministic memory data. Reload resets it. Use `npm run check:ui` for its type check. Gallery controls are development tools, not product UI. Native file dialogs are simulated in memory; verify platform delivery separately when changing file behavior.

Accepted reasoning belongs here or in a family guide. Reproducible states belong in gallery fixtures. Exact visual values belong in tokens. This keeps future context small while making the reference verifiable.
