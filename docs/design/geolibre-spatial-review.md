# Canopi v2.0.0 — unified spatial workspace implementation plan

Status: completed.
Tracking: `canopi-ltck` (implementation), `canopi-8j2j` (planning).
Current guidance: [ADR 0025](../adr/0025-always-anchored-spatial-workspace.md), [Canvas runtime](../agent/canvas-runtime.md), [MapLibre](../agent/maplibre.md), [Document lifecycle](../agent/document-lifecycle.md).

Historical implementation handoff, completed 2026-09-16. The retained contracts and qualification evidence describe that execution. Current ownership and commands belong to the guides above; this record does not authorize new work. Public release is a separate operation. Current task state belongs in bd.

Qualification decision, 2026-09-16: correctness remains the v2 release priority.
The representative 2,201-Plant Design is the supported product fixture. The
temporary 10,000-Plant derivative remains a required functional stress case for
data integrity, editing behavior, fallback and lifecycle, but it does not promise
smooth interactive editing. The 60 Hz, input-latency and stall figures in section
7 are diagnostic reference targets and documented product limits rather than v2
release blockers. `canopi-ltck.26` is the accepted bounded optimization;
`canopi-ltck.27` records the rejected follow-up experiments. Do not perform
another renderer optimization pass in this epic before completing correctness,
integration and removal work.

## 1. Mandate and scope

Deliver one spatial workspace for drawing and geographic data. Every Design has a spatial anchor; a blank canvas is that same workspace with geographic backgrounds hidden. Target one camera owner and a shared interactive map/scene render lifecycle. Preserve Canopi's specialized botanical editing and local metric geometry.

Use **GPT-5.6 Sol as lead/orchestrator**, with selective Terra/Luna workers under section 9. The user accepted this model-routing approach and maximizing useful GeoLibre reuse. Reuse means reducing total implementation and maintenance cost, not maximizing copied lines. No plugin is required for the available Codex subagent workflow. This document remains the authoritative implementation handoff; active beads record the executable slices and their evidence.

This is **v2.0.0**. Backward compatibility is not required. Do not build legacy readers, optional-location compatibility branches, dual-write fields, old-schema migrations or a permanent old/new architecture switch. Breaking changes still require explicit format versioning and clear rejection of unsupported inputs. Do not overwrite or delete existing user files or app data.

Use the existing **2,201-plant Design as the primary representative fixture**. The product must still load, preserve and operate on 10,000 plants without corruption, crashes or lifecycle failure; a derived scale fixture supplements the real Design rather than replacing it. Smooth 10,000-plant interaction is not a v2.0.0 guarantee.

This plan owns spatial contracts, camera/input/render integration, related Layers/Location behavior, validation and removal of superseded code. The [LiDAR plan](lidar-library.md) continues to own raster import, acceptance regions, storage and scientific analysis. New hydrological algorithms, national data hosting, arbitrary CRS editing, globe/pitched editing, collaboration, generic GIS editing and new PDF map backgrounds are outside this epic.

The reported 34 km coverage discrepancy and layers remaining fixed after coverage navigation are regression scenarios, not a verified diagnosis. Do not claim their cause from this plan.

## 2. Start workflow and existing work

Read `AGENTS.md`, [domain vocabulary](../../CONTEXT.md), and these guides before touching their areas:
[canvas runtime](../agent/canvas-runtime.md), [MapLibre](../agent/maplibre.md),
[document lifecycle](../agent/document-lifecycle.md), [performance](../agent/canvas-performance.md),
[edition development](../agent/edition-development.md), [Canvas PDF](../agent/canvas-pdf.md),
and [design system](../../.interface-design/system.md).

Current inspected baseline: `963fe634a808402d05a8c4ed4767ea9568ff5d45`, branch `feature/lidar-import-progress`. Refresh code and beads before implementation; do not assume that baseline remains current.

| Existing bead | Relationship |
| --- | --- |
| `canopi-j571` | LiDAR umbrella; preserve delivered imports, library, slope and display functionality. |
| `canopi-cldf`, `canopi-da4f`, `canopi-gkd7` | Delivered foundation repairs and progress; retain their regressions. |
| `canopi-4kar`, `canopi-jv8a` | Library/partial-coverage work in progress; coordinate contracts without taking over their scope. |
| `canopi-j8mp` | Existing Layers/Design integration work; put shared stacking acceptance here or transfer it explicitly to a child of this epic, never duplicate ownership. |
| `canopi-kqpp` | Raster/drone-scale and packaged-engine qualification; share combined-load evidence. |
| `canopi-5neg` | Analysis breadth; independent of camera replacement. |

Do not recreate draft beads during planning. When the user starts implementation, create a fresh epic and only the next executable child slices, with dependencies and concrete acceptance criteria. Do not reproduce the deleted work breakdown automatically. Claim before coding. These sections specify outcomes rather than track status. Preserve the integrated LiDAR baseline in the delivered checkout; do not start from a main branch missing accepted fixes. Follow repository branch, rebase, testing and handoff rules. The accepted Sol-led delegation workflow is described in section 9; only launch workers for bounded tasks within an authorized implementation session.

Record an ADR for the accepted always-anchored domain and intended single-camera architecture, marked as planned until shipped. At the rendering checkpoint, record the chosen adapter and evidence. Update operating guides when behavior actually changes, not merely because this plan proposes it.

## 3. Fixed domain and document contracts

### Spatial frame

Author one v2 spatial frame in the shared Rust/TypeScript Design contract:

| Field | Meaning |
| --- | --- |
| Anchor longitude/latitude | Finite WGS84 degrees; named fields, never an ambiguous coordinate tuple. |
| Orientation | One canonical north-bearing convention, retaining current local-axis semantics. |
| Placement status | `provisional` or `confirmed`; separate from layer visibility. |
| Format version | Explicit v2 document admission discriminator, distinct from application semver. |

Use one authored spatial structure; replace the old nullable location/bearing authority rather than adding a second anchor beside it. Retain useful authored site metadata in a clearly defined location metadata field, without duplicating coordinates. Specify field names in the ADR and generate contracts through the existing codegen.

For new Designs, use a documented deterministic provisional anchor, for example latitude 23° N, longitude 13° E, orientation 0°. Store it in the Design; changing future defaults must not relocate saved Designs. Start all geographic background contributions hidden. The default is a computational origin, not a real site claim.

Validate supported Mercator latitude limits and finite coordinates at admission. Keep interactive projection planar Mercator, pitch 0 and existing orientation semantics. Do not introduce globe, tilt or free map rotation. Local metres are Canopi's existing qualified local projection, not a survey-accuracy guarantee over unlimited extents. Preserve the current extent policy and qualify it against independent control points.

### Coordinate discipline

Keep distinct types for local Design points/metres, WGS84 coordinates/bounds, projected raster coordinates with CRS, normalized map coordinates and CSS-pixel screen positions. Do not reuse anonymous numeric arrays across these boundaries without conversion and validation.

Extend the existing dependency-free `canvas/projection.ts` rather than creating competing math. Specify units, axis order, signs and round-trip tolerances. Keep original raster CRS and vertical reference separate from display coordinates. Keep small local GPU coordinates or camera-relative coordinates; do not upload large geographic metre coordinates as naive float32 geometry.

SceneStore remains authority for local plants, zones, annotations, guides, groups and locks. The Design layer owns the spatial frame. Rendering and map sources own neither. Derived caches may use stable IDs/revisions; avoid serialized duplicates of authoritative geometry.

### Placement versus navigation

| Action | Required behavior |
| --- | --- |
| Pan, zoom, view coverage, return | Camera only. No spatial-frame edit or Design relocation. |
| Set actual site | Explicit Design Edit changes anchor/orientation/status; local object geometry and dimensions stay unchanged, so their geographic placement changes intentionally. |
| Hide/show geographic layers | Presentation only; does not confirm placement or alter coordinates. |
| Import georeferenced TIFF | Keeps its actual georeferencing; does not place the Design automatically. |
| Analyze a TIFF in a provisional Design | Allowed when raster inputs independently satisfy analysis requirements. |
| Evaluate plants/zones against site-specific data | Requires confirmed placement and compatible spatial inputs. |

Setting the site must support preview/cancel and an undoable committed operation through existing document edit/history coordination. Define undo ordering with scene edits; do not introduce a disconnected Location-only history stack. Guard against saving/replacement during partially applied placement transitions using existing settlement seams.

The Location editor presents one action to the right of search. It says **Confirm location** while the Design's committed placement is provisional and **Move design here** after confirmation. Search results and map clicks create a reversible candidate; the action commits that candidate, or the current map center when no candidate is pending. Escape, unmount and Design replacement cancel a pending preview. Disable the action unless it would produce a valid placement change. Do not expose a separate reset-to-provisional action.

Placement changes invalidate projected scene features and Design-dependent spatial results. Source-only raster analyses remain reusable. Never move a geographic TIFF because the Design origin moved. Preserve apparent local layout when changing the anchor by deriving the new camera from the previous local viewport.

Coordinate-frame rebasing that preserves geographic object positions is a different advanced operation and is **deferred**. Do not overload the ordinary site picker with it.

### v2 admission and persistence

New/create/template/duplicate/open/autosave/save paths must all produce the same non-null spatial contract. Remove obsolete optional-location branches from the v2 runtime. Round-trip the v2 contract in Desktop and Web without adding Web Location editing or desktop LiDAR processing.

Unsupported old formats must fail explicitly without partially replacing the active Design. Do not silently assign a Sahara site to a legacy file and claim successful conversion. A private development-only fixture conversion is permitted; it is not a shipping compatibility layer.

Do not reset the user's LiDAR catalogue or settings as a shortcut. Unchanged formats can continue to work normally; if a persistent store must break, version its path/schema explicitly and leave existing data untouched. No old-store migration is required by this epic.

## 4. Target runtime architecture

### One camera authority

Expose one workspace navigation command surface and one immutable frame read surface. Reuse current role-shaped Canvas Runtime surfaces; do not add a general-purpose GIS facade.

In the map-backed implementation, MapLibre owns the live camera. Navigation commands resolve into that owner. Publish a read-only frame containing revision, CSS dimensions/DPR, local viewport conversion and current transform for consumers. The published snapshot is derived observation, not a second writable camera.

Refactor `CameraController` and its callers so they cannot compete with the active map-backed owner. A no-map fallback may own its camera only while active, with an explicit one-time state handoff. Never install two-way camera synchronization or keep both owners active.

Read the map's current frame for shared rendering. Interaction overlays must follow live movement, not just `moveend`. Save transient viewport preferences at an appropriate settled cadence separately from per-frame presentation. Suppress no-op feedback without camera movement deadbands.

All navigation enters the same command role: pointer pan, wheel/pinch, zoom controls, fit Design, coverage navigation, saved viewport restoration and return. Remove `pendingLidarBounds` as a persistent map-only override. A return bookmark captures the previous viewport and session identity; discard it on Design replacement.

### Input arbitration

Assign each pointer sequence exactly one owner at gesture start: navigation or a Canopi tool. Preserve existing mouse/keyboard/touch conventions. Object drag, placement, zone editing, guides and selection must not also pan the map. Escape, pointer capture loss, tool change and disposal must cancel cleanly and restore navigation.

Use one frame's screen/local conversion for picking, snapping, drag deltas and overlays. Keep existing geometry/lock/group semantics in runtime tools; MapLibre must not directly mutate plants or zones. Initially retain established hit-testing interfaces; optimize their internals only with evidence.

### Shared rendering lifecycle

Build a map custom-layer adapter for Canopi scene drawing. The map owns the graphics context, frame scheduling and presentation. The adapter owns only its graphics resources and scene subscriptions. Scene edits request repaint; they must not run a second independent application ticker or clear the map framebuffer.

First determine whether the installed Pixi version supports this integration safely. Prove graphics-state interoperability, blending, clipping, DPR, resize and context restoration with real map layers. If Pixi integration is unsuitable, evaluate a focused batched renderer behind the existing scene-rendering interface. Do not replace Canopi's editor with Geoman, and do not assume a circle-only demo establishes botanical equivalence.

Reuse renderer-neutral layout/geometry/symbol semantics. Prefer stable render data and changed-object updates over whole-scene serialization. No DOM element or MapLibre style layer per plant.

Required back-to-front order:

`basemap → ordered LiDAR sources/results → geographic reference overlays → grid → Design objects → interaction chrome`

Preserve existing Design-internal layer order. Geographic reference overlays must remain below grid and Design objects. Enforce ordering through a semantic ordered stack, including explicit moves and reconstruction after style reload; replace hard-coded lists of possible insertion anchors. Source and analysis visibility remain independent.

DOM chrome can remain DOM where useful, but must consume the same frame. PDF and inspection surfaces remain renderer-neutral derived consumers and must not require the interactive map or network. Do not add map backgrounds to PDF scope.

### Lifetime and fallback

Keep MapLibre construction and API imports inside low-level `maplibre/` modules and its Surface Adapter. Compose app/domain inputs in `app/canvas-map-surface/`; do not let low-level map code import document stores.

One workspace lifecycle owner creates/disposes map, custom scene layers, subscriptions, observers, gestures, frame requests and async cancellation. Style reload must recreate graphics resources without losing Scene state. Reject stale async results after session replacement. Handle context loss/restoration and HMR explicitly.

A hidden-background Design uses an empty local style: no hidden tiles, terrain, geocoding or other remote lookups. Rendering a blank workspace may still initialize graphics; it must not require a successful external request.

Retain a Canvas2D-based editing fallback for missing/failed WebGL, fed by the same domain and interaction seams. Passive LiDAR failure stays silent and does not prevent editing; explicit import/analysis failures retain direct feedback. A failed primary renderer must not leave a frozen map behind moving objects. Omit unusable geographic contributions, transfer camera ownership once and preserve the spatial frame. Retry must be explicit or bounded, never a renderer restart loop.

## 5. Representative fixture and evidence protocol

Primary private file discovered read-only:
`/home/daylon/Downloads/Design verger syntropique v3.canopi`.

SHA-256 at planning time:
`446c656e12eca21ddf5c03e79cd1f8d7862eae88626c4cb550d55b505d246f40`.

Measured JSON counts: **2,201 plants, 24 zones, 106 annotations, 134 measurement guides, 8 layers**, plus 2 guides, 124 consortiums and 117 budget entries. These differ from older performance-report fixtures. Do not copy old timings or object counts into new evidence.

Read this file into an isolated profile or convert a temporary copy to v2 for testing. Never save over the original. Verify the hash before and after. Keep fixture content, screenshots, names and absolute paths out of committed benchmark artifacts. The local path in this handoff is for discovery; do not hard-code it into code.

A development-only conversion must preserve IDs, positions, geometry, layers, metadata and appearance, while supplying the v2 spatial frame explicitly. Preserve a known real anchor if present; never fabricate overlap with IGN. When actual coverage is elsewhere, exercise navigation to it separately. Use a clearly identified temporary placement experiment or a synthetic georeferenced raster for coincident alignment tests, without misrepresenting real geography.

If the file is unavailable or its counts/hash differ, report that exact fixture limitation; do not substitute the old 2,200-plant generator and call it the same representative Design.

Use the real 2,201-plant Design for:
- Matched current-versus-candidate rendering and interaction.
- Detailed botanical appearance, layer behavior, labels, hit testing, drawing, undo and export comparison.
- Native pan/zoom and map/LiDAR alignment evidence.

Use a deterministic **10,000-plant derivative** only for capacity qualification. Repeat representative species/symbol distributions into a temporary in-memory scene, allocate unique IDs and handle relational references correctly. Include dispersed and dense all-visible layouts. Label it synthetic; never infer scientific geography from replicated plants. A 25,000-plant run is optional headroom, not a replacement fixture or release requirement.

Small synthetic fixtures belong in automated CI for coordinate, rendering, selection and persistence regressions. A reproducible generator may be committed; the user's Design may not.

## 6. Phased implementation and acceptance

### Phase A — contracts, baseline and decision record

Start with the GeoLibre reuse inventory in section 9, then create the ADR and immediately executable child beads; record actual integrated baseline and supported hardware. Capture representative behavior with existing [performance tools](../agent/canvas-performance.md), then extend measurement to the combined workspace. Keep later-phase interfaces provisional until the rendering checkpoint succeeds.

Specify v2 fields, default anchor, validation, placement/undo semantics, UI copy and format rejection. Inspect actual Location/Layers components and UI gallery before changing them. Keep styling and 11-language localization consistent.

Exit: fixture receipt, matched scenario scripts, current timings with limits, approved contract recorded in the ADR and implementable child beads. The reported incident has a regression scenario; its cause remains unclaimed unless independently reproduced and verified.

### Phase B — bounded rendering feasibility checkpoint

Use the temporary converted representative fixture and existing domain runtime behind an isolated development entry. Implement map-owned navigation and a custom scene layer for plants, zones, grid and selection; exercise representative botanical detail and labels early.

Verify resource sharing, frame alignment, resize, reference/LiDAR stacking, click/drag arbitration and teardown. Compare against the existing renderer under identical conditions. Verify offline empty style.

Exit: runnable prototype, pinned adapter/API choice, visual comparisons, alignment and performance evidence. Do not advance on a plain-point demo. If shared-context Pixi fails, the same child bead may test the focused renderer alternative; file separately scoped work for a substantial new renderer. If neither candidate meets correctness/resource requirements, leave production architecture intact and report the specific failed criterion. Do not silently substitute camera reversal plus another unsynchronized canvas.

### Phase C — v2 domain and persistence

Implement the authored spatial frame and versioned admission in shared types, Rust and frontend. Regenerate outputs. Update create/template/duplicate/save/open/autosave and both edition adapters. Add explicit provisional-site presentation and placement confirmation in the existing Desktop Location workflow.

Exit: no nullable frame in admitted v2 Designs, zero hidden-source requests for a new Design, unsupported documents rejected without losing the active session, placement preview/cancel/undo correct, round-trip through Desktop and Web. No shipping legacy converter.

### Phase D — production navigation, tools and lifetime

Integrate the qualified rendering adapter through the existing runtime composition. Migrate each gesture and navigation action to the single owner; expose frame observation through the query role. Update coverage/return, interactive overlays, resize and Design replacement. Finish annotations, guides, groups, species styling, labels and all drawing tools before default activation.

Exit: representative Design retains all editing behavior, camera navigation never relocates data, no camera feedback loop, stale frame or listener/resource leak across repeated replacement and style reload. Native fallback preserves editing. No production path simultaneously runs old and new interactive renderers.

### Phase E — layer integration and capacity qualification

Implement explicit source/result/reference ordering and paint/data distinction. Qualify source-hidden/result-visible behavior, local asset loading and simultaneous import/analysis.

Retain the accepted `canopi-ltck.26` bounded geometry/cache improvements. Do not
start another renderer optimization slice in this epic: forced Pixi batching and
an atlas/particle candidate were evaluated and rejected in `canopi-ltck.27`.
Preserve meaningful botanical styling and the exact editing model; do not trade
them for clustering, symbol quantization or a speculative renderer rewrite.
Continue measuring known costs so regressions and product limits remain visible.

Exit: the real fixture passes every correctness, editing, ordering, fallback and
lifecycle gate. The synthetic 10,000-Plant cases load and preserve exact data,
complete the same functional interactions without crashes or leaks, and are
removed after qualification. Their responsiveness and the representative
fixture's known frame-time misses are reported as limitations, not exit blockers.
CPU scene work, map/GPU work and raster processing costs remain reported
separately without claiming unmeasured native/GPU performance.

### Phase F — removal and v2 release qualification

Remove superseded map-following camera code, obsolete location-null logic, map-only fit overrides, retired prototype entry points and replaced tests. Preserve meaningful assertions at the new interfaces. Keep only the selected primary renderer plus required fallback/export adapters.

Update AGENTS/subsystem guides, CONTEXT and ADR status; reconcile conflicting LiDAR-plan navigation text. Apply v2.0.0 package/release metadata through the existing release workflow after integration, not as an isolated early version bump.

Exit: complete native/edition qualification, documented platform and performance
limits, no unclaimed failed correctness gate, no permanent legacy architecture
toggle, and no runtime dependency on private fixtures. Commit and push the scoped
integrated implementation branch per repository instructions; publishing a
release is separate authorization.

## 7. Test and performance gates

### Required correctness scenarios

| Area | Evidence required |
| --- | --- |
| Spatial math | Independent geographic control points, axis order/units, orientation, screen round-trip, near-extent boundaries, DPR 1/2. Do not derive expected values with the same helper being tested. |
| Alignment | Same control point in scene and map remains aligned during pan/zoom, not only after settling; include coverage navigation then drag, resize and style reload. Target maximum 1 CSS pixel, measured from actual rendered output. |
| Representative Design | Plant/zone/guide/annotation counts, IDs and geometry preserved; appearance comparisons at overview and detail; selection, locks, groups, species styles and history remain correct. |
| Placement | Provisional capabilities, site confirmation, cancel/undo, no camera-induced relocation, no moving geographic rasters, no source-only analysis invalidation. |
| Layers | Full-opacity LiDAR behind grid/objects, references screen-locked, reorder/late insertion, analysis visible with source hidden, no source reload for opacity-only changes. |
| Persistence | v2 create/open/save/autosave/restart, failed admission preserves current Design, Web round-trip, resource teardown on replacement. |
| Graphics lifecycle | Context loss/restoration, empty/offline style, fallback, repeated mount/unmount, stale async completion, no listener/ticker duplication. |
| Scientific boundary | Existing LiDAR numerical/mask/publication regressions unchanged. Rendering must not alter analysis inputs or depend on camera bounds. |

The 1-pixel target measures correspondence between renderers, not ground-truth survey accuracy. Separate georeferencing errors from visual alignment.

### Performance protocol

Run the real 2,201-plant Design first; compare baseline/candidate serially on identical native hardware, dimensions, DPR, warmup, input replay and data. Include map-off/empty-style, basemap-only, and basemap plus source plus analysis. Test warm/cold tiles and concurrent processing. Then run the synthetic 10,000-plant capacity case.

Record p50/p95/p99 frame intervals, stalls, input-to-visible feedback when measurable, CPU submission time, GPU timing when available, geometry rebuild/upload counts, full-scene reads, memory/texture growth and tile readiness. Never call synchronous submission time GPU frame time; browser software rendering is not native hardware qualification.

Reference-hardware diagnostic targets: smooth 60 Hz navigation (p95 presented-frame intervals near 16.7 ms), p95 input-to-visible feedback below 50 ms, and no sustained stalls above 100 ms. Record exact hardware and measurement method before comparing; keep the targets stable so future measurements remain comparable. A miss must be reported with its practical limitation, but does not block v2.0.0 when the required correctness and lifecycle scenarios pass. Native performance proxies are useful but cannot certify these targets alone. Qualify lower-end/fallback hardware separately and report its observed envelope.

The representative fixture must meet correctness regardless of speed and must
not introduce an unexplained material regression beyond repeated-run noise in
edit latency or memory. A measured regression is acceptable only when attributed,
documented as a product limit and reviewed against the correctness-first decision.
The capacity fixture establishes functional 10,000-Plant integrity and lifecycle
support; it does not establish smooth 10,000-Plant interaction.

### Repository gates

Run the current AGENTS gate matrix, including for this mixed architecture work:

From `desktop/web`: `npx tsc --noEmit`, focused Vitest while editing, full `npm test`, `npm run check:ui`, `npm run build`, `npm run build:web`. Shared contract edits require `npm run gen:types` and `npm run check:types`.

From root: `cargo fmt --all -- --check`, `CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace`, `CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings`, and `CANOPI_SKIP_BUNDLED_DB=1 cargo test --workspace`. Native command/executor changes also require the native command policy test.

Inspect actual light/dark UI, French long strings, narrow dock, keyboard and pointer behavior. Qualify Desktop Linux/macOS/Windows and Web according to supported release capabilities; mark unavailable platform evidence explicitly. Rerun affected gates after integration/rebase. Do not weaken architecture tests to admit new ownership: replace obsolete rules with the explicit new ADR and equivalent stronger assertions.

## 8. Sources, handoff and completion

Implementation starting points (frontend paths below are relative to `desktop/web/src/` unless explicitly rooted):

- `common-types/src/design.rs`: authored document contract.
- `canvas/projection.ts`, `canvas/maplibre-camera.ts`, `canvas/runtime/camera.ts`: current transforms/camera.
- `canvas/runtime/scene-runtime/construction.ts`, `render-scheduler.ts`, `renderers/`: runtime composition/rendering.
- `canvas/runtime/scene-interaction.ts`, `interaction/`: tools and gesture ownership.
- `app/canvas-map-surface/`, `maplibre/host.ts`, `maplibre/surface-adapter.ts`: map presentation/lifetime.
- `app/design-edit/`, `app/document-session/`, `app/location/`: frame edits and persistence.
- `app/lidar/`, `desktop/src/services/lidar/`: existing independent library/analysis boundaries.

Verify paths and APIs before editing. MapLibre's [custom-layer contract](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/) supports rendering in the map GL context and camera, with lifecycle/context-restoration responsibilities. Check the installed version's actual types; do not paste older callback signatures. Its [large-data guide](https://maplibre.org/maplibre-gl-js/docs/guides/large-data/) supplies techniques, not performance guarantees.

GeoLibre reviewed at [d3fca7b8](https://github.com/opengeos/GeoLibre/tree/d3fca7b8f250e3a337d9a29de261d85420935106). Useful references are its map layer reconciliation, geometry-edit ownership and processing interfaces; its React/Zustand/plugin stack is not the target.

Each implementation bead handoff must name code changes, acceptance evidence, commands/results, fixture hash, actual renderer/hardware, outstanding limits, agent-doc changes, commit/branch and preserved user files. Close only completed correctness and integration work. Record incomplete platform evidence and performance misses as explicit limits; do not reopen renderer optimization within this epic unless a correctness defect requires it.

Historical planning validation: the fixture was initially read only for aggregate
counts/hash. Subsequent diagnostics, benchmarks and implementation evidence are
recorded in the active epic and its closed children. This handoff still does not
by itself establish that v2 has shipped, and release publication remains outside
the epic.
