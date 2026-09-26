# Map-first interface

Status: Accepted (2026-09-26, Canopi v2)

## Context

The v1 interface framed the map with fixed rails, icon-only tools, an action bar of unlabelled icons, a zoom percentage and separate Data and Layers panels. Designers found tools hard to decode, dense Designs (2,201 plants, 117 species) hard to read, and plants hard to find in long lists. The v2 mockups (design canvas, 60+ boards, three independent reviews) settled a direction.

## Decision

- **Field Atlas.** Parchment, ink and ochre over the map, with a matching dark theme. Literata for titles, Source Sans 3 for the interface, IBM Plex Mono for species codes. UI text 14 px; nothing below 12 px (13 px for CJK).
- **Floating chrome over a full-bleed map.** A title bar (menus, Design name, save status, place search), a left tool rail, a right panel rail, one panel at a time (380 px, 440 px for Budget and Consortium), a view chip (Grid, Snap to grid, Rulers) and a zoom group that shows the map scale as a ratio (1:190) with the attribution beside it.
- **Recognition over recall.** Tool names show until each tool has been used once, then icons with labelled tooltips. Every command is in a menu (File, Edit, View, Tools, Help) with its shortcut. The right-click menu uses plain words and replaces the selection action bar; only the rotate handle stays on the canvas.
- **State colours.** Ochre means selected, active or primary; a blue ring means keyboard focus; amber means warning; red means error or destruction. Selected rows use a soft fill and an inset ochre edge, tiles and cells a soft fill and ring, swatches an outer ring.
- **Plants.** 29 single-colour symbols in three families (plant form, what it gives, what it does), recolourable per species or by stratum. One species row everywhere: glyph, common name over italic scientific name, mono code, count. Strata are Emergent, High, Mid, Low and are separate from plant forms.
- **Finding plants.** Every plant list has the same finder (Ctrl F): names in every language, scientific names, synonyms and codes; accent-, case- and typo-tolerant; matches highlighted, counted and ringed on the map with Zoom to them and Select all. "Selected on map" filters any panel to the current selection.
- **Site data lives in Layers.** One Add data entry, results nested under their source, an Analyze dialog, a data library shared by Designs.
- **Safety.** Destructive actions confirm (naming what is lost) or offer Undo. Saving problems say what happened, what is safe and the next step.
- **Accessibility and languages.** WCAG 2.2 AA: contrast, 3:1 control boundaries, 24 px targets (44 px on touch), real widget semantics, a keyboard path for every pointer action, single-key shortcuts only while the map has focus and switchable off. Locale formatting through `Intl`; message formats for plurals and names; layouts wrap instead of clipping.

## Consequences

- `.interface-design/system.md`, its pattern files and `styles/global.css` tokens are rewritten to this direction; surfaces migrate one bead at a time under epic canopi-h90p.
- Place search moves to Ctrl K; Ctrl F searches the open panel. Rotate is Ctrl Alt R. Panels open with Ctrl 1–8.
- The design canvas (artifact QK7HU5jUcwQSmQcrBsTCaF) and its generator in `.rq-scratch/design-canvas/build/` are the visual reference until the gallery shows every surface.
