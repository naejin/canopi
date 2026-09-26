# Design document

This guide covers the `.canopi` v7 Design file, its session lifecycle (new, open, continuous save, replacement, Design Drafts), Design Edit, and settings. The authority table and geolocation model are in [architecture](../architecture.md). The decisions behind them are [ADR 0001](../adr/0001-geolocated-map-canvas.md) (geolocation), [ADR 0003](../adr/0003-no-backward-compatibility.md) (no compatibility) and [ADR 0005](../adr/0005-web-edition-scope.md) (Web persistence).

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
- The `lidar` section (`common-types/src/lidar.rs`) stores ordered presentation entries `{ kind, id, visible, opacity, order, style }` that reference Data Library identities: a `Source` entry names a source item, an `Analysis` entry a derived item (renamed `Derived` with the next file version bump, ADR 0011). It never stores raster bytes or paths. Entries that point at deleted library items persist as unavailable until the user deletes them explicitly. Web round-trips the section without rendering it. See [data library](data-library.md).

### Session plane and write-back

- `canvas/session-plane.ts` builds a local Mercator tangent plane (x east, y south, metres) at the centre of the objects' bounds. For an empty Design it uses the view centre. Tools, snapping, measurements, hit testing and PDF layout use this plane.
- `canvas/runtime/scene-runtime/reorigin.ts` rebuilds the plane at the view centre when the view moves more than 10 km from the origin. It waits for an active Scene edit to settle and re-projects every object from its stored lon/lat. Copied selections keep their geographic position across a re-origin.
- `canvas/runtime/scene/geo-frame.ts` (`SceneGeoLedger`) remembers the loaded lon/lat of each position, keyed by the plane coordinates it hydrated to. On save, an unchanged position writes its original lon/lat verbatim. A changed one writes lon/lat rounded to 1e-9 degree. Open then save without edits is byte-identical.
- Camera moves (pan, zoom, fit, place search) never move objects. Cut and paste is the relocation edit.

### Admission and serialization

- Native trust boundary: `desktop/src/design/format.rs`. It refuses files over 64 MiB (`MAX_CANOPI_FILE_BYTES`, the GeoJSON import limit) with `DesignLoadError::TooLarge` before parsing, admits exactly v7, rejects obsolete root keys and a root `extra` key, deserializes `CanopiFile` and validates every position with `validate_design_geometry`. Plain Serde deserialization must not hide admission behaviour.
- Web trust boundary: `app/contracts/design-ingestion.ts` (`decodeCanopiDesign()`). It performs exact-version admission, obsolete-root rejection, generated-schema validation (including lon/lat ranges) and unknown-root normalization. Browser file, template and Draft adapters never cast raw JSON to `CanopiFile`.
- `desktop/web/src/generated/canopi-design-format.ts` holds the Web schema, the version and the stable ingestion error kinds, generated from `common-types/src/design.rs`. Generation fails if schema fields diverge from `DESIGN_FILE_FIELDS`.
- `common-types/canopi-design-conformance.json` is the shared admission corpus. Accepted cases name one normalized document; rejected cases name one stable error kind. The native and Web runners both execute every case and round-trip every accepted document. The Web runner goes through the wire encoder between decodes.
- `app/contracts/canopi-design-wire.ts` is the only Web serializer. In memory, unknown root fields live under `CanopiFile.extra`. The encoder moves them back to the wire root, and known fields always win (`extra` is spread first). `extra` is never a wire key: a document with a root `extra` is refused as `invalid_document`, not flattened. Native saves, Design Drafts (native and browser), stamp export, browser download and Problem Report attachments all encode through it.
- `common-types/canopi-new-design-defaults.json` defines the standard Layer catalog of a new Design. Desktop and Web inject their own name and timestamp and clone the generated Layer records.

### Adding a document field

1. Add it to `CanopiFile` and `DESIGN_FILE_FIELDS` with its owner. A required array gets `#[serde(default)]` in Rust, a required TS field and an empty placeholder in the scene codec.
2. Run `cd desktop/web && npm run gen:types && npm run check:types` and commit the generated files.
3. Carry it through `normalizeLoadedDocument`/`composeDocumentForSave` (Document owner) or the scene codec and Scene command patches (Scene owner).
4. Update the conformance corpus and fixtures. A format change bumps the version and refuses the previous one. Never convert old data inside `Deserialize`.

## GeoJSON import and export

- GeoJSON is a derived exchange format. It never replaces `.canopi`. `app/geojson/codec.ts` is the pure RFC 7946 codec (no DOM, IPC or runtime imports). `app/geojson/workflow.ts` orchestrates both editions through a `GeoJsonFileAdapter`. Desktop supplies `platform/geojson.desktop.ts`, which composes the file transport in `ipc/geojson.ts` (native dialogs, `read_geojson_file` with a 64 MiB limit, `export_file`) with native notice dialogs; `ipc/` presents nothing. Web supplies `web/browser-geojson.ts`. The commands are `file.importGeoJson` and `file.exportGeoJson`.
- Export reads canonical lon/lat through `CanvasQuerySurface.getSettledDesignObjects()`, never plane metres. It writes a WGS84 FeatureCollection without `crs`. Each feature carries `canopi_kind` (`plant`, `zone`, `annotation`, `measurement_guide`), domain properties and `group_ids`, and the collection carries `canopi_groups`. Rectangle and ellipse zones export their outline plus their stored frame in `canopi_points`. Export never changes dirty state or history.
- Import decodes the whole file before mutating anything. Malformed input is rejected with `GeoJsonImportError` (`invalid_json`, `unsupported_root`, `too_many_features`, `invalid_feature`, `invalid_geometry`, `invalid_coordinates`). Point features with `species` or `canonical_name` become plants, other Points annotations, Polygons zones (outer ring), a two-position LineString a measurement guide and a longer LineString a line zone. Multi* geometries, collections and null geometry are skipped and counted.
- `CanvasSceneEditCommandSurface.importDesignObjects()` hydrates the result into the session plane as one undoable placement. It reallocates identities, clears locks and selects the new objects.

## Saved Object Stamp files

Stamps are a personal library, not Designs ([ADR 0007](../adr/0007-design-objects-and-personal-libraries.md)). Desktop exports one stamp as a valid v7 `.canopi` file that holds only its visible objects and captured groups, arranged around 0°/0°, with safe defaults for the other required fields. It never carries Budget, Timeline, Consortiums, description or non-visual metadata. Import reads any v7 file through a plane centred on its objects and only adds a library entry. It never opens a Design, dirties the current one or records a Recent Design. Web has no stamp import or export.

## Design Session lifecycle

### Modules

| Module (`app/document-session/`) | Owns |
| --- | --- |
| `actions.ts`, `transition.ts` | Intent-shaped operations: `openDesignSessionFromDialog()`, `openDesignSessionFromPath()`, `openDesignDraftSession()`, `openTemplateDesignSession()`, `createNewDesignSession()`, `saveCurrentDesign()`, `saveAsCurrentDesign()`, `resolveDesignSaveConflict()`, `revertDesignSessionToOpenedVersion()`, `startAttachedDesignSession()`, `teardownAttachedDesignSession()`; `actions.ts` also projects `designSaveStatus` and `designRevertAvailable` for chrome |
| `continuous-save.ts` | The platform-neutral continuous-save core shared by both editions: the session's home, debounce timer, write coalescing, save status, conflict pause and the snapshot for Revert. An edition adapter supplies `writeHome()` |
| `save-problem.ts` | The single save dialog request (`flush-failed` or `conflict`) that `components/shared/SaveProblemDialog.tsx` renders in both shells |
| `state-machine.ts` | Desktop session states: attached/detached readiness, flush before replacement, queued loads, the Desktop home writer (file or native Draft), conflict resolution, teardown |
| `replacement.ts` | Platform-neutral `attach()`/`replace()` handoff shared by both editions; imports neither Tauri nor browser code |
| `store.ts` | All session signals and generations; read-only projections of identity, dirty state, pending loads and `canvasChangeRevision` |
| `persistence.ts`, `write-admission.ts` | Purpose-aware save, Save As, snapshot (Draft) save, browser Draft, browser download export, handoff and diagnostic capture |
| `lifecycle.ts`, `use-canvas-document-session.ts` | Desktop canvas host sequence and the `CanvasPanel` DOM-ref adapter |
| `workflow-runner.ts`, `workflows.ts` | Idempotent workflow install/dispose with retained failed disposers |

Web counterparts: `web/browser-design-session.ts` (file, Draft and New acquisition; the browser Draft home writer and page-lifecycle flush) and `web/WebCanvasWorkspace.tsx` (host sequence). `app/design-drafts/` lists and deletes Desktop Drafts for the welcome screen. `canvas/runtime/lifecycle-owner.ts` retains runtime release authority across unmounts. A failed loss-prevention handoff is retried before the next mount.

### Replacement rules

- No component or panel replaces the active Design directly. Every replacement first writes the current Design to its home (`dirtyGuard: "flush"`). Only when that write fails, or a conflict pauses it, does the user see one dialog: Retry, Discard changes or Cancel. There is no unsaved-changes prompt. Notebook rows, Recent Designs and templates call the intent-shaped actions. Production code never builds raw `transitionDocument()` requests.
- Only `attach()` and `replace()` load the runtime document. Never infer a canvas replacement from a `currentDesign` or non-canvas snapshot change.
- A transition captures an exact replacement guard before its dirty decision (non-canvas revision, Scene checkpoint, canvas attachment). Any change to these cancels the request before save or discard can touch newer state. Generated `updated_at` is excluded.
- Retrying a failed replacement resumes the same opaque operation. It never replaces Scene or Design twice and never transfers authorization to another target.
- Teardown handoff is loss prevention: it runs synchronously before any other cleanup. If it fails, the runtime and lease stay alive and the failure is reported.
- The workspace document surface (`app/canvas-map-surface/workspace-document-surface.ts`) disconnects the map generation before it delegates a replacement.

### Saving and persistence

- All saves go through `persistence.ts`: file save, Save As, Draft save (native or browser), browser download, teardown handoff and Problem Report attachment. Nothing calls a raw `serialize` followed by `markSaved`. Only a successful write to the home (file, Save As or Draft) acknowledges its exact captured baseline. A download is an export; it, handoff and attachment captures never acknowledge.
- Captures read committed content only. Scene live previews are excluded.
- Writes are admitted FIFO per durable resource: a native Design target family, one native Draft (`native-draft:<id>`), `browser-app-data:drafts`, or a fresh identity per browser download. Completions become inert after replacement or reattachment. Overlapping manual saves follow issue order.
- Save As changes only the path. It never renames the Design. It writes with `expectedFingerprint: null`, makes the file the home, and deletes the Draft it replaces after any in-flight Draft write lands.
- Desktop file writes are durable: `write_file_durably()` (`desktop/src/design/mod.rs`) writes an operation-owned temporary with `create_new`, syncs it, replaces the target with `atomic_replace()` and, on Unix, syncs the parent directory. A failed write removes its temporary and keeps the previous file. Design saves, Design drafts and derived output (`write_derived_file()`: stamp export, GeoJSON, PDF and PNG) all go through it. There is no `.canopi.prev` backup. Save, load, draft and stamp file commands run in the executor's `Local` class. See [native and release](native-and-release.md#native-operation-executor).
- Fingerprints detect outside changes. A Design file's fingerprint is the lowercase hex SHA-256 of its exact bytes (`design::fingerprint()`). `load_design(path)` returns `LoadedDesign { file, fingerprint }`. `save_design(path, content, expectedFingerprint)` returns `DesignSaveOutcome`: with a fingerprint, the file is written only while it still has it (a missing file has none), else nothing is written and the outcome is `Conflict { current_fingerprint }`. `null` overwrites unconditionally (Save As, keeping this copy). `Saved { path, fingerprint }` carries the fingerprint the next save must expect. The check and the write share one per-file write admission. Only a written save records a Recent Design.
- Desktop Design drafts are Untitled Designs kept in app data until Save As: `{app_data}/drafts/<id>.canopi`, in the same v7 wire format, encoder, durable write and load admission (64 MiB cap, v7 only) as a Design file (`desktop/src/design/drafts.rs`, managed `DesignDrafts` state). Commands: `save_design_draft(id, content)`, `load_design_draft(id)`, `list_design_drafts()` (`DesignDraftSummary { id, name, updated_at }`, newest first; `name` falls back to `Untitled`, `updated_at` is the file's modification time in UTC; an unreadable or refused draft is skipped with a warning that names nothing) and `delete_design_draft(id)` (absent is already deleted). A draft id must match `[a-z0-9-]{1,64}`, so it cannot leave the store. At startup the retired interval-autosave store `{app_data}/autosave` is deleted.
- Recent Designs and the Design Notebook use `UserData` (`desktop/src/services/design_files.rs`, `design_notebook.rs`) and share one availability rule (`design_path_availability()`): a regular file is shown; a path whose parent folder exists but whose file is gone is missing and pruned; anything else (an unplugged or unmounted drive, a permission error) is unavailable, hidden and kept.
- Web homes are always browser Drafts (`web/browser-app-data.ts`); an opened `.canopi` becomes a new Draft. A download is an export and never changes the home. On start with no active Design, the Web platform bootstrap (`platform/browser.ts`) restores the newest valid Draft before first render, then installs continuous save for the application lifetime (Desktop installs it in `platform/desktop.ts`). Each Draft body is decoded on its own, so one corrupt Draft does not discard the others. Both welcome screens list Drafts with Open and Delete (inline confirmation); Desktop also lists Recent Designs.

### Continuous save

- Every Design Session has a home: `{ kind: 'file', path, fingerprint }` or `{ kind: 'draft', id }` (`DesignHome` in `continuous-save.ts`). New Design, template import and (on Web) an opened file start a new Draft home; opening a file starts a file home with its loaded fingerprint; opening a Draft reuses its id. The home binds to the store's session identity inside replacement finalization (`beginSession()`), so a stale write never updates a newer session.
- Canopi saves continuously; there is no switch. A committed change (Design Edit revision or Scene history report, `canvasChangeRevision`) restarts a 1500 ms timer; when it fires the edition writes the home. Writes coalesce: one is in flight and a change during it schedules the next. Continuous save flushes at once on window blur (Desktop `onFocusChanged`), on `visibilitychange` to hidden and `pagehide` (Web; the browser Draft write is synchronous so it completes before unload), before every replacement and on close.
- "Dirty" means "has changes not yet written to the home". Canvas dirty state compares exact `SceneHistory` state identities, not history depth. Non-canvas dirty state compares `nonCanvasRevision` with `nonCanvasSavedRevision`. Edits made during I/O stay dirty. `persistenceDiverged` keeps the Design dirty when a write captured an older snapshot. Never write `designDirty` directly; canvas clean-state updates enter through `app/canvas-runtime/app-adapter.ts`.
- Status is `saved`, `saving`, `error` or `conflict`. The Desktop title bar and Web shell show it beside the Design name (`components/shared/SaveStatusLabel.tsx`): "Saving…", "Saved", "Couldn't save" with Retry, or "Changed outside Canopi", which opens the conflict dialog. Error details go to the log, never the UI. A dirty Design without a home reports `error`.
- A file write that finds a different fingerprint (or no file) returns a conflict. Continuous save pauses for that Design until the user chooses Keep my version (overwrite with `null`), Use the file's version (reload, discarding in-memory changes) or Save mine as a copy (Save As). A moved or deleted file offers Save As or Keep my version (recreate).
- Save (Ctrl+S) writes a file home now, opens the conflict dialog while one is pending, and is Save As for a Draft home. Save and Save As are enabled whenever a Design is open.
- Close (`app/shell/close-guard.ts`) flushes settings, then the Design. A failed write asks Retry, Close without saving or Cancel.
- Revert to version when opened replaces the Design with the snapshot taken at `beginSession()` through the normal replacement path and keeps the same home; continuous save then writes it. It is enabled once the session has changed.
- A save dialog answer (Revert, Keep my version, Use the file's version, Save mine as a copy) applies only to the session that asked: both editions capture `continuousSave.sessionToken()` before asking and do nothing if another Design replaced it meanwhile. The dialog is modal: App Command shortcuts, the Web canvas shortcuts and the command palette are suppressed while it is open.
- "Saving…" reflects only a write for the current session; an older session's write still in flight never shows on its replacement.
- GeoJSON import captures the Design Session identity before the picker opens and returns `unavailable` without mutating if another Design replaced it.

## Design Edit

- Production code writes non-canvas fields only through `app/design-edit/` (`budget.ts`, `timeline.ts`, `consortium.ts`, `lidar.ts`, `core.ts`), never through `store.ts` or raw signals. It reads identity and dirty state through the read-only store projections.
- A command computes its updater and visible replay first, then installs committed state, then publishes signals. A thrown computation publishes nothing. No-op updates do not dirty the Design (compare fields before spreading).
- `reconcileCurrentDesign()` performs scene-derived maintenance without recording user intent.

## Settings

- The shared `Settings` contract lives in `common-types/src/settings.rs`: `locale` (11 languages), `theme` (`light` or `dark`), snapping, panel sizes, `plant_spacing_interval_m`, map layers (`basemap_style`, visibility and opacity for basemap, satellite, contours and hillshade, `contour_interval`), `google_maps_api_key` (a device-local credential), and `last_view { lon, lat, zoom }`. Unknown keys (including retired ones such as `auto_save_interval_s` and `satellite_provider`) are ignored and never re-emitted, and no value is rewritten.
- Desktop reads the stored record strictly. One rule covers every invalid value: a record that does not parse (malformed JSON, an unknown theme, locale or basemap style, a wrong type) is set aside under the `settings.set-aside` key and replaced by defaults (with the detected OS locale). The log names only the parse position, never the record, which may hold the Google key.
- Desktop stores settings in the user DB through Rust. Web stores them in an independent browser-local record (`web/browser-app-data.ts`). Rust `Settings::default()` and the enum catalogs generate `desktop/web/src/generated/settings.ts`. Regenerate the bindings rather than hand-editing default tables.
- `app/settings/projection.ts` owns adapter installation, hydration, mutation, coalesced and serialized persistence, retry and flush. It imports neither Tauri nor browser storage. `platform/desktop.ts` and `platform/browser.ts` install the adapter at the compile-time root. Browser hydration is synchronous so locale and theme apply before first render.
- Use `mutateSettingsProjection()` for settings-backed actions. Use queued persistence on 60 fps paths and commit at gesture end. Await `flushSettingsProjection()` when durability gates a transition. The Desktop close guard waits for it before flushing the Design and keeps the window open on failure.
- `last_view` is written 750 ms after the camera settles (`app/canvas-map-surface/last-view.ts`) and read through `CanvasRuntimeSettingsAdapter.readLastView()`. A new or empty Design opens there, or at lon 13, lat 23, zoom 4 when there is none. Invalid values normalize to `null`.
- The `canopi-theme` localStorage key is a best-effort first-paint cache applied by an inline script in both HTML entries.
- Calendar, Budget and Consortium view preferences are session-scoped planning view state (`app/planning-view/state.ts`), not settings.

## Verification

Format or lifecycle changes: focused tests (`file-format-round-trip`, `canopi-design-conformance`, `canopi-design-decoder`, `continuous-save`, `document-session-transition`, `web-design-session`, `use-canvas-document-session`, `web-canvas-workspace`, `reorigin`), then `npx tsc --noEmit`, `npm test`, both edition builds and the Rust workspace tests. Contract changes also need `npm run gen:types && npm run check:types`.
