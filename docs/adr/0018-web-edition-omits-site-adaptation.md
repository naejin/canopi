# Web Edition omits Site Adaptation in v1

Status: Accepted

The Web Edition v1 does not include Site Adaptation, compatibility checks, or replacement suggestions. Static Design Templates import as Designs without a web-specific adaptation review step.

Site Adaptation currently depends on Species hardiness data for compatibility checks and Species hardiness, height, and stratum metadata for replacement suggestions. Web Edition v1 intentionally removes those fields from the reduced Species Catalog to keep the static DuckDB-WASM dataset smaller and simpler.

Site Adaptation can be reconsidered later only if the Web Edition expands the reduced catalog to include the required compatibility and replacement fields, and if the added data size and query behavior still fit the static Cloudflare Pages deployment model.
