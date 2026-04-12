# Database Docs

Database-specific guidance lives here. For schema contract and query patterns, see `desktop/src/db/CLAUDE.md`.

Search boundary note:
- `total_estimate` and first-page rows are separate outputs from the species search pipeline. If the UI ever shows a new count with stale old rows during debounced search, fix the frontend result-set lifecycle instead of weakening the DB count/query contract.

## Reference

- [Archived: Plant DB Filter Audit](../archive/reviews/plant-db-filter-audit.md)
