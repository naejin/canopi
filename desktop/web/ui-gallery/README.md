# UI gallery

From `desktop/web/`, run `npm run dev:ui`. Open http://127.0.0.1:1422/.

The gallery mounts production workspace and panel components with at most one live disposable canvas runtime. The mounted canvas surface owns runtime construction, publication, resize observation, and cleanup. Switching the Desktop primary route to Location releases that runtime; returning to Canvas creates a fresh one. The backend and file dialogs are replaced only by this Vite configuration; native operations use memory fixtures. No user database, Design, settings store or file is read or written. Reload resets the session.

Direct links:

- [New Data Library and Layers reference](http://127.0.0.1:1422/library-reference.html) — interactive migration proposal, with simulated data and a schematic Design view; see the contract below.
- [Plant color](http://127.0.0.1:1422/?surface=color)
- [Plant symbol](http://127.0.0.1:1422/?surface=symbol)
- [Species key](http://127.0.0.1:1422/?surface=key)
- [Layers](http://127.0.0.1:1422/?surface=layers)
- [Calendar](http://127.0.0.1:1422/?surface=calendar)
- [Expanded Calendar](http://127.0.0.1:1422/?surface=calendar-expanded)
- [Budget](http://127.0.0.1:1422/?surface=budget)
- [Consortium](http://127.0.0.1:1422/?surface=consortium)
- [Favorites](http://127.0.0.1:1422/?surface=favorites)
- [Design notebook](http://127.0.0.1:1422/?surface=notebook)
- [Inspection lens](http://127.0.0.1:1422/?surface=lens)
- [Desktop workspace](http://127.0.0.1:1422/?surface=workspace)
- [Web workspace](http://127.0.0.1:1422/?surface=workspace&edition=web)

Add `state=empty|mixed|long|located|dense`, `theme=dark`, `locale=fr`, or `panelWidth=320|352|480|800`. `surface=workspace` uses the real edition command projection and shared workspace composition; its extra command row keeps production panel-toggle behavior. Header review controls select their requested story idempotently, so moving between Calendar variants keeps the Calendar dock open while changing expansion. Add `edition=web` to use browser-safe registrations and exercise the production stacked dock breakpoint on a narrow viewport. Web includes its browser-safe Location and unavailable-local-data panels, but no Design Notebook. Desktop registers its production Data/Analysis panels. Edition links reload the page instead of mounting two canvas owners together. Calendar fixtures use September 2026 so visual reviews are deterministic. Empty appearance stories intentionally have no editable selection. Both header review controls and the real canvas toolbar remain interactive. For a fresh selection after clicking the canvas, reload.

Check with `npm run check:ui`. The gallery lives outside `src` and normal build inputs. Its Vite config rejects builds and owns a separate dependency cache, so it can run with Desktop Vite on port 1420 and real Web Edition on port 1421. All ports are strict: stop the existing owner instead of accepting Vite's next available port. Add fixtures for new reusable states; do not copy production markup into the gallery.

The default Desktop workspace shows the canonical provisional anchor when Location is opened. Its one search-row action says **Confirm location** and confirms the current map center in one click. Search and map clicks create a reversible **Selected location** preview; Escape or reload aborts it. The `state=located` story supplies a confirmed sample site, changes the action to **Move design here**, and lets that action commit a selected candidate or panned map center without changing local Design geometry. The location setup action also installs that confirmed sample in memory. Export reports completion in memory. Import uses the sample Design. The gallery's Web catalog uses memory data so the host remains deterministic; real Web Species Catalog admission stays covered by its own tests. Native dialog/file delivery remains outside the gallery.

The Design notebook mounts the production panel and workbench with in-memory reference adapters. Use `state=dense` for Inspection Lens navigation and source-outline review.
Use `?surface=favorites&edition=web` to review the production Web Favorites component against the gallery’s memory backend.

Reloading reconstructs the gallery session and resets its memory state. Stop it with Ctrl-C. Real Web Edition storage, DuckDB catalog loading, browser downloads, Tauri IPC/WebView behavior, native file dialogs, and packaged-app behavior remain outside this host; use the [edition development guide](../../../docs/agent/edition-development.md) to choose those checks safely.

## Data Library and Layers interactive reference

Use `/library-reference.html` for the accepted library-first migration direction. It is an isolated Preact reference using shared production header/search/menu controls and tokens; it does not replace the current workspace. The [plan's reference contract](../../../docs/design/raster-rework/geolibre-adoption-plan.md#interactive-reference-and-implementation-handoff) owns its scope, implementation handoff and limitations.

Query parameters: `state=ready|empty|importing|failed|unavailable|long`, `theme=dark`. Start with empty; Import selects sample TIFF names, then one name for the batch. The review-strip Complete import / Fail import controls advance its simulated job. Exercise search/details/Back, Add to either sample Design, Layers visibility/order/opacity, Fit/Inspect, Remove and reuse. Rename/delete and cancel/retry work in memory. Reload resets state. Reference copy is English; no native files, data engine, persistent storage or real botanical editing is involved.

Run `npm run check:ui` and `npx vitest run src/__tests__/library-reference.test.ts src/__tests__/library-reference-ui.test.tsx` from `desktop/web/`. For actual browser regression, [browser-smoke.mjs](library-reference/browser-smoke.mjs) contains an async Playwright `page` function; navigate to this local gallery first, then invoke it using an existing browser runner/tool. Its `filename` input accepts the absolute file path. It checks the production-gallery registration gap as well as the new reference journey and narrow/dark states. It is not a standalone Node command and adds no dependency.

## Historical raster rework HTML references

The [older reference hub](http://127.0.0.1:1422/raster-reference-prototype/index.html) retains the seven mockups approved at `0e696722` on 2026-09-18. Their Data/Analysis/history/source-edit flows are superseded for GeoLibre migration by the interactive reference above. They remain evidence of the prior delivery, not instructions to rebuild those screens. The [historical reference contract](../../../docs/design/raster-data-analysis-rework.md#html-ui-reference-contract) records their original scope. Never import either fixture implementation into production.

## Historical LiDAR study

The raster rework references above supersede this study for future Data/Analysis/import UI work. This older route still describes the earlier proposal; do not implement its Before/After flow as part of the rework.

With the same `npm run dev:ui` command, open
[`?surface=layers&prototype=lidar&panelWidth=380`](http://127.0.0.1:1422/?surface=layers&prototype=lidar&panelWidth=380).
Chosen layout: Layers inspector with a Library drill-in and Back. The former alternate layouts, shelf and variant switcher are removed.
Real raster previews sit behind the sample grid, zones, plants, guides and annotation, above a schematic basemap. Selecting MNT/MNS shows all accepted coverage across sample Designs. Import files first assigns an existing type or creates a named custom numeric type (meaning, units/reference and band), then opens synchronized Before/After review: independently add uncovered areas C/D and approve overlap replacements A/B (kept by default). Apply updates the shared library; Cancel/Escape leaves it unchanged. Incoming regions demonstrate irregular boundaries, holes and disconnected islands and are labelled simulations, not measured survey heights. There are no LiDAR Fit controls; import and type selection preserve the camera. Custom types start empty and appear in the same chooser after Apply; Type details permits rename with stable identity. Non-elevation types offer numeric colors, without terrain relief. Library history supports demo undo. The development-only LiDAR fixture selector exercises missing library/type and read failure: LiDAR silently disappears while other canvas content and saved preferences remain. No recovery notice or prompt appears. Reload resets memory state; no native persistence or tile engine is implemented.
The prototype is Desktop-gallery-only and replaces its canvas with a native-grid raster preview.
See the [study and implementation handoff](../../../docs/design/lidar-library.md) for input evidence, limitations and regeneration.
Remove `lidar-prototype/` and its gated entry imports once the accepted behavior has been rebuilt for production.
