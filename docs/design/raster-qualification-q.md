# Raster qualification receipt (slice Q)

Status: evidence — **Q is not qualified.** Experiment subtest results are recorded below, but
eligibility is decided by the [requirement contract](../../scripts/raster-qualification/requirements.json)
and the latest implementer-reported gate verdict is `fail` (one fail, eleven inconclusive).
Independent review found further gate defects; that distribution is not independently accepted.
The [reviewer-owned decision-path design](raster-rework/q-typescript-reassessment.md) is ready for the [user-forwarded implementation handoff](raster-rework/q-typescript-implementation-agent-prompt.md). The old reassessment and repair prompts are retired. No experiment, producer/Python migration or production N1 is authorized.
Commands below describe the legacy harness, not authorization for new experiments. Ten passing subcommand names are not a qualification.
Tracking: `canopi-kqpp` (parent epic `canopi-j571`); related follow-up `canopi-a9uy`.
Spec: [raster rework](raster-data-analysis-rework.md).
Current guidance: [LiDAR](../agent/lidar.md), [edition development](../agent/edition-development.md),
[GeoLibre reuse inventory](raster-rework/geolibre-reuse-inventory.md),
[TypeScript decision-path receipt](raster-rework/q-typescript-receipt.md),
[consolidated repair receipt](raster-rework/q-consolidated-repair-receipt.md),
[acceptance contract](raster-rework/q-admission-acceptance.md).

The qualification decision path is now TypeScript under `scripts/raster-qualification/ts/`. It
recomputes admission and verdicts from raw report and declaration bytes and reproduces the recorded
verdicts below for the existing evidence, according to the implementation receipt. Independent
review at `6a98cd33`, after both repair rounds, still reproduced lost display/artifact failures,
a display false pass and source overwrite on rejected input. The receipt reports unchanged private-record
verdicts across all three evaluation rounds; that reconciliation was not independently rerun.
The Python evaluator is frozen for comparison and is no
longer the authority; its historical reconciliation is retained in the
[consolidated repair receipt](raster-rework/q-consolidated-repair-receipt.md).

## Eligibility summary (read this first)

| | |
| --- | --- |
| Gate verdict against the recorded evidence | **fail** — 1 fail, 11 inconclusive; 12 of 12 requirements not passing |
| Requirements passing | none |
| Requirements not passing | `Q-DISPLAY-1` is **fail**; `Q-ART-1`, `Q-LOCAL-1`, `Q-PREP-1`, `Q-MEMBER-1`, `Q-VALUE-1`, `Q-CRS-1`, `Q-CANCEL-1`, `Q-TEARDOWN-1`, `Q-FAILINJ-1`, `Q-HOST-1`, `Q-RES-1` are inconclusive |
| Reproduce | `measure.py gate-assemble --reports <dir> --host chromium --out bundle.json` then `measure.py gate --bundle bundle.json --out decision.json` |
| Why not passing | The recorded reports carry no identity/provenance block, so their route, environment, transport, artifact and fixture identity cannot be verified, and they record no run identity or time: incomplete evidence, not a measured violation. `Q-DISPLAY-1` additionally records a measured violation — the trace holds one cold and one warm run where the plan requires one cold and three warm |
| Admission requirements | Declarations are validated before anything is indexed from them, so a missing manifest or hash is a gap while a malformed, duplicated or conflicting one is an evaluator-input failure; fixture coverage is judged against that declared per-role manifest; each measured artifact must correspond to its declared source pin; a source run needs a nonempty runId and a fresh, finite recordedAt under one injected clock; a known conflict or recorded failure stays a failure even when an unrelated field or the summary `result` is missing. See the [declaration/precedence receipt](raster-rework/q-declaration-precedence-receipt.md) |
| Superseded | An earlier revision of this receipt reported four requirements as passing. That reading came from admitting reports without any provenance requirement and is **withdrawn**; see the [evidence-integrity receipt](raster-rework/q-evidence-integrity-receipt.md) |

The sections below are **measured subtests** of the individually recorded runs. They show what the probes observed and are worth
keeping. They do not establish Q eligibility, and no accumulation of green subtests can: the
requirements that are not passing are ones no current probe observes. Each is listed with its
unresolved requirement id under [Limitations](#limitations-and-their-effect-on-q-eligibility).

This revision replaces `fd86de68`'s receipt. The previous receipt reported passes that did not
establish the required behaviour; the review findings are reproduced and fixed below, and every
verdict in this receipt now comes from a harness that cannot pass without measuring something. This
receipt still selects no production engine and authorizes no downstream slice. **N1 remains blocked
pending independent review.**

## What changed, and why the previous receipt was wrong

The previous harness could report `pass` for work it never performed. Eight specific defects were
reproduced and fixed, and each now has a regression test in
`scripts/raster-qualification/tests/test_qualification_verdicts.py`.

| Review finding | Reproduction before the fix | Fix |
| --- | --- | --- |
| A failed decoder could still pass | `cmd_q2_numeric` returned exit 0 with `result: pass` when `streamError` was set and no window was tested | A required-role failure is a recorded failure; the report is always written |
| Zero tested windows could pass | exit 0 with `result: pass` and an empty window list | `windows-tested` requires at least one validated window |
| Missing fixtures/scenarios could pass | a report lacking the scenario returned exit 0 | the missing scenario is a named failure |
| Window errors could be skipped into a pass | an undeclared window error was ignored | undeclared errors fail; declared negative controls are asserted |
| Every exception treated alike | any thrown error aborted the process before a report was written | errors become recorded failures; report writing is unconditional |
| Fixture hashes were not a precondition | a mismatch was only noticed if a window was validated | hash verification runs before any comparison |
| `compare` summarised whatever it was given | exit 0 / `pass` for a single inconclusive report | the complete required experiment set is mandatory; malformed, missing and inconclusive inputs fail |
| Browser failures did not affect the verdict | a probe with a page error could still be measured | unavailable engines, runner failures and missing transport ledgers fail the report |

The regression suite was written first and observed failing: **12 of 14 cases failed** against
`fd86de68`'s harness (4 assertion failures, 8 errors from the process exiting before writing a
report). It now reports `Ran 14 tests ... OK`. Reproduce:

```sh
python3 -m unittest discover -s scripts/raster-qualification/tests
```

Verdicts are computed by `qual_lib.Report`: a report may only reach `pass` with at least one
assertion and zero failing assertions. No assertions ⇒ `inconclusive`. Any failure ⇒ `fail`.
`compare` requires all ten experiments and accepts only `pass` from each.

## Corrections to previously reported conclusions

| Previous claim | Corrected finding |
| --- | --- |
| "Numeric windows qualify over the local bridge" | The old probe **fetched the whole fixture and then sliced a resident buffer**, which cannot distinguish bounded from unbounded access. Numeric access is now measured over real HTTP `Range` reads with the server keeping its own byte ledger, and it qualifies **only for tiled COGs**. |
| "The 400-million-cell file reads at 18.3 MiB" | That figure came from the **Python reference reader**, not the candidate route. Reference and candidate measurements are now reported separately and labelled. |
| "CRS control points agree within 0.1 m" | The old check **round-tripped GDAL against itself**; the candidate did not affect the verdict. The candidate's own projection engine is now compared against an independently configured reference: agreement is **1.86e-9 m**, and requested pixels are addressed to **9.4e-10 m**. The 32.57 m discrepancy in the previous run was an artefact of comparing the candidate's pixel-centre coordinates against reference corner coordinates. |
| "Cancellation settles in 0.1 ms" | The old probe **aborted before its loop started**. Cancellation is now measured against work genuinely in flight: 900 of 4000 operations completed, **3099 were never scheduled**, and the tree settled in 0.005 s. |
| "Large-plane seam checks" | The old check read 8×8 windows and printed samples without computing slope. Blocked slope is now computed and compared against whole-window slope: **difference 0.0°, validity mismatches 0**. |
| "Slope must move to WASM — decision required" | **Withdrawn.** The plan already allows native GDAL to retain preparation and slope. This was never an open requirement and is not presented as a decision. |
| "Prepared derivatives are a contract narrowing needing a decision" | **Withdrawn.** Prepared derivatives and lazy prepared-cache conversion are already in the plan. The real finding is narrower: the candidate cannot range-read a *stripped* file, so a bounded legacy reader for stripped generations is required, which is an implementation task (see Limitations). |
| "The candidate stream decoder rejects stripped GeoTIFFs" was presented as a production constraint | It is a **capability limitation of one role**, recorded in the LiDAR guide as part of the Q finding rather than as an operating rule. |

Two further defects were found in the harness itself and fixed:

* **BigTIFF inline-value width.** `qual_lib` read the value field of a BigTIFF tag as 4 bytes
  instead of 8, so `GDAL_NODATA` in the 1.6 GB fixture was silently read as an offset into unrelated
  bytes. The hole rectangles were consequently reported as valid data.
* **Window-relative versus block-relative offsets.** The blocked-slope comparison read a window at a
  different origin from the blocked pass, so it compared different pixels and reported a 65.9° seam
  error that did not exist.

## GeoLibre inspection

The reuse inventory is [separate](raster-rework/geolibre-reuse-inventory.md) and covers the pinned
revision `c5a72b027002a673ce48115ee19358205acd9791`, traced through
`cog-convert.ts` → `raster-client.ts` → `wasm-tool-runner.ts` → `wasm-tool.worker.ts` →
`cog-imagery.ts` → `cesium-cog-imagery.ts`, with the dependency lock, export conditions, bundler
configuration and upstream tests. No candidate pin was changed and no GeoLibre package is imported.

The inspection changed Q in three concrete ways:

* It **independently corroborates** the central finding: `cog-convert.ts` exists precisely because a
  striped GeoTIFF cannot be rendered without preparation, and `raster-client.ts` documents its
  whole-raster browser path as a convenience fallback bounded at 512 MiB.
* It supplies the **authoritative reason** mid-decode cancellation is impossible
  (`cesium-cog-imagery.ts`: "The WASM render cannot be interrupted once started"), which is why
  cancellation is cooperative and results are fenced rather than interrupted.
* It yields four reusable patterns: retryable module init, cached sources with eviction on failed
  open, ack-based dead-worker detection, and pre/post-check fencing around an uninterruptible render.
  Rejected: idle-only worker pooling with no run timeout, structured-cloning input buffers,
  whole-raster browser decode, and the React/Zustand shell, catalogue, globe and `geolibre-wasm`.

## Environment

| Item | Value |
| --- | --- |
| Repository revision at start | `fd86de68` on `feature/raster-html-references` (Q work), atop approved prototype `0e696722` and approval record `ab2f7d25` |
| Bead | `canopi-kqpp`, claimed before edits |
| Host | Linux 7.0.0-31-generic x86_64, 8 CPUs, 32,007 MiB RAM, Python 3.12.3, Node v22.22.0, GDAL 3.8.4 |
| Engine | Chromium 150.0.7871.46 (system Chrome) |
| Production changes | **none** — the only non-harness change is explicit fixture selection in an ignored Rust test (see `canopi-a9uy`) |

## Experiment results

| # | Experiment | Verdict | Assertions | Required behaviour established |
| --- | --- | --- | --- | --- |
| 1 | `q1-artifacts` | **pass** | 50 | Pinned artifacts installed, integrity-verified, licensed, with source correspondence recorded |
| 2a | `q2-local-bridge` | **pass** (negative result) | 4 | Whether a stripped local GeoTIFF is boundedly readable — it is not, and that is asserted |
| 2b | `q2-numeric` | **pass** | 38 | Bounded ranged numeric windows on tiled COGs match an independent reference exactly |
| 3a | `q3-prepare` | **pass** | 28 | Native preparation is cell-exact, originals unchanged, derivative boundedly addressable |
| 3b | `q3-members` | **pass** | 19 | Multi-member resolution, precedence, gaps and NoData semantics |
| 3c | `q3-display` | **pass** | 25 | Display tiles, reprojection, disk-backed local transport, stride sampling |
| 4a | `q4-slope` | **pass** | 15 | Blocked Horn slope with halo, both units, seams, holes, outer edges |
| 4b | `q4-crs` | **pass** | 6 | CRS resolver identified; candidate projection and addressing verified |
| 5 | `q5-lifecycle` | **pass** | 13 | Active cancellation, settlement, malformed input, idempotent adapter teardown |
| 6 | `q6-resources` | **pass** | 10 | Candidate route and reference reader measured separately against the plan's budgets |
| — | `compare` | **pass** | 11 | The complete required set, each member conclusive — this validates the *experiment set*, not Q eligibility |

Run everything with:

```sh
bash scripts/raster-qualification/run_all_experiments.sh [scratch-root]
```

The runner clears stale reports, continues past a failing experiment, and prints every verdict. Each
`measure.py` subcommand exits non-zero for anything that is not a pass.

## Experiment detail

### Q1 — artifacts

Sixteen artifacts verified against recorded versions and registry integrity digests
(`scripts/raster-qualification/candidates.json`, reproduced by `bootstrap_bench.py`). All licenses
permissive. The source-to-artifact correspondence remains as reported and is unchanged by this
revision:

* `cog-tiler-wasm@0.3.6` carries the pinned `gitHead` `a71c321…`. The version named in the plan,
  `0.3.1`, is a **different commit** (`770519f4…`) and declares `peer whitebox-wasm@^0.4.1`, so it
  cannot be installed alongside `whitebox-wasm@0.5.1`.
* **No published `whitebox-wasm` artifact matches pinned commit `9c0ff4f`.** The pinned manifest
  declares `0.6.0`, which is unpublished; the newest published artifact is `0.5.1`
  (`gitHead 6920ade…`), a different revision.
* `geotiff-geokeys-to-proj4` must stay at `2024.4.13`; `2026.8.16` dropped the default export
  cog-tiler calls.

**Reproducible build of the pinned source was not attempted.** The plan permits it, and it remains
the correct route if the pinned revision's behaviour is ever required — but nothing in Q depends on
it, because `CogStream.from_windows` (the capability `0.5.1` lacks) addresses only the *location* of
a plain GeoTIFF's directory and does not remove the tiled-layout requirement that governs the
stripped case. This is recorded as an open option rather than a silent substitution.

### Q2a — stripped local bridge: the honest negative result

| Assertion | Observed |
| --- | --- |
| Fixture is stripped | `tiled=false`, `compression=None`, single 16,000,000-byte strip |
| Fixture hash matches the recorded identity | `c4e2938e…` |
| Bounded range read rejected | `CogStream` throws `image is striped, not tiled; tile range streaming requires a tiled COG` |
| Metadata still readable from a prefix | yes |

The experiment **passes because it correctly establishes the capability boundary**: no available
candidate role range-reads a stripped local GeoTIFF. This is a limitation of one role, not evidence
that the planned architecture fails — prepared derivatives and lazy prepared-cache conversion are
already in the plan, and `q3-prepare` qualifies that route.

### Q2b — ranged numeric windows

Nine windows across three tiled COGs, read over real HTTP `Range` requests with a header prefix
fetched once and each tile fetched separately. Values were compared cell-by-cell against the exact
analytic plane cast to Float32, with validity compared exactly.

| Fixture | Bytes | Prefix | Tile requests | Tile bytes | Largest single request | Windows |
| --- | --- | --- | --- | --- | --- | --- |
| `plane256` | 5,812 | 5,812 | 18 | 66,060 | 5,812 | 2 |
| `plane2000` | 235,457 | 65,536 | 25 | 88,668 | 65,536 | 6 |
| `steep45` | 1,475 | 1,475 | 17 | 18,207 | 1,475 | 1 |

* **Max absolute error vs the analytic plane: 0.0** for every window; **0 validity mismatches**.
* A 16-point stride sweep across `plane2000` issued exactly **16 tile requests**, demonstrating that
  cost tracks the sample points rather than the raster.
* The transport's own ledger recorded **63 ranged** and 169 full requests, and the fixture byte
  totals it served match the client's counters exactly — the accounting is the server's, not the
  client's.
* Negative controls: an all-NoData window is declared with `expectNoCoverage` and asserted to return
  no finite sample. Windows crossing a tile edge (4 tiles) and a NoData hole are included, as are
  valid zero and negative values.

For small fixtures the header prefix legitimately exceeds the file size, so boundedness is asserted
as *"no single request returns the whole artifact"* plus per-tile requests, not as a bytes-read
ratio.

### Q3a — preparation

`gdal_translate -q -of COG -co COMPRESS=DEFLATE -co BLOCKSIZE=256 -co OVERVIEWS=IGNORE_EXISTING -co
RESAMPLING=NEAREST`, in 0.247 s.

| Assertion | Observed |
| --- | --- |
| Original unchanged, and matches its recorded hash | `c4e2938e…` before and after |
| Sidecar identity | recorded when present |
| Cell-exact derivative | **max absolute difference 0.0** |
| Original stripped → derivative tiled | `tiled=false` → `tiled=true`, 256×256 tiles |
| Block size bounded | 256 ≤ 1024 |
| Geotransform preserved | `[444999.75, 0.5, 0.0, 6806000.25, 0.0, −0.5]` |
| NoData preserved | `−9999` |
| Sample format preserved | Float32 |
| Size | 16,000,513 → 2,053,193 bytes (12.8 %) |
| Overviews addressable | 4 levels |
| Window reads match the original | **0 value mismatches, 0 validity mismatches** |

The derivative reports `epsg=None`, because the original WKT carries no authority code and a
faithful derivative cannot invent one. GDAL is the CRS resolver for the route; rewriting the
original metadata is forbidden by the plan and was not done.

### Q3b — generation resolution

24 members occupying 24 of 30 lattice slots, leaving a real gap.

| Assertion | Observed |
| --- | --- |
| Members present | 24 |
| Coverage gap exists | 6 unoccupied slots |
| Window across member columns (2600²) | 4 members replayed, 6,760,000/6,760,000 covered, error 0.0 |
| Window across member rows (2600²) | 4 members replayed, 6,760,000/6,760,000 covered, error 0.0 |
| Single-member window | 1 member, 16,384/16,384, error 0.0 |
| Unoccupied slots | **0 cells covered** for each of 6 slots |
| Replacement precedence | later member wins in the overlap (9.0 where both cover) |
| NoData does not erase | earlier valid 5.0 survives under the later member's NoData |

The resolver exercised is a **reference implementation** of the plan's ordered-member replay
semantics, over GDAL windowed reads. It establishes the semantics and expected geometry; the
production resolver is N1 work. Reuse of reduced-resolution overviews is **not** exercised here, so
the requirement that low-resolution overviews must not resurrect overwritten pixels remains
**unverified in Q** and is carried as an N1 obligation.

### Q3c — display and local transport

| Assertion | Observed |
| --- | --- |
| Decoder | `wasm` for every fixture (`readsViaGeoTiff=false`) |
| Reprojection | `warped from +proj=lcc`, mode `warp`, plausible WGS84 bounds |
| Tiles rendered | 128 PNG tiles, 0 failures |
| Independent derivative encoded | `CogBuilder` produced a tiled COG in 73 ms |
| Local transport is a real `File` | `isFile=true` |
| Local transport bounded | 95,151 of 2,053,193 bytes (4.63 %) in 6 ranged reads |
| Stride sampling over the local file | 16 points, values returned |

### Q4a — blocked slope

Horn 3×3, dividing by pixel size in metres, one-cell halo, core written only, no edge interpolation.

| Assertion | Observed | Tolerance |
| --- | --- | --- |
| `plane2000` degrees | max error 3.26e-4 ° | 0.001 ° |
| `plane2000` percent | max error 6.82e-4 pp | 0.01 pp |
| `steep45` degrees | max error 8.50e-5 ° | 0.001 ° |
| `steep45` percent | max error 2.97e-4 pp | 0.01 pp |
| `curved256` vs `gdaldem` (independent Horn) | 3.778e-4 ° over 64,516 cells | 0.001 ° |
| GDAL validity agrees with independent Horn | 0 mismatches | exact |
| Blocked vs whole-window slope at a block seam | **difference 0.0 °**, 0 validity mismatches | 0.01 ° accumulated |
| Blocked slope vs analytic at the seam | 0.0013 ° | 0.01 ° accumulated |
| Blocked reads stay bounded | 4 blocks, max read 266,256 bytes / 66,564 cells | — |
| Declared NoData rectangles | centre cells invalid, no interpolated slope | exact |
| Outer edge | first row carries no slope | exact |

The blocked-versus-whole comparison operates on the **same window-relative positions**, which is the
correction to the previously reported 65.9° artefact. The 0.0013° residual is Float32 accumulation
differences between block-relative and window-relative offsets, recorded against a stated
accumulation tolerance rather than hidden behind the scientific tolerance.

### Q4b — CRS

| Assertion | Observed |
| --- | --- |
| Reference EPSG configured explicitly | 2154, not read from the fixture WKT |
| Reference control points round-trip | max 1.9e-9 m, tolerance 0.1 m |
| Candidate projection vs independent reference | **max delta 1.86e-9 m over 8 points** |
| Candidate-returned coordinate addresses the requested pixel | **max error 9.4e-10 m** |

**CRS resolver identified:** GDAL, during native preparation. It interprets the incomplete WKT and
its geotransform defines the lattice used by preparation, numeric reads and display. The candidate
decoder reports no EPSG for these fixtures and is not a CRS authority. No WKT was rewritten and no
CRS was inferred from filenames.

### Q5 — cancellation and lifecycle

| Assertion | Observed |
| --- | --- |
| Active cancellation: work in flight when cancel fired | 900 of 4000 operations |
| Cancellation stops scheduling | **3099 operations never scheduled** |
| Control: same loop without cancellation | 400/400 completed |
| Settlement | 0.005 s (bound 5 s) |
| Stalled worker terminated | 0.102 s (bound 5 s); exit 1 |
| Dead worker (exits without `error`) | detected via exit event; `error` never fired |
| Truncated header rejected | `decode: I/O error: failed to fill whole buffer` |
| Corrupt tile rejected | `Compression error (Deflate): corrupt deflate stream` |
| Out-of-image window rejected | `window origin outside image` |
| **Adapter teardown is idempotent** | three `dispose()` calls safe; read after dispose throws |
| Third-party `free()` is **not** idempotent | throws `null pointer passed to rust` — recorded as a candidate defect |

The plan's requirement is that "partial initialization can be disposed twice safely". The
third-party `free()` does not satisfy that, so **the owning adapter must**, and the probe proves an
adapter that guards teardown satisfies it. This is the obligation slice D inherits.

**Not run, and named as such:** disk-write failure and publication rollback. This harness has no
publication boundary, so claiming rollback from it would be false. That gate belongs to N2/F.

### Q6 — resources

**Candidate route** (wasm ranged transport, Chromium, measured as a process tree):

| Fixture | Total transported | Largest single request | Tile requests |
| --- | --- | --- | --- |
| `plane256` | 71,872 | 5,812 | 18 |
| `plane2000` | 154,204 | 65,536 | 25 |
| `steep45` | 19,682 | 1,475 | 17 |

**Reference reader** (native byte-range, explicitly *not* the candidate route), on the
400,000,000-cell / 1,600,240,520-byte plane:

| Measurement | Value | Budget |
| --- | --- | --- |
| Window size | 1024×1024 cells | ≤ 1024×1024 |
| Max single read | 4,194,304 bytes | — |
| Incremental peak RSS | **18.32 MiB** | ≤ 1024 MiB |
| OS high-water (self / children) | 58.7 / 58.6 MB | — |
| Max concurrent children | 1 | — |
| Read latency median / p95 / max | 28.6 / 42.3 / 47.8 ms | — |
| Sampling | 100 ms interval | required 100 ms |

**Display trace** (fixed 128-request viewport sweep, individual tile latencies):

| Run | Requests | Rendered | Failed | Median | p95 | Max | Long-task observer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 128 | 128 | 0 | 0.40 ms | 16.70 ms | 31.3 ms | supported |
| warm | 128 | 128 | 0 | 0.30 ms | 14.40 ms | 26.4 ms | supported |

Cold and warm are recorded with their cache states stated separately. The long-task observer is
reported as supported and observed no task above the 50 ms bound; the mechanism is reported so the
absence of a long task is a measurement rather than an assumption.

**Not measured, and named as such:** the candidate route's own peak host memory under a large
fixture (ranged transport was exercised on small and moderate fixtures; the 1.6 GB plane was read
through the native reference), WASM heap attribution, display cache budgets (no app-managed cache
exists yet), queue depth, and temporary-disk high-water. These are slice D obligations and are not
claimed here.

## Role-to-artifact table

| Role | Artifact | Exact API | Qualified scope | Verdict |
| --- | --- | --- | --- | --- |
| Preparation | GDAL 3.8.4 | `gdal_translate -of COG -co COMPRESS=DEFLATE -co BLOCKSIZE=256` | Stripped → tiled COG, cell-exact, original unchanged | **qualified** |
| CRS resolution | GDAL 3.8.4 | `ImportFromWkt` + geotransform, control points from an explicit EPSG | Interprets the incomplete WKT without rewriting it | **qualified** |
| Numeric window decode | `whitebox-wasm@0.5.1` | `new CogStream(header)`; `tiles_for_window(level,x,y,w,h)`; `tile_range`; `decode_tile_f64(level,bytes)`; `levels_json()`; `geo_transform()`; `.epsg`; `.nodata`; `.free()` | Tiled COGs, bounded by HTTP `Range`; exact values and validity | **qualified** |
| Numeric read, native reference | `qual_lib` byte-range reader | `read_tiff_layout`, `read_window_bounded` | Uncompressed stripped layouts; independent oracle | **reference only** |
| Slope | GDAL 3.8.4 `gdaldem` + independent Horn | `gdaldem slope IN OUT -b 1 [-p]` | Both units, blocked with halo, seams/holes/edges, 0 validity disagreement | **qualified** |
| Display / reprojection | `cog-tiler-wasm@0.3.6` | `openCog(source)`; `renderTilePNG(z,x,y,opts)`; `point(lon,lat)`; `.levels`; `.boundsLonLat`; `.crsLabel`; `.mode`; `registerCogProtocol` | Local `File` and ranged reads; wasm decoder; LCC warp | **qualified** |
| Local transport | Browser `File` from a host file input | `Blob.prototype.slice` ranged access | 4.63 % of the derivative in 6 reads | **qualified** |
| Metadata | `whitebox-wasm@0.5.1` | `geotiff_info(prefix)`; `GeoTiffReader.info_json()` | Any layout from a prefix; no EPSG on the incomplete WKT | **qualified** |
| Cancellation / teardown | Owning adapter | `dispose()` idempotent; cooperative cancellation at tile boundaries | Hard termination and repeated teardown pass | **qualified** |
| Inspection pixel lookup | — | — | Not exercised; the contract wants a native one-pixel lookup | **not run (slice I)** |
| WASM slope | `whitebox-cli.wasm` under wasmtime | `whitebox slope --input --output --units` | Rejected: edge-interpolated, all cells valid | **rejected** |

## Supported and tested input matrix

| Input | Status |
| --- | --- |
| Float32, single band, north-up, EPSG:2154, tiled COG, Deflate | **tested** — prep, windows, display, slope |
| Float32, single band, EPSG:2154, stripped, uncompressed | **tested** — metadata and preparation; bounded numeric only after preparation |
| Float32, 400M cells, uncompressed, one-row strips, BigTIFF | **tested** — bounded native reads, resource measurement |
| Float32, 2000², Deflate COG, 24-member collection with gap | **tested** — generation resolution |
| Float32 with declared NoData, holes crossing block boundaries | **tested** — validity, holes, seams |
| Valid zero and negative samples | **tested** — retained as data |
| Float64, Int32, Int16, UInt8 | declared by `levels_json()`; **not tested** |
| LERC, ZSTD, LZW, PackBits | routed to geotiff.js by `compressionDecoder`; **not tested** |
| Multi-band / RGB / RGBA | **untested**; RGB orthophotos are out of scope |
| Rotated or south-up geotransforms | **untested**; the plan restricts initial support to north-up without rotation |
| Non-EPSG:2154 CRS | **untested** |
| Explicit alpha or dataset masks, non-identity scale/offset | **untested**; the plan rejects these before head publication |

## Worker, cache and transport lifecycle

| Concern | Status |
| --- | --- |
| Display decoding runs off the UI thread | **Not established.** The candidate renders on the page's main thread; no long task above 50 ms was observed, but worker hosting is a slice D obligation. |
| Dead-worker detection | Pattern verified in an isolated probe (ack + exit-event tracking); **not wired into production**, which has no worker owner yet. |
| Source caching / eviction on failed open | Reuse pattern identified and recorded; **not implemented** — slice D. |
| Cancellation | Cooperative at tile boundaries. Mid-decode interruption is impossible (`cesium-cog-imagery.ts` documents this); results must be fenced, which the probe exercises. |
| Adapter teardown | Idempotent teardown **proven** for an owning adapter; the third-party `free()` is not idempotent. |
| Decoded and disk cache budgets | **Not exercised**; no app-managed cache exists. |
| Bundled offline assets in the Desktop WebView | **Not exercised.** Chromium HTTP transport is not Desktop WebView qualification. |

## Engine-specific derivative format

Measured on the qualified derivative: tiled GeoTIFF/COG, `BLOCKSIZE=256`, `COMPRESS=DEFLATE`,
internal overviews (`IGNORE_EXISTING` at preparation), NoData carried from the original, geotransform
preserved exactly, BigTIFF only when the source requires it. Window addressing is by
`(level, x, y, w, h)` over the north-up lattice; the returned sample is Float64 after decode, with
declared NoData mapped to invalid. The plan's `member-window-v1` catalog representation, sparse
occupied-block index and manifest schema remain **N1 work** and are not fixed by this receipt.

## Limitations and their effect on Q eligibility

These are **gate requirement gaps**, not waivers. Each names the requirement id it blocks, and none
may be reassigned to a later slice without an explicit recorded decision. Items marked *(release
gate)* are later-slice obligations the plan already assigns and do not block Q.

| # | Item | Blocked requirement | Kind |
| --- | --- | --- | --- |
| 1 | Bounded numeric access requires a prepared tiled derivative; a stripped generation is not range-readable | N1 obligation, not a Q gap | implementation |
| 2 | Overview reuse never resurrects replaced pixels is unexercised | `Q-MEMBER-1` | Q gap |
| 3 | No published `whitebox-wasm` matches the pinned commit | `Q-ART-1` (recorded, passing) | recorded finding |
| 4 | Whole-400M-cell blocked slope was not run | `F-PLATFORM-1` area *(release gate)* | later slice |
| 5 | 48-million-cell real batch was not imported | `F-E2E-1` *(release gate)* | later slice |
| 6 | Candidate-route memory, cache, queue depth and temporary disk are unmeasured | `Q-RES-1` | Q gap |
| 7 | No Desktop WebView host evidence | `Q-HOST-1` | Q gap |
| 8 | Disk-write failure and publication rollback are not exercised | `Q-FAILINJ-1` | Q gap |
| 9 | Cancellation is not observed with work in flight on the proposed route | `Q-CANCEL-1` | Q gap |
| 10 | Teardown release is asserted from a flag, not observed | `Q-TEARDOWN-1` | Q gap |
| 11 | Valid zero/negative retention has no assertion in the recorded evidence | `Q-VALUE-1` | Q gap |
| 12 | Display trace lacks one cold and three warm runs | `Q-DISPLAY-1` | Q gap |
| 13 | WebKit, macOS and Windows were not exercised | `F-PLATFORM-1` *(release gate)* | later slice |

The prose list below retains the measured detail behind these items.

1. **Bounded numeric access requires a prepared tiled derivative.** A stripped generation cannot be
   range-read by any candidate role. The plan already provides for prepared derivatives and lazy
   conversion, so this is an implementation obligation, not a decision: **N1 must supply a bounded
   legacy reader or require preparation before a head becomes numeric-readable.** No capped
   whole-file fallback is proposed, and legacy readability/memory guarantees are not weakened.
2. **All-overview reuse is unverified.** `q3-members` does not exercise reduced-resolution overview
   reuse, so "overviews never resurrect replaced pixels" is an **N1 obligation**.
3. **No published `whitebox-wasm` matches the pinned commit.** A reproducible build of the pin was
   not attempted; it remains the open option if the pinned behaviour is ever needed.
4. **The large-fixture slope gate is partial.** Blocked slope is proven correct and bounded on the
   plane's seams; a whole-400M-cell blocked slope run was not performed.
5. **The 48-million-cell real batch was not imported.** The fixtures are present and hash-verified,
   and multi-member resolution is covered synthetically; a real batch import is N2 work.
6. **Candidate-route memory was not measured under the large fixture**, and display cache budgets,
   queue depth and temporary-disk high-water are unmeasured.
7. **The Desktop WebView, WebKit, macOS and Windows were not exercised.** Chromium-only evidence is
   not Desktop WebView qualification.
8. **Disk-write failure and publication rollback are not claimed**; the harness has no publication
   boundary.
9. **Untested inputs** are listed explicitly in the matrix above rather than implied to work.
10. **`geolibre-wasm`, a GeoLibre fork, and a globe/plugin/catalogue** were not adopted and are not
    needed by this route.

## Decisions required

**None of the previously escalated items remain open.** Native GDAL retains preparation and slope as
the plan already allows, and prepared derivatives are already part of the plan, so neither is a
question for the user. The previous receipt's two "decisions" were withdrawn as mis-framed.

If independent review disagrees with the prepared-derivative route in item 1, the bounded options
are: (a) require preparation before numeric readability and migrate legacy generations lazily
(recommended by the evidence, since preparation is 0.247 s and cell-exact); (b) build a bounded
reader for stripped layouts, which needs an artifact no candidate provides; or (c) restrict legacy
generations to metadata reads. **This agent did not choose among them and N1 must not start until
this is settled.**

## `canopi-a9uy` — explicit fixture selection

The plan permits Q to extend `lidar/e2e.rs` with an explicit fixture path. This was implemented
now, correctly: `fixture_mnt()` returns a `Result` and reads `CANOPI_LIDAR_E2E_FIXTURE` when set,
falling back to the documented `0446_6807` tile. A missing fixture is reported, never substituted,
and **no expected scientific value changed** — the assertions are tile-independent
(`assert_known_slope` builds its own 45° plane; the real-tile assertions are slope range and reuse
semantics). This is parameterisation, not substitution.

```sh
CANOPI_SKIP_BUNDLED_DB=1 CANOPI_LIDAR_E2E_FIXTURE=<path-to-ground-elevation-geotiff> \
  cargo test -p canopi-desktop services::lidar::e2e \
  e2e_import_publish_slope_restart_reuse -- --ignored --exact --nocapture
```

**Not run:** the host has `0445_6806` MNH tiles, not a `0446_6807` **MNT** ground-elevation tile, and
the test requires GDAL plus a real IGN MNT fixture. The command compiles and the selector is
verified by inspection and by `cargo check`; **the test itself was not executed**, and that is
recorded as unavailable evidence rather than inferred as passing.

## Reproducible commands

```sh
SCRATCH=$PWD/.rq-scratch

# Bench (isolated; never a production manifest) and fixtures
python3 scripts/raster-qualification/bootstrap_bench.py --bench "$SCRATCH/bench"
python3 scripts/raster-qualification/generate_fixtures.py --root "$SCRATCH/fx" \
  --manifest "$SCRATCH/out/fixtures.manifest.json"
python3 scripts/raster-qualification/generate_fixtures.py --root "$SCRATCH/fx" --fixture largeplane

# Fail-closed harness regression tests (must be OK before any verdict is trusted)
python3 -m unittest discover -s scripts/raster-qualification/tests

# Every experiment, with per-step verdicts
bash scripts/raster-qualification/run_all_experiments.sh "$SCRATCH"
```

Individual experiments and their assertions are listed in `run_all_experiments.sh`; the verdict
commands are `python3 scripts/raster-qualification/measure.py <experiment>`, and the probe drivers
are `run_wasm_probe.mjs`, `run_display_trace.mjs`, `crs_probe.mjs` and `lifecycle_probe.mjs`.

## Verification performed

| Gate | Result |
| --- | --- |
| `python3 -m unittest discover -s scripts/raster-qualification/tests` | **14 tests OK** |
| `bash scripts/raster-qualification/run_all_experiments.sh` | **10/10 experiments pass; `compare` passes** |
| `python3 scripts/check_docs.py` | run below |
| `git diff --check` | run below |
| Rust gates | required for the `e2e.rs` change: `cargo fmt --check`, Clippy, `cargo check`, `cargo test -p canopi-desktop services::lidar` |

No production dependency was installed, no schema or IPC changed, and the candidate bench plus all
large fixtures and measurement output stay outside Git under the ignored `.rq-scratch/`.

## Handoff

- **Bead:** `canopi-kqpp`, parent epic `canopi-j571`; `canopi-a9uy` addressed for its fixture-selector
  part.
- **Branch and commits:** recorded in the accompanying delivery note.
- **Status:** verified, **not integrated**. Pushing does not integrate.
- **Next action:** independent review of the [implementation delivered at `5878f80e`](raster-rework/q-typescript-receipt.md#implementation-of-the-settled-design-s1s5); the earlier review of this corrected receipt and of limitation 1 remains outstanding. **N1 must not
  start before those reviews conclude.**
