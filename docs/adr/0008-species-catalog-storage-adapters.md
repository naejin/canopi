# Species Catalog Storage Adapters

Canopi will treat the Species Catalog storage engine as an adapter behind the Species Catalog Read Projection interface instead of making one storage engine the product-wide architecture. The desktop app keeps the current Rust and SQLite Species Catalog implementation while a lightweight website catalog may use a browser-native adapter such as DuckDB-WASM with Parquet assets; shared UI and workflows should depend on caller-oriented Species Catalog read behavior rather than SQLite, DuckDB, or Tauri-specific details.

**Consequences**:
Website catalog work can prototype DuckDB-WASM or simpler static assets without forcing a risky desktop migration. Desktop migration away from SQLite requires measured evidence that the alternative preserves localized Common Name search, filters, detail hydration, and latency while deleting meaningful complexity rather than adding a second engine beside the existing user database.
