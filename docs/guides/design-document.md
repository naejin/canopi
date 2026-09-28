# Design document

## Purpose

Boundaries for the `.canopi` file, the Design session (open, continuous save, replacement, close) and device settings. Why: [ADR 0001](../adr/0001-geolocated-map-canvas.md), [ADR 0003](../adr/0003-no-backward-compatibility.md), [ADR 0005](../adr/0005-web-edition-scope.md), [ADR 0007](../adr/0007-design-objects-and-personal-libraries.md), [ADR 0009](../adr/0009-continuous-save.md), [ADR 0011](../adr/0011-analyses-provenance-and-stories.md). Frontend paths are relative to `desktop/web/src/`; each rule ends with its enforcing test, or "(advice)".

## Authorities and boundaries

- **Scene runtime** (`SceneStore` behind `SceneCanvasRuntime`) owns plants, zones, annotations, measurement guides, ruler guides (`extra.guides`), groups, locks, Design layers and the per-species colour, symbol and code maps. It changes only through runtime transactions; panels read it through `CanvasQuerySurface`, never through mirrored signals.
- **Design Edit** (`app/design-edit/`) owns `name`, `description`, `budget`, `budget_currency`, `timeline`, `consortiums`, `lidar` entries, `views`, `stories`, `created_at`, `extra.plant_display`, `extra.saved_view_display` and unknown root keys under `extra`. Nothing else writes them.
- **Settings** (`common-types/src/settings.rs`) own device state: locale, theme, map layers, `soften_background`, the Google key and `satellite_source`, `last_view`, tool-rail learning, single-key shortcuts and New Design defaults. A setting never travels with a file; a Design field never depends on the device.
- **Undo** covers Scene edits only. Design Edit commands, map layers and settings are not undoable.
- **Coordinates.** The file stores WGS84 `GeoPoint { lon, lat }` for every position and zone rotation in degrees clockwise from north. Metres exist only in the session plane (`canvas/session-plane.ts`); camera moves never move objects.
- **Trust boundaries.** Native: `desktop/src/design/format.rs`. Web: `app/contracts/design-ingestion.ts` (`decodeCanopiDesign`). Nothing else casts raw JSON to `CanopiFile`; `app/contracts/canopi-design-wire.ts` is the only serializer.
- **Persistence.** Every write goes through `app/document-session/persistence.ts`; only a successful write to the session's home (file or Draft) acknowledges the captured baseline. Downloads, handoffs and Problem Report attachments are exports and never acknowledge.

## Rules

- `CURRENT_CANOPI_FILE_VERSION` (`common-types/src/design.rs`, 9) is admitted exactly; older, newer or missing versions fail with `unsupported_version` before the active Design changes. No converter, ever. (`common-types/canopi-design-conformance.json`, run by `format.rs` and `__tests__/canopi-design-conformance.test.ts`)
- `DESIGN_FILE_FIELDS` names every root field and its owner; `known-canopi-keys.ts` and `composeDocumentForSave()` (`app/contracts/document.ts`) derive from it. A parallel owner list is a bug. (`bindings-gen` fails on divergence; `npm run check:types`)
- `OBSOLETE_CANOPI_ROOT_KEYS` and a root `extra` key are refused as `invalid_document`; in memory unknown roots live under `CanopiFile.extra`, and the encoder spreads them first so known fields win. (conformance corpus)
- Files over `MAX_CANOPI_FILE_BYTES` (64 MiB) are refused before parsing; the GeoJSON reader shares the limit. (`format.rs` tests)
- Unchanged positions write their loaded lon/lat verbatim (`SceneGeoLedger`, `canvas/runtime/scene/geo-frame.ts`); changed ones round to 1e-9 degree. Open then save is byte-identical for files Canopi wrote (floats are f32, keys re-ordered). (`__tests__/file-format-round-trip.test.ts`)
- A zone's `id` (`zone-<uuid>`) is its identity; `name` is display only and nullable. Targets, groups and view highlights reference the id, so renaming is a Scene edit and never crosses into Design Edit. (`file-format-round-trip`, `__tests__/design-edit-views.test.ts`)
- Views and stories pass `validate_views_and_stories` (`common-types/src/views.rs`; mirror `app/contracts/views-admission.ts`): unique ids, camera and extent in range, steps that name an existing view, `https:`/`http:`/`mailto:` links, embedded PNG/JPEG/WebP/GIF images at most 1 MiB each and 10 MiB per Design; rich text is a block list, never HTML. (conformance corpus, `__tests__/story-rich-text.test.ts`)
- Deleting a view deletes the steps that show it and returns a `SavedViewDeletion` that `restoreSavedView` puts back; no step dangles. (`__tests__/design-edit-views.test.ts`, `design-edit-stories.test.ts`)
- Non-canvas Design writers import Design Edit only through `app/design-edit/index.ts`. (`__tests__/frontend-architecture-policies.test.ts`, "Non-canvas Design writers consume Design Edit")
- A Design Edit command computes its update first, installs committed state, then publishes; a no-op compares fields and does not dirty. (`__tests__/design-edit-authority.test.ts`)
- `extra.plant_display` is Design data (travels with the file, not undoable); Soften background is a device setting. Readers repair invalid values and never rewrite a plant or species colour. (`__tests__/plant-display.test.ts`)
- Every replacement first flushes the current Design to its home (`dirtyGuard: "flush"`); the only dialog is Retry / Discard / Cancel after a failed or conflicting write. There is no unsaved-changes prompt. (`__tests__/document-session-transition.test.ts`)
- Only `attach()` and `replace()` (`app/document-session/replacement.ts`) load the runtime document; a transition captures a replacement guard and cancels if anything changed underneath. (`__tests__/design-session-replacement.test.ts`, `use-canvas-document-session.test.tsx`)
- Continuous save restarts a 1500 ms timer per committed change, coalesces writes and flushes on blur, hide, `pagehide`, replacement and close. (`__tests__/continuous-save.test.ts`, `web-design-session.test.ts`)
- Dirty means "not yet written to the home": the canvas compares `SceneHistory` state identities, never depth; `persistenceDiverged` keeps a Design dirty when a write captured an older snapshot; nobody writes `designDirty` directly. (`__tests__/dirty-state.test.ts`, `scene-history-checkpoint.test.ts`)
- A file write carries the SHA-256 fingerprint it expects (`desktop/src/services/design_files.rs`); a mismatch returns `Conflict` and pauses continuous save until the user chooses Keep mine, Use the file's version or Save a copy. `null` overwrites (Save As). (`design_files.rs` tests, `continuous-save.test.ts`)
- Native writes are durable: `write_file_durably()` (`desktop/src/design/mod.rs`) writes a `create_new` temporary, syncs, `atomic_replace()`s and syncs the parent; Designs, Drafts and derived output all use it. No `.prev` backup. (`design/mod.rs` tests)
- A dialog answer applies only to the session that asked: capture `continuousSave.sessionToken()` first. (`continuous-save.test.ts`)
- Desktop Drafts live in `{app_data}/drafts/<id>.canopi`, ids `[a-z0-9-]{1,64}`; Web homes are always browser Drafts (`web/browser-app-data.ts`), decoded one by one so a corrupt Draft discards nothing else. (`drafts.rs` tests, `__tests__/browser-app-data.test.ts`)
- An unparseable settings record is set aside under `settings.set-aside` and replaced by defaults; unknown keys are ignored, never re-emitted; the log names a position, never the record (it may hold the Google key). (`desktop/src/services/settings.rs` tests)
- Settings mutate through `mutateSettingsProjection()`; 60 fps paths queue and commit at gesture end; await `flushSettingsProjection()` when durability gates a transition. (`__tests__/settings-projection.test.ts`)
- New Design defaults apply once at creation (`app/settings/new-design-defaults.ts`), never to an opened Design. (`__tests__/new-design-view.test.ts`)
- GeoJSON is a derived exchange format: `app/geojson/codec.ts` is pure; export reads settled lon/lat; import decodes the whole file before one undoable `importDesignObjects()` placement with fresh ids. (`__tests__/geojson-codec.test.ts`, `geojson-workflow.test.ts`)
- Stamp export writes a current-version `.canopi` holding only visible objects; payload version 2; older payloads are refused. (`__tests__/saved-object-stamp-file.test.ts`)

## Do not

- Add a migration, legacy reader or old fixture, or convert inside `Deserialize`.
- Write a Design field from a component, workbench or raw `store.ts` signal.
- Persist a runtime metre, a plane origin, an anchor or a bearing.
- Call a serializer and then mark the Design saved; only `persistence.ts` acknowledges.
- Infer a canvas replacement from `currentDesign` changing.
- Read `updated_at` into a replacement guard; it is generated.
- Add a root field without `DESIGN_FILE_FIELDS`, the conformance corpus and regenerated bindings.
- Describe Design Edit as undoable in a comment or a guide; it is not wired into history.

## Where to look

| Area | Module | Tests |
|---|---|---|
| Format, owners, limits | `common-types/src/design.rs`, `views.rs`, `lidar.rs` | `canopi-design-conformance.json`, `desktop/src/design/format.rs` |
| Web admission and wire | `app/contracts/` | `__tests__/canopi-design-*`, `file-format-round-trip` |
| Geo ledger, re-origin | `canvas/runtime/scene/geo-frame.ts`, `scene-runtime/reorigin.ts` | `reorigin.test.ts`, `file-format-round-trip` |
| Design Edit | `app/design-edit/` | `__tests__/design-edit-*`, `frontend-architecture-policies` |
| Views, stories, images | `app/saved-views/`, `app/stories/` | `__tests__/saved-views*`, `story-*` |
| Session, save, replacement | `app/document-session/` | `__tests__/continuous-save*`, `document-session-*`, `design-session-*` |
| Web session | `web/browser-design-session.ts`, `web/browser-app-data.ts` | `__tests__/web-design-session`, `web-canvas-workspace` |
| Native files, Drafts, previews | `desktop/src/design/`, `desktop/src/services/design_files.rs`, `recent_design_previews.rs` | inline tests |
| GeoJSON | `app/geojson/` | `__tests__/geojson-*` |
| Settings | `common-types/src/settings.rs`, `app/settings/` | `__tests__/settings-*` |

## Open decisions

None tracked.
