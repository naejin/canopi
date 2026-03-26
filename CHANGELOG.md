# Changelog

All notable changes to Canopi are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Plant detail card: 9 collapsible sections covering all 55 species fields (dimensions, life cycle, light, soil, ecology, uses, risk, notes, related species)
- Translated categorical values: 11 fields (growth rate, habit, stratum, bloom period, flower color, etc.) translated via `translated_values` table in 6 languages
- 329 new translation entries for habit, bloom period, flower color, active growth period
- Boolean soil tolerance chips replacing legacy `species_soil_types` display
- Dark mode contrast fixes for `--color-success` and `--color-danger`
- Plant photos roadmap entry (Phase 3.5.5, blocked on canopi-data `species_images` table)

### Fixed
- Common name lookup now uses `best_common_names` table first, fixing species showing canonical name instead of localized common name (e.g., "Malus domestica" instead of "Pommier")
- Retry button on detail card error state was a no-op (signal identity equality)
- Missing `aria-expanded` on collapsible section toggle buttons

### Changed
- Soil section displays boolean tolerance chips only (well-drained, heavy clay, acid, alkaline, saline, wind, pollution, poor soil) instead of untranslatable `species_soil_types` strings
- License changed from GPL-3.0 to MIT

## [0.1.0] - 2026-03-26

### Added
- Tauri v2 + Preact shell with custom frameless title bar
- 175K-species plant database with FTS5 full-text search
- Plant search panel with compact rows, virtual scrolling, 8 structured filters
- Plant detail card with dimensions, tolerances, uses, ecology, related species
- Konva.js canvas with Select, Hand, Rectangle, Text tools
- 7 named layers, plant drag-and-drop, zone drawing
- Undo/redo (500-cap command pattern), grid, rulers, scale bar
- Multi-select with Transformer
- `.canopi` save/load with document integrity, autosave, dirty tracking
- Dark/light theme toggle, 6-language i18n
- Field notebook design system
- Welcome screen, zoom controls, panel bar
- Data contract sync (Phase 3.0): schema-contract.json, prepare-db.py rewrite, boolean life cycle/nitrogen columns
- Dark mode canvas fix (Phase 3.5): theme-aware Konva node colors via `refreshCanvasTheme()`
