# Code Review Round 5

Date: 2026-03-25
Repository: `canopi`
Scope: current working tree after the latest startup-theme and dirty-state fixes

Verification performed:

- `cargo test`: passed
- `npm run build` in `desktop/web`: passed
- `npm test` in `desktop/web`: passed (`2` files, `16` tests)

## Findings

No actionable findings in this pass.

The previously reported issues around:

- close/discard re-entry
- cross-platform overwrite behavior
- immediate dirty state after open/new
- settings persistence gaps
- startup theme source-of-truth conflicts
- undo-to-clean semantics

all appear addressed in the current implementation, and the new Rust and frontend test coverage exercises the main regression paths.

## Residual Risk

- The document lifecycle is now materially safer, but the highest remaining risk is still around untested integration boundaries rather than obvious code defects: real Tauri window lifecycle behavior, OS-specific filesystem locking behavior, and multi-step UI flows that are only partially modeled by unit tests.
- The `pendingDesignPath` load path still exists but appears unreachable from the current frontend. That is not a live bug today, but it is dead/latent code worth either wiring up properly or removing to keep the document flow easier to reason about.

## Notes

What looks solid in this round:

- `atomic_replace()` has targeted unit coverage, including stale-sidecar handling.
- The checkpoint-based canvas dirty model now supports undo-to-clean and cap safety.
- The frontend test harness is runnable and growing in the right areas.

Recommended next step:

- If you want to keep pushing quality, the next highest-value work is an end-to-end smoke test layer for the Tauri app lifecycle rather than more local refactoring.
