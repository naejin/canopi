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

## Final recommended proposals — pending review

Run the same `npm run dev:ui` command. Open
[the final lens proposal](http://127.0.0.1:1422/?proposal=1&surface=lens&state=dense),
then use the surface tabs to review the complete recommendation. The explicit
`proposal=1` toggle mounts throwaway components inside the existing gallery.
This is a review of desktop surfaces, including Design Notebook; it does not add
Notebook to Web Edition. Production source and accepted design guides remain
unchanged until the proposals are approved and implemented.

Direct links: [Layers](http://127.0.0.1:1422/?proposal=1&surface=layers),
[Plant symbol](http://127.0.0.1:1422/?proposal=1&surface=symbol),
[Design notebook](http://127.0.0.1:1422/?proposal=1&surface=notebook),
[Favorites](http://127.0.0.1:1422/?proposal=1&surface=favorites),
[Inspection lens](http://127.0.0.1:1422/?proposal=1&surface=lens&state=dense).

- Layers: counted scene stack, recognizable icons, separate site references,
  stable inspector below the complete stack. Hidden and locked are reported
  independently. Opacity settings never rearrange the stack.
- Symbol: compact three-column choices with word-boundary wrapping, so
  Groundcover stays together; keyboard navigation follows the grid. Apply
  actions edit only the sample canvas.
- Notebook: compact, open sectioned ledger with a restrained active-design
  edge, Add current design/New section actions, direct removal confirmation,
  row drag between sections, section-title drag and double-click/F2 rename.
- Favorites: earlier ruled-row layout with resizable Plants/Saved stamps and
  distinct Place/favorite/info actions. The info chevron replaces the entire
  dock with the existing plant detail component; Back/Escape restores the
  list, search and triggering control.
- Inspection lens: independent view, initialized at canvas center. There is
  **no pointer tracking, automatic pause/resume, Follow pointer or Hold view**.
  Drag the preview or use arrow keys to pan; Shift makes larger keyboard steps.
  Click a name to center it. Zoom, expand and Center on canvas are explicit
  view actions. The source outline is solid and noninteractive. Closing the
  lens removes its preview/source outline and restores launcher focus. The
  existing runtime owns rendering and disposal. The scene, canvas selection
  and main camera remain unchanged by inspection actions.

The default view presents one recommendation. Previous comparisons for the four
original surfaces remain explicitly available with `compare=1&variant=A|B`.
The lens has only the final proposal. `state=dense` provides a compact planting
fixture at a reduced main-canvas zoom for lens review. Other useful states are
`empty|long|mixed|located`; add `theme=dark` or `locale=fr` as appropriate.

Prototype limits: English proposal chrome (existing shared controls and symbol
names honor locale), sample detail facts, illustrative stamp thumbnails, mock
stamp placement/import/export and mock Notebook switching. These actions report
their result in the gallery status area without reading/writing user files.
Favorites/detail favorite state and layer/symbol controls use the existing
memory-backed gallery surfaces. Notebook organization and stamp edits reset on
reload or prototype unmount; these are not persistence implementations.

Review is tracked under `canopi-sa3b`. Capture approval in bd, implement through
production authorities with regression coverage, then delete the throwaway
components. `npm run check:ui` checks the development entry point. The existing
production inspection guide still describes the shipped UI, including its old
modes; revise it when the accepted replacement ships, not during proposal review.
