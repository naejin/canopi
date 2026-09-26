# UI gallery

From `desktop/web/`, run `npm run dev:ui` and open http://127.0.0.1:1422/.

The gallery mounts production workspace and panel components with at most one live disposable canvas runtime. The canvas is the production shared workspace (MapLibre + `maplibre-pixi`, `gallery-workspace-runtime.ts`); it works offline and deterministically because the Basemap and Satellite stay hidden, so the map draws only its local background and no tiles are fetched, whatever the Layers panel shows. It needs WebGL2; without it the map is unavailable and the status line says so. The mounted canvas surface owns composition construction, publication, resize observation and cleanup. The backend and file dialogs are replaced by this Vite configuration with memory fixtures: no user database, Design, settings store or file is read or written, and a reload resets the session.

Surfaces (`?surface=`): `workspace`, `color`, `symbol`, `key`, `layers`, `calendar`, `calendar-expanded`, `budget`, `consortium`, `favorites`, `notebook` (Desktop only), `lens`.

Add `state=empty|mixed|long|located|dense`, `theme=dark`, `locale=fr`, `panelWidth=320|352|480|800` or `edition=web`. `surface=workspace` uses the real edition command projection and shared workspace composition. `edition=web` uses browser-safe registrations and exercises the stacked dock breakpoint on a narrow viewport; edition links reload the page so two canvas owners never mount together. Calendar fixtures use September 2026 so visual reviews are deterministic. Use `state=dense` for Inspection Lens review. Export and import use memory fixtures; the gallery's Web catalog is memory data.

Check with `npm run check:ui`. The gallery lives outside `src` and normal build inputs; its Vite config rejects builds and owns a separate dependency cache, so it can run beside Desktop Vite (1420) and the Web Edition (1421). Ports are strict: stop the existing owner instead of accepting another port. Add fixtures for new reusable states; do not copy production markup into the gallery.

Real Web Edition storage, DuckDB catalog loading, browser downloads, Tauri IPC/WebView behaviour, native dialogs and packaged-app behaviour stay outside this host; the [editions guide](../../../docs/guides/editions.md) says how to check them.
