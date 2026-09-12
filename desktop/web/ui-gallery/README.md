# UI gallery

From desktop/web: `npm run dev:ui`. Open http://127.0.0.1:1422/.

The seven surfaces mount their production components over a real disposable canvas runtime. The backend and file dialogs are replaced only by this Vite configuration; native operations use memory fixtures. No user database, Design, settings store or file is read or written. Reload resets the session.

Direct links:

- [Plant color](http://127.0.0.1:1422/?surface=color)
- [Plant symbol](http://127.0.0.1:1422/?surface=symbol)
- [Species key](http://127.0.0.1:1422/?surface=key)
- [Layers](http://127.0.0.1:1422/?surface=layers)
- [Favorites](http://127.0.0.1:1422/?surface=favorites)
- [Design notebook](http://127.0.0.1:1422/?surface=notebook)
- [Inspection lens](http://127.0.0.1:1422/?surface=lens)

Add `state=empty|mixed|long|located`, `theme=dark`, or `locale=fr`. Empty appearance stories intentionally have no editable selection. Both header review controls and the real canvas toolbar remain interactive. For a fresh selection after clicking the canvas, reload.

Check with `npm run check:ui`. The gallery lives outside src and normal build inputs. Its Vite config rejects builds and owns a separate dependency cache so the gallery can run beside the main dev server. Add fixtures for new reusable states; do not copy production markup into the gallery.

The located state supplies a sample site; the location setup action also installs that sample in memory. Export reports completion in memory. Import uses the sample Design. Native dialog/file delivery and Web Species Catalog admission remain covered by their own tests; this gallery exercises presentation and interaction.

The Design notebook mounts the production panel and workbench with in-memory reference adapters. Use `state=dense` for Inspection Lens navigation and source-outline review.
Use `?surface=favorites&edition=web` to review the production Web Favorites component against the gallery’s memory backend.
