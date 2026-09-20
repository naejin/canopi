# GeoLibre adoption — compatibility-first native integration

Status: active — user-approved direction; settled first production assignment, not implemented or accepted.
Tracking: `canopi-j571`; implementation `canopi-jv8a.1`, followed by the remaining `canopi-jv8a` foundation work.
Current guidance: [agent assignment](geolibre-integration-agent-prompt.md), [LiDAR](../../agent/lidar.md), [architecture ownership](../../workflow/architecture-ownership.md), [long-term product contract](../raster-data-analysis-rework.md).

## Decision and outcome

Adopt useful GeoLibre technology behind Canopi-owned native modules. Preserve the working application and existing UI first; add the approved Data/Analysis features afterward. Do not import GeoLibre's application shell or reorganize Canopi's document, canvas or map ownership around a toolkit.

The user has now made the engine-direction decision. The old requirement to finish the experimental Q harness before **any** production work is superseded. Q remains unqualified, frozen and historically truthful. Its known defects are not accepted; neither its verdicts nor its completion are the release authority for this native integration. Product correctness, compatibility and resource tests move to the actual production callers described below. This is a change in architecture and verification ownership, not a claim that previous artifacts passed.

The first assignment replaces full-raster **source extraction and analysis postprocessing** with bounded native reads, through existing import and slope workflows. It includes dependency integration, production callers, regression tests, real workflow verification and documentation in one delivery. It is not a dependency-only spike.

**Capacity boundary:** existing composition, overlap review, history reconstruction and display still have dense operations. Retain the 512 MiB/file, 1 GiB/batch, 16-file and 25-million-cell admission limits in this assignment. Removing those limits, sparse generations, the 48-million-cell batch and 400-million-cell case belong to the next foundation assignment. Bounded extraction is useful production work, but is not bounded end-to-end import. Do not claim otherwise or start those large runs now.

## Inspected baseline and selected reuse

Canopi baseline: `71abad0f` on `feature/raster-html-references`. Preserve the full accepted stack and user-owned `desktop/src/native_operation.rs` edit. Relevant current code:

| Existing module | Retained authority / implementation change |
| --- | --- |
| `lidar/import.rs` | `stage_source` currently obtains a full `Vec<u8>`, writes `source-*.raw` and `valid-*.bin`, and computes a range. Replace that extraction with streamed output; retain `StagedSource`, interpretation hashing, original storage, review/apply and publication contracts. |
| `lidar/analysis.rs` | Keep native GDAL slope. Stream result statistics and 3×3 quality-mask erosion instead of loading full result/mask buffers. Preserve parameters, recipe meaning, result manifest, refresh and stale-publication guards. |
| `lidar/grid.rs` | Keep exact mask and grid semantics. Dense helpers remain for unmigrated callers and small test oracles; do not claim their production removal. |
| `lidar/engine.rs` | Keep GDAL discovery, CRS probing, preparation, process cancellation and display generation. New preparation calls use this owner, not another process runner. |
| `lidar/mod.rs`, native executor | Keep library/job ownership and admission. No frontend worker, new IPC command, scheduler or native synchronous allowance is needed. |

Upstream inspected on 2026-09-20:

- GeoLibre Rust revision **`aac2b743978666f3c3119b5c93de1b30963b1493`**, package manifest `geolibre-wasm` 1.5.3. Its [Cargo.lock](https://github.com/opengeos/geolibre-rust/blob/aac2b743978666f3c3119b5c93de1b30963b1493/Cargo.lock) selects `wbgeotiff` 0.1.2 at **`9c0ff4fdf3513f27b89c78e294610c3b418b3a4f`** from `opengeos/whitebox-wasm`.
- GeoLibre's [CogStream wrapper](https://github.com/opengeos/geolibre-rust/blob/aac2b743978666f3c3119b5c93de1b30963b1493/crates/geolibre-wasm/src/lib.rs) delegates layout and tile decoding to that native crate. Adopt the **shared native core directly**, not `geolibre-wasm` or the all-tools registry merely to obtain its name. This first delivery reuses a GeoLibre dependency, not a GeoLibre-authored analysis algorithm.
- The pinned [native reader](https://github.com/opengeos/whitebox-wasm/blob/9c0ff4fdf3513f27b89c78e294610c3b418b3a4f/crates/wbgeotiff/src/reader.rs) exposes `GeoTiff::parse_cog_layout`, `CogLayout.levels`, `CogLevel::tile_range` and `decode_tile_f64`. `GeoTiff::open` / `from_reader` retain file data; **do not use them as a bounded reader**. No invented native `CogStream` API or whole-band call.
- Add only `wbgeotiff = { git = "https://github.com/opengeos/whitebox-wasm", rev = "9c0ff4fdf3513f27b89c78e294610c3b418b3a4f" }` at the project's normal Rust dependency location and commit the resolved workspace lock. It is MIT OR Apache-2.0; retain notices and inspect resolved transitive licenses. Native source fetch/build is authorized. A native build does not need wasm-pack, a wasm target or a published npm artifact. Do not silently advance the revision if it fails.
- Retain the [GeoLibre frontend reuse inventory](geolibre-reuse-inventory.md) as historical pattern research. No React, Zustand, Cesium, general tool registry, WASI in-memory filesystem or browser raster engine is added in this assignment. GeoLibre-authored algorithms and new display machinery wait for a specific product consumer.

The LiDAR maintainer owns the dependency pin, notices and adapter regression tests. Do not modify historical `candidates.json` to pretend that the old measured npm build matches this new native build.

## Private interface and ownership

Add one deep module under `desktop/src/services/lidar/`, with small private helpers if useful. Proposed names below are design names, not existing APIs:

`PreparedRaster::open(engine, input, expected_grid, job_scratch, cancel)` prepares/opens one controlled tiled derivative; `read_window(window, cancel)` returns row-major Float32 samples and exact byte validity for a half-open, in-bounds integer window; dropping the owner closes handles and removes only its own temporary derivative. A streaming scan method may call a consumer per window to avoid retaining windows. Keep these types private to LiDAR and never expose upstream types or filesystem paths through IPC.

Always prepare an uncompressed, single-band Float32 COG with 256×256 blocks and no overviews using the existing GDAL adapter, from the managed original or immutable result. Use fixed arguments, no shell. This intentionally preserves the existing Float32 extraction contract, including GDAL conversion for other admitted numeric types; it does **not** establish the future lossless Float64/large-integer contract. Keep GDAL's CRS/admission interpretation authoritative and validate derivative dimensions against the expected grid. Stripped legacy inputs are supported by preparation, not whole-file decoding. Do not alter originals, their sidecars or accepted generations. Disable auxiliary metadata writes on read-only inputs.

Read the COG prefix starting at 64 KiB, doubling to a **4 MiB metadata ceiling**; do not read beyond file length. A layout still unavailable at that ceiling is a named unsupported-preparation error, not a full-file fallback. Before decoding verify one level, one band, Float32, uncompressed 256×256 tiles, coherent counts/offsets, checked arithmetic and all ranges within the file. Reject malformed/truncated output. Each tile's expected bytes are 256×256×4; validate returned sample count and clip padded edge tiles. The controlled format deliberately avoids invoking an unbounded decompressor on arbitrary compressed input.

Maximum requested window is 1024×1024; reject zero dimensions, overflow and out-of-bounds requests before allocation. One scan has one open reader, one tile decode in flight and bounded output buffers; no cache or prefetch queue. Cap adapter-owned live buffers at **64 MiB**; do not retain a vector of windows. This local bound is not a claim about the entire app's RSS. Use row-wise positional output or a bounded row stripe so tile traversal still writes the exact row-major persisted layout.

The existing heavy native operation owns preparation and scan synchronously off the UI thread. Check cancellation before preparation, between reads/decoded blocks and before successful return/publication. GDAL child cancellation remains its existing executor-backed mechanism. Do not queue child work behind the permit held by the parent. No detached work or descriptor survives completion; close files before scratch removal on Windows. On failure/cancellation, remove incomplete new outputs and retain the prior head/result. Existing publication transactions and job outcome rules remain authority.

Extra temporary disk is a migration cost: reserve/check at least the padded uncompressed COG size, metadata ceiling and 256 MiB free-space reserve, plus any new raw/mask output being created. Use checked sizes and an existing filesystem-space facility where available; recheck between bounded writes. The single scan's derivative is removed before the next source. Disk failures remain ordinary failed jobs, never partial success. If the platform cannot establish the required free space, fail preparation with a named reason rather than guessing. No new disk-space library without explaining why current dependencies/platform facilities are insufficient.

## Compatibility contract

No schema migration, document-format bump, shared-type/IPC change or production UI layout change is authorized. Managed `values.raw` remains little-endian Float32, `valid.bin` remains one byte per cell; identifiers, original hashes, interpretation hashes, generation manifests and source ordering stay compatible. The new derivative is temporary, not a second durable authority.

Validity remains finite and not equal to declared NoData after the existing Float32 conversion; zero and negative values remain valid. Preserve invalid samples in raw output exactly as the old conversion provides them; validity is separate. Compare valid finite values bitwise and invalid NaN semantics without inventing a NaN-payload compatibility promise. Preserve current source-range behavior (`raw_value_range` includes finite NoData sentinels) in this behavior-preserving slice; that discrepancy with valid-only future statistics is tracked separately in `canopi-jv8a.2`, not permission for a silent interpretation change. Slope statistics keep their existing finite-and-not-NoData rule.

Quality masks use the existing full 3×3 accepted-coverage neighborhood: missing/outside neighbors invalidate the output cell. Implement with three rows or bounded windows plus a one-cell halo; output bytes must match the current `eroded_checked` oracle across block boundaries, holes and outer edges. No new slope algorithm, tolerance, interpolation or unit policy.

Existing workflows must still work: create/import → overlap review/decision preview → Apply → display; overlap replacement on/off and add-uncovered choices; cancel/failure; undo; slope degrees/percent; automatic refresh; hide source/show result; rename; restart/reopen; saved Design references and Web round-trip. Do not replace the old review UI with the approved new mockups yet. The existing display path stays in place, including its remaining capacity limits.

## Internal milestones and acceptance

These are execution order, not separate courier gates or a Markdown task tracker. One bead owns G1–G5; finish the batch and repair in-scope findings before delivery.

| Milestone | Required product result / detector |
| --- | --- |
| G1 — native module | Build the exact dependency and implement controlled preparation/window reads. Real small TIFF/COG tests, independently authored expected values, edge windows, malformed layout, cancellation and cleanup; assert bounded read/allocation sizes. A compiled unused dependency is not completion. |
| G2 — import caller | `stage_source` uses the module to stream raw samples, mask and range. Compare persisted bytes/semantics against the baseline GDAL conversion on admitted small numeric types, NoData, zero, negative and non-finite cases. A caller integration test must fail if native decoding is bypassed or output is wrong. Keep remaining dense callers and limits explicit. |
| G3 — analysis caller | Stream GDAL slope-result statistics and quality-mask output through the real analysis path; preserve refresh/result publication. Test both units, block seams, holes, cancelled scan and stale-head rejection using existing scientific expectations. |
| G4 — compatibility | Exercise real library import/review/apply/display/undo/reopen/analysis and saved-reference tests. Use an isolated app-data directory, never the user's live library. Run a Desktop UI smoke with existing controls if available; unavailable display/fixture/platform is reported, not inferred. |
| G5 — delivery | Run required gates on the combined tree, review the changed callers for full-file fallback and resource leaks, reconcile docs, record retained dense call sites and next foundation boundary, commit/push one consolidated handoff. No extra harness, benchmark framework or per-defect report. |

Read `AGENTS.md` for exact gates. At minimum: focused `services::lidar` tests; Rust formatting, strict Clippy, workspace check/tests and native command policy; existing LiDAR frontend tests and TypeScript check for unchanged integration contracts; docs validation and diff check. Bindings need regeneration only if an independently authorized contract change occurs. No need to run frozen qualification Python/TS suites when neither they nor their consumers change.

Use small synthetic fixtures in ordinary Rust tests and existing GDAL integration tests. One managed MNT workflow is authorized from the plan's explicit fixture location/hash, read-only, with outputs in an isolated profile; verify actual identity and scientific expectations. Do not substitute tile `0445_6806` into `0446_6807`-specific assertions. Missing real data does not block synthetic implementation and compatibility tests, but prevents claiming real-data verification. No 48M/400M run, fixture download, privileged installation or release is authorized here. Native dependency fetch and ordinary local build/retries are authorized; unavailable credentials/network or a failed pinned native build are concrete blockers, not permission to select a different engine.

Acceptance belongs to the main agent through the user. Existing correct tests are not replaced with tests that merely agree with new code. Use focused TDD and one risk-oriented self-review; no mandated mutation-count target, universal schema audit or complete Q inventory. Main review covers actual dependency use, bytes/validity compatibility, lifecycle/publication safety and truthful capacity claims—not unrelated frozen-harness defects.

## Delegation and next architecture boundary

Delegate helper names, private file organization, bounded traversal details, test fixture construction, local bug fixes required by G1–G5, ordinary build troubleshooting and removal of private helpers made unused by these caller migrations. Do not stop after G1 or request approval for each test fix. Hold only work requiring a different engine revision, changed scientific semantics, expanded supported formats/capacity, new public interface/storage authority or UI redesign; send evidence and a precise recommended decision through the user.

After this delivery is independently accepted, the main agent settles the next **end-to-end bounded generation/composition** assignment against actual code. It must address import review, undo, display, slope input resolution and sparse gaps together before limits can be removed. The long-term plan's N1–D specification is input to that design, not automatic authority now. New Data/Analysis/inspection UI follows foundation parity using approved HTML revision `0e696722`; material UI departures still return to the user. Retain GDAL where useful rather than pursuing an all-GeoLibre purity rewrite.
