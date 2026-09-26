# Third-party notices

Code copied or adapted from other projects, with its source, the exact revision and its licence. Dependencies installed through Cargo or npm carry their own licence files and are not listed here, except fonts that ship inside the app.

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
- Google satellite imagery: "© Google" (shown on the map). Without a key the public `mt1.google.com` tiles are used; with the user's key, the Google Map Tiles API and its viewport copyright.
- Place search: Nominatim, "Search by Nominatim · © OpenStreetMap contributors" (shown with results), ODbL.

## Bundled interface fonts

Desktop must work offline, so the interface fonts ship inside both editions (latin, latin-ext and cyrillic subsets, WOFF2) from the `@fontsource` npm packages, imported by `desktop/web/src/styles/fonts.css`. Each is licensed under the SIL Open Font License 1.1 (https://openfontlicense.org); the full licence text is in each package's `LICENSE` file.

| Font | Package | Copyright |
|---|---|---|
| Literata (400, 600) | `@fontsource/literata` 5.3.0 | Copyright 2017 The Literata Project Authors (https://github.com/googlefonts/literata) |
| Source Sans 3 (400, 600, 400 italic) | `@fontsource/source-sans-3` 5.3.0 | Copyright 2010-2020 Adobe (http://www.adobe.com/) |
| IBM Plex Mono (400, 600) | `@fontsource/ibm-plex-mono` 5.3.0 | Copyright 2017 IBM Corp. |
