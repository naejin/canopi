# Web Edition map scope is street basemaps only

Status: Accepted

Web Edition v1 map scope permits street basemaps and excludes satellite imagery, terrain contours, hillshade, and offline tile downloads. This is a scope limit, not a promise of desktop map parity: [ADR 0016](0016-web-edition-omits-geocoding.md) excludes Location editing, and the current Web Canvas mounts no basemap. The static Design Template world map is available only when templates are configured, as described in [ADR 0017](0017-web-edition-static-design-templates.md).

Permitted maps use tiles for normal interactive viewing with attribution and provider-compatible caching, without a backend tile proxy, protected credentials, bundled tile pyramids, bulk downloads, or offline archives. Adding other map sources or capabilities requires a provider plan compatible with public browser access and its attribution, rate, caching, and offline/prefetch terms. [ADR 0022](0022-web-edition-not-offline-first.md) separately excludes service workers, PWA installation, and offline-first caching.
