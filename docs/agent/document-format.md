# Design format and export

Part of the [Document lifecycle guide](document-lifecycle.md). For Scene transaction authority, see [Canvas scene authority](canvas-scene-authority.md).

## Save And Format Contract

- Lightweight web-edition work must still create, open, edit, and export real Canopi Designs rather than a separate web sketch format. Browser storage/file adapters may replace Tauri filesystem dialogs, but they should feed the normal Design Session and save-composition seams. Unsupported web-edition sections should be preserved when loaded where possible and emitted as valid empty sections for new web-created Designs. See [ADR 0005](../adr/0005-web-edition-scope.md).
- The web edition should provide browser-local Design drafts and autosave as the active browser save target, with explicit `.canopi` download/export as the durable portable save path. Browser Drafts are internal autosave/recovery state in v1, not a visible Drafts list, and must not reuse desktop Design Notebook semantics such as Notebook Sections, saved paths, or file reveal actions. Do not make direct save-back to an imported file the v1 foundation, and do not introduce a backend requirement for storing user Designs. Canvas PDF and GeoJSON are derived exports; they do not change Design persistence ([ADR 0005](../adr/0005-web-edition-scope.md)). The Browser App Shell should present its implemented capabilities directly instead of reusing desktop native file chrome.
- Platform-specific persistence, settings, and file adapters should be selected by the desktop or web Vite entry at compile time, not through runtime web-vs-Tauri feature flags inside shared Design Session modules. See [ADR 0005](../adr/0005-web-edition-scope.md).
- Preserve `created_at` from loaded files.
- Preserve loaded document sections on save: timeline, budget, consortiums, description, and extra fields.
- Preserve per-object non-visual fields such as plant notes, planted date, quantity, and zone notes.
- Preserve unknown top-level fields through document `extra`.
- Spread `extra` first when composing persisted output so known fields remain authoritative.
- `KNOWN_CANOPI_KEYS` must include `extra`; otherwise `extractDocumentExtra()` can double-nest the `extra` object.
- Top-level annotations belong in the schema. Do not put live annotations under `extra`.
- `serializeScenePersistedState()` emits canvas-owned fields plus placeholders for required non-canvas fields. The app-owned `composeDocumentForSave()` step overwrites placeholders with the Design Session capture's non-canvas values.
- Attached canvas serialization delegates full Design file composition through `app/canvas-runtime/app-adapter.ts`, which calls `composeDocumentForSave()`. Runtime core should not import `app/contracts/document`.
- `createWorkspaceDocumentSurface()` is the synchronous `CanvasDocumentSurface` proxy mounted by both production editions. Its app-owned generation reconciler fences MapLibre before delegated replacement and only the returned opaque ticket may queue current-snapshot activation after delegated success or `CanvasDocumentReplacementNotAdmittedError`; it immediately rethrows that exact typed error so document replacement retains its existing settlement contract. Other replacement errors leave the workspace disconnected until a later admitted retry, including when a reentrant successor invalidates its predecessor's ticket.
- `createWorkspaceRuntimeComposition()` owns that proxy together with the production workspace lifecycle. It reads a nullable Design session snapshot at start: no current Design returns `no-design` without invoking map, renderer, or disconnect work; a later admitted replacement performs the first viewport initialization through the wrapped document surface. Desktop awaits composition start before rulers, attached Design startup, resize/queued load, and publication. Browser awaits it before rulers, browser attachment, initial resize/observer, and publication. Both synchronously hand off the Design before any observer, settings, or composition teardown work.
- Attached persistence crosses `CanvasDocumentSurface.captureForPersistence()`, which returns the composed content and an opaque `acknowledgeSaved()` closure for that exact Scene checkpoint. Do not expose separate raw serialization or saved-marker methods again.
- Design file save composition is driven by generated field ownership metadata from `common-types/src/design.rs` via `DOCUMENT_FILE_FIELD_OWNERS`. Do not hand-maintain parallel top-level field merge lists in frontend save code.
- The Web ingestion schema and `CURRENT_CANOPI_FILE_VERSION` are generated into `desktop/web/src/generated/canopi-design-format.ts` from `common-types/src/design.rs`. Generation fails if schema fields diverge from `DESIGN_FILE_FIELDS`, flattened root extras stop being preserved, or Schemars emits a keyword the focused Web decoder does not understand.
- `common-types/canopi-new-design-defaults.json` is the authored authority for the canonical provisional spatial frame and standard Layer catalog. Bindings generation validates it and emits typed Rust and TypeScript facts. Desktop and browser composition must inject their own name and timestamp and clone the generated spatial frame and Layer records; Scene defaults consume only the generated Layer catalog, not whole-document defaults. Every admitted Design persists one spatial frame; no runtime path may synthesize a missing anchor.
- Shared `extra` subfields need an explicit ownership entry near `composeDocumentForSave()`; currently `extra.guides` is scene-owned.
- Plant Symbols are scene-owned fields introduced in v3: top-level `plant_species_symbols` stores per-species defaults, and each placed plant may carry an optional explicit `symbol`. The current botanical and abstract ID catalog is authored in `common-types/src/design.rs` and generated into frontend facts. Retired/unknown IDs render as neutral `round`; no legacy artwork or alias migration is maintained. The botanical replacement changes allowed presentation IDs, not the JSON field shape or file version. Plant Color species actions update both matching editable placed-plant colors and the species default; setting only the default map does not recolor existing plants.
- Species Code reservations live in the scene-owned optional `plant_species_codes` map. Missing maps hydrate to readable unique codes before the clean baseline; existing reservations survive deletion and save/load. Scene cloning normalizes reservations, so additions assign codes in the same undoable edit as their Plants. Include this field in normalization, the generated owner catalog, and Scene command patches; dropping it during document composition renames colliding Species after reopening.
- Species Focus and code-label visibility are Scene Session state. Reading or focusing the Species Key never edits the Design, changes selection, or records history. Hydration resets both; switching side panels does not.
- A species default of `round` is explicit and must be stored as `plant_species_symbols[canonicalName] = "round"`; clearing a species default deletes the key and does not rewrite placed-plant symbols.

## Saved Object Stamp Import And Export

- Saved Object Stamps are personal library entries, not part of normal Design Session save composition, dirty state, autosave, or replacement guards.
- Web Edition v1 keeps Saved Object Stamps browser-local only and does not expose stamp import/export.
- Exporting a Saved Object Stamp writes one valid `.canopi` file containing only the visible canvas objects and captured Object Groups needed for that stamp, with the canonical provisional spatial frame and safe defaults for other required Design fields. Do not export a source Design's confirmed placement, Budget Items, Timeline Actions, Consortiums, description, or non-visual object metadata.
- Importing a Saved Object Stamp from `.canopi` adds a library entry only. It must not open or replace the current Design Session, must not mark the current Design dirty, and must not require the dirty-design guard.
- Stamp import should read `.canopi` files through a lower-level format-loading path or a stamp-specific command that does not record Recent Designs. Do not reuse `design_files::load_design()` for stamp import unless its recent-file side effect is bypassed deliberately.
- Native Stamp import and export use the same bounded `Local` execution class as other Design file work; executor tracing labels must never contain the Stamp name, Design content, or path.
- Frontend code owns native import/export dialogs; Rust commands should perform file read/write or payload normalization only, matching the existing Linux dialog boundary.

## Export Boundaries

- [ADR 0008](../adr/0008-canvas-pdf-export.md) defines Canvas PDF scope; the [Canvas PDF guide](canvas-pdf.md) owns implementation and validation guidance for its shared pipeline and desktop/Web delivery.
- Canvas PDF is derived output. Capture settled canvas state through the query role without requesting or acknowledging Design persistence. Export must not clear dirty state, change Scene content/history, or modify the Design to make it printable.
- Print setup belongs to the current opaque Design Session identity. It survives preview closure and editing, rebuilds from current content on reopen, and is discarded on replacement. Keep it out of `.canopi` and persistent settings.
- All map backgrounds and Timeline/Budget/Consortium PDF sections remain deferred. The old structured Design Report and Rust `printpdf` implementation stay retired under [ADR 0008](../adr/0008-canvas-pdf-export.md); the native snapshot-PDF command/renderers are also removed. PNG snapshot export remains separate.

## Adding Document Fields

- Add document-level fields to the shared `CanopiFile` contract.
- Keep `common-types/src/design.rs` `DESIGN_FILE_FIELDS` aligned with the shared contract. This list generates frontend known keys and document/scene/shared field ownership metadata.
- Regenerate `desktop/web/src/generated/contracts.ts` and `known-canopi-keys.ts`.
- `desktop/web/src/app/contracts/document.ts` consumes generated field ownership metadata; do not hand-maintain a parallel owner map there.
- Add save passthrough in the document-session/persistence composition path.
- Rust `#[serde(flatten)] extra` round-trips canonical root unknown keys automatically. Web code must still use the canonical wire encoder because its normalized in-memory representation stores those entries under `CanopiFile.extra`.
- For new required array fields, add `#[serde(default)]` in Rust, make the TS field required, add an empty placeholder in the scene codec, and update test fixtures.
- Avoid `?? []` fallbacks on required `CanopiFile` arrays except where the parent object is nullable, such as `currentDesign.value?.field ?? []`.

## File Format Admission

- `CURRENT_CANOPI_FILE_VERSION` lives in `common-types/src/design.rs`; it is the single native/Web version authority. Format v7 is the only admission target: every persisted position is a WGS84 `GeoPoint { lon, lat }` and there is no Design-level anchor ([ADR 0001](../adr/0001-geolocated-map-canvas.md)). Missing, older, and future versions fail with `unsupported_version` before document replacement; Canopi ships no converter ([ADR 0003](../adr/0003-no-backward-compatibility.md)). `canopi-fxil.2` moves the code from v6 to v7.
- Missing-version, minimum-version, future-version, Web Mercator latitude, and stable ingestion-error facts live beside it and are emitted in `desktop/web/src/generated/canopi-design-format.ts`. The bindings compiler validates those facts against `common-types/canopi-design-conformance.json` before publishing or checking generated files.
- Keep native and Web ingestion equivalent: exact-version admission, obsolete-root rejection, generated-schema/Serde decoding, lon/lat range validation, and unknown-root normalization.
- A future format change bumps the version and refuses the previous one. Update the authored shared contract and conformance corpus first; never convert old data in a `Deserialize` implementation.
- Bump `CURRENT_CANOPI_FILE_VERSION`, then run `cd desktop/web && npm run gen:types` and `npm run check:types` so the generated Web version/schema remain committed.
- `CURRENT_CANOPI_FILE_VERSION` is a `u32` to match `CanopiFile.version`; cast to `u64` only at JSON boundaries.

## LiDAR Presentation Section

- The `.canopi` `lidar` field (additive optional, `common-types/src/lidar.rs`) stores ordered presentation entries that reference shared LiDAR library identities: `{ schema_version, entries: [{ kind: Source | Analysis, id, visible, opacity, order, style }] }`. It never stores raster bytes, paths or generations.
- Library identities live in `lidar-library.sqlite` plus managed app-data assets under `desktop`-app data `lidar/`. Library operations (import, rename, delete, calculate, retry) never dirty a Design and never rewrite the document; the one exception is a slope asked for from Layers, whose finished result is added to that same Design session as an ordinary Design Edit.
- Presentation edits (visibility, opacity, order, style) flow through `app/design-edit/lidar.ts` via `editCurrentDesign` and participate in save/autosave/discard like any other document section. The projector must return the identical design reference when nothing changed.
- Entries referencing deleted library entities persist (unavailable) and are skipped by rendering; they are removed only by an explicit, impact-confirmed layer deletion. Web Edition preserves the section without rendering: the per-entry `#[serde(flatten)] extra` keeps unknown entry fields round-tripping through the schema decoder, and unknown `kind`s only require the core fields to decode.
- Additive field rules: `lidar` is registered in `DESIGN_FILE_FIELDS` with `Document` owner and `skip_serializing_if` so absent stays absent; the generated schema exposes per-entry `additionalProperties` for forward compatibility.
- `normalizeLoadedDocument` and `composeDocumentForSave` must carry `lidar` explicitly. Native load, save, autosave/recovery and Web ingestion share the round-trip regression coverage; do not rely on the unknown-field fallback because generated ownership classifies `lidar` as a known Document field.
