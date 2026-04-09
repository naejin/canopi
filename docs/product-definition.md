# Product Definition

Date: 2026-04-05
Status: v0.3.0 — timeline rework shipped, bottom-panel triptych complete. See `docs/todo.md`

## Scope Matrix

| surface | current state | rewrite-exit classification | owner wave | user-facing purpose | acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| document safety and save/load flows | Active — replacement guard landed, but document authority is split between SceneStore and document store (see architecture review Finding 1) | shipped | Wave 1 | Prevent document loss during create/open/load/switch flows | All document-replacing flows use one guarded boundary with save/discard/cancel semantics and queued-load safety |
| plant DB search, filters, detail, favorites, and plant placement | Active | shipped | Waves 1-3 | Let users find plants, inspect them, favorite them, and place them on the canvas | Search/filter/detail/favorites/placement journeys work end to end without rewrite regressions |
| core canvas editing flows | Active | shipped | Wave 2 | Let users create, edit, undo/redo, save, and reload canvas work | Core editing and roundtrip persistence pass parity checks |
| WorldMapPanel / featured designs discovery | Deferred; hidden from the live UI | deferred | Post-convergence | Let users open a full-main-screen world map, browse featured-design pins, filter them, and enter template import safely | Not required for convergence phase |
| LayerPanel | Active | shipped | Wave 3 | Give users the supported display and layer controls | Rebuilt panel owns layer/display controls without becoming a new hotspot |
| design location tools | Hidden — PanelBar button commented out (no in-canvas map layers yet); code retained | shipped (hidden) | Wave 3 | Let users set the design location from a bottom-bar map tab with search, drag, zoom, and centered-pin confirmation | Bottom-bar `location` tab opens a map picker with overlay search, a fixed center pin, standard drag/zoom behavior, and a confirm flow that updates canvas map layers |
| timeline tools | Active — reworked UX with 6 fixed action-type rows, click-to-add/edit popover with date validation, edge resize, hover tooltip, ctrl+scroll zoom, drag-to-move with frozen coordinate origin, auto-scroll on edge drag, species color priority. Ruler controls hidden pending design iteration | shipped | Wave 3 | Plan time-based work and scheduling inside a design | Timeline tab with direct-manipulation canvas interaction model |
| budget tools | Active — redesigned bottom-panel tab with summary header, document-level currency picker, notebook-style table, inline price editing, CSV export | shipped | Wave 3 | Track design costs and budget outputs | Auto-counted plant budget with currency selection, per-species pricing, and CSV export |
| geo / terrain map features | Deleted / pruned; MapLibre retained as dependency. In-canvas map layers planned via dedicated controller (see `CLAUDE.md` MapLibre Integration Rule) | deferred | Post-convergence | Advanced geo and terrain context for designs | MapLibreController landed; document authority converged |
| export | Partial foundations exist (`ipc/design.ts`, export strings, canvas export helpers) | deferred | Post-convergence | Deliver PNG/SVG/CSV/GeoJSON style outputs | Re-scoped after convergence phase |
| desktop platform support level (Linux, macOS, Windows via Tauri) | Linux-first day-to-day path; cross-platform release verification not yet complete | shipped (Linux), in progress (macOS/Windows) | Wave 5 | Define the supported release target set for the finished product | Linux, macOS, and Windows desktop builds pass smoke verification; browser/mobile are not release targets |
| mobile support (iOS / Android) | No active product surface | out of scope | n/a | Desktop-only product | Not planned |
| browser-only product target | Web frontend exists as the Tauri shell UI, not as a supported standalone product | out of scope | n/a | Desktop-only product | Not planned |
| knowledge / learning content | Article content exists, but the dedicated learning surface was deleted | deferred | Post-convergence | Teach users through in-product learning content | Not required for convergence phase |
| consortium editing surface | Active — Canvas2D succession chart with strata×phase grid, auto-sync from placed species, drag-move/resize, hover sync with canvas | shipped | Wave 3 | Visualize plant succession and strata relationships | Consortium chart with auto-sync, drag reorder, and canvas hover highlighting |

## Initial Journeys

1. Create a design, edit it, and switch documents without losing work.
2. Search the plant database, inspect detail, favorite plants, and place them on the canvas.
3. Edit canvas content, undo/redo, save, reload, and preserve roundtrip parity.
4. Use rebuilt layer controls for the required display and visibility flows.
5. Use the bottom-bar `location` tab to search, drag, zoom, and confirm the design location.
