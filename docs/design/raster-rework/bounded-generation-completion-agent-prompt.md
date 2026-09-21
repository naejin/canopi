# Complete bounded-generation review, ownership and measurement

Status: proposed — sole current continuation assignment, executable when forwarded by the user.
Tracking: `canopi-jv8a.4`, parent `canopi-jv8a`; keep the bead open pending independent disposition.
Current guidance: [review](bounded-generation-review.md), [design](bounded-generation-design.md), [LiDAR](../../agent/lidar.md), [courier protocol](collaboration-protocol.md), [delivery](../../workflow/delivery.md).

## Mandate and starting point

Continue `feature/bounded-raster-generations` from **`9ad85c18`**, preserving the accepted `a5fc7d7b` predecessor and delivered BG1–BG5 improvements. Complete the three findings below as one assignment. The outcome is the existing import/review/Apply workflow with sparse traversal, owned unpublished source files, and honest capacity evidence—not a new raster backend or qualification framework.

First inspect Git status and `bd show canopi-jv8a.4`, claim/update its scope, and incorporate this documentation commit into the implementation branch. Retain its newer source inventories and receipt when resolving documentation overlaps. The primary checkout's `desktop/src/native_operation.rs` edit and `.beads.gate.lock` are not yours. Do not reset or rebase away the accepted feature stack to obtain a clean baseline. Follow repository delivery rules and explicitly report any baseline/rebase conflict rather than stashing user work.

Use the applicable local TDD and craft skills for focused regressions and risk-based implementation. Architecture is settled below; helper names, SQL/index implementation and test organization are delegated. No subagents, mandatory mutation campaign, new dependencies, new Python tooling, engine re-pin, scientific change, Q repair, UI redesign, capacity-limit increase, main integration or release. Preserve existing admission, display means/interpolation, paged tile reads, legacy compatibility and undo. General collection of old unreferenced assets is deferred; cleanup of newly owned unpublished files is not.

## BG6 — sparse review traversal

Start with a failing caller-level sparse review regression, then replace `import.rs::union_blocks` in `review_coverage`. Making the existing envelope loop lazy is insufficient: both its work and its metadata must be independent of empty gap area.

Reuse the persisted interpretation regions and `GenerationChunkReader`/catalogue paging. Merge ordered, bounded coordinate streams covering incoming occupied regions **and accepted-head regions needed for Before/After previews**, deduplicating coordinates before reading. Use the fixed layer lattice and signed coordinates; translate to preview/envelope coordinates only at the boundary. Keep bounded pages (existing 256-record policy), bounded sample windows and target-sized previews. Do not collect every chunk into a `Vec`/set. Legacy raw/mask or opaque TIFF heads may be scanned in bounded windows over their own stored extent to discover coverage when no occupied index exists; they must not cause a walk across the joined empty envelope. Cancellation is checked between pages/windows and all readers are released on every exit.

Keep ordered add/replace/replace-overlap semantics. Count each incoming valid cell once; invalid count is checked envelope area minus unique incoming valid count, not a walk through gaps. Before shows accepted-head values; After shows the selected composition. Preserve the accepted preview reduction/order behavior over contributing cells and transparent absence; do not introduce a new resampling policy while changing traversal.

Acceptance through actual staging/review and decision-preview callers:

- Two one-cell sources at x=0 and x=1,000,000 on one row: two valid incoming cells, 999,999 invalid envelope cells, no overlap on an empty head. Work visits only the occupied chunk coverage, not 977 envelope windows. Compare against adjacent placement to prove gap length does not grow visits. Use a private test observation of actual caller reads/visits, not a separately tested iterator alone.
- Accepted-head-only coverage remains in both previews; replacement of value 5 by 9 shows 5 Before and 9 After. Overlapping incoming members are counted once; invalid input never erases accepted values. Include negative lattice extension and replace-overlap adding no new coverage.
- More than two pages, duplicate occupied coordinates across members, cancellation between pages and a subsequent healthy call: each coordinate contributes once, no whole-index collection, bounded live page/window storage. Retain the real stage→Apply→restart→replacement→undo tests.

## BG7 — job-owned source COGs until publication

`stage_source_samples` currently moves a new COG into global assets before scanning facts/regions or admitting the union. Settle this at the lifecycle boundary rather than adding best-effort deletion to each caller.

**Ownership policy:** newly prepared source COGs remain inside their exclusively owned job directory throughout facts/regions, review and AwaitReview. Record a validated job-relative location in the private staged metadata; path resolution must stay under that job root. Keep digest/size/validity as identity, not as proof that a global file exists. Review/restart reads the staged COG directly without re-preparation. A reference to an already committed global asset is a non-owning lease. Concurrent AwaitReview jobs must never acquire deletion ownership over each other's files. Job-local duplicates are acceptable temporary storage; do not add a global claim registry or reference-counting service.

**Publication:** reuse the existing heavy-job lease, immutable content-addressed store and short head transaction. Before promoting a job-local file, durably record its intended destination in a small job-owned promotion journal. Publish with no replacement of an existing asset; validate an existing destination before reuse. Keep the job-local source available until success so retry/review cannot reference a missing file. Track which destinations were newly published by this job versus reused. Source asset/interpretation references that make the new payload authoritative must commit with the generation/head publication, not in an earlier independently committed `publish_member_cog` operation. Do expensive I/O outside the catalogue lock.

On error/cancellation/stale head, remove only newly owned destinations with no committed catalogue owner; never delete reused assets or any accepted historical/analysis reference. On restart, reconcile pending journals **before accepting new heavy jobs**: committed references win, uncommitted owned promotions are removed, interrupted active jobs settle according to existing recovery policy. Preserve intact AwaitReview jobs and their local sources. Use the existing job cleanup owner for local files; handle failure during partial initialization as well as settled jobs. Retain a journal if cleanup fails and expose the failure for retry rather than silently declaring success. Resolve all recorded paths through owned roots; no arbitrary-path deletion.

The journal is bounded by this job's sources and records intent before promotion, so a crash between promotion and recording completion is recoverable. An existing destination is not owned: under the exclusive heavy-job lease, record preexistence before promotion; on recovery preserve any committed reference even if the journal still says pending. Do not let startup cleanup race a live publisher. Preserve compatibility with earlier staged metadata: missing new location means the old global-digest location (or existing raw/mask adapter), read non-owningly. Never infer ownership of historical orphan files from their absence in the catalogue. No broad asset GC is authorized.

Acceptance through real caller failures, inspecting filesystem **and** catalogue:

- Inject cancellation/read failure after source COG creation and union-admission refusal after several sources: no newly owned global asset or settled job payload remains, original/head bytes unchanged.
- AwaitReview survives restart and Apply without another preparation; two AwaitReview jobs sharing content remain independently usable if one is cancelled.
- Newly promoted source plus injected failure before the head transaction rolls back; reused committed asset survives the same failure. Successful publication followed by simulated interruption before journal cleanup survives recovery and remains readable.
- Recovery at intent-before-promotion, promotion-before-transaction, and commit-before-cleanup is idempotent. The old head and undo history remain usable. A cleanup error retains recoverable ownership evidence. Existing staged formats remain readable without speculative deletion.

Use narrow private fault seams in the real lifecycle, not a replacement implementation. Account for any simultaneous job-local/promoted copies in the existing checked disk estimate; prefer same-filesystem no-replace linking where appropriate, with explicit errors rather than an unbudgeted copying fallback. Keep the accepted combined-footprint and reserve checks.

## BG8 — incomplete sampling cannot pass a memory gate

Adapt test-only `measurement.rs`; do not build another evaluator. A qualifying incremental measurement needs a complete idle baseline and at least one complete sample taken while the workload observation interval is active. Zero samples, only incomplete samples, an incomplete baseline, or sampler failure yield explicit unavailable/incomplete evidence, never `Some(0)` or a passing budget assertion. A tick after finish/stop cannot supply the missing workload evidence. Report complete/incomplete sample counts separately and retain the documented sampling limitations.

Preserve violations independently of missing data: with a complete baseline, an incomplete tick's known RSS subtotal is a lower bound. If that already exceeds the incremental budget, fail even if other samples are missing. Do not promote a partial low subtotal to a passing peak. Healthy runs may retain some incomplete ticks if complete workload samples exist, but report those gaps and label the result a sampled peak, not an exhaustive maximum. Unsupported platform evidence remains unavailable, not a Linux pass.

Test the real sampler finish and budget path: complete baseline 10 + complete total 20 passes a suitable budget; baseline 100 with ten incomplete ticks and no complete workload tick does not pass; zero ticks and incomplete baseline do not pass; an observed over-budget subtotal survives missing child data and a later healthy tick; stop-before-first-tick does not invent coverage. Retain the controlled live-child and summation tests. These are ordinary focused tests, not a mutation-count target.

## Execution, verification and handoff

Implement BG6, BG7, BG8 in that order with a failing regression at each boundary, healthy controls and retained caller tests. One authorization spans execution windows: checkpoint in bd and resume remaining scope without a new courier round. Escalate only a demonstrated conflict with the settled contracts, destructive migration need, engine/scientific/UI decision, or missing authority. Routine in-scope defects in touched paths are yours to fix; unrelated work is a follow-up bead.

Run required repository Rust/persistence gates and focused LiDAR tests including ignored GDAL coverage. The verified local route is `CARGO_HOME=/home/daylon/projects/canopi/.rq-scratch/cargo-home CANOPI_SKIP_BUNDLED_DB=1 cargo test --offline -p canopi-desktop --lib services::lidar -- --include-ignored --skip services::lidar::e2e --test-threads=1`; it deliberately excludes private e2e evidence. Also rerun available explicit-fixture MNT/MNH and sparse representative resource cases with the corrected sampler, serially, recording identities and completeness. Missing fixtures are unavailable, never substituted silently. The 400M run remains conditional on the existing ≥8 GiB available-memory/disk preflight; its absence does not block these corrections or authorize changing production caps. Follow AGENTS for frontend/binding checks when affected; explain genuinely unchanged surfaces. Run `python3 scripts/check_docs.py` and `git diff --check`.

Perform one composed-path self-review focused on the three corrected boundaries, not a new general audit campaign. Update the existing branch's `bounded-generation-receipt.md` with a BG6–BG8 response table, decisive caller cases, corrected measurements and unavailable evidence. Remove stale claims that review has a dense union sample buffer or already avoids empty traversal; distinguish old-asset GC from mandatory new-job cleanup. Reconcile design/current guides/index; retire this prompt after delivery. Do not claim independent acceptance yourself.

Add a compact outcome to the [debrief](review-and-debrief.md): defects caught internally versus escaped, remaining design ambiguity, and whether a courier exchange resolved a real decision or merely resumed execution. Record effort only if measured. Test totals do not establish cost savings. No skills/tooling framework changes in this assignment.

Commit/push the existing feature branch and sync/export bd under repository policy. Return one consolidated handoff through the user, keep `canopi-jv8a.4` open, and stop for independent review. No integration/release or later UI work follows automatically.
