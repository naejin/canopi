# Editions

## Purpose

One frontend ships as a Desktop edition (Tauri), a Web edition (static bundle) and a memory-only UI gallery for development. This guide states where the editions differ, who owns each difference and what a change must not do. The scope decision is [ADR 0005](../adr/0005-web-edition-scope.md); the shared architecture is in [architecture](../architecture.md#editions).

## Authorities and boundaries

- Entries: `desktop/web/src/main.tsx` with `index.html` (Desktop) and `main.web.tsx` with `web.html` (Web). The codec, scene runtime, workbenches, Design Edit and `components/workspace/WorkspaceComposition.tsx` are shared; `DesktopWorkspace.tsx` and `web/WebWorkspace.tsx` bind the edition's capabilities.
- Every edition difference is a compile-time alias (`desktop/web/vite.config.ts`, mirrored in `tsconfig.json`; the UI gallery maps the same aliases to its memory fixtures) or an injected capability (for example `context.edition` in `app/analyses/model.ts`). These are the only aliases:

| Alias | Desktop | Web |
| --- | --- | --- |
| `#platform` | `platform/desktop.ts` | `platform/browser.ts` |
| `#species-catalog-live` | `app/plant-browser/live.desktop.ts` (SQLite over IPC) | `app/plant-browser/live.browser.ts` (DuckDB-WASM) |
| `#geocoding-transport` | `app/geocoding/transport.desktop.ts` (native HTTP) | `app/geocoding/transport.browser.ts` (`fetch`) |
| `#canvas-pdf-platform` | `app/canvas-pdf/platform.desktop.ts` (dialog + `save_canvas_pdf`) | `app/canvas-pdf/platform.browser.ts` (download) |
| `#budget-export-platform` | `app/budget/platform.desktop.ts` | `app/budget/platform.browser.ts` |

- Commands: `app/shell-commands/index.ts` owns the neutral command ids; the Desktop command graph and `web/browser-shell-commands.ts` each declare the capabilities their edition supports. The Web set has no Recent Designs, Design Notebook, Problem Report, updater or native window controls, and drops the shortcuts a browser keeps (`BROWSER_RESERVED_SHORTCUTS`: Ctrl 1–9, Ctrl N, Ctrl Q, Ctrl W).
- Web data: `web/browser-app-data.ts` owns four independent localStorage records (Drafts, Settings, Species activity, Saved Object Stamps). Drafts are the Web Design home; a downloaded `.canopi` is an export. Document hosts are described in [design document](design-document.md).
- Phone layout: the Browser App Shell owns `installPhoneLayout` (`app/shell/phone-layout.ts`): `portrait` below 640 px wide, `landscape` when wider than tall, under 480 px tall and under 960 px wide, else null. `WorkspaceComposition` shows `components/shared/PhoneSheet.tsx` instead of the dock only when the edition passes `phoneTabs`; Desktop passes none. Design: [controls and shell](../../.interface-design/patterns/controls-and-shell.md).
- Web maps and catalog: the same providers and geocoding registry as Desktop; no local raster processing, so Web has no Site data panel, Profile or Data library. The catalog is the reduced Parquet artifact ([species catalog](species-catalog.md)).
- Publishing: this repository owns the Web source, adapters, catalog artifact and packaging. The website repository and deployment consume only the built archive and never import app modules, generated contracts, CSS or catalog generators.

## Rules

- Shared modules never branch on the edition to choose I/O; add an alias or a capability. The Web entry graph must not reach `@tauri-apps/**` or `ipc/**`, and the alias table stays in sync with `WEB_EDITION_ALIAS_TARGETS` (`__tests__/frontend-architecture-policies.test.ts`: "Web entry stays outside the Desktop app graph", "resolves every edition alias to the Web target Vite uses").
- Web chunks carry no Tauri markers (`__TAURI__`, `__TAURI_INTERNALS__`), no raw DuckDB or Desktop raster-decoder `.wasm` and no asset over 25 MiB: `desktop/web/scripts/check-web-build-boundaries.mjs`, run by `npm run build:web` (`__tests__/web-build-configuration.test.ts`). Never weaken it.
- The Web shell renders only browser-safe commands and chrome (`__tests__/web-app-shell.test.tsx`, `web-shell-projection.test.ts`).
- A missing, corrupt or foreign browser record reads as empty; a failed write returns `{ ok: false }` and keeps the previous record. Until P25 (release close; then left under their keys, unread, ADR 0021), at startup the 1.x record (`canopi:web-app-data:v1`) and older-format Drafts are copied to `canopi:web-app-data:before-2.0-<UTC stamp>:<key>`, read back, then removed, and the shell says so once; a backup never replaces another.
  Data whose copy does not fit the quota stays in place, hidden, with a one-time "kept in place" notice, and moves on a later start (ADR 0021) (`__tests__/browser-app-data.test.ts`, `bootstrap-shell.test.ts`).
- Phone classification and the sheet's heights and keys are pure and tested (`__tests__/phone-layout.test.tsx`).
- The Templates entry appears only when `web/static-design-templates.ts` configures one; the default set is empty (`__tests__/web-static-design-template-catalog.test.ts`).
- Web Layers' Site data row reads "N terrain or height layers in this Design · Needs Canopi Desktop", absent with none, and the `lidar` section round-trips unchanged (`__tests__/web-layers-panel.test.tsx`).
- The packaged archive is flat (`index.html`, `assets/`, `canopi-catalog/`, `canopi-web-edition-manifest.json`); the manifest records version, commit, base path, fallback, catalog metadata and every file's size and SHA-256; packaging rejects raw `duckdb-*.wasm`, symlinks and files over 25 MiB (`__tests__/web-edition-packaging.test.ts`).
- Ports are strict (`strictPort: true` in every Vite config) and each host has its own dependency cache, so all three hosts run at once (advice).

## Do not

- Do not branch on `isWeb` / `isTauri`; there is no such flag, and a policy test would reject the platform import you would need.
- Do not accept another port when 1420, 1421 or 1422 is busy; stop the existing owner.
- Do not deploy the `/app/` artifact at a domain root or rewrite its URLs after packaging; build the root artifact instead.
- Do not let a missing asset return the shell: static files are served before the SPA fallback.
- Do not point an isolated session at a real user Design; on Linux isolate Desktop with fresh `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_CACHE_HOME` (a separate Cargo target does not isolate app data).
- Do not report a jsdom click as proof of WebView behaviour; say which host was driven (gallery, Web, `cargo tauri dev` or a packaged app).
- Do not copy production markup into the gallery; add a fixture.

## Development hosts

Toolchain: Node `^22.13.0` (`engines` in `desktop/web/package.json`), Python 3, the Rust version in `rust-toolchain.toml`. Install with `npm ci --prefix desktop/web`. The first dev, test or build run downloads the pinned PDF fonts into ignored `desktop/web/public/pdf-fonts/`.

| Host | Command | Address | Data |
| --- | --- | --- | --- |
| Desktop | repository root: `cargo tauri dev` | native window; Vite on `http://localhost:1420/` | real app data and files; needs `desktop/resources/canopi-core.db` (`python3 scripts/prepare-db.py`) for the catalog |
| Web | `desktop/web/`: `npm run dev:web` | `http://localhost:1421/app/` | browser profile storage; catalog needs `npm run generate:web-catalog` (ignored `public/canopi-catalog/`) |
| UI gallery | `desktop/web/`: `npm run dev:ui` | `http://127.0.0.1:1422/` | memory fixtures; reload resets ([gallery README](../../desktop/web/ui-gallery/README.md)) |

`npm run check:editions` typechecks the app and the gallery and builds both bundles (with the boundary scan); it runs no tests. Clearing site data for `localhost:1421` resets every Web record. With `edition=web` the gallery shows the phone layout in a phone-sized window (390×844, 844×390).

## Web publishing

```bash
cd desktop/web && npm run package:web        # /app/ base, SPA fallback /app/* -> /app/index.html
cd desktop/web && npm run package:web:root   # CANOPI_WEB_BASE_PATH=/ for web.projectcanopi.com
```

Both need the generated catalog and write to ignored `desktop/web/dist-web-artifacts/`. DuckDB loads its own WASM from the CDN bundle. Keep `index.html` and the manifest revalidatable and cache only versioned assets immutably. Desktop release promotion never publishes Web archives; a deployment names the exact commit and artifact it serves.

Smoke check at the configured base: the shell loads with no missing assets or Tauri requests, Parquet files are served directly, browse, a two-character search and a filter work, and placement, `.canopi` download and reload recovery work. At root also confirm `basePath: "/"` in the manifest and that an unknown route returns `index.html`.

## Where to look

| Area | Module | Tests |
| --- | --- | --- |
| Aliases and entries | `desktop/web/vite.config.ts`, `tsconfig.json`, `src/platform/` | `frontend-architecture-policies.test.ts`, `web-dev-entry.test.ts` |
| Web shell and commands | `src/web/BrowserAppShell.tsx`, `src/web/browser-shell-commands.ts` | `web-app-shell.test.tsx`, `web-shell-projection.test.ts` |
| Web document host | `src/web/WebCanvasWorkspace.tsx`, `src/web/browser-design-session.ts` | `web-canvas-workspace.test.tsx`, `web-design-session.test.ts` |
| Browser records | `src/web/browser-app-data.ts` | `browser-app-data.test.ts` |
| Phone layout | `src/app/shell/phone-layout.ts`, `src/components/shared/PhoneSheet.tsx` | `phone-layout.test.tsx` |
| Web packaging | `desktop/web/scripts/package-web-edition.mjs`, `check-web-build-boundaries.mjs` | `web-edition-packaging.test.ts`, `web-build-configuration.test.ts` |
| UI gallery | `desktop/web/ui-gallery/` | `ui-gallery-*.test.ts(x)` |
