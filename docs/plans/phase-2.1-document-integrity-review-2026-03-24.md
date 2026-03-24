# Review — Phase 2.1 Document Integrity Plan

Date: 2026-03-24

Reviewer: Codex

Subject: Review of `docs/plans/phase-2.1-document-integrity.md`

## Executive Summary

The Phase 2.1 plan is directionally strong. It correctly centers the work on document integrity, stages the effort sensibly, and keeps the first phase narrowly focused on stopping active data loss.

The plan should proceed, but not exactly as written.

There are two important issues that should be fixed in the plan before implementation:

1. Phase A introduces a likely module cycle by importing `currentDesign` into `serializer.ts` while `state/design.ts` already imports `serializer.ts`.
2. Phase C’s revision-based dirty model is semantically wrong for undo-to-saved-state behavior. As written, undoing back to the saved state would still leave the document dirty.

There are also a few medium-importance gaps:

1. the `extra`-field merge strategy should avoid letting unknown keys override canonical keys
2. per-object field preservation should use `null`/`undefined` semantics, not `0`/empty-string sentinels with `||`
3. Phase D should include explicit feature gating for degraded plant DB mode, not just a banner
4. Phase E’s settings bootstrap sequence is incompatible with the current module-scope `initTheme()` / `initShortcuts()` setup
5. Vitest is not currently in `desktop/web/package.json`, so the testing phase needs an explicit dependency step

With those corrections, the plan becomes a strong implementation document.

## What The Plan Gets Right

### 1. The sequencing is mostly correct

The A -> B -> C -> D -> E structure is the right order.

Why:

- A stops active destructive saves immediately
- B establishes ownership after the fire is out
- C builds on B’s ownership model
- D is important but independent of document integrity
- E is consolidation work and belongs last

That overall flow matches the actual dependency graph.

### 2. Phase A is appropriately narrow

The plan correctly treats the first phase as:

- frontend only
- zero Rust changes
- minimal surface area
- focused on serializer/composition and three save call sites

That is exactly the right posture. The current bug is too severe to hide inside a broader refactor.

### 3. The plan correctly includes per-object and layer schema fields

It is good that the plan includes:

- plant notes
- plant planted date
- plant quantity
- zone notes
- layer locked state

This avoids “fixing only the user-visible losses” while leaving the same bug class in place for future-version files.

### 4. The plan uses an implementation path that fits the existing code

Using Konva custom attrs for non-visual per-object fields is a good fit because:

- plant nodes already use custom attrs
- Konva supports this cleanly
- history serialization already captures attrs
- it avoids a larger side-map or projection refactor in Phase A

That is the right tactical move.

## Major Findings

### 1. Phase A likely introduces a module cycle

This is the most important plan issue.

The plan proposes:

- `state/design.ts` continues importing `toCanopi()` / `fromCanopi()` from `canvas/serializer.ts`
- `canvas/serializer.ts` imports `currentDesign` from `state/design.ts`

That creates a bidirectional dependency.

Current direction:

- `state/design.ts` -> `canvas/serializer.ts`

Planned direction:

- `canvas/serializer.ts` -> `state/design.ts`

That is a classic module cycle and should be avoided even if the bundler tolerates it, because:

- evaluation order becomes fragile
- HMR behavior gets harder to reason about
- it weakens the ownership boundary the plan is trying to clarify

### Recommendation

Do not import `currentDesign` directly into `serializer.ts` in Phase A.

Safer alternatives:

1. Change `toCanopi()` to accept the current canonical document explicitly:
   - `toCanopi(engine, metadata, doc)`
   - save/autosave callers pass `currentDesign.value`

2. Pull the composition boundary forward:
   - introduce a minimal `state/document.ts` in Phase A, not Phase B
   - let `document.ts` own the call to `toCanopi()`
   - keep `serializer.ts` free of state-store imports

My recommendation is option 1 for Phase A because it is the smallest change.

Then Phase B can still introduce `state/document.ts` as the formal boundary.

### 2. Phase C’s revision model is semantically wrong

The plan proposes:

- `documentRevision` monotonic counter
- `lastSavedRevision`
- `designDirty = documentRevision !== lastSavedRevision`
- undo increments `documentRevision`

That model does not preserve the expected “undo back to saved state means clean” behavior.

Example:

1. save document -> `documentRevision = 5`, `lastSavedRevision = 5`
2. make canvas edit -> `documentRevision = 6`, dirty = true
3. undo edit back to saved state -> `documentRevision = 7`, dirty still true

But the document content is back at the saved baseline.

The plan text says “Undo is a document change relative to last save,” which is technically true in an event log sense, but it is not the right user-facing save semantic.

The user expectation is:

- if the document matches the last saved state, it is clean

### Recommendation

Do not use a purely monotonic revision counter as the sole dirty model.

Better options:

1. Split canvas and non-canvas baselines
   - canvas side: history tracks a saved marker or saved stack position
   - non-canvas side: own revision counter + saved revision
   - dirty if either side differs from its saved baseline

2. Use a document snapshot/hash baseline
   - more expensive
   - probably unnecessary right now

The most practical option for this codebase is option 1.

Concretely:

- `CanvasHistory` should remember a saved checkpoint marker
- non-canvas edits should increment a separate revision counter
- save should update both baselines
- dirty should be computed as:
  - `canvasDirty || nonCanvasDirty`

That fixes the mixed-source bug without breaking undo-to-clean behavior.

### 3. The `extra` merge should be defensive

The plan suggests:

```ts
...(doc?.extra ?? {})
```

spread into the returned `CanopiFile`.

That is directionally right, but the placement matters.

If unknown fields are spread after canonical fields, they can override known keys if:

- `extractExtra()` misclassifies a key
- a malformed file includes a conflicting key

### Recommendation

Either:

1. spread `extra` first, then write canonical keys after it

or:

2. guarantee collision filtering before merge and document that invariant explicitly

Option 1 is safer and simpler.

### 4. Per-object attr storage should avoid sentinel values

The plan currently proposes:

- `notes ?? ''`
- `plantedDate ?? ''`
- `quantity ?? 0`

and then reading back with `|| null`.

That works for some cases, but it is semantically weak:

- `0` is a legitimate numeric value in some schemas, even if uncommon here
- `|| null` collapses multiple falsy states together
- the serializer should preserve exact optional semantics where possible

### Recommendation

Prefer:

- store `null`/`undefined` semantics faithfully in custom attrs
- read back with `?? null`, not `|| null`, when the distinction matters

Examples:

```ts
group.setAttr('data-quantity', opts.quantity ?? null)
quantity: group.getAttr('data-quantity') ?? null
```

This is cleaner and avoids unnecessary sentinel logic.

### 5. Phase D should include degraded-mode behavior, not just visibility

The plan’s startup health work is good, but the frontend piece is incomplete if it stops at:

- querying health
- showing a banner

That is not enough for a degraded plant DB state.

The review correctly established that the fallback DB can lead to actual query errors, not just empty states.

### Recommendation

Phase D should explicitly include:

- disabling or gating plant DB actions when status is not `Available`
- making search failure graceful and expected in degraded mode
- preventing the UI from pretending plant search is available when it is not

Examples:

- disable search input
- show plant DB unavailable empty state
- block or short-circuit species IPC calls when health is degraded

The banner should be one part of the degraded-mode UX, not the whole thing.

## Medium Findings

### 6. Phase B’s ownership module should become real authority, not a re-export shim

The plan says `state/document.ts` will:

- re-export fields from `state/design.ts`
- provide composition helpers

That is acceptable as a transition, but if the goal is explicit ownership, it should not stop there for long.

### Recommendation

Phase B should state more clearly:

- `state/document.ts` is the canonical document API
- `state/design.ts` becomes either:
  - a compatibility wrapper
  - or is merged away later

Otherwise the ownership story remains conceptually split even if the import graph improves.

### 7. Phase E settings bootstrap conflicts with current module-scope initialization

The plan says:

- call `bootstrapSettings()` in `app.tsx` before `initTheme()`

But currently `app.tsx` calls:

- `initTheme()` at module scope
- `initShortcuts()` at module scope

That means there is no “before `initTheme()`” at runtime without restructuring module initialization.

### Recommendation

Phase E should explicitly include:

- moving theme/shortcut/bootstrap initialization out of module top-level execution
- creating an app bootstrap sequence

Without that, the settings bootstrap step is underspecified.

### 8. Vitest is not currently installed

The plan adds a Vitest suite, but `desktop/web/package.json` currently does not include:

- `vitest`

or related test scripts.

### Recommendation

Phase E should explicitly include:

- adding test dependencies
- adding a test script to `package.json`

and should use `/canopi-test` conventions when that work starts.

### 9. Rust tests in Phase E should not be treated as sufficient for document integrity

Expanding Rust tests in `design/format.rs` is fine, but it will not catch the class of bugs that caused the current problem.

Why:

- current destructive behavior lives in the TS serializer/composition path
- Rust-only round-trip tests already passed while the app still destroyed data

### Recommendation

Phase E should treat TS or end-to-end document tests as the primary safeguard for this feature area.

Rust tests are supplementary here, not primary.

## Recommended Changes To The Plan

### Phase A

Change A.8 from:

- import `currentDesign` inside `serializer.ts`

To:

- pass `currentDesign.value` explicitly into `toCanopi()` as a parameter

or:

- move a minimal `document.ts` composition helper into Phase A

Also:

- spread `extra` before canonical keys
- use `null`/`??` semantics for custom attrs instead of `0`/`''` plus `||`

### Phase B

Clarify that:

- `state/document.ts` is intended to become the canonical document API
- re-exporting from `design.ts` is transitional, not the end state

### Phase C

Replace the monotonic single revision plan with a two-baseline model:

- canvas saved checkpoint marker
- non-canvas revision + saved revision
- `designDirty = canvasDirty || nonCanvasDirty`

This preserves undo-to-saved-state semantics and still fixes the mixed-source bug.

### Phase D

Add explicit degraded-mode behavior:

- gate plant DB UI/actions
- define graceful search behavior when degraded

### Phase E

Add:

- bootstrap restructuring for theme/shortcuts/settings
- explicit test dependency additions

## Proposed Acceptance Criteria

The plan is ready to implement once these conditions are true:

1. Phase A no longer introduces a serializer/state cycle.
2. Phase C dirty semantics allow undo back to the saved baseline to become clean.
3. Phase D includes degraded-mode feature gating, not just a banner.
4. Phase E includes the bootstrap restructuring needed for settings load order.

## Final Assessment

This is a strong implementation plan. It is close to ready as written, and the execution order is correct.

The important thing is not to let a good roadmap smuggle in two avoidable regressions:

- a module cycle in Phase A
- a broken dirty model in Phase C

Fix those in the plan first, then proceed.
