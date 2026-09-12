# UI gallery

From desktop/web: `npm run dev:ui`. Open http://127.0.0.1:1422/.

The six approved surfaces mount their production components over a real disposable canvas runtime. The backend and file dialogs are replaced only by this Vite configuration; native operations use memory fixtures. No user database, Design, settings store or file is read or written. Reload resets the session.

Direct links:

- [Plant color](http://127.0.0.1:1422/?surface=color)
- [Plant symbol](http://127.0.0.1:1422/?surface=symbol)
- [Species key](http://127.0.0.1:1422/?surface=key)
- [Layers](http://127.0.0.1:1422/?surface=layers)
- [Favorites](http://127.0.0.1:1422/?surface=favorites)
- [Inspection lens](http://127.0.0.1:1422/?surface=lens)

Add `state=empty|mixed|long|located`, `theme=dark`, or `locale=fr`. Empty appearance stories intentionally have no editable selection. Both header review controls and the real canvas toolbar remain interactive. For a fresh selection after clicking the canvas, reload.

Check with `npm run check:ui`. The gallery lives outside src and normal build inputs. Its Vite config rejects builds and owns a separate dependency cache so the gallery can run beside the main dev server. Add fixtures for new reusable states; do not copy production markup into the gallery.

The located state supplies a sample site; the location setup action also installs that sample in memory. Export reports completion in memory. Import uses the sample Design. Native dialog/file delivery and Web Species Catalog admission remain covered by their own tests; this gallery exercises presentation and interaction.

## Pending design review: revised dock proposals

Run the same `npm run dev:ui` command. Open
[revised proposals](http://127.0.0.1:1422/?proposal=1&surface=layers&variant=A).
The explicit `proposal=1` toggle mounts throwaway components from
`review-proposals.tsx` inside the existing gallery. This is a review of desktop
surfaces, including Design Notebook; it does not add Notebook to Web Edition.
Production source and the accepted design contract are unchanged.

Direct links: [Layers](http://127.0.0.1:1422/?proposal=1&surface=layers),
[Plant symbol](http://127.0.0.1:1422/?proposal=1&surface=symbol),
[Design notebook](http://127.0.0.1:1422/?proposal=1&surface=notebook),
[Favorites](http://127.0.0.1:1422/?proposal=1&surface=favorites).
The floating comparison bar switches `variant=A|B`. Left/right keys also switch
when focus is outside controls. State links retain proposal/variant parameters.

- Layers A: counted scene stack, recognizable icons, separate site references,
  stable inspector below the complete stack. B exposes scene opacity inline.
- Symbol A: three columns with word-boundary wrapping, so Groundcover stays
  together; keyboard navigation follows the three-column layout. B mounts the
  current four-column production editor for comparison. The apply actions edit
  only the sample canvas.
- Notebook A: open sectioned ledger with a restrained active-design edge,
  compact Add current design/New section actions, direct removal confirmation,
  row drag between sections, section-title drag and double-click/F2 rename.
  B starts with secondary sections collapsed. Both remain one ledger.
- Favorites A: the earlier ruled-row layout, resizable Plants/Saved stamps,
  explicit Place/favorite/info actions. The info chevron replaces the whole
  dock with the existing plant detail component; Back/Escape restores the
  list, search and triggering control. B mounts current production Favorites.

Prototype limits: English proposal chrome (existing shared controls and symbol
names still honor locale), sample detail facts, illustrative stamp thumbnails,
mock stamp placement/import/export and mock Notebook switching. These actions
report their result in the gallery status area and do not read or write user
files. Favorites/detail favorite state and layer/symbol controls use the existing
memory-backed gallery surfaces. Notebook organization and stamp edits reset on
reload or prototype unmount; they are not persistence implementations. Test
`state=empty|long|mixed|located`, `theme=dark`, and `locale=fr` as appropriate.

These proposals are awaiting user review under `canopi-sa3b`; no direction is
accepted by this README. Capture the selected design in bd, implement it through
production authorities with regression coverage, then delete the throwaway
components. Use `npm run check:ui` for this development entry point.
