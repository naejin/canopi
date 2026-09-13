# UI gallery

From `desktop/web/`, run `npm run dev:ui`. Open http://127.0.0.1:1422/.

The gallery mounts production workspace and panel components over one real disposable canvas runtime. The backend and file dialogs are replaced only by this Vite configuration; native operations use memory fixtures. No user database, Design, settings store or file is read or written. Reload resets the session.

Direct links:

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

Add `state=empty|mixed|long|located|dense`, `theme=dark`, `locale=fr`, or `panelWidth=320|352|480|800`. `surface=workspace` uses the real edition command projection and shared workspace composition; its extra command row switches production primary and side surfaces. Add `edition=web` to use browser-safe registrations and exercise the production stacked dock breakpoint on a narrow viewport. The Web workspace deliberately has no Location, Design Notebook, or other unavailable Desktop command. Edition links reload the page instead of mounting two canvas owners together. Calendar fixtures use September 2026 so visual reviews are deterministic. Empty appearance stories intentionally have no editable selection. Both header review controls and the real canvas toolbar remain interactive. For a fresh selection after clicking the canvas, reload.

Check with `npm run check:ui`. The gallery lives outside `src` and normal build inputs. Its Vite config rejects builds and owns a separate dependency cache, so it can run with Desktop Vite on port 1420 and real Web Edition on port 1421. All ports are strict: stop the existing owner instead of accepting Vite's next available port. Add fixtures for new reusable states; do not copy production markup into the gallery.

The located state supplies a sample site; the location setup action also installs that sample in memory. Export reports completion in memory. Import uses the sample Design. The gallery's Web catalog uses memory data so the host remains deterministic; real Web Species Catalog admission stays covered by its own tests. Native dialog/file delivery remains outside the gallery.

The Design notebook mounts the production panel and workbench with in-memory reference adapters. Use `state=dense` for Inspection Lens navigation and source-outline review.
Use `?surface=favorites&edition=web` to review the production Web Favorites component against the gallery’s memory backend.

Reloading reconstructs the gallery session and resets its memory state. Stop it with Ctrl-C. Real Web Edition storage, DuckDB catalog loading, browser downloads, Tauri IPC/WebView behavior, native file dialogs, and packaged-app behavior remain outside this host; use the [edition development guide](../../../docs/agent/edition-development.md) to choose those checks safely.
