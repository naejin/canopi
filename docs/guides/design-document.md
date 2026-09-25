# Design document

This guide covers the `.canopi` v7 Design file, its session lifecycle (new, open, save, replacement, dirty state), Design Edit, and settings. The authority table and geolocation model are in [architecture](../architecture.md). The decisions behind them are [ADR 0001](../adr/0001-geolocated-map-canvas.md) (geolocation), [ADR 0003](../adr/0003-no-backward-compatibility.md) (no compatibility) and [ADR 0005](../adr/0005-web-edition-scope.md) (Web persistence).

## Authorities

- **Scene runtime** (`SceneStore` via `SceneCanvasRuntime`) owns plants, zones, annotations, measurement guides, ruler guides, groups, locks, species colours, symbols and codes, and Design layers. It changes only through runtime transactions. Panels read it through read-only runtime queries such as `CanvasQuerySurface`, never through mirrored signals.
- **Design Edit** (`app/design-edit/`) owns `name`, `description`, `budget`, `budget_currency`, `timeline`, `consortiums`, `lidar` presentation, `created_at` and unknown top-level `extra` fields.
- **Settings** own device preferences (see [Settings](#settings)). They are never Design data.
- Undo covers Scene edits only. Design Edit commands, map layers and settings are not undoable.
- Non-canvas state never goes into `SceneStore`. Canvas state is not copied into standalone signals when a computed value or runtime query will do.
- Cross-domain sync goes in a workflow module (`app/document-session/workflows.ts`, `app/consortium/workflow.ts`), not in a component effect or an import between actions.

## File format v7

- `CURRENT_CANOPI_FILE_VERSION = 7` (`common-types/src/design.rs`) is the only version authority for native and Web code. Missing, older and future versions fail with `unsupported_version` before the active Design is replaced. There is no converter.
- Every persisted position is `GeoPoint { lon, lat }` in WGS84 degrees: plant positions, zone points, annotation anchors, measurement guide endpoints. Ruler guides persist in `extra.guides` as a latitude (horizontal) or longitude (vertical). Zone rotation is degrees clockwise from true north. Rectangles and ellipses keep their kind and store an explicit orientation.
- The file has no anchor, bearing, placement status or altitude. `OBSOLETE_CANOPI_ROOT_KEYS` (`location`, `north_bearing_deg`, `spatial_frame`) are rejected on admission.
- `DESIGN_FILE_FIELDS` in `common-types/src/design.rs` lists every top-level field with its owner (`Scene` or `Document`). It generates `KNOWN_CANOPI_KEYS` and `DOCUMENT_FILE_FIELD_OWNERS`. Save composition (`composeDocumentForSave()` in `app/contracts/document.ts`) reads that metadata. Never hand-maintain a parallel owner list.
- Scene-owned presentation fields: `plant_species_colors`, `plant_species_symbols` (per-species default symbol ids; an explicit `round` is stored, and clearing deletes the key) and `plant_species_codes` (Species Code reservations, filled in before the clean baseline, kept through deletion, assigned in the same undoable edit as new plants). Unknown symbol ids render as `round`. See [ADR 0007](../adr/0007-design-objects-and-personal-libraries.md).
- Per-object non-visual fields (plant notes, planted date, quantity, zone notes) and `locked` round-trip. New saves write explicit `locked` values.
- The `lidar` section (`common-types/src/lidar.rs`) stores ordered presentation entries `{ kind, id, visible, opacity, order, style }` that reference Data Library identities. It never stores raster bytes or paths. Entries that point at deleted library items persist as unavailable until the user deletes them explicitly. Web round-trips the section without rendering it. See [data library](data-library.md).

### Session plane and write-back

- `canvas/session-plane.ts` builds a local Mercator tangent plane (x east, y south, metres) at the centre of the objects' bounds. For an empty Design it uses the view centre. Tools, snapping, measurements, hit testing and PDF layout use this plane.
- `canvas/runtime/scene-runtime/reorigin.ts` rebuilds the plane at the view centre when the view moves more than 10 km from the origin. It waits for an active Scene edit to settle and re-projects every object from its stored lon/lat. Copied selections keep their geographic position across a re-origin.
- `canvas/runtime/scene/geo-frame.ts` (`SceneGeoLedger`) remembers the loaded lon/lat of each position, keyed by the plane coordinates it hydrated to. On save, an unchanged position writes its original lon/lat verbatim. A changed one writes lon/lat rounded to 1e-9 degree. Open then save without edits is byte-identical.
- Camera moves (pan, zoom, fit, place search) never move objects. Cut and paste is the relocation edit.

### Admission and serialization

- Native trust boundary: `desktop/src/design/format.rs`. It admits exactly v7, rejects obsolete root keys, deserializes `CanopiFile` and validates every position with `validate_design_geometry`. Plain Serde deserialization must not hide admission behaviour.
- Web trust boundary: `app/contracts/design-ingestion.ts` (`decodeCanopiDesign()`). It performs exact-version admission, obsolete-root rejection, generated-schema validation (including lon/lat ranges) and unknown-root normalization. Browser file, template and Draft adapters never cast raw JSON to `CanopiFile`.
- `desktop/web/src/generated/canopi-design-format.ts` holds the Web schema, the version and the stable ingestion error kinds, generated from `common-types/src/design.rs`. Generation fails if schema fields diverge from `DESIGN_FILE_FIELDS`.
- `common-types/canopi-design-conformance.json` is the shared admission corpus. Accepted cases name one normalized document; rejected cases name one stable error kind. The native and Web runners both execute every case and round-trip every accepted document. The Web runner goes through the wire encoder between decodes.
- `app/contracts/canopi-design-wire.ts` is the only Web serializer. In memory, unknown root fields live under `CanopiFile.extra`. The encoder moves them back to the wire root, and known fields always win (`extra` is spread first). Native save, autosave, stamp export, browser download and Problem Report attachments all encode through it.
- `common-types/canopi-new-design-defaults.json` defines the standard Layer catalog of a new Design. Desktop and Web inject their own name and timestamp and clone the generated Layer records.

### Adding a document field

1. Add it to `CanopiFile` and `DESIGN_FILE_FIELDS` with its owner. A required array gets `#[serde(default)]` in Rust, a required TS field and an empty placeholder in the scene codec.
2. Run `cd desktop/web && npm run gen:types && npm run check:types` and commit the generated files.
3. Carry it through `normalizeLoadedDocument`/`composeDocumentForSave` (Document owner) or the scene codec and Scene command patches (Scene owner).
4. Update the conformance corpus and fixtures. A format change bumps the version and refuses the previous one. Never convert old data inside `Deserialize`.

## GeoJSON import and export

- GeoJSON is a derived exchange format. It never replaces `.canopi`. `app/geojson/codec.ts` is the pure RFC 7946 codec (no DOM, IPC or runtime imports). `app/geojson/workflow.ts` orchestrates both editions through a `GeoJsonFileAdapter`. Desktop supplies `ipc/geojson.ts` (native dialogs, `read_geojson_file` with a 64 MiB limit, `export_file`). Web supplies `web/browser-geojson.ts`. The commands are `file.importGeoJson` and `file.exportGeoJson`.
- Export reads canonical lon/lat through `CanvasQuerySurface.getSettledDesignObjects()`, never plane metres. It writes a WGS84 FeatureCollection without `crs`. Each feature carries `canopi_kind` (`plant`, `zone`, `annotation`, `measurement_guide`), domain properties and `group_ids`, and the collection carries `canopi_groups`. Rectangle and ellipse zones export their outline plus their stored frame in `canopi_points`. Export never changes dirty state or history.
- Import decodes the whole file before mutating anything. Malformed input is rejected with `GeoJsonImportError` (`invalid_json`, `unsupported_root`, `too_many_features`, `invalid_feature`, `invalid_geometry`, `invalid_coordinates`). Point features with `species` or `canonical_name` become plants, other Points annotations, Polygons zones (outer ring), a two-position LineString a measurement guide and a longer LineString a line zone. Multi* geometries, collections and null geometry are skipped and counted.
- `CanvasSceneEditCommandSurface.importDesignObjects()` hydrates the result into the session plane as one undoable placement. It reallocates identities, clears locks and selects the new objects.

## Saved Object Stamp files

Stamps are a personal library, not Designs ([ADR 0007](../adr/0007-design-objects-and-personal-libraries.md)). Desktop exports one stamp as a valid v7 `.canopi` file that holds only its visible objects and captured groups, arranged around 0°/0°, with safe defaults for the other required fields. It never carries Budget, Timeline, Consortiums, description or non-visual metadata. Import reads any v7 file through a plane centred on its objects and only adds a library entry. It never opens a Design, dirties the current one or records a Recent Design. Web has no stamp import or export.

## Design Session lifecycle

### Modules

| Module (`app/document-session/`) | Owns |
| --- | --- |
| `actions.ts`, `transition.ts` | Intent-shaped operations: `openDesignSessionFromDialog()`, `openDesignSessionFromPath()`, `openTemplateDesignSession()`, `createNewDesignSession()`, `saveCurrentDesign()`, `saveAsCurrentDesign()`, `autosaveDesignSession()`, `startAttachedDesignSession()`, `teardownAttachedDesignSession()` |
| `state-machine.ts` | Desktop session states: attached/detached readiness, dirty checks, queued loads, autosave execution, teardown |
| `replacement.ts` | Platform-neutral `attach()`/`replace()` handoff shared by both editions; imports neither Tauri nor browser code |
| `store.ts` | All session signals and generations; read-only projections of identity, dirty state, pending loads, `autosaveFailed` |
| `persistence.ts`, `write-admission.ts` | Purpose-aware save, download, draft, recovery, handoff and diagnostic capture |
| `lifecycle.ts`, `use-canvas-document-session.ts` | Desktop canvas host sequence and the `CanvasPanel` DOM-ref adapter |
| `workflow-runner.ts`, `workflows.ts` | Idempotent workflow install/dispose with retained failed disposers |

Web counterparts: `web/browser-design-session.ts` (file, Draft and New acquisition) and `web/WebCanvasWorkspace.tsx` (host sequence). `canvas/runtime/lifecycle-owner.ts` retains runtime release authority across unmounts. A failed loss-prevention handoff is retried before the next mount.

### Replacement rules

- No component or panel replaces the active Design directly. Destructive flows use the shared guard path: dirty check, confirm, replace. Notebook rows, Recent Designs and templates call the intent-shaped actions. Production code never builds raw `transitionDocument()` requests.
- Only `attach()` and `replace()` load the runtime document. Never infer a canvas replacement from a `currentDesign` or non-canvas snapshot change.
- A transition captures an exact replacement guard before its dirty decision (non-canvas revision, Scene checkpoint, canvas attachment, preview generation). Any change to these cancels the request before save or discard can touch newer state. Generated `updated_at` is excluded.
- Retrying a failed replacement resumes the same opaque operation. It never replaces Scene or Design twice and never transfers authorization to another target.
- Teardown handoff is loss prevention: it runs synchronously before any other cleanup. If it fails, the runtime and lease stay alive and the failure is reported.
- The workspace document surface (`app/canvas-map-surface/workspace-document-surface.ts`) disconnects the map generation before it delegates a replacement.

### Saving and persistence

- All saves go through `persistence.ts`: manual save, Save As, browser download, browser Draft, recovery autosave, teardown handoff and Problem Report attachment. Nothing calls a raw `serialize` followed by `markSaved`. Only a successful manual save, download or Draft acknowledges its exact captured baseline. Recovery, handoff and attachment captures never do.
- Captures read committed content only. Scene live previews and Design Edit previews are excluded.
- Writes are admitted FIFO per durable resource: a native Design target family, the whole native autosave store, `browser-app-data:drafts`, or a fresh identity per browser download. Completions become inert after replacement or reattachment. Overlapping manual saves follow issue order.
- Save As changes only the path. It never renames the Design.
- Desktop writes use `atomic_replace()` with operation-owned sidecars and a target-owned `.canopi.prev` backup (`desktop/src/design/`). Save, load, autosave and stamp file commands run in the executor's `Local` class. Recent Designs and the Design Notebook use `UserData` (`desktop/src/services/design_files.rs`, `design_notebook.rs`). Listing prunes paths that are definitely stale and hides ambiguous ones. See [native and release](native-and-release.md#native-operation-executor).
- Web writes browser Drafts (internal autosave and recovery, not a visible list). A `.canopi` download is the durable save. On start with no active Design, `WebApp` restores the newest valid Draft. Each Draft body is decoded on its own, so one corrupt Draft does not discard the others.

### Dirty state and autosave

- Canvas dirty state compares exact `SceneHistory` state identities, not history depth. Non-canvas dirty state compares `nonCanvasRevision` with `nonCanvasSavedRevision`. Edits made during I/O stay dirty. `persistenceDiverged` keeps the Design dirty when a write captured an older snapshot.
- Never write `designDirty` directly. Canvas clean-state updates enter through `app/canvas-runtime/app-adapter.ts`.
- Desktop autosave runs on the `auto_save_interval_s` timer in `lifecycle.ts`. It writes recovery snapshots and never advances the saved baseline. Browser autosave observes `committedDesignRevision` and writes the Draft in a microtask. Failures surface through `autosaveFailed` and keep the Design dirty.

## Design Edit

- Production code writes non-canvas fields only through `app/design-edit/` (`budget.ts`, `timeline.ts`, `consortium.ts`, `lidar.ts`, `core.ts`), never through `store.ts` or raw signals. It reads identity and dirty state through the read-only store projections.
- A command computes its updater and visible replay first, then installs committed state, then publishes signals. A thrown computation publishes nothing. No-op updates do not dirty the Design (compare fields before spreading).
- Previewable edits use one Design Edit transaction at a time. The UI reads the visible projection, preview updates never persist or advance the revision, and a commit advances at most one revision. A replacement or HMR lifetime rollover aborts the preview, and later calls on its handle are inert.
- `reconcileCurrentDesign()` performs scene-derived maintenance without recording user intent.

## Settings

- The shared `Settings` contract lives in `common-types/src/settings.rs`: `locale` (11 languages), `theme` (`light` or `dark`), snapping, `auto_save_interval_s`, panel sizes, `plant_spacing_interval_m`, map layers (`basemap_style`, visibility and opacity for basemap, satellite, contours and hillshade, `contour_interval`), `google_maps_api_key` (a device-local credential), and `last_view { lon, lat, zoom }`. Unknown keys are ignored and never re-emitted, and no value is rewritten.
- Desktop stores settings in the user DB through Rust. Web stores them in an independent browser-local record (`web/browser-app-data.ts`). Rust `Settings::default()` and the enum catalogs generate `desktop/web/src/generated/settings.ts`. Regenerate the bindings rather than hand-editing default tables.
- `app/settings/projection.ts` owns adapter installation, hydration, mutation, coalesced and serialized persistence, retry and flush. It imports neither Tauri nor browser storage. `platform/desktop.ts` and `platform/browser.ts` install the adapter at the compile-time root. Browser hydration is synchronous so locale and theme apply before first render.
- Use `mutateSettingsProjection()` for settings-backed actions. Use queued persistence on 60 fps paths and commit at gesture end. Await `flushSettingsProjection()` when durability gates a transition. The Desktop close guard waits for it and keeps the window open on failure.
- `last_view` is written 750 ms after the camera settles (`app/canvas-map-surface/last-view.ts`) and read through `CanvasRuntimeSettingsAdapter.readLastView()`. A new or empty Design opens there, or at lon 13, lat 23, zoom 4 when there is none. Invalid values normalize to `null`.
- The `canopi-theme` localStorage key is a best-effort first-paint cache applied by an inline script in both HTML entries.
- Calendar, Budget and Consortium view preferences are session-scoped planning view state (`app/planning-view/state.ts`), not settings.

## Verification

Format or lifecycle changes: focused tests (`file-format-round-trip`, `canopi-design-conformance`, `canopi-design-decoder`, `web-design-session`, `use-canvas-document-session`, `web-canvas-workspace`, `reorigin`), then `npx tsc --noEmit`, `npm test`, both edition builds and the Rust workspace tests. Contract changes also need `npm run gen:types && npm run check:types`.
