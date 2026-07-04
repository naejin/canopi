# Web Edition uses street basemap only in v1

Status: Accepted

The Web Edition v1 keeps Location and interactive MapLibre street basemap behavior, but does not include satellite basemaps, terrain contours, hillshade, or offline tile download features. The v1 street basemap may use `https://tile.openstreetmap.org/{z}/{x}/{y}.png` for normal interactive viewing only.

This keeps the Web Edition compatible with static hosting on Cloudflare Pages without introducing a backend tile proxy, protected map-provider API keys, large bundled tile pyramids, or offline tile archives. It also keeps the web map scope aligned with OpenStreetMap tile policy: browser clients may request tiles needed for normal human map viewing with attribution, referer, and standard HTTP caching, but must not bulk-download, prefetch large areas, or offer offline tile use from `tile.openstreetmap.org`.

Satellite basemaps, terrain contours, hillshade, and offline maps can be reconsidered later only with a provider plan that is compatible with public-browser credentials, static hosting, attribution, caching, rate limits, and offline/prefetch terms. ADR 0022 separately records that Web Edition v1 should not add a service worker, PWA install flow, or offline-first cache.
