# Codex Review: `todo.md`

## Findings

### 1. High: the document is now self-contradictory about the target canvas architecture

References:
- `docs/todo.md:81-99`
- `docs/todo.md:918-931`
- `docs/todo.md:1033-1039`

Section 2.4 still says the canvas split is not clean without `desktop/web/src/canvas/runtime/render-pipeline.ts`, and assigns long-term rendering ownership to that file. But the new renderer section later says the target architecture is to replace `render-pipeline.ts` with `RenderReconciler`, and the carry-forward rules explicitly tell implementers to route all visual updates through `reconciler.invalidate(...)`.

Those two statements cannot both be canonical. In a document that calls itself the single source of truth, this leaves the reader unclear on whether:

- `render-pipeline.ts` is the intended stable end-state, or
- `render-pipeline.ts` is only an intermediate seam that will be retired.

Recommendation:
- Rewrite section 2.4 so it describes the stable requirement as a dedicated rendering owner, not specifically `render-pipeline.ts`.
- Make `render-pipeline.ts` explicit as a landed intermediate seam, with `RenderReconciler` as the planned successor.

### 2. Medium: the `document-actions.ts` facade-bypass fix prescribes an ambiguous seam and can easily turn into the wrong API shape

References:
- `docs/todo.md:890-893`
- `desktop/web/src/state/document-actions.ts:260-272`
- `desktop/web/src/canvas/engine.ts:690-693`

The review calls out `state/document-actions.ts` importing `resetTransientCanvasSession` directly from `runtime/document-session` and says this "should be exposed through `engine.loadDocument()`". That is directionally reasonable, but underspecified in a risky way.

Current code shows:

- `applyDocumentReplacement()` explicitly does `resetTransientCanvasSession()` and then `engine.loadDocument(file)`.
- `engine.loadDocument()` currently means "reset viewport + materialize document".

If the rewrite literally folds transient session reset into `engine.loadDocument()`, that broadens the meaning of a generic engine method and may affect other callers that only want scene materialization semantics. The document should define the actual ownership boundary instead of naming one existing method as the fix.

Recommendation:
- Specify the desired facade precisely, for example:
  - add an explicit engine/session method for full document replacement, or
  - state that `engine.loadDocument()` is being redefined to include transient session reset and list every caller that relies on that.
- Do not leave this as "move it into `loadDocument()`" without defining the contract.

### 3. Medium: the new cross-wave blocker uses the term "stable" without defining a rewrite-level exit gate

References:
- `docs/todo.md:622-638`
- `docs/todo.md:933`
- `docs/todo.md:947-951`
- `docs/todo.md:1050-1056`

The rewrite now blocks Wave 4 on "renderer refactor phases 1-3 are stable", and also blocks several product-level visual changes on the same condition. But `todo.md` does not define what counts as "stable" at the rewrite-program level.

It points to `docs/renderer/renderer.md` for the phase protocol, which is useful, but this file is supposed to be the canonical rewrite execution reference. For a cross-wave blocker, the gate should be summarized here as well.

Without that, teams can reasonably disagree on whether "stable" means:

- phases 1-3 merged,
- tests passing,
- tests plus manual checks,
- tests plus live verification,
- or some soak period after landing.

Recommendation:
- Add a short renderer-blocker exit criterion here, for example:
  - phase 1-3 automated tests green,
  - manual validation checklist passed,
  - Wave 3 live verification rerun against the reconciler build,
  - no open high-severity renderer regressions.

## Recommendation

The new renderer/blocker material is directionally better than the previous version, but `todo.md` still needs one cleanup pass before it is actually canonical:

1. Remove the stale "render-pipeline is the required end-state" language.
2. Define the document-replacement facade fix precisely instead of pointing loosely at `engine.loadDocument()`.
3. Add a rewrite-level definition of when renderer phases 1-3 are considered stable enough to unblock Wave 4.

## Residual Risk

If left as-is, the main risk is not that implementation becomes impossible. The risk is that different people will read different architectural targets from the same document and make locally reasonable but incompatible changes.
