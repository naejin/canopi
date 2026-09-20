# GeoLibre native integration — delivery receipt

Status: evidence — implementer's revision-linked delivery report for the completed G1–G5 batch; **not** independent acceptance, integration or release.
Tracking: `canopi-jv8a.1`; parent `canopi-jv8a`, epic `canopi-j571`.
Current guidance: [settled design](geolibre-integration-design.md), [LiDAR](../../agent/lidar.md), [collaboration protocol](collaboration-protocol.md), [delivery](../../workflow/delivery.md).

## Revisions

| What | Revision |
| --- | --- |
| Design baseline | `71abad0f` on `feature/raster-html-references` (accepted feature stack) |
| Branch point | `60e41d50` — baseline plus the settled design and handoff commits |
| Delivered branch | `feature/geolibre-native-raster-integration`, worktree `.rq-scratch/wt-geolibre` |
| G1 native reader | `91288bfd` |
| G2 import caller | `b73f4f89` |
| G3 analysis caller | `88bd1585` |
| Self-review findings closed | `05b61319` |
| Delivery (docs, receipt, guides, bead export) | `089b6f39`, `3004e4d3` |
| Review disposition brought into the branch | `28f94d14` |
| D1 combined-budget correction (code) | `6783fef6` |
| R1 reporting correction, receipt, guides and debrief | the commit that carries this section |

The primary checkout stayed on `feature/raster-html-references`; the user-owned edit in `desktop/src/native_operation.rs` was never staged, stashed or reset. Factual note: that edit is not `rustfmt`-clean under the pinned 1.97.1 toolchain (the committed file is), so repository formatting gates ran in the separate worktree.

## Actual dependency and lock identity

- `desktop/Cargo.toml`: `wbgeotiff = { git = "https://github.com/opengeos/whitebox-wasm", rev = "9c0ff4fdf3513f27b89c78e294610c3b418b3a4f" }`, resolved by `Cargo.lock` to `wbgeotiff 0.1.2` (`git+…whitebox-wasm?rev=9c0ff4f…`). The pin is unchanged from the design.
- `Cargo.lock` gained 27 packages (the reader plus its codec/threading closure: `jxl-*`, `webp-rust`, `zune-jpegxl`, `jpeg-decoder`, `jpeg-encoder`, `lz4_flex`, `weezl`, `bin-rs`, `crossbeam-*`, `rayon`, `rayon-core`, `twox-hash`, `either`). Resolved licenses are permissive: MIT, Apache-2.0, `MIT OR Apache-2.0`, `MIT OR Apache-2.0 OR Zlib`, and `(MIT OR Apache-2.0) AND IJG` for `jpeg-encoder`. `wbgeotiff` itself is `MIT OR Apache-2.0` and ships `LICENSE-MIT`/`LICENSE-APACHE` with the git source; the repository keeps no separate third-party notice file to update.
- Two target-scoped additions for the capacity guard: `libc = "0.2"` (`cfg(unix)`) and `windows-sys` with `Win32_Storage_FileSystem` (`cfg(windows)`); both versions were already in the lock. Justification: `std` has no filesystem-capacity API (`std::fs::available_space` is not stable in 1.97.1 — checked by compiling a probe) and no existing dependency reports it, while "fail preparation by name rather than guessing" requires a real reading.
- Build reproduction used `CARGO_HOME=<repo>/.rq-scratch/cargo-home` because the agent file sandbox cannot write `~/.cargo`. The route that actually works: `CARGO_HOME=<repo>/.rq-scratch/cargo-home cargo fetch` once **with network** (it fetches the pinned git checkout and the crates.io closure, including `jpeg-encoder`, which the default `~/.cargo` cache lacks), then build and test with the same `CARGO_HOME`. The reviewer's `--offline` replay failed because that cache's `registry/index` was a symlink to the read-only global index, so cargo could not write the index cache entry for `jpeg-encoder`; replacing the symlink with a writable copy of the 62 MiB index cache and re-running `cargo fetch` made the reviewer's exact command work offline: `CARGO_HOME=/home/daylon/projects/canopi/.rq-scratch/cargo-home CANOPI_SKIP_BUNDLED_DB=1 cargo test --offline -p canopi-desktop services::lidar -- --test-threads=1`. Harness and cache only, no repository change.

## Production call sites

- Import: `desktop/src/services/lidar/import.rs` — `stage_source` → `stage_source_samples` → `PreparedRaster::open` (prepare, validate, free space) → `scan` → `write_source_outputs` → `PositionedWriter`. No full-raster buffer.
- Analysis: `desktop/src/services/lidar/analysis.rs` — `run_slope_job` → `result_statistics` (native scan) and `grid::erode_mask_file` (streamed 3×3 erosion of the persisted coverage mask).
- New private module: `desktop/src/services/lidar/prepared_raster.rs` (`mod prepared_raster;`, not `pub`). Upstream types and paths never cross IPC.
- Retained whole-buffer production callers: `import::raw_f32_bytes` (used by `head_values_on_union`), `compose_values_cancellable`, `replay_members`, `ValidMask::read_from` consumers, and display generation.
- No new IPC command, scheduler, synchronous allowance, schema, shared type or UI file.

## G1–G5 outcomes

**G1 — native module.** Controlled preparation is `gdal_translate -of COG -ot Float32 -b 1 -mask none` with 256×256 blocks, `COMPRESS=NONE`, `OVERVIEWS=NONE`, `NUM_THREADS=1`, `STATISTICS=NO`, `SPARSE_OK=NO` and `GDAL_PAM_ENABLED NO`. The layout is parsed from a 64 KiB prefix that doubles to a 4 MiB ceiling and never reads past the file end; an unavailable layout is a named ceiling error with the attempted size, never a whole-file fallback. Exactly one level, one band, Float32, uncompressed 256×256 tiles, coherent counts/offsets, per-tile `262144`-byte counts, in-file ranges, expected dimensions and a 256×256 decoded sample count are all validated before decode. Windows are capped at 1024×1024, rejected for zero/overflow/out-of-bounds before allocation, and the adapter's live buffers are capped at 64 MiB (window samples+validity, one encoded tile, its decoded samples). Hermetic tests: authored values, padded edge tiles, `NoData`-absent validity, eight rejected window shapes, a 1100×2100 raster covered exactly once in row-band order, live-buffer bounds, seven malformed layouts, the metadata ceiling, cancellation, ownership, capacity failure. GDAL tests: preparation equals the retained Float32 conversion for Float32 (tiled and striped), Int16, Byte, UInt32 and Float64, and failed/cancelled preparation leaves no derivative.

**G2 — import caller.** `stage_source` streams samples, validity and the value range in bounded windows and writes the exact persisted row-major layouts through a positional writer; partial outputs are removed on failure or cancellation. The GDAL-backed caller test stages a 60×45 Float32 fixture (NoData sentinel, NaN, +inf, zero, negative) plus an Int16 conversion through the real `stage_import` review path and compares persisted `source-*.raw`, `valid-*.bin` and `value_range` against the retained dense conversion. Guard-removal check: with the decode instrument removed the same test fails on "staging must decode through the native tiled reader", so the detector is sensitive rather than incidentally green.

**G3 — analysis caller.** Result statistics stream from the controlled derivative, and the quality mask streams from the persisted coverage mask through a rolling three-row window over bounded column blocks; the reader is dropped before the analysis staging directory is renamed, and the test asserts no `prepared-*` reaches the published generation. Hermetic tests compare streamed erosion against `eroded_checked` for five patterns (all-valid, single hole, edge holes, checkerboard, block seam) at 1, 3, 7, 25, 64 and default block widths. The GDAL workflow test covers degrees and percent, published statistics versus the dense conversion, the published quality mask versus the dense oracle, and stale-input rejection with the previous result preserved.

**G4 — compatibility.** The real IGN MNT lifecycle (`stage → review → apply → display → slope → restart → rename → replacement → decision preview → undo → delete`) passes end to end on the delivered tree (83.66 s). Focused frontend LiDAR tests (6 files, 25 tests) and `tsc --noEmit` pass against the unchanged frontend. Full frontend suite: 270 files / 2633 tests pass in the primary checkout, whose frontend tree is byte-identical to the delivered one (no frontend file differs from `60e41d50`). It is not runnable inside the worktree because a symlinked `node_modules` makes Vite deny worker/asset module IDs and turns into unrelated PDF/MapLibre failures.

**G5 — delivery.** One consolidated branch, one receipt, no new harness, no per-defect report. Guides updated: [LiDAR](../../agent/lidar.md), [build and release](../../agent/build-release.md), design status, handoff index.

## Numerical, validity and persisted-data comparison

- Independent oracle: the retained GDAL `-ot Float32` ENVI conversion plus `valid_mask_from_f32_raw_checked` (now test-only) and `eroded_checked` (test-only). Expected fixtures are authored value functions and hand-built TIFFs, never the implementation's own output.
- Finite samples compare bitwise; invalid samples compare as the NaN class, with no NaN-payload promise. Validity is `finite && != declared NoData`, so zero and negative values stay data.
- Float32 (tiled and striped), Int16, Byte, UInt32, Float64: **0 differing samples** against the oracle across the module matrix.
- Real MNT tile `LHD_FXX_0445_6806_MNT_O_0M50_LAMB93_IGN69` (sha256 `7b8773046c27d3f42d9f6548c7adc24fca810de19ea6ed5f49b29302e22076ad`, 2000×2000 striped Float32, NoData −9999): 4,000,000 cells staged and published; slope result range `[0.0012363962596282363, 66.75675964355469]`; the published quality mask equals the dense erosion of the accepted coverage.
- Source range still includes finite NoData sentinels, preserving current `raw_value_range` behaviour; the valid-only discrepancy remains `canopi-jv8a.2`.
- A synthetic 45° plane (1 m rise per metre) publishes 45.0 in degrees and 100.0 in percent, with `coverage_cells`, `min_value` and `max_value` exactly equal to the dense recomputation of the published result.

## Review correction (D1) — combined working-set budget

The [independent disposition](geolibre-integration-review.md) found that `stage_source_samples` checked raw/mask space and `PreparedRaster::open` separately checked derivative space, so both saw the same free bytes and neither established the combined footprint the design requires.

One checked estimate now lives in `prepared_raster.rs` (`required_free_bytes`) and is enforced once, before GDAL preparation or any raw/mask creation:

`padded_cog_bytes(width, height) + metadata_prefix_ceiling + additional_output_bytes + FREE_SPACE_FLOOR_BYTES`

- `import::stage_source_samples` passes `cells * 5` (four sample bytes and one validity byte per cell) and no longer keeps a second preflight, so a single formula decides admission.
- `analysis::result_statistics` passes `0`: the slope result and the quality mask already exist on disk when the reader opens, so measured free space already reflects them. The separate check that covers the not-yet-written quality mask is unchanged.
- `scan` rechecks the reserve at every window's consumer boundary instead of once per row band, so a wide band cannot perform many writes between checks.
- Sequential phases are not double-charged: the managed-original copy and the GDAL probe finish before the combined check runs, so their bytes are already reflected in the measured free space; the previously staged sources' outputs are on disk for the same reason.

RED/GREEN evidence (fault injection, reverted before commit): with `additional_output_bytes` ignored — the reviewed defect — `combined_working_set_sums_every_simultaneously_live_allocation`, `combined_working_set_overflow_is_a_named_error` and `staged_source_rejects_an_insufficient_combined_budget_before_preparation` all fail; the caller test fails by reaching `gdal_translate` ("No such file or directory") instead of rejecting, which is exactly the reviewed behavior.

Independently calculated cases, asserted through the production estimate and the real import caller (not a detached formula):

| Case | Requirement | Observed |
| --- | --- | --- |
| 1024×1024 Float32 with staged outputs | 4 MiB derivative + 4 MiB metadata + 5 MiB outputs + 256 MiB reserve = **269 MiB (282066944 bytes)** | admitted at exactly 269 MiB; rejected one byte below |
| Same grid with 265 MiB free | the former outputs check needed 261 MiB and the former preparation check 264 MiB, so both passed | rejected, naming 282066944 required and 277872640 available |
| Same grid with no additional output | **264 MiB** | admitted at 264 MiB |
| `additional_output_bytes = u64::MAX`, or `u32::MAX × u32::MAX` dimensions | — | named overflow error; no allocation, wraparound or panic |
| Multi-window scan whose reserve disappears after the first window | — | first window delivered, second refused with the measured space named |

Rejection is asserted before preparation (a missing input never reaches GDAL) and before any derivative, raw or mask file exists. The GDAL-backed caller control confirms the exact boundary admits the work and writes both outputs at their exact persisted sizes. No production build reads the test seam: it is a `#[cfg(test)]` thread-local observation override, and the budget decision itself stays production code.

Limits of the check: it is a measurement, not an OS reservation; another process can consume the space immediately afterwards. Ordinary write errors still propagate, import partial outputs are still removed on failure, and there is no fallback to dense decoding on capacity failure.

## Cancellation, failure, cleanup and publication

- Cancellation is checked before preparation, before each decoded tile, before each window, at each row band and before a successful return; the error string stays `cancelled`, which the job state machine still maps to the cancelled state.
- Derivative files are removed on drop, on preparation failure and on validation failure; the file handle is closed before removal (Windows-safe), and sidecar names are removed too. Tests assert no `prepared-*` remains after staging, after analysis publication, and after failed preparation.
- Failure injection: an output path occupied by a directory fails staging by name and leaves no partial mask; an unmeasurable scratch directory fails with "Cannot verify free space" instead of guessing; an impossible requirement reports the shortfall in MiB.
- Publication is unchanged: the analysis publish transaction, stale-input guard and head replacement are untouched, and stale work publishes nothing while the previous result stays readable.
- No prepared derivative was written beside a managed original (`GDAL_PAM_ENABLED NO`), and originals/accepted generations are never modified.
- **Scope correction (review R1).** Established: the reader removes its own derivative (drop, preparation failure, validation failure, cancellation), import staging removes partial raw/mask outputs, and stale analysis work discards its staging directory before returning. **Not established: whole-analysis staging cleanup.** `analysis::run_slope_job` creates `prepared/analysis/<definition_id>/staging-<job_id>/` and every `?` before publication leaves it in place; the settlement caller only updates job state, and startup pruning never scans analysis staging directories. This inherited gap is tracked as `canopi-jv8a.3` with a dynamically observed example (a mid-pipeline capacity failure left `staging-anl-…/` holding `result.tif` and `quality.bin`; a pre-cancelled run left the empty directory). Accepted results, the published head and the numeric guarantees are unaffected, and this correction does not implement the cleanup fix.

## Gates on the delivered tree

| Gate | Result |
| --- | --- |
| `cargo fmt --all -- --check` | pass |
| `CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings` | pass |
| `CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace` | pass |
| `CANOPI_SKIP_BUNDLED_DB=1 cargo test --workspace` | 351 passed, 0 failed, 10 ignored |
| `cargo test -p canopi-desktop native_command_policy::tests` | pass (included above) |
| `cargo test -p canopi-desktop lidar::` | 53 passed, 0 failed, 8 ignored |
| Ignored GDAL tests (`prepared_raster`, `import::tests`, `analysis::tests`, real e2e) | 8 passed, 0 failed (includes the 79 s real MNT lifecycle) |
| `CARGO_HOME=<repo>/.rq-scratch/cargo-home CANOPI_SKIP_BUNDLED_DB=1 cargo test --offline -p canopi-desktop services::lidar -- --test-threads=1` | pass (the reviewer's replay command, after the index cache fix) |
| `npx tsc --noEmit` (frontend, worktree) | pass |
| Focused frontend LiDAR tests (6 files) | 25 passed |
| Full frontend suite (primary checkout, identical frontend tree) | 270 files / 2633 tests passed |
| `python3 scripts/check_docs.py`, `git diff --check` | pass (0 errors) |
| Binding regeneration | not required — no shared contract, IPC or schema change |

## Unavailable environments and limitations

- The documented default fixture tile `0446_6807` is absent on this host. The real run used the explicit `CANOPI_LIDAR_E2E_FIXTURE` override with the real `0445_6806` MNT tile and its hash above; no `0446_6807`-specific assertion was transplanted.
- No Desktop UI smoke: this environment is headless and has no UI automation. Display is covered by the real lifecycle's PNG/tile-alpha checks and by the frontend tests, not by a driven window.
- The Windows capacity branch (`GetDiskFreeSpaceExW`) is not compiled or exercised here; only `x86_64-unknown-linux-gnu` is installed, and Windows CI would be the first compile of that branch.
- The full frontend suite cannot run from the worktree (symlinked `node_modules`, Vite denies worker/asset module IDs). It ran green in the primary checkout instead; no frontend file differs between the two trees, so this is a harness limitation, not skipped coverage.
- The 512 MiB/1 GiB/16-file/25-million-cell admission paths were not re-run at their limits; only the dense limit's rejection unit test ran.
- The reviewer's offline rerun was blocked by dependency caches, not by the code; the exact working cache route and command are recorded above, and the offline replay now passes from the implementation worktree.
- The capacity requirement is a measurement plus a per-window recheck, not an OS reservation. A concurrent process can still consume the space, and no run in this delivery observed a real out-of-space event; the tested cases use the observation seam rather than filling a filesystem.

## Unchanged limits and remaining dense callers

- Limits retained verbatim: 16 files/import, 512 MiB/file, 1 GiB/batch, 25,000,000 dense working cells.
- Dense callers retained: `compose_values_cancellable` (union mosaic), `replay_members` (member replay for review/undo), `head_values_on_union` → `import::raw_f32_bytes` (accepted head), `ValidMask::read_from` consumers, and display generation.
- **Full-grid composition is not solved by this assignment.** Import remains dense end to end after extraction: review classification, composition, head snapshots and display still allocate whole-raster buffers at the current limits. Bounded extraction is real production work, but it is not bounded import, and this delivery claims no capacity gain and no 48M/400M run.

## Decisions taken without a courier round

1. `PreparedRaster::open` takes the caller's effective validity rule (`nodata: Option<f32>`) rather than reading it from the derivative: analysis legitimately uses `band_nodata(result).or(manifest.nodata)`, which can differ from the file's tag, and G2/G3 keep exactly the baseline rule. Dimensions are still validated against the expected grid.
2. `read_window` is compiled for tests; production callers use the streaming `scan`, which reuses buffers and avoids a per-window allocation and a dead production method. The window-level contract is still tested directly.
3. Preparation passes `-b 1`, so a multi-band source is now staged as an incompatible review item (its existing probe issue) instead of aborting the whole import with a buffer-size error. Single-band behaviour is unchanged.
4. Test tiers: GDAL-dependent tests are `#[ignore]`d because CI installs no GDAL (`grep gdal .github/workflows` is empty) and the repository convention is an explicit `--ignored` run; the hermetic module tests run in the default suite.
5. Pre-existing defect fixed in scope: `gdaldem slope -p` was spliced between `-s` and its scale argument, so **every percent slope job failed** with "Numeric value expected for -s". The new units test found it; the fix is one argument position and the test now covers both units.
6. `valid_mask_from_f32_raw_checked` became a test-only oracle once staging migrated; `raw_f32_bytes` stays in production because composition still needs it. No production code can reach the dense extraction path from staging.
7. The metadata-ceiling error names the attempted prefix size and file length, because the previous wording made a real diagnosis guesswork.
8. The combined estimate lives in `prepared_raster.rs` and the import caller passes its output bytes to `open`; the alternative of duplicating the formula in the caller was rejected as the inconsistency the review found.
9. Capacity observation is overridden in tests with a `#[cfg(test)]` thread-local seam rather than an environment switch, a filled filesystem or a mocked budget decision.
10. The per-window recheck replaced the row-band recheck rather than being added to it, so one bounded write window is the unit of capacity observation.
11. Whole-analysis staging cleanup is deliberately not implemented here; it is filed as `canopi-jv8a.3` instead of widening the review correction into a lifecycle rewrite.

## Next architectural dependency

End-to-end bounded generation/composition, settled by the main agent against actual code after this delivery is accepted: import review, undo, display, slope input resolution and sparse gaps together before any limit can move (then the 48M batch and 400M case). New Data/Analysis UI follows foundation parity using approved HTML revision `0e696722`. GDAL stays as preparation/CRS/slope/display authority. Old Q remains frozen and unqualified; it was not run, relabelled or repaired.
