# Phase 3 — Canvas Advanced + Location

Historical phase plan only. Its `CanvasEngine`-era implementation guidance is superseded by the live Scene runtime architecture.

> **Target file**: `docs/plans/phase-3-canvas-advanced-location.md`

## Context

Phase 0 (Scaffold), Phase 1 (Plant DB), Phase 2 (Design Canvas), and Phase 2.1 (Document Integrity) are complete. The app has: Tauri v2 + Preact shell, 175K-species plant DB with FTS5, Konva.js canvas with 10 tools (select, hand, rectangle, ellipse, polygon, freeform, line, text, measure), 7 named layers, plant drag-and-drop, zone drawing, undo/redo (500-cap command pattern), grid + rulers, compass + scale bar, LOD rendering, multi-select + Transformer, .canopi save/load with full document integrity, autosave, and dark/light theme.

Phase 3 adds advanced canvas features (alignment, grouping, plant stamp, display modes, minimap), map integration (MapLibre base map, location input), an interactive timeline, and annotation tools — making Canopi a competitive agroecological design tool.

Plant DB sidebar enhancements (collections, comparison, search presets) are out of scope for Phase 3. They belong in a separate future phase focused on the Plant DB panel.

---

## Tooling Protocol

Before writing code in any sub-phase, query **Context7** for up-to-date library documentation. Do not rely on training data or web sources.

| Sub-Phase | Skills | Context7 IDs |
|-----------|--------|--------------|
| 3a (Guides) | `/canopi-canvas`, `/canopi-ux` | `/konvajs/site` |
| 3b (Align/Distribute) | `/canopi-canvas` | `/konvajs/site` |
| 3c (Group/Ungroup) | `/canopi-canvas` | `/konvajs/site` |
| 3d (Plant Stamp) | `/canopi-canvas`, `/canopi-ux` | `/konvajs/site` |
| 3e (Pattern Fill) | `/canopi-canvas`, `/canopi-ux` | `/konvajs/site` |
| 3f (Arrow/Callout) | `/canopi-canvas` | `/konvajs/site` |
| 3g (Dimension Lines) | `/canopi-canvas` | `/konvajs/site` |
| 3h (Display Modes) | `/canopi-canvas`, `/canopi-ux`, `/canopi-rust` | `/konvajs/site`, `/rusqlite/rusqlite` |
| 3i (Minimap) | `/canopi-canvas`, `/canopi-ux` | `/konvajs/site` |
| 3j (Location/MapLibre) | `/canopi-canvas`, `/canopi-ux` | `/maplibre/maplibre-gl-js`, `/konvajs/site` |
| 3k (Celestial Dial) | `/canopi-canvas`, `/canopi-ux` | `/konvajs/site` |
| 3l (Consortium Builder) | `/canopi-canvas`, `/canopi-ux` | `/konvajs/site` |
| 3m (Interactive Timeline) | `/canopi-canvas`, `/canopi-ux` | `/konvajs/site` |
| 3n (GeoJSON/Export) | `/canopi-canvas`, `/canopi-rust` | `/websites/v2_tauri_app` |

After each sub-phase: run `/craft` with two parallel code-reviewer agents (backend + frontend). At session end: `/canopi:canopi-retro`.

Schema-bearing sub-phases (3-pre, 3c, 3g, 3l, 3n) require TS round-trip tests before marking complete.

---

## Scope: What's In vs Deferred

The architecture draft (lines 1341-1381) lists ~40 features under Phase 3. This plan includes **15 units of work** (1 prerequisite + 14 sub-phases: 3a through 3n) and defers features with **unmet prerequisites** to Phase 3.1+.

### Deferred to Phase 3.1+ (unmet prerequisites — not scope cuts)

| Feature | Prerequisite / Reason |
|---------|----------------------|
| Native high-DPI PNG export (Core Graphics/Direct2D/Cairo) | `lib-swift`/`lib-cpp`/`lib-c` are empty stubs — native bridge infrastructure doesn't exist yet. Current Konva `toDataURL` export works as interim. |
| PDF export via native libs (PDFKit/DirectWrite/Cairo) | Same native bridge prerequisite. |
| Native file watching (FSEvents/inotify/ReadDirectoryChanges) | Requires either Tauri fs-watch plugin or native lib integration. |
| Canvas rotation | Pervasive coordinate transform impact — rulers, grid, snap, selection, serialization ALL need rotation-aware math. High cost, rarely needed (north is almost always up in garden design). |
| Shadow projection | Needs both solar position math AND per-plant ray-casting. Better built on top of the sun widget (3k) once it exists. |
| Growth timeline slider (Year 0→Mature) | Requires growth-rate interpolation data not currently in the plant DB. Data modeling work needed first. |
| Elevation/contour layer (SRTM/Copernicus) | Heavy geo infrastructure — DEM tile processing, raster rendering pipeline. |
| Climate data overlay (temp zones, rainfall) | External data sources + tile rendering infrastructure not yet in place. |
| Relationship graph (visual network) | Needs graph visualization approach (force-directed layout or similar). Specialized UI work. |

All deferred features are buildable — they sequence after their foundation features exist.

Additionally deferred from Phase 3 review recommendations:

| Feature | Reason |
|---------|--------|
| Playwright E2E test suite | Requires `tauri-driver` setup, `data-testid` attributes on all interactive components, debug build pipeline, and CI integration. Manual testing covers Phase 3 validation for now. |
| CI asset size budget checks | Valuable for catching chunk growth regressions but not blocking. Post-build size script needed. |
| Plant DB sidebar enhancements (collections, comparison, search presets) | Independent of canvas work — belongs in a separate future phase. |

---

## Architectural Decisions

### AD-1: MapLibre + Konva Integration

MapLibre GL JS renders into its own WebGL canvas. Konva uses a 2D canvas stack. They cannot share a single element.

**Strategy**: MapLibre renders in a separate `<div>` positioned **behind** the Konva stage via CSS `z-index`. When map is active, the Konva base layer becomes transparent (no background fill). MapLibre viewport (center, zoom, bearing) is synchronized with Konva stage transforms on pan/zoom.

**Coordinate transform**: Local tangent plane projection linearized around the design's location (origin). `dx_meters = dlon * cos(lat) * 111320`, `dy_meters = dlat * 111320`. Module: `canvas/projection.ts`.

**Lazy loading**: MapLibre (~500KB) only instantiated when location is set AND map toggle is on.

### AD-2: Guide Lines

Guide lines are Konva.Line nodes on the annotations layer with `name: 'guide'`. Rendered with `strokeScaleEnabled: false`, extending across the full visible viewport. Snap-to-guides reuses the existing snap infrastructure from `_setupSnapToDrag`. Persisted via `extra` field in CanopiFile (forward-compatible).

### AD-3: Plant Display Modes

A `plantDisplayMode` signal controls rendering. When it changes, an effect iterates all `.plant-group` nodes and updates circle radius (canopy spread) or fill color (thematic). Same pattern as `updatePlantsLOD` — iterate nodes, mutate attrs, `batchDraw()`.

- **Canopy spread**: Set circle radius to `(canopySpreadM / 2) * stageScale` so the circle represents real world size while the group remains counter-scaled. The circle scales up to compensate for the group scaling down. Labels stay readable at all zoom levels. Do NOT disable group counter-scale.
- **Thematic coloring**: Batch-fetch `SpeciesDetail` for placed plants, recolor by attribute (stratum, hardiness, lifecycle, etc.). Color legend panel shows mapping.

### AD-4: Group/Ungroup

Group wraps selected nodes into a new `Konva.Group` on the same layer. The group gets `name: 'shape'` (selectable/draggable). Children lose `name: 'shape'` (prevents independent selection — per CLAUDE.md gotcha). Ungroup reverses this. Both are undoable commands.

### AD-5: Minimap as HTML Canvas

Like rulers, the minimap is a separate HTML `<canvas>` element overlaid on the stage area (not a Konva layer — avoids stage transform issues). Renders simplified view (rectangles for zones, dots for plants) at fixed small scale. Viewport rectangle is interactive (drag to pan).

### AD-6: Konva World Meters Are Authoritative, MapLibre Is Derived

Canopi's coordinate system is world meters (origin at design location). MapLibre is a **derived overlay** — it reads the Konva stage viewport and projects it to geographic coordinates. Konva is never driven by MapLibre.

This means:
- Pan/zoom events originate on the Konva stage. MapLibre follows.
- Serialization saves world-meter coordinates. Geographic coords are computed at export time via `projection.ts`.
- If the user changes the design location, plant positions don't move — only the geographic mapping shifts.
- Future geo features (elevation, climate) read from MapLibre/tiles but display in Konva-space.

### AD-7: GeoJSON Ownership — Frontend Builds, Rust Writes

GeoJSON export follows the same pattern as existing PNG/SVG/CSV export:
- **Frontend** builds the GeoJSON `FeatureCollection` object in `canvas/geojson.ts` (using `projection.ts` for coordinate conversion)
- **Frontend** invokes a Tauri file dialog to get a save path
- **Rust** receives the serialized GeoJSON string via IPC and writes it to disk (same as `save_design`)

No Rust `export_geojson` command that independently builds GeoJSON. Rust is file I/O only.

### AD-8: Engine Delegation Principle

`engine.ts` is already 1128 lines. Phase 3 must not add feature logic to it. The engine orchestrates — feature logic lives in dedicated modules that the engine calls. This follows the existing pattern where `grid.ts`, `rulers.ts`, `compass.ts`, `plants.ts` are separate.

All new Phase 3 modules (`guides.ts`, `alignment.ts`, `map-layer.ts`, `minimap.ts`, `celestial.ts`, `display-modes.ts`, `dimensions.ts`, `consortium-visual.ts`, `timeline-renderer.ts`) expose functions the engine calls. The engine adds only thin wiring (signal subscriptions, lifecycle calls).

---

## New Dependencies

| Package | Purpose |
|---------|---------|
| `maplibre-gl` (npm) | Map rendering — base map layer, location pin drop |
| `suncalc` (npm) | Solar position calculation (~3KB) |

No new Rust crates needed. GeoJSON uses `serde_json`. Arrow/callout/dimension tools are pure Konva shapes.

## New Rust Modules / IPC Commands

| Module | Commands | Purpose |
|--------|----------|---------|
| `commands/species.rs` (extend) | `get_species_batch` | Batch detail lookup for thematic coloring (3h) |

GeoJSON/CSV export reuses the existing `export_file` command in `commands/export.rs` (frontend builds data, Rust writes file per AD-7). No new Rust export command needed.

Note: Collections and Plant DB sidebar work moved out of Phase 3 scope.

---

## Prerequisite: Persistent Plant Identity (3-pre)

**Complexity**: S | **Skills**: `/canopi-canvas`, `/canopi-rust` | **Context7**: `/konvajs/site`

Multiple Phase 3 features require stable cross-object references to placed plants (dimension attachments, consortium membership, future timeline-to-plant links). Currently, plant node IDs are regenerated on every load (`crypto.randomUUID()` in `serializer.ts:130`). This must be fixed before 3g, 3l, or any feature that references specific placed plants.

### Schema Change

**Rust** (`common-types/src/design.rs`): Add `id: String` to `PlacedPlant`.
**TS** (`types/design.ts`): Add `id: string` to `PlacedPlant`.

### Files

**Existing (modify)**:
- `common-types/src/design.rs` — add `id` field to `PlacedPlant`
- `desktop/web/src/types/design.ts` — mirror `id` field
- `desktop/web/src/canvas/serializer.ts` — on load (`fromCanopi`): use `plant.id` as the Konva node ID instead of `crypto.randomUUID()`. On save (`toCanopi`): read back `group.id()` into `PlacedPlant.id`.
- `desktop/web/src/canvas/plants.ts` — accept `id` in `createPlantNode` opts, use it as the Konva Group ID
- `desktop/web/src/canvas/engine.ts` — `setupDrop`: generate `crypto.randomUUID()` at creation time and pass it as `id` (stable for the lifetime of the placed plant)

### Verification
1. Place 3 plants → save → load → verify plant IDs unchanged (not regenerated)
2. Copy/paste a plant → verify the copy gets a new unique ID
3. TS round-trip test: `fromCanopi → toCanopi` preserves all plant IDs
4. `cargo test --workspace` + `npx tsc --noEmit`
5. Review with `/craft`

---

## Sub-Phase 3a — Guides & Smart Guides

**Complexity**: M | **Dependencies**: None | **Skills**: `/canopi-canvas`, `/canopi-ux` | **Context7**: `/konvajs/site`

### Features
- Guide lines dragged from rulers (horizontal + vertical)
- Snap-to-guides toggle
- Smart guides: dynamic alignment indicators during shape drag
- Guide persistence in `.canopi` `extra` field

### Files

**Existing (modify)**:
- `canvas/engine.ts` — guide storage, snap-to-guide logic in `_setupSnapToDrag` (line 394), guide visibility toggle
- `canvas/rulers.ts` — drag-from-ruler interaction (mousedown on ruler → create guide line)
- `canvas/grid.ts` — extend `snapToGrid` to also snap to guides when enabled
- `state/canvas.ts` — add `snapToGuidesEnabled`, `guides` signals
- `canvas/tools/select.ts` — show smart guides during drag (dynamic alignment lines to other shapes' edges/centers)
- `components/canvas/CanvasToolbar.tsx` — snap-to-guides toggle button
- `canvas/serializer.ts` — serialize/deserialize guides from `extra` field
- `i18n/locales/*.json` (all 6)

**New (create)**:
- `canvas/guides.ts` — guide line rendering, smart guide computation (nearest-edge/center alignment), guide snapping math
- `canvas/commands/guide.ts` — `AddGuideCommand`, `RemoveGuideCommand` (undoable)

### Implementation Notes
- Guides stored as `{id, axis: 'h'|'v', position: number}` in a signal
- Smart guides compute alignment to other shapes' edges/centers during drag, showing temporary `Konva.Line` nodes on annotations layer (removed on `dragend`)
- **Smart guide performance** (Review Finding 7): Only check shapes within a snapping threshold (20px screen distance) using a viewport-bounded search rect. Limit to shapes on the active layer, not all 7 layers. Reuse the `nodesInRect` pattern from `operations.ts`.
- Guide persistence: stored in `extra.guides` of CanopiFile — forward-compatible, older versions ignore it
- Delete guides by dragging back to ruler area or selecting + Delete key
- **Engine delegation** (Review Finding 3): Guide logic lives in `canvas/guides.ts`, not inline in `engine.ts`. Engine calls `guides.snapToGuides(pos)` and `guides.showSmartGuides(node, candidates)`. Same delegation pattern as `grid.ts`, `rulers.ts`, `compass.ts`.

### Verification
1. `npx tsc --noEmit` + `npm run build`
2. Drag from ruler → guide appears, persists through save/load
3. Smart guides visible during shape drag near aligned edges
4. Snap-to-guides toggle works
5. Review with `/craft`

---

## Sub-Phase 3b — Align & Distribute

**Complexity**: S | **Dependencies**: None | **Skills**: `/canopi-canvas` | **Context7**: `/konvajs/site`

### Features
- Align selected objects: left / center / right / top / middle / bottom
- Distribute selected objects: even horizontal / vertical spacing

### Files

**Existing (modify)**:
- `canvas/engine.ts` — add `alignSelected(alignment)` and `distributeSelected(axis)` methods
- `commands/registry.ts` — register align/distribute commands
- `components/canvas/CanvasToolbar.tsx` — align/distribute buttons (visible when multi-selected)
- `components/canvas/toolbar-icons.tsx` — align/distribute icons
- `i18n/locales/*.json` (all 6)

**New (create)**:
- `canvas/commands/align.ts` — `AlignCommand` (batch move, undoable via `BatchCommand` of `MoveNodeCommand`s)

### Implementation Notes
- Align computes target position from selection bounding rect, moves each node
- Distribute calculates even spacing between nodes along axis, reorders by position
- Reuses existing `getSelectedNodes()` and `BatchCommand` patterns

### Verification
1. Select 3+ shapes → align left → all left edges aligned
2. Distribute horizontally → even spacing
3. Undo restores original positions
4. Review with `/craft`

---

## Sub-Phase 3c — Group / Ungroup

**Complexity**: M | **Dependencies**: None | **Skills**: `/canopi-canvas`, `/canopi-rust` | **Context7**: `/konvajs/site`

### Features
- Group selected objects (Ctrl+G)
- Ungroup (Ctrl+Shift+G)
- Grouped objects move/transform together
- Nested groups supported

### Persistence Design (must be resolved before implementation)

Grouping is a **canvas-level** concept (arbitrary visual containers), not a **domain-level** concept (zones represent real garden areas). Shoving groups into `Zone` with `children` would force `Zone` to become a generic scene-graph container, which it is not.

**Design questions that must be answered first:**

1. **What content types may appear inside a group?** Zones, annotations, dimension lines, plants? Or only same-type objects?
2. **Can groups cross layers?** (Probably no — Transformer must be on same layer as targets.)
3. **Must group-local transforms persist?** (Position, rotation, scale of the group itself.)
4. **Should groups persist in the canonical schema or in `extra`?**

**Recommended persistence model**: Add a new top-level `groups` array to `CanopiFile` (not nested inside `Zone`):

```ts
interface ObjectGroup {
    id: string
    name: string | null
    layer: string           // which layer this group lives on
    position: Position      // group-level transform
    rotation: number | null
    member_ids: string[]    // IDs of grouped objects (plant IDs, zone names)
}
```

This keeps groups as a flat reference structure (membership by ID) rather than a recursive containment tree. It avoids turning `Zone` into a scene-graph node. `member_ids` relies on persistent plant IDs from `3-pre` and stable zone names.

**Rust** (`common-types/src/design.rs`): Add `ObjectGroup` struct, add `groups: Vec<ObjectGroup>` to `CanopiFile` with `#[serde(default)]`.
**TS** (`types/design.ts`): Mirror `ObjectGroup` interface, add `groups?: ObjectGroup[]` to `CanopiFile`.

### Files

**Existing (modify)**:
- `canvas/engine.ts` — thin wiring: call `grouping.groupSelected()` / `grouping.ungroupSelected()`
- `canvas/serializer.ts` — serialize groups from `ObjectGroup[]`, recreate `Konva.Group` on load by looking up member nodes by ID
- `canvas/operations.ts` — update `serializeNodes`/`deserializeNodes` to handle Group nodes (flatten for clipboard, restore from `ObjectGroup` references)
- `shortcuts/manager.ts` — Ctrl+G / Ctrl+Shift+G
- `commands/registry.ts` — group/ungroup commands
- `common-types/src/design.rs` — add `ObjectGroup`, add `groups` to `CanopiFile`
- `desktop/web/src/types/design.ts` — mirror changes
- `i18n/locales/*.json` (all 6)

**New (create)**:
- `canvas/grouping.ts` — `groupSelected(engine)`, `ungroupSelected(engine)` logic (engine delegates here per AD-8)
- `canvas/commands/group.ts` — `GroupCommand`, `UngroupCommand` (undoable)

### Implementation Notes
- Group: create `Konva.Group` on same layer, reparent selected nodes. Group gets `name: 'shape'`, children lose `name: 'shape'` (CLAUDE.md gotcha: prevents children from being independently selectable)
- Ungroup: extract children, restore `name: 'shape'`, destroy wrapper
- Transformer must stay on same layer as targets (CLAUDE.md gotcha)
- Groups cannot cross layers (same-layer constraint)
- **Groupable object types in Phase 3**: zones and plant groups only. Annotations (arrows, callouts, dimension lines) are NOT groupable in Phase 3 — they lack stable persisted IDs. If annotation grouping is needed later, add stable IDs to annotation objects first.
- Serialization: `toCanopi()` extracts groups as flat `ObjectGroup` records with `member_ids` (plant IDs from 3-pre + zone names). `fromCanopi()` recreates `Konva.Group` wrappers by looking up member nodes by their stable IDs. No recursive containment — groups are one level deep.
- TS round-trip test required: group → save → load → verify group membership preserved

### Verification
1. Select 3 shapes → Ctrl+G → move as one → Ctrl+Shift+G → independent again
2. Copy/paste grouped objects preserves group structure
3. Save/load round-trip preserves groups
4. Review with `/craft`

---

## Sub-Phase 3d — Plant Stamp Tool

**Complexity**: M | **Dependencies**: None | **Skills**: `/canopi-canvas`, `/canopi-ux` | **Context7**: `/konvajs/site`

### Features
- Plant stamp tool: select species from DB, click repeatedly on canvas to place
- "Set as stamp" action on PlantRow / PlantCard
- Toolbar shows selected species when stamp tool is active

### Files

**Existing (modify)**:
- `canvas/engine.ts` — register `PlantStampTool`
- `state/canvas.ts` — add `plantStampSpecies` signal (holds `{canonical_name, common_name, stratum, width_max_m}`)
- `components/canvas/CanvasToolbar.tsx` — plant stamp button with species indicator
- `components/plant-db/PlantRow.tsx` — "Set as stamp" button/action
- `components/plant-db/PlantCard.tsx` — "Set as stamp" action
- `shortcuts/manager.ts` — 'P' key for plant stamp
- `i18n/locales/*.json` (all 6)

**New (create)**:
- `canvas/tools/plant-stamp.ts` — `PlantStampTool` implements `CanvasTool`: on click, reads `plantStampSpecies` signal, calls `createPlantNode`, wraps in `AddNodeCommand`

### Implementation Notes
- "Set as stamp" in PlantRow/PlantCard writes species data into `plantStampSpecies` signal AND switches active tool to `'plant-stamp'`
- Each click places a plant at cursor position (world coordinates via `stage.getRelativePointerPosition()`)
- ESC or switching tools clears `plantStampSpecies`
- Toolbar shows "Stamping: *Common Name*" when active

### Verification
1. Click "Set as stamp" on a plant → tool switches → click canvas → plant placed
2. Click 5 times → 5 plants placed, each undoable
3. ESC clears stamp mode
4. Review with `/craft`

---

## Sub-Phase 3e — Pattern Fill & Spacing Tool

**Complexity**: L | **Dependencies**: 3d (shares species picker infrastructure) | **Skills**: `/canopi-canvas`, `/canopi-ux` | **Context7**: `/konvajs/site`

### Features
- Pattern fill: select zone + species → fill interior with plants at grid/hex/offset spacing
- Spacing tool: distribute N plants evenly along a line

### Files

**Existing (modify)**:
- `canvas/engine.ts` — register tools
- `canvas/plants.ts` — extract batch creation helper
- `state/canvas.ts` — add `patternFillConfig` signal
- `components/canvas/CanvasToolbar.tsx` — tool buttons
- `i18n/locales/*.json` (all 6)

**New (create)**:
- `canvas/tools/pattern-fill.ts` — `PatternFillTool`: select existing zone → open config dialog → fill with plants
- `canvas/tools/spacing.ts` — `SpacingTool`: click two points → distribute N plants evenly along line
- `canvas/pattern-math.ts` — point-in-polygon test, grid/hex/offset point generation within arbitrary polygons
- `components/canvas/PatternFillDialog.tsx` — config: species picker, spacing (meters), pattern type (grid/hex/offset)
- `components/canvas/PatternFillDialog.module.css`

### Implementation Notes
- Pattern fill: generate candidate points in bounding rect, filter by point-in-polygon, create batch of plants via `BatchCommand`
- Hex pattern: offset every other row by half the spacing
- Performance: for large zones at small spacing, cap at 500 plants and warn

### Verification
1. Draw zone → pattern fill with 2m grid spacing → plants fill interior
2. Hex pattern produces offset rows
3. Undo removes all plants from fill at once
4. Review with `/craft`

---

## Sub-Phase 3f — Arrow & Callout Annotations

**Complexity**: S | **Dependencies**: None | **Skills**: `/canopi-canvas` | **Context7**: `/konvajs/site`

### Features
- Arrow annotation tool (two-click: start + end)
- Callout text box (rounded rect background + editable text)

### Files

**Existing (modify)**:
- `canvas/engine.ts` — register tools
- `canvas/shapes.ts` — add `createArrow()`, `createCallout()` factories
- `canvas/serializer.ts` — handle Arrow and callout Group in `toCanopi`/`fromCanopi`
- `canvas/export.ts` — Arrow SVG export in `nodeToSVG`
- `components/canvas/CanvasToolbar.tsx` — buttons
- `components/canvas/toolbar-icons.tsx` — icons
- `i18n/locales/*.json` (all 6)

**New (create)**:
- `canvas/tools/arrow.ts` — `ArrowTool`: two clicks create `Konva.Arrow`
- `canvas/tools/callout.ts` — `CalloutTool`: click to place callout, double-click to edit text (reuse TextTool's textarea overlay pattern)

### Implementation Notes
- `Konva.Arrow` is a built-in shape with `pointerLength`, `pointerWidth`
- Callout = `Konva.Group` on annotations layer: `Konva.Rect` (background, rounded corners) + `Konva.Text`
- Both use `strokeScaleEnabled: false` for constant-pixel strokes
- Both counter-scaled like existing annotations via `updateAnnotationsForZoom()`

### Verification
1. Arrow tool → click start → click end → arrow appears with arrowhead
2. Callout → click → box appears → double-click → edit text
3. Save/load preserves arrows and callouts
4. Review with `/craft`

---

## Sub-Phase 3g — Dimension Lines

**Complexity**: M | **Dependencies**: 3f (builds on annotation patterns) | **Skills**: `/canopi-canvas` | **Context7**: `/konvajs/site`

### Features
- Dimension line tool: click two points or two objects to measure
- Attached dimensions auto-update when source/target nodes move
- Labels show distance in meters

### Files

**Existing (modify)**:
- `canvas/engine.ts` — register tool, subscribe to node transforms for dimension updates
- `canvas/shapes.ts` — add `createDimensionLine()` factory
- `canvas/serializer.ts` — serialize dimension attachments (`data-attach-source`, `data-attach-target` attrs)
- `canvas/tools/select.ts` — trigger dimension update on `dragend`/`transformend`
- `i18n/locales/*.json` (all 6)

**New (create)**:
- `canvas/tools/dimension.ts` — `DimensionTool`: click two points/objects
- `canvas/dimensions.ts` — `DimensionManager`: tracks attachments (dimension → source/target node IDs), updates positions/labels when attached nodes move

### Implementation Notes
- Dimension line = `Konva.Group`: two tick marks (short perpendicular lines) + connecting line + counter-scaled label showing distance
- Attached dimensions store `data-attach-source` and `data-attach-target` as Konva custom attrs (node IDs)
- **Plant ID stability**: Persistent plant IDs from `3-pre` make dimension attachments to plants stable across save/load. Attachments use `data-attach-source` and `data-attach-target` storing the plant's persistent ID or zone name.
- `DimensionManager` listens for `dragend`/`transformend` on any node, checks attachment map, updates connected dimensions
- Use `?? null` for custom attrs (CLAUDE.md gotcha)

### Verification
1. Click two points → dimension appears with correct distance
2. Attach to two shapes → move one → dimension updates
3. Save/load preserves dimensions and attachments
4. Review with `/craft`

---

## Sub-Phase 3h — Plant Display Modes

**Complexity**: M | **Dependencies**: None | **Skills**: `/canopi-canvas`, `/canopi-ux`, `/canopi-rust` | **Context7**: `/konvajs/site`, `/rusqlite/rusqlite`

### Features
- "Display by" dropdown in canvas toolbar
- Default mode: current fixed-size circles with strata colors
- Canopy spread mode: circles sized to real `width_max_m` from plant DB
- Thematic coloring ("Color by"): recolor by stratum, hardiness, lifecycle, nitrogen fixation, sun tolerance, edibility
- Color legend panel

### Files

**Existing (modify)**:
- `canvas/plants.ts` — add `updatePlantDisplay(mode, plantsLayer, stageScale)` function
- `canvas/engine.ts` — subscribe to `plantDisplayMode` signal via `effect()`, call `updatePlantDisplay`
- `state/canvas.ts` — add `plantDisplayMode`, `plantColorByAttr` signals
- `components/canvas/CanvasToolbar.tsx` — "Display by" dropdown
- `desktop/src/commands/species.rs` — add `get_species_batch(names: Vec<String>) → Vec<SpeciesDetail>` IPC

**New (create)**:
- `canvas/display-modes.ts` — canopy spread sizing, thematic color maps (hardiness gradient, lifecycle colors, etc.), color legend data generation
- `components/canvas/ColorLegend.tsx` + `.module.css` — floating legend panel
- `components/canvas/DisplayModeDropdown.tsx` + `.module.css` — toolbar dropdown

### Implementation Notes
- Canopy spread (Review Finding 4): Do NOT disable group counter-scale — that would make labels unreadable. Instead, set circle radius to `(canopySpreadM / 2) * stageScale` so it represents world size while the group remains counter-scaled. The circle scales up to compensate for the group scaling down. Labels stay readable at all zoom levels. Same trick as grid world-unit rendering in screen-pixel space.
- Thematic: batch-fetch `SpeciesDetail` for all placed plants via new `get_species_batch` IPC. Cache results in a module-level signal. Recolor circles by chosen attribute.
- `updatePlantDisplay` iterates `.plant-group` nodes — same pattern as `updatePlantsLOD` in `plants.ts`
- Performance: batch IPC call, not one per plant

### Verification
1. Switch to canopy spread → circles resize to real coverage
2. Switch to "Color by hardiness" → circles recolor, legend appears
3. Switch back to default → original appearance restored
4. Save/load does NOT persist display mode (runtime preference only)
5. Review with `/craft`

---

## Sub-Phase 3i — Minimap

**Complexity**: M | **Dependencies**: None | **Skills**: `/canopi-canvas`, `/canopi-ux` | **Context7**: `/konvajs/site`

### Features
- Minimap overview panel (bottom-right, ~200x150px)
- Simplified rendering of all layers (rectangles for zones, dots for plants)
- Viewport rectangle showing current view
- Click/drag on minimap to navigate

### Files

**Existing (modify)**:
- `canvas/engine.ts` — minimap lifecycle (create on `showCanvasChrome`, destroy on `destroy`), provide content bounds, hook into pan/zoom
- `components/panels/CanvasPanel.tsx` — mount minimap container
- `state/canvas.ts` — add `minimapVisible` signal

**New (create)**:
- `canvas/minimap.ts` — `MinimapRenderer`: HTML `<canvas>` element (not Konva — AD-5), renders simplified view, viewport rectangle, click/drag navigation
- `components/canvas/MinimapToggle.tsx` — toggle button

### Implementation Notes
- HTML `<canvas>` element, same pattern as rulers (positioned absolutely in canvas area)
- Content bounds computed from all nodes across all layers
- Viewport rectangle = translucent overlay showing what's visible on main canvas
- Click/drag on minimap sets `stage.position()` proportionally
- Throttled redraws: only on stage pan/zoom/content-change, not every frame

### Verification
1. Toggle minimap → overview appears in bottom-right
2. Pan main canvas → viewport rectangle moves in minimap
3. Click on minimap → main canvas navigates there
4. Zones and plants visible as simplified shapes
5. Review with `/craft`

---

## Sub-Phase 3j — Location & MapLibre Base Map

**Complexity**: L | **Dependencies**: None | **Skills**: `/canopi-canvas`, `/canopi-ux` | **Context7**: `/maplibre/maplibre-gl-js`, `/konvajs/site`

### Features
- Location input: lat/lon manual entry + interactive map pin drop
- MapLibre base map layer below design layers (toggleable)
- Map style picker (street / satellite / terrain)
- Layer toggle UI for map layers (enable greyed-out contours/climate/base in LayerPanel)

### Files

**Existing (modify)**:
- `components/panels/CanvasPanel.tsx` — mount MapLibre container `<div>` behind Konva stage
- `canvas/engine.ts` — coordinate transform helpers, transparent base layer when map active, sync MapLibre on pan/zoom via `_scheduleOverlayRedraw`
- `state/canvas.ts` — add `mapLayerVisible`, `mapStyle` signals
- `state/design.ts` — location read/write wired to design metadata (already exists in `currentDesign`)
- `canvas/serializer.ts` — location already in `toCanopi` metadata (no changes needed)
- `components/canvas/LayerPanel.tsx` — enable base/contours/climate toggles (currently greyed)
- `components/panels/WorldMapPanel.tsx` — replace stub with location input UI
- `i18n/locales/*.json` (all 6) — map UI strings

**New (create)**:
- `canvas/map-layer.ts` — `MapLayerManager`: lazy MapLibre init, viewport sync with Konva stage, visibility toggle, style switching
- `canvas/projection.ts` — local tangent plane projection: world coords (meters) ↔ geographic coords (lng/lat) given design location
- `components/canvas/LocationInput.tsx` + `.module.css` — lat/lon fields, "Pick on Map" button, altitude field
- `components/canvas/MapStylePicker.tsx` — dropdown for map style

### Implementation Notes
- MapLibre `<div>` absolutely positioned behind Konva stage container. Konva container gets `background: transparent` when map is on.
- Local tangent plane: `dx_m = dlon * cos(lat_rad) * 111320`, `dy_m = dlat * 111320`. Design location = origin (0,0 in world coords).
- On Konva `stage.on('dragmove')` + zoom events: convert stage viewport to MapLibre `center`/`zoom`/`bearing`. Filter `e.target !== this.stage` for shape drags (CLAUDE.md gotcha).
- Lazy init: MapLibre only loaded when `mapLayerVisible` becomes true AND `location` is set. Dynamic `import('maplibre-gl')`.
- Free tile sources (no API key): OpenStreetMap, OpenTopoMap. Configurable in settings later.
- `npm install maplibre-gl`

### Verification
1. Set location → enable map layer → satellite/street map visible behind canvas
2. Pan/zoom canvas → map follows
3. Draw zones on top of map → visible correctly
4. Toggle map off → opaque background returns
5. Save/load preserves location
6. Review with `/craft`

---

## Sub-Phase 3k — Celestial Dial (Sun & Moon)

**Complexity**: M | **Dependencies**: 3j (requires location) | **Skills**: `/canopi-canvas`, `/canopi-ux` | **Context7**: `/konvajs/site`

### Features
- Circular celestial dial rendered around/near the compass rose — game-style day/night cycle indicator
- **Sun arc**: colored ring segments showing dawn (amber), day (yellow), dusk (orange), night (dark blue) based on sunrise/sunset/twilight times
- **Sun direction arrow**: points toward current sun azimuth on the compass
- **Moon phase icon**: crescent/gibbous/full moon glyph showing current lunar phase
- Driven by: design location + selected timeline action date (action must have `start_date`)
- Updates when user clicks a timeline action with a `start_date`

### Files

**Existing (modify)**:
- `canvas/compass.ts` — integrate celestial dial ring around the existing compass rose group
- `state/canvas.ts` — add `celestialDate` signal (`Date | null`), `celestialData` computed signal (sun times, azimuth, moon phase)
- `components/canvas/TimelineTab.tsx` — on row click/select, if action has `start_date` and location is set, write date into `celestialDate` signal
- `i18n/locales/*.json` (all 6)

**New (create)**:
- `canvas/celestial.ts` — celestial dial renderer:
  - `computeCelestialData(date, lat, lon)` — wraps `suncalc` to get sun times (dawn, sunrise, solar noon, sunset, dusk), sun azimuth/altitude, moon phase (0-1 fraction)
  - `createCelestialDial(compassGroup)` — adds the dial ring as Konva shapes on the compass group:
    - Outer ring: `Konva.Arc` segments colored by sun phase (dawn=amber, day=yellow, dusk=orange, night=dark blue)
    - Sun arrow: small `Konva.Wedge` or triangle at the sun's azimuth position on the ring
    - Moon phase: small `Konva.Shape` with custom `sceneFunc` drawing the appropriate crescent/gibbous/full icon, positioned opposite the sun on the ring
  - `updateCelestialDial(dial, celestialData)` — updates ring segments and positions based on new data

### Implementation Notes
- `npm install suncalc` (~3KB):
  - `SunCalc.getTimes(date, lat, lng)` → `{sunrise, sunset, dawn, dusk, solarNoon, nadir, ...}`
  - `SunCalc.getPosition(date, lat, lng)` → `{azimuth, altitude}`
  - `SunCalc.getMoonIllumination(date)` → `{fraction, phase, angle}` — `phase`: 0=new, 0.25=first quarter, 0.5=full, 0.75=last quarter
- Ring segments: convert sun event times to angles around the dial (24h = 360°). Dawn-to-sunrise = amber arc, sunrise-to-sunset = yellow arc, sunset-to-dusk = orange arc, dusk-to-dawn = dark blue arc.
- Moon phase icon: custom `sceneFunc` draws two arcs — one for the lit limb, one for the terminator curve. Phase fraction determines curvature.
- Dial is part of the compass group — inherits its position, counter-scaled for screen-pixel size
- Only visible when `celestialDate` is non-null (requires location + a selected timeline action with `start_date`)
- When user clicks different timeline rows, the dial smoothly transitions (short tween on arc angles + sun arrow rotation)
- **No design-start-date fallback** — there is no `start_date` field on the design schema and adding one is out of scope. The dial only appears when the user selects a dated timeline action. If no action is selected or the action has no date, the dial is hidden.
- No shadow projection — the dial is purely informational

### Verification
1. Set location + add timeline action with start date → click action → celestial dial appears around compass
2. Ring shows correct day/night proportions for the location's latitude
3. Sun arrow points in correct compass direction
4. Moon shows correct phase icon
5. Click different timeline action → dial updates
6. No location → no dial visible
7. Review with `/craft`

---

## Sub-Phase 3l — Consortium Builder

**Complexity**: M | **Dependencies**: 3-pre (persistent plant IDs), 3c (Group/Ungroup) | **Skills**: `/canopi-canvas`, `/canopi-ux` | **Context7**: `/konvajs/site`

### Features
- Select plants → "Create Consortium" → named group with visual boundary
- Consortium visual: dashed convex hull around member plants
- ConsortiumTab enhancements: create from selection, highlight consortium on canvas
- Auto-update boundary when plants move

### Schema Change

The current `Consortium` type has `plants: string[]` — but these are canonical species names, not placed-plant references. A user may place 3 lavenders; the current schema cannot distinguish which ones belong to a consortium.

With persistent plant IDs from `3-pre`, update the `Consortium` type:

**Rust** (`common-types/src/design.rs`):
```rust
pub struct Consortium {
    pub id: String,
    pub name: String,
    pub plant_ids: Vec<String>,   // placed-plant IDs (not canonical names)
    pub notes: Option<String>,
}
```

**TS** (`types/design.ts`):
```ts
interface Consortium {
    id: string
    name: string
    plant_ids: string[]    // placed-plant IDs from 3-pre
    notes: string | null
}
```

Rename `plants` → `plant_ids` to make semantics explicit. Add `id` for stable consortium references. Old files with `plants: string[]` need a migration shim (if `plant_ids` missing, fall back to matching by canonical name — best-effort).

### Files

**Existing (modify)**:
- `canvas/engine.ts` — thin wiring: call `consortiumVisual.create()` / `consortiumVisual.disband()`
- `canvas/serializer.ts` — serialize consortium membership using placed-plant IDs
- `components/canvas/ConsortiumTab.tsx` — "Create from Selection" button, click row to highlight plants on canvas
- `state/canvas.ts` — add `highlightedConsortium` signal
- `common-types/src/design.rs` — update `Consortium` struct
- `desktop/web/src/types/design.ts` — mirror changes
- `i18n/locales/*.json` (all 6)

**New (create)**:
- `canvas/consortium-visual.ts` — convex hull computation, dashed boundary polygon on zones layer, auto-update on plant move (engine delegates here per AD-8)
- `canvas/commands/consortium.ts` — `CreateConsortiumCommand`, `DisbandConsortiumCommand` (undoable)

### Implementation Notes
- Plants in a consortium get `data-consortium-id` Konva custom attr (runtime only — membership persisted in `Consortium.plant_ids`)
- Convex hull boundary = `Konva.Line` on zones layer with `dash: [10, 5]`, `strokeScaleEnabled: false`
- On `dragend` of plants with `data-consortium-id`, recompute and redraw convex hull
- ConsortiumTab shows companion/antagonist relationships between members (existing Relationship data from plant DB)
- On load (`fromCanopi`): restore `data-consortium-id` attrs by matching `Consortium.plant_ids` against loaded plant node IDs
- TS round-trip test required: create consortium → save → load → verify membership preserved

### Verification
1. Select 3 plants → Create Consortium → dashed boundary appears
2. Move a plant → boundary updates
3. Click consortium in BottomPanel → plants highlight on canvas
4. Save/load preserves consortium membership and boundary
5. Review with `/craft`

---

## Sub-Phase 3m — Interactive Timeline

**Complexity**: L | **Dependencies**: None (enhances existing TimelineTab) | **Skills**: `/canopi-canvas`, `/canopi-ux` | **Context7**: `/konvajs/site`

### Features
- Add visual Gantt-style interactive timeline above the existing table-based editor
- **Zoom levels**: day / week / month / season / year — mouse wheel to zoom, toolbar buttons for presets
- **Pan**: horizontal scroll/drag to navigate through time
- **Time ruler**: top axis showing dates/months/years at current zoom level, adaptive density (same concept as canvas grid "nice distances")
- **Swim lanes**: rows per action type (planting, pruning, harvest, watering, fertilising) with colored bars for duration
- **Drag to create**: click+drag on a lane to create a new action with start/end dates
- **Drag to resize**: grab bar edges to adjust start/end dates
- **Drag to move**: grab bar center to shift an action in time
- **Today marker**: vertical line showing current date
- **Selection**: click an action bar to select it → drives celestial dial (3k), highlights related plants on canvas
- **Dependencies**: visual arrows between actions that have `depends_on` relationships
- **Completed state**: strikethrough/dimmed rendering for completed actions
- **Mini overview**: thin strip above the timeline showing the full project span with a viewport indicator (like a scrollbar minimap)

### Files

**Existing (modify)**:
- `components/canvas/BottomPanel.tsx` — split timeline tab into Gantt view (top) + detail editor (bottom)
- `components/canvas/TimelineTab.tsx` — refactor into detail editor: opens when an action is selected on Gantt timeline. Retains full CRUD for `recurrence`, `plants`, `zone`, `completed`, and all fields the Gantt can't edit (Review Finding 2)
- `state/canvas.ts` — add `timelineZoom` signal (scale), `timelineScrollX` signal (pan offset), `selectedTimelineAction` signal
- `types/design.ts` — `TimelineAction` already has `start_date`, `end_date`, `depends_on`, `order` — no changes needed
- `i18n/locales/*.json` (all 6) — zoom level labels, lane names, navigation tooltips

**New (create)**:
- `components/canvas/InteractiveTimeline.tsx` — main timeline component: renders into a `<canvas>` element (HTML Canvas 2D, not Konva — same performance pattern as rulers/minimap). Handles zoom/pan/drag interactions.
- `components/canvas/InteractiveTimeline.module.css` — layout, lane colors, cursor states
- `canvas/timeline-renderer.ts` — Canvas 2D drawing logic: time ruler with adaptive labels, swim lane backgrounds, action bars (rounded rects with action-type colors), dependency arrows, today marker, selection highlight. Separated from component for testability.
- `canvas/timeline-math.ts` — time-to-pixel conversion at each zoom level, "nice" date intervals (snap to day/week/month boundaries), drag-to-date snapping, viewport bounds calculation

### Implementation Notes
- **HTML `<canvas>` element** (not Konva, not DOM elements) — same pattern as rulers and minimap. Canvas 2D gives smooth zoom/pan at 60fps with hundreds of action bars. No DOM node overhead.
- **Zoom levels**: continuous zoom (not discrete steps). Adaptive label density: at wide zoom show years/quarters, at narrow zoom show individual days. Use "nice distance" ladder same as canvas grid.
- **Action bar colors**: match existing `ACTION_TYPES` — planting=green, pruning=amber, harvest=gold, watering=blue, fertilising=brown, other=gray. Use CSS variable tokens converted to canvas fillStyle.
- **Drag interactions**: mousedown on bar edge → resize mode, mousedown on bar center → move mode, mousedown on empty lane → create mode. All wrapped in undoable commands via existing `nonCanvasRevision` dirty tracking.
- **Scroll sync**: mouse wheel = zoom (centered on cursor), middle-click-drag or shift+wheel = pan. Same UX patterns as the canvas stage.
- **Mini overview strip**: thin (20px) bar at top showing compressed view of entire project timeline. Draggable viewport rectangle for quick navigation.
- **Selection drives celestial dial**: when user clicks an action bar, `selectedTimelineAction` signal updates → if action has `start_date` and location is set, `celestialDate` signal updates (wired in 3k).
- **Detail editor pattern** (Review Finding 2): Gantt is the primary navigation/visualization. Clicking an action opens the existing TimelineTab CRUD form below as a detail editor — handles `recurrence`, `plants`, `zone`, `completed`, and other fields the Gantt can't show. This is the standard pattern in project management tools (ClickUp, Notion, Linear). Drag-to-create on the Gantt pre-fills start/end dates and opens the detail editor for remaining fields.
- **Dirty tracking**: all timeline edits (from Gantt drag or CRUD form) increment `nonCanvasRevision` — they are non-canvas changes.
- **Performance**: only render visible action bars (cull by viewport). Redraw on rAF guard (same pattern as canvas overlays).

### Completion Criteria

**Must-have (first pass)**:
1. Timeline renders with swim lanes and action bars positioned by date
2. Mouse wheel zooms smoothly between day and year views
3. Horizontal pan via drag or shift+wheel
4. Click to select action → detail editor opens below
5. Drag to create → new action with start/end dates → detail editor opens
6. Drag bar to move → dates shift
7. Today marker visible at correct position

**Can-follow (second pass if needed)**:
8. Drag bar edges to resize → dates update
9. Dependency arrows between connected actions
10. Mini overview strip with viewport indicator
11. Selection coordination with celestial dial (wired in 3k)

### Verification
1. All must-have criteria pass
2. Dirty tracking: Gantt drag creates/moves correctly increment `nonCanvasRevision`
3. Detail editor retains all fields (recurrence, plants, zone, completed)
4. Review with `/craft`

---

## Sub-Phase 3n — GeoJSON & Export Enhancements

**Complexity**: M | **Dependencies**: 3j (GeoJSON needs projection module) | **Skills**: `/canopi-canvas`, `/canopi-rust` | **Context7**: `/websites/v2_tauri_app`

Canvas export features that build on the location/projection foundation from 3j.

### Features
- GeoJSON export: zones as Polygon features, plants as Point features with properties
- GeoJSON import: property boundary polygons → zones
- Budget CSV export

### Files

**Existing (modify)**:
- `canvas/export.ts` — add `exportGeoJSON(engine, location)`, `exportBudgetCSV(budget)`
- `canvas/import.ts` — add `importGeoJSON(geojson, engine)` (re-enable gated import with new format)
- `commands/registry.ts` — register GeoJSON export/import + budget CSV commands

**New (create)**:
- `canvas/geojson.ts` — GeoJSON FeatureCollection builder. Zones → Polygon features, plants → Point features with properties (canonical_name, common_name, stratum). Uses `projection.ts` from 3j for world-coord → lng/lat conversion.

### Implementation Notes
- GeoJSON follows RFC 7946 — coordinates in [longitude, latitude] order
- Plant features include all custom attrs as GeoJSON properties
- Budget CSV uses same pattern as existing `exportPlantCSV` in `export.ts`
- **GeoJSON import constraints**:
  - Supported: `Polygon` and `MultiPolygon` geometries only. Other types (`Point`, `LineString`, etc.) are silently skipped.
  - Holes in polygons are ignored (exterior ring only).
  - Feature `properties.name` → zone name; other properties stored as zone `notes`.
  - Requires design location to be set (needed for inverse projection). If no location, show an i18n error and abort import.
  - Parse FeatureCollection, create zone shapes from Polygon geometries via inverse projection.

### Verification
1. GeoJSON export → open in geojson.io → zones and plants at correct locations
2. GeoJSON import → property boundary appears as zone shape
3. Budget CSV → correct totals and formatting
4. Review with `/craft`

---

## Dependency Graph & Implementation Order

```
Prerequisite (must come first):
  3-pre (Persistent Plant IDs) ───────── Required by 3g, 3l

Independent (can parallelize after 3-pre):
  3a (Guides)  ────────────────────────┐
  3b (Align/Distribute)  ─────────────┤
  3c (Group/Ungroup)  ────────────────┤
  3d (Plant Stamp)  ──────────────────┤─── All independent
  3f (Arrow/Callout)  ────────────────┤
  3h (Display Modes)  ────────────────┤
  3i (Minimap)  ──────────────────────┤
  3m (Interactive Timeline)  ─────────┘

Dependent chains:
  3-pre → 3g (Dimension Lines need stable plant IDs for attachments)
  3-pre → 3l (Consortium Builder needs placed-plant identity)
  3d → 3e (Pattern Fill needs stamp's species picker)
  3f → 3g (Dimension Lines builds on annotation patterns)
  3c + 3-pre → 3l (Consortium Builder needs Group + plant IDs)
  3j → 3k (Celestial Dial needs location)
  3j → 3n (GeoJSON export needs projection module)
  3m → 3k (Celestial Dial driven by timeline selection)
```

### Recommended Order (sequential implementation)

1. **3-pre** — Persistent Plant Identity (prerequisite — small, unblocks 3g + 3l)
2. **3a** — Guides & Smart Guides (builds snapping infrastructure)
3. **3b** — Align & Distribute (small, high-value)
4. **3c** — Group/Ungroup (enables 3l)
5. **3d** — Plant Stamp Tool (enables 3e)
6. **3h** — Plant Display Modes (high user value, independent)
7. **3f** — Arrow & Callout (small, independent)
8. **3m** — Interactive Timeline (foundation for celestial dial interaction)
9. **3e** — Pattern Fill (depends on 3d)
10. **3g** — Dimension Lines (depends on 3f + 3-pre)
11. **3i** — Minimap (independent)
12. **3j** — Location & MapLibre (critical path for 3k, 3n)
13. **3k** — Celestial Dial (depends on 3j + 3m)
14. **3l** — Consortium Builder (depends on 3c + 3-pre)
15. **3n** — GeoJSON & Export (depends on 3j)

### Critical Path

`3j (Location/MapLibre) → 3k (Celestial Dial) → 3n (GeoJSON Export)`

Timeline (3m) is independent but should precede 3k so the celestial dial can wire into timeline selection.

---

## Summary

| Sub-Phase | Features | Size | Depends On |
|-----------|----------|------|------------|
| 3-pre | Persistent Plant Identity | S | — |
| 3a | Guides, Smart Guides | M | — |
| 3b | Align, Distribute | S | — |
| 3c | Group / Ungroup | M | — |
| 3d | Plant Stamp Tool | M | — |
| 3e | Pattern Fill, Spacing | L | 3d |
| 3f | Arrow, Callout | S | — |
| 3g | Dimension Lines | M | 3f, 3-pre |
| 3h | Plant Display Modes | M | — |
| 3i | Minimap | M | — |
| 3j | Location, MapLibre | L | — |
| 3k | Celestial Dial (Sun & Moon) | M | 3j, 3m |
| 3l | Consortium Builder | M | 3c, 3-pre |
| 3m | Interactive Timeline | L | — |
| 3n | GeoJSON, Export | M | 3j |
