# Rewrite Architecture: `arch-rewrite-core` (Completed)

This branch records the architecture reset that was landed for Canopi's next core.

## Delivered Boundaries

The rewrite established these boundaries:

- `common-types` defines transport and file-format contracts
- frontend `domain/` defines internal product models and rules
- frontend `app/` defines controllers, workflows, and transport mappers
- frontend `ui/` renders from app/domain selectors only
- Rust backend services own business logic; Tauri commands remain adapters
- canvas stays imperative and non-declarative
- MapLibre stays a derived sibling surface, never a document or camera authority

## Invariants Kept

- Canvas scene state and non-canvas document state stay split by authority.
- Panel/map/canvas sync continues to go through typed `PanelTarget[]` seams.
- `desktop/src/lib.rs` stays a thin composition root.
- UI components must not become direct IPC clients for cross-feature workflows.
- Old-file import remains possible.

## Shipped Shape

- Generated TypeScript transport bindings come from `common-types`.
- Frontend orchestration lives under `desktop/web/src/app/`.
- Frontend document authority stays in `state/design.ts`; document policy lives in
  `app/document/controller.ts` and `app/document-session/*`; legacy `state/app.ts`
  and `state/canvas.ts` are gone.
- Canvas runtime responsibilities are split across `scene-runtime.ts` and focused
  helpers for document, presentation, chrome, render scheduling, and mutations.
- MapLibre is mounted through `MapLibreCanvasSurface.tsx`, with orchestration in
  `maplibre-surface-controller.ts` and no document/camera authority of its own.
- Backend command modules delegate to `desktop/src/services/*`.
- Plant DB detail projection and row mapping are separated from the orchestration path.

## Delivery Notes

- Branch name: `arch-rewrite-core`
- One-shot cutover completed.
- Temporary compatibility shims were only a cutover-time bridge.
- Hotspot files are serial-ownership files, not parallel-edit files.

## Hotspot Files

These files require single-owner edits per milestone:

- `desktop/web/src/components/panels/CanvasPanel.tsx`
- `desktop/web/src/components/canvas/MapLibreCanvasSurface.tsx`
- `desktop/web/src/components/canvas/maplibre-surface-controller.ts`
- `desktop/web/src/canvas/runtime/scene-runtime.ts`
- `desktop/src/lib.rs`
- `desktop/src/db/plant_db.rs`
- `desktop/src/db/plant_db/detail.rs`
- `common-types/src/design.rs`
- `common-types/src/species.rs`

## Major Milestones Landed

1. Rewrite scaffold and generated transport bindings
2. Persistence and orchestration invariant tests
3. Frontend app/session, shell, settings, and feature-controller extraction
4. Removal of legacy frontend state facades
5. Canvas/runtime decomposition across document, mutation, presentation, chrome, and render seams
6. Backend service extraction across document, settings, tiles, adaptation, export, and related commands
7. Plant DB detail contract and row-mapper separation
8. Schema-contract test support extraction and relocation of contract assertions

## Implementation Rule

The rewrite moved behavior onto new seams and then deleted the old seams. Do not keep two full architectures alive in parallel.
