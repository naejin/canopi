# Canvas controls: right-drag pan, one selection model, touch

Status: planned (2026-09-29), not started. Target 2.0.1 for phase 1, then 2.1. Epic bead canopi-f47t; phases are canopi-f47t.1 to .4.

## Why

A user asked for right-click and drag to pan, with the left button always selecting; the maintainer agrees (2026-09-29). A comparison with GeoLibre (upstream `opengeos/GeoLibre` at `b3d91de`) found that GeoLibre keeps MapLibre's viewer defaults (left-drag pans, right-drag rotates and pitches, selection is a mode started from a layer menu). That suits a GIS viewer, not a design canvas, so Canopi does not copy its scheme. It does copy one solved problem: telling a right-click from a right-drag across operating systems (`apps/geolibre-desktop/src/lib/context-menu-gesture.ts`, MIT, framework-free; copy with attribution per ADR 0002).

Today (code, not docs): MapLibre input is off on the design canvas (`maplibre/workspace-map.ts`, `interactive: false`); every gesture goes through `canvas/runtime/scene-interaction.ts`. Left-drag on empty map band-selects in Select; panning is Space+drag, middle-drag or the Pan tool (H); right-click opens the canvas menu; right-drag does nothing; the wheel zooms or pans by a setting; there is no touch handling at all.

## Decisions

1. Right-drag pans in every tool. Left always selects or draws. Middle-drag and Space+drag keep panning; the Pan tool (H) stays for touch and trackpad users.
2. A right press that moves at most 3 px before release opens the canvas menu, as today; beyond that it pans and no menu opens. Linux and macOS fire `contextmenu` on press, Windows on release; the copied gesture tracker handles both.
3. North-up stays: no rotation or pitch. Left-drag never pans. Shift+drag is not box zoom.
4. Every documented control rule is rewritten in the change that ships it (`.interface-design/patterns/canvas-workspace.md`, `docs/guides/map-workspace.md`, ADR 0010 line 19 on shortcut focus, the tool-card hints and the F1 dialog). Not appended.

## Phase 1 (2.0.1): right-drag pan and a pointing-device setting

Scope:
- Right-drag pan in `scene-interaction.ts` pointer routing: today only buttons 0 and 1 are handled (`pointerDown`, the `event.button` guard). Add button 2 to the shared pan gesture (`canvas/runtime/interaction/shared-gestures.ts`, `beginSharedPan` or equivalent), before tool dispatch, so it works mid-polygon and in every tool.
- Menu versus drag: port `context-menu-gesture.ts` into `canvas/runtime/interaction/` (attribution header naming GeoLibre, MIT, commit). The canvas `contextmenu` handler opens the menu only when the tracker says the press was a click. Keep the Menu key and Shift+F10.
- Suppress the browser and WebKitGTK context menu on right-drag release. Check the three platforms' event order in tests with synthetic sequences (press, move, release, contextmenu before and after).
- Settings › Canvas: replace "Scroll wheel: zoom or pan" with "Pointing device: Mouse or Trackpad" (same stored key is not required; this is device state, not Design data, so a settings migration is not needed, only a default). Mouse: wheel zooms, Shift+wheel pans. Trackpad: two-finger scroll pans, pinch (Ctrl+wheel) zooms. Default Mouse. Update `common-types/src/settings.rs`, generated settings, `SettingsDialog.tsx`, the wheel handler, all 11 locales.
- Hints: tool cards say "Right-drag, Space + drag or middle-drag pans"; drop "H pans" when single-key shortcuts are off.

Acceptance:
- In every tool, right-drag pans and never opens a menu; a still right-click opens the menu with today's entries; a polygon draft survives a right-drag pan.
- Vitest: gesture tracker cases for press-then-contextmenu (Linux/macOS order) and contextmenu-on-release (Windows order), 3 px threshold, drag then click within 500 ms.
- Live check with the MCP bridge on Linux; Web Edition in Chromium and WebKit.

## Phase 2 (2.1): one selection and drawing model

- A click inside a zone's fill selects the zone when no plant or note is on top; a drag that starts inside a zone draws a band (it never moves the zone). Hit testing today only counts the outline (`hit-testing.ts`, 6 px).
- Shift constrains every drawing tool: square rectangle, circle ellipse, 45° line and measure (today only Polygon and Plant a row).
- Alt+click removes from the selection (QGIS and GeoLibre convention); Shift/Ctrl/Cmd+click still toggles.
- Polygon: double-click or a still right-click finishes (3+ corners). Right-click finishes only while a polygon draft exists; otherwise it opens the menu.
- Zone corners: double-click an edge adds a corner; Alt+click or Delete on a selected corner removes it (minimum 3). Keep the 0.5 m and 0.25 m² floors.
- Fix mid-drag wheel zoom drift: store drag starts in world coordinates (zone drawing, measure, band preview).

## Phase 3 (2.1): touch on the Web Edition and tablets

- One finger: the tool's left-button behaviour. Two fingers: pan and pinch zoom together. Long press (500 ms, under 8 px): canvas menu.
- `touch-action: none` on the map host; ignore the browser's page zoom on the canvas only.
- A second pointer during a one-finger gesture cancels that gesture and starts pan/zoom (GeoLibre's print-extent tool does this).
- Phone layout: add Fit to the zoom column.

## Phase 4 (small, any release)

- One zoom step for buttons, keys and a wheel notch; plain + and − zoom when the map has focus; zoom to selection (Shift+2); Home fits the Design.
- Port GeoLibre's selected-text drag guard (`packages/map/src/selection-drag-guard.ts`) if a text selection can break a pan in WebKitGTK; test first.
- Docs and code disagreements found on 2026-09-29, fixed by rewriting the docs to the code or the code to the docs:
  - Single-key shortcuts work anywhere except text fields, not only while the map has focus (`system.md`, ADR 0010, `en.json` settings text).
  - The selection box has no corner handles (`canvas-workspace.md`).
  - Arrow nudge works only in Select.
  - Middle-drag pan is undocumented.

## Not doing

Left-drag pan, rotation or pitch, Shift+drag box zoom, lasso select (revisit after phase 2), view history on `[` and `]` (those keys already rotate stamps and reorder).

## Order of work

Phase 1 alone is a small, contained change and the one users asked for; ship it in 2.0.1. Phases 2 and 3 each touch every tool and need their own review; phase 4 items can ride along with any of them.
