# Implement GeoLibre native integration in the existing application

Status: proposed — sole current implementation assignment; executable when forwarded by the user.
Tracking: `canopi-jv8a.1`, parent foundation `canopi-jv8a`, epic `canopi-j571`.
Current guidance: [settled design](geolibre-integration-design.md), [LiDAR](../../agent/lidar.md), [courier protocol](collaboration-protocol.md), [delivery](../../workflow/delivery.md).

You are the implementation agent. The main agent owns architecture and independent review; the user remains our courier. Complete **G1–G5 in the linked design as one substantial production batch**. Do not stop after dependency setup, a prototype, one caller, or an internal milestone. Fix in-scope test/self-review findings and continue to the agreed delivery boundary. No direct reviewer messaging or subagents.

## Outcome and fixed decisions

Make existing Canopi import staging and slope postprocessing use the native raster core selected by GeoLibre, while preserving existing features, UI and saved data. This is production integration, not tool evaluation. The linked design settles the dependency, private interface, controlled derivative, ownership, exact compatibility rules, resource bounds, tests and stop conditions; read it completely before coding.

Use `wbgeotiff` at `9c0ff4fdf3513f27b89c78e294610c3b418b3a4f`, the core used by GeoLibre Rust `aac2b743978666f3c3119b5c93de1b30963b1493`. Build from Rust source; do not return to the old npm artifact/pin debate. Native GDAL remains preparation/CRS/slope/display authority. Do not add the whole GeoLibre tools/browser stack to get a decoder. Source fetch, the declared dependency and its lockfile, ordinary builds and the design's real small integration runs are authorized.

Retain existing import review/Apply, storage formats, IDs, IPC, maps, document ownership and capacity limits. Full-grid composition is **not** solved by this assignment; report it plainly. No new UI, sparse-generation migration, engine search, old Q repair, new evaluator, Python migration/deletion, large capacity run, integration to main or release. Old Q remains frozen/unqualified and is no longer a prerequisite for this assignment. Historical prompts do not override this one.

## Start and work autonomously

1. Read `AGENTS.md`, the design, relevant LiDAR/build/edition guides and `bd show canopi-jv8a.1`. Inspect Git status, HEAD and newer work. Baseline is `71abad0f`; preserve the accepted feature stack, approved UI `0e696722`, and the pre-existing user edit in `desktop/src/native_operation.rs`.
2. Claim the bead and record this scope. Follow repository branch/worktree rules; use a separate scoped worktree/branch retaining the required feature stack if latest main lacks it. Do not reset/rebase away accepted work or stage/stash the user edit. Baseline gate failures use the separate maintenance workflow; continue independent in-scope work without hiding baseline repair in this feature.
3. Read and apply available **tdd**, **craft** and **codebase-design** skills, including required routed references. Record briefly how each constrained the implementation. A missing skill is a reported limitation, not permission to invent its contents or silently abandon regression testing.
4. Establish focused baseline tests, then implement G1–G5 with small reviewable commits. Test each observable behavior through the production seam. Expected data comes from independently authored fixtures or the retained GDAL/baseline oracle, not the implementation being tested. Private naming, traversal, helper extraction, local bug repairs and ordinary build retries are yours to decide within the design.
5. Before handoff, perform one bounded self-review: trace real caller → preparation → native decode → persisted bytes/statistics → unchanged downstream consumer; exercise cancellation/failure and check cleanup/publication. Fix findings in scope. Do not create another reporting framework or pursue a test-count/mutation-count target.

Missing real fixture, UI automation or platform blocks only that evidence; complete the rest and name the limitation. A pinned dependency that cannot build after ordinary troubleshooting, a required public/schema change, incompatible scientific output, or a required engine change needs a precise escalation. Do not use a GDAL-only fallback and claim GeoLibre was integrated. Do not hand off a knowingly broken production path as complete.

## One delivery through the user

Run the design's required gates on the delivered tree. Update the LiDAR/build guidance for actual behavior; retire this prompt after delivery and link one concise `geolibre-integration-receipt.md` in this folder. Reconcile bead state, export only intended metadata, commit and push the scoped branch and sync Dolt under the repository workflow. Delivery is not independent acceptance, integration or release.

The receipt must state baseline/final revisions; G1–G5 implemented and verified outcomes; actual dependency/lock identity; import/analysis production call sites; numerical/validity and persisted-data comparison results; cancellation/disk-failure/cleanup evidence; gates and unavailable environments; unchanged capacity limits and remaining dense callers; user work preserved; next architectural dependency. A useful run proves the application workflow, not merely the decoder in isolation.

Add one short revision-linked outcome section to [review-and-debrief](review-and-debrief.md): product change delivered, decisions you handled without a courier round, any design omissions/escalations, self-review discoveries versus later independent escapes, and observed effort/courier exchanges only. Distinguish design omission, implementation deviation, test gap and reviewer oversight. Do not claim the process is cheaper without measurements.

Return **one consolidated handoff**. The user forwards it for independent review. Do not auto-start the next foundation/UI assignment; do not ask the user to courier each internal milestone or routine repair.
