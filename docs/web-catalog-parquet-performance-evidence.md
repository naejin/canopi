# Web Catalog Parquet Migration Evidence

Date: 2026-07-08

## Dataset

- Export: `canopi-export-2026-07-08.db`
- Export schema: 14
- Species rows: 175,473
- Local package target: Cloudflare Pages static artifact under `/app/`

## Production Path

The Web Edition production reader now requires `asset_format: "parquet"` and rejects legacy NDJSON manifests before DuckDB-WASM is instantiated. The package gate also rejects non-Parquet catalog manifests, missing supported-filter metadata, missing catalog assets, byte/checksum mismatches, oversized assets, excessive file counts, and raw `duckdb-*.wasm` files.

Remaining NDJSON usage is limited to fixture/test helpers and historical comparison artifacts generated from `main` into `/tmp`.

## Local Evidence

The local environment does not have a native DuckDB engine installed, and DuckDB-WASM Parquet execution cannot be measured here without fetching DuckDB extension/runtime assets. The timing table below is a proxy file-reader benchmark:

- Before: generated `main` JSONL catalog at `/tmp/canopi-baseline-ndjson-catalog`, matching the old eager-load production path that loaded all Species, all locale names, and image metadata into JS memory before in-memory scans.
- After: current Parquet catalog at `desktop/web/public/canopi-catalog`, read with the repository's minimal test Parquet reader. These after timings are not DuckDB timings; they only show static artifact scope and asset-size change.

| Measure | Old NDJSON eager path | Current Parquet artifact |
| --- | ---: | ---: |
| Catalog files | 48 | 48 |
| Total catalog bytes | 129,841,439 | 78,594,677 |
| Largest catalog asset | `names/names-en.jsonl` 21,687,128 bytes | `names/names-en.parquet` 12,253,165 bytes |
| Initial eager load / browse proxy | 3,922.8 ms eager load + 0.004 ms browse | 2,583.8 ms proxy species read |
| Two-character `en` search proxy (`ap`) | 955.2 ms scan after eager load | 3,404.3 ms proxy species + active-locale read |
| Backed filter proxy (`Temperate`) | 47.6 ms scan after eager load | 2,013.1 ms proxy species read |
| Locale switch proxy (`fr`) | 0.05 ms after all locales loaded | 2,484.2 ms proxy active-locale read |

Interpretation:

- The static artifact is materially smaller, and the largest catalog asset is comfortably below the 25 MiB Cloudflare Pages per-asset limit.
- The old path paid a multi-second upfront eager-load cost and then scanned in memory.
- The current production path is designed for DuckDB projection/filter pushdown and lazy active-locale/image registration, so the Python test-reader timings should not be treated as user-visible query latency.
- Browser-level DuckDB-WASM timings for `/app/` browse, two-character search, backed filter use, and locale switch should be recorded during `canopi-bgcv` website artifact smoke, where the built artifact can run in a browser with the same static routing behavior users receive.
