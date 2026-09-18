# GeoLibre reuse inventory for raster qualification (Q)

Status: evidence — inspection record for the Q slice; selects no production dependency.
Tracking: `canopi-kqpp`, parent epic `canopi-j571`.
Current guidance: [implementation plan](../raster-data-analysis-rework.md), [LiDAR guide](../../agent/lidar.md), and the [Q receipt](../raster-qualification-q.md).

This record answers the plan's instruction to inspect GeoLibre for patterns actually useful to
Canopi's bounded raster route, and to state plainly what is reused, adapted, or rejected. It is
inspection evidence, **not** an adoption decision: no GeoLibre package is imported, bundled, or
added to a Canopi manifest by this slice.

## Revision inspected

| Item | Value |
| --- | --- |
| Repository | `https://github.com/opengeos/GeoLibre` |
| Revision inspected | `c5a72b027002a673ce48115ee19358205acd9791` (2026-09-17, "Render COG imagery on ArcGIS maps and scenes (#2447)") |
| Why this revision | It is the revision the plan pins. No newer revision was needed: every module below exists at the pin with the behaviour described. |
| Relationship to upstream `HEAD` | The pin is an ancestor of `bb18f8ab` (10 commits behind at inspection time). The newer commits were not consulted and no behaviour below depends on them. |
| License | MIT (`LICENSE`, "Copyright (c) 2026 Qiusheng Wu") |
| Package manager | npm workspaces (`apps/*`, `packages/*`, `workers/*`) |

Attribution obligation if any adapted code is ever vendored: retain the MIT copyright notice. Only
patterns and interfaces are reused here, so no notice is currently required in Canopi.

## Paths traced

The plan asks for the actual call chain rather than behaviour guessed from filenames. At the pinned
revision the chain for a local raster is:

1. **Local file access** — `packages/processing/src/cog-convert.ts` accepts whole `Uint8Array`
   bytes. `packages/processing/src/raster-subset.ts` is the only module that reads a COG by byte
   range, and it does so over HTTP through `geolibre-wasm/tools` (`extractCogSubset`).
2. **Preparation** — `cog-convert.ts` re-encodes a striped GeoTIFF into a tiled COG in the browser
   via `GeoTiffReader` + `CogBuilder`.
3. **Numeric decoding** — `packages/processing/src/raster-client.ts` decodes bands with
   `geotiff.js` `fromArrayBuffer` into a `RasterData` of `Float32Array`s.
4. **Worker execution** — `packages/processing/src/wasm-tool-runner.ts` drives
   `packages/processing/src/wasm-tool.worker.ts`, which calls `geolibre-wasm/tools` `runTool`.
5. **Display** — `packages/map/src/cog-imagery.ts` wraps `cog-tiler-wasm` `openCog`;
   `packages/map/src/cesium-cog-imagery.ts` renders tiles in a globe layer.
6. **Disposal** — worker pooling/termination in `wasm-tool-runner.ts`; COG source caching in
   `cog-imagery.ts`. No explicit `CogSource` disposal exists in either module.

## Inventory

| Module and revision | Behaviour relevant to Q | Decision | Reason and Canopi-specific change | Verification needed |
| --- | --- | --- | --- | --- |
| `packages/processing/src/cog-convert.ts` @ `c5a72b0` | Converts a striped GeoTIFF to a tiled COG with overviews **in the browser**; hard cap `MAX_BROWSER_COG_CONVERSION_SAMPLES = 100_000_000` decoded samples, with a warning threshold at 40M; refuses above the cap | **Adapt the policy, reject the mechanism** | The policy — a declared ceiling with an explicit refusal instead of an OOM — is exactly the posture Canopi needs, and it independently confirms that a striped GeoTIFF cannot be displayed without preparation. The mechanism is rejected: it decodes the entire raster into wasm memory, which the plan forbids for large inputs. Canopi prepares with native GDAL in bounded blocks and never decodes a full raster in the browser. | Canopi's own prepared derivative fidelity and bounded reads (Q experiment 3, `docs/design/raster-qualification-q.md`) |
| Same, `initCogWasm` | Memoised init that **clears the memo on failure** so a transient wasm fetch failure does not poison the session | **Reuse the pattern** | Directly prevents a stuck "unavailable" state after one failed asset load. Canopi's display adapter should do the same instead of caching a rejected promise. | A unit test that a first failed init is retried on the next call |
| Same, `readGeoTiffInfo` / `isTiledGeoTiff` | Header-only metadata probe, then a tiled check, before attempting tiled rendering | **Reuse the pattern** | Matches the qualified route: read metadata from a prefix, decide addressability, then choose preparation. Canopi already does this; the upstream shape confirms the ordering. | Covered by Q experiment 2 metadata probes |
| `packages/processing/src/wasm-tool-runner.ts` @ `c5a72b0` | Worker pool with: ack-based **dead-worker detection** for reused workers (`REUSED_WORKER_ACK_MS = 10_000`) because an OOM-killed worker fires no `error`; `error` **and `messageerror`** handling; listener removal on every exit path; `releaseIdleWasmToolWorkers()` for teardown | **Adapt the lifecycle discipline; reject the pooling policy** | The dead-worker ack, `messageerror` handling, listener cleanup and an explicit release entry point are all things Canopi's worker owner must have, and upstream documents the exact failure mode (a worker that dies silently). The pooling policy is rejected as-is: it limits **idle** workers (`MAX_IDLE_WORKERS = 1`) but not total active workers, and it deliberately sets **no run timeout**, which cannot express Canopi's cancellation and settlement requirements. | Canopi worker ownership, dead-worker detection and cancellation settlement are exercised in Q experiment 5 |
| `packages/processing/src/wasm-tool.worker.ts` @ `c5a72b0` | One worker module that posts an immediate `ack`, then one terminal message; requests carry `Record<string, Uint8Array>` inputs which are **structured-cloned** into the worker | **Adapt the protocol, reject the transfer** | The ack-then-terminal message protocol is the right shape for Canopi's worker adapter. The structured clone is rejected for large numeric payloads: it doubles peak memory at the boundary, which a bounded-budget route cannot afford. Canopi should transfer buffers or pass generation-scoped handles. | A memory measurement at the worker boundary, to be added with the worker owner in slice D |
| `packages/map/src/cog-imagery.ts` `cachingCogTiler` @ `c5a72b0` | One `CogSource` promise per URL, shared by all layers; a **failed open is evicted** so a later attempt can retry; explicit `forget(url)` and `clear()` | **Reuse the pattern** | Solves two Canopi requirements at once: re-styling or re-ordering a layer must not re-open the source, and a transient open failure must not permanently poison a dataset. The `forget`/`clear` seam is also where Canopi must hook generation replacement and teardown. | A test that a failed open is retried, and that teardown clears every cached source |
| `packages/map/src/cesium-cog-imagery.ts` @ `c5a72b0` | Documents that **the wasm render cannot be interrupted** (`cog-tiler-wasm` takes no signal), so it checks `signal.aborted` **before** rendering and again **after**, discarding an abandoned tile; caps `maxConcurrentRequests: 4` to avoid queueing a screenful of tiles | **Reuse the pattern; adopt the finding** | This is the authoritative confirmation that mid-decode cancellation is impossible with this artifact, which is why Canopi's cancellation is cooperative and must fence results rather than interrupt the decoder. The pre-check/post-check pair and a concurrency cap are exactly what Canopi's display adapter needs. | Canopi cancellation is measured in Q experiment 5; the concurrency cap belongs to slice D |
| `packages/processing/src/raster-client.ts` @ `c5a72b0` | Client-side raster tool engine over `geotiff.js`, with `MAX_CLIENT_RASTER_BYTES = 512 MiB` and an in-source note that it is a **convenience fallback** and that production-grade or large rasters should use the streaming sidecar | **Reject for the bounded route; retain as corroboration** | Its whole-raster `Float32Array` model is the design Canopi is replacing, so it is not reusable machinery. It is useful corroboration that upstream also declines to treat browser-side whole-raster processing as the production path. | None |
| `packages/processing/src/raster-subset.ts` @ `c5a72b0` | Byte-range COG subsetting, but through `geolibre-wasm/tools` over HTTP, and it returns a new COG rather than windowed samples | **Reject** | Requires `geolibre-wasm/tools`, which the plan defers and this slice must not adopt, and its HTTP-only byte-range path is not the local scoped transport Canopi needs. Its lazy-module-with-reset pattern duplicates the `initCogWasm` pattern already noted. | None |
| `packages/map/src/{arcgis,cesium}-cog-imagery.ts`, `cog-dem-source.ts` | Renderer-specific COG integration for MapLibre, ArcGIS and Cesium | **Reject** | Canopi has one canvas/map owner and no globe scope. The plan forbids globe work and a second renderer path. | None |
| `wasm-tool-runner.ts` + `cog-tiler-wasm@^0.3.5` (map package) | Upstream's own dependency declaration for the display artifact | **Corroboration only** | Confirms the display artifact choice independently. It does **not** transfer a version pin: Canopi's qualified pairing is `cog-tiler-wasm@0.3.6` with `whitebox-wasm@0.5.1`, established by artifact/source correspondence in Q experiment 1. | Q experiment 1 |

## Bundler, exports and asset loading

| Concern | Upstream at the pin | Canopi consequence |
| --- | --- | --- |
| Wasm asset loading | `initCogWasm()` in `cog-convert.ts` calls the wasm-bindgen `init()` with no argument in the browser, letting the bundler resolve the asset; tests pass bytes or a URL explicitly | Canopi must resolve the wasm asset explicitly and bundle it for offline use. The plan requires bundled worker/assets with no network, so an implicit bundler-resolved fetch is not sufficient evidence on its own. |
| External CDNs | The app build has a `GEOLIBRE_NO_EXTERNAL_CDN` mode that **fails the build** if it is combined with a CDN-offloading flag, rather than silently downgrading | Supports the plan's offline requirement: Canopi should also refuse to emit a build that depends on a remote wasm CDN. |
| Bare peer specifiers | Upstream resolves `geotiff`, `proj4`, `lerc`, `zstddec`, `pako` and `geotiff-geokeys-to-proj4` through its bundler | Q reproduced real breakage here: resolving `geotiff` through its `"browser"` condition **drops `fromBlob`**, which is the only local-file entry point; `geotiff-geokeys-to-proj4@2026.8.16` drops the default export cog-tiler calls. Both are recorded in the Q receipt and are integration costs slice D must handle explicitly. |
| `exports`/subpath resolution | Imports `geolibre-wasm/tools` as a subpath export | Not adopted. Canopi imports only the two qualified artifacts. |

## Upstream patterns deliberately not adopted

- **Worker pooling limits idle, not active, workers, and sets no run timeout.** Canopi requires one
  heavy raster job library-wide, bounded queues, and settlement within 5 seconds, so its worker
  owner needs an explicit active-work bound and cancellation. The upstream comment argues that a
  timeout is worse than waiting for a data-bounded job; that reasoning does not apply to a route
  with a stated settlement gate.
- **Structured-cloning input buffers.** Peak memory doubles at the boundary.
- **Whole-raster decode in the browser.** Rejected by the plan for large inputs.
- **The React/Zustand shell, the processing catalogue, the plugin framework, globe rendering, and
  `geolibre-wasm`/`geolibre-rust`.** Out of scope by the plan and not used.

## What this inspection changed in Q

The inspection materially improved the corrected receipt rather than being a formality:

1. It **independently confirms** the central Q finding — that a striped GeoTIFF cannot be rendered
   without preparation — and shows upstream also treats browser-side whole-raster work as a bounded
   convenience path, not a production one.
2. It supplies the **authoritative reason** mid-decode cancellation is impossible with this
   artifact, which already matched Q's measured behaviour and is now cited rather than assumed.
3. It yields four concrete, low-risk patterns the corrected Q harness **now exercises**: retryable
   module init, cached sources with eviction on failure, ack-based dead-worker detection, and
   pre-check/post-check fencing around an uninterruptible render.

## Verification the plan still requires before any reuse ships

- A Canopi-side test for each adopted pattern (init retry, cache eviction on failed open,
  dead-worker detection, cancellation fencing).
- Peak-memory measurement at the worker boundary if any worker transport is introduced.
- Offline/bundled asset verification without network, on each packaged platform.
- Confirmation that no near-copy of upstream code is vendored without the MIT notice.
