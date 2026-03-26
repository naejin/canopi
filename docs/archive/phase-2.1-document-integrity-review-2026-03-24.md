# Review — Phase 2.1 Document Integrity Plan

Date: 2026-03-24

Reviewer: Codex

Subject: Review of `docs/plans/phase-2.1-document-integrity.md`

## Executive Summary

The updated Phase 2.1 plan is strong and much closer to implementation-ready.

It successfully fixes the two biggest flaws from the earlier draft:

- no serializer/state module cycle in Phase A
- no broken monotonic dirty model in Phase C

It also correctly incorporates:

- defensive `extra` merge ordering
- `?? null` semantics for custom attrs
- degraded-mode feature gating in Phase D
- bootstrap restructuring in Phase E

The main remaining problem is scope, not sequencing:

- the plan still does not account for imported background images, which are currently a user-facing feature and are not preserved through save/load

That means the plan is almost ready, but it should not be presented as a full “document integrity” fix unless it either:

1. adds background-image persistence to the plan

or:

2. explicitly gates/disables background-image import until persistence exists

Everything else is secondary to that scope gap.

## What The Updated Plan Gets Right

### 1. The sequencing is correct

The A -> B -> C -> D -> E structure remains the right order.

Why:

- A stops active save-path destruction immediately
- B formalizes ownership after the immediate bug is contained
- C fixes dirty/autosave semantics on top of explicit ownership
- D is important but can be developed independently
- E is consolidation work and belongs last

That dependency structure is sound.

### 2. Phase A is now technically safer

The updated plan correctly changes Phase A to:

- pass `currentDesign.value` into `toCanopi()` as a parameter
- avoid importing state into `serializer.ts`

That removes the likely module cycle and keeps the serializer more reusable.

### 3. Phase C is now semantically stronger

The two-baseline dirty model is a major improvement over the earlier monotonic revision proposal.

It correctly preserves:

- mixed edit-source tracking
- undo-back-to-saved-state behavior

This is the right shape for the current codebase.

### 4. Phase D now treats degraded mode as behavior, not decoration

The plan no longer stops at “show a banner.”

It now includes:

- sidebar empty state
- disabled/hidden search
- frontend short-circuiting for species IPC
- drag-and-drop disablement

That is the right product-level interpretation of degraded mode.

### 5. Phase E now acknowledges bootstrap reality

The updated plan correctly recognizes that settings bootstrap requires:

- moving `initTheme()` and `initShortcuts()` out of module-scope execution
- establishing an explicit bootstrap sequence

That is an important correction.

## Remaining Major Finding

### 1. Background-image persistence is still outside the plan

This is now the main unresolved issue.

Current verified behavior in `desktop/web/src/canvas/import.ts`:

- background image import is a user-facing feature
- imported images are added directly to the canvas as `Konva.Image`
- the code explicitly notes they are not serialized through the command system
- the current `.canopi` path does not preserve them on save/load

This means a user can:

1. import a background image
2. save the design
3. reopen the design
4. lose the imported image

That is a document-integrity problem.

It differs from the current Phase A data-loss set in one important way:

- background images are not just missing from composition
- they are missing from the file schema and runtime serialization strategy entirely

But from the user’s perspective, it is the same class of failure: saved work does not survive save/load.

### Recommendation

The plan must make an explicit product decision before implementation starts.

Two valid options:

1. Include background-image persistence in Phase A or an explicit Phase A.x
   - extend the file format
   - serialize enough image metadata to recreate the node
   - define how file bytes are stored or referenced
   - test round-trip

2. Explicitly gate/disable background-image import until persistence exists
   - remove or disable the import command
   - show clear UI messaging that the feature is not yet persisted

What should not happen:

- shipping or declaring “document integrity fixed” while a current user-facing save-loss case remains outside scope

## Important Clarifications

### 2. Background-image import is canvas state, not non-canvas state

The updated plan still says:

- `import.ts:72` -> `nonCanvasRevision.value++`
- background image is “non-canvas state”

That is incorrect.

Imported background images are:

- canvas content
- visually part of the design workspace
- represented by Konva nodes

They are not non-canvas document state.

### Recommendation

If background-image import remains enabled before persistence is implemented:

- do not classify it as non-canvas dirty

Instead, choose one of these:

1. treat it as canvas-side dirty and include it in persisted canvas state

or:

2. gate the feature so it is not part of persisted workflows yet

The current wording in Phase C should be corrected either way.

### 3. Phase B should still be treated as transitional

The updated plan says `state/document.ts` is the canonical document API. That is good.

But the implementation outline still leaves `state/design.ts` as an internal participant in the composition path.

That is acceptable for now, but it should be understood as transitional.

### Recommendation

The plan should keep the current implementation approach, but make explicit that:

- long term, `state/document.ts` is intended to become the document authority boundary
- `state/design.ts` is not the final public ownership surface

This is a documentation clarity issue, not a blocker.

## Medium Findings

### 4. TS tests are still the primary safeguard for this feature area

The updated plan now installs Vitest and adds TS tests, which is correct.

It is worth preserving the priority rule explicitly:

- Rust tests are helpful
- TS/end-to-end document tests are the primary guardrail here

Why:

- the current destructive bug lived entirely in the TS serializer/composition path
- Rust tests already passed while the app still destroyed data

The plan mostly reflects this already. I would keep emphasizing it during implementation.

### 5. Phase E bootstrap should avoid startup flicker if possible

The plan correctly restructures bootstrap, but there is one implementation nuance worth calling out:

- if settings bootstrap is asynchronous and theme application waits on it, the app may flash the wrong theme on startup

This is not a planning flaw, but it is an implementation detail to watch.

### Recommendation

Prefer one of these:

1. keep a synchronous fallback theme path using existing local defaults or cached preference
2. or hide theme-sensitive rendering until bootstrap completes

This is not a blocker for the plan, but it is worth capturing for execution quality.

## Recommended Changes To The Plan

### Phase A

Keep the current fixes:

- `doc` parameter to `toCanopi()`
- defensive `extra` spread ordering
- `?? null` semantics
- layer `locked` preservation

But add one explicit decision for background images:

1. persist them now

or:

2. gate/disable the feature until persistence exists

### Phase C

Remove the classification of background-image import as non-canvas state.

If the feature remains enabled before persistence exists, it should be called out as a separate unresolved document-integrity issue.

### Phase B

Clarify that:

- `state/document.ts` is intended to become the canonical document API
- `state/design.ts` remains transitional/internal

### Phase E

Keep the bootstrap restructuring, but note the implementation concern around theme flicker and startup ordering.

## Proposed Acceptance Criteria

The plan is ready to implement once these conditions are true:

1. the plan explicitly decides whether background-image import is persisted now or gated off
2. Phase C no longer describes background-image import as non-canvas state
3. `state/document.ts` is explicitly described as the intended long-term document API boundary
4. Phase E bootstrap notes include startup ordering expectations

## Final Assessment

This is now a strong implementation plan.

The sequencing is right. The earlier design issues have been corrected. The remaining risk is not architectural confusion, but leaving one current save-loss case outside scope and then calling the work complete.

Fix that scope issue first, then proceed.
