# Third-party notices

Canopi is licensed under the GNU AGPL-3.0 (see `LICENSE`). The Desktop raster
display and slope analysis ship the following third-party components, each
under its own license. Versions are the exact ones this build pins.

| Component | Version | Source | License |
| --- | --- | --- | --- |
| maplibre-gl-raster | 0.14.15 | https://github.com/opengeos/maplibre-gl-raster | MIT |
| cog-tiler-wasm | 0.4.0 | https://github.com/opengeos/cog-tiler-wasm | MIT |
| whitebox-wasm | 0.6.0 | https://github.com/opengeos/whitebox-wasm | MIT OR Apache-2.0 |
| @deck.gl/core | 9.4.0 | https://github.com/visgl/deck.gl | MIT |
| @luma.gl/core | 9.4.1 | https://github.com/visgl/luma.gl | MIT |
| geotiff | 3.0.5 | https://github.com/geotiffjs/geotiff.js | MIT |
| proj4 | 2.22.0 | https://github.com/proj4js/proj4js | MIT |
| geotiff-geokeys-to-proj4 | 2026.08.16 | https://github.com/matafokka/geotiff-geokeys-to-proj4 | BSD-3-Clause |
| maplibre-gl | 6.10.0 | https://github.com/maplibre/maplibre-gl-js | BSD-3-Clause |
| geolibre-cli (geolibre-rust) | 1.5.3 at aac2b743978666f3c3119b5c93de1b30963b1493 | https://github.com/opengeos/geolibre-rust | MIT |

The GeoLibre CLI statically links the Whitebox tool registry it is built with
(`wbtools_oss` from `opengeos/whitebox-wasm`, MIT OR Apache-2.0). No upstream
file is modified by Canopi; the raster adapter uses the packages' public APIs.

The full license texts ship inside each package (`node_modules/<name>/LICENSE`
at build time) and in the pinned `geolibre-rust` source.
