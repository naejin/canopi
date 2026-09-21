# Finish transformed pagination and publication settlement

Status: proposed — sole current continuation, executable when forwarded by the user; replaces the delivered BG6–BG8 instructions retained at `b34de62d`.
Tracking: `canopi-jv8a.4`, parent `canopi-jv8a`; keep open for independent disposition.
Current guidance: [review](bounded-generation-review.md), [design](bounded-generation-design.md), [LiDAR](../../agent/lidar.md), [courier protocol](collaboration-protocol.md), [delivery](../../workflow/delivery.md).

## Mandate, baseline and autonomy

Continue **`feature/bounded-raster-generations` from `eb64a853`**. Preserve the accepted predecessor `a5fc7d7b`, BG1–BG5 improvements, job-local source COGs, fixed Before/After values, and the BG8 incomplete-evidence repair. This assignment closes four findings: BG6-A and BG7-A/B/C below. Do not restart the architecture or qualification tooling. User outcome: accurate review of separated/aligned numeric inputs and reliable publication/recovery behind the existing UI.

First inspect Git status and `bd show canopi-jv8a.4`, claim/update the existing bead, and incorporate this documentation commit into the existing implementation branch. Preserve its newer source inventories and receipt when resolving overlaps. The primary checkout's `desktop/src/native_operation.rs` edit and `.beads.gate.lock` are not yours. Do not discard the accepted stack or stash unrelated work to satisfy branch hygiene; report a genuine baseline conflict.

The main agent has settled behavior and ownership here. You own local implementation, focused test organization, in-scope failures and documentation reconciliation. Use applicable TDD/craft skills; codebase-design is vocabulary for the settled interfaces, not a new design exercise. One authorization spans execution windows: checkpoint the exact remaining boundary in bd and resume without another courier approval. Finish all four findings before one consolidated handoff. Stop only for a demonstrated material contract conflict, destructive migration, missing authority or unavailable prerequisite that truly prevents independent work. No subagents, dependency/engine changes, scientific changes, new Python tooling, Q work, generic framework, UI redesign, capacity-limit increase, integration or release.

## BG6-A — globally ordered transformed coverage

The current `BlockStream::Regions` sorts each expanded page, then discards coordinates not above the prior page's maximum. This loses valid coordinates: page order in source coordinates is not page order after one source block expands into multiple layer blocks. Making the discard conditional or buffering one arbitrary extra page is not a proof of global ordering.

**Settled implementation shape:** adapt the existing keyset region query and `ReviewTraversal` merge. For each source, decompose its source-to-layer cell offset using Euclidean division by 1024: quotient `(qx,qy)` and non-negative remainders. Represent expansion as up to four monotone translated streams: `(block_y + qy + dy, block_x + qx + dx)`, where each of `dx`/`dy` is `{0}` for a zero remainder, otherwise `{0,1}`. Each stream owns a bounded keyset cursor/page over the same source index; a constant translation preserves its source ordering. Merge these streams with the head's existing ordered stream, then deduplicate equal coordinates globally. At most four pages per admitted source is an acceptable bounded cost. Reuse schema-v13 ordering/index; no new persistence format or global coordinate set is needed.

Clip actual reads to the source/head extents and keep existing validity/composition/count rules. Coarse occupied-block overcoverage may yield empty reads but cannot omit real coverage or walk the joined envelope. An empty filtered page is not EOF unless the underlying stream is exhausted. Use checked signed arithmetic. Preserve negative offsets, cancellation between reads/pages, fixed layer anchor, 1024-cell windows and target-sized previews. Do not alter display interpolation or review reduction policy.

First prove the arithmetic counterexample through the **real iterator**, with independently authored expected coordinates: 257 source regions `(x=0..256,y=0)`, offset `(0,1)`, page size 256 must yield all 514 expanded coordinates once, including `(0,256)`. Offset zero is the passing control; exercise both-axis and negative non-aligned offsets, page boundaries splitting a row, and duplicates across streams. Counts alone do not suffice—assert membership/order/no duplicates.

Then exercise actual staging/review/decision-preview with a real controlled source wider than one index page: for example 263,168×1 finite cells placed one cell below an existing layer anchor. All incoming cells, especially the last 1024, must appear in review classification; expected values/counts come from the authored raster, not the iterator under test. Keep the fixture inside production admission. Retain the million-gap, Before=5/After=9, overlap-once, replace-overlap and cancellation tests. Do not substitute invented distant region rows without corresponding raster data as the sole caller proof.

## BG7-A/B/C — one owner through promotion, commit and cleanup

Reuse the existing `PromotionGuard`, job-owned journal, short catalogue transaction and heavy-job lease. Do not introduce a global asset-claim registry or general orphan collector. Implement these as one cohesive lifecycle change across `import.rs`, `mod.rs` and the relevant catalogue ownership query.

### BG7-A: ownership starts before the first side effect

Construct the rollback owner **before** invoking `promote_source_cogs`; either the owner performs promotion or an owning factory constructs its guard first and only then performs fallible initialization. Every failure after the first intent/link—including an error during the second source, validation failure and cancellation—must reach rollback. A guard created from `promote_source_cogs(...) ?` is too late.

Keep intent durable before publication, no-replace linking, and job-local files available while the job remains retryable/AwaitReview. Distinguish newly created destinations from reused ones; `AlreadyExists` cannot silently confer ownership. Under the existing exclusive publisher, verify reused bytes against the declared digest/size/profile rather than treating layout readability as identity. Cleanup may remove only inventoried, newly owned promotions with no committed owner. Check committed source **and generation/result chunk references**, not only `lidar_interpretation_cogs`; never remove accepted history or analysis bytes. Unknown ownership fails closed. Do not infer ownership of old orphan assets.

### BG7-B: cleanup failure preserves retry evidence through the outer caller

One job cleanup decision governs journal reconciliation and directory removal. Startup and settlement must not call unconditional `remove_dir_all(job_dir)` after recovery has failed. Retain the unresolved journal and required job-owned data, report the error, and retry on the next normal recovery attempt; no retry loop or background recovery service.

At startup, reconcile before allowing new heavy jobs. **If reconciliation is unresolved, fail library opening with a named recoverable error and leave the unresolved root intact.** This deliberately favors recoverability over availability of this local raster library; do not affect unrelated document state. Once the underlying fault is removed, reopening completes cleanup and normal operation resumes. Successfully settled roots may be removed. AwaitReview roots stay intact. Preserve old staged metadata's non-owning global references and raw/mask compatibility.

Journal clearing is fallible too: never report cleanup complete after ignoring an unlink/sync error. Propagate supported-platform durability errors from journal publication; do not silently swallow them and claim durable intent. Use existing platform policy for unsupported directory syncing and name its limitation. Keep cleanup idempotent and path ownership checked; no broad asset-directory sweep.

### BG7-C: committed publication is irreversible success

The successful head transaction is the linearization point. Mark the owner committed immediately afterward, before any fallible journal cleanup. A later cleanup error returns a **successful published `ApplyOutcome`** with diagnostic warning through existing message/log facilities, preserves retry evidence, and does not enter the failed/cancelled settlement branch. `finish_apply` must retain complete state and execute the existing dependent-refresh path for the committed layer. Reconciliation must not publish again or enqueue a second publication.

Before-commit errors still mean failed/cancelled publication with the old head unchanged. Check both sparse and preserved dense Apply exits; do not leave one relying on guard-drop behavior after commit. Treat cleanup diagnostics separately from the publication result without adding a second public job-state model or changing IPC. Revise the existing test expecting an error after `AfterCommitBeforeCleanup`: that expectation contradicts the accepted commit boundary, and its replacement must verify more, not less.

### Decisive lifecycle evidence

Use narrow existing fault seams through **Apply plus real settlement**, and through **`LidarLibrary::open`**, not only helper calls. Add focused failing cases before repairing each behavior; keep healthy controls.

| Event | Required observable outcome |
| --- | --- |
| Failure at `AfterPromotion`; cancellation/error during a later source | Newly owned global destinations removed or retained with explicit cleanup-error evidence; no new head/reference; shared committed asset and original bytes unchanged |
| Cleanup failure on a failed/interrupted job, followed by real reopen | Reopen reports recoverable failure; journal/root still exists. Remove fault, reopen twice: cleanup succeeds idempotently; accepted assets and AwaitReview jobs remain usable |
| Failure clearing journal after successful transaction, then real `finish_apply` | Accepted head/readable values remain, job stays complete, successful dependent-refresh path runs, warning/evidence survives; no duplicate generation on reopen |
| Reused destination or a committed generation/result reference | Rollback/recovery never deletes it; mismatching digest/size is rejected rather than reused as the declared source |

Also retain intent-before-link, link-before-commit, commit-before-cleanup, stale-head, no-change, replacement/undo and two AwaitReview jobs sharing content cases. Test cleanup failure using a deterministic private I/O fault or an owned unremovable target; permission-only fixtures can be ineffective under elevated users. Do not simulate process termination solely by returning an error after commit and bypassing settlement.

## Completion, gates and courier handoff

Implement BG6-A first, then BG7-A/B/C together. Perform one bounded composed-path self-review from source/index to review, promotion, transaction, settlement and startup. Fix same-family faults discovered there without another routine approval; unrelated work becomes a follow-up bead. No mandatory mutation/transcript counts. Preserve BG8 tests and current limits. The 400M/platform limitations remain separate and need not be rerun merely to close these correctness fixes.

Required checks follow AGENTS: focused regressions, all applicable ignored GDAL tests, Rust fmt/strict Clippy/check/workspace tests and native policy guard; frontend/binding checks where the changed persistence/shared surfaces require them. The independently verified focused route is:

```sh
CARGO_HOME=/home/daylon/projects/canopi/.rq-scratch/cargo-home CANOPI_SKIP_BUNDLED_DB=1 cargo test --offline -p canopi-desktop --lib services::lidar -- --include-ignored --skip services::lidar::e2e --test-threads=1
```

It excludes private e2e evidence. Rerun available serial MNT/MNH lifecycle cases on the final tree with explicit fixture identities; do not substitute missing fixtures or claim an unavailable platform. Existing corrected memory instrumentation is sufficient—do not repair or extend it without a demonstrated in-scope regression. Run `python3 scripts/check_docs.py` and `git diff --check`. Record unavailable commands and residual risk; test totals are not an acceptance verdict.

Update the existing implementation branch's `bounded-generation-receipt.md` with one BG6-A/BG7-A/B/C response table and caller-level evidence. Reconcile stale lifecycle claims in the LiDAR guide, design status, review/index and debrief. Preserve source inventories when incorporating this planning checkout's docs. Retire this prompt after delivery, linking the receipt; old instructions remain in Git, not another active prompt. Keep bd as the only execution tracker.

In the debrief, record which earlier helper tests stopped before the failing outer caller, which new tests close those exact gaps, defects caught internally versus independent escapes, and whether any courier exchange required a real decision. The main agent owns the missing cross-page example and insufficiently explicit settlement/recovery endpoints in the prior handoff; implementation deviations remain separately recorded. Measure effort only when actually observed. No upstream skill edit or new workflow framework is authorized.

Commit/push the existing branch and sync/export bd under repository policy; preserve user work and required ancestors. Return one consolidated delivery through the user with revision, receipt, decisive cases, gates and remaining limitations. Keep `canopi-jv8a.4` open and stop for independent review. Nothing authorizes main integration, release, capacity removal or later UI work.
