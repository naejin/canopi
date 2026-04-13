# Canopi — Agroecological Design App

## Tech Stack
- **Backend**: Rust workspace (Tauri v2 + rusqlite + specta)
- **Frontend**: Preact + @preact/signals + TypeScript + Vite + CSS Modules
- **Canvas**: PixiJS (primary renderer) + Canvas2D (fallback) — scene-owned runtime via `SceneCanvasRuntime`
- **i18n**: i18next core (NOT react-i18next), 11 languages (en, fr, es, pt, it, zh, de, ja, ko, nl, ru)
- **Maps**: MapLibre GL JS + maplibre-contour. The visible PanelBar Location entry, featured-design world map, and in-canvas basemap surface now use MapLibre; the shared hosted basemap style is reused across all live MapLibre surfaces. Canvas camera sync, precision warning metadata, and panel↔map hover/selection overlays now run through the same bearing-aware Mercator-backed active projection backend seam, while contours/hillshade, offline tiles, export, and learning surfaces remain deferred
- **Native**: lib-c (Linux, Cairo PNG/PDF + inotify + XDG), lib-swift (macOS stub), lib-cpp (Windows stub)

## Project Structure
```
canopi/
├── desktop/          # Tauri v2 app crate
│   ├── src/          # Rust backend
│   ├── web/          # Preact frontend
│   └── tauri.conf.json
├── common-types/     # Shared Rust ↔ TS types
├── .interface-design/ # Design system (system.md)
├── lib-swift/        # macOS native (stub)
├── lib-cpp/          # Windows native (stub)
└── lib-c/            # Linux native (stub)
```

Domain-specific instructions in subdirectory CLAUDE.md files:
- `desktop/CLAUDE.md` — Tauri v2, IPC, platform, document lifecycle, settings
- `desktop/src/db/CLAUDE.md` — Database, SQLite, translations, schema contract
- `desktop/web/CLAUDE.md` — Frontend: CSS, i18n, state, Preact/Signals
- `desktop/web/src/canvas/CLAUDE.md` — Canvas runtime (SceneCanvasRuntime), PixiJS renderer, scene-owned architecture rules

## Current Layout (Post UI Overhaul)
- **Left**: Canvas toolbar (38px) — drawing tools plus plant color action (Select, Hand, Rectangle, Text, Plant Color + Grid/Snap/Rulers toggles)
- **Center**: Canvas workspace
- **Right**: PanelBar (36px, always visible) + sliding panels (plant search, favorites)
- **Bottom**: Bottom panel with Budget and Consortium tabs (Timeline hidden — pending rework)
- **Title bar**: Logo + file name + lang/theme toggle + window controls
- **No activity bar** — removed, navigation via PanelBar (Location entry is visible; location editing remains a dedicated flow even though the in-canvas basemap now exists)
- **No status bar** — removed, controls moved to title bar
- Design system: `.interface-design/system.md` (field notebook direction)

## Design Direction
- **Field notebook** aesthetic: parchment, ink, ochre palette. See `.interface-design/system.md`
- **Green NEVER in UI chrome** — green lives only on the canvas (plant symbols). UI uses ochre `#A06B1F` as primary accent.
- Theme toggle: light/dark only (no system option)
- Depth: borders-only (no dramatic shadows)

## Current Scope
- **Bottom panel**: Timeline, Budget, and Consortium tabs active. Timeline uses direct-manipulation UX: 6 fixed action-type rows, click-to-add/edit popover with date validation, edge resize, hover tooltip, ctrl+scroll zoom, drag-to-move with frozen coordinate origin, and auto-scroll on edge drag (rAF-based, quadratic acceleration). Ruler controls hidden pending design iteration. Panel-canvas hover/selection flows through typed `PanelTarget[]` signals and `resolvePanelTargets()`
- **Maps**: Location flow and world map surfaces exist, the visible PanelBar Location entry opens the dedicated map flow, and the canvas now has a non-interactive MapLibre basemap behind the scene surface. The basemap surface reports loading / ready / error feedback, follows the canvas through the shared Mercator-backed active projection backend seam, shows a display-only north compass in canvas chrome, exposes dev-only sync diagnostics, warns when backend-derived local-projection precision may degrade for large designs, and renders panel↔map hover/selection overlays through the same pure projection path. Contours/hillshade, offline tiles, export, and learning content remain deferred beyond beta
- **Selection**: No resize/rotate — objects are position-only (highlight + move)
- **Plant labels**: Hover tooltip + hover species highlight + selection labels (one per species at centroid). See `desktop/web/src/canvas/CLAUDE.md` Plant Presentation Rules
- Many tools, overlays, and export commands were pruned during the rewrite — see git history. See `docs/todo.md` for current and deferred work

## Architecture Rules

### Document Mutation Rule
- **No component may replace the active document directly** — only `state/document-actions.ts` performs destructive session replacement
- **No panel may call document replacement directly** — panels request document changes through the document-actions boundary
- All document-replacing flows use one shared guard path (dirty check → confirm → replace)

### Document Authority Rule
The `.canopi` file has two categories of content with separate authorities:

- **Canvas scene state** (plants, zones, annotations, groups, plant-species-colors, layers) — owned by `SceneStore`. Mutations flow through the canvas runtime. Renderers and interaction are projections of this state
- **Non-canvas document state** (consortiums, timeline, budget, `budget_currency`, location, description, extra) — owned by the document store (`state/design.ts` / `state/document.ts`). Mutations flow through `mutateCurrentDesign()` and the `*-actions.ts` modules

The save path composes both into a single `CanopiFile`. Neither authority should duplicate the other's data. Panels that read canvas entities (plant list, zone names) should use a read-only query interface on the runtime, not mirrored signals.

**Anti-patterns:**
- Do not push non-canvas state (consortiums, timeline, budget, `budget_currency`) into `SceneStore` — it is not a canvas concern
- Do not mirror canvas state into standalone signals when a derived/computed value or a direct read from the authority would work. Prefer `computed()` signals derived from the authority over manually-synced mirrors
- Do not create new ad hoc sync paths between the two authorities — if sync is needed, centralize it in one explicit adapter
- **Adding new document-level fields**: Add to TS `CanopiFile` interface + `KNOWN_CANOPI_KEYS` in `state/document-extra.ts` + `serializeDocument()` passthrough. Rust `#[serde(flatten)] extra` round-trips unknown keys automatically, so no Rust struct change is needed until the field requires backend logic
- **`KNOWN_CANOPI_KEYS` must include `'extra'`** — the `extra` field is a first-class key on `CanopiFile` emitted by the scene codec. Without it, `extractExtra()` captures the `extra` object as an unknown key, risking double-nesting on round-trip
- **Adding new required array fields to `CanopiFile`**: Add `#[serde(default)]` in Rust (backward compat with old files), make the field required (not optional) in TS `CanopiFile` to match Rust `Vec<T>`, add empty placeholder in `serializeScenePersistedState` in `codec.ts`, and update all test fixtures. The `?? []` fallback is only needed where the parent object is nullable (`currentDesign.value?.field ?? []`), not inside `mutateCurrentDesign` callbacks where the design is guaranteed non-null
- **Adding a new file-format migration**: Add a match arm in `migrate_design_value()` in `desktop/src/design/format.rs` for the new version, bump `CURRENT_VERSION`, and add the migration function. The loop runs each step sequentially (v1->v2->v3 etc.). Add a test in the same file's `mod tests`

### Action-Layer Rule
- **Action modules must not import other action modules** — `state/*-actions.ts` files are leaf modules
- Import direction: **components → actions → state** (never backwards)
- **Cross-concern orchestration**: When a mutation in one domain must trigger side effects in another (e.g., plant deleted → orphan cleanup in timeline/budget/consortium), create an explicit workflow module at a higher boundary. Do not wire action modules to each other. See `state/template-import-workflow.ts` and `state/consortium-sync-workflow.ts` for the pattern
- **Workflow effect lifecycle**: Workflow modules that install `effect()` should manage their own disposer as a module-level singleton (`installX()` / `disposeX()`). This avoids circular imports when both `document.ts` and `document-actions.ts` need to call them. Do not install workflow effects inside `SceneCanvasRuntime` — they belong at the document boundary
- **Budget actions**: `state/budget-actions.ts` owns `setBudgetCurrency` and `setPlantBudgetPrice`. Price action reads currency from the document (`budget_currency`), not from caller parameters — prevents currency split state
- **Settings-backed actions**: Action functions that mutate signals backed by Rust `Settings` (e.g., `setBottomPanelOpen`, `setBottomPanelTab`) must call `persistCurrentSettings()` after writing the signal. Exception: 60fps hot paths (e.g., drag resize) should persist on mouse-up, not per-frame

### Signal Performance in Hot Paths
- **Never write signals unconditionally at 60fps** (e.g. map `move` events). New object literals always fail `Object.is` equality, triggering unnecessary rerenders. Use `.peek()` to read without subscribing, compare before writing
- **`getBoundingClientRect()` in hot loops**: Cache the DOMRect — don't call twice per pointermove event

### Async Surface Rule
- When a surface intentionally keeps stale data visible while async work is in flight (debounced search, deferred hydrate, optimistic list), separate **intent state** from **committed data state**
- Scroll reset, virtualizer reset, and re-measure logic must key off a committed data revision, not raw input/filter signals that can advance before the new payload arrives
- Increment committed-data revisions only when a new first page replaces the displayed dataset; pagination appends should update measurements in place without forcing a full reset

### Resource Ownership Rule
- Every resource-owning surface must have **one explicit lifecycle owner** for setup, update, and teardown
- Applies to: canvas runtime (SceneCanvasRuntime), renderer host, MapLibre instances, timers, listeners, async cancellation tokens, DOM overlays
- HMR cleanup: module-level `effect()` and `addEventListener` must store disposers and clean up via `import.meta.hot.dispose()`

### MapLibre Integration Rule
- **MapLibre is a derived visualization layer, not a document authority.** Map layers render scene/document state; they do not own or mutate it
- Existing full-screen surfaces may keep component-local MapLibre ownership when setup/update/teardown are contained in one component (`LocationTab`, `WorldMapSurface`). In-canvas MapLibre must remain isolated in one dedicated sibling surface/controller and must not be scattered across the canvas runtime or renderer implementations
- **MapLibre follows canvas camera state (one-directional).** The canvas camera is the authority; the map layer subscribes and projects through read-only runtime/query seams. The current in-canvas basemap is non-interactive and must not mutate document or canvas state
- **Map/canvas projection is bearing-aware, Mercator-backed, and shared.** `north_bearing_deg` participates in both camera derivation and world↔geo feature projection; do not keep separate bearing math or alternate zoom math in `MapLibreCanvasSurface` or overlay code
- **Projection backend choice is centralized.** `desktop/web/src/canvas/projection.ts` exposes the active backend seam; the current live backend is the local Mercator frame. Precision warnings and dev diagnostics must derive from that seam rather than ad hoc surface math
- **Exact sync means no skipped viewport updates.** Do not add camera deadbands/tolerances in `MapLibreCanvasSurface` or other map consumers that can suppress tiny pan/zoom changes
- **MapLibre bearing adaptation lives at the camera seam.** Preserve document `north_bearing_deg` semantics; if MapLibre-facing bearing handling changes, adapt it inside `canvas/maplibre-camera.ts`, not in panel overlays, canvas state, or document serialization
- Keep the in-canvas map surface thin. `MapLibreCanvasSurface` owns lifecycle only; helper modules under `desktop/web/src/maplibre/` should own state shaping, basemap presentation, overlay coordination, and terrain diff/apply logic
- The lazy import boundary around `maplibre-gl` should be preserved for bundle size
- Rendered panel-map overlays, and any richer future variants, must consume the pure `projectPanelTargetsToMapFeatures()` seam rather than re-resolving panel identity or making MapLibre a second scene/document authority

### Panel ↔ Canvas Reactivity
- **Bottom panel components that read canvas-derived data must subscribe to `sceneEntityRevision`** from `state/canvas.ts` to react to canvas mutations (plant placement, undo/redo). Reading `currentCanvasSession.value?.getPlacedPlants()` alone is not reactive — the session reference doesn't change when scene state changes. Panels that only read non-canvas document state (e.g., TimelineTab reads `currentDesign.value?.timeline`) should NOT subscribe — it causes spurious re-renders on every canvas mutation
- **Cross-domain auto-sync must be a workflow module** (like `consortium-sync-workflow.ts`), not a component-level effect. Component effects only run when mounted — data integrity requires document-level effects that run regardless of which tab is visible
- **Use `.peek()` in workflow effects** to read signals without subscribing. Only subscribe to the intended trigger signal (e.g., `sceneEntityRevision`). Writing `currentDesign.value` inside an effect that subscribes to it creates re-execution loops
- **Panel target identity is explicit.** Timeline, budget, and consortium entries use typed `PanelTarget` identity (`placed_plant`, `species`, `zone`, `manual`, `none`) with legacy migration. Do not reintroduce string matching against timeline descriptions, legacy `plants` arrays, budget descriptions, or consortium canonical-name fields
- **Panel-origin hover/selection is presentation state.** `hoveredPanelTargets` and `selectedPanelTargets` are resolved by `SceneCanvasRuntime` into renderer highlights only. They must not mutate real canvas selection, selection labels, dirty state, or history unless a future slice explicitly chooses and designs that behavior
- **Canvas-origin hover is separate.** Canvas plant hover publishes `hoveredCanvasTargets` for bottom-panel affordances without changing panel selection/history

### Canvas2D Tab Components
- **Use `useCanvasRenderer` hook** from `components/canvas/useCanvasRenderer.ts` for DPR-aware canvas setup — handles `devicePixelRatio` scaling, `ResizeObserver`, and redraw lifecycle. Both `ConsortiumChart` and `InteractiveTimeline` use it
- **Use `canvas2d-utils.ts`** for `cssVar()` (cached CSS variable reads) and `roundRect()` (rounded rectangle path) — shared between `timeline-renderer.ts` and `consortium-renderer.ts`
- **Shared nice-distance arrays**: `grid.ts` exports `NICE_DISTANCES` — rulers and scale-bar derive subsets via `.filter()` (not `.slice(indexOf())` which silently breaks if the anchor value is removed). Do not create independent copies
- **Renderer functions receive `t` parameter** for i18n — don't hardcode user-visible strings in Canvas2D renderers

## Key Conventions

### Before Writing Code
1. Query **Context7** for up-to-date library API docs (see Context7 Library IDs below)
2. For UI work: read `.interface-design/system.md` for design tokens and patterns. Load `/interface-design:init` only for major new UI surfaces (new panels, new workflows, new component patterns)
3. Use taoki `xray`/`ripple` to understand file structure and blast radius before modifying
4. For multi-phase work with subagents: define a **file ownership matrix** (one writer per file at any time — especially hotspot files like `scene-runtime.ts`, `scene-interaction.ts`, `design.ts`, `plant_db.rs`), keep **Tauri MCP in main context only** (single WebView session), and decide UI control types in the plan before building alternatives
5. For multi-feature i18n work: **batch all i18n keys in one early phase** to prevent 11-file merge conflicts across parallel agents
6. Before planning new features: **explore the codebase for existing implementations** — code may already exist (e.g., copy-paste, favorites backend, display mode rendering were all discovered pre-built during MVP planning)
7. Run `/simplify` after implementation — converges in ~3 rounds: R1 structural, R2 duplication exposed by R1 fixes, R3 confirms convergence
8. For multi-phase work: **implement → `tsc` + `npm test` → craft code review → fix → re-review until convergence** per phase. Don't batch reviews across phases — bugs compound
9. When delegating commits to subagents: instruct them to `git add` only the specific files they modified — never `git add -A` or `git add .`. Pre-existing dirty working tree changes get swept into their commits otherwise

### Banned Patterns (enforced by plugin hooks)
- **No React**: Import from `preact`, `preact/hooks`, `preact/compat` — never `react`
- **No Konva**: Konva has been fully removed. Canvas rendering goes through `SceneCanvasRuntime` + `RendererHost` (PixiJS/Canvas2D). Do not reintroduce Konva
- **No Tailwind**: Use CSS Modules (`.module.css`)
- **No Zustand/Redux/MobX**: Use `@preact/signals`
- **No react-i18next**: Use `import { t } from '../i18n'`
- **No connection pools** (r2d2, deadpool, sqlx): `Mutex<Connection>` only — rusqlite Connection is not Sync, Arc alone is unsound
- **No typeshare**: Use `specta::Type`
- **No string-formatted SQL**: Use prepared statements with `?1`, `?2`
- **No raw rgba() in CSS Modules**: Always use `var(--color-*)` tokens — raw values break dark mode
- **No `font-weight: 500`**: Two weights only — `400` (body/reading) and `600` (name/label/interactive). Weight 500 creates a mushy middle with no clear purpose. See `.interface-design/system.md` for the five typography roles (Label, Name, Body, Caption, Value)

## Development
```bash
# Full app dev (from project root — NOT desktop/)
cargo tauri dev

# Frontend dev only (from desktop/web/)
npm run dev

# Check workspace (needs plant DB or skip env var)
CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace

# TypeScript check (from desktop/web/)
npx tsc --noEmit

# Frontend build (from desktop/web/)
npm run build

# Frontend tests (from desktop/web/)
npm test

# Generate plant DB (run before first `cargo tauri dev`)
python3 scripts/prepare-db.py

# Build release
cargo build --release

# Inspect Linux .deb package
dpkg-deb --info target/x86_64-unknown-linux-gnu/release/bundle/deb/Canopi_*_amd64.deb
readelf -d target/x86_64-unknown-linux-gnu/release/canopi-desktop | grep NEEDED
```

### Pre-commit Hooks
- **Husky v9** installed in `desktop/web/package.json` with monorepo `prepare` script: `cd ../.. && husky desktop/web/.husky`
- Hook at `desktop/web/.husky/pre-commit` runs `tsc --noEmit` from `desktop/web/`
- Tests stay in CI — slow hooks get bypassed with `--no-verify`, defeating the purpose
- When ESLint is added, append it to the hook and add lint-staged for per-file linting

### Release Process
- **Version bump files**: `Cargo.toml` (workspace version), `desktop/tauri.conf.json`, `desktop/web/package.json` — Cargo.lock auto-updates
- **Trigger RC workflow**: `gh workflow run "Release Candidate" --ref main -f ref=main -f release_version=<ver> -f db_release_tag=canopi-core-db -f db_asset_name=canopi-core.db`
- **RC timing**: ~15-20min total (macOS Intel ~10min, Windows ~10min are the slowest targets)
- **Promote**: `scripts/promote-release.sh` creates a **draft** release — publish with `gh release edit <tag> --draft=false`
- **Promotion upload timing**: 10-20min (Windows artifact ~500MB dominates)
- **Tags are remote-only**: promote script creates the tag via `gh release create`, not locally — `git fetch --tags` to sync
- **Release docs example**: `docs/release-operations.md` promote command has a hardcoded version — update it during version bump

### Tauri MCP Development Workflow
The app has `tauri-plugin-mcp-bridge` (debug builds only). Use it for screenshot-driven development and interactive verification:

**Setup:**
1. `cargo tauri dev` — launches app with MCP bridge on port 9223
2. `driver_session start` — connect to the running app

**Gotcha:** If MCP tools error with `resolveRef is not a function`, the session is stale. Run `driver_session stop` then `driver_session start` to reconnect.

**Gotcha:** MCP tools disconnect from Claude Code when the Tauri app restarts (e.g. after `cargo tauri dev` relaunch). Must `driver_session stop` then `start` to reconnect. If tools show as "no longer available", they need the app running first.

**Verification tools:**
- `webview_screenshot` — capture current visual state
- `webview_interact` — click, scroll, drag to test user flows
- `webview_keyboard` — type text, press keys to test input
- `webview_execute_js` — run JS in app context (access `window.__TAURI__`)
- `webview_dom_snapshot` — inspect accessibility tree or DOM structure
- `webview_get_styles` — check computed CSS (catch dark mode issues without manual toggling)
- `webview_find_element` — locate elements by CSS selector, XPath, or text
- `ipc_execute_command` — call Rust backend commands directly (test DB queries, settings)
- `ipc_monitor` / `ipc_get_captured` — watch frontend↔backend IPC traffic for serialization mismatches

**Visual debugging at zoom:** To inspect fine CSS details (thumb alignment, pixel offsets), isolate and zoom via JS: `el.style.transform = 'scale(3)'; el.style.transformOrigin = 'top left'`, then `webview_screenshot`. Reset with `el.style.cssText = ''`

**After UI changes:** run `/interface-design:audit` to check design system compliance. Run `/interface-design:critique` after building major new components

## Quality Process
- After completing a phase or significant feature, run `/craft` with two parallel code-reviewer agents
- Fix all issues, re-review until convergence (typically 2 rounds)
- For UI work: run `/interface-design:critique` to verify design system adherence
- Verify interactive features via Tauri MCP (screenshot + interact) — do not rely solely on `tsc`/`npm test`
- Max 3 sub-phases between live app verification runs
- Detail card expansion pattern: Rust struct → SQL query → translate_value() → frontend types → collapsible sections → i18n keys × 11 locales → schema-contract.json translations → DB population
- Adding a new filterable species field (end-to-end): (1) `columns.rs` → `validated_column()` match arm, (2) `filters.rs` → `is_numeric_field()` or `is_boolean_field()` if applicable, (3) `field-registry.ts` → `FIELD_REGISTRY` entry (key must match columns.rs exactly), (4) `i18n/*.json` → `filters.field.<key>` label in all 11 locales, (5) if also adding to detail card: update `PlantDetailCard.tsx` `has*` check + render + `plantDetail.*` i18n key

## Key Documents
- Docs entry point: `docs/README.md`
- Agent reading order: `docs/agents.md`
- Docs maintenance protocol: `docs/maintenance.md`
- Active/deferred work tracker: `docs/todo.md`
- Architecture review: `docs/code-quality-architecture-review-2026-04-05.md`
- Release hardening: `docs/release-verification.md`
- Release operations: `docs/release-operations.md`
- Renderer validation: `docs/renderer/renderer.md`
- Database guidance: `docs/db/README.md`
- Product scope lock: `docs/product-definition.md`
- Historical roadmap: `docs/archive/roadmap.md`
- Archived reviews: `docs/archive/reviews/`
- Design system: `.interface-design/system.md`
- Rewrite history: `docs/archive/rewrite-history-2026-03.md`
- Archive root: `docs/archive/`

## Context7 Library IDs
- Tauri v2: `/websites/v2_tauri_app`
- rusqlite: `/rusqlite/rusqlite`
- PixiJS: `/pixijs/pixijs`
- MapLibre: `/maplibre/maplibre-gl-js`
- i18next: `/i18next/i18next`

## Contributing

### When fixing a bug:

1. Create a test (ideally at a unit stage) to *PROVE* the bug exists before attempting to fix it.
2. Identify the architecturally appropriate place to fix the bug.
   * Ideally fixing bugs leads to *reducing* overall complexity, not adding complexity by applying a band-aid
3. Consider: is this the *ONLY* case for this bug, or does this bug have a broader scope
   * If the bug has a broader scope, expand the tests to show *ALL* cases you can think of for the bug
4. Update the code making minimal changes besides fixing the bug at the architecturally correct place to minimize added complexity.
5. Commit changes to fix bugs as stand-alone bug fixes. Limit including bug fixes as part of other commits.

### When adding a feature:

If you ever encounter a compiler bug, stop everything you're doing, and fix the bug.  See the above section for how to do this appropriately.

If you ever find a limitation in the language that you have to work around, stop, identify the problem, and suggest how the language needs to be improved to fix this limitation focing work arounds.

## Output
- Answer is always line 1. Reasoning comes after, never before.
- No preamble. No "Great question!", "Sure!", "Of course!", "Certainly!", "Absolutely!".
- No hollow closings. No "I hope this helps!", "Let me know if you need anything!".
- No restating the prompt. If the task is clear, execute immediately.
- No explaining what you are about to do. Just do it.
- No unsolicited suggestions. Do exactly what was asked, nothing more.
- Structured output only: bullets, tables, code blocks. Prose only when explicitly requested.

## Token Efficiency
- Compress responses. Every sentence must earn its place.
- No redundant context. Do not repeat information already established in the session.
- No long intros or transitions between sections.
- Short responses are correct unless depth is explicitly requested.

## Typography - ASCII Only
- No em dashes (-) - use hyphens (-)
- No smart/curly quotes - use straight quotes (" ')
- No ellipsis character - use three dots (...)
- No Unicode bullets - use hyphens (-) or asterisks (*)
- No non-breaking spaces

## Sycophancy - Zero Tolerance
- Never validate the user before answering.
- Never say "You're absolutely right!" unless the user made a verifiable correct statement.
- Disagree when wrong. State the correction directly.
- Do not change a correct answer because the user pushes back.

## Accuracy and Speculation Control
- Never speculate about code, files, or APIs you have not read.
- If referencing a file or function: read it first, then answer.
- If unsure: say "I don't know." Never guess confidently.
- Never invent file paths, function names, or API signatures.
- If a user corrects a factual claim: accept it as ground truth for the entire session. Never re-assert the original claim.
- Whenever something doesn't work, you should first assume that your changes broke it. Code is always committed at working states.

## Code Output
- Avoid brittle, narrow solutions. When fixing bugs, always consider: is this the only case? Or does this fix apply more broadly? Is the band-aid solution correct. Prefer architecturally correct fixes, that solve the problem at the root and apply to all cases.
- Return the simplest working solution. No over-engineering.
- No abstractions or helpers for single-use operations.
- No speculative features or future-proofing.
- No docstrings or comments on code that was not changed.
- Inline comments only where logic is non-obvious.
- Read the file before modifying it. Never edit blind.

## Warnings and Disclaimers
- No safety disclaimers unless there is a genuine life-safety or legal risk.
- No "Note that...", "Keep in mind that...", "It's worth mentioning..." soft warnings.
- No "As an AI, I..." framing.

## Session Memory
- Learn user corrections and preferences within the session.
- Apply them silently. Do not re-announce learned behavior.
- If the user corrects a mistake: fix it, remember it, move on.

## Scope Control
- Do not add features beyond what was asked.
- Do not refactor surrounding code when fixing a bug.
- Do not create new files unless strictly necessary.

## Override Rule
User instructions always override this file.
