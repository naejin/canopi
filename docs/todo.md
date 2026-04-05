# Canopi: Current Work

**Date**: 2026-04-05
**Status**: v0.2.0 shipped — rewrite cut over, architecture review completed

This file tracks active and deferred work.
For architectural analysis and rationale, see [Code Quality And Architecture Review](./code-quality-architecture-review-2026-04-05.md).

## Completed (rewrite phase)

- `CanvasPanel` mounts `SceneCanvasRuntime`
- Location/map flow split into its own location shell
- `SceneStore` is the canonical canvas scene model
- `RendererHost` owns backend selection and recovery (PixiJS primary, Canvas2D fallback)
- Scene-native interaction owns selection, drag, rectangle, text, and plant placement
- Top-level document `annotations` are part of the schema
- Scene history is command/patch based
- Konva dependency fully removed
- Document replacement guard and dirty model landed

## Active Work

### 1. Convergence (prerequisites for panel/map expansion)

These align with the core risks identified in the architecture review.

**Document authority convergence:**
- Converge the save-time merge seam in `serializeDocument()` — non-canvas sections (consortiums, timeline, budget) should come from the document store directly, not be re-merged into `SceneStore` at save time
- Replace ad hoc mirrors (`currentConsortiums`, `designLocation`) with computed/derived signals
- See root `CLAUDE.md` Document Authority Rule

**Panel identity semantics:**
- Define explicit target identity types for timeline, budget, and consortium references before activating panels
- Timeline and budget currently mix placed-plant IDs, canonical names, and string matching — converge on explicit target types
- See architecture review Finding 2

**Canvas seam:**
- Replace `CanvasSession` pass-through with a runtime interface (or give it real logic)
- Consider split interface: interaction commands + read-only state queries for panels

### 2. Correctness (ongoing)
- Keep save/load strictly scene-authoritative for canvas entities
- Keep species-color edits stable across save and reload
- Keep annotation bounds consistent across selection, grouping, fit, and rendering
- Keep plant presentation geometry consistent across renderers, interaction, grouping, and fit

### 3. Performance
- Keep viewport-only updates on the renderer fast path
- Keep Pixi retained across pan/zoom; avoid per-tick scene-tree rebuilds
- Add scene-side spatial indexing only when profiling shows hit-testing or marquee is the bottleneck
- **MapLibre chunk isolation**: Verify `maplibre-gl` is in a separate Vite chunk (dynamic import → code split), `maplibre-contour` in same chunk. Flag any chunk >500KB. If MapLibre is in the main bundle, fix the import to use dynamic `import()`. See roadmap QA.6b
- Verify timeline renderer is NOT in the main chunk (bottom panel is toggled)

### 4. Safeguards
- **ErrorBoundary**: Add a Preact ErrorBoundary wrapping `main.tsx` — blank-screen crash protection. Small, no dependencies (see roadmap SG.0)
- **Pre-commit hooks**: Add husky + lint-staged (`tsc --noEmit`, `eslint`) — prevents broken commits during parallel agent work (see roadmap SG.1)

### 5. Moderate-priority cleanup
- Add real Rust → frontend → Rust round-trip test for file-format contract (see review Finding 3)
- Add `migrateDocument()` step in load path before the first breaking schema change
- Remove `suncalc` dependency (celestial dial was pruned, no code references it)
- Watch `JSON.stringify` diff cost in `scene-commands.ts` as designs grow
- Hardcoded `rgba()` colors remain in `rulers.ts`, `scene-interaction.ts` (textarea), `overlay-ui.ts` (selection band), `timeline-renderer.ts` (action type colors). Migrate to CSS variables or `getCanvasColor()` for dark-mode correctness

### 6. Documentation
- Keep canvas/runtime/renderer docs aligned with the live architecture
- Move historical migration detail into archive docs

## Deferred Product Work

**MapLibre / geo:**
- In-canvas MapLibre layers (via dedicated `MapLibreController` — see root `CLAUDE.md` MapLibre Integration Rule)
- Local tangent plane projection math in `canvas/projection.ts` (`lngLatToMeters` / `metersToLngLat`) — prerequisite for MapLibre viewport sync (see roadmap 4.0c)
- PMTiles offline tiles: Rust reader + Tauri custom protocol + download manager UI (see roadmap 4.2)
- Contour/hillshade layers via `maplibre-contour` + DEM tiles (see roadmap 4.3/4.4)

**Bottom panels:**
- Timeline MVP: trim plan is ready and convergence-independent — 6 targeted removals + BottomPanel routing enables all three tabs. See `docs/timeline/timeline-plan.md`. Identity semantics convergence is needed for full panel↔canvas sync but not for shipping the trimmed timeline
- Bottom-panel budget workflows (requires identity semantics convergence for canvas highlighting)
- Bottom-panel consortium workflows

**Other:**
- Featured-design world map / template import
- Template adaptation (hardiness comparison, replacement suggestions — see roadmap 7.2, distinct from import)
- Export (PNG/SVG/CSV/GeoJSON)
- Knowledge / learning content surface
- Pen/stylus input support (requires hardware testers — see roadmap 5.4)

## Deferred Quality Work

- **Async/blocking UX audit**: Identify every frontend `await` of a slow IPC call that blocks rendering — geocoding in `LocationInput.tsx`, photo carousel in detail card, filter options on first mount (see roadmap QA.2)
- **Memory leak audit**: Review resource lifecycle for MapLibre instances, module-level effects, autosave timers, panel mount/unmount (see roadmap QA.4)
- **Network/disk resilience**: Audit failure paths — geocoding timeout, image cache fallback, disk-full autosave, template download validation (see roadmap QA.5)
- **Security surface review**: Markdown sanitization in `markdown.ts`, `validated_column()` allowlist completeness, geocoding URL encoding (see roadmap QA.6c)
- **Design coherence (DC) phase**: Systematic CSS token migration across 34 modules — see roadmap Phase DC. Most canvas dark-mode bugs (BUG-002–006) are already fixed via `theme-refresh.ts` + CSS variables; remaining hardcoded colors listed in active work section 5
- **Test foundation**: Signal state tests, canvas operation tests, CI coverage reporting (see roadmap SG.2)

## Guardrails

- Do not reintroduce renderer-owned truth
- Do not add escape hatches that expose renderer internals to app code
- Do not move annotations back under `extra`
- Do not reintroduce `plantDisplayMode` or split plant presentation authority
- Do not reintroduce full scene rebuilds on viewport-only updates
- Do not push non-canvas state (consortiums, timeline, budget) into `SceneStore`
- Do not add new ad hoc signal mirrors — use computed/derived signals (see root `CLAUDE.md` Signal Mirror Rule)
- Do not activate bottom-panel tabs before their identity semantics are defined
- Do not make MapLibre a second document authority

## Exit Criteria For Convergence Phase

- Document authority boundary is explicit: one answer per field for "who owns this?"
- Save path composes from two authorities without re-merging non-canvas state into SceneStore
- Panel identity semantics are defined and typed (not stringly-typed string arrays)
- `CanvasSession` is either replaced with an interface or given real logic
- File-format round-trip test exists
- Architecture review findings 1 and 2 are resolved
