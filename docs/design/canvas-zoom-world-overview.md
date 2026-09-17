# Canvas zoom 27 and single-world overview

Status: completed.
Tracking: `canopi-85wo` (implementation), `canopi-a5tj` (qualification).
Current guidance: [Canvas rendering](../agent/canvas-rendering.md), [MapLibre](../agent/maplibre.md), [Canvas performance](../agent/canvas-performance.md).

Historical implementation and qualification contract. Both beads are closed with exact-fixture browser evidence and available Linux native evidence. The original gates below are retained as history; the 2026-09-17 user decision accepts measured performance misses and unavailable platform coverage as limitations, and defers optimization until user reports warrant it. They do not direct a new qualification or optimization pass.

Prepared and implemented 2026-09-16. This record describes the delivered behavior and retains the original qualification contract and known release-evidence gaps.

## 1. Mandate and fixed decisions

Repair the continued-zoom-becomes-pan bug, let users reach **MapLibre zoom 27**, and let them zoom out to a geographic world overview in both Desktop and Web editions. The latest user choice is **one world**, superseding the earlier request for horizontal repetition. Evaluate the requested GeoLibre backend for reuse where relevant; section 8 records that assessment.

The configured workspace zoom range is **0–27**. MapLibre's geographic and viewport constraints can make its effective minimum higher than 0. Accept that native constraint instead of promising zoom 0 at every window size. One-world presentation uses `renderWorldCopies: false`, retains the Design north bearing, and does not introduce globe projection or map rotation controls. At wide aspect ratios the default constraint can crop some world latitude; the requirement is a geographically broad overview with no repeated worlds, not a pixel-identical copy of the supplied image.

Preserve all existing site editing at scales **at or above 0.1 CSS px per local Design metre**. Below 0.1, use **overview mode**: navigation, a Design marker, and return navigation replace detailed spatial editing. This threshold deliberately preserves the previously reachable editing range. It is a derived presentation state, not a saved mode or toolbar preference. No hysteresis: exactly 0.1 remains site mode.

Success means repeated outward zoom at either effective limit changes neither centre nor scale, zoom 27 remains aligned and editable, overview cannot accidentally alter Design geometry, and returning restores usable site editing without corrupting history or placement.

No database, `.canopi` version, native service, basemap provider, tile-source maximum, or library-version change is required. Preserve the existing 100% reference of 20 CSS px/m, wheel response, Shift-only pan, Ctrl/Meta precedence, default framing, Design replacement, and coordinated history. No schedule or resource budget was imposed. Physical two-contact pinch remains outside this work's existing qualification; do not claim newly supported gestures.

## 2. Inspected baseline and corrections

Implementation baseline: `0cb48bb3633508e888d03b1ffd480b0b0ca83490`. Delivered camera contracts and measured limits remain relevant; checkout-specific planning instructions are retired.

Inspected authorities: `AGENTS.md`, `CONTEXT.md`, `docs/README.md`, `docs/agents/issue-tracker.md`, Canvas/MapLibre/edition/performance guides, the interface contract and canvas-workspace family guide, ADR 0025, existing GeoLibre inventory, and production capacity evidence. Inspected `bd ready`, zoom-related closed work, especially `canopi-ag6z` (1000 px/m precision ceiling) and `canopi-ojtj` (wheel behavior and integration preservation). Their useful behavior survives except where this plan explicitly replaces numeric limits.

Installed dependencies are MapLibre GL JS **6.4.1** and Pixi **8.17.1**. The installed MapLibre source, rather than a newer online version, governs implementation. The [current MapOptions reference](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/) was consulted; verify options against installed types when implementing.

Evidence and limitations:

- `canvas/runtime/camera.ts` clamps scale to 0.1–1000 in navigation, fitting, and frame publication. World view is therefore blocked even if map construction is changed.
- `canvas/maplibre-camera.ts#createMapFrame` permits map zoom 0–30 but calculates the centre from the requested local viewport before that clamp.
- **The active constructor is `maplibre/workspace-map.ts#createWorkspaceMapLibreMap`**, called by `WorkspaceMapControls`. It omits `minZoom` and `maxZoom`. The earlier diagnostic named `canvas-basemap.ts`; that is not the production constructor to fix.
- Installed MapLibre `src/ui/map.ts` defaults to maximum 22. Its constructor and `setMaxZoom` accept higher maxima without enforcing 24. Comments advertising 0–24 are not a guarantee that zoom 27 is qualified for Canopi.
- MapLibre's Mercator camera helper applies zoom and centre separately. The earlier source-and-math harness reproduced a requested zoom 22.346 with changed centre, applied at zoom 22: the reported pan mechanism. This was not a full real-browser reproduction. Add that before fixing.
- The earlier focused camera/interaction run passed 330 tests. The workspace fake records `jumpTo` without realistic constraints, so that result does not protect this bug.
- `workspace-map.ts` creates a local empty-style shell. `workspace-map-controls.ts#applyBasemapPresentation` admits remote basemap sources only for confirmed placement. Some operating prose still implies no map shell exists before confirmation; preserve actual source admission and repair that stale prose during implementation.
- Installed `MercatorTransform.defaultConstrain` adjusts zoom for viewport/world bounds and centre for geographic limits. Disabling world copies constrains longitude as well as latitude. Merely clamping a requested scalar to 0 is insufficient.
- `scene-camera-transform.ts` samples projected one-metre axes; both the camera owner and shared custom layer use it. Both must agree over the enlarged range. Do not silently loosen the one-CSS-pixel residual guard.
- Plant/annotation geometry and some renderer strokes have 0.001 scale floors. Grid/ruler distances end at 1 km; rulers can enumerate excessive ticks at world scale. `ZoomControls` rounds small positive scales to 0%.

No zoom-27 browser/GPU, world overview, native platform, or private-fixture qualification was performed during planning. Those are executable gates below, not claims of support.

## 3. Camera contract and limits

Keep one `WorkspaceCameraOwner`, one immutable published frame signal, and the existing read/navigation roles. Add a small renderer-neutral camera-policy value to the owner, supplied from the current generation's Spatial Frame even if MapLibre fails before attaching. It owns zoom bounds and reference latitude; it is transient, not Scene or document data. Extend the published frame with the resolved scale bounds needed for navigation availability. Derive overview/site mode from that frame rather than creating a mirrored writable signal.

Use `mapZoomToStageScale` and `stageScaleToMapZoom` from `canvas/projection.ts` for all conversions. The upper local scale is the exact conversion of zoom 27 at the Design anchor latitude; the old 1000 px/m ceiling must not truncate it. The lower local scale derives from the effective minimum. Unlocated/provisional Designs still have an authored anchor; never fabricate a different geographic anchor from camera movement. Standalone runtime fixtures without a Spatial Frame use an explicit equatorial policy in construction.

Introduce one shared policy module under `canvas/` (proposed `workspace-camera-policy.ts`) for configured bounds, scale conversion policy, and overview threshold. Map construction consumes those constants, owner navigation consumes resolved limits, and chrome consumes frame-derived availability. No duplicate numeric clamps in component handlers. Validate finite screen metrics, centre, scale, anchor and zoom factor; reject invalid navigation without publication, map calls, or changing an active Design.

For zoom, determine the **achievable target scale before computing pointer-anchor compensation**. Bound the target against the current map/viewport constraints; if scale cannot change in the requested direction, return the identical frame before calling MapLibre. Apply centre and scale atomically, then publish actual map projection. An unchanged scale must not produce centre-only motion from a zoom intent. Geographic centre clamping is allowed while zoom genuinely changes at a pole/world edge; it must settle without feedback oscillation.

The effective-minimum calculation belongs in the map camera adapter and must be qualified against the installed real map at Phase 1. Use public map state/APIs, never private `_camera` or transform mutation. With a north-up default Mercator world and no copies it is approximately `max(0, log2(max(width,height)/512))`; do not hard-code that approximation as proof for rotated views, resizing, and geographic bounds. Retain any discovered constrained boundary only as owner-local state invalidated by resize, placement/bearing change, attachment, or policy replacement. Do not add general projection deadbands that suppress legitimate tiny navigation.

Frame publication validates rather than independently clamping scale after x/y were derived. `fitCameraViewport`, `fitTemporaryBoundsViewport`, initialization and return navigation consume the same policy. The camera owner and `shared-scene-layer.ts` continue using one projection derivation; do not allow renderer scale to differ from published scale. If one-metre sampling is numerically unstable at 27, qualify a larger/adaptive sampling baseline or exact Mercator derivation against real projected points while retaining the residual guarantee. This is a bounded prerequisite, not permission to weaken the guard or silently reduce the requested maximum.

Configure `createWorkspaceMapLibreMap` with the shared min/max, `renderWorldCopies: false`, and existing `interactive: false`. Extend `MapLibreMapConstructorOptions` and the narrow workspace map interface only for public operations actually needed. MapLibre source zoom 19 remains unchanged: closer viewing magnifies existing imagery; it adds no geographic detail.

## 4. Overview behavior

### Presentation and recovery

Below 0.1 px/m, suppress detailed Scene drawing and spatial hit testing: Plants, Zones, annotations, guides, selection/hover outlines, names, badges, transform handles, and placement ghosts. Keep Scene entities, selection, Layer settings, pinning, species focus, and history intact. Suppression must short-circuit detail layout and per-object render work, not merely hide a DOM element after that work. On re-entry, redraw from the latest authoritative snapshot so edits made in panels or history while in overview are visible.

Keep admitted basemap/LiDAR/terrain contributions visible according to their existing visibility, zoom and failure policies. Suppress panel Target interaction overlays during overview through contribution presentation, without changing Target or Layer authority. Do not rebuild map sources or create a second renderer when crossing the threshold. No contour-generation or raster-analysis changes are authorized.

Show one screen-sized, ochre, labelled Design marker at local origin `(0,0)` for a confirmed Design. Marker activation calls the same **Return to Design** action as a keyboard-accessible button in the overview notice. Omit an offscreen marker rather than pinning it to an incorrect edge location; the notice action remains reachable. The marker is a view affordance, not a Plant, selectable Scene object, movable location pin, or serialized entity. At most one marker exists. Reuse current overlay slots/tokens and localized strings.

For provisional placement, render a local Design-origin affordance with provisional wording and no claim of confirmed geography. Keep remote source admission unchanged. Hidden basemap and offline/fallback cases retain this local navigation affordance; they do not enable network sources as a side effect of zooming out.

Return to Design fits the latest visible content using the existing fit policy when that produces a site-scale view. If the Scene is empty, fit would remain below 0.1, or the fit is invalid, centre on `(0,0)` at the existing 100-metre initial-framing scale, clamped to legal site limits. It changes only the camera. Preserve the existing Fit to content command's fit semantics for large Designs; do not silently crop a legitimate full-content fit merely to exit overview. Return is a separate role-shaped viewport command, shared by marker and notice. Keep LiDAR's first-pre-focus bookmark and Return behavior independent.

### Input and command admission

In overview, wheel zoom, modified wheel zoom, Shift pan, middle-button/Space/Hand pan, zoom buttons/shortcuts, Return to Design and Fit to content remain available. Primary-button drag also pans in overview regardless of armed creation tool. Restore the previously selected tool on returning to site scale, but do not restore a cancelled draft or automatically place anything.

On entering overview, abort existing transient drawing, drag, polygon draft, stamp preview and annotation editor through the existing Scene Interaction cancellation/settlement path. Preserve committed content and prior selection. Fence the pointer before releasing capture so late pointer-up cannot commit; retain the existing retry/quarantine behavior if cleanup or settlement fails. Apply this transition for external camera publication, toolbar actions, resize and temporary focus, not just wheel events. Navigation must not bypass a quarantined authoritative edit.

Block spatial creation/transformation at runtime admission as well as in UI: pointer creation/selection-band, ruler-guide creation, drag/drop, paste/pasteAt, duplicate, delete/cut, nudge, rotation, reshape, grouping/ungrouping, and stamp/spacing commits. Retained handlers and keyboard/context-menu entry points must re-read eligibility. Disabled requests report the short localized reason “Zoom in to edit” where the existing command feedback supports it. Read-only Copy, panel reads, saving/exporting, undo/redo, layer visibility and non-spatial panel edits remain available under existing authority. Undo/redo can change content but never the navigation history; do not add overview to undo.

Tool selection may remain armed; creation controls advertise their unavailable spatial action in overview. No extra mouse/touch owner is introduced. Escape cancels outstanding interaction, never confirms placement. Native scrolling inside text fields/owned overlays and browser page zoom suppression retain existing behavior. Inspection Lens and PDF views keep their independent camera/presentation; the main workspace overview must not suppress printable objects or the lens's readable inspection content.

### Chrome and accessibility

Suppress local rulers, grid, ruler-created guides and snapping overlays during overview without modifying saved/settings toggles. Restore them on site re-entry. Also abort a ruler drag on transition and restore its cursor/listeners through its lifecycle owner.

The scale bar remains useful: replace the finite 1-km candidate ceiling with bounded 1/2/5 powers-of-ten selection. Use local Design metres in site mode. In confirmed map overview use ground resolution at the geographic viewport centre and label km appropriately; a fixed anchor-latitude local scale must not imply accurate geographic distances far from the site. Hide the geographic scale bar for provisional or map-unavailable overview. No O(world-distance) tick loops: bound scale calculations and any tick enumeration by screen size.

Keep the existing percentage reference; display localized “Overview” below the threshold instead of 0%. At site scale use sufficient fractional precision below 1% (0.1 px/m is 0.5%), retaining ordinary integer percentages at or above 1%. Disable zoom-in/out at effective limits and expose labelled keyboard controls. The overview notice says “Zoom in to edit” with Return to Design. Markers/notices use existing focus and contrast patterns, remain usable in narrow windows, and do not steal focus on every frame. Batch all new keys across the 11 locale files.

## 5. Single world, lifecycle, and fallback

Preserve bearing-aware local Mercator geometry and one world. Geographic edges constrain navigation rather than wrapping the Design into another copy. Test anchors near both sides of the antimeridian and at high latitudes. Existing coordinates outside the visible canonical world remain authored data; do not wrap, split, relocate or “repair” Scene geometry on navigation. Return and zoom may be edge-constrained, but visible local objects and map projection must still agree.

The current composition/activation coordinator continues owning setup, generation fencing, custom layer lifetime and terminal renderer fallback. Supply the camera's generation policy before initialization/attachment, including pre-attachment failure; publish policy/frame changes atomically. Confirming/moving placement can change anchor-relative limits, but camera navigation never writes Spatial Frame or confirms placement. Rejected pre-hydration replacement retains the old frame/policy/bookmark; successful replacement replaces policy and clears old return state. Disposal removes all new frame subscriptions and marker/notice resources.

Canvas2D inherits the last accepted frame **and the matching scale policy**, including below 0.1 or above 1000. It must not clamp back to the legacy range or jump. At world scale fallback shows local overview affordances and existing map-unavailable feedback, supports Return and zoom, and becomes the normal editable Canvas2D surface on site re-entry. It does not claim to render a geographic basemap. Do not auto-retry the terminal shared backend merely because zoom changes.

Generation-bound marker metadata comes through an app-owned adapter/read surface, not imports of document stores inside canvas runtime. Marker lifecycle has one explicit owner; crossing a mode threshold changes presentation, not resource ownership. Browser and Desktop mount that shared behavior. Layer/source failure, context loss, asynchronous metadata completion, document replacement and teardown retain existing fencing. Preserve Tile/HTTP admission, CSP, privacy, logs, and offline policy; no new requests or data uploads beyond existing map navigation.

## 6. Implementation seams and regression coverage

All paths below are under `desktop/web/src/` unless otherwise stated. This is the original change map; verify symbols against current code before editing.

| Existing seam | Reuse/adaptation and owner | Evidence to retain/extend |
| --- | --- | --- |
| `canvas/projection.ts`, `canvas/maplibre-camera.ts` | Reuse canonical conversions; add shared camera policy without new dependency. Remove conflicting clamps. | Projection and map-camera tests, bearing and tiny-change screen lock. |
| `canvas/runtime/camera.ts` | Adapt limits, publication, fit, initial framing and Return through one owner. | Camera-controller fit/bookmark/no-op tests. |
| `maplibre/workspace-camera.ts`, `scene-camera-transform.ts`, `shared-scene-layer.ts` | Adapt effective constraints and range qualification together; keep one projection result contract. | Real map regression plus workspace-camera and shared-transform tests. |
| `maplibre/workspace-map.ts`, `loader.ts` | Configure actual constructor and minimal public types. | Production controls/activation tests, not only old basemap-constructor mocks. |
| `app/canvas-map-surface/workspace-runtime-composition.ts`, activation/reconciliation and contribution modules | Inject generation policy and overview contribution visibility; reuse current lifetime and recovery. | Replacement, source admission, layer ordering, stale callbacks and teardown tests. |
| `canvas/runtime/scene-interaction.ts`, command/query roles, tool adapters, `scene-runtime/effects.ts` | Reuse cancellation and settled-command admission; expose derived navigation/edit eligibility and Return. | Mounted event tests, transactions, drop/paste paths and external-frame transition tests. |
| `canvas/runtime/renderers/viewport-presentation.ts`, Pixi/Canvas2D renderers | Add workspace overview suppression before detail work; preserve latest Scene for restoration and independent lens/PDF rendering. | Renderer work counts together with returned appearance/state. |
| `components/canvas/ZoomControls.tsx`, canvas notice layout, shared command projection and edition adapters | Reuse chrome and narrow role commands for availability, marker and Return; add a small shared overview component if needed. | Both edition compositions, accessibility, translated/narrow/light/dark states. |
| `canvas/rulers.ts`, `grid.ts`, `scale-bar.ts`, scene chrome | Reuse lifecycle, suppress local chrome at overview, bound display math. | Ruler cancellation, no dense tick enumeration, useful scale bars. |
| `scripts/canvas-performance/production-workspace.mjs` and related harness modules | Extend existing real composition harness; never reconstruct production camera in a parallel test implementation. | Aggregate diagnostics, representative and capacity receipts, cleanup checks. |

## 7. Qualification method and evidence

Current commands and quality gates belong in [AGENTS.md](../../AGENTS.md#quality-gates) and the [canvas performance guide](../agent/canvas-performance.md). The following retains the task-specific fixture and measurement protocol.

For real browser evidence, execute the documented runner from `desktop/web/` against a separate local Web server:

```sh
npm exec vite -- --mode web --host 127.0.0.1 --port 1431
```

```sh
CANOPI_PLAYWRIGHT_MODULE=/path/to/existing/playwright \
  node scripts/canvas-performance/production-workspace.mjs \
  --file '/path/to/private-representative-design.canopi' --scenario all --headed
```

Paths are operator-supplied placeholders, not verified fixture locations. Follow `docs/agent/canvas-performance.md` and `docs/agent/edition-development.md` for temporary profiles, ports, hashes and cleanup. Do not install a runtime dependency for qualification. The existing runner's isolated v5-to-v6 preparation is development-only; preserve it without shipping a converter.

Use the documented representative receipt: 2,201 Plants, 24 Zones, 106 annotations, 134 Measurement Guides, eight Layers, two guides, 124 consortiums and 117 budget entries. Locate the private original and verify its accepted receipt/hash before/after; do not assume a filename or alter it. Add deterministic empty, provisional, confirmed, mixed/locked selection, antimeridian and high-latitude cases. Use temporary dense and dispersed 10,000-Plant derivatives only for capacity. Originals and captures remain outside Git and data uploads are prohibited.

Extend real checks through site → world → site → 27 → site, 100 limit inputs, browser wheel/Shift pan, resize at each limit, style reload, map failure, context loss, placement change, replacement rejection/success and disposal. Run at DPR 1 and 2 plus one fractional DPR case. Include maps with geographic contributions and an offline empty style so remote tile readiness is not mistaken for camera readiness. Verify zero remaining owned canvases/listeners on disposal and no late frame publication.

Performance method: compare before/after at the same revision receipt, browser/GPU, dimensions, DPR and input sequence, with ten warm-up navigation samples and 30 measured samples, three serial runs. Record p50/p95/p99 and stalls above 100 ms. Existing 16.7-ms frame and 50-ms feedback references remain diagnostic because the accepted baseline already misses them. A repeatable new site-scale p95 regression over 20% is an investigation gate: explain and resolve the introduced work before closure; do not reclassify it as pre-existing. Overview must bypass per-object detail drawing/layout, emit no ruler ticks, and do bounded marker/scale work; assert these work counts independently of timing. Browser RAF proxies are not native input-to-visible or GPU completion measurements.

Qualify Chromium Web and native Desktop input/rendering on an available supported platform. Record macOS, Windows or WebKit gaps explicitly. A missing platform is not a pass; release qualification remains outstanding there. The receipt below records the available fixture and native checks; remaining platform gaps are explicit.

#### Qualification receipt — 2026-09-17

The follow-up located and verified the accepted private v5 fixture before and after the run: SHA-256 `446c656e12eca21ddf5c03e79cd1f8d7862eae88626c4cb550d55b505d246f40`, 1,113,057 bytes, with the exact documented counts and 2,201 unique non-empty Plant IDs. The production Chromium runner passed its correctness, world-camera, teardown, listener-cleanup and post-disposal checks for representative shared rendering, representative Canvas2D fallback, and dense and dispersed 10,000-Plant derivatives at DPR 1. Representative shared and fallback correctness also passed at DPR 1.5 and 2. The runner now accepts an explicit bounded `--dpr` and clears retained multi-selection through a real empty-canvas pointer gesture before independently qualifying pointer selection and dragging.

At DPR 1, frame-opportunity/input-to-second-RAF p95 values were 116.6/123.7 ms for the representative shared renderer, 50.0/64.1 ms for representative Canvas2D, 66.7/180.0 ms for dense 10,000 Plants, and 1,000.1/2,005.3 ms for dispersed 10,000 Plants. Every scenario therefore missed the diagnostic proxy overall; representative shared and dispersed also recorded sustained stalls. DPR 1.5 and 2 proved DPR-sensitive correctness only: the headed background window was throttled to about 1 Hz, so those timings are not treated as rate evidence. On 2026-09-17 the user accepted these results as non-blocking and deferred optimization until real user reports justify it. High-DPR 10,000-Plant scenarios, three matched serial runs, and a before/after baseline were not pursued. Aggregate-only receipts are kept outside Git under `/tmp/canopi-world-qualification-final-*.json`; fixture contents and captures were not committed.

On Linux Desktop, the actual Tauri/WebKit application passed physical XTest pan, overview-limit no-op, Return, zoom-27-limit no-op, and replacement cleanup through the Canvas2D fallback under isolated X11/DBus state. On the NVIDIA GTX 1080 Ti path, process attribution, WebGL2 rendering, local-to-map alignment (maximum sampled error about `5.6e-8` CSS px), effective world minimum, zoom 27, exhausted-limit identity, Return, and old-map removal passed through the WebKit inspector. Physical shared-GPU input could not be exercised because the real display was locked; the session was not bypassed. macOS and Windows remain unavailable. Temporary v6 fixture copies, profiles, and screenshots were deleted after re-verifying the original receipt.

## 8. Requested GeoLibre reuse assessment

The user supplied `https://github.com/opengeos/GeoLibre/tree/main/backend/geolibre_server`. Resolve moving main to inspected revision **`cf4772e032b6ddc4929d890dd561cd4f9c5643f1`**. The GitHub page fetch failed, so the public GitHub API and pinned raw source were used. Read the backend README and package manifest; inspect the backend file tree, raster endpoint/script declarations and representative raster tests. This is a targeted relevance assessment, not a complete backend audit or execution of its tests.

Pinned sources:

- [Backend README](https://github.com/opengeos/GeoLibre/blob/cf4772e032b6ddc4929d890dd561cd4f9c5643f1/backend/geolibre_server/README.md)
- [Package/dependency manifest](https://github.com/opengeos/GeoLibre/blob/cf4772e032b6ddc4929d890dd561cd4f9c5643f1/backend/geolibre_server/pyproject.toml)
- [Raster processing code](https://github.com/opengeos/GeoLibre/blob/cf4772e032b6ddc4929d890dd561cd4f9c5643f1/backend/geolibre_server/geolibre_server/app/raster.py)
- [Raster tests](https://github.com/opengeos/GeoLibre/blob/cf4772e032b6ddc4929d890dd561cd4f9c5643f1/backend/geolibre_server/tests/test_raster.py)

| Candidate | Dependencies/cost | Decision for this work |
| --- | --- | --- |
| Optional processing service and runtime bootstrap | Python, FastAPI/Uvicorn; optional raster/vector/SQL environments and process lifetime | Do not import/start it. Camera limits, interaction, world-copy and rendering ownership are frontend concerns; the inspected service supplies no matching camera seam. |
| Raster scripts, `RasterToolRequest`, `raster_status`, `raster_run` | Rasterio/numpy/contourpy and conversion-job helpers; substantial scientific/runtime contract beyond viewing | Retain as pinned reference for later LiDAR processing work, not zoom. Preserve Canopi's existing raster outputs/georeferencing and native executor. |
| Representative raster tests (CRS preservation, output shape, input rejection) | Python/raster extras, no browser camera | Useful for a future raster-processing bead; do not copy them as false evidence for camera screen lock. |
| Existing Canopi GeoLibre adaptations | Already evaluated in `docs/design/v2-geolibre-reuse-inventory.md`, with current Canopi lifecycle/ordering implementations | Reuse the shipped Canopi seams in section 6. Do not reopen their frontend stack migration or import GeoLibre's React/Zustand controller. |

No backend source copy is justified for the requested zoom change. Reassess the pinned relevant source only if actual implementation evidence identifies a matching algorithm; report scope/dependency implications before adding a service. GeoLibre is MIT, Copyright 2026 Qiusheng Wu; any later substantial code/test adaptation must preserve notices and exact provenance. The current assessment introduces neither a dependency nor copied code.

## 9. Audit receipt and remaining risks

Requirements map: zoom bug and maximum 27 → sections 1–3 and Phase 1; world overview and latest one-world choice → sections 1, 4–5; editing safety/rulers/fallback → sections 4–5 and Phases 2–3; GeoLibre reuse → section 8; executable verification/delivery → section 7. Policy, thresholds, authority, user recovery and execution ownership are stated once in their authoritative sections.

No unresolved user decision remains. Engineering risks remain deliberately gated: real zoom-27 numerical precision, native effective minima, edge alignment, high/low-frame fallback and large-design performance. The plan does not assert these have passed. If Phase 1 cannot meet the fixed requirements, stop and revise the implementation approach before proceeding; do not lower zoom, re-enable world copies, weaken tests, add a server, or change file semantics to make the gate pass.

Deferred scope: global-scale editing, world-spanning geometry repair, globe projection, new imagery/detail sources, physical pinch qualification, general renderer optimization, and GeoLibre raster/SQL/service integration. Record newly discovered out-of-scope defects in bd during implementation rather than expanding this plan silently.
