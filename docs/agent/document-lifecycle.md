# Document Lifecycle And Settings

Use this guide when changing `.canopi` load/save, document replacement, dirty state, autosave, settings persistence, or app startup/shutdown.

## Current Boundaries

- `desktop/web/src/app/document-session/actions.ts` exposes user-facing document actions.
- `desktop/web/src/app/document-session/lifecycle.ts` owns canvas runtime attachment, initial document mount, queued load installation, autosave timing, settings flush, teardown snapshot, persistence disposal, and canvas-session publication.
- `desktop/web/src/app/document-session/transition.ts` owns guarded Design Session transitions, including dirty checks, attached/detached replacement selection, queued loads, `zoomToFit()` for attached sessions, and workflow installation.
- `desktop/web/src/app/document-session/persistence.ts` owns persisted Design content composition, attached/detached save snapshots, teardown snapshots, and persistence workflow disposal.
- `desktop/web/src/app/document-session/workflows.ts` owns cross-domain workflow effects such as consortium sync.
- `desktop/web/src/app/document/controller.ts` owns non-canvas document mutations through `mutateCurrentDesign()` and `updateDesignArray()`.
- `desktop/web/src/app/document-session/use-canvas-document-session.ts` is a DOM-ref adapter for `CanvasPanel`; keep lifecycle ordering out of the hook.
- `desktop/web/src/state/design.ts` is low-level document state. Treat it as internal state, not a feature action API.

## Document Mutation Rules

- No component may replace the active document directly.
- No panel may call document replacement directly.
- Destructive document flows must use the shared guard path: dirty check -> confirm -> replace.
- `transitionDocument()` is the replacement path for new/open/template/queued/mount-existing flows.
- Callers request a Design transition; `transitionDocument()` decides whether an attached `CanvasDocumentSurface` is available or whether to apply a detached document-state transition.
- Attached transitions hydrate the canvas session, show chrome, call `zoomToFit()`, clear history, and install consortium sync.
- Detached transitions update canonical document state, reset dirty baselines, and install consortium sync without canvas-only calls.

## Document Authority

- Canvas scene state is owned by `SceneStore`: plants, zones, annotations, groups, plant species colors, layers, and canvas session state.
- Non-canvas document state is owned by the document layer: consortiums, timeline, budget, `budget_currency`, location, description, and top-level unknown `extra` fields.
- Non-canvas state must not be pushed into `SceneStore`.
- Canvas state should not be mirrored into standalone signals when a computed value or runtime query surface is enough.
- New cross-domain sync belongs in a workflow module, not a component effect and not an action-module import cycle.

## Save And Format Contract

- Preserve `created_at` from loaded files.
- Preserve loaded document sections on save: timeline, budget, consortiums, description, location, and extra fields.
- Preserve per-object non-visual fields such as plant notes, planted date, quantity, and zone notes.
- Preserve unknown top-level fields through document `extra`.
- Spread `extra` first when composing persisted output so known fields remain authoritative.
- `KNOWN_CANOPI_KEYS` must include `extra`; otherwise `extractDocumentExtra()` can double-nest the `extra` object.
- Top-level annotations belong in the schema. Do not put live annotations under `extra`.
- `serializeScenePersistedState()` emits canvas-owned fields plus placeholders for required non-canvas fields. `serializeDocument()` overwrites placeholders with document-store values.

## Adding Document Fields

- Add document-level fields to the shared `CanopiFile` contract.
- Regenerate `desktop/web/src/generated/contracts.ts` and `known-canopi-keys.ts`.
- Keep `desktop/web/src/app/contracts/document.ts` aligned.
- Add save passthrough in the document-session/persistence composition path.
- Rust `#[serde(flatten)] extra` round-trips unknown keys automatically, so Rust struct changes are only needed when backend logic needs the field.
- For new required array fields, add `#[serde(default)]` in Rust, make the TS field required, add an empty placeholder in the scene codec, and update test fixtures.
- Avoid `?? []` fallbacks on required `CanopiFile` arrays except where the parent object is nullable, such as `currentDesign.value?.field ?? []`.

## File Format Migrations

- `CURRENT_VERSION` lives in `desktop/src/design/format.rs`.
- Add a match arm in `migrate_design_value()` for each new version.
- Bump `CURRENT_VERSION`.
- Add the migration function and tests in the same file.
- The loop runs sequentially, for example v1 -> v2 -> v3.
- `CURRENT_VERSION` is a `u32` to match `CanopiFile.version`; cast to `u64` only at JSON boundaries.

## Dirty State And Autosave

- The dirty model has two baselines:
- Canvas dirty state is tracked by `SceneHistory` saved checkpoints.
- Non-canvas dirty state is tracked by `nonCanvasRevision` vs `nonCanvasSavedRevision`.
- Do not write `designDirty` directly.
- Autosave checkpoints the same document as manual save.
- Autosave scheduling and canvas snapshot composition are owned by `app/document-session/lifecycle.ts`; persistence composition remains in `app/document-session/persistence.ts`.
- Autosave failures surface via `autosaveFailed`.

## Settings Persistence

- Rust `Settings` in the user DB is the durable source of truth for user preferences.
- Frontend signals are runtime projections.
- `desktop/web/src/app/settings/projection.ts` owns hydration, snapshotting, mutation, queued persistence, and flush behavior.
- Use `hydrateSettingsProjection()` after `get_settings`.
- Use `mutateSettingsProjection()` for settings-backed actions.
- Use queued persistence for 60fps-adjacent paths and commit/flush on mouse-up or close as appropriate.
- Use `flushSettingsProjection()` before shutdown paths that must not lose queued settings.
- `localStorage` is only a first-paint cache for theme; Rust settings overwrite it on bootstrap.
- Theme is light/dark only. Stale `"system"` values are migrated by settings deserialization.

## Tauri Lifecycle Gotchas

- Rust commands return `Result<T, String>` so Tauri serializes errors to the frontend.
- Use types from `common-types` for IPC contracts.
- Map command errors with context, for example `.map_err(|e| format!("Failed to <action>: {e}"))`.
- Use `db::acquire(&db.0, "PlantDb")` for mutex locks; it recovers from poison and warns.
- Use JS dialog APIs from `@tauri-apps/plugin-dialog`; Linux blocking dialogs can deadlock.
- Use `destroy()` instead of `close()` for discard-without-save close paths.
- Events emitted in `setup()` are lost because frontend JS has not loaded yet.
- `tauri.conf.json` uses `beforeDevCommand` with `{ script: "npm run dev", cwd: "web" }` relative to `desktop/`.
- The shell plugin is removed. If external processes are ever needed, use Rust `std::process::Command` from a Tauri command.
