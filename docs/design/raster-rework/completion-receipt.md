# Raster rework completion receipt

Status: partial — E1–E5 caller repairs delivered for independent acceptance. C5 gates green; IGN private fixtures, R51 in-flight native gate, R48 mid-write fault/retry and driven Desktop/Web remain named gaps. Not independently accepted.
Tracking: `canopi-j571`; completion implementation `canopi-j571.1`. bd owns progress.
Current guidance: [prompt](completion-agent-prompt.md), [contract](completion-design.md), [previous receipt](ordered-cog-receipt.md), [debrief](review-and-debrief.md#whole-rework-delivery-and-improvement).

## Current correction acceptance

Caller-level E1–E5 repairs on the combined tree after merge `d38be95d`
(ownership TDD retained from `86c74b14`/`eb3b5425`). TDD RED/GREEN recorded
per cycle through real owners where the contract required them.

| Obligation | Test / intended RED | GREEN | Real caller | Remaining limit |
| --- | --- | --- | --- | --- |
| E1 viewport on moveend | `review-provider-regressions.test.ts` E1; RED: no moveend listener | mount owns `events.on('moveend')` → `updateViewport` | WorldMap/Location/Canvas pass `lifetime` as `events` | live Google key not required for this detector |
| E2 recovery after failed read | `lidar-settlement-recovery.test.ts` E2; RED: 0 attaches after recovery | `libraryPollTick` retries pending settlement | real store + workflow | — |
| E3 one attempt per job | `lidar-settlement-recovery.test.ts` E3; RED: extra read on second Complete | `settlingJobs` guard | real store + workflow | — |
| E4 attribution identity | `review-provider-regressions.test.ts` E4; RED: create ×3 | keep control on unchanged credit; no empty control; suppress auto controls | Location/WorldMap `attributionControl: false` | live control render not driven |
| E5 name-based Retry | `lidar-analysis-panel.test.tsx` E5; RED: names missing | show `result.name`; Retry located by row name | AnalysisPanel | IPC/native not re-driven |
| L1–L4 / M1 / M5 / R48 / R50 | retained from `eb3b5425` | retained | retained | R51 gate, R48 mid-write open |
| R27/R43 | capacity-plane GDAL lane (prior run) | retained measurements | real GDAL | IGN MNT/MNH fixtures unavailable |
| C0–C5 | gates below | green | — | driven Desktop/Web, live key, packaged smoke unavailable |

### Final gates after E1–E5

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | clean |
| Full frontend | `npm test` | 2822 passed / 287 files |
| Gallery / builds / bindings | `check:ui`, `build`, `build:web`, `gen:types`, `check:types` | clean |
| Native LiDAR | `cargo test -p canopi-desktop --lib services::lidar::` | 118 passed / 68 ignored |
| fmt / clippy / docs / workspace | `cargo fmt --check`, clippy `-D warnings`, `check_docs.py`, `cargo test --workspace` | clean |
| Driven Desktop/Web, live key, Windows/macOS, packaged smoke, IGN fixtures, R51 in-flight gate, R48 mid-write | — | **unavailable / unfinished local proof** |

### Reported delivery at `291d0773` — qualified by current correction

The following table and gates preserve the implementer's report at code `c02d8164`.
“Done” and fresh-settlement claims are not current independent acceptance. R48/R51
required local proof remains in scope, not an optional follow-up. Full gate totals do
not establish mounted behavior, correct concurrent settlement or TDD history.

Independent review at `578a4f1c` is recorded in the [prior repair decisions](completion-review-578a4f1c.md).
This delivery repairs those findings on the combined tree at `c02d8164`
(merge `aab27c35`, coverage `5734f1f9`, lifecycle `2cfea668`, map guards `c02d8164`).

| ID | Production caller / named regression | Observed result at `c02d8164` | Residual gap | Owner |
| --- | --- | --- | --- | --- |
| R44 | `lidar-import-attachment.test.ts` R44 fresh-read + deleted-target cases | Settlement waits for a read started after Complete; deleted target consumes intent without attach | — | implementer (done) |
| R45 | `review-provider-regressions.test.ts` withdrawal clears credit | A→unavailable clears basemap credit; source-carried fallback without adapter | Live mounted control render not driven | independent review |
| R46 | map suites (workspace/location/world) | Ready→Loading→Ready visibility holds; delayed style ready retained | — | implementer (done) |
| R47 | `review-provider-regressions.test.ts` 7 coverage cases + supplied probe green | Antimeridian split, world/unwrapped viewports, 64-rect bound, malformed rejected | — | implementer (done) |
| R48 | `analysis.rs` per-block `admit_sparse_slope_storage` | Capacity rechecked per remaining block before output | Mid-write fault/retry lane not injected | implementer (follow-up) |
| R49 | `engine.rs` timeout + cancel unit tests | Stalled bounded child killed/reaped; uncapped child cancels under 5s | — | implementer (done) |
| R50 | `AnalysisPanel` per-row Retry + `lidar_retry_analysis` | Create uses form; each failed row retries its own definition ID | Two-definition UI/IPC integration lane not driven | independent review |
| R51 | `inspection.rs` `finish_sample_outcome` | Every Value/NoData exit rechecks currency, including early NoData | In-flight native gate test not added | implementer (follow-up) |
| R27 | `admission.rs` ceilings retained | Production limits unchanged | Fixture lift unavailable (`CANOPI_LIDAR_E2E_FIXTURE`, `CANOPI_LIDAR_MNH_DIR`, `CANOPI_LIDAR_CAPACITY_PLANE` unset) | fixture owner |
| R43 | capacity claim boundary | Peak vs residue labels corrected | Live peak/concurrent queue/fault sampling not run | implementer (follow-up) |
| C0–C5 | combined-tree gates below | Full frontend 2808, native 117, gallery, both builds, bindings, docs green | Driven Desktop/Web, live key, packaged smoke, Windows/macOS unavailable | independent reviewer |

### Final gates at `c02d8164`

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | clean |
| Full frontend | `npm test` | 2808 passed / 286 files |
| Gallery | `npm run check:ui` | clean |
| Desktop edition | `npm run build` | clean |
| Web edition | `npm run build:web` | clean |
| Bindings | `npm run gen:types` + `npm run check:types` | clean |
| Native LiDAR | `cargo test -p canopi-desktop --lib services::lidar::` | 117 passed / 68 ignored (GDAL fixtures unset) |
| Native policy | `cargo test -p canopi-desktop native_command_policy::tests` | clean |
| Rust workspace | `CANOPI_SKIP_BUNDLED_DB=1 cargo test --workspace` | clean |
| fmt / clippy | `cargo fmt --all -- --check`, `cargo clippy -p canopi-desktop --all-targets -- -D warnings` | clean |
| Docs | `python3 scripts/check_docs.py` | 0 errors |
| Driven Desktop/Web, live key, Windows/macOS, packaged smoke, R27 fixture lanes, R43 live sampling | — | **unavailable / not run** |

### Reported correction batch at 9208c930 — superseded by independent review

The following is the implementer's prior report, retained for provenance. Its
“repaired” claims for sparse admission, same-definition Retry, native post-read
currency and complete provider/attachment behavior are contradicted by the review;
none is current acceptance evidence.

Code tip for this correction batch: `77de3367` on `feature/raster-rework-completion`
(history-preserving docs merge `2574eb89`, Slice A `96e4828d`, Slice B `837e67a0`,
Slice C `77de3367`).

| Boundary | Current disposition and required proof |
| --- | --- |
| Preservation | **Held.** `34e4ded4` / `f61f8494` ancestry, v18 migration, ordered compatibility and user-owned primary-checkout files untouched. Candidate is not integrated into the user's normal checkout. |
| C1 / R28–R31 | Repaired in code: cancellable copy/hash/metadata, catalogue guard scope, uncapped source-conversion exception, sparse slope admission by occupied work. **R27 old ceilings retained** until the amendment's large-fixture measurement gates run; production limits unchanged. |
| C2 / R32–R33 | **Repaired.** Desktop-lifetime LiDAR workflow owner, library-lived polling, session-fenced exactly-once attachment. Same-definition Analysis Retry retained. |
| C3 / R34–R35 | **Repaired.** Reactive head invalidation of displayed/pending answers, cancel-before-re-entry, Location navigation ends inspection. Native post-read currency retained. |
| C4 / R36–R42 | **Repaired.** Reactive style/key/locale identity, coalesced viewport, Ready requires session+metadata, metadata recovery, base-descriptor zoom, contribution identity vs attribution, settings feedback. |
| C5 / R43 | **Partial.** Focused frontend (95 tests) and native (115+13) gates green at `77de3367`. Live peak scratch sampling, concurrent-read queue boundary, large-fixture lanes, driven Desktop/Web, live key, Windows/macOS and packaged smoke remain **unavailable** on this host and are not claimed. |

### R27–R43 finding-to-regression

| ID | Contract / caller | Observed failure at `26eca68a` | Repair revision | Decisive regression / command | Remaining boundary |
| --- | --- | --- | --- | --- | --- |
| R27 | `admission.rs` source ceilings | Old 24-file/2-GiB/400M caps still enforced | `77de3367` (bounds/guards only; ceilings retained) | `cargo test -p canopi-desktop --lib services::lidar::` | Large-fixture lanes to lift ceilings **unavailable**; amendment remains authority |
| R28 | `stage_managed_original`, `hash_file*` | Copy/hash ignored cancel | `77de3367` | focused `services::lidar::` + cancel tests | OS I/O stalls not interruptible (explicit) |
| R29 | `collection::measure` | Catalogue lock held through `coverage_bounds` | `77de3367` | focused `services::lidar::` | — |
| R30 | `engine::run` on conversion | 600 s elapsed ceiling on source conversion | `77de3367` `run_uncapped_conversion` | focused `services::lidar::` | Controllable clock test deferred |
| R31 | `analysis::run_slope_job` | 25M dense guard before sparse path | `77de3367` | focused `services::lidar::` sparse slope tests | — |
| R32 | import attachment | Never attached on completion | `96e4828d` | `lidar-import-attachment.test.ts` | Live Desktop drive **unavailable** |
| R33 | `library-store` polling | Panel dispose stopped shared timer | `96e4828d` | `lidar-library-store.test.ts` | — |
| R34 | inspection head change | Displayed answer stayed current | `96e4828d` | `lidar-inspection.test.ts` | — |
| R35 | `beginInspection` re-aim | Dropped cancellation handle | `96e4828d` | `lidar-inspection.test.ts` | — |
| R36 | provider config identity | Old session paired with new key | `837e67a0` | `review-provider-regressions.test.ts` | Live restricted-key **unavailable** |
| R37 | viewport coalescing | Latest viewport lost | `837e67a0` | `review-provider-regressions.test.ts` | — |
| R38 | Ready before metadata | Imagery ready without metadata | `837e67a0` | `review-provider-regressions.test.ts` | — |
| R39 | metadata failure recovery | Could not recover to Ready | `837e67a0` | `review-provider-regressions.test.ts` | — |
| R40 | zoom availability | Only decreased against prior clamp | `837e67a0` | `review-provider-regressions.test.ts` | — |
| R41 | contribution identity | Metadata destroyed tile source | `837e67a0` | `basemap-contribution.test.ts` + regressions | — |
| R42 | settings feedback | Cached keyless prompt | `837e67a0` | `basemap-settings.test.tsx` | — |
| R43 | capacity evidence | Residue claimed as peak | (claim corrected; peak sample **unavailable**) | receipt wording + R26 table labels | Live peak/concurrent queue/large fixtures **unavailable** |

Audit note: C0–C5 beyond these examples were re-checked at the final callers
(Analysis Retry, native inspection currency, legacy libraries, saved Design
round-trip, provider errors). No new in-scope defect was found outside the
table; independent acceptance is still required.

## R15–R25 repair record

Historical implementer repair claims below name their revisions and tests.
The current review identifies remaining gaps in several of the same families;
these rows are not independent acceptance of the complete obligation.

| Finding | Reproduction (red) | Repair | Committed regression |
| --- | --- | --- | --- |
| R15 sample the displayed point | `inspectionAimForScenePoint` turned a scene point into anchor + metre offset, and `inspection.rs` rotated that offset back and added metres to raster CRS coordinates — wrong for any projected CRS whose units are not local metres, and impossible for a degree grid | `85d19ca7`: the request carries only the sampled WGS84 point, produced by the canvas's own `worldToGeo`; `apply_scene_offset`, the anchor-plus-offset request shape and the duplicated bearing math are deleted | `inspection::tests::the_real_transform_lands_in_the_expected_cell` (real `gdaltransform`, independent Web Mercator oracle, non-equatorial latitude); `lidar-inspection.test.ts` asserts the exact outgoing request in `publishes a sampled value for the point the canvas displayed` |
| R16 read results through their storage contract | `inspection.rs` parsed analysis heads as `import::GenerationManifest` (results carry `analysis::ResultManifest`) and took units from the source layer, so a published slope failed before sampling | `85d19ca7`: source and result resolve separately; a result reads its published chunks and reports its own degrees/percent unit | `inspection::tests::a_slope_result_reports_the_unit_it_was_computed_in`, and `analysis::tests::inspection_reads_a_published_slope_result_in_both_units` — a real plane published through the import path, sampled at a known cell in both units against the fixture's geometry (45° / 100 %). Mutation-verified: restoring the reviewed parse fails it with `invalid type: null, expected f32`, which is the reviewer's exact mechanism |
| R17 do not clip to the original lattice | `containing_pixel` rejected negative cell coordinates and cells beyond `grid.width/height`, so valid appended coverage read as NoData | `85d19ca7`: signed lattice coordinates with a representability guard only; coverage is the reader's answer; preserved dense sources read through their compatibility lease instead of a blanket refusal | `cells_beyond_the_lattice_rectangle_keep_their_signed_coordinate`, `the_containing_pixel_is_half_open_at_the_far_edges`, `an_unrepresentable_lattice_index_is_refused` |
| R18 bind inspection to the lifecycle | Review probes: a pending answer published after the head changed, and inspection survived a Design replacement. The pointer disposer was discarded and `sampleInspectionCentre` had no caller | `85d19ca7`: the session names the document session identity, entity, request and expected head; the head is re-checked at publication; the disposer is owned and released; a Design replacement ends the session; a focusable Sample at view centre button runs the same command | `does not publish an answer whose head moved while it was in flight`, `releases inspection when the Design is replaced`, `releases the canvas gesture when inspection ends or is reconciled away`, `samples the viewport centre through the same command as a click` |
| R18 **remaining half** — real read cancellation | `lidar_sample_pixel` still built `AtomicBool::new(false)` and never entered the shared read admission, so a superseded or exited inspection could not stop bounded native work and the frontend never cancelled it | `b4ab8fe6`: the request carries an opaque `request_id`, the command takes the same display admission the tile route uses (`admit_sample_request`, named `sample-{id}`), and `lidar_cancel_sample_pixel` cancels the real flag through `cancel_sample_request`; the frontend keeps `pendingRequestId` and cancels a superseded lookup instead of orphaning it | `mod.rs`: `inspection_reads_share_the_display_admission_and_are_scoped` (GDAL lane), and `lidar-inspection.test.ts`: `cancels the superseded lookup by the id it was submitted under`. Mutation-verified: restoring `AtomicBool::new(false)` fails the cancellation regression, which is the reviewer's exact mechanism |
| R19 make the official request path usable | Review probes: the published descriptor kept `session={session}`, no transformer supplied a token, the viewport request omitted the key, expiry parsing accepted a number where the response has an epoch-seconds string, and copyright/`maxZoomRects` were ignored | `39cfb9a5`: credential-free template plus a per-map `transformRequest` that adds the live session and key for the fixed Google tile endpoint only; keyed viewport request; string expiry; copyright and `maxZoomRects` become the layer's attribution and zoom ceiling; metadata failure is an actionable unavailable state | `serves an authenticated tile request through the map transport`, `authenticates viewport requests and installs their attribution and zoom`, `reports viewport metadata failure as an actionable unavailable state` |
| R20 wait for a mounted map's style | `bindBasemapProvider` applied a ready contribution straight from `onCreate`, before MapLibre finishes loading even an inline style, where `addSource` throws | `39cfb9a5`: the binding waits for style readiness and applies the latest published state once ready | `waits for a mounted map style before mutating it, then applies the latest state` |
| R21 finish shared provider ownership | The Canvas built a static contribution, so a configured key was silently ignored there; Location/WorldMap captured the key once, refreshed no viewport metadata, renewed no session and never disposed their provider | `39cfb9a5`: one concrete provider per map lifetime on Canvas, Location and World Map; the configuration is read per call; settled `moveend` refreshes metadata in place; renewal is scheduled before expiry; the provider and its credential are disposed with the map | `follows the official Google session path when a device key is configured` (canvases constructor transform + outgoing URL), `clears the transport credential when the provider is disposed`, `keeps the map contribution stable across a key change without recreating it` |
| R22 enforce the body bound while reading | `basemap-http.browser.ts` checked `Content-Length`, then called `response.text()` and compared `text.length`, so a chunked answer was buffered whole and the cap was counted in characters | `39cfb9a5`: byte count enforced from the streamed chunks, with the reader cancelled on excess | `enforces the byte cap on a stream that declares no length`, `counts bytes rather than characters…` — mutation-verified: restoring the old `response.text()` implementation fails both |
| R23 Data owns the import workflow | `DataPanel` started the import but rendered no progress; progress/review/Apply lived only in the Layers panel | `bf43af19`: Data renders its layer's job — phase, determinate progress, Cancel, the named failure and Retry — while the job stays library-owned | `lidar-panel-corrections.test.tsx`: `renders the tracked job of its own layer with progress and Cancel`, `names the failure and offers Retry when the job failed`, `shows another layer its own import action rather than this job` |
| R24 undoable Remove from Design | Layers offered library/result deletion but no Remove from Design, and no remedy for unavailable references | `bf43af19`: every entry, unavailable ones included, has Remove from Design through Design Edit, with no library deletion | `removePresentationEntry` writes through the existing `removeLidarEntries` seam; the R24 action is exercised through the panel's action menu |
| R25 make Analysis failures and units observable | A failed Run settled with no visible explanation (the action swallowed the error into a status the panel did not render); Run stayed enabled until a library refresh; every Layers row was labelled `slopeDegrees` | `bf43af19`: the action publishes **and** re-throws; Analysis renders that status and latches the submit; the result's unit is carried on the library summary from the definition's parameters and used by both panels | `shows the failure the action published as well as one it threw`, `refuses a second Run before the first request settles` — mutation-verified by reverting the status render and the latch |

The implementer reported these cases repaired. The current independent review
found additional failures within their accepted lifecycle and resource contracts.

## Gate results at the delivered tip

Every gate below ran on `b4ab8fe6`, the code tip of this delivery, on this host.
The log names are the retained evidence in the ignored scratch tree.

| Gate | Result |
| --- | --- |
| `cargo fmt --all -- --check` | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| `cargo check --workspace` | PASS |
| `cargo test --workspace` | PASS — 363 `canopi-desktop` + 41 + 1 + 7 + 2, 0 failed (70 ignored, run separately below) |
| `native_command_policy::tests` | PASS — 13 |
| Frontend `npx vitest run` | PASS — 284 files / 2766 tests |
| `npx tsc --noEmit`, `npm run check:ui` | PASS |
| `npm run build`, `npm run build:web` | PASS |
| `npm run check:types` | PASS — no binding drift |
| `python3 scripts/check_docs.py` | 0 errors |
| **GDAL-backed ignored LiDAR lane** | **PASS — 70 passed / 0 failed**, 865.88 s, `--test-threads=1 --nocapture`, with `CANOPI_LIDAR_E2E_FIXTURE`, `CANOPI_LIDAR_MNH_DIR` and `CANOPI_LIDAR_CAPACITY_PLANE` naming real fixtures (`round4-ignored-lane-b4ab8fe6.log`). This discharges `canopi-a7ot`: the four code-level failures it tracked are repaired or repurposed to the current contract, and the fixture-dependent ones run because their fixtures are named. A run without those variables is **not** a pass and no lane result is claimed for it |

Not run, and therefore not claimed: Windows and macOS builds, the packaged-window
smoke, a **driven** isolated Desktop or Web session, live restricted-Google-key
qualification, and any non-publishing CI dispatch.

`b4ab8fe6` is the code tip; the commits that follow it on this branch change
documentation and bead metadata only, so these results transfer to them and to any
later revision whose difference from `b4ab8fe6` is likewise non-source. A gate
result transfers across a commit that changes no source, and not across one that
does.

### Isolated Desktop session at `96ef5d33` (partial observation)

Recipe: `.rq-scratch/wt-candidate` on a nested `Xephyr :99` with `metacity`,
Vite on strict port 1430, and the app under `dbus-run-session` with its own
`XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_CACHE_HOME`/`XDG_RUNTIME_DIR` (0700).
Evidence: `.rq-scratch/smoke-r19/evidence/` and the retained isolated profile.

**Observed.** The candidate builds and launches as a real window; the shell
renders (title bar, File/Edit/View/Help, language and theme controls, the
12-icon panel rail, welcome screen with New Design / Open Design). The app
created its **own** isolated profile at
`…/smoke-r19/profile/data/com.canopi.app` with `user.db`, `lidar/` and the
rest, and nothing was written to the user's real profile. The dev server served
this candidate — `GET /src/components/panels/lidar/DataPanel.tsx` contains
`ImportJobStatus` — so the rendered UI is the corrected code, not another
checkout. Teardown was scoped: `:99` released, port 1430 released, no leftover
app/X/metacity processes, host `:0` untouched.

**Not observed, and why.** The workflow could not be driven. Pointer motion
reached the app (a rail hover produced its tooltip) but neither a
motion→press→release→motion click on New Design nor a body-focus-then-`Ctrl+N`
accelerator changed the UI, and the isolated `user.db` gained no `recent_files`
row, so no Design was created and the Data/Analysis/Layers panels could not be
opened. One environmental difference from the recipe's earlier successful run is
recorded as an observation, not a diagnosis: this session started with a
**"Plant database is corrupt. Reinstall or regenerate with prepare-db.py."**
banner, because the bundled `desktop/resources/canopi-core.db` was copied from
the primary checkout into this worktree rather than regenerated here. Whether
that degraded state blocks New Design was not established. Classification:
environment/automation limitation for the drive half; the launch, render,
profile-isolation and teardown halves are genuinely observed. No capability
claim rests on this session, and the corrected surfaces remain gated but
undriven.

## C1 disposition and R26

At `b4ab8fe6`, the flow, command, metadata split and review-route deletion
landed, with the measurements below. **C1/R26 remains partial:** these runs do not
prove the uncapped source amendment, peak live storage or all lifecycle/resource
requirements. The current independent review and acceptance table govern status.

**Landed — publication metadata without reading composed pixels.** Catalogue v18
relaxes `coverage_cells` to nullable and adds
`display_min_value`/`display_max_value`/`display_basis`, preserving every existing
exact value and labelling it `exact`, with an interrupted-upgrade rollback
regression. The read model carries unknown coverage and the labelled display
range end to end, and "unknown is not zero" is applied at composition readiness,
the Layers empty state, the coverage fact, the history rows and the Data panel.
`collection::measure` is now a derivation over stored member facts: exact facts
are reported only when derivable (empty composition, one-member composition,
all-members-empty), and everything else reports unknown exact coverage and range
plus a `SourceEnvelope` display range. Tiles and legends consume the display range
with a per-column fallback to the exact range. Reorder, remove, Undo and Restore
therefore publish without decoding the prior collection, and the ordered lifecycle
test still verifies the composed window, reorder, remove, undo and restore cell by
cell.

*Two defects the GDAL lane caught while landing that:* a single four-argument
`COALESCE` over the display and exact columns returned the *minimum* for both
bounds, collapsing the colour domain to a constant; and the display scale read
only the exact columns, so an unknown exact range collapsed it. Both now fall
back per column, and both failures are pinned by the lane.

**Landed — the user flow and its command.** `lidar_import_sources(layer_id,
paths)` is the production route: one job prepares each source, validates the
whole batch, publishes atomically and settles as complete, failed or cancelled,
never entering `AwaitingReview`. The target head is captured before preparation
and rechecked inside the publication transaction. Data opens the chooser first —
cancelling it creates no dataset, job or asset — then shows the chosen files with
a name suggested from the first one and an interpretation that must be chosen
explicitly; adding to an existing dataset reuses that dataset's interpretation.
A batch it cannot use refuses entirely and now names the user's file, where the
staging error used to name the hashed staging copy.

**Landed — the retired path is deleted.** The review screen is gone, so its
whole machinery went with it: the composed scan that classified incoming
coverage against the accepted head, both preview renders, the decision preview,
the `awaiting_review` step, the three commands that drove them, the review
payload in the shared contract, and the ~60 preview references in the native
tests. **A production import no longer pays for a whole-composition comparison
and two preview images that nothing displayed.** Preparation now ends by moving a
validated batch to publishing in one guarded update inside `stage_import`, so a
caller cannot forget the transition and a job cancelled while it prepared stays
cancelled and its publication is refused. Dependent analysis refresh moved with
it: a committed import enqueues one refresh per definition. A refused batch names
each file it is about (`<file>: <reason>`).

Six fault-injection and resilience tests (promotion rollback, later-source
rollback, collision ownership, unresolved recovery, post-commit cleanup failure,
journal-clear evidence) were recovered from the pre-deletion revision and adapted
to the one-step route, so the publication-failure coverage R26 requires is
intact. Coverage that belonged to the deleted surface alone (review traversal,
preview pixels, the retired union-envelope admission rule, awaiting-review
restart) is retired with it.

### R26 measurements at the code tip

Every figure below was produced by the production callers with no admission
override at `b4ab8fe6`, in one `--ignored --test-threads=1` lane run on an
otherwise idle host (`.rq-scratch/round4-ignored-lane-b4ab8fe6.log`, 70 passed /
0 failed / 865.88 s; the earlier isolated runs of the first two rows are committed
at `5a1012b0` and `b495b11c`).

| Input (identity) | Cells and bytes | Durable | Post-settlement job residue (not peak) | Sampled peak RSS (50 ms ticks) | Cold display / repeats |
| --- | --- | --- | --- | --- | --- |
| 24 synthetic placed rasters, 32×24 cells each in three columns eight rows apart (24 occurrences, the production file ceiling; GDAL-converted GeoTIFFs) | 18,432 processing cells over a **60,809,728-cell** union; **0 resolved composition bytes** | none (fixture root removed) | 0 files / 0 bytes | **48 MiB** incremental (base 49, peak 98); largest single member 49 MiB over 2 members — 117 complete / 61 incomplete ticks | — |
| 12 real IGN MNH tiles, 16,000,513 B each (**192,006,156 B** in) | 48,000,000 valid cells; exact coverage **unknown**, display range **[-1.7019, 39.2840]** as `source-envelope` | **596,449,840 B in 57 files** | **0 files / 0 bytes**, job scratch `[]` | **66 MiB** incremental (base 32, peak 99); largest single member 68 MiB — 1555 / 63 ticks | z18 **2510 ms**, z17 **2586 ms**, z16 **4585 ms**, z15 **4740 ms**; three repeats each **0 ms** (bounded tile cache) |
| Synthetic capacity plane, **1,677,760,928 B** (20,000×20,000 Float32 = 400,000,000 cells, 4 declared NoData rectangles) | **396,979,300 valid cells**, exact range **[3,469,900.25, 3,477,399.75]** | **4,951,034,977 B in 9 files** | **0 files / 0 bytes**, job scratch `[]` | **177 MiB** incremental (base 32, peak 209); largest single member 177 MiB — 10734 / 16 ticks | z14 **8115 ms** cold; three repeats **0 ms** |
| IGN MNT ground tile (4,000,000 cells) + slope | 1 occurrence, slope publishes 4 result and 4 quality chunks | — | — | **66 MiB** incremental (base 37, peak 104) — 330 / 21 ticks | — |

Reading the table honestly:

- **The peak is a lower bound.** The sampler measures the test process tree every
  50 ms and reports incomplete ticks; a shorter peak between ticks can be missed,
  and the RSS sum double-counts shared pages. Both facts are printed by each gate
  and are not suppressed here.
- **The 1 GiB combined budget is met with margin in all four lanes**, and the
  composition line shows these peaks are *one dominant process plus a modest
  remainder*, not accumulating concurrency: 177 of 209 MiB is one member on the
  plane, 68 of 99 MiB on the MNH batch. No lane approaches the 128 MiB per
  conversion cache ceiling by accumulation.
- **Cleanup was measured, peak live scratch was not.** Post-settlement job
  residue is zero in both large lanes. `report_library_bytes` runs after work
  settles; no peak-capacity claim follows from it.
- **Display timing is a measurement, not a quota.** A cold tile over the
  400M-cell plane took 8.1 s and over the 12-tile batch 2.5–4.7 s; every repeat
  was served from the bounded tile cache in under the timer's resolution. Nothing
  here is a latency promise, and no optimization target is derived from it.
- **"No prior-composition pixel reads" is structural, not instrumented.** There is
  no read counter seam; the claim rests on `collection::measure` calling only
  catalogue member facts plus arithmetic over member extents, on
  `publish_applied_snapshot` composing nothing, and on the observed **0 resolved
  composition bytes** for the 24-source batch. It is stated as a property of the
  code path, not as an instrumented count.
- **What the lane does not measure.** There is no queue-depth bound: the lanes show
  no queue accumulation, which is an observation and not a limit. The
  low-space/write-failure path is still unverified with probe evidence and its
  environment limits are recorded in [C1 low-space and write-failure](#c1-low-space-and-write-failure-not-verified-and-here-is-why).
  Cancellation settlement was measured at **101.4 ms** against the 5 s contract
  bound (`a_cancelled_engine_conversion_settles_within_the_contract_bound`).

**Retired compatibility claims stay retired.** The overlap-replacement checkbox,
compulsory merged-source publication and the Q prerequisite remain retired, and no
"unlimited capacity" claim is made. The production admission rule is 24 files,
2 GiB per file, 2 GiB per selection and 400,000,000 processing cells charged per
occurrence; the 25,000,000-cell envelope guard survives only for the preserved
dense format.

**The preserved dense route.** It is test-forced and unreachable in production
(`chunked_publication_enabled` is `const true` outside tests). Its publications
record no snapshot lineage, so a dense head offers no composition Undo — the
pre-rework behaviour, unchanged, and now asserted as such instead of assumed
away. On the next accepted import the shipped ordered route wraps that dense head
as one indivisible `previous-composition` member, which is what restores Undo for
a grandfathered layer; the real-fixture dense lane now drives exactly that
sequence, including the restored head rendering the same tile.


**Partial capacity evidence at this revision.** The table above and notes report input identities, cells and bytes, working memory with its sampling
interval, cache/concurrency composition, durable storage and
settled residue. Peak live scratch was not sampled; low-space/write failure remains
unverified with its environment limits instead of being passed off as covered;
the metadata-only claim is stated structurally rather than as an instrumented
count; and cold/three-repeat display timing is recorded as a measurement rather
than an optimization quota. The live-proof fields (edition, dev versus package,
isolated profile, UI trigger, observed outcome) are deliberately empty: no driven
session exists, and the specific prerequisites are named rather than implied.

## Prior delivery at 5d0a5e0b

The following records are the implementation agent's prior delivery. Any claim of
capability completion is superseded by the current correction boundary above;
its actual measured results retain their named scope. “Temporary 0” below means
post-settlement residue, not peak conversion space. The old 24/2-GiB/400M policy
is historical and does not govern the amended route.

## Baseline and claim boundary

| Identity | Revision |
| --- | --- |
| Accepted foundation | `34e4ded4` on `feature/bounded-raster-generations` |
| Whole-rework handoff docs | `a96dcfd9` on `feature/raster-html-references` |
| Integrated `main` (C0) | `f61f8494` |
| Candidate `feature/raster-rework-completion` | `5d0a5e0b` (reviewed delivered tip; earlier sections name the revision they measured) |

C0 merged the accepted foundation with the handoff. The bounded stack re-parented
`af8aed87` under `34bf6041`, so `main` could not fast-forward and a deliberate
merge was required. Conflicts were documentation status/guidance lines only and
were resolved in favor of the handoff's current status; the bounded branch's
revision-labelled debrief evidence (`d53f4185` correction outcome, repair
outcome, interventions) was preserved and placed before the historical section.
The integrated tree has **zero non-doc changes above `34e4ded4`**.

Every inventoried accepted tip is an ancestor of `main`: `868ba7d6`, `a5fc7d7b`,
`34e4ded4`, `af8aed87`, `a96dcfd9`, `0e696722`, `64050896`, `524eef55`,
`d53f4185`. Verified remote `main` before integrating: `origin/main` was
`868ba7d6`, a clean ancestor of the accepted foundation.

**Preserved user work.** The primary checkout is untouched: its modification to
`desktop/src/native_operation.rs` (a rustfmt import-ordering diff) and the
untracked `.beads.gate.lock` were never staged, stashed, reset or overwritten.
The `wt-bounded` and `wt-geolibre` worktrees and their evidence are intact. No
branch or worktree was deleted.

## Capability and acceptance evidence

| Phase | State | Decisive evidence | Remaining limitation |
| --- | --- | --- | --- |
| C0 | **Done** | Integration `f61f8494`; ancestry table above; `cargo fmt`, strict Clippy, `cargo check`, `tsc`, `check:types`, `check:ui`, both edition builds pass on the integrated tree | — |
| C1 | **Partial — measured** | Policy enabled at 24 files / 2 GiB per file / 2 GiB total / 400,000,000 processing cells, up from the retired 25M bound; the 24-tile sparse batch, the 48M MNH batch and the **400M-cell plane all run through the production callers with no override**. Envelope measured: peak **73 MiB / 92 MiB / 197 MiB** for the sparse, MNH and plane lanes, each with its composition (largest single member 65 MiB of 92 MiB for MNH, 177 MiB of 197 MiB for the plane — so the peaks are **one dominant process, not concurrency**); durable 596,548,756 bytes in 59 files for MNH and 4,951,029,490 bytes in 11 files for the plane, temporary **0** in both; cancellation settling in 101 ms against a 5 s bound. See [C1 measured envelope](#c1-measured-envelope) | Cold vs three-warm display timings are unmeasured; there is no **queue-depth bound**, only a sampled observation that these lanes do not accumulate a queue; the low-space/write-failure path is unverified with probe evidence and named environment limits; no whole-union-allocation claim is made |
| C2 | **Implemented, not live-verified** | Data, Analysis and Layers ship as production panels beside Layers through existing shell composition; slope in degrees or percent with an author-named result (catalogue v17); an other-continuous dataset must declare a unit label or an explicit unknown; Layers is a flat geographic presentation list with independent eyes | The end-to-end import chain is unobserved, so the surfaces are verified by unit and native tests rather than a driven Desktop pass |
| C3 | **Implemented, not live-verified** | `inspection.rs` implements `sample(entity, expected generation, WGS84 point)`: `gdaltransform` to the raster CRS, north-up half-open containing pixel, `apply_scene_offset` inverting the canvas conversion, and four tests including an independent oracle across bearings 0/30/90/180/271.5/359 | The transform and pixel selection are checked against a **hand-derived Web Mercator oracle** (`the_real_transform_lands_in_the_expected_cell`), mutation-verified by swapping the coordinate pair, so a wrong axis order or a row-inversion off-by-one fails rather than passing as a plausible number. No value has been read off a **live session** against an independently known source or slope value; hole/edge NoData and late-answer fencing are covered by tests, not by observation |
| C4 | **Implemented; provider path driven end to end against a scripted tier** | Shared provider module with `google_satellite`, ADR 0028 replacing the Web-v1 restrictions in ADRs 0013/0016; both map surfaces take their basemap from `basemap-bind.ts` rather than recreating the map on a provider/key/session change. `basemap-provider-binding.test.ts` drives a **real `BasemapProvider` through a scripted Google session tier into a recording map** and asserts the official descriptor reaches the source, the session token never reaches the published state or the map, a rejected key withdraws the contribution with a sanitized reason instead of downgrading, and a re-issued generation keeps exactly one contribution | No **live** provider session: nothing was requested from Google, so attribution and error states are unobserved and the official path still needs a real restricted key. Isolated Web placement is unrun |
| C5 | **Documents and gates done; platform unrun** | Combined gates pass on the candidate ([table](#c5-final-gate-run-on-the-delivered-candidate-round-31)); the [debrief synthesis](review-and-debrief.md#final-synthesis) is written; the tracker is reconciled with `canopi-jv8a.2`, `canopi-jv8a.4`, `canopi-j571.2` and `canopi-kko3` closed | Windows and macOS compilation, a packaged-window smoke and the packaged Web artifact are unrun and need a host this environment does not have |

### C1 detail

Production admission for new ordered imports is 24 files, 2 GiB per file, 2 GiB
total selected bytes and 400,000,000 processing cells. The 25,000,000-cell
union-**envelope** bound was removed from the ordered path and retained as the
legacy **dense** allocation guard. The branch that will run decides which bound
applies, and Apply rechecks against the expected head. Reorder, remove,
Undo/Restore and reads of accepted generations stay grandfathered.

`sparse_twenty_four_tile_batch_stays_chunk_sized` runs with no admission
override and passes under the real policy:

```
24 tiles: 18432 cells in 24 members, 0 resolved bytes, union 60809728 cells, proposed 18432 processing cells
24-tile batch: process tree sample every 50 ms: baseline 14 MiB, peak total 73 MiB,
  incremental 59 MiB, largest observed subtotal 73 MiB over 174 complete and 53 incomplete ticks
```

The union is **above** the retired 25M bound and is admitted because processing
cells charge per occurrence, not the empty space between the sources. This is
the sparse case the contract names, and it is a production-policy witness rather
than an overridden probe.

`e2e_mnh_batch_import_apply_display_restart` also runs with no admission
override and covers the whole pipeline the contract names for this batch —
import, reopen and display — rather than only admission:

```
MNH batch: 12 tiles
staged: uncovered=48000000 overlap=0 invalid=0
applied: 48000000 cells, 12 source occurrences, 12 retained source COGs, range Some(-1.7018585205078125)..Some(39.28395080566406)
tile 18/130771/90786: 41465 bytes
tile 17/65385/45393: 72481 bytes
tile 16/32692/22696: 54315 bytes
tile 15/16346/11348: 60384 bytes
drawn tiles: 4 (228645 bytes)
restart: 48000000 cells
MNH batch: process tree sample every 50 ms: baseline 17 MiB, peak total 96 MiB,
  incremental 78 MiB, largest observed subtotal 96 MiB over 2330 complete and 65 incomplete ticks
```

The batch is admitted at exactly 12 files and 48,000,000 processing cells, both
inside the production policy. Every tile is its own source occurrence with its
own retained COG, the composition materializes **no** resolved result chunks,
the sparse display draws real tiles, and the head survives restart with the same
coverage. Peak sampled working set is 92 MiB on the final revision (96 MiB on
the earlier run recorded below), far inside the 1 GiB gate.

Correcting that test also removed a real staleness: it asserted the composed
`CogChunksV1` publication format the ordered route replaced, so it had been
describing a storage model production no longer uses.

## Capacity and scientific measurements

Environment: Linux Mint 22.3, kernel 7.0.0-31, x86_64, 8 CPUs, 31 GiB RAM,
98 GB free on `/`, GDAL 3.8.4, Xephyr and `dbus-run-session` present,
`DISPLAY=:0`.

Fixture identities verified by SHA-256 before use:

| Fixture | Verified identity |
| --- | --- |
| Ground MNT `LHD_FXX_0445_6806_MNT_O_0M50_LAMB93_IGN69` | 16,000,513 bytes; `7b8773046c27d3f42d9f6548c7adc24fca810de19ea6ed5f49b29302e22076ad` |
| MNH `LHD_FXX_0445_6806_MNH_O_0M50_LAMB93_IGN69` | 16,000,513 bytes; `c4e2938e8a166b723f25c7ac3f5a64d21555671b758fb3b40b71daac45a8bc28` |
| 12-tile MNH batch | 192,006,156 bytes total; 2000×2000 Float32 0.5 m, NoData −9999, aligned 8000×6000 union = 48,000,000 cells |

Synthetic capacity plane generated by
`scripts/generate_capacity_plane.py` and verified independently:
20,000×20,000 = 400,000,000 cells, Float32, 0.5 m, NoData −9999, **no
compression**, 1,677,741,204 bytes (above 1 GiB), geotransform
`(700000.0, 0.5, 0, 6600000.0, 0, -0.5)`. Four NoData holes cross 512-cell
block and 2,000-row strip boundaries. Sampled values agree with
`z = 0.25x + 0.5y − 100` within the Float32 quantisation bound of 0.0625 m
(well inside the 0.5 m pixel spacing and the contract's slope tolerances), and
every hole interior reads NoData with an adjacent outside pixel reading data.
Analytic oracle: **29.205932° / 55.901699 %**. This plane is synthetic and is
never described as a survey; it is not derived from the private fixtures.

`e2e_capacity_plane_import_display_and_bounded_reads` drives that plane through
the production callers with no admission override and no test-only limit:

```
capacity plane: 1677760928 bytes
staged: uncovered=396979300 overlap=0 invalid=3020700
applied: 396979300 valid cells, 3020700 invalid, range Some(3469900.25)..Some(3477399.75)
restart: 396979300 cells
tile 14/8331/5798: 28980 bytes
seam window: 16 samples match the analytic plane
holes: 4 declared rectangles read as exactly NoData
hole edge: pixels west of hole 0 are valid
capacity plane: peak total 197 MiB, incremental 181 MiB over 15759 complete and 19 incomplete ticks
```

The run passes the contract's combined budget with the whole pipeline — managed
original, preparation, review, Apply, reopen, display and bounded reads —
inside **181 MiB incremental**, nine times under the 1 GiB gate.

Coverage plus invalid is exactly 400,000,000, and the invalid count is exactly
the four declared holes' own area, so the holes were excluded rather than
counted. The composed range matches the plane's analytic extremes. Import took
850 s on this host.

**Defect this measurement exposed and repaired.** `validate_working_grid` — the
25,000,000-cell **dense memory** guard — was being applied to `source raster`
staging, which never allocates the source grid: `gdal_translate` streams the
file into the retained COG and the facts/regions are derived from that COG in
bounded windows. The guard therefore refused a 400,000,000-cell source that
fits its own disk estimate comfortably. That is precisely the ceiling C1 exists
to remove, and no existing test caught it because every synthetic fixture is
far below 25M cells. The source path now uses `validate_lattice` (non-empty
extent, checked dimensions, finite geometry, non-degenerate pixel size) and
relies on the disk-space estimate that `write_job_source_cog` already performs;
`validate_working_grid` still guards the steps that really do allocate a whole
area — raw extraction, dense composition, legacy replay and slope.

**Second defect, and a resource failure the gate caught.** The same run's
combined-memory gate failed: `capacity plane must stay inside the 1024 MiB
combined working-memory budget: an observed subtotal already reached 1660 MiB
over baseline`. All numeric results in that run were correct — coverage, holes,
seam samples, hole edges and display all passed — so this was purely residency.

Localised to GDAL's block cache, which defaults to a share of *system* RAM rather
than to anything this pipeline budgets. Measured directly on the plane's own
conversion:

| Conversion | Peak RSS | Wall |
| --- | --- | --- |
| `gdal_translate`, default cache | 1,735,712 KB | 19.95 s |
| `gdal_translate`, `GDAL_CACHEMAX=134217728` | 214,888 KB | 13.45 s |
| `gdalwarp -wm 268435456` | 1,908,068 KB | 25.96 s |

One engine process grew to the size of the whole raster. The resource policy
already reserves 128 MiB for decoded raster data, so every engine process now
receives exactly that through `GDAL_CACHEMAX`; the engine can no longer take
memory the pipeline never budgeted, and the bounded run is also faster because
the cache was thrashing rather than helping. This is a defect the capacity gate
existed to catch, not a reason to raise the gate. With the bound in place the
same run reports **181 MiB incremental against the 1024 MiB budget**.

Not measured: temporary/durable bytes, queue and cache peaks, cancellation
settlement timing, low-space and write-failure behaviour, and cold/three-warm
display timings. Values not measured remain unknown; no whole-union-allocation
claim is made.

## Gates, application and platform evidence

### C5 combined gates on the candidate (round 21)

Run once across the whole workspace at `36b576c2`, with `CARGO_HOME` and
`CARGO_TARGET_DIR` pointed at the inspected isolated cache:

| Gate | Result |
| --- | --- |
| `cargo fmt --all -- --check` | pass |
| `cargo clippy --workspace --all-targets -- -D warnings` | pass |
| `cargo check --workspace` | pass |
| `cargo test --workspace` | pass — 362 passed / 76 ignored in the desktop crate, plus 41, 7, 2 in the others |
| `cargo test -p canopi-desktop --lib native_command_policy::tests` | pass — 13 |
| `npx tsc --noEmit` | pass |
| `npm run check:types` | pass (no generated drift) |
| `npm run check:ui` | pass |
| `npx vitest run` | pass — 280 files / 2731 tests |
| `npm run build` | pass |
| `npm run build:web` | pass |
| `node scripts/check-web-build-boundaries.mjs` | pass (exit 0) |
| `python3 scripts/check_docs.py` | pass (0 errors) |

The 76 ignored Rust tests are the GDAL- and fixture-backed lanes; individual ones
have been run and are recorded above, but the full ignored lane has not been run
as one command on this revision and is not claimed.

### C1 measured envelope

One place for what C1 has actually measured, separated from what it has not, so
the two cannot be confused. Each row names the revision and the lane that
produced it; the detailed sections below this one carry the raw output.

**Measured**

| Quantity | Value | Where measured |
| --- | --- | --- |
| Production admission | 24 files, 2 GiB per file, 2 GiB total, 400,000,000 processing cells | `admission.rs`; 6 unit tests plus 3 ordered-boundary tests |
| 24-tile sparse batch | union 60,809,728 cells, 18,432 processing cells, peak **73 MiB** | `sparse_twenty_four_tile_batch_stays_chunk_sized`, no override |
| 48M MNH batch (12 tiles) | 12 occurrences, 12 retained COGs, range −1.7019..39.2840, 4 tiles drawn (228,645 B), restart reuse, peak **92 MiB** (76 MiB incremental) over 1,847 complete ticks, **108.22 s**; composition: largest single member 65 MiB over 2 members at most | `e2e_mnh_batch_import_apply_display_restart`, re-run on the final revision |
| 400M-cell plane | `uncovered=396979300 overlap=0 invalid=3020700`; range 3469900.25..3477399.75; restart 396979300 cells; tile 14/8331/5798 at 28,980 B; 16 seam samples match the analytic plane; 4 holes NoData; hole edge valid; peak **197 MiB** (181 MiB incremental); composition: largest single member 177 MiB over 2 members at most | `e2e_capacity_plane_import_display_and_bounded_reads` |
| Durable bytes (plane lane) | **4,951,029,490** in 11 files — 2.95× the 1,677,760,928-byte source, dominated by derived chunk output | same lane, `report_library_bytes` |
| Temporary bytes (plane lane) | **0**, no job scratch left; now an assertion rather than an observation | same lane |
| Cancellation settlement | **101 ms** against a 5 s bound, on the real kill-and-reap path | `a_cancelled_engine_conversion_settles_within_the_contract_bound` |

### C4 provider path: driven end to end against a scripted tier (round 37)

"No live provider evidence" was too coarse a limitation, because most of the C4
provider path is exercisable without Google: the provider, the session handling,
the generation fence and the map binding are all product code, and only the
network peer is external. `basemap-provider-binding.test.ts` therefore drives a
**real `BasemapProvider`** — not a stub — against a scripted Google tier, through
`bindBasemapProvider`, into a recording map, and asserts the properties that
matter:

| Property | Assertion |
| --- | --- |
| The key belongs to the session request | the `createSession` URL carries it, and no other |
| The official path is the one used | the published descriptor is `provider: google, official: true`, not the keyless fallback |
| Imagery reaches the map | the reconciled source is a raster whose tile URL is the Google endpoint, with the layer present |
| The session credential stays internal | neither the published state nor the map's source definitions contain the token |
| A rejected key degrades honestly | the contribution is **withdrawn** and the reason is sanitized — the UI does not keep another provider's tiles under the Google name |
| A re-issued generation does not accumulate | exactly one source and one layer survive a repeated update |

The withdrawal assertion is verified by mutation: disabling withdrawal in
`reconcileBasemapContribution` makes that test fail, so it detects the regression
rather than merely passing.

**What is still not established, and why the limitation is now narrower.** Nothing
was requested from Google: this is a scripted tier, so it shows the product code
handles a session correctly, not that the account or endpoint behaves as expected.
Live attribution and error states remain unobserved, and the official path still
needs a real restricted key. Isolated Web placement remains unrun. The claim this
round supports is about the **provider and binding**, not about the service.

**Composition of the peak (round 36).** The totals above cannot distinguish one
large conversion from several resident at once, so the sampler now also reports the
largest single member, the highest member count in any tick, and the block-cache
ceiling each managed child is launched with. Measured on the plane lane:

```
peak total 197 MiB, largest single member 177 MiB over 2 member(s) at most,
each managed conversion may hold up to 128 MiB of block cache (GDAL_CACHEMAX)
```

That answers the queue-versus-working-set question the totals could not. The peak
is **one dominant process**, not concurrency: 177 of 197 MiB sits in a single
member, and at most two members were ever resident, so there is no queue
accumulation in this lane. Of that 177 MiB, at most 128 MiB is the child's GDAL
block cache, leaving roughly **49 MiB of process and GDAL working set** — which is
the part a capacity decision can actually influence, since the cache ceiling is a
constant the engine sets.

This is a decomposition, not a new upper bound: the member figures come from the
same 50 ms samples and inherit the same lower-bound caveat.

**Not measured, and not implied by the above**

- **A queue-depth bound.** The composition above shows the observed member count,
  which is evidence that this lane does not accumulate a queue — but it is a
  sampled observation from one lane, not a bound the scheduler enforces. No lane
  drives enough concurrency to state a queue ceiling.
- **Cold versus three-warm display timings.** No display timing was taken at all.
- **The low-space and write-failure path.** Unverified, with the probe evidence and
  the environment limits that block a real test recorded in its own section below.
- **Whole-union allocation.** No claim is made that any lane never materialises a
  union-sized buffer; the admission policy bounds *processing* cells and the dense
  envelope guard bounds dense allocation, and those are the only allocation
  claims this delivery makes.

**One caveat on the plane lane's shape.** Its source is synthetic and single-file,
so it exercises the one-file-at-the-cell-ceiling path rather than a many-file
batch at the same total. The 24-tile and 12-tile lanes cover the many-file shape;
no lane exercises both extremes at once.

### C1 durable and temporary bytes, measured (round 33)

The resource contract separates **durable** bytes — what a published generation
owns and a restart must reproduce — from **temporary** bytes, which a settled job
must not leave behind. Neither was reported, so both are now measured by walking
the library tree rather than trusting a job's own accounting, and the lane asserts
the two properties that matter.

| Measurement (400M-cell plane, 1,677,760,928-byte source) | Value |
| --- | --- |
| Durable bytes after import and analysis | **4,951,029,490** in 11 files |
| Temporary bytes | **0** in 0 files |
| Job scratch directories | **none left** |
| Peak process-tree RSS | 199 MiB (183 MiB incremental) |

Two facts worth stating plainly. The durable footprint is **2.95× the source
bytes** for a plane whose sparse slope result is published as chunks, so the
durable cost of this lane is dominated by derived output rather than by the
retained source. And a settled job leaves **nothing** in `jobs`: the scratch
directory is empty, which is the cleanup guarantee that
`report_library_bytes` now enforces as an assertion rather than an observation.

The first attempt put this measurement in the wrong test — it landed in
`e2e_sparse_generation_lifecycle` and then in `e2e_mnh_batch_import_apply_display_restart`,
because two functions share the comment it anchored on, and the lane passed
three times without printing it. The lesson is the same one this receipt keeps
relearning: a measurement that does not appear in the log has not been taken, and
grepping for a line you expect is not evidence that the code producing it ran.
Both lanes now measure, each with its own label.

### C1 low-space and write-failure: not verified, and here is why

I could not write an honest test for the low-space and write-failure path, so it
stays **unverified**. Recording the reasoning matters more than the failed
attempt, because two plausible tests were written and both were discarded for
proving nothing.

The path is real: `write_job_source_cog` checks free space, then converts, then
validates, and deletes its staged output if either step fails. The free-space
check is only a prediction, so a disk that fills *during* a conversion is the case
the cleanup exists for.

**Attempt 1 — oversize declared grid.** A conversion that cannot fill its declared
grid was expected to fail mid-write. It did fail, but the test **still passed with
the cleanup deleted**, so it was detecting nothing. Cause: the conversion fails
before producing output, and GDAL's own GTiff driver removes its partial file.
**Attempt 2 — mismatched validation grid.** This one was worse: the test
re-implemented the delete in the test body, so it would pass whether or not the
production code deletes anything. A test that cannot fail is not evidence.

**A direct probe settled the underlying question.** With a 64 KiB
`RLIMIT_FSIZE` inherited by the conversion, `gdal_translate` genuinely fails
mid-write (`_tiffWriteProc: File too large`, `TIFFAppendToStrip: Write error at
scanline 8`) — and the output file **does not exist afterwards even with the
cleanup removed**, because the GTiff driver removes it. So the
conversion-failure cleanup is defensive rather than load-bearing, and the
validation-failure branch is the one that could leave a readable-but-wrong file —
but it was not reachable from a test without either re-implementing the delete or
depending on the driver leaving a file behind.

**What this means for the guarantee.** Publication is atomic and reads come from
the catalogue, never from a directory scan, so a stray file in job scratch could
not be mistaken for a published source even if one survived. The requirement that
matters — nothing is published on failure — is separately and genuinely covered by
`staged_source_rejects_an_insufficient_combined_budget_before_preparation`, which
asserts the rejection names the required and available bytes and leaves zero
converted outputs behind. What remains unverified is the narrower claim that the
staged file is always tidied away.

**Environment limits found, for whoever picks this up:** mounting a size-limited
tmpfs is not permitted here, and neither is an unprivileged `RLIMIT_FSIZE` test of
the *production* function because the limit is per-process and process-wide. A
real test wants either a filesystem seam (an injected writer that can fail at a
chosen byte) or a quota-limited fixture volume. Recorded as a limitation rather
than papered over.

### C1 cancellation settlement, measured (round 23)

The resource contract bounds cancellation settlement at five seconds: a cancelled
import must release its slot and its scratch rather than leave the user waiting on
an abandoned conversion. Nothing asserted that bound before; the cancellation
tests that existed proved *what* a cancelled job leaves behind (nothing
published, staging removed), not how long it takes to stop.

`a_cancelled_engine_conversion_settles_within_the_contract_bound` now measures it
on the real path. It builds a 128 MiB Float32 source, starts the actual controlled
COG conversion through `GdalEngine::run`, sets the cancel flag after 250 ms and
reports the wall-clock time until the call returns:

| Measurement | Value |
| --- | --- |
| Cancellation settlement | **101 ms** (an earlier 2 GiB fixture measured 202 ms) |
| Contract bound | 5 s (25–50× headroom) |
| Converted by the engine itself | yes — `gdal_translate`, so the kill-and-reap path is the one under test |

The assertion is on elapsed wall-clock time rather than on the 50 ms poll
interval, so it cannot pass merely because the code kept its current polling
cadence; and because the process timeout is 600 s, a pass additionally proves the
cancel path ran rather than the timeout. The test also asserts that a cancelled
conversion reports an error instead of a success.

Cost was reduced from 41 s to 5 s by writing the fixture in one pass at 128 MiB
instead of value-by-value at 2 GiB, with the measurement still 50× inside the
bound. It stays an ignored GDAL-backed test, consistent with the other engine
lanes.

### C1 capacity lanes re-run on the final revision (round 38)

The MNH lane was last measured before the peak-composition change reached
`measurement.rs` and before `report_library_bytes` existed, so it was re-run at the
candidate head as a regression check on the delivered code. It passes, and its
numbers moved — so the earlier figures are superseded rather than repeated:

| | Earlier run | Final revision |
| --- | --- | --- |
| Peak | 96 MiB (78 MiB incremental) | **92 MiB (76 MiB incremental)** |
| Composition | not measured | largest single member **65 MiB** over 2 members at most |
| Durable bytes | not measured | **596,548,756** in 59 files |
| Temporary bytes | not measured | **0**, no job scratch |
| Duration | 137.78 s | **108.22 s** |

The composition is the interesting part: for a 12-tile batch the cache ceiling
(128 MiB) is **not** reached, because no single conversion dominates — 65 of 92 MiB
is the largest member, so this lane's peak is one conversion plus a modest
remainder rather than cache saturation. That contrasts with the plane lane, where
177 of 197 MiB is one member and the cache ceiling is nearly the whole working set.

The timings above are test durations, not display timings: they include fixture
staging and hashing, so they are not a latency claim and are not offered as one.

### C5 verification of the final candidate

Run twice, at two revisions, because code changed between them and a gate result is
only ever a statement about the tree it ran on:

- **`e21f0d45`** first, when it was the head.
- **`2b39ee2a`** again after the inspection oracle and the documentation corrections
  landed, because that added a test to `inspection.rs` and a gate result does not
  carry forward across a source change.

Both runs are identical in outcome, and the second is the one that counts. **The
result applies to every later revision whose difference from `2b39ee2a` is
documentation or bead metadata only** — which is the case for the current head, so
the code under test is the code that shipped. Verifying a documentation commit on
its own would otherwise be an infinite regress: each correction to this table would
itself become an unverified revision. The rule this states is the useful one: **a
gate result transfers across a commit that changes no source, and not across one
that does.**

| Gate | Result |
| --- | --- |
| `cargo fmt --all -- --check` | pass |
| `cargo clippy --workspace --all-targets -- -D warnings` | pass |
| `cargo check --workspace` | pass |
| `cargo test --workspace` | pass — 363 desktop / 78 ignored, plus 41, 7, 2 |
| `native_command_policy::tests` | pass — 13 |
| `npx tsc --noEmit` | pass |
| `npm run check:types` | pass (no generated drift) |
| `npm run check:ui` | pass |
| `npx vitest run` | pass — 283 files / **2743 tests** |
| `npm run build` / `npm run build:web` | pass |
| `scripts/check-web-build-boundaries.mjs` | pass |
| `scripts/check_docs.py` | pass |

| Identity | Check |
| --- | --- |
| Candidate head | `2b39ee2a`, verified in both destinations |
| `main` is an ancestor of the candidate | yes, at `f61f8494` |
| Accepted foundation `34e4ded4` is an ancestor | yes |
| Both destinations at that revision | verified by `git ls-remote` against `github.com` and `codeberg.org` |

**Still unrun, and therefore not claimed at this revision:** Windows and macOS
compilation, any packaged (non-dev) window, the packaged Web artifact, a live
Google provider session, and any observation that depends on driving the native
file chooser. These are named rather than implied to pass.

### C5 final gate run on the delivered candidate (round 31)

Re-run once across the whole workspace at `b47c000b`, the candidate head:

| Gate | Result |
| --- | --- |
| `cargo fmt --all -- --check` | pass |
| `cargo clippy --workspace --all-targets -- -D warnings` | pass |
| `cargo check --workspace` | pass |
| `cargo test --workspace` | pass — 363 desktop / 78 ignored, plus 41, 7, 2 |
| `native_command_policy::tests` | pass — 13 |
| `npx tsc --noEmit` | pass |
| `npm run check:types` | pass (no generated drift) |
| `npm run check:ui` | pass |
| `npx vitest run` | pass — 282 files / 2739 tests |
| `npm run build` / `npm run build:web` | pass |
| `scripts/check-web-build-boundaries.mjs` | pass |
| `scripts/check_docs.py` | pass |

The final synthesis of what this delivery achieved, what it cost and what remains
is in the [debrief](review-and-debrief.md#final-synthesis).

**Not run, and therefore not claimed:** Windows and macOS compilation, any
packaged (non-dev) window, and the packaged Web artifact. Those remain the
platform gaps the contract names as release blockers rather than passes.


C0 gates on the integrated tree `f61f8494`
(`/home/daylon/projects/canopi/.rq-scratch/wt-integration`):

| Command | Result |
| --- | --- |
| `cargo fmt --all -- --check` | pass |
| `CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings` | pass (2m36s) |
| `CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace` | pass (32s) |
| `npx tsc --noEmit` | pass |
| `npm run check:types` | pass with `CARGO_HOME=/home/daylon/projects/canopi/.rq-scratch/cargo-home`; **fails** with the default Cargo home (`Read-only file system (os error 30)` creating `~/.cargo/git/db/whitebox-wasm-…`) |
| `npm run check:ui` | pass |
| `npm run build` | pass |
| `npm run build:web` | pass |
| `npm test` | **10 failed / 2654 passed** in 4 MapLibre and DuckDB-WASM files — all `Test timed out` or `waitFor` on map construction, observed while Clippy compiled concurrently at load average ~24. Environment-suspected, not yet re-run in isolation |
| `python3 scripts/check_docs.py` | pass (0 errors) on the integrated tree |

C1 focused: `services::lidar::admission::` 6 passed;
`services::lidar::` 110 passed / 72 ignored / 0 failed;
`sparse_twenty_four_tile_batch_stays_chunk_sized --ignored` passed under the
real production policy. Python GDAL bindings and `gdal_calc.py` were used for
fixture generation only.

No platform, packaged-window, mounted-map or browser evidence exists for this
candidate. Nothing here supports a Linux/Windows/macOS packaged claim.

## Failures and improvements

### Isolated Desktop launch — achieved, with input driving not established

The candidate **builds and launches as a real Desktop window** in an isolated
profile, which is the first genuine product-process evidence in this receipt:

- `cargo build -p canopi-desktop` succeeded (39 s) on `86451722`.
- Xephyr on `:99` (nested from `:0`, `-extension GLX`, software GL) plus Vite on
  strict port 1430, with the app under `dbus-run-session` and its own
  `XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_CACHE_HOME`/`XDG_RUNTIME_DIR` (0700).
- The app **created its own isolated profile**, which is the ownership proof the
  recipe names: `data/com.canopi.app/` with `user.db`, `hsts-storage.sqlite`,
  `lidar/lidar-library.sqlite` and `lidar/lidar-display-cache.sqlite`. Nothing
  was written to the user's real profile.
- A `1280x800` `Canopi` window mapped and **rendered the real application shell**:
  title bar, File/Edit/View/Help menus, theme control, the right panel rail with
  its twelve icon buttons, and the welcome screen with New Design / Open Design.
- The UI is served from this candidate, not another checkout: the dev server
  returns `AnalysisPanel.tsx` containing this assignment's `runningAnalysisJobId`.
- Teardown was clean and scoped: `:99` released, port 1430 released, and the
  user's own ports 1420/1422 never bound by this work.

**Input driving: solved.** The earlier "no click changes the UI" symptom was a
drive technique problem, not an input-delivery failure, and the diagnosis is
worth keeping. Keyboard was never broken: `Ctrl+N` created a Design on the first
attempt, which proved XTEST reached the DOM. Pointer *motion* also worked —
hovering a tool produced its tooltip — so only button events appeared dead.
Without a window manager the app does not service queued button input until the
pointer moves again or a redraw happens, so a click must be sent as
*motion → press → release → motion* with settle time after each step. With that
sequence every click lands. `xdotool` was not needed and could not be installed
(privilege escalation is blocked here), and `XSendEvent` is correctly ignored by
GTK for synthetic events.

A second technique note: the same round originally mis-read control positions
from a downscaled screenshot preview, clicking 12 px off the button. Control
positions must come from the captured pixels at their real size, not from a
preview.

**Isolated UI evidence now collected** (`.rq-scratch/smoke-r15/evidence/`):

| Observation | Evidence |
| --- | --- |
| Design workspace renders: canvas grid with metric scale, tool strip, panel rail, zoom controls, "Untitled Design" | `after-key.png` |
| Pointer interaction works: hovering a rail button shows its "Design Canvas" tooltip | `post-btn.png` |
| Location placement renders with the real map: OSM tiles, crosshair, Search/Confirm, provisional-site status, OpenStreetMap attribution | `after-rail2.png` |
| **Data panel** — title, count, the library-not-Design intro copy, and the empty state | `p-186.png` |
| **Analysis panel** — Operation/Slope, Input dataset with its empty state, Units offering **Degrees and Percent**, and a correctly **disabled** Create slope | `p-222.png` |
| Layers panel — scene stack, site references, and the LiDAR section | `p-258.png` |

This is the first evidence in this receipt of the **C2 surfaces rendering in the
real Desktop application**, and of the shared map actually drawing live provider
tiles in an isolated session. It confirms reachability, layout, copy and the
disabled/empty states.

**Still not established.** The panels were observed **empty**: no dataset was
imported, so the Data row actions, the import staging/confirmation route, the
Analysis run and previous-result list, the flat Layers presentation list and
numeric inspection were not exercised. The end-to-end
Data → import → Analysis → Layers → Inspect workflow therefore remains
unobserved, as do save/reopen and a confirmed Design Location.

**Progress and a new wall (rounds 17–18).** The Data panel's missing primary
action was found *by this session* and closed: the empty library now offers
**Import sources…**, and the new-dataset form was driven through the real
application — the name field accepted "Ground survey", the **Ground**
interpretation was selected, and the dataset was created, appearing as a row with
its measurement, coverage, state and an **Add TIFFs** action while the Data count
went 0 → 1. Dataset creation, dataset naming and the interpretation choice are
therefore verified through the real UI, not only unit tests.

**The native file chooser works, and reaching it is now understood.** Clicking
**Add TIFFs** opens the real GTK dialog, which **renders correctly** under a window
manager: sidebar, breadcrumb, file list with sizes and types, and Cancel/Open.
Adding `metacity` to the isolated session is what made the dialog drivable and
capturable at all; without a window manager it was unmapped and unreachable. That
is a real improvement to the recipe — the guide's steps 2–5 omit a window manager
and describe only the XTEST sequence.

**The remaining obstacle is autocompletion, not the dialog.** Typing the fixture
path into the location entry makes GTK autocomplete a *truncated* name:
`/home/daylon/Downloads/la magnerie/LHD_FXX_044…`, cut off at 44 characters. The
visible path has no hidden segment, so this is a different failure from the one
the guide warns about. Pressing Enter submits that truncated path, and the
application **handles it exactly as it should** — the import job failed with
`Failed to inspect /home/daylon/Downloads/la magnerie/LHD_FXX_044: No such file
or directory (os error 2)`, recorded as a `failed` job, with **no generation, no
head and no chunks published**. A bad path published nothing and kept the layer
usable.

So the chooser path itself is now proven end to end: the button opens the dialog,
the dialog navigates, a selection is submitted, the application validates it, and
a failure leaves clean state with a named error. What is *not* yet done is
submitting a **correct** filename — the next technique is the guide's
**breadcrumb and row** route, clicking the file row rather than typing a path
that autocompletion can truncate.

**A correction to a correction.** I first called the "narrow vertical column"
empty message a compositing artifact, then reclassified it as a real layout
defect after seeing it again in `l0-panel.png` and `addlayer-panel.png`. Reading
the stylesheet settles it the other way: `.emptyHint` declares only padding, a
bottom border and a colour, `.layerList` and `.section` declare only
`min-width: 0`, and no media query touches either. Nothing in the CSS can produce
a ~24 px column, so the appearance is a rendering artifact of the
under-composited session after all — my second classification was the wrong one,
made from a screenshot instead of from the code.

The lesson is the one this receipt keeps relearning: an unexplained rendering
anomaly should be checked against the declaring code before it is reported as a
defect. It stays unverified either way, so it is recorded as neither a defect nor
a pass until a clean session shows it.

| Case | Classification | Detector | Repair |
| --- | --- | --- | --- |
| The operating guides described the rework as **future work** after it had shipped. `lidar.md` said the rework "does not change the current workflow until implemented" and carried a stale instruction to "update this guide's implementation inventory and the dock contract when the new route actually lands"; `frontend-workbenches.md` never described the Data, Analysis or Location surfaces at all; and `browser-edition.md` still **forbade** the Web Location surface that ADR 0028 supersedes and the code mounts. Missed for several rounds. | Implementation deviation against `AGENTS.md`, which requires agent docs to be updated in the same change when code moves or architecture boundaries change. No detector existed, and the receipt itself had drifted the same way. | Comparing each guide's claims against the code during a deliberate staleness audit, prompted by finding the same drift in the receipt's capability table in the previous round. | Corrected all three against the code, verified every symbol named in the new text exists, and replaced the stale instructions rather than appending exceptions. The class is now recorded so the next pass checks guides against the code rather than against their own history. |
| A round-5 bulk deletion of dead CSS selectors removed a selector line **together with the body of the shared rule it belonged to**, leaving three rules merged into their successors in `lidar-layers-section.module.css`. The `:focus-visible` outline rule stopped applying, so **keyboard focus indicators silently stopped rendering on nine interactive controls**. That round was reported as complete. | Implementation deviation, plus a genuine test-oracle gap: the CSS is valid, the build is clean, `tsc` is clean, and `css-module-policies` passed because it checks token *values*, not rule *structure*. Found only by looking at real rendered output. | Rendered the flat list in the isolated Desktop session and saw names fragmenting; reading the CSS then exposed the merged rules. | Restored all three rules (dropping only the `.disclosure` variants whose element no longer exists) and added a structural guard to `css-module-policies`: a blank line inside a rule's prelude means two rules were merged. Verified against the shipped-broken revision — it reports all three and none in the fixed tree, so this is a recorded fail-before/pass-after. |
| In the same flat list, layer names used `overflow-wrap: anywhere` and fragmented into stacked syllables ("Gro/und/sur/vey") instead of truncating, and the identity button kept its own 24 px icon column while the flat list rendered the icon again as a separate badge, squeezing the name twice. | Implementation deviation (self-review), visible only at real dock width. | The isolated Desktop run. | Names now truncate with an ellipsis and the identity button is a flex row rather than a two-column grid. |
| The handoff's `completion-design.md` predicted a possible fast-forward for `main`; the actual ancestry made it impossible (the bounded stack re-parented `af8aed87` under `34bf6041`) | Design omission — but the contract said "prefer fast-forward where possible, otherwise a deliberate merge", so the prescribed fallback was sufficient | Git ancestry check before merging | Used the prescribed deliberate merge; recorded the real topology here |
| `npm run check:types` failed on the default Cargo home with `Read-only file system` | Environment limitation, already recorded in the prior debrief | Command failure | Re-ran with the inspected isolated `CARGO_HOME`; no cache or pin workaround needed |
| My first capacity-plane `HOLES` tuples were written `(x0, x1, y0, y1)` while the consumer read `(y0, y1, x0, x1)`, so three of four holes silently did not exist | Implementation deviation (self-review) | The independent value/hole probe run before any measurement used the fixture | Reordered the tuples and asserted each hole interior plus an adjacent outside pixel |
| My first plane value probe used a 1e-2 tolerance against values of ~3.47e6 m, whose Float32 spacing is 0.25 m, so correct data reported MISMATCH | Test-oracle gap (self-review) | The probe itself | Replaced with a bound derived from Float32 spacing (1.0 m, still far below the 0.5 m pixel size) |
| The 24-tile test asserted `sources.len() > MAX_SOURCE_FILES_PER_IMPORT`, which the raised 24-file ceiling made false | Expected consequence of the authorized policy change | The test run | Changed to `assert_eq!(sources.len(), MAX_SOURCE_FILES_PER_IMPORT)` and removed the admission override so the test now witnesses the real policy |
| The first `overrides_are_thread_local…` assertion used a 64M-cell override that was below the 400M production budget | Implementation deviation (self-review) | The test run | Raised the override above production, with a comment stating why |
| A background `nohup`'d gate script died with its parent shell, so the first two gate runs produced empty logs while the files looked current | Tool/orchestration limitation | Empty log files with no `cargo`/`npm` processes | Re-ran the gates as managed background jobs and monitored the logs |

Improvements applied and used: the isolated `CARGO_HOME` was reused on its next
real use and avoided a dependency-cache workaround; the pre-use fixture probe
caught the hole-tuple defect before any measurement depended on it.

Untested proposals (no evidence of benefit yet, not installed): none recorded.

## Final disposition and delivery

- Integrated accepted stack: `main` = `f61f8494`, which contains the independently
  accepted foundation `34e4ded4`.
- Candidate: `feature/raster-rework-completion`, pushed and verified present at
  that exact revision on **both** configured destinations (`origin` pushes to
  `git@github.com:naejin/canopi.git` and `git@codeberg.org:naejin/canopi.git`).
  Earlier sections name the revision each one measured; the [capability
  table](#capability-and-acceptance-evidence) carries the current state.
- Actual production admission: 24 files / 2 GiB per file / 2 GiB total /
  400,000,000 processing cells, exercised by the sparse 24-source lane, the 12-tile
  48M MNH lane **and** the 400M-cell single-file plane, all through the production
  callers with no override. The measured envelope and its gaps are consolidated
  under [C1 measured envelope](#c1-measured-envelope).
- Remaining external prerequisites: a **Windows or macOS host** for the platform
  builds and a packaged-window smoke, and a **real restricted Google Maps key**
  for live official-provider qualification. Neither is blocking the deliverables
  that can be produced here, and neither was fabricated.
- Agent docs updated in this candidate: `docs/agent/lidar.md` (admission policy and
  the retired bound), `docs/agent/maplibre.md` (the provider-binding rule),
  `docs/agent/frontend-workbenches.md` (the Data/Analysis/Location surfaces and the
  library-versus-presentation distinction), `docs/agent/edition-development.md` (the
  window-manager requirement and the DOM feedback loop), and ADRs 0013/0016 status
  links plus the new ADR 0028.
- bd: `canopi-j571.1` carries the per-round checkpoints. Reconciled and closed during
  this rework: `canopi-jv8a.2`, `canopi-jv8a.4`, `canopi-j571.2`, `canopi-kko3`.
  Still open and correctly so: `canopi-jv8a` (foundation parent), `canopi-kqpp`
  (engine qualification); `canopi-5neg` is deferred. The epic description records the
  overlap-replacement checkbox, compulsory merged-source publication and Q as a
  prerequisite as **retired rather than passed**.

**What would move this from partial to complete**, in order of value: drive the
Desktop import chain past the native chooser; read inspection values off a live
session against an independent oracle; run the two platform builds and one packaged
smoke; observe a live provider session. Each is a specific missing observation, not
missing capability.

The main agent's independent review still owns acceptance of this candidate.
Nothing here is integrated beyond the C0 foundation, and no public release is
claimed.
