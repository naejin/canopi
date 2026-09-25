# Third-party notices

Code copied or adapted from other projects, with its source, the exact revision and its licence. Dependencies installed through Cargo or npm carry their own licence files and are not listed here.

## GeoLibre

- Source: https://github.com/opengeos/GeoLibre at commit `e9df9e2`
- Licence: MIT, Copyright (c) 2026 Qiusheng Wu

| Canopi file | GeoLibre source | Use |
|---|---|---|
| `desktop/web/src/maplibre/openfreemap-basemap.ts` (`OPENFREEMAP_BASEMAPS`) | `packages/core/src/types.ts` (`OPENFREEMAP_BASEMAPS`) | OpenFreeMap style presets |
| `desktop/web/src/app/geocoding/registry.ts` | `packages/core/src/geocoding.ts` (forward geocoding only) | Geocoding provider registry, Nominatim and Pelias providers, request pacing |

MIT License text:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Map data shown at runtime

- OpenFreeMap vector tiles and styles: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (shown on the map).
- EOX Sentinel-2 cloudless 2017 (`s2cloudless-2017_3857`): "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2017)", CC BY 4.0 (shown on the map).
- Place search: Nominatim, "Search by Nominatim · © OpenStreetMap contributors" (shown with results), ODbL.
