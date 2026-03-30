# Rewrite Product Definition

Date: 2026-03-29
Status: Wave 0 lightweight scope lock derived from `docs/todo.md`

## Scope Matrix

| surface | current state | rewrite-exit classification | owner wave | user-facing purpose | acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| document safety and save/load flows | Active, but replacement authority is split and unsafe | required at rewrite exit | Wave 1 | Prevent document loss during create/open/load/switch flows | All document-replacing flows use one guarded boundary with save/discard/cancel semantics and queued-load safety |
| plant DB search, filters, detail, favorites, and plant placement | Active | required at rewrite exit | Waves 1-3 | Let users find plants, inspect them, favorite them, and place them on the canvas | Search/filter/detail/favorites/placement journeys work end to end without rewrite regressions |
| core canvas editing flows | Active | required at rewrite exit | Wave 2 | Let users create, edit, undo/redo, save, and reload canvas work | Core editing and roundtrip persistence pass parity checks |
| WorldMapPanel / featured designs discovery | Deleted / pruned | required at rewrite exit | Wave 3 | Let users open a full-main-screen world map, browse featured-design pins, filter them, and enter template import safely | Rebuilt surface is code-split, lifecycle-owned, uses a world map filled with featured-design pins, highlights filtered pins, and routes import through document actions without mixing in design-location editing |
| LayerPanel | Deleted / pruned | required at rewrite exit | Wave 3 | Give users the supported display and layer controls | Rebuilt panel owns layer/display controls without becoming a new hotspot |
| design location tools | Deleted / pruned | required at rewrite exit | Wave 3 | Let users set the design location from a bottom-bar map tab with search, drag, zoom, and centered-pin confirmation | Bottom-bar `location` tab opens a map picker with overlay search, a fixed center pin, standard drag/zoom behavior, and a confirm flow that updates canvas map layers |
| timeline tools | Deleted / pruned | required at rewrite exit | Wave 3 | Plan time-based work and scheduling inside a design | Timeline is available from the bottom bar and works without lifecycle or persistence regressions |
| budget tools | Deleted / pruned | required at rewrite exit | Wave 3 | Track design costs and budget outputs | Budget is available from the bottom bar and works with explicit component/action ownership |
| geo / terrain map features | Deleted / pruned map-terrain stack; currently unavailable | deferred after rewrite exit | Post-rewrite | Advanced geo and terrain context for designs | No rewrite-exit acceptance depends on geo / terrain workflows |
| export | Partial foundations exist (`ipc/design.ts`, export strings, canvas export helpers), but no locked rewrite-exit workflow | deferred after rewrite exit | Post-rewrite | Deliver PNG/SVG/CSV/GeoJSON style outputs once the core rewrite stabilizes | Export stays out of rewrite-exit acceptance and is re-scoped after product parity lands |
| desktop platform support level (Linux, macOS, Windows via Tauri) | Linux-first day-to-day path; cross-platform release verification not yet complete | required at rewrite exit | Wave 5 | Define the supported release target set for the finished product | Linux, macOS, and Windows desktop builds pass smoke verification; browser/mobile are not release targets |
| mobile support (iOS / Android) | No active product surface or rewrite plan | intentionally removed | n/a | Keep rewrite scope anchored on the desktop product | No rewrite wave depends on mobile delivery |
| browser-only product target | Web frontend exists as the Tauri shell UI, not as a supported standalone product | intentionally removed | n/a | Avoid implicit browser-release scope during the rewrite | No rewrite-exit acceptance requires a standalone browser deployment |
| knowledge / learning content | Article content exists, but the dedicated learning surface was deleted | deferred after rewrite exit | Post-rewrite | Teach users through in-product learning content after core parity is restored | Learning content is not required for rewrite exit and remains explicitly deferred |
| consortium editing surface | Data model remains, but the dedicated tab/surface was deleted | required at rewrite exit | Wave 3 | Restore consortium workflows as a bottom-bar tab in the rebuilt panel shell | Consortium tab is rebuilt as part of the bottom bar and its final required behavior passes lifecycle and persistence checks |

## Initial Journeys

1. Create a design, edit it, and switch documents without losing work.
2. Search the plant database, inspect detail, favorite plants, and place them on the canvas.
3. Edit canvas content, undo/redo, save, reload, and preserve roundtrip parity.
4. Use the featured-design world map to browse filtered pins and enter template import without bypassing document safety.
5. Use the bottom-bar `location` tab to search, drag, zoom, and confirm the design location.
6. Use rebuilt layer, `timeline`, `budget`, and `consortium` surfaces without lifecycle regressions.
