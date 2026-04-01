# Canopi

Agroecological design application for permaculture, syntropic agriculture, and food forest planning.

## What it does

Canopi is a desktop design tool that combines a 175,000-species plant database with an interactive canvas for designing agroecological systems. It helps designers choose plants based on ecological characteristics, arrange them spatially, and plan temporal succession.

### Key features

- **Plant database** -- 175K species with 173 columns of ecological, morphological, and agronomic data. Full-text search, structured filters, 11-language support
- **Design canvas** -- Konva.js-based workspace with zone drawing, plant placement via drag-and-drop, undo/redo, grid, rulers, scale bar, document-scoped plant colors, and density-aware single-line labels
- **File format** -- `.canopi` JSON files with full document integrity, autosave, and dirty tracking
- **Field notebook aesthetic** -- Parchment, ink, and ochre palette. Light and dark themes

## Tech stack

| Layer | Technology |
|-------|------------|
| Backend | Rust (Tauri v2 + rusqlite + specta) |
| Frontend | Preact + @preact/signals + TypeScript + Vite |
| Canvas | Konva.js (imperative API) |
| i18n | i18next (11 languages) |
| Styling | CSS Modules with design tokens |
| Maps | MapLibre GL JS (planned, Phase 4) |

## Development

```bash
# Prerequisites: Rust toolchain, Node.js 18+, system deps (Linux)
sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev patchelf

# Generate plant database (first time only)
python3 scripts/prepare-db.py

# Run the app
cargo tauri dev

# Frontend only (hot reload)
cd desktop/web && npm run dev

# Checks
cargo check --workspace
cd desktop/web && npx tsc --noEmit
cd desktop/web && npm test
```

See [`docs/development.md`](docs/development.md) for the desktop dev command, frontend hook behavior, and common local checks.
For documentation navigation, start at [`docs/README.md`](docs/README.md).

## Project structure

```
canopi/
├── desktop/          # Tauri v2 app
│   ├── src/          # Rust backend (IPC commands, DB, platform)
│   ├── web/          # Preact frontend
│   └── tauri.conf.json
├── common-types/     # Shared Rust <> TypeScript types
├── scripts/          # DB generation, schema contract
├── docs/             # Active docs, historical docs, archive
└── .interface-design/# Design system (system.md)
```

## Status

Beta `0.1.0` is published. See [docs/README.md](docs/README.md) for the current doc map and [docs/roadmap.md](docs/roadmap.md) for historical roadmap context.

## License

[MIT](LICENSE)
