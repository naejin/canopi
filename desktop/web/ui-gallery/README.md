# UI gallery

From `desktop/web/`, run `npm run dev:ui` and open http://127.0.0.1:1422/. Typecheck it with `npm run check:ui`.

## What it is

The gallery mounts production workspace and panel components over memory fixtures (`fixtures.ts`, `memory-backend.ts`, `memory-dialogs.ts`). No user database, Design, settings store or file is read or written; a reload resets the session. It lives outside `src` and the normal build inputs, its Vite config rejects builds, and it owns a separate dependency cache so it runs beside Desktop Vite (1420) and the Web edition (1421). The port is strict: stop the existing owner instead of accepting another port.

The canvas is the production shared workspace (MapLibre and its Pixi scene layer, `gallery-workspace-runtime.ts`) with at most one live runtime. It works offline and deterministically because Basemap and Satellite stay hidden, whatever the Layers panel shows; the map draws only its local background and fetches no tiles. It needs WebGL2; without it the map is unavailable and the status line says so.

## Surfaces

`?surface=` (`surface-routing.ts`; an unknown value falls back to a known surface):

- `workspace` (the real edition command projection and shared workspace composition), `start`
- `color`, `symbol`, `symbols` (the plant symbol sheet), `key`, `menu-plant`, `menu-mixed`, `menu-empty`
- `layers` (Desktop, with the ground elevation row active), `site-details`, `library`, `import`, `analyze` (the data workflow dialogs over Layers)
- `calendar`, `calendar-expanded`, `budget`, `consortium`, `favorites`, `notebook` (Desktop only)
- `stories` (the Stories panel on its third step; `state=empty` has no story, `state=long` a long step title; `present=1` presents the story from that step, flying there unless the browser prefers reduced motion, so captures emulate `prefers-reduced-motion: reduce`)
- `lens`, `snapshots` (off-screen saved-view snapshots with their timings, flags and attribution; offline unless `tiles=1`)

## Parameters

- `state=populated|empty|mixed|long|located|dense|planting|zone|overview|max-zoom|lidar-progress`. `surface=start&state=empty` is the first run; `lidar-progress` shows imports and calculations in the library and under Site data; `dense` is for Inspection Lens review; `planting` shows every plant symbol in a dense planting; `zone` shows the selection chip on one unnamed rectangle zone.
- `plantDb=corrupt|missing` (the plant database notice), `theme=dark`, `locale=fr`, `panelWidth=320|352|480|800`.
- `platform=mac|linux`: F1's gesture rows as on a Mac with trackpad gestures (Control-click, the twist), or on Linux with Desktop's pinch note (Desktop only). Only F1 reads it; press F1 on the workspace.
- `edition=web` uses browser-safe registrations. In a phone-sized window (390×844 or 844×390) it shows the phone layout; between 640 and 760 px the stacked dock. Edition links reload the page so two canvas owners never mount together.

Calendar fixtures use September 2026 so visual reviews are deterministic. Settings › Files and data shows memory folder paths; Show in folder and the Recent Designs More menu only report in the activity line. Export and import use memory fixtures; the Web catalog is memory data. File › Export › Planting plan (PDF) opens the real print workspace, served the prepared fonts from `../public` (`npm run prepare:pdf-fonts`); the memory backend supplies catalog habits, so the key shows its habit groups.

## Limits

The gallery proves neither Tauri IPC, WebView behaviour, browser persistence, DuckDB catalog loading, native dialogs, downloads nor packaged-app behaviour; the [editions guide](../../../docs/guides/editions.md) says how to check those. Add fixtures for new reusable states; never copy production markup into the gallery (`frontend-architecture-policies.test.ts`: "Production code does not import the UI gallery").
