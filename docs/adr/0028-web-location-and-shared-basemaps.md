# Web Edition Location placement and shared basemap providers

Status: Accepted — supersedes the specific Web-v1 restrictions named below; the remaining constraints are unchanged.

This decision replaces two clauses of earlier Web Edition scope:

- [ADR 0013](0013-web-edition-map-scope.md) restricted the Web Canvas to **street basemaps only**. Web may now present the shared provider set, including satellite, with the provider's own attribution, tile size and zoom ceiling.
- [ADR 0016](0016-web-edition-omits-geocoding.md) withheld **visible Location editing** from Web v1. Web now exposes a browser-safe Location surface: coordinate entry, map placement, and Confirm/Move/Cancel through one undoable document edit.

It does **not** widen anything else. Address search, geocoding and every native capability remain Desktop-only; Web still imports no Tauri, geocoding or local-raster-processing code. The static-bundle, no-backend, no-PWA, no-offline-archive and no-bulk-download constraints from [ADR 0012](0012-web-edition-static-app-bundle.md), [ADR 0013](0013-web-edition-map-scope.md) and [ADR 0022](0022-web-edition-not-offline-first.md) continue to apply.

## Why the earlier restrictions no longer hold

ADR 0016 rejected Web Location editing for two reasons: geocoding needs a service the static deployment cannot host, and a coordinate-only surface would look like a partial version of the Desktop shape. Both are answerable now.

The placement transaction does not depend on geocoding. Coordinates and map picking produce the same candidate spatial frame, and the confirm/undo semantics already exist in the shared workbench. Desktop keeps its address search as an injected capability; Web composes the coordinate workbench directly and never reaches a search provider. The "partial shape" objection is met by a complete surface for what it does offer, with the missing capability absent rather than stubbed.

ADR 0013 restricted Web to street imagery to avoid unqualified public credentials and provider terms. The provider work establishes what that restriction actually required: one shared provider module, an explicit availability state per provider, a device-local key that is never persisted into a Design or exported, and attribution shown from the provider. A saved MapTiler choice without a build key is reported unavailable rather than normalized to another provider, and Google's official path is used only when the user has configured their own key.

## Decision

**Placement.** Web composes the shared coordinate workbench with a browser-safe Location surface. Coordinate entry rejects empty, non-finite and out-of-Mercator values; map click or current-centre placement produces the same candidate frame; Confirm commits exactly one undoable edit carrying the complete spatial frame, altitude and north bearing; Cancel, Escape and unmount abort it; camera movement alone never commits; a Design replacement fences late map events. Coordinate entry stays usable when the map cannot load. No automatic elevation lookup and no new altitude editor are included.

**Providers.** One shared provider module owns provider availability, source descriptors, attribution, session acquisition and request fencing for both editions. Settings keep a single device-local store; the Google key is optional, masked, trimmed on explicit save, never written to a Design, export, diagnostic bundle, log or error text, and its absence selects the keyless path rather than failing. Source replacement goes through the existing contribution reconciliation and never recreates the map.

**Explicitly unchanged.** No address search or geocoding in Web. No backend or tile proxy. No protected credentials in the bundle. No bundled tile pyramids, bulk download, offline imagery archive or service worker. No local raster rendering or processing in Web; dataset references are preserved and round-tripped without their assets. Interactive availability never authorizes print or offline use.

## Consequences

- Web acquires a real placement workflow, so the coordinate workbench must be shared rather than duplicated, and its validation must be the same code both editions run.
- Map lifecycle ownership does not change: the provider module owns sessions and attribution, and the existing workspace control keeps map mutation and teardown. Provider or key changes update contributions instead of rebuilding the map.
- Served imagery now depends on third-party providers in Web as it already did in Desktop. A provider outage omits only that background with an honest unavailable state; it never blocks canvas editing, and street imagery is never relabelled as satellite.
- The Web build boundary keeps banning Tauri, geocoding and local-raster imports. That guard is the mechanism enforcing the exclusions above and must not be weakened when the Location surface lands.

Current implementation status and the guides that describe it are in the [MapLibre guide](../agent/maplibre.md), the [edition guide](../agent/edition-development.md) and the [raster rework product contract](../design/raster-data-analysis-rework.md#web-location-and-basemaps).
