# Adding Canopi Web Edition To The Website

This handoff is for the coding agent working in the Canopi website repository, usually at `/home/projects/canopi-website/`. In this workspace the checkout was found at `/home/daylon/projects/canopi-website/`.

## Goal

Publish the built Canopi Web Edition as a full-screen static app at:

```text
https://projectcanopi.com/app/
```

The website should link to `/app/`, but it should not embed the app in an Astro page or iframe. The Web Edition owns its own top bar, right rail, canvas layout, drag/drop behavior, browser storage, language setting, theme setting, file import, and `.canopi` download flow.

## Product Boundary

The Web Edition source stays in the Canopi app repository, not in `canopi-website`.

Use the built Web Edition artifact only. Do not import Preact components, shared frontend modules, TypeScript source, CSS modules, catalog generators, DuckDB adapters, or Vite config from the Canopi app repo into the website repo.

Relevant app-side docs:

- `/home/daylon/projects/canopi/docs/adr/0012-web-edition-static-app-bundle.md`
- `/home/daylon/projects/canopi/docs/agent/build-release.md`
- `/home/daylon/projects/canopi/docs/agent/frontend-patterns.md`

## Website Repo Shape

The website is currently an Astro static site with Cloudflare deployment:

- `astro.config.mjs` sets `output: 'static'` and `site: 'https://projectcanopi.com'`.
- `wrangler.jsonc` serves `./dist` through Cloudflare Workers static assets.
- `public/_redirects` already exists and is copied into the built asset directory.
- Homepage entry points are `src/pages/index.astro` and `src/pages/[lang]/index.astro`.
- Header and hero CTAs live in `src/components/Header.astro` and `src/components/Hero.astro`.
- User-visible text is localized in all files under `src/i18n/translations/`.

Preserve existing dirty work in the website repo before editing. The checkout inspected during this handoff already had uncommitted release/i18n changes.

## Web Edition Artifact Contract

In the Canopi app repo, the release artifact is produced from `desktop/web`:

```bash
cd /home/daylon/projects/canopi/desktop/web
npm run package:web
```

That command runs the Web Edition build and emits:

```text
desktop/web/dist-web-artifacts/canopi-web-edition-v<version>-<commit>/
desktop/web/dist-web-artifacts/canopi-web-edition-v<version>-<commit>.tar.gz
```

The packaged archive root contains:

- `index.html`, repackaged from the Vite `web.html` entry.
- Vite assets built with base path `/app/`.
- Static Web Edition Species Catalog assets under their built app-relative paths, including any catalog, locale/search, filter metadata, or image metadata shards emitted by the Canopi app build.
- `canopi-web-edition-manifest.json`.

The manifest includes:

- `name`
- `version`
- `commit`
- `basePath`, which must be `/app/`
- `spaFallback`, currently `/app/* -> /app/index.html` with status `200`
- Cloudflare Pages-style size/file-count limits
- `catalog`, with `canopi-catalog/manifest.json`, generated asset format, supported filter keys, and required catalog file paths
- every payload file path, byte count, and SHA-256 checksum. The artifact manifest file itself is packaged alongside the payload files and counts against the file-count and per-asset limits even though it is not listed in `manifest.files`.

Production should use a versioned Web Edition release asset from the Canopi app release, not a copied source tree and not committed generated `/app` assets.

## Catalog And Performance Boundary

The Canopi app artifact owns Species Catalog filtering, search, DuckDB-WASM integration, catalog asset format, catalog sharding, supported-filter metadata, and performance tuning. The intended app-side catalog format is DuckDB-queryable Parquet shards with generated locale/search and current Web Edition filter metadata assets. The website implementation must only publish those static files exactly as verified from the artifact.

Do not recreate, optimize, or route around the Web Edition Species Catalog in `canopi-website`:

- Do not import Canopi app source, generated filter metadata, catalog generators, DuckDB adapters, Preact components, or Vite config.
- Do not run search or filtering through Astro, Workers, Pages Functions, R2, KV, D1, a custom API route, or a website-side generated index.
- Do not split catalog files out of the versioned artifact, rename catalog paths, rewrite catalog URLs, or serve catalog requests through the SPA fallback.
- Do not add service workers, app-managed precache, PWA install prompts, or offline-first catalog caching as a performance workaround.
- Do not self-host raw `duckdb-*.wasm` files unless a later Canopi app release explicitly includes them and the artifact manifest passes the Cloudflare asset-size gate.

The current Cloudflare Pages constraints to preserve are the Free-plan site file limit and the per-asset file-size limit. As of the Cloudflare Pages limits page last checked on July 8, 2026, Free-plan Pages sites can contain up to 20,000 files and a single Pages asset can be at most 25 MiB. The website install script should enforce the artifact manifest's stricter recorded limits if they are lower than Cloudflare's current limits.

The intended app-side performance direction is DuckDB-WASM querying generated Parquet catalog shards directly, behind the Web Edition Species Catalog Workbench and without expanding the current Web catalog data scope. That is app-repo work. Website work is reliable artifact installation, direct static serving, cache headers, and smoke checks.

## Recommended Website Implementation

Add a website-side install script, for example:

```text
scripts/install-web-edition.mjs
```

The script should run after `astro build` and install the artifact into:

```text
dist/app/
```

Recommended inputs:

- `CANOPI_WEB_EDITION_ARCHIVE`: local `.tar.gz` path, used for local preview and CI when another job downloaded the release asset.
- `CANOPI_WEB_EDITION_URL`: optional release asset URL. If used, download to an ignored temp directory before extraction.
- `CANOPI_WEB_EDITION_REQUIRED`: optional flag. In production, default to required and fail if no artifact is configured.

Recommended script behavior:

1. Create an ignored temp directory such as `.tmp/web-edition/`.
2. Extract the archive into a temp extraction directory.
3. Reject unsafe archive paths before copying into `dist/app/`: absolute paths, `..` segments, directories that escape the extraction root, symlinks, hard links, and device files.
4. Read `canopi-web-edition-manifest.json`.
5. Fail unless `manifest.basePath === '/app/'`.
6. Fail unless `manifest.spaFallback.source === '/app/*'` and `manifest.spaFallback.destination === '/app/index.html'`.
7. Verify every manifest-listed payload file has the expected byte count and SHA-256.
8. Verify no packaged file, including `canopi-web-edition-manifest.json`, exceeds the manifest's max asset size. If the manifest does not expose a stricter limit, fail above 25 MiB.
9. Verify the actual extracted file count, including `canopi-web-edition-manifest.json`, stays within the manifest's file-count limit. If the manifest does not expose a stricter limit, fail above 20,000 files.
10. Verify required catalog, locale/search, and supported-filter metadata paths listed by the artifact manifest exist before copying. Do not treat missing catalog files as optional.
11. Reject unlisted extracted files; the archive may contain only manifest-listed payload files plus `canopi-web-edition-manifest.json`.
12. Replace `dist/app/` atomically enough for local builds: remove only `dist/app/`, then copy the verified extracted artifact root there.
13. Fail if `dist/app/index.html` is missing.
14. Fail if `dist/app/canopi-web-edition-manifest.json` is missing.

Do not commit `dist/app/`, `dist/`, downloaded archives, or temp extraction directories.

Recommended package scripts:

```json
{
  "scripts": {
    "build": "astro build",
    "install:web-edition": "node scripts/install-web-edition.mjs",
    "build:with-web": "npm run build && npm run install:web-edition",
    "preview": "npm run build:with-web && wrangler dev",
    "deploy": "npm run build:with-web && wrangler deploy"
  }
}
```

If existing deployment infrastructure expects `npm run build`, either update the deployment command to `npm run build:with-web` or make `build` include the install step only when the production artifact environment variable is present. The production deploy must fail loudly if `/app/` would be missing.

## Routing

The Web Edition is a client-rendered app with a `/app/` base path. Direct reloads under `/app/*` must return `/app/index.html`.

Add this rule near the top of `public/_redirects`:

```text
/app/* /app/index.html 200
```

Cloudflare Workers static assets support `_redirects` files in the static asset directory and support relative proxying with status `200`. The current docs also support global SPA fallback via `assets.not_found_handling = "single-page-application"`, but do not use that globally for this website unless the whole site becomes an SPA. The marketing site should keep normal static 404 behavior outside `/app/*`.

References:

- https://developers.cloudflare.com/workers/static-assets/redirects/
- https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/

## Website Links And Copy

Add a first-class entry point to the Web Edition, but keep it outside locale routing:

```text
/app/
```

Do not generate `/<lang>/app/` routes. The app has its own language switcher and browser-local settings.

Suggested UI changes:

- Add an "Open Web Edition" or "Open in browser" link in `src/components/Header.astro`.
- Add a primary or secondary hero CTA in `src/components/Hero.astro` pointing to `/app/`.
- Keep desktop download links; Web Edition does not replace native downloads.
- Update all 11 translation files in `src/i18n/translations/` for any new visible copy.

The app route should be a normal navigation link, not an Astro route page and not an iframe.

## Web Edition Scope To Preserve

The website should not try to add missing app features around the artifact. As of Web Edition v1:

- Browser app route is `/app/`.
- Home screen matches the desktop-style welcome screen but omits recent files/recent designs.
- Visible Web Location editing is omitted.
- Browser-local drafts and autosave are internal, not a visible drafts list.
- Export is `.canopi` download only.
- No Problem Report flow.
- No Site Adaptation flow.
- No service worker, PWA install prompt, or offline-first cache.
- Species Catalog search/filter behavior, catalog search performance, Favorites, plant placement drag/drop, Plant Color, and Plant Symbol are implemented inside the Web Edition artifact.
- Web Edition Plant Detail remains reduced regardless of Species Catalog filter UI or performance changes.

If product wants any of those to change, change the Canopi app repo first and ship a new Web Edition artifact.

## Local Preview Flow

From the Canopi app repo:

```bash
cd /home/daylon/projects/canopi/desktop/web
npm run package:web
```

From the website repo:

```bash
cd /home/daylon/projects/canopi-website
CANOPI_WEB_EDITION_ARCHIVE=/home/daylon/projects/canopi/desktop/web/dist-web-artifacts/<artifact-name>.tar.gz npm run preview
```

Put the artifact environment variable on `npm run preview` because the recommended preview script runs `build:with-web` before starting Wrangler.

Then verify:

- `/` still serves the marketing homepage.
- `/fr/`, `/es/`, and other localized marketing routes still work.
- `/app/` serves the Web Edition.
- Reloading `/app/anything` returns the Web Edition shell through the `/app/*` fallback.
- App asset requests under `/app/assets/` return `200`, not the marketing homepage.
- Catalog asset requests under `/app/canopi-catalog/` or the catalog paths listed in the app manifest return the asset bytes directly, not `/app/index.html`.

## Browser Smoke Checks

Use Playwright or the browser MCP against the preview server.

Minimum checks:

1. Open `/app/`.
2. Confirm the Canopi Web Edition top bar and right rail render.
3. Confirm the home screen has New Design and Open Design, but no Recent Files or Recent Designs.
4. Confirm the right rail has Canvas, Plant Database, and Favorites, but no Location button.
5. Create a new design.
6. Open Plant Database.
7. Confirm the Plant Database search field, desktop-style filter strip, and active chips are visible.
8. Exercise at least one backed strip filter, then confirm results update without console errors.
9. If the artifact exposes backed More Filters fields, exercise one More Filters field and confirm results update without console errors.
10. Search for a two-character Species query and confirm results update without freezing the app.
11. Drag a species row to the canvas and confirm a plant appears.
12. Select the placed plant.
13. Confirm Plant Color and Plant Symbol controls are enabled and change the selected plant.
14. Favorite a species, open Favorites, and drag it to the canvas.
15. Use Download `.canopi` and confirm a file download is triggered.
16. Reload `/app/` and confirm browser-local recovery/autosave does not crash the app.

Also check the browser console and network panel for:

- no missing JS/CSS/assets
- no request for Tauri IPC
- no 404 for catalog assets
- no catalog asset request served with the Web Edition `index.html` response
- no catalog asset exceeding Cloudflare Pages file-size limits
- no failed `/app/` base-path requests

## Cache Headers

Do not add a service worker.

If the website adds `public/_headers`, use conservative rules:

```text
/app/index.html
  Cache-Control: no-cache

/app/canopi-web-edition-manifest.json
  Cache-Control: no-cache

/app/assets/*
  Cache-Control: public, max-age=31536000, immutable

/app/canopi-catalog/*
  Cache-Control: public, max-age=31536000, immutable
```

Only mark hashed or versioned static assets immutable. Keep `index.html` and the manifest revalidatable so a release can roll forward without users being pinned to an old entry HTML. If a future artifact emits catalog files without content-hashed names, prefer `Cache-Control: public, max-age=3600` for `/app/canopi-catalog/*` until the app artifact provides versioned paths.

## Acceptance Criteria

- `canopi-website` has no Canopi app source imports or copied source files.
- The deployed artifact is installed under `dist/app/` during build/deploy.
- `dist/app/canopi-web-edition-manifest.json` is verified before deploy.
- `public/_redirects` includes `/app/* /app/index.html 200`.
- Catalog files from the Web Edition artifact are copied under `/app/` and are served directly rather than through the SPA fallback.
- The install script enforces manifest checksums, actual file-set membership, per-asset byte limits, file-count limits including `canopi-web-edition-manifest.json`, and required catalog plus supported-filter metadata asset presence.
- Header and/or hero link users to `/app/`.
- All new website copy is localized across the existing 11 translation files.
- `npm run build:with-web` passes with a local artifact.
- `npm run preview` serves both the marketing site and `/app/`.
- Browser smoke checks pass for app load, direct reload, Plant Database search/filter behavior, catalog asset network responses, Plant Database drag/drop, Favorites drag/drop, Plant Color, Plant Symbol, and `.canopi` download.
