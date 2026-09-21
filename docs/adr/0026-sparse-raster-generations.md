# Sparse numeric generations preserve member history

Status: proposed — settled direction for the user-forwarded bounded-generation assignment; not implemented.
Current guidance: [bounded-generation design](../design/raster-rework/bounded-generation-design.md), [LiDAR guide](../agent/lidar.md).

Canopi's immutable ordered member occurrences remain the authority for source composition and targeted undo. New generations materialize resolved **occupied** 1024×1024 blocks with explicit Float32 values and byte validity, indexed in the existing catalogue and shared by immutable asset identity. Legacy generations remain readable through bounded adapters; no authoritative full-union mosaic or union-sized sparse file is created.

This trades a versioned block/index format and more small files for bounded work across distant extents, exact mask/precedence semantics and reuse of unchanged blocks. We reuse the existing raw encodings and GeoLibre-selected native decoder rather than implementing a TIFF codec. A single COG/VRT spanning all coverage was rejected because it does not by itself bound empty-extent work, metadata enumeration, undo or downstream display/slope. Member history alone was rejected as the only read representation because read cost would grow with all prior occurrences.

Numeric publication is independent of reproducible display caches. Existing review/Apply and map UI stay usable through the new resolver and a generation-scoped tile transport. The implementation specification fixes migration, ownership, resource admission, and the evidence required before capacity limits can be removed; this ADR does not authorize a release or promise unmeasured capacity.
