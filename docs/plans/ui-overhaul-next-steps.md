# UI Overhaul — Next Steps

**Date**: 2026-03-26
**Status**: In progress — Phase 2 partially complete
**Branch**: `feat/phase-3-canvas-advanced-location`
**Design system**: `.interface-design/system.md` (field notebook direction)

## What Was Done (2026-03-26 session)

### Feature Pruning
- 15 canvas tools → 4 MVP tools (Select, Hand, Rectangle, Text)
- Removed: activity bar, status bar, bottom panel, layer panel
- Removed from UI: ellipse, polygon, freeform, line, measure, dimension, arrow, callout, pattern fill, spacing, display modes, minimap, celestial dial, consortium visual, MapLibre, GeoJSON export
- All pruned code stays on disk — just disconnected from UI

### Design System
- Direction: **field notebook + dense professional tool**
- Palette: parchment `#F0EBE1`, ink `#2C2418`, ochre `#A06B1F`, graphite `#7D6F5E`
- Key rule: green lives on the canvas (plants), never in the UI chrome
- Dark theme: charcoal parchment `#1E1B17`, cream ink `#E5DFD4`, golden ochre `#C89B4A`
- Depth: borders-only (notebooks are flat), warm-tinted borders
- Radius: slightly sharp (3/5/7px) — technical, precise

### Layout Restructure
- **Left**: canvas toolbar (drawing tools only)
- **Center**: canvas workspace
- **Right**: panel bar (36px, leaf + book icons) + sliding panels
- **Title bar**: logo + file name + lang/theme + window controls
- No activity bar, no status bar

### New Components
- `WelcomeScreen` — logo, New/Open buttons, recent files list
- `ZoomControls` — floating bottom-right, shows 100% at default view
- `PanelBar` — right-edge vertical bar with plant DB + learning icons
- `LearningPlaceholder` — friendly "coming soon" message

### Plant Panel Redesign
- Search-first (no filter sidebar by default)
- Collapsible filter drawer below search bar
- Compact rows: botanical name + common name inline, colored attribute tags below
- Tag colors: family (brown), hardiness (blue), height (stone), stratum (ochre), edible (moss)
- Actions (+ and star) appear on hover only
- Panel opens on right side (reference material = right, tools = left)

### Fixes
- `tauri.conf.json` `beforeDevCommand` path corrected for project root
- Ruler corner uses CSS variables (updates on theme change)
- Scale bar uses `--color-text-muted` (visible in both themes)
- Compass disabled for MVP
- Zoom display rescaled: default view = 100% (not raw stage scale)
- Virtual list row height: 72px → 38px (eliminates whitespace gaps)

---

## What Needs to Be Done Next

### Priority 1: Plant Panel Polish
- [ ] Row heights still slightly inconsistent — test with varied data
- [ ] Filter drawer UX — test expanding/collapsing, ensure filters actually work
- [ ] Active filter chips shown inline below search when filters are applied
- [ ] Plant detail card — hasn't been restyled yet, will look out of place
- [ ] Drag-to-canvas flow — verify drag preview uses ochre accent, not old green

### Priority 2: File Operations
- [ ] Save indicator in title bar (dirty dot next to file name)
- [ ] Cmd+N from canvas should prompt if dirty
- [ ] Recent files on welcome screen — verify clicking opens correctly
- [ ] Title bar shows file name when design is saved (currently only when name !== 'Untitled')

### Priority 3: Canvas Polish
- [ ] Rectangle/zone fill color — default green is too saturated against parchment
- [ ] Plant symbol colors — verify stratum colors work with new palette
- [ ] Grid line colors — test at different zoom levels
- [ ] Ruler text readability in dark mode
- [ ] Ruler corner color on fresh app launch (before theme refresh)

### Priority 4: Dark Mode Audit
- [ ] All screens: welcome, canvas, plant panel, learning panel, plant detail
- [ ] Toolbar icon contrast — bumped to `#A89A88` but verify in practice
- [ ] Zoom controls visibility
- [ ] Plant row tag colors in dark mode
- [ ] Search input styling in dark mode

### Priority 5: End-to-End MVP Flow Test
- [ ] Launch → welcome screen → New Design
- [ ] Search "tomato" → drag to canvas → plant appears
- [ ] Draw rectangle zone → Cmd+S → save dialog → saved
- [ ] Close → reopen → welcome screen shows recent file → click → design loads
- [ ] Toggle dark mode → verify everything renders correctly
- [ ] Switch language → verify all strings update

### Priority 6: Re-enable Features (Post-MVP)
Features to bring back once MVP is solid, in order of user value:
1. Ellipse + Polygon tools (zone drawing)
2. Minimap
3. Display modes (canopy spread, thematic coloring)
4. Alignment + distribution
5. Group/ungroup
6. Guides + snap-to-guides
7. Compass + location/MapLibre
8. Arrow + callout annotations
9. Dimension + measure tools
10. Pattern fill, spacing, celestial dial
11. Timeline, budget, consortium tabs
12. GeoJSON/PNG/SVG export

---

## Key Files

| File | Role |
|------|------|
| `.interface-design/system.md` | Design system (field notebook direction) |
| `desktop/web/src/styles/global.css` | Design tokens (light + dark) |
| `desktop/web/src/app.tsx` | App shell + layout |
| `desktop/web/src/components/panels/PanelBar.tsx` | Right panel bar |
| `desktop/web/src/components/shared/WelcomeScreen.tsx` | Welcome screen |
| `desktop/web/src/components/canvas/ZoomControls.tsx` | Zoom controls |
| `desktop/web/src/components/panels/PlantDbPanel.tsx` | Plant search panel |
| `desktop/web/src/components/plant-db/PlantRow.tsx` | Plant list row |
| `desktop/web/src/components/plant-db/PlantDb.module.css` | Plant panel styles |
| `desktop/web/src/components/shared/TitleBar.tsx` | Title bar (lang/theme) |
