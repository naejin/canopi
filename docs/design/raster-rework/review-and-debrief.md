# Raster delivery reviews and methodology debrief

Status: evidence — completed foundation findings and whole-rework improvement/debrief contract; no completion measurements are claimed yet.
Tracking: `canopi-j571`; completion execution in bd; accepted correction `canopi-jv8a.4`; historical Q `canopi-kqpp` remains frozen.
Current guidance: [completion prompt](completion-agent-prompt.md), [contract](completion-design.md), [receipt](completion-receipt.md), [collaboration](collaboration-protocol.md), [delivery](../../workflow/delivery.md).

## Whole-rework delivery and improvement

The user authorized the full remaining sequence on 2026-09-22, with the implementation agent continuing through internal milestones and returning only for material blockers. The purpose is more useful delivery per necessary main-agent intervention while preserving architectural coherence and trustworthy review. Actual savings have not been measured. This section owns the final synthesis; bd owns resumable progress and the completion receipt owns detailed measurements.

### Record during the work

At each material failure or decision, update the existing receipt/bead with the revision, concrete trigger, accepted invariant, discovery boundary, smallest response and decisive evidence. Distinguish self-review discovery from independent escape. Record a tool's failure status as well as its output when the two disagree. Keep only events that can inform correctness, repeatability or cost; no exhaustive transcript or second tracker.

Classify design omission, implementation deviation, test/oracle gap, reviewer oversight and environment/tool limitation separately, allowing overlap. Check whether existing instructions covered the behavior before blaming the handoff or proposing another rule. Main-agent design omissions and unnecessary prescribed complexity are first-class findings, not automatically implementer failures.

Test each proposed intervention on a real next use. Keep/revise/drop is supported by a failing case plus healthy control or an observed recurrence prevented. A promising idea without such use remains untested. Apply small reversible task-local test/script/guide corrections, then return to product work. Broader skills/automation/dependency changes need a separate scoped proposal; do not install a workflow framework in the name of the debrief.

### Interventions carried into this assignment

| Observed failure / existing evidence | Smallest intervention already selected | What completion should evaluate |
| --- | --- | --- |
| Broad caller guidance missed edit navigation, out-of-order refresh and reduction-footprint contributors at `524eef55` | Preserve R12–R14's ordinary caller regressions when splitting the old panel and extending readers | Do they catch actual regressions before delivery? Add a new detector only for a demonstrated missing boundary. |
| A live panel/catalogue pass was mistaken for a mounted-map pass | Confirm Location, observe pixels and correlate immutable head/result IDs; retain the actual evidence boundary | Does full Desktop/Web verification establish the claimed workflow and avoid partial-render screenshots being called complete? |
| Isolated Desktop was initially declared unavailable; Xephyr recipe then worked twice | Reuse the tested edition-guide recipe, with profile/process ownership and fresh control positions | Record actual next-use result, failures and smallest correction; no replacement GUI framework. |
| Retired Q/source-merge briefs and open-but-delivered beads contradict current scope | One completion prompt/contract, current routing and C0 tracker reconciliation | Does the executor start the correct work without rediscovering architecture or redoing accepted fixes? |
| Routine continuation consumes courier/reviewer attention | One whole-rework authorization, concrete phase exits and resumable bd checkpoints | Classify actual exchanges: material decision, external prerequisite, acceptance or avoidable resumption. Do not infer counts from commits. |
| Initial independent Rust command used an unwritable Cargo home | Reuse the inspected worktree toolchain and existing isolated cache | Did the next real command run without a cache/pin workaround? This is local setup evidence, not a new global rule. |

### Final synthesis

**Delivered 2026-09-22; verified at candidate `e026a347` on
`feature/raster-rework-completion`, containing `main` at `f61f8494`, which
contains the accepted foundation `34e4ded4`. Evidence and limits live in the
[completion receipt](completion-receipt.md); this section is the synthesis that
contract asked for.**

#### What works, and the exact limits

Capability, capacity and command evidence are the receipt's to own. In summary:
Desktop Data/Analysis/Layers ship with reusable datasets, ordered source import,
priority, history and confirmed library deletion; Analysis runs slope in degrees
or percent under an author-chosen result name; Layers is a flat geographic
presentation list with independent result eyes; numeric inspection returns the
physical value at a point; Web Location places coordinates and shares basemap
providers. Production admits **24 files, 2 GiB per file, 2 GiB total and
400,000,000 processing cells**, raised from a retired 25,000,000-cell bound that
survives only as the legacy dense allocation guard. Measured on the real IGN
fixtures: a 12-tile 48M-cell batch and a synthetic 400M-cell plane, the latter in
798 s at 197 MiB peak.

The limits that remain are **not** capacity but reach: the end-to-end Desktop
import chain is unobserved because the native file chooser's autocompletion
truncates a typed path, so everything behind Apply rests on unit and native
tests rather than a driven run. Windows and macOS compilation, packaged-window
smoke and the packaged Web artifact were never run. The official Google basemap
path needs a real restricted key that does not exist here. Inspection values were
never read off a live session. The receipt names each one; none is reported as a
pass.

#### Complexity that earned its place, and machinery that did not

Reused rather than replaced: the ordered COG model, the SQLite catalogue with
immutable generations, the surface-adapter seam and the shell-command
composition. The additions that pay for themselves are the ones that deleted a
falsehood — `resolve_units` refuses a unit nobody declared instead of storing
`unitless`; `scan_source_facts` spans only valid samples so a NoData sentinel
cannot dominate a range; `LIDAR_UNITS_UNKNOWN` distinguishes "not stated" from
"dimensionless". `basemap-bind.ts` is ~70 lines that removed two map-recreation
paths.

Machinery removed: the overlap-replacement checkbox, compulsory merged-source
publication and Q-as-prerequisite are retired rather than passed, and the epic
description now says so.

#### Material escapes, by invariant family

Three families recurred, and each points at a missing detector rather than a
missing test.

**Interaction tests that could not fail.** The CSS structural guard's first
version returned zero on the shipped-broken input; a low-space test passed with
the production cleanup deleted; `lidar-data-panel`'s interpretation case
dispatched a `change` event that never moved the radio, so it asserted a state it
had not created. In each case the test looked healthy. The detector that would
have caught all three is cheap and now applied: **probe that the subject actually
changed before trusting the assertion**, by mutating the production code or
reading the control's state.

**Regression tests that encoded the defect.** Two tests actively required map
recreation on a basemap change — the exact behaviour C4 forbids. Both were
inverted rather than deleted, because the old assertion is the clearest
description of what a reader must not reintroduce.

**Whole-rule deletions.** A bulk selector cleanup removed a selector line
together with its rule's body, silently disabling the focus-outline rule shared
by nine controls, and that round was reported complete. The `css-module-policies`
guard passed throughout because it checked token *values*, not rule *structure*.
A blank line inside a prelude is now the detector, verified against the
shipped-broken revision.

Classification: the first family is a test-oracle gap; the second an
implementation deviation the tests had blessed; the third an implementation
deviation with a genuine guard gap. None was a design omission — the contracts
were explicit in every case, and the failures were mine.

#### Handoff decisions that were missing or overprescribed

The completion contract was unusually complete. Two places cost real time.
`completion-design.md` prescribed no window manager for the isolated session, so
the GTK file chooser was unmapped and unreachable for several rounds; a window
manager fixed it at the first attempt, and the guide now requires one. The
low-space path was required to be verified but is not reachable by an
unprivileged test here — no tmpfs mount, and `RLIMIT_FSIZE` is process-wide — so
it is recorded as unverified with the probe evidence rather than papered over.
Those are environment/handoff limitations, not implementer failures, and both
were safely settled locally.

#### Effort and exchanges

Unknown in cost terms and deliberately not reconstructed. What is observable:
one whole-rework authorization produced the sequence without routine resumption,
which is the outcome the arrangement was testing. Rounds 20 and 25 were spent
entirely on harness mechanics with no product evidence, and rounds 26–30 each
landed product code, which is the honest shape of the return.

#### Highest-value next interventions

1. **Drive the import chain by breadcrumb and row** rather than typing a path
   autocompletion can truncate, with the DOM feedback loop installed first. Trial:
   a correct filename reaches GDAL and the review route appears. Owner: whoever
   takes the next pass.
2. **Run the two platform builds and one packaged smoke.** Trial: the packaged
   window opens and lists the library. Owner: needs a Windows or macOS host.
3. **Verify inspection against independently derived values in a live session.**
   Trial: a clicked and a centre-keyed sample both match an independent oracle
   across a bearing. Owner: next pass. The transform and pixel selection beneath
   it are already checked against a hand-derived Web Mercator oracle by
   `the_real_transform_lands_in_the_expected_cell`, mutation-verified by swapping
   the coordinate pair, so what a live pass adds is the *session* — the click and
   the centre key — rather than the geometry.

Everything else on the list is capability that already exists and is waiting on
one of those three.

At consolidated delivery, replace provisional conclusions with a short revision-linked synthesis covering:

- User capabilities that now work, exact supported capacity and remaining platform/service limitations; link the receipt rather than repeating test logs.
- Necessary implementation complexity versus machinery removed or reused, with a concrete reason and any maintenance consequence.
- Material escapes and pre-delivery discoveries, grouped by invariant family and classified by ownership. Repeated families call for a missing decision/detector, not a test quota.
- Handoff decisions that were missing, contradictory or overprescribed; whether the implementer could safely settle them; smallest correction and outcome.
- Tool/workflow interventions: observed failure → change → actual next-use evidence → keep/revise/drop → owner/follow-up. Clearly separate applied changes from untested proposals.
- Observed effort and courier exchanges, with included implementation/test/review/waiting scope. If unavailable, say unknown; do not reconstruct token prices, model causes or savings from test/code volume.
- The few highest-value next interventions with a falsifiable trial and decision owner. Do not turn a final debrief into an unbounded tooling backlog.

The main agent appends one independent disposition for the actual candidate and records reviewer oversights/escapes. When accepted or explicitly stopped, consolidate duplicate interim conclusions and retire launch instructions. Promote demonstrated reusable lessons into ordinary regressions, an existing tool or the narrowest operating guide; link the maintained authority here. Do not update installed skills or shared automation without separate authority. Integration and release remain distinct observed events.

## Ordered COG delivery and final debrief

### Accepted correction outcome at `34e4ded4`

The [independent review](ordered-cog-review.md#accepted-correction-at-34e4ded4) accepts the R12–R14 correction in its named scope. The prior ordered-source, native integration and C1/C2 work is retained; unlimited capacity, future workbenches, platform readiness and integration/release are not implied.

R12 derives spatial candidates from the native/reduced windows actually read, preserving the source that lies inside a reduction footprint but outside sample centres. R13 separates edit settlement from view lifetime and detaches view work on teardown. R14 owns collection and History traversals/loading independently and rejects superseded/mixed-head pages. The two tile regressions and seven added panel cases cover the concrete reproductions; the receipt records observed sensitivity checks and ordinary tests.

Independent checks at `34e4ded4`: two native tile regressions passed; focused frontend 27 passed; workspace Rust 406 passed/74 ignored; TypeScript and docs passed. Mounted reorder/Undo/Restore and zoomed-out screenshots were inspected, and the saved catalogue's current analysis source matched current head `gen-18d79dd5efb2aa2f0018`. The reviewer did not drive the GUI, repeat the full ignored-GDAL lane or repeat all frontend tests. Some screenshots show partial rendering; complete settled reopen rendering remains part of whole-rework verification. See the receipt/review for command and fixture boundaries.

### What the correction taught

The eleven-group repair at `64050896` fixed meaningful public-caller, numeric/publication, admission, legacy, Undo and dependent-result failures. Earlier independent review missed several of those boundaries. The main agent also left completion/Undo migration insufficiently concrete and overprescribed source merging before the user selected ordered COGs. These are design and reviewer contributions to rework, not solely implementation failures.

The `524eef55` review then exposed the three additional geometry/lifecycle failures despite green controls. Existing tests left selection unchanged during an edit and did not challenge the new ordered-member prefilter. The reported live pass observed panel/catalogue state with provisional Location. The repair converted those scratch counterexamples into ordinary regressions and performed a confirmed, mounted-map pass. This is demonstrated detector improvement at those boundaries, not proof of lower overall cost.

Applied and observed: R12–R14 regressions; teardown guard discovered while writing the unmount regression; reuse of the Xephyr/software-GL/private-profile recipe on its second run, promoted into `docs/agent/edition-development.md`; receipt/guide reconciliation. Historical restoration checks must compare saved starting bytes rather than HEAD. General skill/automation changes were not installed. Per-occurrence names, general asset reclamation and larger-capacity measurements were follow-ups, not accomplished tooling improvements.

The final correction review found no blocking R12–R14 findings. Its default Cargo cache invocation failed read-only; retry using the existing isolated cache passed without dependency changes. Effort, total cost and avoided exchanges are unknown. The completion assignment tests the next-use value of these concrete controls instead of adding another methodology framework.

#### Ordered COG correction outcome at `d53f4185`

Delivered in one run on `feature/bounded-raster-generations` from `524eef55` (docs merge `34bf6041`, code `d53f4185`). The three reproduced failures are repaired with an ordinary regression each, and the mounted-map observation the earlier pass left open is established in a second isolated profile.

**R12–R14.** `tile_read_bounds` now derives the candidate footprint from the windows the renderer reads — a native-scale sample's two cells per axis and a minified sample's two level-dependent reduced cells — instead of one cell of slack around the sample centres, with member filtering, checked arithmetic and the read limits retained. `LidarLayersSection.tsx` separates mutation lifetime from view lifetime: the awaited edit owns `pending` until its own settlement and only its view refresh is fenced to the submitting selection, while collection and History each own a traversal object and their own loading state, so a superseded response or page is dropped and History actions wait until both pages describe one head. Each regression was also shown to fail with the superseded behaviour restored — the old tile prefilter, the pre-fix component, and the unmount guard removed on its own. The exact cases are in the [receipt](ordered-cog-receipt.md#correction-at-d53f4185--r12r14-and-the-mounted-map).

**Mounted map.** In a fresh isolated profile the Location tab was confirmed through the UI (`Confirmed site 48.4312, 0.0911`), the imported coverage was mounted and navigated to, and the rendered composition changed in place on reorder → Undo → Restore, on the whole-layer eye and at a zoomed-out edge. Slope was created, and then a live move published a new head for which the catalogue carried exactly one new completed job and generation re-pointed to it — four edits in a row did the same. Navigating away mid-edit (unmounting the panel) still settled the edit, and the next edit from the remounted panel published, so controls were not orphaned. After Save As and an app restart the Design reopened with the layer, History and slope ready and the same composed surface. Screenshots and catalogue identities: `.rq-scratch/smoke-map-K9t/`; the final render correlates with head `gen-…0018`, topmost `mem-…0007` (`smoke-ground-b.tif`), range 150.84…1183.27.

**Machinery.** No new cache, scheduler, request framework, counter, abstraction or migration: the two traversal objects and the head-consistency check are the design's own completion/read-identity rules, and `ViewTraversal` carries no field without a caller. This correction removed no production code and changed no shared contract.

**Interventions (observed failure → smallest change → evidence → keep/revise/drop).**

- *The Xephyr/software-GL recipe existed only inside a design receipt.* Moved in reusable form to [edition development](../../agent/edition-development.md#isolated-desktop-verification-on-a-nested-x-server), with the receipt keeping its revision-labelled account. Its second use succeeded and it now records the traps that use found: Xephyr must nest in the host display, the inspector notice re-flows the panel so a control must be measured immediately before clicking it, and the Save dialog's **Name** field accepts an absolute path. **Keep.**
- *The review's diagnostic probes were scratch-only.* Recreated as ordinary repository regressions and shown red on the superseded behaviour, green on the fix. **Keep.**
- *Panel scroll drift caused several mis-clicks before it was understood.* No product change; the local driver now measures a control in the same step as the click. **Keep as a driver technique.**

**Self-review discoveries.** The teardown path started one further collection read until its guard was added (found while writing the unmount regression, not by the review), and the first `ViewTraversal` carried an unused token field that was removed before commit. **Escapes only the independent review caught** are R12–R14 themselves: the earlier panel regressions resolved their mocks immediately, and no tile regression rendered a minified tile whose member lies inside the reduction footprint.

**Limits and effort.** Both fixtures are synthetic MNT-derived crops, labelled as such in the receipt; the legacy-only UI state, Windows/macOS compilation and the external IGN lifecycle fixture remain unobserved exactly as recorded there. Elapsed work and cost: unknown, not measured.

**Decision exchanges.** None were needed. The forwarded brief and design §8 settled ownership and behaviour, so the run continued through its internal phases without a continuation prompt.

### Record during implementation

Use bd checkpoints for execution state and one `ordered-cog-receipt.md` for delivery evidence. Record only observations that affect correctness, repeatability or delivery cost: source revision, triggering behavior/command, classification, repair or unresolved decision, decisive test, and whether discovered before or after courier delivery. Keep fixture identities and useful command outputs without private rasters, absolute user paths or giant transcripts. No new metrics collector, reporting service or Markdown task tracker.

Record elapsed work or cost only if directly available, with what the measure includes (implementation, tests, review, waiting and reruns). Otherwise write unknown. Do not reconstruct tokens/model settings from Git or use the user's cost motivation as a measured result. Distinguish a guard-removal sensitivity check from a recorded failing regression before the fix. Final gate evidence identifies the actual revision; identical code may reuse a successful run.

### Consolidated delivery and independent disposition

The implementer adds one compact revision-labelled repair outcome here after completing the prompt (do not overwrite the earlier delivery outcome): demonstrated user workflows; legacy cases preserved; merge machinery removed/retained with reason; self-review discoveries; unresolved limitations; actual tooling/guide changes with their detector; observed effort/courier data or unknown. Preserve the earlier finding-to-regression map and migration Undo boundary; append R12–R14 and the mounted-map observation, exact pending evidence, and applied versus merely proposed improvements. The main agent then adds one disposition with the reviewed revision, independently observed evidence, escaped defects and ownership. Do not claim independent acceptance from self-review.

#### Ordered COG repair outcome at the review baseline

The eleven finding groups are repaired and each has a regression at the boundary the review named;
the finding-to-regression map in the [receipt](ordered-cog-receipt.md#finding-to-regression-map)
carries the disposition, and the probe round above records which regressions detect their own guard
being removed.

**What the repair actually changed.** The public collection read no longer re-acquires the catalogue
lock it already holds, and the read surfaces were split into bounded summary/member/history pages
with snapshot-bound cursors. Every ordered occurrence now has one composition rule — topmost valid —
at publication, measurement, review and reopen, so published statistics and reopened samples are the
same numbers. Admission validates one common CRS/grid anchor for a first batch, refuses a zero-valid
source by name, refuses a partially rejected batch at the publication boundary rather than only in
the panel, and measures the envelope from the current composition's extent instead of the fixed
lattice anchor. A pre-transition head is wrapped as itself rather than through its base ancestor, and
a sparse preserved composition keeps its signed chunk extent. Slope eligibility resolves through the
composition, superseded jobs settle as the scheduler's stale outcome on both routes, and readiness is
derived from result/source identity so a restart cannot resurrect a Ready result. Undo records its
target and whether it is available at all, restore compares ordered occurrence identities, and
v1.5-era catalogues migrate to a neutral baseline instead of a fabricated action chain. Edits await
their own settlement and return a typed outcome, which is what lets the panel keep controls disabled,
fence late answers and keep a refusal on screen.

**Improvements applied versus untested proposals.** Applied and verified here: the bounded
summary/member/history split, the shared composition rule, the whole-batch admission boundary, the
explicit Undo state, readiness from identity, and the legacy-shaped fixture helper the pre-repair
compatibility tests needed. Still untested proposals, left as follow-ups rather than smuggled in: a
truthful multi-name source display (the stored original filename is used now, but a second import of
the same bytes still shares one name), a measurement pass for the ordered route's memory and disk
behaviour, and general reclamation of unreferenced published assets.

**Evidence limits worth naming.** The isolated real-Desktop workflow ran on this revision. The earlier
session's conclusion that it could not was wrong for a reason worth keeping: the shell has no
`Xvfb`, but it does have `Xephyr`, and the nested server only segfaulted because it was started without
`-extension GLX` (the crash is in the host's NVIDIA EGL/GBM path). With GLX disabled, software GL and
a `0700` `XDG_RUNTIME_DIR` under `dbus-run-session`, a second instance gets its own display and its own
profile while the user's instance on `:0` is untouched; the receipt holds the recipe, the exact command
line and the two environment traps (the GTK location entry wedges the app's main loop on a
hidden-directory path segment, and a stale region under a dialog needs a resize to repaint). The pass
covered add, reorder, remove, repeated Undo to exhaustion, two restores including an equal-summary
pair, slope, a selection change during a read, a restart, and a refused foreign-CRS batch, and it read
the catalogue back as ground truth after each phase. What it did not cover is the map itself: the
isolated Design kept its provisional site, so composed values were read from the priority list and the
catalogue rather than from rendered pixels, and legacy-only states remain caller-test territory. The
sandbox lesson still stands and is narrower than it looked: processes started here cannot be observed
afterwards, so ownership of a foreign-looking window must be established through the profile it writes
into, never through `pgrep`.


## Historical purpose and evidence discipline

The records below retain revision-specific interventions. Statements such as “current design” or “next assignment” refer to their historical revision, not present execution authority.

### Historical ordered COG delivery outcome at `783e31e3`

The following is the implementer’s historical report, not current acceptance. The independent disposition above corrects its filename, compatibility, history, overlap-counter and completed-workflow claims.

**Demonstrated workflows.** The ordered model is wired through the real callers: stage → review → Apply → reopen reads the composed values back exactly; a second source is inserted above the accepted members; move down, Remove, Undo and explicit restore each publish a new head and change the composed values as the design's decisive example predicts; a stale edit is refused by name; and a committed edit refreshes its dependent analysis on settlement, which closes `canopi-kko3`. The dock shows the top-first source list with move up/down and a retained-history Remove confirmation, and History shows each version's operation, time and identity with an explicit Undo and per-version restore, in all 11 locales. The unit-level composition rule (`[100,20,0]`, move, restore) and the preserved-composition value/validity rule are proven directly as well.

**Legacy cases preserved.** `legacy-dense-v1` and `cog-chunks-v1` generations stay readable through their own accepted readers; a pre-transition head becomes one indivisible `previous-composition` member that references the original preserved generation, so no wrapper nests, its own values and coverage mask stay authoritative, and its files are never rewritten. Persisted slope results remain sparse resolved chunks.

**Import route.** The review now confirms **Add sources** and states that the selection is inserted above the accepted sources; the retired overlap decisions, exact overlap counters and Before/After merge tabs are gone from that route, and the confirmation is refused while any selection is incompatible. The backend preview command is retained deliberately: its Before/After renderers remain the detector for "the accepted head's own composed values", and the design's later interaction slice owns retiring the old preview entry points. No frontend path reaches a merge decision.

**Merge machinery removed / retained.** Removed: chunk materialization and its publication/undo callers, the opaque-base overlay occurrence, the role-based undo member matcher and the reduction-cell record lookup that assumed a stored chunk store. Retained deliberately: `lidar_generation_members`, `GenerationChunkReader`, `persisted_chunks`, the dense read path and the compatibility lease, because preserved generations, persisted analysis results and their regression tests still read through them.

**Self-review discoveries.** Three defects were found and fixed by the caller test rather than by inspection: the review union excluded the accepted head's own lattice for an ordered generation, so every accepted cell read as uncovered (`legacy = resolved.is_empty()` now seeds it); the tile renderer treated every block of an ordered composition as absent because `chunk_at` has no store to consult (`chunk_is_occupied` now derives membership from the block index); and a minified tile tried to read a footprint area instead of its occupied chunks, tripping the reduction-read cap. The `canopi-kko3` regression itself first deadlocked on a nested catalogue lock in the test helper, which is a test-side mistake worth recording: the catalogue is one mutex-guarded handle and a helper must not lock it twice.

**Unresolved limitations.** The isolated real-Desktop workflow was not driven in this environment, so that acceptance item is pending with exact runnable steps rather than passed. `LidarLayerSource.filename` is a stable 12-character identity cue, not the original file name, because the catalogue does not retain one; a truthful name needs a new column and is a follow-up. Display bounds remain the occupied-block envelope, matching the superseded route. No capacity or disk measurement was made for the ordered route, whose memory figures would be a new campaign rather than a reused result.

**Tooling and guide changes.** No task-local script or diagnostic needed repair; the friction recorded here is a design-record gap, not a tooling defect. Operating guides updated with their detector: [LiDAR](../../agent/lidar.md) now names the ordered composition, the resolver seams, the compatibility lease and the `canopi-kko3` decision; [build-release](../../agent/build-release.md) keeps its engine description; the design, its assignment and [ADR 0027](../../adr/0027-ordered-cog-data-layers.md) carry their delivered status and link the `ordered-cog-receipt.md` at `783e31e3`, so a later agent reads the shipped contract instead of the superseded plan.

**Observed effort.** Unknown. Elapsed implementation, test and review time was not recorded, and no token, cost or model comparison is claimed.



### Product-closure reset after `6a5130b3`

The user and main agent judged the completion process disproportionate: repeated repair→review→new-prompt cycles, broad reruns, lengthy receipts and defensive detail displaced real Desktop verification. The COG/sparse/history architecture remains justified by the product requirements. The main agent owns its contribution: increasingly detailed recovery prescriptions, missed caller boundaries, and insufficient prioritization of product risk versus exhaustive contract closure. This is a process judgment, not a measured causal comparison of models, languages or skills.

Observed review evidence: 152 native/GDAL tests independently passed in 482.58 seconds, but two cleanup edges remained and the receipt named lifecycle tests absent from the committed tree. The correct response is a bounded repair and factual evidence correction—not another verification framework. Preserve the genuine iterator and publication improvements.

The [product-closure policy](collaboration-protocol.md#product-closure-policy) is the intervention: freeze architecture/scope; focused repair tests; required broad gates on the final candidate; real Desktop import→overlap→display→slope→restart→undo. The main agent's next review is diff/risk-focused. Unsupported UI access produces a runnable user smoke handoff, not a new harness.

For the final debrief, compare actual workflows demonstrated, safety defects caught before versus after courier delivery, necessary decisions versus avoidable continuation messages, repeated runs on identical code, and effort/cost only where recorded. Name main-agent design/review omissions separately from implementation/test omissions and unsupported reporting. Record whether this narrower intervention actually improved delivery; do not declare success from shorter documents or higher test counts. Promote only demonstrated reusable lessons into tooling/skills under separate authority. One compact outcome in this record suffices.

#### Product-closure outcome

**Workflows demonstrated in the real Desktop** (isolated profile: private D-Bus session, fresh `XDG_*`, `devUrl` on 1430, hit-test-verified synthetic input, the user's own instance and ports 1420/1422 untouched): create a LiDAR layer → import the real IGN MNT fixture from the native file dialog → review reported 1 km² uncovered with exact counts 4,000,000 / 0 / 0 → Before/After previews → Apply → `Import complete`, `0.5 m resolution · 1 km² coverage` → slope analysis `ready` → a second, partially overlapping authored import reported 40,000 m² overlap and published the replacement → the sparse generation rendered on MapLibre with the replaced window visible → visibility toggles and pan/zoom → design saved, app closed, relaunched, design reopened with layer, coverage, visibility and spatial frame intact → history *Undo import* re-pointed the head (members reverted, composed `min_value` 100.0 → 150.84) → a foreign-CRS import was refused by name. Screenshots were transient; the command, profile layout and step list are in the `bounded-generation-receipt.md` at `783e31e3`.


**Safety defects caught before courier delivery**: three lifecycle tests the previous receipt counted as passing were absent from the committed tree (the independent review found this; they were re-added and pass); the collision path could have deleted a competing file the job did not create (C1 now refuses adoption and requires positive file identity); journal clearing swallowed unlink errors (C2 now routes commit, rollback and recovery through one fallible clear); the wide-fixture claim rested on a counterfactual cell count no test exercised (replaced by value-level assertions at the far page).

**Test-strength gap caught by a self-check, not by the reviewer**: a guard-removal probe round on the delivered revision (patch one guard, run the named regression, restore and verify the file) showed that the first C1/C2 regressions did not detect two of the behaviours they were written for — forcing file identity to `true` deleted a content-equal foreign file without failing any test, and swallowing a real journal-unlink error was invisible because the fault seam short-circuited before the unlink. Both were closed before delivery (the seam now routes through the same error arm; the interrupted-intent regression gained a stale-intent-with-witness phase), and the probes now fail exactly the named tests while the unpatched control passes. This is sensitivity evidence on the delivered revision, **not** a recorded RED-before-GREEN; no such claim is made anywhere in the receipt.

**Defects that escaped to the courier** (observation-level, no data loss): after a successful undo the open History view and the canvas kept pre-undo state until the view was reopened and the app restarted; the preserved `invalid_cells` meaning reads as a data-quality verdict on partial imports; history entries are numbered within one generation's own job list; chunk seams are visible at low zoom; and an undo does not refresh dependent analyses, so the slope of the undone composition stayed on display as current (filed as `canopi-kko3` with the recompute-versus-re-point decision, because the design does not settle it).

**Decisions that genuinely need the courier**: whether the `Invalid` label/definition should change (product wording, not a contract change); whether undo must live-refresh the open history view and the canvas (a small frontend fix outside the frozen scope); whether an automated Desktop smoke is worth building; the 400M-cell capacity gate (host RAM) that still holds the production limits.

**Measured effort**: the native/GDAL route grew from 152 to 158 tests and the lane took 586.58 s on the final candidate; the fixture module separately took 226 s (MNT) and 132 s (MNH, one test meaningful, two blocked by a missing fixture path in that lane's environment); the workspace suite 21 s; the smoke needed one scripted XTEST drive per step with a handful of coordinate corrections. Token cost, model settings and per-review durations remain unrecorded and are not estimated here.



### Caller-boundary review — `eb64a853`

150 native/GDAL tests independently passed; the [review](bounded-generation-review.md) nevertheless identifies transformed-page loss and three publication-lifecycle escapes. Useful implementation gains are retained. The cost of this review and implementation has not been measured comprehensively; more tests or fewer prompts cannot establish savings.

The previous intervention improved helper behavior but tests still stopped before the decisive boundary: aligned synthetic index rows did not exercise transformed page ordering; recovery-helper retention excluded the following root deletion; post-commit fault tests excluded settlement. Classification is implementation/test coverage gaps **and** main-agent handoff omissions: the preceding plan did not supply the cross-page offset example or make outer settlement/startup the explicit test endpoint. Both agents own correction, not the courier.

The next intervention is deliberately small: one globally monotone stream design, one promotion/commit/cleanup owner, and tests ending at real review, settlement and reopen. No new evaluator, checklist system or skill rewrite. At the consolidated response, record the exact cases that failed before repair, internally caught defects versus independent escapes, any remaining architectural ambiguity, and courier exchanges that resolved actual decisions versus merely resumed work. Carry these revision-linked outcomes into the final debrief. A reusable skills change requires evidence that existing instructions are insufficient—not simply another occurrence of a rule already stated.

### Correction review — `9ad85c18`

137 native/GDAL tests independently passed and several production contracts improved; three gaps remain in the [review](bounded-generation-review.md). No measured total cost saving is established. The main agent missed the review-envelope traversal in its prior review; the response is a precise caller regression, not attributing all rework to the implementer.

| Escaped invariant | Classification / owner | Small intervention in the next assignment |
| --- | --- | --- |
| Paged tile reads coexist with an empty-envelope review walk | Caller coverage gap and reviewer oversight; both agents | Compare actual review visits for adjacent versus million-cell-separated inputs; retain exact counts and Before/After values |
| Shared assets survive, but new unpublished source assets lack cleanup ownership | Lifecycle implementation gap; main agent now settles ownership, implementer wires it | Job-owned staging through AwaitReview; recoverable promotion intent and atomic catalogue ownership; test new and reused assets separately |
| Correct RSS summation still admits a run with no complete workload sample | Test/measurement gap; implementer fixes and main agent reviews claim boundary | Exercise real finish→gate with healthy, absent, incomplete and over-budget partial observations |

At delivery, append only the outcome of these interventions: which cases failed before and pass after, in-scope defects caught before forwarding, independent escapes, and any remaining instruction ambiguity. The final debrief should compare delivered user workflows and independently accepted invariants with observed effort/courier decisions, not test counts. No further reporting framework, transcript quota or skill rewrite is authorized. A new skill rule is justified only by a reusable lesson that existing rules do not already cover.

### Bounded-generation delivery review — `1fcab504`

The [independent review](bounded-generation-review.md) records real caller progress and five incomplete contracts; seven tile tests were independently rerun, not the entire delivery. Preserve this distinction: production wiring is progress, but an implementation receipt cannot redefine retained source COGs as optional or a parent-process observation as combined memory evidence. No total cost/time saving is established.

| Observed escape | Classification / response owner | Small intervention to test in the correction |
| --- | --- | --- |
| Explicit source-COG retention became future work after several windows | Scope/implementation deviation and handoff drift; implementer completes, main agent checks original requirement | One real stage→Apply→reopen test asserts retained source identity and absence of new durable raw/mask duplicates; checkpoint notes preserve unfinished required outcomes |
| Tests bless a level-10 display clamp; complete footprint crosses chunks | Implementation/test-oracle gap; main agent supplies independent cases, implementer fixes | Four equal-area chunks 0/10/20/30 → 15; unequal valid counts → weighted mean; actual tile test beyond one-chunk footprint |
| Paged helpers exist but a tile still collects the entire generation | Caller-wiring/coverage gap; implementer traces live callers | Multi-page real catalogue case measures bounded page size and excludes irrelevant rows, including whole-generation jobs that must stream |
| End-of-run maximum presented as combined memory; a constant retained while admission bypasses it | Measurement and effective-policy gaps; implementer repairs, main agent checks claim boundaries | Simultaneous parent/descendant sampling plus controlled child; real sparse admission refuses one-over-limit before publication |
| Receipt contains mutually exclusive current states | Documentation drift across windows; implementer reconciles, reviewer verifies | One current scope/admission/measurement summary; old observations revision-labelled, not competing instructions |

The main agent also contributed process ambiguity by describing a whole batch without clearly separating authorization from execution windows. The courier repeatedly forwarded continuation without an architectural decision. The updated [protocol](collaboration-protocol.md#one-bounded-loop) permits resumable checkpoints under the same authorization; it does not excuse partial work being labelled complete. The broad original design also lacked the decisive multi-chunk and multi-process examples now supplied. These contributions do not establish a model or skill failure.

On the next consolidated delivery, record whether the five original contracts are actually met, which same-family defects self-review caught, which escaped independently, and whether any courier exchange resolved a real decision rather than simply continuing work. Keep unavailable 400M/platform evidence separate. Use measured effort only; do not derive productivity from commits, tests or document length. No new evaluator, mandatory mutation campaign or upstream skill modification is authorized. Promote only lessons supported by subsequent outcomes into tooling or skills through a separately scoped change.

### Design correction before implementation — standard COG persistence

At `24fd1a56`, the main agent prescribed a new durable raw Float32/byte-mask block format despite accepted `a5fc7d7b` already preparing and reading controlled COGs. The user challenged why those standard files were not retained. No implemented failure established that TIFF encoding was insufficient. Classification: **main-agent design overprescription and missing necessity/reuse check**, not an implementation deviation. The bounded/sparse/history requirements were valid; the custom pixel encoding was not shown necessary. No implementation of that proposal is claimed.

The revised [design](bounded-generation-design.md#necessity-and-reuse-check) retains prepared source COGs and standard resolved COG chunks, keeps application history/index responsibilities, and explicitly budgets their extra storage. It settles source NoData versus composed NaN validity and separate quality storage without relying on unverified internal-mask support. This is a design correction, not evidence of successful interoperability or a measured cost reduction; B1's ordinary production round-trip must establish those claims before the remaining migration proceeds.

The process intervention is a short necessity/reuse justification in the existing handoff and an early decisive integration test, with automatic continuation on success. Main agent owns architecture/review; implementer owns implementation and routine simplification; user remains courier/approval, not technical contradiction resolver. No added qualification framework, mandatory report or skill change.

At the consolidated delivery/review, record: standard source files actually reused without re-preparation; durable custom payload stores avoided or unexpectedly added; old/new supported workflows demonstrated; assumptions challenged before dependent code; material design corrections returned through the courier; independent escapes by family; and known storage/performance costs. Record effort only when measured. A smaller encoding surface supports a maintenance hypothesis, not a claim that this whole architecture or the agent setup is optimal. Retain the intervention only if outcomes support it; revise it if it creates more ceremony or merely moves custom complexity elsewhere.

### Prior intervention at `ced5a1aa` — one complete bounded-generation workflow

G1–G5 plus one correction reached [independent acceptance](geolibre-integration-review.md#final-independent-acceptance--a5fc7d7b) at `a5fc7d7b`: 53 focused native and 7 GDAL-backed tests were independently repeated. No claim is made that the full private-fixture/platform evidence was repeated. Product progress is bounded production extraction/postprocessing; large sparse composition remains unimplemented. This closes the prior cycle rather than authorizing another generic hardening pass.

The [B1–B5 design](bounded-generation-design.md) is the next process intervention: main agent fixes the durable representation and all dependent caller contracts before delegation, implementation agent completes migration/verification in one batch, user forwards one consolidated delivery. Routine internal design choices and repairs are delegated; public ownership, scientific or engine changes outside that contract are not. New storage is not useful progress if review, undo, display or slope cannot consume it.

At delivery, record acceptance examples actually demonstrated, production dense paths removed/retained, resource gates measured/unavailable and whether limits remained gated. Separate self-review discoveries from independent escapes. Compare the number and kind of **material decisions returned to the user**, not internal commit/test counts. Record cost/time only if observed. Benefit is unproven until review shows complete supported workflows and no known acceptance blocker; a large batch is not automatically cheaper or better.

Retain the D1 lesson as a production capacity regression, not a new tool: sum simultaneous resources through the real caller and give an independently calculated boundary example. Retain R1's lesson by naming the resource owner actually tested; the new lifecycle migration explicitly includes its previously deferred cleanup. Any new omission in this design is the main agent's responsibility to settle, not evidence of implementer inability. At the final debrief, promote only demonstrated portable improvements through separately authorized skill/tooling changes.

### Native integration review — `3004e4d3`

G1–G5 delivered real bounded extraction and slope postprocessing in one consolidated batch. Existing UI and dense composition limits remain. The [independent disposition](geolibre-integration-review.md) retains this progress and records one acceptance blocker, not a restart. Prior test/lifecycle results are implementer-reported: the reviewer inspected source but could not rerun tests with either available offline dependency cache. Cost/time savings are unmeasured.

| Observation / classification | Small intervention and owner | What the next delivery must establish |
| --- | --- | --- |
| Separate disk checks miss simultaneous footprint; implementation deviation and test gap. The plan required the sum but omitted a decisive example. | Main agent supplies independently calculated combined-budget cases; implementer wires one estimate through actual preparation and import. | 265 MiB rejects a 269 MiB request before outputs, even though both old checks pass; exact-boundary control passes; caller includes raw and mask bytes. |
| Derivative cleanup was generalized to whole-analysis cleanup; reporting/test-scope gap, partly inherited lifecycle debt. | Implementer narrows claims and tracks inherited staging cleanup separately; reviewer does not silently expand this repair into a lifecycle rewrite. | Receipt names the resource actually covered and links a concrete follow-up; no false claim that inherited debt is repaired. |
| Independent rerun blocked by incomplete caches; environment limitation. | Implementer records the actual dependency/build route and exact commands; reviewer distinguishes reported from independently repeated evidence. | Reproducible commands and honest unavailable checks, not another qualification framework. |

The retired [follow-up](geolibre-integration-followup-agent-prompt.md) delegated routine implementation, regression organization, in-scope repairs and dependency restoration through one delivery; its findings are now closed at `a5fc7d7b`. That bounded outcome is evidence of closure, not proof of general cost savings or model/skill causation.

### Predecessor intervention — product integration and one consolidated handoff

The user selected useful GeoLibre components with existing features/UI preserved first. The [settled native design](geolibre-integration-design.md) supersedes artifact-brief sequencing and the Q→production dependency. G1–G5 and its correction are accepted; B1–B5 above is current. Earlier entries below are revision-linked history, not current assignments. Q stays unqualified and frozen; known defects have not been accepted.

The main agent inspected real import/analysis callers and GeoLibre's pinned native core, and settled source/build identity, private interfaces, preparation, cleanup, compatibility and scope before delegation. Important limits are explicit: this batch adopts a dependency used by GeoLibre, not the entire toolkit; it removes dense extraction/postprocessing, not dense composition; old capacity limits remain. No new ADR or glossary entry was needed for this reversible private adapter choice, and no domain terminology changed.

Process hypothesis: one meaningful batch of production caller changes, with routine decisions delegated and one independent review through the user, will reduce avoidable exchanges. The user prefers concentrating implementation effort in the cost-effective agent; actual cost/time savings are not yet measured. Do not promise that review defects or necessary architecture decisions disappear.

For the final debrief, add one outcome per delivered batch in this section, with the delivery revision and receipt link. Record:

- Accepted application behavior and remaining user-visible limitation, not only source/test counts.
- Which decisions were already settled, which routine choices the implementer made, and which courier escalations exposed design omissions.
- Self-review discoveries, independent escapes and reviewer corrections; distinguish implementation deviation, test gap and design/review omission using evidence.
- Actual implementation/review effort and courier exchanges where recorded; leave missing cost/time unknown.
- Whether a smaller reusable test or documentation fix would prevent the demonstrated failure; promote it only when useful, without creating another framework or automatic skill rewrite.

The implementation receipt supplies facts; the main agent adds independent acceptance and review effort afterward. Success means accepted product progress per handoff while preserving correctness, not the absence of review or completion of frozen Q tooling.

### User-approved stop to harness hardening

After `a162c1a0`, the user approved the main agent's recommendation to [reset qualification scope](qualification-reset.md). The lifecycle prompt was withdrawn before any completion was established. Preserve any intervening work rather than assuming none exists. The next assignment is one artifact decision brief, with no code, builds or experiments. Full Q and production acceptance are unchanged.

Main-agent accountability: repeated reviews found real defects, but I kept turning them into more harness infrastructure without sufficiently testing whether that work changed the engine decision or advanced the product. The artifact mismatch was already documented; more runs of the same published build could not resolve it. Roughly 4,800 added lines in `f9b5c10c`, repeated tooling-only deliveries and N1 still unstarted are evidence of scope growth; cost, token usage and comparative model performance were not measured. The earlier claim that more explicit handoffs would reduce cycling remains unproven.

| Retain | Stop/defer | Evidence to evaluate the reset |
| --- | --- | --- |
| Correct saved numeric/transport observations, source/artifact identities, Rust bridge and decoder reuse, meaningful regression tests | General harness completion, reusable lifecycle perfection, further Python retirement and new producer/schema layers without a decision need | Does the next brief make the artifact choice actionable without a code-change round? |
| Input preservation, bounded reads, honest failures, real termination/output safety for any future run | Treating process exit as proof of long-lived production cancellation; claiming the known launcher is safe because it once passed | Does the next approved experiment answer one unresolved engine risk with a small safe disposable instrument? |
| User courier/engine/UI authority and main-agent architecture responsibility | Silent waiver of Q/production contracts or retrospective relabelling of defects as optional | Are any revised acceptance boundaries explicit before execution, and does work then advance toward the product? |

For the final debrief, distinguish **necessary correctness repair** from **unnecessary scope creating more surfaces to repair**. A real bug can belong to both. Record what was reused, what was frozen, which decisions changed and subsequent product milestones; do not equate fewer reviews with better safety or more tests with progress. Keep this intervention provisional until outcomes exist. No new metrics framework or per-defect report is requested.

### Project-wide architecture ownership

On 2026-09-20 the user approved making the main agent responsible for architectural coherence across Canopi, including resolving omissions in its handoffs. The [project-wide workflow](../../workflow/architecture-ownership.md) now owns responsibilities, proportional review triggers, routine implementation autonomy and the courier boundary; the raster protocol references it. This is an adopted operating decision, not a measured productivity gain or a change to the active Desktop pilot's scope.

For subsequent review entries, distinguish design omission, implementation deviation, test gap and reviewer oversight using revision-linked evidence; categories may overlap. Test the change on the next delivery by recording whether interfaces/ownership needed redesign during implementation, what decisions required a courier exchange, and which findings were genuinely new requirements. The main agent must resolve contradictory instructions rather than leaving that task to the user. Do not retroactively assign causes to earlier rounds without supporting evidence.

Current disposition: bounded NC1–NC2/MR1 work is independently accepted at `579880be`; the [repair loop is closed](q-typescript-review.md#numeric-completion-independent-acceptance). The Desktop bridge transport slice is delivered at `fab0c381`: an isolated host measured Q-LOCAL-1 and Q-HOST-1 on a generated fixture and awaits one independent review, which is the next step. The [collaboration protocol](collaboration-protocol.md) assigns settled design and independent review to the main agent, execution/evidence to the implementation agent, and forwarding/approval to the user.

### Continuous-improvement checkpoint after tooling acceptance

Observed outcome: the independent 125-case counter matrix matched expected ledger outcomes and existing gates passed. This supports acceptance of the bounded numeric slice, not exhaustive evaluator correctness or a new raster capability. No real Q capability was added. The next progress measure is whether a real worker/native bridge/host run produces admissible observations, including honest failure where artifact correspondence is unresolved.

The next slice tests three process improvements: explicit native-read ownership should make byte provenance reviewable; tracing each capability to its positive producer should prevent MR1-style naming assumptions; consumer inventory plus replacement coverage should permit a concrete Python deletion without losing evidence. Record whether each helped, actual discoveries and residual gaps in the existing receipt. Timing/cost stays unknown unless recorded. Do not infer that a model, language or added test count caused improvement.

The main agent preserves accepted scope and consolidates blockers; the implementer self-reviews before courier delivery; the user should not need to reconcile contradictory prompts. Maintain one current handoff, retire executed prompts and distinguish measured, accepted, integrated and released states. Improvements to shared tooling/skills require evidence and separate scope; this agreement does not authorize direct agent-to-agent automation.

### Boundary-repair debrief evidence

At `933fb593`, the reviewer independently confirmed the original cases repaired and reran 266 TypeScript tests, 261 Python regressions and 18 runner checks successfully. Two counterexamples escaped: a shared finite-number parser admitted fractional discrete counts, and a three-operand guard suppressed a contradiction requiring only two operands. Record these as retained-domain-semantics and comparison-dependency coverage gaps, not a need for another architecture. Earlier review did not expose these exact cases; distinguish newly observed behavior from a newly introduced requirement.

The readiness statement also mistook a named negative-control producer for a positive transport capability. MR1 was corrected by tracing `cmd_q2_local_bridge` to its rejection assertions, not by running an experiment. Future readiness inventories should cite the successful operation and observable assertion, not just a filename or command label. Test that practice on the next authorized inventory before promoting it into a skill or repository-wide rule.

Product-progress delta for this delivery: original boundary cases repaired; **zero new real Q capabilities demonstrated**, Q unqualified, production N1 unstarted. Hypotheses for reducing another escape are unit-aware counter cases and explicit operand-pair tests. The next receipt should show whether those detectors catch deliberately removed checks, not merely a higher test count. Effort/cost remains unknown where not measured. No language/model causal claim is supported.

### Product-progress checkpoint and debrief method

The user approved shifting emphasis from repeated harness repair to mandatory capabilities demonstrated and implementation slices accepted. UI references are approved; the engine route and qualification contracts are clearer; the TypeScript decision path is implemented but not yet independently accepted. Q remains unqualified and N1 unstarted. None of the latest synthetic-tooling results proves new real raster capability.

Finish B1–B3, independently review those boundaries and their bounded sweep, then stop broadening tooling work unless a concrete defect threatens qualification validity or input preservation. The next intended milestone is separately authorized fresh qualification evidence, with scoped local bridge and Desktop WebView hosting first because they can invalidate the intended route. Remaining mandatory correctness, lifecycle and resource evidence still gates Q; prioritization does not waive requirements. N1 follows Q acceptance, not tooling acceptance.

For each subsequent delivery, record in the existing receipt: baseline/final revisions, mandatory Q requirement IDs newly supported by real evidence and their route/environment, independently accepted implementation slices, remaining critical-path blockers, and authorization needed next. Record zero capability gain explicitly for tooling-only work. Test counts and mutation totals remain verification context, not progress or productivity proxies. Elapsed implementation/review effort, cost and courier cycles should be recorded only when observed; do not reconstruct missing timings.

For the final debrief compare the settled-design implementation and bounded repair with earlier rounds: escaped invariant families, which were found by self-review versus independent review, invalid fixture expectations, reviewer coverage omissions, and time spent on tooling versus measurements versus product implementation where known. Earlier reviews found individual examples without a sufficiently complete acceptance boundary; the new driver still permits early returns inside checks. Those are actionable methodology observations, not evidence of a language/model cause. Candidate improvements are targeted semantic retention tests and absent-path alias tests; promote them into tooling only when demonstrated effective. Do not create or change skills on the strength of untested hypotheses.

Round 1 debrief evidence: 127 TypeScript tests, 261 Python regressions and 14 runner checks independently pass, yet additional family-level CLI mutations still produce false passes and lost failures. Permanent resource gaps can conceal incorrect individual assertions. Declaring one reducer does not prevent comparisons omitted upstream. Earlier reviews also missed existing paths; distinguish expanded review coverage from new requirements or regressions. Full reproductions, retained fixes, environment details and unmeasured evidence are recorded once in the standing review. No time/cost improvement or language-effect claim is established by this round.

## Consolidated independent review and migration baseline

### Round 2 reassessment evidence

At `6a98cd33`, the reviewer independently reran compilation, 177 TypeScript tests, 261 Python regressions, 14 runner checks and docs/diff checks successfully. CLI perturbations nevertheless exposed R2-A–R2-D: missing fields hid independently known display/artifact failures; consistent request/render counters did not establish the required number of tile samples; and rejected-input publication overwrote a disposable source report. Exact mutations and limits live in the standing review rather than being duplicated here.

The escaped invariant families recur across rounds: failure retention, semantic sufficiency and input preservation. The final output-safety example extends review into the rejection path; a successful-path collision test was insufficient. Earlier implementer sweeps and independent reviews both missed sibling paths. This is evidence of inadequate coverage, not evidence that TypeScript or a particular model caused the failure.

The approved process response is a design checkpoint. The reassessment must trace which independent checks execute before reduction, compare bounded alternatives and propose a test matrix derived from obligations and dependencies. The hypothesis is that making omitted comparisons harder and testing failure-plus-gap combinations systematically will reduce escaped families; it is not yet a measured improvement. Preserve positive controls and accepted fixes. Keep implementation approval separate from approving the reassessment assignment.

For the final debrief compare baseline, Round 1, Round 2 and any later explicitly authorized work by escaped invariant family, self-review discoveries, invalid controls, coverage omissions, user handoffs and review outcome. Record elapsed effort/cost only where measured (currently not established); do not use line counts, test counts or mutation totals as proxies for correctness or efficiency. Success means independently accepted behavior with fewer recurring escapes, not merely fewer messages. No additional implementation round is authorized by this measurement plan.

### User-mediated repair protocol

The user explicitly retained the courier role. The process change is fewer, fuller handoffs, not less oversight: one standing prompt, one review record, one updated implementation receipt, and fixed C1–C8 criteria. Baseline TypeScript review is round 0; count subsequent consolidated repair deliveries plus independent reviews as rounds 1 and 2. After two unsuccessful rounds, report the structural problem and options to the user instead of silently extending the loop. An accepted round stops the repair assignment, not the qualification gate.

At final debrief, compare escaped invariant families and user handoffs before/after this protocol. Record self-review discoveries, mutations attempted and omissions, invalid positive controls, reason-preservation failures, sandbox-only failures and optional findings kept out of acceptance. Independent review must cover the full agreed boundary before returning one consolidated result, distinguish accepted/blocked/unreviewed behavior, and cite C IDs for new blockers. The reviewer must not substitute incremental example reviews or cosmetic demands for the agreed contract. Preserve unknown time/cost as unknown; do not claim the new workflow reduced effort without evidence.


At `3a7ec9eb` the reviewer independently ran 261 Python tests, 13/13 stub-runner checks, documentation validation and diff checks successfully. Small in-memory controls through the real assembler/evaluator nevertheless reproduced:

| Contract | Starting control and perturbation | Observed defect |
| --- | --- | --- |
| C6 | `passing_evidence()` with admission labels but no supporting declarations/provenance | Overall pass through the public evaluator |
| C6/C8 | Set an entry's admission verdict to fail and `sourceAdmitted` to true | Requirement still passes |
| C2/C6 | NaN bundle generation time; separately, unadmitted entry with list-valued `observed` | NaN passes; list causes `AttributeError` |
| C5 | Passing candidate run split into two records, one lacking queue depth and the other active reads | Incomplete records combine into a passing resource requirement |
| C5 | Append a second otherwise complete candidate run with 900 ms sampling after a 100 ms control | Resource requirement passes using first-record sampling |

Reproduction entry points at that revision: `test_qualification_gate.passing_evidence`, `passing_reports`, `assembly`, `qualification_evidence.assemble`, and `qualification_gate.evaluate`. The reviewer intercepted fixture filesystem access in memory, not admission/verdict logic. No private evidence or engine experiments were rerun. The implementation's fourteen sensitivity probes and private one-fail/eleven-inconclusive reconciliation were not independently rerun. These findings do not invalidate every repaired case; they prevent acceptance of the complete boundary.

### Final debrief evidence to collect

The migration is a user-selected maintenance direction, not proof that Python caused the defects. Testable hypotheses: independently specified valid controls, one parsing/reduction path and per-run reductions will reduce escaped false passes; reuse of the existing TypeScript toolchain will reduce tooling fragmentation. A language port without those changes may preserve the defects.

For the TypeScript receipt, record baseline/final source and test size, direct dependencies, number of authoritative evaluator entry points, contract assertions with traceable positive evidence or explicit gaps, independent-review rounds and escaped invariant failures. Record elapsed effort/cost only if measured; do not infer it from test count or model names. Retain exact commands and sanitized RED/GREEN, mutation and CLI counterexamples. Track implementation work in bd, not this table.

At final debrief, distinguish requirement omissions, implementation violations, fixture/oracle defects and reviewer coverage gaps. The reviewer also contributed to earlier back-and-forth by reviewing narrow examples rather than the complete boundary. Compare whether the stable matrix reduced handoffs, not just whether the test count rose. The implementer's reported aspirational evidence map (32 of 42 prefixes absent before correction) is a provenance lesson: name coverage is not semantic adequacy. Audit mappings against actual producer observations.

Promote only demonstrated improvements into regression tests/tooling or existing operating guides. No skill changes are authorized by this handoff. Retire the replacement prompt after delivery; preserve one migration receipt with measured outcomes and independent disposition. Do not declare the approach successful until independent acceptance, and do not confuse harness acceptance with Q qualification.

Retain the user-requested basis for a final debrief without confusing agent claims with accepted results. References below identify the reviewed revisions; local file links identify the relevant code but may move as repairs land. Use `git show <revision>:<path>` to recover the exact reviewed source. The current Q receipt is a living report, not an immutable history of earlier claims.

The reviewer inspected source and ran targeted in-memory verdict reproductions. The second review additionally ran all 14 committed qualification regression tests successfully. Neither review reran the complete large-fixture/browser pipeline or independently verified the implementer's entire reported quality-gate run. Execution transcripts and proof of which skills the implementer loaded were not available to the reviewer. No claim about intent or general model capability follows from these observations.

## Review sequence

| Revision / artifact | Implementer claim | Independent finding / disposition |
| --- | --- | --- |
| `0e696722`, approval recorded in `ab2f7d25` | Seven HTML reference surfaces prepared | User explicitly approved the UI proposal. This does not qualify the engine. |
| `fd86de68`, first Q receipt | Several experiments passed; two engine decisions requested | Q not accepted. Decoder failure/no windows and inconclusive aggregation reproduced as pass. Numeric I/O preloaded files; cancellation, CRS and resource checks were proxies. Native GDAL slope and preparation were already allowed, so those questions were mis-framed. |
| [First correction prompt](q-correction-agent-prompt.md), saved in `8dcb1c70` | Broad request to repair and complete Q, including GeoLibre reuse investigation | Historical instructions. Asked for tests first but did not explicitly require skill invocation or valid positive controls for every negative test. |
| `cfbb0c35`, corrected Q receipt | Ten experiments and aggregate pass; 218 assertions; 14 regression tests pass | Regression suite independently passes. Q still not accepted: missing mandatory evidence remains outside verdicts, cancellation still tests a substitute, and new Q6 false passes reproduced. |
| [Gate-only repair prompt](q-gate-repair-agent-prompt.md), `f637de31` | Narrow evaluator repair, explicit TDD/craft and evidence mapping | Executed in `95310b85`, `99832cc5`, `47b9d508`; now retired. |
| [Gate repair receipt](q-gate-repair-receipt.md), reviewed at `47b9d508` | Requirement contract; overall fail, 1 fail / 7 inconclusive / 4 pass; 64 tests green | Reviewer independently reran all 64 tests, docs validation and diff checks successfully. Repair not accepted: R3 false passes remain, including unsupported individual passing requirements. No private experiments rerun. |
| [Evidence integrity prompt](q-evidence-integrity-agent-prompt.md), `0cc3b8fa` | Raw-report-to-gate regression controls, evidence admission and correspondence | Executed in `2c830b0d`, with bead records through `d963f755`; retired. |
| [Evidence integrity receipt](q-evidence-integrity-receipt.md), reviewed at `d963f755` | 115 passing tests, nine reported sensitivity checks; existing records yield 12 inconclusive | Reviewer independently reran all 115 tests, docs and diff checks successfully. Repair not accepted: R4 findings below. Private report reconciliation and sensitivity checks were not independently rerun. |
| [Admission completeness prompt](q-admission-completeness-agent-prompt.md), `c94b7c7f` | Explicit required-set coverage, run provenance and monotonic failure precedence | Executed in `50c1211e`, with delivery records through `578e3bdb`; retired. |
| [Admission completeness receipt](q-admission-completeness-receipt.md), reviewed through `578e3bdb` | 168 tests, ten reported sensitivity checks and captured cycle excerpts; existing evidence twelve-inconclusive | All 168 tests and docs/diff checks independently pass. Repair not accepted: R5 findings below. Private evidence reconciliation and sensitivity mutations not independently rerun. |
| [Declaration/precedence prompt](q-declaration-precedence-agent-prompt.md), `35c6166b` | Validate both declarations and observations; test independent failure/gap combinations | Executed in the declaration/precedence repair; prompt retired. |
| [Declaration/precedence receipt](q-declaration-precedence-receipt.md), reviewed at `5becb043` | One validated declaration path for CLI and assembly; gap-based early return removed; findings read independently of `result`; 209 tests, four reported sensitivity probes and captured cycle excerpts; existing evidence twelve-inconclusive | Exact R5 reproductions independently fixed; retain those repairs. Full admission remained blocked by consolidated C1–C8 findings. Private reconciliation and sensitivity mutations not independently rerun. |
| [Consolidated repair receipt](q-consolidated-repair-receipt.md), reviewed at `3a7ec9eb` | C1–C8 repaired; 261 tests, sensitivity probes and adversarial self-review; existing evidence one fail and eleven inconclusive | Tests and stub runner independently pass, but C5/C6/C8 counterexamples above remain. Complete gate not accepted. Superseded as the qualification authority by the TypeScript decision path. |
| [TypeScript migration receipt](q-typescript-receipt.md), delivered from `3a7ec9eb` | Decision path replaced in TypeScript: 2,632 source lines, 74 emitted tests, no dependencies, no Python in the decision path, 10 sensitivity probes, an adversarial pass and a read-only reconciliation matching the Python baseline on all twelve requirements | Implementer report. Not yet independently reviewed. |

## TypeScript decision-path migration

The user selected TypeScript for qualification orchestration and Rust for native raster operations. The
migration replaced raw-byte parsing, declaration validation, admission, requirement mapping, per-run
reduction, the requirement verdict and the CLI exit. The Python decision path is frozen for comparison
and is no longer the authority: the runner's final step invokes the emitted TypeScript CLI.

What is claimed, and what is not:

* the five review counterexamples all reproduced against the Python baseline and none against the
  TypeScript path ([receipt](q-typescript-receipt.md));
* this is consistent with the hypothesis that one parsing/reduction path and per-run reductions reduce
  escaped false passes, but the TypeScript path was written knowing those counterexamples and Python
  was not, so the comparison does not isolate language from architecture;
* the two paths agree on all twelve requirements for the existing records. That is evidence of a
  faithful port, not of correctness: Python is not an oracle, and no verdict distribution is
  prescribed;
* two sensitivity probes are reported as **zero results**, and one of them (S1d) exposed that the suite
  checked a verdict without checking that the discarded failure was explained. Reason-preservation
  tests were added and the re-probe bites.

Remaining Python experiment orchestration, fixture/bootstrap/server and reference helpers are staged
for separate replacement and were not touched. No Python was deleted.

### Round 2 debrief inputs

Round 1 was independently reviewed at `8ab1fff7` and retained its repairs while listing six remaining
families; round 2 addresses all six. For the final synthesis:

| Dimension | Observation |
| --- | --- |
| Reviewer-discovered versus self-review | All six round-2 families were found by the independent reviewer. The implementer's own sweep and adversarial passes in round 1 found none of them, including the two that were pre-existing contract paths — the wrong transport declaration and the envelope/identity disagreement. Round 2's own adversarial pass again found no production counterexample |
| Repeated defect family | The recurring pattern across T1–T4 and R1-A–R1-F is **evidence discarded before it reaches the reduction**: an early return at the first gap, a declaration passed but never read, a filtered list paired by stale index, or a required set inferred from what was supplied. Round 2 addressed the instances; the pattern itself is the main lesson |
| Input mutations attempted | 32 in the round-1 sweep plus 13 sibling cases in round 2, over declarations, source identity, per-run fields, artifact correspondence, sidecar policy, display runs, CLI arguments and the programmatic entry point |
| False individual passes hidden by overall gaps | Every round-2 family was one. Permanent gaps already prevented overall qualification, which is exactly why an "overall non-pass" check could not see them. The receipt's cases assert individual requirement and assertion verdicts for this reason |
| Controls that proved invalid | Two committed tests encoded `http-range` as the expected transport, i.e. the defect itself, and were rewritten against the plan. One round-1 sweep case asserted an interaction that cannot occur. Both are recorded rather than quietly corrected |
| Guard-removal probes | 11 in round 1 (one zero), 13 in round 2 (two zero). Both round-2 zeros are redundant defence, confirmed load-bearing only as pairs, and are reported as redundancy rather than coverage |
| Environment failures | The reviewer's `EPERM` on sandboxed subprocess capture did not recur in round 2. One probe reading was a measurement artifact (instrumenting captured stderr) and was re-measured before being believed |
| Review rounds | Round 0 baseline discovery, round 1 delivered and reviewed, round 2 delivered. The standing prompt allows no third round without the user's decision |
| Measured effort | Not measured; not inferred from test count |

Architecture, language, implementation and review-process effects remain separable. Round 2 changed no
architecture and no language, so its repairs are attributable to the findings and the tests rather
than to either.

### Reassessment debrief inputs

The bounded [design reassessment](q-typescript-reassessment.md) at `82184e6c` delivered evidence for the
final synthesis in addition to the Round 2 inputs above. No further repair round followed it; the
instrument for the next authorized implementation is the proposed seam, not a third sweep.

| Dimension | Observation |
| --- | --- |
| Escaped invariant families | Two crossed both repair rounds and the Round 2 review: **a check whose reachability is decided by imperative control flow** (mutually exclusive chains, early returns, conjunctions of independent preconditions), and **a claim inferred from supplied data instead of the declaration** (tile counts from a sample list, a reference label from a missing role). The reassessment reproduced four Round 2 instances and added two more, one of them a false *assertion* pass (`reference-measurements-labelled-separately`) that no whole-requirement check could see |
| Self-review findings | Dead code that reads like a discard (`decide.ts`'s `void gap` loop over merged shape gaps) and an unused `assertionVerdicts` local; two duplicated doc comments left by hand-applied repairs (`resources.ts`, `preparation.ts`); admission reasons published twice per requirement because `decideRequirement` concatenates the admission's reasons with a `Findings` list that already contains them. Each is small; together they show that per-site repairs were applied and reviewed where the last finding pointed rather than across the file |
| Invalid controls | The first directory-mode case was labelled a rejected-input case but validated successfully and became the negative control for the pair; a driver label printed an unchanged report as `writtenKind=decision`; an early `assertionsOf` helper iterated a captured array and silently wrote the unmutated reports, producing a first N-1 reading that was re-measured and corrected. Every reading quoted in the reassessment is from a re-run after those driver fixes |
| Hypothesis that did not survive measurement | `decide.ts` merging the shape's gaps and then discarding them in a no-op loop looked like the same family. Measurement refuted it: admission reports those gaps, and a deleted `identity.runId` does reach the decision. Recorded because a source reading that is not re-measured is not evidence |
| Reviewer coverage gaps | The Round 2 sweep and adversarial pass did not reach `evidence/resources.ts` route attribution or the directory-mode publication path, and their oracle assertions were requirement-level, so an individual assertion wrongly promoted to `pass` could not be seen. The reassessment also compared the TypeScript rules with the retained Python gate and found two TypeScript behaviours that are regressions against rules Python still enforces and tests — a comparison neither the implementer rounds nor the review performed |
| Guards that prevent recurrence | The proposed totality check (every contract assertion decided by at least one check, enforced by the driver) prevents silently undecided assertions; per-check negative fixtures prevent a check that stops running from passing unnoticed; the `reads`-based retention sweep makes "a finding survives an unrelated missing observation" mechanical instead of family-by-family; the migration oracle (per-requirement decision comparison) makes an unintended verdict change visible in the slice that causes it; the publication read-set makes input protection independent of validation success. None of these is claimed to be complete |
| Language, architecture, implementation, test oracle | The reassessment separates them: R2-C's sample/count reconciliation and N-1's undeclared-role rule are **implementation/migration** regressions with a retained oracle; R2-A's page-error check is a **new implementation** check that no retained path performs and that was gated behind a sibling; R2-B's conjunction and R2-D's derivation order are **architecture/design** defects present in the retained implementation too; the requirement-level oracle in the retained Python test is a **test-oracle** error, not a language effect. No language change is recommended, and no family was caused by TypeScript as a language |
| Measured effort | Not measured for this reassessment beyond the command list in the document; not inferred from test counts |

Success for the next authorized implementation is defined as **fewer escaped invariant families at
independent review**, not a higher test count. No reduction in handoffs is promised: two repair rounds
were followed by a design reassessment, and whether the seam shortens the next cycle is a prediction
this evidence does not support.

### Implementation debrief inputs

The settled design was implemented at `5878f80e` (S1 `2b0a02c7`, S2 `70e51534`, S3 `1fb1d064`, S4
`8a85fc3a`, S5 `567e6d29`, verification `5878f80e`). Independently reported inputs for the synthesis:

| Dimension | Observation |
| --- | --- |
| Escaped families addressed | All five demonstrated families (R2-A to R2-D, N-1) are reproduced as failing cases first and pass after the migration. The migration oracle shows all twelve requirements and all 68 assertions unchanged on the coherent corpus, with version 1 → 2 and check receipts added |
| Independence of the test oracle | The acceptance cases were derived from C1–C8, the plan and the findings, not from the check inventory: the inventory is compared with `requirements.json` by a separate guard, and the expected outcomes are literals in the tests |
| Fixture corrections | The positive display control was physically inconsistent — 128 requests and renders with 100 latency samples, while the producer records one latency per rendered tile. It is now 100/100/100 and the old shape is a failing case. The previous control was not blessed as an oracle |
| Guard-removal results | Eight guards removed one at a time in isolated copies; six were detected immediately. Two were zero results because each publication guard made the other unreachable; two deterministic cases (read-only parent, injected competing creator) were added and both probes are now detected. No zero-result probe remains |
| Self-review discoveries | Three implementation defects were found by the retained tests rather than by the new ones: dropped gaps beside failures, a non-object sidecar record gapping instead of failing, and a lost incompleteness summary. Each was fixed in scope rather than by relaxing the test |
| Behaviour changes | A missing output parent is refused rather than created; an unrecoverable read-set never writes to the requested destination; and the new per-run relationships will fail a real run whose producer records fewer latencies than rendered tiles. All three are recorded in the receipt, not discovered at review time |
| Unavailable observations | No producer, engine, browser or private experiment ran. `Q-HOST-1`'s accepted-host rule is implemented but unreachable through the CLI, and the resource disk-cache/staging bounds and the lifecycle/member/value/host obligations remain explicit gaps |
| Measured effort | Not measured; test count is not used as a proxy |

### Boundary-repair debrief inputs

The B1–B3 repair at `95028481` adds these inputs to the synthesis:

| Dimension | Observation |
| --- | --- |
| Families the implementation review caught | Three remained after the S1–S5 delivery: an absent input could be created through a directory alias; a recorded numeric violation was lost when its sibling operand was absent; and a present unusable leaf became a gap instead of a failure. All three are the same "one fact hides another" shape the reassessment described, now at leaf granularity |
| Counterexamples found by the repair's own sweep | Four: negative counters admitted as measurements, negative counters used in corroboration arithmetic, unmeasured window records dropped without a finding, and evidence references resolved too strictly so that ordinary missing-field gaps were reported as internal-check defects. The last one was found only by running the decision path read-only over the retained producer report shapes, not by synthetic fixtures |
| Controls corrected | Two retained expectations contradicted the accepted contract: a sweep case expected an unusable window size to be inconclusive (the B3 defect itself), and a window reason collapsed the missing dimension into "usable size". Both were corrected with the reason recorded rather than by relaxing anything |
| Guard-removal probes | Seven removals in isolated copies, all detected: alias normalization, window and ledger failure retention, sidecar retention, malformed window dimension, malformed role on each side. No zero results; one redundant direction (directory-mode alias) reported rather than credited |
| Measurement readiness | The handoff distinguishes a missing producer from a missing run or environment. The headline prerequisite is producer-side: no producer writes the `identity` block the decision path requires, so 11 of 12 requirements cannot be admitted against real reports whatever else is fixed. The display trace needs a wiring decision, but the local bridge is not merely unwired: `measure.py q2-local-bridge` is a stripped-layout rejection control (MR1), so a positive producer that exercises the scoped bridge must still be written. This slice adds zero real Q capabilities |
| Measured effort | Not measured; test count is not used as a proxy |

### Numeric counter debrief inputs

The NC1–NC2 completion at `e1f7ac95` adds:

| Dimension | Observation |
| --- | --- |
| Defect class | Both findings were the same "one fact hides another" shape as the earlier families, one level lower: a counter was validated for finiteness instead of the discrete unit the contract counts, and a comparison waited for a third operand it did not need. Neither was caught by the earlier sweeps because those exercised presence and type, not unit semantics or operand minimality |
| Matrix | A 20-row table over the three counters plus a zero-window table that asserts the ledger assertion separately from the transport assertion. The separate assertion matters: without it, a skipped ledger comparison is masked by the transport failure that zero windows already produce |
| Sensitivity | Three isolated guard removals, all detected on the intended assertion: integer validation (4 failures) and each relationship gated on the third counter (3 each). No zero results |
| Readiness correction | MR1 was a documentation defect, verified against producer code rather than the command name. `q2-local-bridge` is a negative control; the positive scoped-bridge producer remains unwritten, and this slice records zero new real Q capabilities |
| Controls corrected | Two retained sweep expectations changed wording for the malformed-count rule; no verdict expectation was relaxed |
| Measured effort | Not measured |

## C1–C8 repair report

Repair code: `qualification_evidence.py`, `qualification_gate.py`, `measure.py`, `qual_lib.py` and
`run_all_experiments.sh`; tests in `tests/test_acceptance_contract.py` plus the existing suites.
Captured cycles, sensitivity probes, self-review cases and the read-only reconciliation are in
[q-consolidated-repair-cycles.txt](evidence/q-consolidated-repair-cycles.txt); the row-by-row coverage
table and the minimum-decisive-case trace are in the [receipt](q-consolidated-repair-receipt.md).
The table below records implementer claims and test names, not whole-family acceptance. The independent review above supersedes blanket coverage claims.

| ID | Repair reported by the implementer | Check that now detects a regression |
| --- | --- | --- |
| C1 | Boolean-only leaves for assertion `ok` and precondition `met`; a present null is malformed while an absent key stays a gap; duplicate assertion and precondition names fail | `C1StrictLeaves` (9 wrong leaves x both leaf kinds), sensitivity probe S1 |
| C2 | Report field container shapes validated at the parse seam; `SourceDocument.present` separates absence from corruption and preserves the reason; the unbound `art_unpinned_names` and eight `AttributeError` paths are gone; one parse per source | `C2LoaderTotality` (9 roles missing, 48 shape combinations, truncated JSON), sensitivity probe S11 |
| C3 | Experiment and transport expectations derived from the source role, so omission blocks instead of withdrawing the comparison; the CLI declares the expected environment and transports | `C3RoleIdentity`, sensitivity probe S6 |
| C4 | The numeric window bound is decided from recorded window sizes rather than the absence of a failure string; artifact correspondence is decided from the inventory rather than a prose note; the mapping is written down and guarded against drift | `C4AssertionEvidence`, `C4MappingDrift`, sensitivity probes S7 and S14 |
| C5 | Plan budgets enforced per counter on sampled candidate records only; a measured budget violation outranks a missing counter; a 900 ms stall survives an unrecognised optional field | `C5QuantitativeBudgets`, `C5DisplayBudgets`, sensitivity probes S8–S10 |
| C6 | Admission block required and shape-checked; assertion verdict types validated before membership; entry-level gaps no longer return early; a missing route cannot hide a fail | `C6AssertionVerdictTypes`, `C6AdmissionRequired`, `C6FailureOutranksGap`, sensitivity probes S3–S5 |
| C7 | The runner assembles a bundle and exits with the requirement gate's status; the experiment summary is a labelled diagnostic; an unwritable destination exits non-zero with a clear error instead of a traceback | `test_runner_exit.sh` cases 1–7, `C7OutputFailure`, sensitivity probe S12 |
| C8 | Four fault kinds crossed with four independent gap kinds in both orders; a measured requirement violation raises the reduced admission severity; an observed failure keeps its severity in an unadmitted entry | `C8CrossLayerInvariants`, `C8ObservedFailureSeverity`, sensitivity probe S13 |

Two behaviours changed verdict deliberately and are documented rather than adjusted away: the
recorded trace's `one-cold-and-three-warm-runs` now fails because the trace holds one cold and one
warm run where the plan requires three warm, and an unusable record's already-recorded failure keeps
its failure severity instead of grading down to a gap.

One sensitivity probe is reported as a **zero result**: removing either of the two independent
duplicate-name checks alone leaves the suite green because the other still refuses the duplicate.
Removing both fails. That is recorded honestly rather than presented as coverage.
| [Consolidated review](q-consolidated-admission-review.md) and [prompt](q-consolidated-agent-prompt.md) | User-approved change from example-by-example handoffs to one stable acceptance matrix and adversarial self-review | Review completed without harness changes. Execution remains separate; Q and N1 gates unchanged. |

## R5 repair report

Repair code: `scripts/raster-qualification/qualification_evidence.py` and `measure.py`; tests in
`tests/test_qualification_gate.py` and `tests/test_cli_integration.py`. Captured cycles, sensitivity
probes and the read-only evidence reconciliation are in
[q-declaration-precedence-cycles.txt](evidence/q-declaration-precedence-cycles.txt); the acceptance
table is in the [receipt](q-declaration-precedence-receipt.md). Nothing below is independently
verified yet.

| ID | Repair reported by the implementer | Check that now detects a regression |
| --- | --- | --- |
| R5-01 | Declarations are validated before anything is indexed from them: missing hash or manifest is inconclusive; malformed type/value, duplicate identity (including identical), conflicting entries, undeclared required reference, repeated JSON object key and an explicit empty required list fail. Both entry points call the same validators, and a rejected declaration stops the CLI with a nonzero result and a diagnostic artifact. The same-class pin bypass was found and repaired | `DeclarationValidationTest`, `CliDeclarationValidation`, and a guard-removal probe that replaces both CLI loaders with `json.loads` |
| R5-02 | No section of `admit_report` sets a verdict; failures, gaps, conflicts and blocked comparisons are collected and reduced once at the end, so a wrong hash stays a failure alongside a missing `runId`/time/command and every contributing source's failure reaches a combined requirement | Table-driven conflict-kind × gap-kind cross products in both orders, a metamorphic invariant over every gap kind, and a combined-fault probe that fails under both an early return and a dropped conflict list |
| R5-03 | Recorded failures, failed assertions and failed preconditions are read independently of `result`; an absent key stays a gap while a present-but-unusable value (including explicit `null`) is invalid; every container is shape-checked, so a malformed one is an input failure rather than a silent empty list, and the `TypeError` that escaped `assemble` is gone | `ResultIndependentFailures`, the malformed-container tests, and a container-shape probe |

Two existing tests changed expectation rather than being weakened:
`FixtureCoverage.test_malformed_hash_is_not_a_valid_identity` now expects `fail` because R5-01
reclassifies a malformed declared digest from a gap to a malformed declaration, and the
declaration-level duplicate assertions were reworded to match the emitted messages. Both are recorded
in the receipt.

## R2 findings and reported repairs

These identifiers label review evidence, not a second task tracker. Implementation status belongs in bd. Append a revision/test/independent result when resolved; retain the original finding for comparison.

Each repair below is reported by the implementer and is **not** resolved until independently verified. The linked tests are the evidence that the repair exists; they are not proof that the original finding is closed.

| ID | Evidence at `cfbb0c35` | Impact / verification required | Implementer report at `47b9d508` |
| --- | --- | --- | --- |
| R2-01 | [Display producer](../../../scripts/raster-qualification/run_display_trace.mjs) emits `longTaskMaxMs`; [evaluator](../../../scripts/raster-qualification/measure.py) reads `maxLongTaskMs` and permits missing values | 900 ms UI work can pass a 50 ms gate. Verify shared schema/contract and a one-condition regression.  | **Repair implemented, pending verification**: producer/consumer field agreement asserted, unrecognised fields reported, 900 ms fails with values. |
| R2-02 | `cmd_q6_resources` does not require nonempty complete runs, successful rendering, or a true run `ok` | Empty trace passed; failed run with 127 failures out of 128 attempts passed. Require positive controls, run completeness and observation validity.  | **Repair implemented, pending verification**: run completeness, successful rendering and observation support required. |
| R2-03 | `cmd_q5_lifecycle` turns “not evaluated” cases into limitations; Q6 checks candidate request bytes but measures memory only for the reference reader | Missing mandatory evidence does not prevent a gate pass. Derive eligibility from original requirements, independently of probe result counts.  | **Repair implemented, pending verification**: eligibility derived from the contract; limitations cannot waive a requirement. |
| R2-04 | [Lifecycle probe](../../../scripts/raster-qualification/lifecycle_probe.mjs) preloads the file, slices a resident array, changes dispose flags, and terminates a separate Node loop | Does not prove candidate decoding cancellation or release. Its `operationsBeforeCancel` counts completed operations, not concurrent in-flight work. Verify the actual proposed route in a later authorized experiment.  | **Verdict repaired, experiment unresolved**: cancellation and teardown are inconclusive; a later authorized experiment must measure the proposed route. |
| R2-05 | [Aggregate runner](../../../scripts/raster-qualification/run_all_experiments.sh) records `FAILED` but finishes with summary printing without returning failure | CLI automation may report success despite failed steps. Exercise actual shell exit handling with controlled command outcomes.  | **Repair implemented, pending verification**: accumulated failures and a non-passing aggregate both exit non-zero. |
| R2-06 | Receipt defers candidate memory/cache/queue/temp-disk measurement, Desktop worker hosting and overview precedence; pinned-source build not attempted | Q requirements cannot be reassigned to successors without a decision. Requirement matrix must retain these evidence gaps.  | **Repair implemented, pending verification**: the gaps are contract requirements and remain blocking. |
| R2-07 | [Regression tests](../../../scripts/raster-qualification/tests/test_qualification_verdicts.py) construct several negative cases with additional missing fixture/hash/ledger preconditions and assert a generic failure | Tests can pass for an unrelated reason. Not proof all tests are ineffective: verify each from an otherwise passing control and perform a targeted sensitivity check.  | **Repair implemented, pending verification**: negative cases start from a passing control and name the failing requirement. |

### Third review findings

| ID | Evidence at `47b9d508` | Impact / verification required | Status |
| --- | --- | --- | --- |
| R3-01 | Assertions were selected by name prefix; a report's own `result`, failure list and failed preconditions were not consulted | A failing fixture-hash precondition could still supply passing observations | **Repair implemented, pending verification**: admission refuses the source and keeps its measurements visible but unpromoted. |
| R3-02 | Identity fields were caller-supplied labels; fixture hashes and conflicting versions/routes/environments were not compared | An unlabelled or mismatched report could be described as the declared route | **Repair implemented, pending verification**: identity is read from the report and compared; missing is a gap, conflicting is a failure with both values named. |
| R3-03 | Transport sufficiency and artifact/source correspondence were satisfied by strings | HTTP-only evidence could stand for the required local bridge; recording a revision mismatch was treated as correspondence | **Repair implemented, pending verification**: transport is declared and compared structurally; a different source revision fails without a reproducible build from the pin. |
| R3-04 | Sidecar absence was silent | An unobserved sidecar could be assumed absent | **Repair implemented, pending verification**: `measured` / `not_applicable` / `unmeasured` are distinguished and only an explicit policy settles the assertion. |
| R3-05 | Reported statistics were trusted; attempts could count as rendering | A physically inconsistent trace could pass | **Repair implemented, pending verification**: counters must be whole and consistent with the samples, and median/p95/max are recomputed from individual latencies under a frozen hand-verified convention. |
| R3-06 | The cleaned Q receipt still presented four requirements as passing and the contract was missing two plan obligations | A stale four-pass table contradicted the eligibility result | **Repair implemented, pending verification**: the receipt now reports the corrected verdict and the contract carries `apis-called-and-worker-target-recorded` and `required-fixture-classes-covered`. |

### Fourth review findings

| ID | Evidence at `d963f755` | Impact / verification required | Status |
| --- | --- | --- | --- |
| R4-01 | Fixture comparison was subset-only against a flat list; an unexpected fixture was ignored, a missing required fixture was not a gap, duplicates collapsed in a dict, and the CLI passed an empty fixture list | Coverage could not be established, yet nothing blocked | **Repair implemented, pending verification**: coverage is judged against a declared per-role manifest; undeclared fixtures conflict, missing required fixtures are gaps, duplicates fail, and the CLI loads the declaration. |
| R4-02 | Correspondence iterated the supplied records and took the expected pin from the record being checked | An unrelated record satisfied a required artifact, and a report could invent its own expectation | **Repair implemented, pending verification**: coverage iterates the required artifact/version pairs against the pin declared in the candidate manifest; a revision mismatch needs real build evidence tied to the measured artifact. |
| R4-03 | No run identity, timestamp, age or digest check existed; freshness applied only to the bundle stamp | Reassembly refreshed old evidence, and any digest string was accepted | **Repair implemented, pending verification**: `runId` and a finite non-boolean `recordedAt` are required, age uses the shared seven-day limit at one injected clock, and the digest is computed from the bytes read. |
| R4-04 | A missing identity block returned early, discarding recorded failures and failed preconditions | A known failure could be erased by a provenance gap | **Repair implemented, pending verification**: failures and gaps accumulate and `fail > inconclusive > pass` applies once; a requirement drawing on several sources inherits any contributing source's failure. |

### Reproduced Q6 failure cases

Reviewer invoked the real `cmd_q6_resources` with in-memory injected browser/report input and an intercepted report writer; no fixture or report files were changed. Browser input carried an available/ok Chromium result, a transport ledger, and candidate transport totals with a 64-byte largest request. No reference fixture was supplied. Two trace inputs independently produced exit `0` and verdict `pass`:

```json
{"runs": []}
```

```json
{"runs": [{"name": "cold", "ok": false, "tileRequests": 128, "tilesRendered": 1, "failedTiles": 127, "p95Ms": 1, "longTaskMaxMs": 900, "longTaskObserverSupported": true}]}
```

These reproduce false passes, not physical performance observations. The repair must turn each constituent fault into a separate regression with a valid positive control; the second input intentionally combines defects and is not itself a well-isolated TDD fixture.

## R3 independent findings at `47b9d508`

These findings supersede blanket claims that the R2 families are resolved. The new contract and honest non-passing overall result are useful retained work; their existence does not establish sound evidence admission. No implementation changes were made during this review.

| ID | Independently inspected or reproduced evidence | Required correction |
| --- | --- | --- |
| R3-01 | With the committed passing raw numeric control, adding a failed fixture-hash assertion, `result: fail`, and a hash failure still leaves every assembled `Q-LOCAL-1` assertion passing | Preserve source precondition failures through assembly and eligibility; selected assertion prefixes cannot erase them. |
| R3-02 | Starting from `passing_evidence()`, independently removing numeric fixture identities, changing its route to an unrelated whole-file reader, or replacing its artifact with an unrelated version each still yields overall pass | Validate correspondence, not just nonempty identity strings. The CLI currently supplies empty fixtures and stamps source reports with caller-declared identities. |
| R3-03 | Source inspection: `testedWindows > 0` proves the local-transport assertion; the CLI declares HTTP Range. Artifact assertions reward a note saying no published artifact matches, without requiring source correspondence or a reproducible build | Keep HTTP capability and inventory findings, but neither satisfies the corresponding original Q requirement. Do not silently select a new pin. |
| R3-04 | Remove `sidecar-unchanged` from the committed preparation control: assembled assertion remains pass through an explicit `else PASS` | Missing evidence must be inconclusive; no-sidecar applicability needs explicit fixture evidence. |
| R3-05 | `valid_trace()` passes. Changing its runs to one rendered/requested tile while retaining 128 samples and setting p95 to 9999 still leaves all seven display assertions passing | Reconcile samples with request/success counters and calculate/check statistics. The original control itself reports p95 16.7 despite all its individual values being at most 2.3 ms. |

Reproduction entry points: `qualification_evidence.assemble`, `display_trace_assertions`, `qualification_gate.evaluate`, and helpers `passing_reports`, `passing_evidence`, `valid_trace` in `tests/test_qualification_gate.py`. Reviewer intercepted `Path.write_text` to capture raw synthetic reports in memory and used an in-memory path for evaluation; private evidence and working files were untouched. Each identity change was tested separately; the combined display counter/statistic example must be split into separate regression cases in the repair. The first assembler reproduction attempt failed because the review interceptor retained JSON text instead of decoding it; after correcting that review setup, the reported false pass reproduced. That setup error is not a harness finding.

Additional inspected behavior: the synthetic marker is reported but does not prevent an overall production-style pass. This was reproduced from a passing bundle and is included in the next handoff's publication boundary. It does not allege that synthetic evidence was submitted as real evidence.

Skill usage remains implementer-reported. The repair receipt names TDD/craft/codebase-design and describes sensitivity checks, including an initially masked mutation; no captured RED/GREEN transcript was supplied. Green tests and reported skill loading cannot establish workflow adherence independently.

## R4 independent findings at `d963f755`

Code revision `2c830b0d`; subsequent `c2f5eb79` and `d963f755` are bead records. Reproductions used the committed `passing_reports()` controls, the real assembler and gate, intercepted file I/O and independent deep copies of each report. Controls passed the affected requirements. No source files or private evidence changed. The clean checkout was in sync with upstream.

| ID | Single-case evidence | Observed outcome / required correction |
| --- | --- | --- |
| R4-01 | Change the numeric fixture name to an unlisted name and hash to another hash | `Q-LOCAL-1` still passes. `_fixture_problems` compares hashes only for names already in the expected manifest; verify membership and required coverage, not intersection alone. |
| R4-02 | Replace source correspondence with one matching revision pair for an unrelated artifact | `Q-ART-1` still passes. `_source_correspondence` does not use its required `artifacts` argument to establish coverage. |
| R4-03 | Independently set numeric `recordedAt` to `1`, or remove both `recordedAt` and `runId` | `Q-LOCAL-1` still passes in both cases. Fields are carried into provenance but not checked; fresh assembly time must not renew source evidence. |
| R4-04 | Remove identity from a numeric report explicitly marked fail with a failed fixture-hash assertion | Requirement becomes inconclusive and only the identity gap is explained. Early return bypasses failure evaluation; preserve known failure precedence. |

These findings do not establish that real fixture measurements were fabricated or that every prior repair failed. They establish remaining false admission and failure-classification paths. The implementer reported improved display/sidecar checks and nine sensitivity checks, but independent acceptance of the complete boundary remains outstanding.

The latest receipt again reports no captured RED/GREEN transcript despite the previous prompt requesting one. It also reports fixture defects discovered during implementation: shared mutable assembly configuration, a `TestCase.run` override, an `evaluate()` shadow and physically inconsistent fixtures. These are implementer-reported process observations, not independently reconstructed execution history. Preserve them for the final debrief without inferring skill adherence, intent or model capability.

## R5 independent findings through `578e3bdb`

Repair code: `50c1211e`; subsequent delivery records: `b7112847`, `578e3bdb`. Reproductions used `passing_reports()` and fresh `assembly()` controls with the real assembler/gate. File I/O was intercepted in memory; no private experiments or working files changed. The affected requirement control passed before mutations. The wrong observed fixture hash alone now correctly fails, demonstrating a retained improvement.

| ID | Independent reproduction | Observed result / remaining defect |
| --- | --- | --- |
| R5-01 | Remove `sha256` from `fixture_manifest.declared[0]`; separately insert a conflicting duplicate declaration before the original | `Q-LOCAL-1` passes both. Declaration dict conversion silently accepts missing expected hashes and overwrites duplicate names. Validate declarations before lookup construction. |
| R5-02 | Wrong observed numeric hash fails; retain it and remove `identity.runId` | Verdict becomes inconclusive with only the runId gap. An early return still skips the available hash comparison, contradicting the claimed single final reduction. |
| R5-03 | Remove numeric `result` and supply a positive `failures` entry | Verdict is inconclusive; failure list evaluation is nested under the recognized-result branch. Missing summary does not erase independently recorded failure. |

The next handoff separates declaration-input validity from physical engine behavior and adds combined-fault controls. None of these reproductions establishes a real engine failure, fabricated measurement or general model limitation. Current Q remains unqualified for independent reasons.

The latest receipt includes a linked trimmed cycle log, an improvement over earlier uncaptured reports. Its ten sensitivity results and reported implementation/fixture mistakes remain implementer evidence until independently checked; merely having the log is not proof the tests cover every branch. Keep the log for comparison with the R5 combined-fault regressions.

## Process hypotheses, not settled conclusions

| Hypothesis | Supporting observation | Evidence still needed / proposed intervention |
| --- | --- | --- |
| Scope was too broad for a reliable correction cycle | First correction added substantial harness work while leaving eligibility gaps | Try gate-only repair and compare review/rework outcomes. Do not equate changed line count with wasted effort. |
| Test-first sequencing was treated as sufficient proof | Green regression suite coexists with false qualification passes | Explicit vertical TDD, passing controls, named failure reasons and guard-sensitivity evidence. Transcript needed to assess actual workflow. |
| Implementer-controlled requirements drifted toward measured subsets | Required omissions appear as limitations while overall results remain pass | Requirements-to-evidence contract derived from the accepted plan and independently reviewed before more experiments. |
| Handoff instructions could have been more operational | Earlier prompt said tests first but omitted explicit skill use and positive-control discipline | New prompt names skills and demands observable cycles. Skill invocation alone is not evidence of compliance. |
| Independent review caught issues cheap validation did not | Tiny injected reports reproduced false passes despite unit suite success | Add adversarial report/runner tests and preserve independent review. Measure whether those tests catch future regressions. |
| Test controls were accepted by code but not coherent with the scientific contract | R3 display control has statistics inconsistent with samples; gate controls prefill every required assertion as pass | Test raw-report admission end to end and use independently calculated control values. Success criterion: isolated identity, precondition and statistical mutations are rejected for the intended reason. |
| A narrower prompt and named skills were insufficient on their own | Gate-only repair still lost report failures and omitted identity comparisons explicitly requested in the earlier prompt | Distinguish instruction-following failure from handoff design: the prior handoff did not make cross-layer coherent controls sufficiently concrete. Next receipt must capture actual cycles; do not infer a general model limitation. |
| Checks cover supplied fields but not the required set | R4 unknown fixture and unrelated artifact records pass | Required-set controls with two members, missing/extra/duplicate cases, and a regression proving unrelated additions cannot satisfy obligations. |
| Early returns accidentally change verdict precedence | Removing identity downgrades explicit failure to inconclusive | Table-driven mixed failure/gap cases; deleting evidence must not improve eligibility or erase failure reasons. |
| Handoff evidence requirements are not being enforced at delivery | Two receipts describe RED/GREEN work without the requested captured transcript | Require a small sanitized command/output artifact in the next receipt. Separate independently rerun GREEN from reported RED and sensitivity history. |
| Validating observations left their expected declarations implicitly trusted | R5-01 missing/duplicate expected hashes pass despite observed-fixture coverage checks | One declaration validation path shared by CLI and assembly; independently demonstrate missing, malformed, duplicate and conflicting declaration rejection. |
| Isolated negative tests missed interactions already prohibited by the contract | R5-02 wrong hash fails alone but loses failure when runId is removed; previous prompt explicitly required failure monotonicity | Bounded failure-kind × independent-gap-kind tests and an early-return mutation. Credit only detection, not additional test count. |
| A compatibility exception was broader than its intended purpose | R5-03 treating absent result as a gap also suppresses a present positive failure | Check gap-only and gap-plus-failure cases separately. Debrief should distinguish the reasonable compatibility decision from its incorrect control flow. |

## Consolidated-cycle methodology decision

The preceding workflow generated repeated small repair/review round trips. Reviewer contribution: stopping after a few counterexamples and writing a narrow next prompt left adjacent boundaries unaudited, including direct gate ingestion and final runner routing. Implementer contribution: isolated green examples and local sensitivity checks did not establish a complete input contract or cross-layer invariants. These observations concern this workflow; model capability, cost and settings remain unmeasured.

The new cycle has one [input/acceptance matrix](q-admission-acceptance.md), one [execution prompt](q-consolidated-agent-prompt.md) and one future implementation receipt. The consolidated review identifies confirmed counterexamples separately from source-traced paths and unmeasured engine capabilities. Preserve verified R5 repairs; require a full adversarial self-review through the CLI before delivery. Block only false eligibility, lost known failures, invalid rejection of a valid control, broken diagnostics and qualification bypass. File warning cleanup and optional restructuring separately.

Debrief this intervention using evidence: matrix rows actually exercised, counterexamples found by self-review versus independent review, materially new blockers after delivery, repeated findings tied to previously explicit instructions, and actual logged time/rework when available. Increased test count, longer prompts and skill-name lists are not success metrics. A later review may still find a defect; require it to identify the violated matrix invariant or justify a scope change rather than silently extending the assignment.

Latest independent checks at `5becb043`: 209 tests pass with TemporaryDirectory warnings; docs validation passes. R5 controls preserve expected outcomes. New reproduction families and their code entry points are recorded once in the consolidated review, not duplicated in a new chronological task list here. No private qualification experiments or production changes occurred during this review.

## Desktop bridge transport slice at `fab0c381` (delivery record)

The first slice that ran a real experiment rather than testing the evaluator. What it
produced, and what it exposed, in the debrief's own terms:

| Question | Observed |
| --- | --- |
| Capability gained | Two positively observed Q requirements — Q-LOCAL-1 (bounded numeric windows over the scoped local bridge, five windows, 81 920 cells, no value or validity mismatch) and Q-HOST-1 (bundled worker and assets, Desktop WebView, no network origin). Both are exploratory: one synthetic fixture, the published engine, one host. Ten requirements remain inconclusive because their producers do not exist, and zero requirements are qualified |
| Reusable work | The production executor was reused by path rather than reimplemented, and the existing admission/decision path consumed the new reports unchanged. The new work was one isolated workspace plus a declaration profile |
| Work that needed rework | Four failures, each found by the harness rather than by review: GTK cannot start under a bare network namespace (X11 abstract sockets are namespaced), the WebView read camelCase keys while Tauri returns authored snake_case, engine assets copied after the host build were not embedded, and the worker used `tile.column` where the engine's JSON says `col`. Every one of them produced a run that looked completed |
| What the harness caught instead of a reviewer | The embedded-asset digest check caught the MIME-type failure at its cause rather than at its symptom; the analytic comparison turned a silent all-`NaN` decode into a named failure; the fresh-output guard was added after a probe showed a reused directory presenting a previous decision as this run's evidence |
| Measurement defect found by probing | A sensitivity probe first appeared to prove the analytic expectation was irrelevant. It proved nothing, because the generator and the expectation were the same function: changing it changed the fixture too. The probe was rebuilt to freeze the fixture bytes first. Expectation probes must break *correspondence*, not a shared source |
| Review coverage limit | Every probe ran on the same harness it exercises, the network posture used a local X11 relay rather than a firewall rule, and the observations are two runs by the implementer. Independent reproduction is the reviewer's step |
| Effort/cost | Not measured. The harness runs end to end in about five seconds once built, which is an observed runtime, not a cost comparison |

The transferable lesson for the next prompt: when a pilot reports success, the reviewer
should ask what would have to be true for the run to look successful while measuring the
wrong bytes. Here the answer was three separate staleness paths — embedded bundle, reused
run directory, and a generator that shared the expectation — and two of them
were closed only because a probe or a failure pointed at them.

## DB1–DB4 completion (delivery record)

| Question | Observed |
| --- | --- |
| Capability gained | None in engine terms. The instrument now refuses the reviewer's counterexample (five empty duplicate windows), owns one run root, publishes atomically, reserves request identities before queuing, and exits with its own classification instead of the evaluator's whole-Q code |
| Reviewer discovery versus self-review | All four families were found by independent review, not by the implementer's own probes. DB1's counterexample existed in the delivered producer for a whole slice while its tests passed, because the tests asserted on declared windows rather than changed raw evidence |
| Measurement defect found while probing | The first probe battery reported every guard as ineffective. The probe harness invoked a compiler through a wrong relative path and the tests ran against a stale build: an unverified probe is not evidence of absence. Probes must assert their own compile step |
| Self-review counterexample | The first verification run failed on a launcher defect the unit tests could not see: the launcher republished the host's own atomically published evidence. The fix was in scope and the retry was the authorized second run |
| Review coverage limit | Cancellation is covered by unit tests and a declared deadline, not an observed mid-flight cancellation; the native reservation path is covered by bridge tests plus one real run; both runs are the implementer's own |

## Final debrief procedure

Use [Ordered COG delivery and final debrief](#ordered-cog-delivery-and-final-debrief) for the current assignment and final synthesis. Historical DB/Q intervention details remain in the revision-linked review and receipt sections above; their old “next repair” instructions do not authorize further Q work. Evaluate their measured outcomes without restarting their workflows.
