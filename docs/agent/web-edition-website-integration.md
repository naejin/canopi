# Web Edition Website Integration

Use this guide when publishing a Canopi Web Edition artifact from the app repository through the website repository or the dedicated Web Edition deployment.

## Ownership Boundary

- This repository owns Web Edition source, browser adapters, the Vite build, the reduced Species Catalog, DuckDB-WASM query behavior, artifact packaging, and artifact admission tests.
- `canopi-website` owns the marketing-site link plus the optional `/app/` compatibility installer and route.
- The dedicated Web Edition deployment owns root artifact publication, root routes and cache headers, and production smoke checks.
- The website must consume a built artifact. It must not import Canopi Preact modules, generated contracts, CSS, Vite configuration, catalog generators, or DuckDB adapters.
- Production Web Edition is served at `https://web.projectcanopi.com/`. The marketing-site hero links to that root deployment.

## Artifact Variants

Run packaging commands from `desktop/web`. Both require generated catalog assets under ignored `public/canopi-catalog/`; create them first from a local canopi-data export with `npm run generate:web-catalog`.

| Command | Manifest `basePath` | Manifest SPA fallback | Deployment |
| --- | --- | --- | --- |
| `npm run package:web` | `/app/` | `/app/* -> /app/index.html` | Same-origin subpath install or compatibility preview |
| `npm run package:web:root` | `/` | `/* -> /index.html` | `https://web.projectcanopi.com/` root deployment |

Both commands build before packaging. The archives are flat: `web.html` becomes `index.html`, with `assets/`, `canopi-catalog/`, and `canopi-web-edition-manifest.json` beside it. There is no packaged top-level `app/` directory.

The manifest records version, commit, base path, fallback metadata, deployment limits, catalog metadata, and every payload file's byte count and SHA-256. Packaging admits only the generated Parquet catalog contract, rejects raw `duckdb-*.wasm` payloads, and checks the actual file count and per-asset size.

The normal desktop release promotion currently selects desktop installer formats only; it does not publish Web Edition archives automatically. A Web deployment must identify and verify the exact app commit and artifact it uses.

## Production Root Deployment

The dedicated Cloudflare Pages project consumes only the root artifact. Its deploy directory adds root-hosting files such as:

```text
/* /index.html 200
```

Static assets, the manifest, workers, images, and `canopi-catalog/` files must resolve directly before the SPA fallback. Never deploy the default `/app/` artifact at a domain root, and never rewrite its `/app/` URLs after packaging.

Production deployment and browser smoke were completed under bead `canopi-2k4k`; later production artifact updates use the same root-base contract. A production verification must confirm that the manifest has `basePath: "/"`, the entry HTML contains no `/app/` asset references, direct static requests return their real content types, and an unknown client route returns `index.html`.

## Marketing-Site Subpath Install

The website repository keeps a compatibility installer for the default `/app/` artifact. `scripts/install-web-edition.mjs`:

- accepts `CANOPI_WEB_EDITION_ARCHIVE`;
- validates the `/app/` base and manifest fallback metadata;
- rejects unsafe archive entries, unlisted files, checksum/byte mismatches, missing catalog metadata, raw DuckDB WASM, and limit violations;
- installs into `dist/client/app/` for the Astro Cloudflare build, or `dist/app/` for a plain static build;
- replaces only the owned app output after verification.

From the website repository:

```bash
CANOPI_WEB_EDITION_ARCHIVE=/path/to/canopi-web-edition-v<version>-<commit>.tar.gz npm run build:with-web
```

The current marketing-site route is:

```text
/app/:route /app/ 200
```

This hosting rule intentionally differs from the artifact manifest's abstract fallback metadata. It handles one-segment client routes while leaving nested `/app/assets/` and `/app/canopi-catalog/` paths to static file serving. It also rewrites single-segment file paths such as `/app/canopi-web-edition-manifest.json`, so `/app/` is a non-production compatibility preview rather than the production verification target. Do not restore `/app/* /app/index.html 200`; Wrangler treated that broad rewrite as an infinite loop and it can mask real static files. Do not enable a global SPA fallback for the Astro marketing site.

The website installer accepts only the `/app/` artifact. Do not pass it a root artifact; root deployment has a separate verified publish flow.

## Catalog And Cache Invariants

- Serve the artifact unchanged. Do not move, rename, proxy, or regenerate catalog files in the website repository.
- Search, filtering, locale handling, and DuckDB-WASM remain app-owned browser behavior. Do not add Workers, Pages Functions, R2, KV, D1, or a website-side index for catalog queries.
- Do not add a service worker, PWA install flow, or app-managed precache as a hosting workaround.
- Keep `index.html` and `canopi-web-edition-manifest.json` revalidatable.
- Apply immutable caching only to content-hashed or otherwise versioned assets. Catalog cache policy must match the emitted naming/version contract.
- Missing asset and catalog paths must remain real failures rather than returning the app shell.

## Verification

In this repository, verify packaging behavior with:

```bash
cd desktop/web
npx vitest run src/__tests__/web-edition-packaging.test.ts
```

In `canopi-website`, verify the installer and static build with:

```bash
npm test
CANOPI_WEB_EDITION_ARCHIVE=/path/to/artifact.tar.gz npm run build:with-web
```

For either artifact shape, smoke-check the app behavior at its configured base:

1. The app shell loads without missing assets or Tauri IPC requests.
2. Nested JS, CSS, worker, image, catalog manifest, and Parquet paths are served directly rather than returning the app shell.
3. Species browse, a two-character search, and one manifest-backed filter work without console or network errors.
4. Plant placement, selection presentation, Favorites placement, `.canopi` download, and reload recovery work.

For the production root deployment, additionally verify that the manifest is served directly, its commit and base path match the selected artifact, and an unknown client route returns `index.html`. The marketing-site `/app/` compatibility build is validated by its installer tests and static output checks; its current one-segment rewrite is not a production routing contract.

Change Web Edition behavior in this repository and publish a new artifact. Change only installation, routes, cache headers, marketing links, or hosting in `canopi-website` or the dedicated deployment flow.
