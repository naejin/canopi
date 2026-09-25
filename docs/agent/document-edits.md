# Design Edit and document authority

Part of the [Document lifecycle guide](document-lifecycle.md). For Scene transaction authority, see [Canvas scene authority](canvas-scene-authority.md).

## Document Mutation Rules

- Production reads of active Design identity and dirty state should use the read-only projections from `app/document-session/store.ts`.
- Production writes to active Design identity, dirty baselines, pending loads, autosave failure, or canvas-clean bridge state must go through `app/document-session/store.ts`.
- Production writes to non-canvas Design fields must go through `app/design-edit/` instead of importing `app/document-session/store.ts` or low-level Design signals directly.
- Previewable non-canvas edits must use Design Edit transactions. The UI reads the visible projection, while the authority retains a separate committed Design. A preview replaces one pure whole-Design projector over the latest committed state; preview updates neither persist nor advance the dirty revision, and one or many updates commit at most one dirty revision. Only one long-lived preview is admitted, and a competing begin fails before either projection changes. A history-bearing preview must declare its one supported field.
- Ordinary Design Edit commands update committed state and reapply the active projector before publishing visible state. Deterministic scene-derived maintenance uses the explicit `reconcileCurrentDesign()` operation, which also replays the projector but does not record independent user intent. Raw committed-edit, reconciliation, and dirty-marking roles are private Design Edit authority capabilities, not methods on the public Design Session store. Do not restore generic caller-controlled `markDirty: false` mutation.
- Save, Save As, recovery, Browser Draft, browser download, handoff, and diagnostic observation capture only committed Design content. Browser autosave observes the committed Design revision, not visible preview identity, so pointer frames do not write Drafts and every committed change remains observable even while the composite dirty flag is already true.
- Replacement guards include the monotonic preview generation. Any later preview activity permanently supersedes that guard. An admitted Design replacement invalidates the predecessor handle before successor publication; late preview, commit, or abort calls are inert and cannot touch or dirty the successor. Design Edit HMR disposal performs the same lifetime rollover for outstanding handles and captures, then permits fresh edits in the new module lifetime.
- Compute an updater or projector and its visible replay before installing committed authority state. Install committed, preview, generation, and terminal outcome state before reactive signal publication so thrown computation publishes nothing partial and reentrant callbacks observe a coherent result.
- Design Edits are not undoable: the Canvas undo history is the Scene history only. A Design replacement, dirty-baseline reset for an admitted successor, test fixture replacement, or Design Edit lifetime rollover aborts an active preview.
- Scene live previews are excluded by the Canvas persistence authority, and non-canvas Design Edit previews are excluded by the committed Design capture capability. Persistence may run while either preview is active; it must capture the owning authority's committed state rather than the visible speculative projection.

## Document Authority

- Canvas scene state is owned by `SceneStore`: plants, zones, annotations, groups, Design Object locks, plant species colors, plant species symbols, species code reservations, layers, and canvas session state.
- Non-canvas document state is owned by the document layer: consortiums, timeline, budget, `budget_currency`, description, and top-level unknown `extra` fields. Design objects are geolocated scene state; there is no Design-level location ([ADR 0001](../adr/0001-geolocated-map-canvas.md)). Mutations belong behind `app/design-edit/`.
- Non-canvas state must not be pushed into `SceneStore`.
- Canvas state should not be mirrored into standalone signals when a computed value or runtime query surface is enough.
- Design Object lock state is canvas-owned document state. Old files missing per-object `locked` fields load unlocked; new saves must serialize explicit `locked` values.
- New cross-domain sync belongs in a workflow module, not a component effect and not an action-module import cycle.
