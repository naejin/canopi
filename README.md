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
  <img src="https://img.shields.io/badge/species-175%2C000%2B-A06B1F?style=flat-square" alt="Species" />
</p>

---

Canopi is a desktop design tool that combines a 175,000-species plant database with an interactive canvas for designing agroecological systems. It helps designers choose plants based on ecological characteristics, arrange them spatially, and plan temporal succession.

## Features

**Plant database** -- 175K species with 173 columns of ecological, morphological, and agronomic data. Full-text search, structured filters, detail cards, favorites, and 11-language support.

**Design canvas** -- PixiJS-based workspace with zone drawing, plant placement via drag-and-drop, undo/redo, grid, rulers, scale bar, document-scoped plant colors, and density-aware labels.

**Bottom panels** -- Timeline for scheduling work, budget tracker with per-species pricing and CSV export, and consortium succession chart with drag reorder and canvas hover sync.

**Location** -- MapLibre-powered map picker with geocoding search, drag, zoom, and confirmation flow.

**File format** -- `.canopi` JSON documents with autosave, dirty tracking, and full round-trip integrity.

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

```bash
# Prerequisites: Rust toolchain, Node.js 18+

# Linux system dependencies
sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev patchelf

# Generate the plant database (first time only)
python3 scripts/prepare-db.py

# Run the app
cargo tauri dev
```

## Development

```bash
# Frontend only (hot reload)
cd desktop/web && npm run dev

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
├── scripts/            # DB generation, release tooling
├── docs/               # Documentation
└── .interface-design/  # Design system
```

## Documentation

See [`docs/README.md`](docs/README.md) for the full doc map. Key entry points:

- [Active work tracker](docs/todo.md)
- [Product definition](docs/product-definition.md)
- [Docs and agent guide](docs/agents.md)
- [Release operations](docs/release-operations.md)

## License

[AGPL-3.0](LICENSE) -- Copyright 2026 Jean-Pierre Yin
