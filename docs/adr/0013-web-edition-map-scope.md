# Web Edition map scope is street basemaps only

Status: Accepted

The initial Web Canvas map capability will display street basemaps for Designs that already have a saved Location. Designs without a saved Location have no basemap. This provides site context while keeping Location editing deferred under [ADR 0016](0016-web-edition-omits-geocoding.md). Satellite imagery, terrain contours, hillshade, and offline tile downloads remain outside this initial scope.

This is an approved direction; the current Web Canvas mounts no basemap yet. The static Design Template world map is available only when templates are configured, as described in [ADR 0017](0017-web-edition-static-design-templates.md). [Canvas PDF](0024-shared-canvas-pdf-export.md) retains print selection for Design Layers but defers all map backgrounds beyond its first release. Interactive Web maps are separate work and do not block Canvas PDF v1.

Map sources must support their intended use, with attribution and provider-compatible caching, without a backend tile proxy, protected credentials, bundled tile pyramids, bulk downloads, or offline archives. Adding other map sources or capabilities requires a provider plan compatible with public browser access and its attribution, rate, caching, and offline/prefetch terms. Any later PDF map export must validate its own print coverage, resolution, and provider terms; interactive map support does not establish print suitability. [ADR 0022](0022-web-edition-not-offline-first.md) separately excludes service workers, PWA installation, and offline-first caching.
