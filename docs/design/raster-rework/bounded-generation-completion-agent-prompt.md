# Product closure: two repairs, truthful evidence, real Desktop workflow

Status: proposed — sole current assignment, executable when forwarded by the user; architecture and scope frozen. Earlier instructions are retained in Git at `fcc6edbd`.
Tracking: `canopi-jv8a.4`, parent `canopi-jv8a`; keep open for independent disposition.
Current guidance: [review](bounded-generation-review.md), [design](bounded-generation-design.md), [courier protocol](collaboration-protocol.md), [LiDAR](../../agent/lidar.md), [edition setup](../../agent/edition-development.md), [delivery](../../workflow/delivery.md).

## Outcome and authority

Continue **`feature/bounded-raster-generations` from `6a5130b3`**, preserving its accepted predecessors and delivered fixes. The next milestone is the existing workflow working reliably in the real app: import into new/existing layers, review overlap, display, slope, restart and undo. Do not redesign storage, pagination, jobs, UI or the measurement tools. Preserve COG persistence, bounded reads, immutable history, scientific rules, current limits and BG8. No Q work, new engine/dependency, general GC, Python migration, new harness, new workbench UI, integration or release.

First inspect Git status and `bd show canopi-jv8a.4`, claim/update the existing bead, and incorporate this documentation commit while preserving the branch's newer source inventories and receipt. The primary checkout's `desktop/src/native_operation.rs` edit and `.beads.gate.lock` are not yours. Do not reset accepted commits or stash unrelated work. Follow repository baseline/rebase rules without losing the required feature stack; report a genuine conflict.

The main agent owns architecture and the final diff-focused review; you own implementation, focused tests and the Desktop verification below. Use applicable TDD/craft skills proportionally. Complete all internal steps across execution windows under this authorization; checkpoints in bd are not new approval requests. One consolidated delivery through the user, who remains courier and acceptance authority. No subagents or mandatory mutation/transcript counts.

## 1. Repair the two known edges

**C1 — collision is not ownership.** In `import.rs::promote_source_cogs`, intent is journalled before `hard_link`; the `AlreadyExists` branch currently leaves that intent eligible for deletion. Adapt the existing owner/journal, not a new registry. A collision must remain non-owned through immediate rollback **and restart**, even if the competing file has no committed catalogue reference yet. Abort the conflicting attempt with a named error; do not overwrite or automatically retry. Previously created assets from this job still roll back.

An intent alone is not deletion proof. Preserve the job-local source as the ownership witness for its hard-linked destination; record or resolve that location from existing job metadata and require positive file-identity evidence before deleting an uncommitted destination. Content-hash equality alone cannot distinguish a separately created matching file. On a collision, relinquish deletion ownership before further fallible work; a crash or failed journal update must not turn ambiguity into permission to delete. If ownership cannot be established, preserve the file and report recoverable uncertainty using the existing cleanup path. Use existing platform primitives and conservative unsupported-platform handling, not a new dependency or storage service. Preserve old journals non-destructively when their ownership cannot be proven.

Focused regression: a private fault point creates the competing destination between the existence check and link. The link reports `AlreadyExists`; rollback and reopening preserve that file byte-for-byte, remove only proven job-owned promotions, and leave the accepted head unchanged. Keep a normal new-link control, a pre-existing shared-asset control, and an interrupted-intent case. Simulate the timing deterministically rather than racing threads repeatedly.

**C2 — journal clearing can fail.** `rollback_promotions` and `reconcile_promotion_journals` still discard journal-removal errors. Route clearing through one small fallible helper: absent journal is idempotent success; another unlink error is reported, not success. Apply the existing supported-platform directory durability policy without swallowing its errors. Preserve the existing distinctions: unresolved pre-commit cleanup retains retry evidence and blocks destructive root cleanup; cleanup after a committed head remains published success with a diagnostic. Do not introduce new job states or retry services.

Focused regression: force journal unlink failure through actual rollback/reconciliation and `LidarLibrary::open`; assert the named error, retained root/evidence and unchanged accepted files. Remove the fault and reopen successfully twice. Retain the post-commit success behavior. Use deterministic I/O injection where permissions would be ineffective under elevated users.

## 2. Close the evidence gaps, not an exhaustive test campaign

Retain the passing real-iterator ordering regression. Correct the wide caller fixture so valid authored samples exist on the page whose loss must be detected; verify their exact count/value. A final all-NoData block cannot prove visitation by its absence from the incoming count. Do not change pagination again without a failing production-path case.

Add the two lifecycle tests claimed but absent at `6a5130b3`: enable `AfterPromotion` during a multi-source Apply and verify cleanup; drive a successful post-commit cleanup-failure result through the real `finish_apply`, checking complete state and the existing dependent-refresh outcome. These can extend existing tests; no new test framework. Healthy controls and independent expected outcomes suffice.

Reconcile `bounded-generation-receipt.md` from actual test functions and command output. Delete or qualify unsupported assertions, including the old final-page arithmetic claim. Name the exact committed test for each claim. A source inspection is not a run, a helper run is not the complete caller, and a native test is not a WebView smoke. Do not claim that a test observed RED unless it actually did. No receipt-generation tooling is requested.

## 3. Exercise the actual Desktop app

After the focused repairs pass, proceed directly to this smoke; no intermediate reviewer round. Read the edition setup guide and use the production Desktop host (`cargo tauri dev` from the implementation worktree, or an existing build of that exact revision), not the UI gallery or old qualification host. Use a fresh disposable app-data profile and Design. On Linux set fresh `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_CACHE_HOME` under an exclusively created temporary root; a separate Cargo target does not isolate user data. Never use the user's saved Design/library or replace their profile. Reuse available GDAL/fixtures; do not install system packages or build a new automation harness to unblock the smoke.

Use manageable, aligned numeric inputs within retained production limits: an available identified real MNT plus a small overlapping authored raster with known values, or existing suitable fixtures. Keep originals unchanged; label synthetic input honestly. Through actual UI actions establish:

| User action | Expected observation |
| --- | --- |
| Import to a new data layer, review and Apply | Layer becomes usable; raster appears on the map; progress settles without an unexplained failure |
| Add overlap to that existing layer, inspect Before/After, Apply replacement | Correct existing layer is targeted; known overlap changes, uncovered/invalid behavior matches the existing action; no duplicate user layer is required |
| Toggle source visibility and pan/zoom | Current native tile path renders; transparent gaps and layer ordering remain usable; no persistent loading/error state |
| Run slope on eligible input; then replace input and observe the existing refresh behavior | Result displays and job settles; no falsely failed committed import or silently stale result presented as current |
| Close/restart, reopen the same disposable Design/library, undo the replacement | References and display survive restart; undo restores the previous coverage/values without losing originals or other history |

Observe console/native errors and capture only useful screenshots or short logs. UI display is not numeric proof; existing scientific tests supply that evidence. Stop only app processes you started. Keep the disposable profile until the handoff if it helps replay; record its path without committing private rasters/logs. Cleanup must never target a user's profile.

If this environment cannot launch/control a real Desktop WebView, finish the independent code/evidence work and prepare a runnable, revision-specific command plus these smoke steps for the user. State the exact unavailable prerequisite and leave smoke pending; do not call native tests a substitute, invent screenshots or build another host. Return this in the same consolidated handoff—the missing UI observation does not require another architecture assignment.

Normal-workflow failures found in this smoke are in scope to diagnose and fix with a regression, preserving the settled architecture. Escalate only a material contract change or missing authority. Unrelated cosmetics, speculative hardening and unmeasured optimization go to follow-up beads; do not silently waive an established requirement or expand this batch to solve them.

## 4. Final candidate and stop

During editing, run the narrow tests for changed behavior. On the final candidate, run the applicable AGENTS gates **once**, including Rust fmt/strict Clippy/check/workspace tests, focused ignored GDAL coverage, and the frontend/contract checks required by affected persistence surfaces. Include native command policy if command/executor behavior changes. Reuse recorded successful runs on identical code; do not repeat broad suites after prose-only edits. A code change or required rebase invalidates affected evidence and requires its relevant rerun. This scheduling rule does not waive repository gates.

The prior independently verified native route was `CARGO_HOME=/home/daylon/projects/canopi/.rq-scratch/cargo-home CANOPI_SKIP_BUNDLED_DB=1 cargo test --offline -p canopi-desktop --lib services::lidar -- --include-ignored --skip services::lidar::e2e --test-threads=1`. It excludes private e2e evidence. Use existing real lifecycle coverage available on the final candidate; no new capacity campaign or 400M run is required. Keep production caps and platform/release limitations explicit. Run `python3 scripts/check_docs.py` and `git diff --check`.

One receipt: final revision, C1/C2 regression references, corrected lifecycle evidence, smoke outcomes (or runnable pending handoff), gates and material limitations. Reconcile current guides/design/index; retire this prompt on delivery. Add only a compact outcome to the debrief: actual product workflows demonstrated, new defects caught versus escaped, real decisions requiring the courier, and measured effort if available. No new reporting system or skill edits.

Commit/push the existing branch, sync/export bd, keep `canopi-jv8a.4` open, and return one delivery. Main-agent review is restricted to the changed safety boundaries and smoke evidence unless a concrete product risk requires more. Completion leads to an integration decision through the user—not automatic integration, release, capacity removal or new UI work.
