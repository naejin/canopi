<p align="center">
  <img src="desktop/web/src/assets/canopi-logo.svg" width="80" height="80" alt="Canopi logo" />
</p>

<h1 align="center">Canopi</h1>

<p align="center">
  <strong>Agroecological design for permaculture, syntropic agriculture, and food forests</strong>
</p>

<p align="center">
  <a href="https://github.com/naejin/canopi/releases/latest"><img src="https://img.shields.io/github/v/release/naejin/canopi?style=flat-square&color=A06B1F&label=release" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-A06B1F?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/platform-Linux%20%C2%B7%20macOS%20%C2%B7%20Windows-A06B1F?style=flat-square" alt="Platforms" />
  <img src="https://img.shields.io/badge/languages-11-A06B1F?style=flat-square" alt="Languages" />
</p>

---

Canopi combines a Species Catalog with a design canvas that is the map itself: every Design is geolocated and drawn over a basemap, satellite imagery, LiDAR and terrain. The desktop app runs on Linux, macOS and Windows. The Web Edition shares the canvas, planning panels and `.canopi` format with a reduced catalog and browser-local drafts; desktop adds the full catalog, the LiDAR Data Library, the Design Notebook and native file management.

## Features

- **Species Catalog**: ecological, morphological and agronomic data with search, filters, detail cards and favourites in 11 languages.
- **Map canvas**: Zones, Annotations, Plants, Object Groups, Measurement Guides, undo/redo, rulers and grid on a MapLibre map with OpenFreeMap basemaps, satellite imagery, contours, hillshade and place search.
- **Planning**: Timeline, Budget (per-species pricing, CSV export) and Consortium planning across Strata and Succession Phases.
- **Files**: `.canopi` Designs (WGS84 positions), GeoJSON import/export and Canvas PDF field sheets.
- **Field-notebook look**: parchment, ink and ochre; light and dark themes.

## Tech stack

Rust (Tauri v2, rusqlite) · Preact, @preact/signals, TypeScript, Vite · MapLibre GL JS with a PixiJS custom layer · i18next · CSS Modules with design tokens.

## Getting started

Install Rust through rustup (pinned in [rust-toolchain.toml](rust-toolchain.toml)), Node.js 22.13+ and Python 3.

```bash
# Linux system dependencies
sudo apt-get install pkg-config libcairo2-dev libglib2.0-dev libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev patchelf

npm ci --prefix desktop/web
cargo install tauri-cli --version '^2' --locked
python3 scripts/prepare-db.py   # plant DB from the pinned canopi-data export
cargo tauri dev
```

Database preparation needs the exact pinned source export; see the [species catalog guide](docs/guides/species-catalog.md). Web Edition, UI gallery, ports and fixtures are in the [editions guide](docs/guides/editions.md); build, check and release commands are in the [native and release guide](docs/guides/native-and-release.md).

```bash
cd desktop/web && npm run dev:web   # Web Edition, http://localhost:1421/app/
cd desktop/web && npm run dev:ui    # memory-only UI gallery, http://127.0.0.1:1422/
cd desktop/web && npx tsc --noEmit && npm test
```

## Project structure

```
desktop/src/        Rust backend (IPC, services, DB)
desktop/web/        Preact frontend
common-types/       authored cross-language contracts
bindings-gen/       TypeScript transport codegen
scripts/            DB preparation, docs check, release tooling
docs/               architecture, ADRs, guides, release notes
.interface-design/  design system
```

## Documentation

Start at the [documentation map](docs/README.md). Agents follow [AGENTS.md](AGENTS.md); domain vocabulary is in [CONTEXT.md](CONTEXT.md); the architecture is in [docs/architecture.md](docs/architecture.md).

## License

[AGPL-3.0](LICENSE) -- Copyright 2026 Jean-Pierre Yin
