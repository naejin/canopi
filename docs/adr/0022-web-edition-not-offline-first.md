# Web Edition is not offline-first in v1

Status: Accepted

The Web Edition v1 should be a static browser app served from Cloudflare Pages, but it should not add a service worker, PWA install flow, offline-first cache, or app-managed precache strategy in v1. It may rely on normal browser HTTP caching for app assets, DuckDB-WASM assets, catalog shards, and map/image requests.

Offline-first behavior would add cache invalidation, large-asset quota, stale catalog, map-tile policy, and support complexity before the core Web Edition has proved its browser shell, DuckDB-WASM catalog, `.canopi` import/export, and browser-local drafts. Browser Drafts remain local convenience state, but that does not imply the whole Web Edition is available offline.

Maps and remote Species hero images are network-dependent in v1. The app should tolerate unavailable network resources gracefully, but it should not bulk-prefetch map tiles, bundle image binaries, or promise offline map/image use.
