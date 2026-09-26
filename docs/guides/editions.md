# Editions

Canopi ships a Desktop edition (Tauri) and a Web edition (static bundle) built from one frontend, plus a memory-only UI gallery for development. The scope decision is [ADR 0005](../adr/0005-web-edition-scope.md). The shared architecture is in [architecture](../architecture.md#editions).

## Composition

- `desktop/web/src/main.tsx` (Desktop, `index.html`) and `desktop/web/src/main.web.tsx` (Web, `web.html`) are the entries. The codec, scene runtime, workbenches, Design Edit and `components/workspace/WorkspaceComposition.tsx` are shared. `DesktopWorkspace.tsx` and `web/WebWorkspace.tsx` supply the surfaces for each edition.
- Adapters are chosen at compile time through Vite aliases (`desktop/web/vite.config.ts`, mirrored in `tsconfig.json` for Desktop typing):

| Alias | Desktop | Web |
| --- | --- | --- |
| `#platform` | `platform/desktop.ts` | `platform/browser.ts` |
| `#species-catalog-live` | `app/plant-browser/live.desktop.ts` (SQLite over IPC) | `app/plant-browser/live.browser.ts` (DuckDB-WASM) |
| `#geocoding-transport` | `app/geocoding/transport.desktop.ts` (native HTTP) | `app/geocoding/transport.browser.ts` (`fetch`) |
| `#canvas-pdf-platform` | `app/canvas-pdf/platform.desktop.ts` (dialog + `save_canvas_pdf`) | `app/canvas-pdf/platform.browser.ts` (download) |
| `#budget-export-platform` | `app/budget/platform.desktop.ts` | `app/budget/platform.browser.ts` |

- Shared modules receive typed capabilities. They never branch on `isWeb` or `isTauri` to choose I/O. Add a new edition difference as a new alias or an injected capability.
- Commands: `app/shell-commands/index.ts` defines neutral ids. The Desktop command graph and `web/browser-shell-commands.ts` supply the capabilities each edition supports.
- Document hosts: Desktop sequencing is in `app/document-session/lifecycle.ts` and `use-canvas-document-session.ts`, Web sequencing in `web/WebCanvasWorkspace.tsx` and `web/browser-design-session.ts`. Both cross `app/document-session/replacement.ts`. See [design document](design-document.md).

## Web scope

- A static app with no backend, tile or image proxy, service worker, PWA install or offline cache. Production is served at `https://web.projectcanopi.com/` (root base). A `/app/` subpath artifact remains supported.
- The Browser App Shell (`web/BrowserAppShell.tsx`, fed by `web/browser-shell-commands.ts`) composes the same floating title bar and menus as Desktop from browser-safe commands: New, Open `.canopi`, Rename, Download a copy, Revert, Export to PDF, GeoJSON import and export, Settings, and panel toggles. The save status reads "Saved in this browser". There are no native window controls, Recent Designs, reveal actions, Design Notebook, updater or Problem Report. The Start screen omits Recent Designs.
- Browser-local data lives in `web/browser-app-data.ts`: four independent localStorage records (Drafts, Settings, Species activity, Saved Object Stamps). A missing, corrupt or foreign record reads as empty, and a failed write returns `{ ok: false }` and keeps the previous record. v1 storage is ignored. Drafts are the Web Design home: continuous save writes them and the Start screen lists them. A downloaded `.canopi` is an export.
- Maps and geocoding use the same providers and registry as Desktop, with attribution. Google needs the user's device key. There is no local raster processing: the Data panel is `web/WebLocalRasterPanel.tsx`, which says so, and the `lidar` section still round-trips.
- The Species Catalog is the reduced Parquet/DuckDB-WASM catalog; see [species catalog](species-catalog.md). Web Species UI is `web/WebSpeciesCatalogPanel.tsx`, never the Desktop `PlantDbPanel` or `PlantDetailCard`.
- Design Templates are Web-only static `.canopi` assets configured in `web/static-design-templates.ts`. With the default empty set, the entry is hidden.
- `desktop/web/scripts/check-web-build-boundaries.mjs` (run by `npm run build:web`) rejects Tauri markers (`__TAURI__`, `__TAURI_INTERNALS__`) and oversize assets in Web chunks. Never weaken it.

## Development hosts

Toolchain: Node.js 22.13+ (Node 22 line), npm from that install, Python 3, and the Rust version in `rust-toolchain.toml`. Install with `npm ci --prefix desktop/web`. Linux Desktop packages are listed in the root [README](../../README.md). The first dev, test or build run downloads the pinned PDF fonts into ignored `desktop/web/public/pdf-fonts/`.

| Host | Directory and command | Address | State |
| --- | --- | --- | --- |
| Desktop | repository root: `cargo tauri dev` | native window; Vite on `http://localhost:1420/` | Native app data and real files |
| Web | `desktop/web/`: `npm run dev:web` | `http://localhost:1421/app/` | Browser profile storage, generated catalog |
| UI gallery | `desktop/web/`: `npm run dev:ui` | `http://127.0.0.1:1422/` | Memory fixtures; reload resets |

- Ports are strict and each host has its own Vite dependency cache (`node_modules/.vite-desktop`, `.vite-web`), so all three can run at once. Stop an existing owner instead of accepting another port.
- Data prerequisites: the gallery needs none. Desktop needs `desktop/resources/canopi-core.db` for real catalog behaviour (`python3 scripts/prepare-db.py`). Web catalog interaction needs `npm run generate:web-catalog`, which writes ignored `desktop/web/public/canopi-catalog/`. Without it the shell starts and the catalog reports unavailable data.
- The gallery mounts production components and the real workspace composition with memory backends (`ui-gallery/fixtures.ts`, `memory-backend.ts`, `memory-dialogs.ts`). It takes the query parameters `surface`, `edition=web`, `state`, `theme=dark`, `locale` and `panelWidth` (see `desktop/web/ui-gallery/README.md`). It proves neither Tauri IPC, browser persistence, native dialogs, downloads nor the real catalog. Add fixtures for new reusable states. Never copy production markup into the gallery.
- Isolation: use a fresh browser profile for the Web edition (clearing site data for `localhost:1421` resets Drafts, Settings, activity and stamps). On Linux, isolate Desktop with fresh `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_CACHE_HOME` before `cargo tauri dev`; a separate Cargo target does not isolate app data. On macOS and Windows, use a disposable OS account. Never point an isolated session at a real user Design.

## Verification selection

`AGENTS.md` is the gate authority. From `desktop/web/`, `npm run check:editions` typechecks the app and gallery and builds both production bundles, including the Web boundary scan. It does not run tests, generated-contract checks, packaging or Rust gates.

| Change | Checks before handoff |
| --- | --- |
| Shared UI or workspace composition | focused Vitest, `npx tsc --noEmit`, `npm run check:ui`, `npm run build`, `npm run build:web`; `npm test` for shared runtime behaviour |
| Native adapter or IPC | frontend test, Desktop build, Rust fmt/clippy/tests, native command policy when a command changed |
| Browser adapter | focused browser tests, `npm run build:web`, `npx vitest run src/__tests__/web-edition-packaging.test.ts` when base paths or assets change |
| Catalog contract or artifact | Python contract tests, `npm run gen:types`, `npm run check:types`, packaging tests |
| Persistence or lifecycle | focused replacement/persistence tests, `npm test`, `tsc`, both builds, Rust workspace tests |
| Docs only | `python3 scripts/check_docs.py`; code tests are skipped |

A jsdom click does not prove native WebView behaviour. Report which host was actually driven: gallery, Web, `cargo tauri dev` or a packaged app.

## Web publishing

- This repository owns the Web source, the adapters, the reduced catalog, packaging and artifact admission. The website repository (`canopi-website`) and the dedicated deployment only consume a built artifact. They never import app modules, generated contracts, CSS, catalog generators or DuckDB adapters.
- `npm run package:web` builds for `/app/` (SPA fallback `/app/* -> /app/index.html`). `npm run package:web:root` sets `CANOPI_WEB_BASE_PATH=/` (fallback `/* -> /index.html`) for `web.projectcanopi.com`. Both need the generated catalog. Their output goes to ignored `desktop/web/dist-web-artifacts/` as a flat archive (`index.html`, `assets/`, `canopi-catalog/`, `canopi-web-edition-manifest.json`).
- The manifest records version, commit, base path, fallback, catalog metadata and every file's size and SHA-256. Packaging rejects raw `duckdb-*.wasm`, symlinks and files over the 25 MiB per-asset limit. DuckDB loads its own WASM from the CDN bundle.
- Never deploy the `/app/` artifact at a domain root or rewrite its URLs after packaging. The root deployment serves static files before the `/* /index.html 200` fallback. Missing assets must fail, not return the shell. Keep `index.html` and the manifest revalidatable, and cache only versioned assets immutably.
- Desktop release promotion does not publish Web archives. A Web deployment names and verifies the exact commit and artifact it uses.
- Smoke check at the configured base: the shell loads with no missing assets or Tauri requests; nested assets and Parquet files are served directly; species browse, a two-character search and a filter work; placement, `.canopi` download and reload recovery work. For root production, also confirm the manifest `basePath: "/"` and that an unknown route returns `index.html`.
