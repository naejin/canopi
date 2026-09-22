# Ordered COG Data Layers

Status: active — user-selected replacement for materialized source merging; partial implementation delivered at `783e31e3`; independent review requires repairs. Not accepted, integrated or released.
Tracking: re-scope `canopi-jv8a.4` under `canopi-jv8a` / `canopi-j571`; reconcile `canopi-kko3` in the same implementation. bd owns progress.
Current guidance: [implementation prompt](ordered-cog-agent-prompt.md), [decision](../../adr/0027-ordered-cog-data-layers.md), [LiDAR guide](../../agent/lidar.md), [collaboration](collaboration-protocol.md), [debrief](review-and-debrief.md).

## 1. Mandate and supersession

A Data Layer is an ordered collection of independently prepared source COGs. Users add GeoTIFFs, toggle the Data Layer as a whole, and move sources up/down to choose overlap priority. There is no user-facing merge operation and no authoritative merged elevation raster generated for new collection edits. One numeric composition serves both display and analysis: the topmost valid sample wins; NoData reveals a valid sample below.

The user explicitly selected this simpler product model on 2026-09-21 and declined another alternatives comparison. The main agent owns the following engineering decisions. Implement them end to end, choosing routine local details without another design round. This replaces the source-composition, overlap-review/Apply and materialized-source-generation requirements in the bounded-generation design, ADR 0026 and corresponding sections of the broader raster plan. It does not waive data preservation, scientific correctness, bounded I/O, source ownership, or meaningful tests. Accepted historical measurements are not measurements of this new route.

Scope includes source preparation, collection persistence/history, member UI, display, slope, cancellation/recovery, compatibility, and real Desktop verification. Repair the stale map/History and stale dependent-analysis behavior observed after Undo; they are required workflow behavior, not optional cleanup. No separate campaign to finish the superseded merge UI first.

Keep GDAL, the pinned native reader, Float32 conversion semantics, current admission limits, current Desktop shell and Design presentation format. No dependency/engine search, new workbench shell, general garbage collection, Q harness work, Web raster execution, capacity increase, precision migration, new analyses, integration or release. The later Data/Analysis workbench designs are not part of this assignment. Local changes to existing Layers/LiDAR UI specified here are authorized.

## 2. Baseline, reuse and ownership

Current repair baseline: `783e31e3` on `feature/bounded-raster-generations`, catalogue v15. Preserve this complete delivery stack; [independent review](ordered-cog-review.md) and §8 govern its repair.

Historical pre-implementation inspection: `0696bd3d` on `feature/bounded-raster-generations`, including C1/C2 from `bcc7f5dd` and test changes from `0696bd3d`; inspected design checkout: `94fd0a8d`. Preserve the accepted predecessor `a5fc7d7b`. The main checkout's dirty `desktop/src/native_operation.rs` and `.beads.gate.lock` remain user-owned. The implementation worktree was clean at inspection.

The independent disposition at `0696bd3d` accepts C1/C2 within their safety scope, not full product closure. Three focused regressions and docs validation independently passed; full gate counts were corroborated in the transient `final-gates2.log`. The smoke database confirms that Undo left the analysis tied to the undone replacement. Map staleness is observed, not yet root-caused. The stale-intent test's equal-content claim is inaccurate: its foreign destination contains text, not the witness COG. Keep the useful detector and make any retained claim/fixture truthful during this work.

| Existing surface at the baseline | Reuse or adaptation |
| --- | --- |
| `desktop/src/services/lidar/prepared_raster.rs`, `engine.rs`, `raster_assets.rs` | Retain controlled COG preparation, source validity, non-deleting committed reads, hashing and owned scratch. Do not rewrite the decoder or copy all of GeoLibre. |
| `import.rs` promotion journal / `PromotionGuard` | Retain C1 file-identity ownership and C2 fallible cleanup. Publish references with collection metadata instead of resolved source chunks. |
| `generation.rs::resolve_window`, `ResolvedMember`, bounded legacy readers | Adapt the existing bounded numeric seam to new ordered members. Old Add/Replace/ReplaceOverlap semantics remain only for reading historical data where needed. |
| `catalogue.rs` v13, head/history rows, lattice and region index | Add a versioned collection representation and stable occurrence identity, retaining migration backup and future-version refusal. Reuse head identity and spatial indexes; no parallel library database. |
| `tiles.rs`, `tile_cache.rs`, native raster protocol | Read a collection snapshot through the shared resolver. Preserve reduction/interpolation correctness, request cancellation and cache budgets. No MapLibre instance per source. |
| `analysis.rs`, `mod.rs` heavy lease and refresh orchestration | Keep slope algorithm, core+halo processing, job admission and result publication. Refresh after every numeric collection change, including Undo. |
| `common-types/src/lidar.rs`, `desktop/src/commands/lidar.rs` | Extend typed read models/commands and regenerate bindings. New native work remains executor-backed. |
| `desktop/web/src/app/lidar/`, `components/panels/lidar/` | Adapt existing action/store/presentation seams and dock components; retain Design Edit for presentation changes. |

The library owns source files, ordered members, snapshots, analysis definitions/results and jobs. The Design owns references, group visibility, opacity and presentation order. A source priority edit changes the shared library composition across Designs; it does not create mirrored source order in each Design. State this concisely in the source-order UI. Do not dirty Designs merely because library content changed. Show updated library data wherever referenced.

New internal collection code stays cohesive behind the existing library boundary: one authority for membership/order, one bounded numeric read seam, one publication path for collection changes. Private file names, SQL layout and helper factoring are delegated. Do not build a generic workflow engine, second event bus or plugin system.

## 3. Fixed product and numeric rules

### Membership and ordering

Each member has a stable occurrence ID, a source interpretation/asset reference and a position. IDs distinguish repeated imports of the same bytes; asset deduplication does not collapse separate user entries. An added occurrence is a membership change even if the visible samples happen to stay identical; do not discard it using the old pixel-only no-change rule. Lists are top-first in the UI and transport; conversion to the resolver's iteration order is internal. Exact moves use member ID and the expected current snapshot ID, never a stale row index alone. A stale edit fails by name and refreshes the view without silently applying to a newer order.

New selected sources are inserted as a contiguous group above existing members. The confirmation list shows their deterministic order; the first displayed source becomes topmost. Preserve explicit selector order when available; otherwise sort by filename with a deterministic path tie-breaker and show that order before publication. Paths remain local and are not written to diagnostic receipts. The import destination is explicit, and the user may create a new Data Layer through the existing action. Attach a new visible Design reference only to the originating live Design session through Design Edit; late completion after navigation must not attach it to a different Design. Updating an already referenced Data Layer preserves its visibility/opacity.

Move up/down swaps adjacent priority positions; moving at an edge is disabled. Remove detaches a member from the current composition, preserving its asset and history. The existing whole-layer delete impact/confirmation remains. No physical source deletion is part of reorder, remove or Undo. A layer may become empty and later accept sources again; preserve its measurement interpretation and lattice.

Whole-layer eye/opacity controls display only, never analysis inputs. Existing result visibility remains independent of source-layer visibility. Per-source visibility/opacity is not introduced: remove/Undo and priority controls meet this assignment without a second enabled-versus-visible model. Display order between independent Data Layers remains Design presentation, not cross-layer numeric merging.

### Sampling, display and slope

All new sources still satisfy existing measurement, units, horizontal CRS, resolution, north-up/alignment and source-specific validity admission. Reprojection, automatic resampling and treating filenames as measurement definitions remain excluded. Zero and negative finite values are valid unless the source's own effective NoData rule excludes them. Never apply one source's NoData sentinel to another source. Preserve existing Float32 conversion limitations explicitly.

For each native-grid cell, choose the first valid sample from the top-first list. If none is valid, the result is invalid. This rule applies to display, inspection/read APIs and analysis; no mean across overlapping sources and no alpha-blended numeric interpretation. Display reduction/interpolation occurs after priority resolution, with valid-count weighting and the complete requested footprint. Do not independently average each COG's overviews and blend them: that can change precedence across partial validity. Reuse the current layer-wide styling/scale rather than stretch each source separately.

Slope reads the composed elevation window plus its halo before computing. It is not a stack of independently computed per-file slopes. Retain units, CRS eligibility, edge/missing-neighbor behavior and separate validity/quality contracts. Persisting slope result/quality chunks remains permitted: removing materialized source merges does not eliminate derived analysis outputs.

Only current members influence a read; history length must not increase composition work. Fetch intersecting member/region candidates in bounded pages and priority order. Process output in bounded windows; no whole-union buffers, source-file reads or empty-envelope scan. A streamed complete-coverage pass for exact summary statistics is allowed, but must not write an authoritative source mosaic. Reordering/removing/restoring must not re-encode existing source COGs. Reproducible bounded display caches are allowed and disposable; do not recreate persistent resolved source generations as a compulsory cache under another name.

Retain current per-import limits from `admission.rs`: 16 sources, 512 MiB/source, 1 GiB selected, 25M union-envelope cells for new imports. This assignment does not claim these are ideal for the new model. Existing accepted data remains readable; reorder/remove/history restore do not become new import admission. Preserve current read-window, tile queue/cache and heavy-job budgets. Large history/collection metadata must be paged where consumed incrementally, not multiplied by raster dimensions. No 400M run or admission bypass in production.

## 4. Persistence, publication and compatibility

Use an immutable collection snapshot and a current head, reusing the existing catalogue generation identity where practical with an explicit new format discriminator. A new snapshot records ordered member occurrences and provenance, not resolved numeric chunks. History distinguishes import, reorder, remove and restore. Mutations validate the expected head and publish the complete new snapshot/head atomically; failures leave the old head authoritative. Disk-full, malformed metadata, unknown format and missing referenced files produce named failures, never silent transparent data substitution.

Source import stages managed originals and controlled COGs under the existing job owner. The final transaction commits owned asset references, membership, the head and history together. Unpublished assets use the established promotion/recovery owner. Keep cancellation meaningful through preparation; before commit it publishes nothing. After commit the operation is success even if cleanup fails, with retained evidence/diagnostic. Cancellation cannot undo a committed change. Recover interrupted jobs at open, retaining old published heads and unresolved evidence; no deleting a destination without positive ownership. Reused assets, history and other jobs' awaiting-review payloads survive.

Retain the catalogue's WAL-consistent pre-migration backup and future-schema rejection. Existing source/result IDs and `.canopi` presentation references survive. Library schema changes do not require renaming the document section. Web continues to preserve these references and unknown permitted fields without native raster execution.

**Old composition is not a simple priority stack.** The previous `add`, `replace` and `replace-overlap` roles can encode masks that arbitrary reorder cannot reproduce. Do not reinterpret old rows as topmost-wins and silently change accepted coverage.

Keep legacy dense and sparse generations readable with their current exact values/validity. On the first new edit/import into an old layer, expose its accepted head as one indivisible bottom member, labelled “Previous composition”; it references the immutable old generation through a bounded read adapter. New COGs stack above it. That member can move or be removed like a source, but its internals cannot be reordered. Do not eagerly re-encode the old library or introduce a new compatibility mosaic. The existing library-owned, disposable dense compatibility lease is retained under its existing bounds and caller cancellation; it is not a new durable publication format. Sparse generations use their existing bounded reader. See §8. Old snapshots and analysis results stay retained; legacy reading is compatibility code, not the new publication path.

New History provides **Undo last change** (restore the preceding snapshot as a new head) and **Restore this version** for older entries. Restore never deletes intervening history. Historical pre-transition heads restore as a previous-composition member with exact historical values. Retire the old arbitrary “Undo import” action in favor of these explicit snapshot actions; do not pretend a historical masked merge is separable. History shows operation/time and a unique identity cue, not per-generation “Import 1” numbering. Undo/restore is library history, not canvas Scene Edit or a new global Ctrl+Z owner. Repeated Undo walks backward through prior user changes rather than undoing its own restoration and toggling between two heads. Explicit Restore this version starts a new user change that can itself be undone; a new edit after Undo starts a new undo path while retaining all older versions for explicit restore. No separate Redo control is required. Restoring a snapshot is idempotent when its ordered member identities already equal the current composition; no-op moves/restores do not enqueue analysis or create meaningless history.

Prevent nested compatibility wrappers: reference the original preserved generation directly; snapshots of the new model copy member references rather than wrapping their prior head. Existing members remain resolvable through restart without source re-preparation. Compatibility cases include old awaiting-review jobs: preserve their staged payloads, let Cancel discard only owned scratch, and require explicit confirmation to add their compatible sources using the new ordering semantics. Never auto-apply an old overlap decision as a new top-first import.

## 5. Lifecycle and caller contracts

Every read, tile and analysis job captures an immutable snapshot ID. Source edits use the existing heavy-operation admission; no additional native thread pool. Release locks before decoding. No held executor task waits for another task needing the same exhausted permit. Extend cancellation/disposal through the existing runtime owner.

On a committed numeric edit (import/reorder/remove/Undo/restore), immediately publish the new library snapshot, refresh open source/history views, invalidate presentation by snapshot identity and mark dependent results non-current. Last-good results may remain visible with the existing Refreshing/Failed or Incomplete state and explicit stale detail; never label an old result Ready for the new head. Hiding a layer causes none of this.

**Recompute after Undo as after Apply.** Reuse dependent-refresh orchestration; historical analysis re-pointing is deferred. `canopi-kko3` is resolved by this decision, not a product question to send back. Fence analysis publication against its captured source head. If an older job is already active, its completion cannot overwrite a newer result or suppress the needed latest-head refresh: coalesce/recheck through the existing scheduler on settlement. Startup likewise detects source/result mismatch and schedules or clearly reports pending refresh. Empty composition has empty display and unavailable/Incomplete current slope, with old results retained as history, not current truth.

UI refresh follows actual backend settlement, not just successful job submission. Late responses for a previous selection/snapshot cannot replace current source rows, History or map metadata. MapLibre source/cache keys must change with the current snapshot; cancel/discard late tiles without deleting tiles still leased by other readers. The known stale-canvas cause is a diagnosis task inside implementation, not a prescribed cache rewrite.

Typed transport exposes paged member/history reads, member moves/removal and snapshot restore with expected-head validation, and existing import/job progress adapted to the new flow. Exact Rust/TypeScript names are delegated; IDs, ordering, outcomes and error semantics above are fixed. Browser edition adapters and gallery fixtures must explicitly handle new capabilities without invoking native work.

## 6. Existing UI adaptation

Use the current Layers dock and source settings, the shared ActionMenu/buttons and existing tokens. Inspect `npm run dev:ui` and the relevant [dock guide](../../../.interface-design/patterns/dock-panels.md). No new Data/Analysis shell or general drag-and-drop system is required.

A Data Layer retains its eye, name, status and result rows. Its settings disclose a top-first source list with filename, priority, move up/down and Remove. Explain once: “Sources higher in the list cover valid data below. Order also affects analyses.” Use the existing localized style and all 11 locales. Long names wrap; controls have accessible labels, keyboard focus and disabled edge states. Paging preserves stable IDs and selection. Removing a source has an explicit confirmation that history is retained. Group visibility remains one eye; source priority controls are not presentation-only layer reorder.

Add TIFFs shows destination and ordered selection, then preparation progress and an explicit **Add sources** confirmation. Reuse job staging/acknowledgement surfaces; replace the old overlap decisions, exact overlap counters and Before/After merge tabs on this route. The confirmation identifies rejected inputs and their reasons. An all-NoData source is refused with a named no-valid-samples reason; no empty source member is published. A selected batch is atomic: if any source is incompatible or preparation fails, publish none; users remove the rejected selections and retry. Back does not cancel a running job; Cancel/Escape follows the existing owned-job cancellation contract. Existing staged review jobs use the compatibility behavior in §4.

Undo/history and settled changes update the visible map and source/result rows without closing panels or restarting. Empty, busy, failed and stale-analysis states remain actionable. View coverage and Design Location behavior remain unchanged. Maintain narrow/short viewport usability, light/dark themes and keyboard access. Routine layout choices within this contract are delegated; prototype only a consequential unresolved interaction, not the already settled product model.

## 7. Execution sequence and acceptance

These are dependency gates, not separate approval rounds or a Markdown task tracker. Record execution state in the existing bead. Continue automatically when each gate passes; repair in-scope failures before proceeding.

| Phase / owned surfaces | Outcome and exit evidence |
| --- | --- |
| 1. Catalogue + resolver + compatibility | Versioned collection snapshots, occurrence identity and bounded ordered reads work through the actual library caller; old dense/sparse heads survive migration unchanged. Demonstrate overlap, NoData and historical adapter fixtures before broad UI changes. |
| 2. Import + edits + lifecycle + transport | Real import, move, remove, restore and reopen publish only member metadata/source COGs; failure/cancellation preserve accepted data. Typed bindings and native command guards pass. Slope uses the composed window and refreshes/fences every head change. |
| 3. Dock + presentation | User can add sources, reorder, hide/show group, remove/Undo and see source/slope updates without restart. Update gallery/browser adapters and all locales. Diagnose the observed map/History staleness through real settlement. |
| 4. Product verification + retirement | Run isolated real Desktop workflow and applicable final gates; remove obsolete new-write merge paths/UI and their dead contracts while retaining necessary legacy readers/scientific controls. Reconcile docs and deliver one receipt/debrief. |

Keep early phases caller-level, not detached modules awaiting unspecified wiring. Branch may contain internal checkpoints; none constitutes product acceptance. Do not delete a regression simply because it fails after semantics change: identify the replaced product rule, replace its test with the new rule, and retain the underlying validity/ownership/compatibility detector.

### Decisive examples

Expected values below come from the selected topmost-valid rule, not implementation output. Use existing small GDAL fixtures and independent dense test oracles, not new test frameworks.

| Starting state and action | Observable result |
| --- | --- |
| Bottom A = `[10,20,30]`, top B = `[100,NoData,0]` on the same three cells | Values `[100,20,0]`, all valid; move B below A → `[10,20,30]`; Undo restores `[100,20,0]`. Include negative valid values and different source NoData sentinels. |
| Two overlapping sources with different validity subsets; render low-zoom reduction | Priority resolves each native cell before reduction; mean uses only valid composed cells. Compare actual tile output to an independently derived complete-footprint oracle. |
| A planar elevation surface split across adjacent COGs, plus an overlapping changed patch | Composed slope and core/halo boundaries match the existing scientific oracle in degrees/percent; source-file seams are not artificial analysis edges. |
| Reorder/remove/restore an imported collection, then restart | Exact membership, stable occurrence IDs, order, coverage and values survive; source COG hashes unchanged; no new resolved source raster/chunk publication. Empty last-member removal remains valid and undoable. |
| Same bytes imported twice; remove one occurrence | Only that entry is removed; shared bytes and the other occurrence remain. |
| Migrate old add-only and replace-overlap heads, including opaque legacy data | Exact accepted masks/values preserved before and after adding a new top source; old version restore remains exact. No fabricated list of reorderable historical sources. |
| Cancel/disk failure before commit; interrupt during promotion; unlink failure after commit | Old head remains before commit; owned cleanup and retry evidence survive appropriately; committed result stays success. C1 foreign-file and C2 failure tests still exercise outer rollback/open/settlement. Equal-content claims require actual copied bytes and a different file identity. |
| Submit an edit with stale head; allow old tile/analysis work to complete after a newer edit | Named edit conflict with no mutation; stale completions do not replace current display/head; latest-head analysis refresh eventually settles or reports failure. |
| Create slope, add overlapping source, reorder, Undo while History is open | Each numeric change updates map/History and marks/recomputes slope; Ready always corresponds to current snapshot. Group eye toggle changes neither snapshot nor analysis-job count. |
| Adjacent versus widely separated occupied inputs within retained admission; paged collection/history | Work/memory follow occupied windows and bounded pages, not empty area or history depth. Tests measure the actual read/display/analysis caller, not only its iterator helper. |

### Verification and final handoff

Follow [AGENTS.md](../../../AGENTS.md) gates for changed files. This mixed persistence/IPC/frontend change requires Rust fmt, strict workspace Clippy/check/test, native command policy, frontend typecheck and full tests, binding generation/check, and docs validation. Shared edition composition changes also require check:ui and both builds; exercise Web preservation even when composition itself is unchanged. Use existing prepared fixtures; preserve originals. Run focused tests while editing and the required broad gates on the final candidate, reusing successful results on identical code after prose-only edits.

The existing native route is `CARGO_HOME=/home/daylon/projects/canopi/.rq-scratch/cargo-home CANOPI_SKIP_BUNDLED_DB=1 cargo test --offline -p canopi-desktop --lib services::lidar -- --include-ignored --skip services::lidar::e2e --test-threads=1`. Real fixture tests use `CANOPI_LIDAR_E2E_FIXTURE` and `CANOPI_LIDAR_MNH_DIR`; set both for the fixture module, and report unavailable fixtures accurately. Do not import the old suite count as this delivery's result.

Use the [edition guide](../../agent/edition-development.md) for an isolated production Desktop profile, free ports and owned processes. Exercise real MNT + small aligned overlay: add sources → inspect priority → move up/down → group hide/show → slope → remove/Undo/history restore → save/restart/reopen → incompatible-source refusal. Observe live map and analysis changes, not only SQLite. Include controls for cancelling import and preserved originals. Use the current UI, not the old qualification host. If real WebView control is unavailable, complete all independent work and return exact revision-specific runnable steps and the missing prerequisite; smoke remains pending.

At delivery, update the existing `ordered-cog-receipt.md` here with lifecycle headers, final revision, capabilities, acceptance evidence, exact commands/results, migration limits and unavailable observations. No giant command transcript in Git. Reconcile current LiDAR/MapLibre/document/build guides as affected, this index, broader plan and design status; retire the prompt only when its authorized work is delivered, identifying incomplete evidence explicitly. Preserve old receipt/review history with its revision; do not rewrite old failures as successes. Finish the [debrief](review-and-debrief.md#ordered-cog-delivery-and-final-debrief) and keep the implementation bead open for independent disposition. No integration/release or production capacity change.

## 8. Repair contract after review of `783e31e3`

The [eleven review findings](ordered-cog-review.md) are required corrections to the above outcome. Retain immutable snapshots, stable occurrence IDs, shared readers, heavy lease and scheduler. The decisions below close handoff ambiguities; private names and factoring remain delegated. No new job service, event bus, spatial engine, cache framework, generic pagination layer or benchmark project is required.

### Completion, reads and UI identity

Read collection metadata under one catalogue lock/consistent database snapshot; do not call a public library method that reacquires that lock. Release it before raster work. Existing executor-backed edit commands must await the actual edit and settlement and return a typed committed/no-change outcome carrying the authoritative head identity. Pre-commit failure/cancellation returns a named error; post-commit cleanup or scheduling failure preserves successful publication and a diagnostic. Keep existing heavy-operation admission/cancellation ownership and avoid nested permit waits. Do not add durable edit-job records merely to communicate completion.

The frontend keeps the edit pending until that outcome, then refreshes the library, currently open sources/History and map identity. It preserves failure messages through refresh. A view request captures layer ID, head/snapshot identity and a local request generation; an obsolete response cannot overwrite newer selection or metadata. Disable numeric actions while their required snapshot is loading or their edit is pending; send the expected head the user actually saw. A stale-head refusal refreshes the view and explains the refusal. Undo always targets the visible, validated layer. This uses existing store/component lifecycle owners, not a second mirrored library store.

### Numeric admission and compatibility

New ordered occurrences have only topmost-valid semantics, both before publication and after reopen. Review/measurement cannot retain old Add/ReplaceOverlap roles. Compare the first batch against one common CRS/grid interpretation, not an absent layer for every file. Persist/check preparation's valid count; reject each zero-valid source by name. Backend preparation/Apply rechecks the entire selected batch and publishes none on any rejected source. Compute the admission envelope from current membership plus incoming sources, separately from the immutable lattice anchor, using checked arithmetic and the unchanged 25M limit.

Wrap the actual last accepted legacy head, including its overlays, not its base ancestor. Preserve sparse signed chunk coordinates and occupied extent even beyond the original manifest rectangle; reuse chunk/region paging rather than scanning empty space. Eligibility and slope input come from the shared generation reader/interpretation, so a Previous-composition-only layer is a valid input when its original elevation interpretation is eligible. Retain the existing controlled dense compatibility lease; carry the real caller cancellation token through cold lease creation and reads. Check cancellation before publication. No eager migration or replacement historical engine.

Source-region indexing must translate chunk-local windows to absolute source pixels. Numeric extrema exclude zero-valid regions. Keep the separately deferred source-preview sentinel policy out of this repair.

### Undo metadata and migration

Record the actual operation on newly published snapshots, including Undo; do not infer it from interpretation IDs. Compare ordered **member occurrence identities** for Restore equality. Equal order is a no-op even when snapshot IDs differ; distinct occurrences remain distinct even if bytes match.

Represent Undo availability explicitly alongside its target: available with an empty target means Undo to the empty initial composition; unavailable means exhausted. Each ordinary change records the current head as its undo target. Undo publishes the target composition but inherits that target's next-Undo state, so repeated Undo walks backward and stops. First import can Undo to empty; another Undo is disabled/refused without publishing. Explicit Restore is an ordinary new change and is itself undoable. No-op actions create neither history nor dependent refresh.

**Migration decision:** catalogue v15 did not record enough information to distinguish prior Undo operations reliably. Preserve every existing snapshot and explicit Restore capability, values, assets and head. At migration, treat the existing head as the Undo baseline; new changes can Undo back to it, but do not fabricate a chain of prior user actions from ambiguous metadata. Existing entries without recorded operation display a neutral “Previous version” label. Explain once in migrated History that earlier versions remain available through Restore. This is a metadata-only compatibility boundary, not history deletion or reinterpretation; test a pre-repair library and a fresh library separately. Allocate the next available schema migration with existing backup/transaction/future-version protections. No separate event log or history engine.

### Dependent results

Ready requires the current result's captured source identity to equal the current head and a nonempty eligible composition. Derive this at presentation/reopen, not just in the edit callback. Retain last-good results with explicit stale/Refreshing/Failed/Incomplete presentation; empty current composition has no current slope. Handle superseded jobs at entry and publication as the existing stale/coalescing outcome, so settlement rechecks and schedules the latest needed head. Ordinary failures remain failures, not endless retries. At startup reuse existing refresh orchestration once its executor is available, or explicitly show pending refresh when it cannot be scheduled. Do not re-point old analysis results after Undo.

### Incremental consumers and small UI corrections

Separate collection summary (head, count, Undo availability) from member pages and history pages; a source refresh must not expand every historical membership list. Use bounded pages with a fixed server maximum consistent with existing catalogue paging. Bind member cursors to the immutable snapshot; bind history traversal to a captured upper bound with a stable unique tie-breaker. Reset pagination on selection/head changes. Validate layer/snapshot ownership and reject invalid cursors; exact cursor representation is delegated. Preserve global priority and adjacent moves across page boundaries.

For numeric windows, query current membership intersecting the requested footprint/regions through existing indexes, in priority order and bounded pages. Include Previous-composition candidates with correct sparse extent. Do not eagerly open every source to serve a tile. An ordinary transient membership vector during mutation is allowed; do not optimize every Vec or add a second spatial catalogue.

Join the stored original filename through interpretation/source identity; no new filename column is needed. Add a unique version suffix to History, remove old overlap counters, and retain existing localized dock controls. Verify page/selection changes and pending mutations with deferred responses, not only immediately resolved mocks.
