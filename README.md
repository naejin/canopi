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

Canopi combines a Species Catalog with an interactive canvas for designing agroecological systems. The desktop app runs on Linux, macOS, and Windows. The Web Edition shares the canvas and `.canopi` format with a reduced catalog and browser-local drafts; desktop adds the full catalog, planning panels, Location editing, and native file management.

## Features

**Species Catalog** -- Ecological, morphological, and agronomic data with text search, structured filters, detail cards, favorites, and 11-language support. Web Edition offers a reduced set of filters and details.

**Design canvas** -- PixiJS-based workspace with Zones, Annotations, Plant placement, Object Groups, undo/redo, grid, rulers, and Measurement Guides. Design-scoped Plant colors and symbols, Pinned Plant Names, and zoom-aware text keep the canvas readable.

**Desktop planning panels** -- Timeline for scheduling work, Budget with per-species pricing and CSV export, and Consortium planning across Strata and Succession Phases with canvas hover sync.

**Desktop Location** -- MapLibre-powered Location editing, geocoding search, and a canvas basemap with terrain overlays.

**File format** -- `.canopi` JSON documents with autosave and dirty tracking. Desktop saves files; Web Edition keeps browser drafts and downloads portable `.canopi` files. [Canvas PDF](docs/canvas-pdf.md) exports an overview and optional scaled detail sheets with complete plant legends on desktop and Web.

**Field notebook aesthetic** -- Parchment, ink, and ochre palette. Light and dark themes.

## Tech stack

| Layer | Technology |
|-------|------------|
| Backend | Rust (Tauri v2 + rusqlite) |
| Frontend | Preact + @preact/signals + TypeScript + Vite |
| Canvas | PixiJS (primary) + Canvas2D (fallback) |
| i18n | i18next -- en, fr, es, pt, it, zh, de, ja, ko, nl, ru |
| Styling | CSS Modules with design tokens |
| Maps | MapLibre GL JS + maplibre-contour |

## Getting started

Install Rust through rustup, Node.js 22.x (at least 22.13), and Python 3. The repository pins the Rust toolchain in [rust-toolchain.toml](rust-toolchain.toml).

```bash
# Linux system dependencies
sudo apt-get install pkg-config libcairo2-dev libglib2.0-dev libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev patchelf

# From the repository root
npm ci --prefix desktop/web
cargo install tauri-cli --version '^2' --locked

# Prepare the plant database from a local, pinned canopi-data export
python3 scripts/prepare-db.py

# Run the app
cargo tauri dev
```

Database preparation requires the exact source export pinned by the repository; see the [database guide](docs/agent/database.md#canopi-data-export). Rebuild it when that contract or source pin changes. Platform dependencies and packaging are covered in the [build guide](docs/agent/build-release.md).

## Development

Run each command independently from the repository root.

```bash
# Frontend only (hot reload)
cd desktop/web && npm run dev

# Static Web Edition build (requires generated catalog assets for packaging)
cd desktop/web && npm run build:web

# TypeScript check
cd desktop/web && npx tsc --noEmit

# Regenerate shared transport bindings
cd desktop/web && npm run gen:types

# Verify generated transport bindings are up to date
cd desktop/web && npm run check:types

# Tests
cd desktop/web && npm test

# Rust workspace check (without bundled DB)
CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace
```

A pre-commit hook runs `tsc --noEmit` automatically via husky.

## Project structure

```
canopi/
├── desktop/            # Tauri v2 app
│   ├── src/            # Rust backend (IPC, DB, platform)
│   ├── web/            # Preact frontend
│   └── tauri.conf.json
├── common-types/       # Shared Rust <> TypeScript types
├── bindings-gen/       # Shared contract and adapter generation
├── lib-c/              # Linux native rendering
├── lib-swift/          # macOS platform stub
├── lib-cpp/            # Windows platform stub
├── scripts/            # DB generation, release tooling
├── docs/               # Architecture decisions, subsystem guides, releases
├── .interface-design/  # Design system documentation
└── AGENTS.md           # Agent operating contract
```

## Documentation

- [`AGENTS.md`](AGENTS.md) — agent operating contract, architecture rules, and coding standards
- [`CONTEXT.md`](CONTEXT.md) — domain vocabulary
- [`docs/adr/`](docs/adr/) — architectural decisions and their history
- [`docs/agent/`](docs/agent/) — current subsystem implementation guidance
- [`docs/release.md`](docs/release.md) — release operations
- [Web Edition integration](docs/agent/web-edition-website-integration.md) — static artifacts and website handoff
- [`.interface-design/system.md`](.interface-design/system.md) — design system (field notebook aesthetic, tokens, component patterns)

## License

[AGPL-3.0](LICENSE) -- Copyright 2026 Jean-Pierre Yin
