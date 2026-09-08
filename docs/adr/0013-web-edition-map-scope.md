# Web Edition map scope is street basemaps only

Status: Accepted

The initial Web Canvas map capability will display street basemaps for Designs that already have a saved Location. Designs without a saved Location have no basemap. This provides site context while keeping Location editing deferred under [ADR 0016](0016-web-edition-omits-geocoding.md). Satellite imagery, terrain contours, hillshade, and offline tile downloads remain outside this initial scope.

This is an approved direction; the current Web Canvas mounts no basemap yet. The static Design Template world map is available only when templates are configured, as described in [ADR 0017](0017-web-edition-static-design-templates.md). [Canvas PDF](0024-shared-canvas-pdf-export.md) separately approves an optional street-basemap background for Designs with a saved Location, with satellite imagery and terrain deferred from its first release.

Map sources must support their intended interactive or print use, with attribution and provider-compatible caching, without a backend tile proxy, protected credentials, bundled tile pyramids, bulk downloads, or offline archives. Adding other map sources or capabilities requires a provider plan compatible with public browser access and its attribution, rate, caching, and offline/prefetch terms. The current interactive tile source has not been validated for the planned PDF coverage and resolution. [ADR 0022](0022-web-edition-not-offline-first.md) separately excludes service workers, PWA installation, and offline-first caching.
