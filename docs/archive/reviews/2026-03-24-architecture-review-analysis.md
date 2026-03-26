# Architecture Review Analysis

Date: 2026-03-24

Reviewer: Claude Opus 4.6

Subject: Analysis of Codex architecture review (`2026-03-24-architecture-review.md`, fifth revision)

## Status

The review has converged. After four revision cycles with deep codebase verification, the review now accurately identifies every verified data loss vector, correctly prioritizes the work, and provides an actionable implementation plan. This analysis confirms that and adds effort estimates and a small number of remaining notes.

The goal of this document is no longer to find gaps. It is to confirm the review is ready to act on and provide implementation context that supports Phase A.

## Verification Summary

Every factual claim in the review was verified across seven codebase investigations spanning four review cycles. All claims are accurate.

### Data loss inventory — complete and correct

The review's three-category classification matches verified behavior exactly:

**Category 1 (user-facing destruction):** timeline, budget, consortiums — hardcoded to `[]` in `serializer.ts:101-103`. Users can edit these today. They are lost on every save and autosave.

**Category 2 (file-integrity loss):** created_at (regenerated at `serializer.ts:104`), description and location (accepted by `toCanopi()` metadata param but never passed by any call site), extra fields (TS type has no `extra` field).

**Category 3 (schema fields):** PlacedPlant notes/planted_date/quantity (hardcoded null in `engine.ts:1019-1021`), Zone notes (hardcoded null in `serializer.ts:67`), Layer locked (hardcoded false at `serializer.ts:79`).

**Finding #13 (plant identity):** Confirmed — `crypto.randomUUID()` at `serializer.ts:130` on every load. Correctly documented as a design limitation, not a data loss bug.

No additional data loss vectors were found in this round. The inventory is complete.

### Structural findings — all confirmed

| Finding | Accurate? | Notes |
|---------|-----------|-------|
| Document ownership split | Yes | `currentDesign` signal + `CanvasEngine` with no explicit composition contract |
| Dirty flag bug (mixed edit sources) | Yes | `history.ts:57` clears dirty based on `_past.length` alone |
| Autosave shares all composition bugs | Yes | Same `toCanopi()` path, fire-and-forget invocation |
| Forward-compatibility broken through TS | Yes | Rust `extra` field not modeled in TS, not carried by serializer |
| Plant DB silent degraded startup | Yes | `lib.rs:58-103`, in-memory fallback with no FTS5 tables |
| Settings not bootstrapped | Yes | Zero calls to `get_settings` from frontend |
| History is snapshot-based, canvas-only | Yes | Full node state serialized; 500 command max |
| Shared contracts manually duplicated | Yes | `species.ts` and `design.ts` with "keep in sync" comments |

### Implementation plan — correctly ordered and feasible

Phase dependencies are correct:

- A (stop data loss) → no prerequisites, unblocks everything
- B (document ownership) → builds on A, prevents regression
- C (dirty/autosave) → requires B's ownership model
- D (startup degradation) → independent of A-C but correctly lower priority
- E (consolidation) → open-ended, depends on toolchain maturity

## What the Review Gets Right

The review is now a strong operational document. The specific things that matter most:

1. **Leads with the right problem.** The executive summary names active data destruction, not architectural theory. This is what a reader needs to know first.

2. **Three-category data loss classification.** Distinguishing "user can lose their work today" from "file contract is broken" from "schema fields not preserved" communicates urgency precisely without conflating everything into one alarm.

3. **Feasibility section for Phase A.** The review correctly identifies: zero Rust changes, no IPC changes, three call sites, and the Konva custom-attr precedent for per-object fields. This tells an implementer that Phase A is a targeted fix, not a refactoring project.

4. **The `north_bearing_deg` precedent.** Finding #5 now notes that the serializer already has a working fallback pattern (`metadata.northBearingDeg ?? northBearingDeg.value`). Description and location lack that fallback. This is a useful implementation hint — the fix can follow the same pattern.

5. **Coding invariants are enforceable.** The invariants section is specific enough to add to CLAUDE.md as project rules. They would catch the exact class of bug that caused the current data loss.

6. **Plant identity documented without overreacting.** Finding #13 correctly identifies the limitation without inflating it into a blocker. The recommendation (add `id` to `PlacedPlant` when needed, store as Konva custom attr) is proportionate.

## Remaining Notes

These are minor items. None change the implementation order or priority ranking.

### Zone IDs are stable; plant IDs are not

Zone names round-trip correctly (`zone.name` ↔ Konva `node.id()`). Plant nodes get fresh UUIDs on every load. The review documents the plant case in Finding #13 but does not mention that zones are stable. This asymmetry is worth noting for implementers: zone identity can be relied on for future references (e.g., linking plants to zones), but plant identity cannot.

### `lockedObjectIds` signal is separate from `Layer.locked`

The `Layer.locked` field in the file schema (whole-layer lock) is not the same as `lockedObjectIds` signal in `canvas.ts:28` (per-object lock). The review correctly identifies that `Layer.locked` is always saved as `false`. It does not discuss `lockedObjectIds`, but that is a runtime-only signal not persisted to the file, so there is no data loss there.

### The `description`/`location` fix has two valid paths

The review (Finding #5, lines 574-579) presents both options: pass from `currentDesign` at call sites, or add a serializer fallback. Either works. For consistency with the `north_bearing_deg` pattern already in the serializer, the fallback approach may be slightly cleaner — it means callers don't need to know about every metadata field.

### Coding invariants could be adopted into CLAUDE.md

The invariants in the review's final section are specific enough to function as project rules. After Phase A is complete, these should be added to `CLAUDE.md` under a "Document Lifecycle" section so they are enforced in every future session.

## Effort Estimates

All phases are Claude Code tasks. No manual developer hours.

| Phase | Scope | Effort | Rust Changes |
|-------|-------|--------|--------------|
| A: Stop destructive saves | `serializer.ts` + 3 call sites + Konva custom attrs for per-object fields | Single prompt | None |
| B: Document state module | New `state/document.ts`, update 10 import sites | Single prompt | None |
| C: Dirty tracking | Replace boolean dirty with document-scoped model, ~13 write sites | Single prompt | None |
| D: Startup degradation | Health state struct in Rust, IPC exposure, frontend banner | 1-2 prompts | Yes |
| E: Settings + tests + contracts | Bootstrap settings, expand test suite, codegen when ready | 2-3 prompts | Minimal |

Total: ~6-8 prompts in a single focused session.

## Conclusion

The review is ready to act on. The data loss inventory is complete, the priorities are correct, the implementation plan is feasible, and the coding invariants are enforceable.

The next step is Phase A.
