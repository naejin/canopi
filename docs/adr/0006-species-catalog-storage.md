# Species catalog storage

Status: Accepted (2026-09-25, Canopi v2)

## Context

The species catalog is large (the Desktop plant DB is about 1.2 GB) and needs localized search, filters and detail. The Web Edition must serve a catalog from static files.

## Decision

- Storage engines sit behind the Species Catalog read projection. **Desktop** reads a bundled SQLite DB through Rust. **Web** reads generated Parquet shards through DuckDB-WASM.
- Both come from the same canopi-data export lineage. Shared UI consumes the Species Catalog workbench (`app/plant-browser/workbench.ts`) and caller-oriented reads.
- The Web catalog is deliberately reduced: climate zone, habit or growth form, life cycle, common names for the 11 UI languages, and one lazy-loaded hero image's metadata per species. Filter controls come from the generated supported-filter projection and omit unsupported choices. Adding a filter does not silently add detail sections or expand the exported data.
- Common names follow the selected app language; the canonical name is the language-neutral fallback. Locale assets load on demand.
- Hero images stay remote with source, credit and licence metadata. No image binaries, gallery prefetch, image proxy or native image cache.
- Parquet shards, metadata, workers and app assets fit the static packaging limits in the build and release guide. Expanded NDJSON is not a production path.
- Filterable fields are authored in `common-types/plant-filter-fields.json`; bindings and the Web admission module are generated from it.
- Site Adaptation (compatibility checks, replacement suggestions) is retired in both editions. Reintroducing it needs a new decision that names the catalog fields and query costs it requires.

## Consequences

- Full Desktop catalog and detail components and reduced Web components stay separate where their fields, paging and image delivery differ.
- Moving Desktop off SQLite requires evidence that localized search, filters, detail and latency stay sound while complexity drops.
