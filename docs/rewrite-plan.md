# Rewrite Plan: `arch-rewrite-core`

This branch is the architecture reset branch for Canopi's next core.

## Goal

Preserve the current shipped product shell while replacing the internal architecture with clearer boundaries:

- `common-types` defines transport and file-format contracts
- frontend `domain/` defines internal product models and rules
- frontend `app/` defines controllers, workflows, and transport mappers
- frontend `ui/` renders from app/domain selectors only
- Rust backend services own business logic; Tauri commands remain adapters
- canvas stays imperative and non-declarative
- MapLibre stays a derived sibling surface, never a document or camera authority

## Non-Negotiable Invariants

- Canvas scene state and non-canvas document state stay split by authority.
- Panel/map/canvas sync continues to go through typed `PanelTarget[]` seams.
- `desktop/src/lib.rs` stays a thin composition root.
- UI components must not become direct IPC clients for cross-feature workflows.
- The rewrite may emit a new `.canopi` format, but old-file import should remain possible.

## Branch Strategy

- Branch name: `arch-rewrite-core`
- Delivery mode: one-shot cutover
- Temporary compatibility shims are allowed for at most one milestone.
- Hotspot files are serial-ownership files, not parallel-edit files.

## Hotspot Files

These files require single-owner edits per milestone:

- `desktop/web/src/app.tsx`
- `desktop/web/src/components/panels/CanvasPanel.tsx`
- `desktop/web/src/components/canvas/MapLibreCanvasSurface.tsx`
- `desktop/web/src/canvas/runtime/scene-runtime.ts`
- `desktop/web/src/state/app.ts`
- `desktop/web/src/state/document.ts`
- `desktop/web/src/state/canvas.ts`
- `desktop/src/lib.rs`
- `common-types/src/design.rs`
- `common-types/src/species.rs`

## First Milestones

1. Rewrite scaffold and guardrails
2. Generated transport bindings from `common-types`
3. Persistence and orchestration invariant tests
4. Frontend app/session extraction
5. Canvas/runtime decomposition
6. Backend service extraction

## Implementation Rule

The rewrite should move behavior onto new seams and then delete old seams. Do not keep two full architectures alive in parallel.
