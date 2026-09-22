# Raster rework completion receipt

Status: evidence — C0 integrated and C1's admission policy implemented and partly measured; C1 capacity, C2–C5 pending. Partial delivery, not a verified candidate.
Tracking: `canopi-j571`; completion implementation `canopi-j571.1`. bd owns progress.
Current guidance: [prompt](completion-agent-prompt.md), [contract](completion-design.md), [previous receipt](ordered-cog-receipt.md), [debrief](review-and-debrief.md#whole-rework-delivery-and-improvement).

## Baseline and claim boundary

| Identity | Revision |
| --- | --- |
| Accepted foundation | `34e4ded4` on `feature/bounded-raster-generations` |
| Whole-rework handoff docs | `a96dcfd9` on `feature/raster-html-references` |
| Integrated `main` (C0) | `f61f8494` |
| Candidate `feature/raster-rework-completion` | `4e75bd32` (C1) |

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
| C1 | **Partial** | Policy implemented and enabled; 6 admission unit tests and 3 repurposed ordered-boundary tests pass; the 24-tile sparse batch and the 48M MNH batch are both admitted and imported by the **real production policy** with no override | The 400M single-file plane has not been run through the production callers; cancellation, low-space/write-failure, restart-reuse and cold/three-warm display timings are outstanding; no whole-union-allocation claim is made |
| C2 | Not started | — | Production Data/Analysis/Layers surfaces absent |
| C3 | Not started | — | No `sample(entity, expected generation, WGS84 point)` operation |
| C4 | Not started | — | No shared provider module, no `google_satellite`, no replacement ADR |
| C5 | Not started | — | Final gates, platform builds and diff review not performed |

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
coverage. Peak sampled working set is 96 MiB, far inside the 1 GiB gate.

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

**Incidental observation, not diagnosed.** In `p-258.png` the LiDAR section's
empty message renders as a narrow vertical column of single words inside a
clipped box, rather than as a normal paragraph. The window is healthy elsewhere,
so this may be an under-composited-session artifact rather than a layout defect;
it is recorded as an observation to check in a normal run, not as a finding.

| Case | Classification | Detector | Repair |
| --- | --- | --- | --- |
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

Implementer outcome: **C0 complete; C1 partial; C2–C5 not started.** This is a
partial delivery and is not a verified release candidate.

- Integrated accepted stack: `main` = `f61f8494`.
- New candidate: `feature/raster-rework-completion` = `4e75bd32`, pushed and
  verified present at that exact revision on **both** configured destinations
  (`origin` pushes to `git@github.com:naejin/canopi.git` and
  `git@codeberg.org:naejin/canopi.git`).
- Actual production admission: 24 files / 2 GiB per file / 2 GiB total /
  400,000,000 processing cells, measured only for the sparse 24-source case.
- Remaining external prerequisites: none blocking. The C1 fixtures, GDAL and the
  Xephyr GUI recipe are all available; live Google official-key qualification
  still needs a user-supplied restricted key at C4.
- Agent docs updated: none yet in this candidate. `docs/agent/lidar.md`,
  `CONTEXT.md`, the dock contract and the MapLibre/build guides still need
  updating as C2–C4 land, and the C1 admission change already makes the current
  "existing production limits remain unchanged" wording in `docs/agent/lidar.md`
  stale for the ordered path.
- bd: `canopi-j571.1` carries the C0/C1 checkpoints and the next executable
  action. `canopi-jv8a.4` and `canopi-kko3` still await their C0-reconciliation
  step.

The main agent's independent review still owns acceptance of this candidate;
nothing here is integrated beyond the C0 foundation or released.
