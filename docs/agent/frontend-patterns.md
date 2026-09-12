# Frontend guide

Start here for Preact, signals, localization, CSS, panels, form controls, and frontend tests. Read the relevant linked section; do not load every frontend guide by default.

For UI/UX work, first read the [design contract](../../.interface-design/system.md), then the surface-family guide it identifies. Start the real-component gallery with `cd desktop/web && npm run dev:ui`. It uses a disposable canvas runtime and memory backend, isolated from user Designs, settings storage, and the plant database.

| Work | Read |
| --- | --- |
| Preact, effects, cleanup, command boundaries | [Runtime and interaction](frontend-runtime.md) |
| Species Catalog, Favorites, Notebook, shared dock | [Workbench ownership](frontend-workbenches.md), relevant section |
| Web shell, browser storage, browser species runtime | [Browser Edition](browser-edition.md), relevant section |
| Floating controls, focus, dismissal, CSS implementation | [Chrome implementation](frontend-chrome.md) |
| Translation keys, tests and architecture/CSS guards | [Localization and validation](frontend-validation.md) |
| Main canvas scene/runtime | [Canvas runtime](canvas-runtime.md) |
| Save/load, dirty state, document authority | [Document lifecycle](document-lifecycle.md) |

Use Preact and CSS Modules; state uses `@preact/signals`. Components call workbenches/actions; canvas edits go through runtime commands, other document edits through Design Edit. A view must not mirror an authority's state just to restyle it.

For visual changes, preserve behavior tests and verify layout live. For changed behavior, add a focused regression at the command or interaction boundary. Run TypeScript and focused Vitest; broad shared changes also require the full frontend suite. The repository contract defines the remaining quality gates.

Keep guides scoped. Replace stale rules when behavior changes; avoid appending one-off debugging notes. Exact token values belong in global.css; surface anatomy belongs in the design guides.
