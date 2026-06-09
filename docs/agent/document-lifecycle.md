# Document Lifecycle And Settings

Use this guide when changing `.canopi` load/save, document replacement, dirty state, autosave, settings persistence, or app startup/shutdown.

## Current Boundaries

- `desktop/web/src/app/document-session/actions.ts` exposes user-facing document actions.
- `desktop/web/src/app/document-session/lifecycle.ts` owns canvas runtime attachment, resize observation, autosave timing, settings flush, runtime teardown, and canvas-session publication.
- `desktop/web/src/app/document-session/state-machine.ts` owns explicit Design Session states and transition ordering: attached/ detached readiness, dirty checks, attached/detached replacement selection, queued loads, `zoomToFit()` for attached sessions, autosave execution, teardown snapshots, persistence disposal, and workflow runner install/dispose.
- `desktop/web/src/app/document-session/transition.ts` exposes intent-shaped Design Session operations for document actions and lifecycle callers while keeping low-level transition request construction inside the Design Session module.
- `desktop/web/src/app/document-session/store.ts` is the public Design Session state seam for active Design identity, dirty baselines, pending loads, saved markers, autosave failure, and read-only reactive projections.
- `desktop/web/src/app/document-session/persistence.ts` owns persisted Design content composition, attached/detached save snapshots, and teardown snapshots.
- `desktop/web/src/app/document-session/workflow-runner.ts` owns Design Session workflow install/dispose idempotence.
- `desktop/web/src/app/document-session/workflows.ts` is the Design Session workflow registry.
- `desktop/web/src/app/consortium/workflow.ts` owns the Consortium sync workflow adapter and effect.
- `desktop/web/src/app/design-edit/` owns non-canvas Design edits through the Design Session store, including no-op detection, dirty marking, array preview/commit/abort transactions, and feature-specific writes for Location, Budget Items, Timeline Actions, and Consortiums.
- `desktop/web/src/app/document-session/use-canvas-document-session.ts` is a DOM-ref adapter for `CanvasPanel`; keep lifecycle ordering out of the hook.
- `desktop/web/src/state/design.ts` is low-level Design Session store implementation. Production code should import `app/document-session/store.ts`, not this file, unless the store seam itself is being changed. Broad frontend and canvas-runtime tests should use `desktop/web/src/__tests__/support/design-session-state.ts` instead of importing low-level signals directly.
- `desktop/web/src/app/canvas-runtime/host.ts` publishes `CanvasRuntimeSurfaces` for the live Design Session. Document lifecycle code should consume role-specific canvas surfaces instead of a raw `SceneCanvasRuntime`.
- `desktop/web/src/app/canvas-runtime/app-adapter.ts` is the app-owned bridge for canvas clean state, Design file composition, and settings persistence commands used by runtime core.

## Document Mutation Rules

- No component may replace the active document directly.
- No panel may call document replacement directly.
- Destructive document flows must use the shared guard path: dirty check -> confirm -> replace.
- Production reads of active Design identity and dirty state should use the read-only projections from `app/document-session/store.ts`.
- Production writes to active Design identity, dirty baselines, pending loads, autosave failure, or canvas-clean bridge state must go through `app/document-session/store.ts`.
- Production writes to non-canvas Design fields must go through `app/design-edit/` instead of importing `app/document-session/store.ts` or low-level Design signals directly.
- Previewable non-canvas array edits, such as Timeline Action drags and Consortium drags, should use Design Edit transactions so previews do not advance the dirty revision and commit marks the Design dirty once.
- Production callers use intent-shaped Design Session operations such as `openDesignSessionFromDialog()`, `openDesignSessionFromPath()`, `openTemplateDesignSession()`, `createNewDesignSession()`, `startAttachedDesignSession()`, `consumeQueuedDocumentLoad()`, `saveCurrentDesign()`, `saveAsCurrentDesign()`, `autosaveDesignSession()`, and `teardownAttachedDesignSession()`.
- Low-level `transitionDocument()` request construction is internal to the Design Session module and state-machine tests. Production callers must not assemble transition sources, dirty guard modes, load callbacks, queue deferral behavior, or attached/detached branch policy.
- Design Session operations decide whether an attached `CanvasDocumentSurface` is available or whether to apply a detached document-state transition.
- Attached transitions hydrate the canvas session, show chrome, call `zoomToFit()`, clear history, and install Design Session workflows.
- Detached transitions update canonical document state, reset dirty baselines, and install Design Session workflows without canvas-only calls.
- Lifecycle callers should use `startAttachedDesignSession()`, `autosaveDesignSession()`, and `teardownAttachedDesignSession()` instead of reassembling Design Session state-machine steps locally.

## Document Authority

- Canvas scene state is owned by `SceneStore`: plants, zones, annotations, groups, Design Object locks, plant species colors, layers, and canvas session state.
- Non-canvas document state is owned by the document layer: consortiums, timeline, budget, `budget_currency`, location, description, and top-level unknown `extra` fields. Mutations belong behind `app/design-edit/`.
- Non-canvas state must not be pushed into `SceneStore`.
- Canvas state should not be mirrored into standalone signals when a computed value or runtime query surface is enough.
- Design Object lock state is canvas-owned document state. Old files missing per-object `locked` fields load unlocked; new saves must serialize explicit `locked` values.
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
- Attached canvas serialization delegates full Design file composition through `app/canvas-runtime/app-adapter.ts`, which calls `composeDocumentForSave()`. Runtime core should not import `app/contracts/document`.
- Design file save composition is driven by generated field ownership metadata from `common-types/src/design.rs` via `DOCUMENT_FILE_FIELD_OWNERS`. Do not hand-maintain parallel top-level field merge lists in frontend save code.
- Shared `extra` subfields need an explicit ownership entry near `composeDocumentForSave()`; currently `extra.guides` is scene-owned.

## Adding Document Fields

- Add document-level fields to the shared `CanopiFile` contract.
- Keep `common-types/src/design.rs` `DESIGN_FILE_FIELDS` aligned with the shared contract. This list generates frontend known keys and document/scene/shared field ownership metadata.
- Regenerate `desktop/web/src/generated/contracts.ts` and `known-canopi-keys.ts`.
- `desktop/web/src/app/contracts/document.ts` consumes generated field ownership metadata; do not hand-maintain a parallel owner map there.
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
- Canvas clean-state updates enter the Design Session through `app/canvas-runtime/app-adapter.ts`. Runtime core should receive a `CanvasRuntimeAppAdapter` clean-state callback instead of importing `app/document-session/store`.
- Do not write `designDirty` directly.
- Autosave checkpoints the same document as manual save.
- Autosave scheduling is owned by `app/document-session/lifecycle.ts`; autosave execution and canvas snapshot composition route through the Design Session state machine; persistence composition remains in `app/document-session/persistence.ts`.
- Autosave failures surface via `autosaveFailed`.

## Settings Persistence

- Rust `Settings` in the user DB is the durable source of truth for user preferences.
- Frontend signals are runtime projections.
- `desktop/web/src/app/settings/projection.ts` owns hydration, snapshotting, mutation, queued persistence, and flush behavior.
- Use `hydrateSettingsProjection()` after `get_settings`.
- Use `mutateSettingsProjection()` for settings-backed actions.
- Use queued persistence for 60fps-adjacent paths and commit/flush on mouse-up or close as appropriate.
- Use `flushSettingsProjection()` before shutdown paths that must not lose queued settings.
- Canvas runtime settings-backed commands such as snap-to-grid toggling and Plant Spacing interval commits cross `app/canvas-runtime/app-adapter.ts`; runtime core should not import settings projection modules directly.
- Bottom panel tab heights are nullable per-tab settings. `null` means the frontend should use the tab's first-use default; manual resize stores a concrete height for the active tab only.
- Legacy `bottom_panel_height` values are migrated in the Rust settings service: `200` is treated as unset, and any other legacy height seeds Timeline, Budget, and Consortium heights.
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
