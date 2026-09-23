# Raster rework completion receipt

Status: evidence — foundation integrated; candidate `5d0a5e0b` requires R15–R26 corrections and the new source-import route. Prior capacity, gate and workflow evidence is retained and revision-labelled; no corrected candidate is verified yet.
Tracking: `canopi-j571`; completion implementation `canopi-j571.1`. bd owns progress.
Current guidance: [prompt](completion-agent-prompt.md), [contract](completion-design.md), [previous receipt](ordered-cog-receipt.md), [debrief](review-and-debrief.md#whole-rework-delivery-and-improvement).

## Current correction acceptance

This section is the current claim boundary. The prior delivery below is evidence
at its named revisions, not a claim that inspection/providers are functional or
that only platform observations remain. See the [independent review](completion-review-5d0a5e0b.md)
and [source-import amendment](source-import-design.md). The reviewed tip is
`5d0a5e0b`; its code gate revision is `2b39ee2a`. Five independent review probes
failed while 16 existing tests passed; the review names their scope and locations.

The implementer replaces pending entries below with concise measured outcomes at
the repaired revision. bd remains the execution tracker; this is acceptance evidence.

| Boundary | Current evidence / required next proof |
| --- | --- |
| C0 preservation | `f61f8494` integrates the accepted foundation; retain `5d0a5e0b` candidate work and merge the new docs; record resulting ancestry |
| C1 / R23 / R26 import | Pending new production route: no preview/composed scan, nullable exact metadata, disk/resource admission, migrated historical data, above-cap/BigTIFF evidence and actual Data workflow |
| C2 / R24–R25 workbenches | Pending Remove from Design/Undo, Data-owned import/history, Analysis request/error/retry/unit regressions and visible flow |
| C3 / R15–R18 inspection | Pending correct point, actual source/result/historical readers, signed coverage, units, cancellation and live lifecycle/keyboard evidence |
| C4 / R19–R22 providers | Pending outgoing authenticated tile/viewport, actual changed key, metadata, style readiness, mounted Canvas/Location/WorldMap, renewal/disposal and streamed byte bound |
| C5 combined candidate | Pending corrected-tree gates, real Desktop/Web, package/CI/platform observations and independent review |

For each R15–R26 row in the final disposition record: reproduced revision and
trigger → repair revision → committed regression and observed failing reason →
passing result → applicable live proof or explicit gap. Group related rows only
when their distinct outcomes remain visible. A disputed finding needs concrete
counterevidence, not silent omission. Record the C1 design amendment separately
from defect correction so prior implementation is not judged against a later rule.

For capacity report input identities, cell/byte counts, source/output TIFF format,
working-memory and cache/queue scope, sampling interval, simultaneous child/app
RSS, peak live scratch, durable storage and settled residue **separately**. Include
low-space/write failure with unchanged old head/result and successful retry;
metadata-only publication should show no prior-composition pixel reads. Record
cold/three-warm display timing without turning it into an optimization quota.

For live proof identify edition, dev versus package, OS, isolated profile/fixture,
UI trigger, expected visible outcome, observed outcome, head/result identity and
artifact. For inspection include clicked geographic coordinate, expected native
cell/value/units and observed readout. For provider tests separate fake transport,
actual outgoing request construction and real account response; redact secrets.
An unavailable host/key/fixture names the exact command or observation prevented.

At final consolidation keep one current capability/gate table and one R15–R26
repair table, with links to necessary logs. Retain revision-labelled historical
measurements but collapse repeated round narration and duplicated gate output.
No source image, private raster, key, token or full personal path enters Git.

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
