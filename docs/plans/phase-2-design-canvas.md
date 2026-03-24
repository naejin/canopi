# Phase 2 — Design Canvas (Core) — COMPLETED

> **Status**: All 13 sub-phases implemented and tested. This document was the original plan.
> For the authoritative list of what was built (vs deferred), see `architecture-draft.md` Phase 2 checklist.

## Key Architectural Decisions Made During Implementation

1. **Rulers as HTML `<canvas>` elements** (not Konva layers) — eliminates transform synchronization lag
2. **`strokeScaleEnabled: false`** on all shapes — Konva built-in, replaces custom zoom-scaling system
3. **File dialogs in frontend JS** (not Rust `blocking_*`) — avoids GTK deadlock on Linux
4. **Group-level counter-scale for plants** — one scale per group on zoom, zero lag, children use screen-pixel coordinates
5. **`_chromeEnabled` signal** — grid/rulers/compass hidden until design is created, signal-driven visibility with proper @preact/signals subscription ordering
6. **Plant DB as resizable sidebar** (not panel replacement) — enables drag-and-drop alongside canvas
7. **Custom title bar** — `decorations: false` + `startDragging()` API for cross-platform window chrome
8. **Locale-aware plant labels** — batch IPC lookup (`get_common_names`) on language change, common name primary + botanical secondary

## Items Deferred to Phase 3

- Plant stamp tool (needs species picker UI)
- Right side panel (redundant with DB sidebar)
- Native file watching (FSEvents/ReadDirectoryChanges/inotify)
- Sun direction widget (solar position math)
- Native high-DPI PNG export (Core Graphics/Direct2D/Cairo)
- Saved Designs panel (redundant with OS file dialog)
- Full Gantt-like interactive timeline
- Plant display modes: canopy spread, thematic coloring ("Color by")
- Canvas rotation

---

## Original Plan (below)

## Context

Phase 0 (Scaffold & Shell) and Phase 1 (Plant Database) are complete. The app has: Tauri v2 + Preact shell with activity bar, panel routing, i18n (6 languages), theme switching, command palette, keyboard shortcuts, user DB (settings, favorites, recently viewed), read-only plant DB (175K species) with FTS5 search, filtering, pagination, and plant detail cards.

Phase 2 builds the core canvas-based design interface — Canopi's primary feature. Users create agroecological designs on a Konva.js canvas with drawing tools, plant placement via drag-and-drop from the plant DB, undo/redo, layer management, and file save/load in `.canopi` format.

**Already exists**: Konva.js v9.3.0 in `package.json` (unused). `common-types/src/design.rs` types defined. `desktop/src/commands/design.rs` has stub save/load. `recent_files` table in user DB. `PlantRow` is draggable with `canonical_name`/`common_name` (needs `stratum`/`width_max_m` augmentation).

---

## Canopi Plugin Usage (all sub-phases)

**Skills** (invoke before writing code):
- `/canopi-canvas` — Canvas engine, Konva patterns, tools, history, drag-and-drop, serialization, LOD, grid/rulers
- `/canopi-ux` — UI components, panels, CSS Modules, interactions, a11y
- `/canopi-rust` — IPC commands, Tauri file dialogs, .canopi serialization, state
- `/canopi-db` — DB queries (recent_files table)
- `/canopi-i18n` — New i18n keys (canvas toolbar, file menu, bottom panel)

**Agents**:
- `canopi-backend-dev` (Sonnet) — Rust/Tauri (sub-phases 2h, 2l backend)
- `canopi-frontend-dev` (Sonnet) — Preact/Konva (sub-phases 2a–2g, 2i–2m)
- `canopi-reviewer` (Opus) — Code review after each sub-phase

**Context7 IDs**: Konva.js `/konvajs/site`, Tauri v2 `/websites/v2_tauri_app`, rusqlite `/rusqlite/rusqlite`, i18next `/i18next/react-i18next`

---

## Architectural Decisions

1. **CanvasEngine class** (imperative Konva, not react-konva) — owns all Konva objects. Preact never touches Konva nodes directly. Signals drive state; `effect()` syncs to Konva.
2. **Tool pattern** — `CanvasTool` interface with `activate`, `deactivate`, `onMouseDown/Move/Up`, `onKeyDown`. One active tool at a time.
3. **Command pattern for undo/redo** — `Command` objects with `execute(engine)` / `undo(engine)`. `CanvasHistory` manages past/future stacks. Stores diffs, not snapshots.
4. **Seven named Konva layers** — `base`, `contours`, `climate`, `zones`, `water`, `plants`, `annotations`.
5. **DOM-to-Konva drag-and-drop** — PlantRow `draggable="true"` → canvas `dragover`/`drop` → `stage.setPointersPositions(e)` → coordinate transform.
6. **File I/O via Rust commands** — Tauri dialog plugin for file dialogs, `std::fs` for atomic writes (write tmp → rename). No `tauri-plugin-fs` on frontend.
7. **Forward-compatible .canopi** — `#[serde(flatten)] extra: HashMap<String, Value>` on `CanopiFile` preserves unknown fields.

---

## Performance Strategy

Performance is a first-class requirement. Canvas lag degrades UX immediately — every interaction must feel instant. These rules apply across all sub-phases:

### Rendering
- **`batchDraw()` always** — Never call `layer.draw()` in a loop. Accumulate mutations, then one `batchDraw()` per frame.
- **Layer caching** — Use `layer.cache()` for layers that change infrequently (grid, rulers, base). Bust cache only on zoom/pan/content change.
- **Custom `sceneFunc`** for grid/rulers — One `Konva.Shape` draws all lines in a single canvas 2D path, not individual `Konva.Line` nodes. Orders of magnitude faster.
- **Off-screen culling** — Don't render nodes outside the viewport. Konva handles this partially, but verify with profiling.
- **Minimize node count** — Prefer `Konva.Group` with a custom `sceneFunc` drawing multiple primitives over many individual child nodes. Each Konva node has overhead (event listeners, transform matrix, hit detection).

### Zoom, Pan, Drag (60fps target)
- **Throttle zoom handler** — Use `requestAnimationFrame` guard. Drop intermediate wheel events.
- **Defer LOD updates** — Don't re-evaluate LOD on every zoom tick. Debounce to when zooming stops (150ms idle) or when crossing a threshold boundary.
- **Transformer performance** — Limit Transformer to ≤50 nodes simultaneously. For mass selections, show bounding box only (no individual handles).
- **Drag events** — On `dragmove`, do NOT update signals or trigger effects. Only update on `dragend`. During drag, operate purely in Konva space.

### Data & Serialization
- **Non-blocking serialization** — Auto-save and export serialize the canvas to JSON. For large designs (500+ objects), chunk work with `setTimeout(fn, 0)` slices or use a `structuredClone` + Web Worker pipeline to avoid blocking the main thread.
- **Lazy consortium detection** — Don't re-scan all plant relationships on every plant add/remove. Debounce (500ms) and cache results. Only re-check affected pairs.
- **IPC payload size** — For auto-save, send a compressed design (skip undo history, skip computed data) to minimize IPC serialization cost.

### Selection & Hit Detection
- **Spatial indexing** — For rubber band selection with 200+ objects, don't iterate all nodes. Use a simple grid-based spatial index (divide canvas into cells, map nodes to cells, only test nodes in overlapping cells). Build incrementally on node add/move.
- **Hit detection shortcut** — For `Konva.Transformer`, disable `hitGraphEnabled` on layers that don't need mouse interaction (grid, rulers). Set `listening: false` on decorative nodes.

### Memory
- **Command pruning** — While undo depth is unlimited, cap at 500 commands and silently discard the oldest. Each command is tiny (diffs), but 10K+ commands accumulate.
- **Image management** — Background images loaded via `Konva.Image` must be sized appropriately. Warn if imported image is >10MB. Downsample to canvas resolution.
- **Dispose on unmount** — `CanvasEngine.destroy()` must call `stage.destroy()` which frees all Konva nodes, canvas elements, and event listeners. Verify no leaks via DevTools Memory panel.

### Performance Budget & Profiling
- **Target**: All interactions <16ms (60fps). Zoom/pan must not drop below 30fps with 200 plant nodes + 50 shapes.
- **Profiling checkpoints** — After sub-phases 2c, 2f, 2j (when node count and visual complexity peak), run Chrome DevTools Performance recording of: zoom in/out, pan across canvas, rubber band select all, draw shape. Flag any frame >33ms.
- **Canvas stress test** — At end of Phase 2, create a test design with 300 plants + 100 zones + grid + rulers. Verify smooth zoom/pan/select.

---

## UX Excellence Strategy

The canvas is Canopi's core product surface — its feel determines adoption. Every interaction must be polished to the level of professional design tools (Figma, Sketch, Miro). These UX principles apply across all sub-phases:

### Interaction Feedback (every action acknowledged instantly)
- **Cursor semantics** — Every tool changes the cursor to communicate its function: Select=default/pointer, Hand=grab/grabbing, Rectangle/Ellipse/Polygon/Freeform/Line=crosshair, Text=text, Measure=crosshair with ruler icon, Plant Stamp=custom plant cursor (CSS `url()` with a small plant icon). During drag: use grabbing/move cursors as appropriate.
- **Hover states** — Canvas objects show a subtle highlight on hover (faint outline glow, 1px `var(--color-primary)` at 30% opacity). This tells users "this is interactive" before they click. Locked objects: no hover highlight. Hidden layers: no hover.
- **Selection visualization** — Selected objects get a clear selection ring (2px `var(--color-primary)` outline). Multi-selected: same ring + a subtle fill tint. Transformer handles: filled circles on corners, filled squares on edges, rotation handle above with a clear arc indicator.
- **Drop zone feedback** — When dragging a plant from the DB panel, the canvas area shows a subtle highlight (border glow or background tint) to indicate "drop here." The preview shows where the plant will land (ghost plant at cursor position).
- **Operation confirmation** — On delete: brief fade-out animation (150ms) before removing. On paste: brief scale-up animation (100ms, from 0.9 to 1.0) on pasted objects. On lock: brief shake animation + lock icon flash. These are micro-animations that confirm the action landed.
- **Drawing preview** — While drawing a shape (mousedown → mousemove), show the shape in real-time with a dashed stroke (`strokeDashArray: [5, 5]`) and semi-transparent fill. On mouseup, the shape solidifies with the final stroke. This gives continuous feedback during creation.
- **Snap indicators** — When snap-to-grid is active and a dragged object snaps, show brief guide lines (thin blue lines from the snap point to the grid axes) that appear for 200ms then fade. Like Figma's smart guides.

### Visual Polish
- **Canvas background** — Subtle paper-like texture or very faint noise pattern (via CSS or a base-layer pattern), not flat white. In dark mode: subtle dark texture. The canvas should feel like a physical workspace.
- **Shadow on floating UI** — Toolbar, layer panel, bottom panel, and right panel all have subtle box shadows (`0 2px 8px rgba(0,0,0,0.12)`) to float above the canvas. In dark mode: `rgba(0,0,0,0.3)`.
- **Smooth transitions** — Panel open/close: 200ms ease-out slide. Layer panel: 150ms width transition. Bottom panel: 200ms height transition. Right panel: 200ms slide-in from right. No abrupt show/hide.
- **Zoom indicator** — Brief toast-like indicator showing zoom percentage (e.g., "75%") that appears on zoom change, fades after 1s. Positioned bottom-center or near scale bar.
- **Plant symbols** — Circles alone are bland. Strata-based fill patterns: canopy trees get a subtle radial gradient (darker center, lighter edge simulating foliage), ground cover gets a dotted fill, vines get a wavy pattern. These differentiate plant types at a glance even without labels.
- **Grid aesthetics** — Grid lines are very subtle (0.5px, low opacity). Major gridlines slightly more visible than minor. The grid should be barely noticeable but immediately useful when aligning.

### Discoverability & Onboarding
- **Empty canvas state** — When no design is loaded, show a centered welcome message: large plant icon, "Start your design" heading, 3 action buttons (New Design, Open Design, Recent Files). Below: "Drag plants from the database panel, or use drawing tools to create zones." This guides first-time users.
- **Toolbar tooltips** — Rich tooltips (not just text): show tool name, keyboard shortcut, and a one-line description. Example: "Rectangle (R) — Draw rectangular zones for planting areas." Appear after 500ms hover delay. Positioned to the right of the vertical toolbar.
- **First tool use hints** — On the very first time a user activates a drawing tool, show a brief instruction overlay: "Click and drag to draw" (for rect/ellipse), "Click to add points, double-click to finish" (for polygon/line), "Click to place, Escape to stop" (for plant stamp). Dismiss on first successful use. Store "shown" state in user DB settings.
- **Keyboard shortcut hints** — When hovering over canvas operations in the command palette, show shortcuts. When a user performs an action by menu/button that has a shortcut, show a brief toast: "Tip: Press Ctrl+Z for undo" (only the first few times).
- **Contextual empty states** — Empty bottom panel tabs don't just say "nothing here": Timeline says "Add planting dates, pruning schedules, and harvest timing" with an Add Action button. Consortium says "Place companion plants to see relationships" with a link to the plant DB. Budget says "Track project costs for plants, materials, and labor."

### Accessibility (WCAG AA)
- **Keyboard navigation** — Every tool selectable via keyboard (V/H/R/E/P/F/L/T/M). Tab navigates between toolbar, canvas, layer panel, bottom panel. Within panels, arrow keys navigate items. Enter activates. Escape deselects/closes.
- **Focus indicators** — Visible focus ring (2px `var(--color-primary)` outline) on all interactive elements. Canvas objects: when navigated via keyboard, show selection ring.
- **ARIA attributes** — Canvas toolbar: `role="toolbar"`, tool buttons: `role="radio"` with `aria-checked`. Layer panel: `role="list"` with `role="listitem"`. Bottom panel tabs: `role="tablist"`/`role="tab"`/`role="tabpanel"`. Announce tool changes to screen readers: `aria-live="polite"` region.
- **Color contrast** — All text meets 4.5:1 contrast ratio against canvas background in both light and dark themes. Selection and hover indicators meet 3:1 against their background.
- **Minimum touch targets** — All toolbar buttons ≥32x32px. Layer panel controls ≥24x24px.
- **Reduced motion** — Respect `prefers-reduced-motion`: disable all micro-animations (fade, slide, shake), use instant show/hide instead.

### Error & Edge Case Handling
- **Failed save** — Don't just show "Error". Show: "Couldn't save to [path]. The file may be read-only or the disk may be full." with Retry and Save As buttons.
- **Corrupt .canopi file** — On load failure: "This file appears to be damaged. Would you like to try loading a backup (.canopi.prev)?" with options.
- **Missing plant in .canopi** — If a loaded design references a `canonical_name` not in the plant DB: show the plant as a gray circle with "?" icon and tooltip "Unknown plant: [name]. This species may not be in your database." Don't crash or skip.
- **Large canvas warning** — If user places 500+ objects, show a non-blocking info bar: "Large design — consider using layers to organize and hide inactive areas for best performance."
- **Unsaved changes on panel switch** — If user switches from canvas panel to plant DB panel with unsaved changes: subtle amber dot on the canvas tab icon (not a blocking dialog — panel switching should be instant).

---

## Dependency Graph

```
2a: Canvas Infrastructure (Engine, Stage, Zoom/Pan)
 ├── 2b: Toolbar UI + Tool Switching
 │    └── 2c: Drawing Tools (Shapes, Lines, Text)
 │         └── 2d: Selection + Object Operations
 │              └── 2e: Undo/Redo (Command Pattern)
 │                   └── 2f: Plant Placement (D&D, Stamps, LOD)
 │                        ├── 2g: Layer System UI
 │                        ├── 2k: Bottom Panel (Timeline, Consortium, Budget)
 │                        └── 2m: Polish (Right Panel, Dark Theme, Stubs)
 ├── 2j: Grid, Rulers, Scale Bar, Compass  ← parallel with 2b
 └── 2h: File Ops Backend (Save/Load)      ← parallel with 2b
      └── 2i: File Ops Frontend (Dialogs, Auto-save)
           └── 2l: Export/Import (PNG, SVG, CSV, Background)
```

**Parallelization**: 2h + 2j can start in parallel with 2b after 2a. 2k can start after 2f in parallel with 2g.

---

## Sub-Phase 2a: Canvas Infrastructure (CanvasEngine + Stage + Zoom/Pan)

**Invoke**: `/canopi-canvas`, `/craft` (CanvasEngine lifecycle: resource cleanup on destroy, event listener disposal, ResizeObserver disconnect, HMR safety)
**Context7**: `/konvajs/site` — Stage constructor, Layer creation, wheel event for zoom, `setPointersPositions`, `getPointerPosition`, `scale()`, `position()`, `draggable`, `batchDraw()`, `destroy()`
**Agent**: `canopi-frontend-dev`
**Depends on**: Nothing

### Create
- `desktop/web/src/canvas/engine.ts` — `CanvasEngine` class: Stage creation on container ref, 7 named layers (`Map<string, Konva.Layer>`), zoom (Ctrl+scroll, factor 1.05/tick, min 0.1 max 10, zoom-toward-pointer with `requestAnimationFrame` throttle), pan (Space+drag toggles `stage.draggable`), `zoomToFit()`, `destroy()` (must call `stage.destroy()` to free all resources), `ResizeObserver` handler. Set `listening: false` on decorative layers (grid, rulers). Exports singleton.
- `desktop/web/src/canvas/tools/base.ts` — `CanvasTool` interface: `name`, `cursor`, `activate(engine)`, `deactivate(engine)`, `onMouseDown(e)`, `onMouseMove(e)`, `onMouseUp(e)`, `onKeyDown(e)`.
- `desktop/web/src/canvas/tools/select.ts` — `SelectTool`: basic click-to-select, Transformer for handles, deselect on empty click.
- `desktop/web/src/canvas/tools/hand.ts` — `HandTool`: cursor grab/grabbing, stage drag.
- `desktop/web/src/state/canvas.ts` — Signals: `activeTool`, `zoomLevel`, `activeLayers`, `selectedObjectIds`, `canvasReady`. Effect syncing `activeLayers` to Konva layer visibility.
- `desktop/web/src/state/design.ts` — Signals: `designDirty`, `designPath`, `designName`, `currentDesign` (CanopiFile | null).
- `desktop/web/src/types/design.ts` — TS interfaces mirroring `common-types/src/design.rs`.

### Modify
- `desktop/web/src/components/panels/CanvasPanel.tsx` — Replace stub: canvas container div (`useRef` + `useEffect` to init/destroy engine), `ResizeObserver` for responsive sizing. **Empty canvas state**: centered welcome (plant icon, "Start your design" heading, New/Open/Recent buttons, "Drag plants from the database" hint). Fades out on first interaction.
- `desktop/web/src/components/panels/Panels.module.css` — Add `.canvasPanel` (no padding, `position: relative`, flex: 1, overflow: hidden), `.canvasEmptyState` (centered overlay).

### Performance
- Zoom handler guarded by `requestAnimationFrame` — drop intermediate wheel events, one scale update per frame.
- `listening: false` on grid/ruler layers — no hit detection overhead.
- `ResizeObserver` callback debounced (resize → `requestAnimationFrame` → `stage.size()`).

### Verify
```bash
cd desktop/web && npx tsc --noEmit
cargo tauri dev
# Canvas shows empty Konva stage. Ctrl+scroll zooms smoothly (no jank). Space+drag pans. Resize: no flicker.
```

---

## Sub-Phase 2b: Canvas Toolbar UI + Tool Switching

**Invoke**: `/canopi-ux`, `/canopi-i18n`, `/canopi-canvas`
**Context7**: `/konvajs/site` — `stage.container().style.cursor`
**Agent**: `canopi-frontend-dev`
**Depends on**: 2a

### Create
- `desktop/web/src/components/canvas/CanvasToolbar.tsx` — Vertical toolbar (40px, left of canvas). Buttons: Select (V), Hand (H), Rectangle (R), Ellipse (E), Polygon (P), Freeform (F), Line (L), Text (T), Measure (M), Plant Stamp. Active tool: highlighted background + left accent bar. **Rich tooltips** (500ms delay): tool name, shortcut key, one-line description (e.g., "Rectangle (R) — Draw rectangular zones"). `role="toolbar"`, buttons `role="radio"` with `aria-checked`. Tab focuses toolbar, arrow keys navigate tools.
- `desktop/web/src/components/canvas/CanvasToolbar.module.css` — 40px width, vertical stack, design tokens. Box shadow to float above canvas. Hover: subtle background tint. Active: `var(--color-primary)` left border + background. Transition: 100ms background-color ease.
- `desktop/web/src/components/canvas/toolbar-icons.tsx` — SVG icon components (20x20, single-color, `currentColor` fill for theme adaptation).

### Modify
- `CanvasPanel.tsx` — Flex row: `CanvasToolbar` | canvas container.
- `shortcuts/manager.ts` — Canvas-only shortcuts (V/H/R/E/P/F/L/T/M), guarded by `activePanel.value === 'canvas'`.
- `commands/registry.ts` — Canvas tool commands for command palette.
- `state/canvas.ts` — Tool switching: signal change deactivates old, activates new.
- All 6 i18n locale files — `canvas.tools.*` keys (~10 per locale).
- `styles/global.css` — Canvas tokens: `--canvas-toolbar-width`, `--canvas-bg`, `--canvas-grid`, `--canvas-ruler-bg`, `--canvas-ruler-text` with dark variants.

### Verify
```bash
cd desktop/web && npx tsc --noEmit && npm run build
cargo tauri dev
# Toolbar visible left of canvas. Click tools + press shortcut keys: tool switches, cursor changes. Tooltips localized.
```

---

## Sub-Phase 2c: Drawing Tools (Shapes, Lines, Text)

**Invoke**: `/canopi-canvas`
**Context7**: `/konvajs/site` — `Konva.Rect`, `Konva.Ellipse`, `Konva.Line` (closed/open), `Konva.Path`, `Konva.Text`, `Konva.Transformer`, node events, `setAttrs()`, `batchDraw()`
**Agent**: `canopi-frontend-dev`
**Depends on**: 2b

### Create
- `desktop/web/src/canvas/tools/rectangle.ts` — Click+drag draws preview rect (dashed stroke, semi-transparent fill during draw → solid on release), mouseup finalizes `Konva.Rect` on `zones` layer. Shift constrains to square. Cursor: crosshair. **First-use hint**: "Click and drag to draw a rectangle" (shown once, stored in user DB).
- `desktop/web/src/canvas/tools/ellipse.ts` — Same pattern, `Konva.Ellipse`. Shift = circle. Dashed preview during draw.
- `desktop/web/src/canvas/tools/polygon.ts` — Click adds vertices (`Konva.Line` `closed: true`), double-click/click-first-vertex closes. Preview line follows cursor with dashed stroke. Escape cancels. Vertices shown as small circles during drawing. **First-use hint**: "Click to add points, double-click to finish."
- `desktop/web/src/canvas/tools/freeform.ts` — Mousedown starts, mousemove appends points, mouseup finalizes. Point reduction for smoothing. Line drawn in real-time with smooth stroke.
- `desktop/web/src/canvas/tools/line.ts` — Click for vertices (open `Konva.Line`), double-click finishes. Dashed preview segment.
- `desktop/web/src/canvas/tools/text.ts` — Click places inline textarea overlay (HTML over canvas, styled to match canvas context), Enter confirms → `Konva.Text` on `annotations` layer. Escape cancels. Auto-focus textarea on placement.
- `desktop/web/src/canvas/tools/measure.ts` — Click two points, show distance in meters with a styled label (background pill, clear typography). Real-time preview line with dimension readout updating as cursor moves. Uses canvas scale for conversion.
- `desktop/web/src/canvas/shapes.ts` — Factory functions: styled Konva shapes with defaults (design token colors, consistent strokes). Each shape gets `id = crypto.randomUUID()`.

### Modify
- `canvas/engine.ts` — `setActiveTool(tool)` wiring mouse/key events to active tool. `getLayerForTool(toolName)` mapping. `addNode(layerName, node)` and `removeNode(id)`.
- `state/canvas.ts` — Register all tool instances. Map tool name → instance.

### Performance
- Drawing preview (mousemove during shape creation): operate on a single preview node, mutate attrs in-place, one `batchDraw()` per `requestAnimationFrame`. Don't create/destroy nodes during preview.
- Freeform tool: collect points in a plain array, only set `Konva.Line.points()` every 3rd mousemove (or via `requestAnimationFrame`). Apply Ramer-Douglas-Peucker simplification on mouseup to reduce final point count.

### Verify
```bash
cargo tauri dev
# R: draw rectangles. E: ellipses. P: polygon (click vertices, double-click close).
# F: freehand. L: polyline. T: text (type, Enter confirms). M: measure distance.
```

---

## Sub-Phase 2d: Selection + Object Operations

**Invoke**: `/canopi-canvas`, `/craft` (multi-select edge cases: empty selection, single→multi transition, locked nodes in selection, operations on mixed node types, clipboard data validation)
**Context7**: `/konvajs/site` — `Transformer` (multi-node, `keepRatio`, `rotationSnaps`, `boundBoxFunc`), `moveToTop()`/`moveToBottom()`, `zIndex()`, `draggable()`, `node.clone()`, `Util.getClientRect()`
**Agent**: `canopi-frontend-dev`
**Depends on**: 2c

### Modify
- `canvas/tools/select.ts` — Full rewrite: single click, Shift+click multi-select, rubber band area select (semi-transparent blue rectangle with `var(--canvas-selection)` fill), Transformer on all selected (filled circle corner handles, filled square edge handles, rotation handle with arc indicator above), rotation 15-deg snaps (with subtle angle readout during rotate), update `selectedObjectIds` signal. **Hover states**: objects show faint highlight (1px primary outline at 30% opacity) on mouseover to signal interactivity. Locked objects: no hover, `cursor: not-allowed`.
- `canvas/engine.ts` — Add: `getSelectedNodes()`, `deleteSelected()`, `duplicateSelected()` (+20px offset), `copyToClipboard()`/`pasteFromClipboard()` (module-level JSON, not system clipboard), `rotateSelected(deg)`, `flipSelected('h'|'v')`, `bringToFront()`/`sendToBack()`, `lockSelected()`/`unlockSelected()` (set `draggable(false)` + custom `locked` attr), `selectAll()`.
- `state/canvas.ts` — `lockedObjectIds` signal, `clipboardData` signal.

### Create
- `desktop/web/src/canvas/operations.ts` — `computeSelectionRect()`, `nodesInRect()`, `serializeNodes()`, `deserializeNodes()`.

### Shortcuts
- `shortcuts/manager.ts` — Canvas-only: Ctrl+C/V/D, Delete, Ctrl+A, `[`/`]` (z-order), Ctrl+L (lock).
- All 6 i18n locale files — `canvas.operations.*` keys.

### Performance
- Rubber band selection: use bounding-box pre-filter (`Konva.Util.getClientRect()`), don't test every pixel. For 200+ nodes, implement grid-based spatial index.
- Transformer: limit to ≤50 attached nodes. Beyond that, show a simple bounding rect with move/scale handles (no individual node handles).
- `selectAll()`: gather nodes once, attach Transformer in one call — not iteratively.
- Copy/paste serialization: `JSON.stringify` only the minimal attrs needed (position, size, type, fill, stroke), not the full Konva node tree.

### Verify
```bash
cargo tauri dev
# Click: select. Shift+click: multi-select. Rubber band: area-select (smooth even with 100+ nodes).
# Ctrl+C/V: copy/paste. Delete: remove. Rotate handles: 15-deg snaps. Ctrl+L: lock. ]/[: z-order.
```

---

## Sub-Phase 2e: Undo/Redo (Command Pattern)

**Invoke**: `/canopi-canvas`, `/craft` (command pattern correctness: execute/undo symmetry, batch command atomicity, history corruption on failed undo, interaction with designDirty signal, stack overflow with deep history)
**Context7**: `/konvajs/site` — `node.attrs`, `node.setAttrs()`
**Agent**: `canopi-frontend-dev`
**Depends on**: 2d

### Create
- `desktop/web/src/canvas/history.ts` — `CanvasHistory`: past/future stacks, `execute(cmd, engine)`, `undo(engine)`, `redo(engine)`, `clear()`, `canUndo`/`canRedo` computed signals. Sets `designDirty = true` on execute.
- `desktop/web/src/canvas/commands/add-node.ts` — Stores serialized attrs + layer. Execute: create & add. Undo: remove by id.
- `desktop/web/src/canvas/commands/remove-node.ts` — Inverse of add-node.
- `desktop/web/src/canvas/commands/move-node.ts` — Stores id, from/to position.
- `desktop/web/src/canvas/commands/transform-node.ts` — Stores id, old/new attrs (x, y, scaleX, scaleY, rotation).
- `desktop/web/src/canvas/commands/batch.ts` — Wraps array of commands for atomic multi-select operations.
- `desktop/web/src/canvas/commands/index.ts` — Barrel export.

### Modify
- `canvas/engine.ts` — Every mutating method now creates & executes a Command through `canvasHistory`.
- All drawing tools (`rectangle.ts`, `ellipse.ts`, etc.) — On finalize, create `AddNodeCommand` via history.
- `canvas/tools/select.ts` — On drag/transform end, create `MoveNodeCommand`/`TransformNodeCommand`. Capture old state on start.
- `shortcuts/manager.ts` — Ctrl+Z (undo), Ctrl+Shift+Z (redo).
- `state/canvas.ts` — Export `canUndo`, `canRedo` from history.

### Verify
```bash
cargo tauri dev
# Draw rect. Ctrl+Z: disappears. Ctrl+Shift+Z: reappears.
# Move shape. Undo: returns. Multi-delete + undo: all return. New action clears redo.
```

---

## Sub-Phase 2f: Plant Placement (Drag-and-Drop, Stamps, LOD, Symbols)

**Invoke**: `/canopi-canvas`, `/craft` (DOM-to-Konva coordinate transform correctness across zoom/pan states, handling null/missing stratum/width_max_m, duplicate plant placement, drag data validation)
**Context7**: `/konvajs/site` — `stage.setPointersPositions(domEvent)`, `getPointerPosition()`, `Konva.Group`, `Konva.Circle`, `Konva.Text`, `node.scale()`, `layer.find()`, zoom-based visibility
**Agent**: `canopi-frontend-dev`
**Depends on**: 2e

### Create
- `desktop/web/src/canvas/plants.ts` — `createPlantNode(canonicalName, commonName, stratum, canopySpreadM, position)`: `Konva.Group` with circle (sized to canopy spread in meters), genus abbreviation label, strata-based colors (emergent=#1B5E20, canopy=#2E7D32, understory=#558B2F, shrub=#7CB342, herbaceous=#C0CA33, ground cover=#D4A843, vine=#7B1FA2, root=#6D4C41). `getPlantLOD(zoom)`: dot (<0.3), icon (0.3–1.5), icon+label (>1.5).
- `desktop/web/src/canvas/tools/plant-stamp.ts` — `PlantStampTool`: each click places plant from `plantStampSpecies` signal. Continues until deactivated/Escape.
- `desktop/web/src/canvas/commands/add-plant.ts` — `AddPlantCommand`.
- `desktop/web/src/canvas/commands/move-plant.ts` — `MovePlantCommand`.

### Modify
- `canvas/engine.ts` — `setupDrop()`: listen `dragover`/`drop` on container. On `dragover`: show **ghost plant preview** (semi-transparent circle at cursor position sized to plant's canopy spread, updates every frame). On `drop`: parse drag JSON, `setPointersPositions`, coordinate transform (`canvasX = (pointerX - stage.x()) / stage.scaleX()`), create plant via `AddPlantCommand` with brief scale-up animation (0.9→1.0, 100ms). On `dragleave`: remove ghost. `updateLOD()`: on zoom, adjust plant rendering. `getPlacedPlants()`: serialize to `PlacedPlant[]`.
- `state/canvas.ts` — `plantStampSpecies` signal. Effect calling `updateLOD()` on `zoomLevel` change.
- `canvas/tools/select.ts` — Plant click sets `rightPanelPlant` signal.
- **`components/plant-db/PlantRow.tsx`** — Augment drag data: add `stratum` and `width_max_m` to JSON payload (currently only has `canonical_name`, `common_name`).

### Performance
- **LOD is the key optimization** — at far zoom, plants are simple circles (no text, no group children). Only at close zoom do labels render. Threshold crossing triggers a batch update via `requestAnimationFrame`, not per-node.
- LOD update debounced to 150ms after zoom stops (not on every wheel tick). Also triggers on crossing threshold boundaries immediately.
- Plant stamp tool: pre-create a pool of plant node templates. Placing = clone from pool (fast) rather than construct from scratch.
- `updateLOD()`: iterate only the plants layer (`plantsLayer.getChildren()`), set `visible(false)` on text children at low zoom — don't destroy/recreate nodes.
- Drag from DB: DOM `dragover` fires at 60Hz — handler must be trivial (just `preventDefault()`). Only do real work on `drop`.

### Verify
```bash
cargo tauri dev
# Drag plant from DB panel to canvas: circle appears at drop position, sized to canopy.
# Click plant: Transformer. Zoom out smoothly: plants become dots (no jank). Zoom in: labels appear.
# Place 100 plants via stamp tool: still smooth zoom/pan.
```

---

## Sub-Phase 2g: Layer System UI

**Invoke**: `/canopi-ux`, `/canopi-i18n`, `/canopi-canvas`
**Context7**: `/konvajs/site` — `layer.visible()`, `layer.opacity()`, `moveToTop()`/`moveToBottom()`
**Agent**: `canopi-frontend-dev`
**Depends on**: 2f

### Create
- `desktop/web/src/components/canvas/LayerPanel.tsx` — Right sidebar (~200px, collapsible). 7 layers: eye toggle (visibility), lock toggle, opacity slider, name (i18n), drag-to-reorder. Active layer highlighted.
- `desktop/web/src/components/canvas/LayerPanel.module.css`

### Modify
- `CanvasPanel.tsx` — Add LayerPanel right of canvas (flex row: toolbar | canvas | layerPanel).
- `state/canvas.ts` — `layerPanelOpen` signal, full layer state `{ name, visible, locked, opacity }[]`, `activeLayerName` signal. Effects syncing to Konva.
- `canvas/engine.ts` — `setLayerVisibility()`, `setLayerOpacity()`, `reorderLayer()`.
- All 6 i18n locale files — `canvas.layers.*` keys.

### Verify
```bash
cargo tauri dev
# Layer panel visible. Eye toggle hides/shows. Opacity slider works. Lock prevents selection. Reorder changes z-order.
```

---

## Sub-Phase 2h: File Operations — Backend

**Invoke**: `/canopi-rust`, `/canopi-db`, `/craft` (atomic file writes: temp→rename with cleanup on failure, backup before overwrite, corrupt file recovery, autosave pruning race conditions, error messages with actionable context, file path validation, serde forward-compat with unknown fields)
**Context7**: `/websites/v2_tauri_app` — `tauri_plugin_dialog` `FileDialogBuilder`, `app.path().app_data_dir()`, Tauri events. `/rusqlite/rusqlite` — prepared statements for recent_files.
**Agent**: `canopi-backend-dev`
**Depends on**: 2a (design types exist). **Can run in parallel with 2b–2f.**

### Create
- `desktop/src/design/format.rs` — `save_to_file(path, content)`: atomic write (`.canopi.tmp` → rename), backup to `.canopi.prev`. `load_from_file(path)`: read + deserialize + version validate. `create_default()`: empty design with 7 default layers, version 1.
- `desktop/src/design/autosave.rs` — `autosave_dir(app)`, `autosave(app, content, design_path)` (max 5 files, prune oldest), `list_autosaves(app)`, `recover_autosave(app, path)`.
- `desktop/src/db/recent_files.rs` — `record_recent_file(conn, path, name)` (upsert), `get_recent_files(conn, limit)`, `remove_recent_file(conn, path)`.

### Modify
- `desktop/src/commands/design.rs` — Replace stubs: `save_design` (dialog if no path, atomic write, record recent), `load_design` (load + record recent), add `save_design_as`, `new_design`, `get_recent_files`, `open_design_dialog`, `autosave_design`, `list_autosaves`.
- `desktop/src/design/mod.rs` — `pub mod format; pub mod autosave;`
- `desktop/src/db/mod.rs` — `pub mod recent_files;`
- `desktop/src/lib.rs` — Register new commands in `generate_handler![]`.
- `common-types/src/design.rs` — Add `#[serde(flatten)] pub extra: HashMap<String, serde_json::Value>` to `CanopiFile`. Add `AutosaveEntry` struct.

### Verify
```bash
cargo check --workspace
cargo test -p canopi-desktop  # Round-trip save/load, recent_files CRUD
```

---

## Sub-Phase 2i: File Operations — Frontend

**Invoke**: `/canopi-ux`, `/canopi-i18n`, `/canopi-canvas`, `/craft` (serializer round-trip fidelity: verify toCanopi→fromCanopi preserves all node attrs including custom data; auto-save timer cleanup on unmount; race condition between manual save and auto-save; close-requested handler edge cases; IPC error handling with user-friendly messages)
**Context7**: `/websites/v2_tauri_app` — `@tauri-apps/api/core` invoke, `@tauri-apps/api/event` `onCloseRequested`
**Agent**: `canopi-frontend-dev`
**Depends on**: 2h, 2f

### Create
- `desktop/web/src/canvas/serializer.ts` — `toCanopi(engine, metadata)`: serialize all layers to CanopiFile (plants→PlacedPlant[], zones→Zone[], text→annotations). `fromCanopi(file, engine)`: clear engine, recreate all nodes. Preserves `extra` fields.
- `desktop/web/src/ipc/design.ts` — Typed wrappers: `saveDesign`, `loadDesign`, `saveDesignAs`, `newDesign`, `getRecentFiles`, `openDesignDialog`, `autosaveDesign`, `listAutosaves`.

### Modify
- `state/design.ts` — Actions: `saveCurrentDesign()`, `saveAsCurrentDesign()`, `openDesign()`, `newDesignAction()`, `loadDesignFromPath(path)`.
- `shortcuts/manager.ts` — Ctrl+S, Ctrl+Shift+S, Ctrl+O, Ctrl+N.
- `commands/registry.ts` — File commands for palette.
- `components/shared/StatusBar.tsx` — Unsaved indicator: subtle amber dot + design name when `designDirty`. Zoom percentage display. Design name shows full path on hover tooltip.
- `CanvasPanel.tsx` — Auto-save timer (`setInterval(60000)`, check `designDirty`, HMR-safe cleanup). Autosave recovery check on mount.
- `app.tsx` — Wire `onCloseRequested`: if dirty, show 3-button dialog (Save/Don't Save/Cancel).
- All 6 i18n locale files — `canvas.file.*` keys (~12 per locale).
- `styles/global.css` — `--color-dirty-indicator` token.

### Performance
- **Auto-save must not cause UI stutter.** Serialize to JSON string in chunks via `setTimeout(fn, 0)` yielding between layers, or offload to a Web Worker. Never block the main thread for >5ms during serialization.
- `fromCanopi()` (loading a design): batch-create all Konva nodes, then one `batchDraw()` per layer. Don't draw after each node.
- IPC payload: send the JSON string directly to Rust — don't double-serialize. Rust writes the string as-is.
- Save-before-close dialog: check `designDirty` before any serialization — if clean, close immediately (no work).

### Verify
```bash
cargo tauri dev
# Ctrl+N: new. Draw + Ctrl+S: save dialog (first time), silent save after.
# Ctrl+Shift+S: save-as. Ctrl+O: open. Status bar: name + dirty dot.
# Auto-save at 60s: NO visible pause/jank during auto-save. Close with changes: dialog.
```

---

## Sub-Phase 2j: Grid, Rulers, Scale Bar, Compass

**Invoke**: `/canopi-canvas`
**Context7**: `/konvajs/site` — `Konva.Shape` with custom `sceneFunc` for grid, `Konva.Line`, `Konva.Text`, `Konva.Arrow`, `node.rotation()`, performance patterns
**Agent**: `canopi-frontend-dev`
**Depends on**: 2a. **Can run in parallel with 2b.**

### Create
- `desktop/web/src/canvas/grid.ts` — **Single `Konva.Shape` with custom `sceneFunc`** (all lines in one canvas 2D path — NOT individual `Konva.Line` nodes). This is the critical perf decision: 1000 grid lines as individual nodes = lag, 1 shape drawing 1000 lines = instant. Configurable: 0.5m/1m/2m/5m. Snap-to-grid via `dragmove` rounding. Adaptive: at far zoom only draw major gridlines (every 5m/10m), skip minor ones entirely.
- `desktop/web/src/canvas/rulers.ts` — Top + left rulers as Konva layers fixed to edges (not scrolling). Also use custom `sceneFunc` (not individual text/line nodes). Tick marks + meter labels, scaled to zoom. Redraw via `requestAnimationFrame` on pan/zoom (one frame debounce).
- `desktop/web/src/canvas/scale-bar.ts` — Fixed bottom-left. Round distance numbers (1m/2m/5m/10m/20m/50m/100m). Updates on zoom.
- `desktop/web/src/canvas/compass.ts` — Draggable `Konva.Group` (top-right default). Rotatable for north bearing. Compass rose SVG as Konva shapes + "N" label.

### Modify
- `canvas/engine.ts` — Init grid/rulers/scale-bar/compass. Methods: `setGridSize()`, `toggleSnapToGrid()`, `toggleGrid()`, `toggleRulers()`.
- `state/canvas.ts` — Signals: `gridSize` (1), `snapToGrid` (false), `gridVisible` (true), `rulersVisible` (true), `northBearingDeg` (0).
- `state/design.ts` — `northBearingDeg` synced with compass widget.
- `CanvasToolbar.tsx` — Grid/ruler toggle buttons (bottom of toolbar).
- All 6 i18n locale files — `canvas.grid.*` keys.

### Performance
- Grid + rulers use custom `sceneFunc` (canvas 2D API directly) — zero Konva node overhead. One shape per overlay.
- Grid layer has `listening: false` and `hitGraphEnabled: false` — no hit detection cost.
- Ruler layer cached (`layer.cache()`) and only re-cached on zoom/pan change.
- Adaptive grid density: at zoom <0.3, skip minor gridlines entirely. At zoom <0.1, hide grid.
- Snap-to-grid in `dragmove`: simple modular arithmetic, no Konva API calls — runs at 60fps.

### Verify
```bash
cargo tauri dev
# Grid visible at 1m — zoom in/out: no jank even at 0.5m grid. Toggle snap: shapes snap smoothly.
# Rulers redraw without flicker during pan. Scale bar updates. Compass responsive.
```

---

## Sub-Phase 2k: Bottom Panel (Timeline, Consortium, Budget)

**Invoke**: `/canopi-ux`, `/canopi-i18n`
**Agent**: `canopi-frontend-dev`
**Depends on**: 2f

### Create
- `desktop/web/src/components/canvas/BottomPanel.tsx` — Collapsible (200ms slide animation, respect `prefers-reduced-motion`), resizable (drag handle with `cursor: row-resize`, min 120px, max 60% canvas). Tab bar: Timeline | Consortium | Budget. `role="tablist"` / `role="tab"` / `role="tabpanel"` ARIA. Tab switch is instant (lazy mount, but no visible transition delay).
- `desktop/web/src/components/canvas/BottomPanel.module.css`
- `desktop/web/src/components/canvas/TimelineTab.tsx` — Table of `TimelineAction` items: type, description, dates, plants, completion checkbox. Add/edit/delete. Empty state.
- `desktop/web/src/components/canvas/ConsortiumTab.tsx` — Auto-detected companions/antagonists from placed plants (using existing `getSpeciesRelationships` IPC). Synergies (green) / conflicts (red). Manual consortium creation. Empty state.
- `desktop/web/src/components/canvas/BudgetTab.tsx` — Table of `BudgetItem` entries: category, description, qty, unit cost, total. Auto-total row. Currency selector (default EUR). Empty state.

### Modify
- `CanvasPanel.tsx` — Add BottomPanel below canvas (flex column).
- `state/canvas.ts` — `bottomPanelOpen`, `bottomPanelTab`, `bottomPanelHeight` signals.
- `state/design.ts` — CRUD actions for timeline/consortium/budget arrays (through undo/redo commands).
- `canvas/commands/` — Add `AddTimelineActionCommand`, `RemoveTimelineActionCommand`, `AddBudgetItemCommand`, `RemoveBudgetItemCommand`, `AddConsortiumCommand`.
- All 6 i18n locale files — `canvas.bottomPanel.*`, `canvas.timeline.*`, `canvas.consortium.*`, `canvas.budget.*` (~30 keys).

### Performance
- Consortium auto-detection: debounce 500ms after plant add/remove. Cache relationship lookup results (map of canonical_name → relationships). Only re-query IPC for newly added plants.
- Bottom panel resize: CSS-driven resize only (adjust `height` style), don't re-layout the canvas. Canvas `ResizeObserver` handles stage resize independently.
- Tab switching: lazy-render tab content (don't mount all 3 tabs, mount active tab only).

### Verify
```bash
cargo tauri dev
# Bottom panel: expand, 3 tabs. Timeline: add/edit/delete actions. Consortium: auto-detect from placed plants.
# Budget: add items, auto-total. Resize handle smooth (no canvas jank). Undo/redo works for data.
```

---

## Sub-Phase 2l: Export/Import

**Invoke**: `/canopi-canvas`, `/canopi-rust`, `/canopi-i18n`, `/craft` (SVG generation correctness: handle all shape types including freeform paths; CSV escaping for plant names with commas/quotes; background image size validation and memory management; export error handling with specific messages)
**Context7**: `/konvajs/site` — `stage.toDataURL({ pixelRatio })`, `stage.toCanvas()`. `/websites/v2_tauri_app` — file dialog for export path.
**Agent**: `canopi-frontend-dev` + `canopi-backend-dev`
**Depends on**: 2i

### Create
- `desktop/web/src/canvas/export.ts` — `exportPNG(engine, { pixelRatio })`: `stage.toDataURL` → Blob (native rendering deferred to Phase 3). `exportSVG(engine)`: manual mapping Konva→SVG elements. `exportPlantCSV(engine)`: iterate plants layer → CSV.
- `desktop/web/src/canvas/import.ts` — `importBackgroundImage(engine, file)`: `Konva.Image` on `base` layer, draggable, scalable, opacity control, via `AddNodeCommand`.
- `desktop/src/commands/export.rs` — `export_png(app, data, path)`, `export_svg(app, svg, path)`, `export_csv(app, csv, path)`: receive data from frontend, write via dialog.

### Modify
- `ipc/design.ts` — Add `exportPng`, `exportSvg`, `exportCsv` wrappers.
- `desktop/src/commands/mod.rs` — `pub mod export;`
- `desktop/src/lib.rs` — Register export commands.
- `commands/registry.ts` — Export commands in palette.
- All 6 i18n locale files — `canvas.export.*` keys.

### Verify
```bash
cargo tauri dev
# Export PNG: saves viewable file. Export SVG: viewable in browser. Export CSV: valid plant list.
# Import background: image on base layer, draggable/scalable.
```

---

## Sub-Phase 2m: Polish (Right Panel, Dark Theme, Recent Files, Stubs)

**Invoke**: `/canopi-ux`, `/canopi-canvas`, `/canopi-i18n`
**Agent**: `canopi-frontend-dev`
**Depends on**: 2f, 2g, 2l

### Create
- `desktop/web/src/components/canvas/RightPanel.tsx` — Overlay slide-in from right (200ms ease-out, max 380px, box shadow `0 2px 12px rgba(0,0,0,0.15)`). Shows `PlantDetailCard` (reused from Phase 1) for clicked plant's `canonical_name`. Escape/click-away closes with slide-out. Focus trap when open (Tab cycles within panel). Close button + Escape both work.
- `desktop/web/src/components/canvas/RightPanel.module.css`

### Modify
- `CanvasPanel.tsx` — Conditional RightPanel when `rightPanelPlant.value !== null`.
- `state/canvas.ts` — `rightPanelPlant` signal. Clear on Escape/deselect.
- `canvas/engine.ts` — Plant click → `rightPanelPlant` signal. Theme effect: update stage bg, grid, ruler colors on `theme` change.
- `styles/global.css` — Canvas dark theme tokens: `--canvas-bg` (#F5F3F0 / #1E2126), `--canvas-grid` (rgba variants), `--canvas-selection`.
- `components/panels/SavedDesignsPanel.tsx` — Wire to `getRecentFiles` IPC. Show recent .canopi files list: file name (bold), relative date ("2 hours ago"), path (muted, truncated). Click to open. Hover: subtle row highlight. Empty state: "No recent designs. Create your first design from the canvas panel." Remove button on hover (with confirmation) for files that no longer exist.
- All 6 i18n locale files — Remaining keys.

### Stubs (deferred to Phase 3)
- Native file watching (FSEvents/ReadDirectoryChanges/inotify) — comment in CanvasPanel
- Sun direction widget (solar position math) — comment in engine
- Native PNG export (Core Graphics/Direct2D/Cairo) — comment in export.ts

### Verify
```bash
cd desktop/web && npx tsc --noEmit && npm run build
cargo tauri dev
# Click plant: right panel with PlantDetailCard. Escape: closes.
# Toggle dark: canvas bg/grid/rulers adapt. Saved Designs: recent files, click to open.
```

---

## End-to-End Verification

After all sub-phases:
1. `cargo check --workspace` — clean
2. `cd desktop/web && npx tsc --noEmit` — no errors
3. `cd desktop/web && npm run build` — success
4. `cargo tauri dev` — full flow: New → draw zones → place plants from DB → timeline actions → save .canopi → close → reopen → all data preserved
5. Undo/redo for all operations
6. Export PNG/SVG/CSV produce valid output
7. Import background image works
8. Auto-save fires at 60s dirty
9. Dark/light canvas theme adaptation
10. Grid/rulers/scale bar/compass render and adapt to zoom
11. Layer visibility/opacity/lock/reorder all work
12. Right panel shows plant detail
13. Recent files in Saved Designs sidebar

### Performance Stress Test
14. **Create test design**: 300 plants + 100 zone shapes + grid (1m) + rulers visible
15. **Zoom/pan**: smooth at ≥30fps (Chrome DevTools Performance tab, no frames >33ms)
16. **Rubber band select all**: completes in <100ms
17. **Auto-save with 400 objects**: no visible pause (main thread unblocked)
18. **Load large .canopi file**: canvas renders in <500ms
19. **Memory**: no leaks after creating/destroying canvas panel 5 times (navigate away and back)

## Post-Implementation

### Review Round (after all sub-phases complete)
1. Run `/craft` with two parallel `canopi-reviewer` agents:
   - **Backend reviewer**: Rust commands (atomic save correctness, error propagation, mutex poison recovery, serde round-trip, autosave race conditions), DB queries (prepared statements, no string SQL), Cargo.toml (no unnecessary deps)
   - **Frontend reviewer**: Konva patterns (batchDraw usage, event cleanup, memory leaks), signal usage (no stale closures, HMR safety, effect disposers), CSS (tokens only, no raw values, dark mode coverage), i18n (all keys in all 6 locales), a11y (ARIA roles, keyboard nav, focus management, contrast), performance (throttled handlers, non-blocking serialization)
2. Fix all issues found, re-review until convergence (typically 2 rounds)

### Per-Sub-Phase Craft Reviews
Run `/craft` inline during these critical sub-phases (not just at the end):
- **After 2a**: Engine lifecycle — resource cleanup, destroy(), HMR dispose
- **After 2e**: Undo/redo — command symmetry, edge cases (undo with empty stack, redo after new action)
- **After 2h**: File ops backend — atomic save, error paths, backup, autosave pruning
- **After 2i**: Serializer — round-trip fidelity test (create design → save → load → compare)

### Retrospective
3. Run `/canopi-retro` to capture learnings into canvas skill
