# Built-In Plant Symbols

Plant Symbols are a fixed built-in set stored as stable IDs in the Design file, not uploaded artwork or Species Catalog data. Symbol rendering should use renderer-native primitive recipes inside the existing placed-plant Visual Footprint, with `round` as the fallback and v3 file migration adding scene-owned species defaults plus optional placed-plant overrides.

**Consequences**:
The canvas keeps circular hit testing, selection rings, stacking, bounds, and zoom-to-fit behavior for placed plants. The implementation must update both Pixi and Canvas2D renderers without runtime SVG parsing, image textures, or a new icon dependency.
