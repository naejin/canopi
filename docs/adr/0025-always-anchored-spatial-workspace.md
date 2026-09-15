---
status: planned
---

# Always-anchored spatial workspace

Canopi v2 will use one spatial workspace for botanical drawing and geographic
data. Every admitted Design will contain one authored spatial frame, including
Designs whose geographic backgrounds are hidden. MapLibre will own the live
camera and presentation clock while the primary shared renderer is active. The
existing canvas camera may own navigation only while the Canvas2D fallback is
active.

This decision fixes the domain and ownership contracts needed by the bounded
rendering experiment. Its status remains planned until the v2 document format,
workspace lifecycle, and fallback are shipped and qualified. The Phase B
experiment qualified the non-owning Pixi shared-context adapter; see the
[feasibility evidence](../v2-shared-renderer-experiment.md).

## Document contract

The v2 application will admit only `.canopi` format version 6. Format version 6
is a document admission discriminator; it is independent of the application
version `2.0.0`. Native and Web ingestion will reject every earlier, missing,
invalid, or future format before replacing the active Design. Canopi will not
ship a legacy reader, migration, dual-write format, or automatic default-anchor
conversion. Development tools may convert a disposable private fixture outside
the shipping ingestion boundary.

Version 6 replaces the root `location` and `north_bearing_deg` fields with one
required `spatial_frame` value:

```text
spatial_frame: {
  anchor_longitude_deg: number
  anchor_latitude_deg: number
  north_bearing_deg: number
  placement_status: "provisional" | "confirmed"
  location_metadata: {
    altitude_m: number | null
  }
}
```

The anchor fields are finite WGS84 degrees. Longitude is in `[-180, 180]` and
latitude is within the Web Mercator limit
`[-85.0511287798066, 85.0511287798066]`. `north_bearing_deg` is finite and
canonicalized to `[0, 360)`. At zero bearing, local positive X points east and
local positive Y points south. A positive bearing turns geographic north
clockwise from local negative Y; this retains the current projection semantics.
Present altitude is finite and remains metadata rather than part of the planar
transform. Named fields cross every coordinate boundary; anonymous coordinate
tuples remain confined to APIs that require them.

A new Design stores longitude 13 degrees east, latitude 23 degrees north,
bearing 0, `provisional` placement, and null altitude. This is a deterministic
computational origin rather than a site claim. Changing a later default never
relocates a saved Design. New Design composition starts basemap, LiDAR, and other
geographic contributions hidden and performs no remote source request.

`SceneStore` remains authoritative for local-metre Plants, Zones, Annotations,
Measurement Guides, Object Groups, locks, Layers, species colours, symbols, and
codes. The Design layer owns `spatial_frame`. Projected map features and render
buffers are derived caches keyed by stable identity and revision; they are not
serialized authorities. Original raster CRS, vertical reference, and validity
remain owned by the LiDAR library and never move when the Design anchor changes.

## Placement and history

Pan, zoom, fit, coverage navigation, and return change only the camera. They do
not edit the spatial frame or relocate Design objects. Setting the actual site
is an explicit Design Edit that previews a complete candidate spatial frame,
then either aborts without mutation or commits one undoable change. Local object
positions and dimensions remain unchanged, so committing a different anchor or
bearing intentionally changes their geographic placement.

The placement commit participates in the existing coordinated Design history
and settlement boundary. It must not create a Location-only history stack.
Save, autosave, Design replacement, and Scene commands cannot observe a partly
applied placement. Undo restores the prior spatial frame and invalidates every
Design-dependent projection/result in the same settled operation. Source-only
LiDAR analyses remain reusable. Frame rebasing that preserves geographic object
positions is a separate deferred operation.

Provisional placement permits drawing, local editing, raster import, and
source-only raster analysis. Site-specific evaluation of Plants or Zones
requires confirmed placement and compatible spatial inputs. Layer visibility is
presentation state and never confirms placement.

## Camera and frame contract

The active workspace exposes a narrow navigation command role and one immutable
frame observation role. In the primary map-backed path, all pointer navigation,
wheel or pinch zoom, controls, fit Design, coverage navigation, saved viewport
restoration, and return resolve into MapLibre. MapLibre publishes a frame during
live movement and rendering, rather than only on `moveend`.

Each published frame contains a monotonic revision, CSS width and height, device
pixel ratio, the current zero-pitch Mercator camera, and mutually inverse local
metre to CSS-pixel affine transforms. Picking, snapping, drag deltas, DOM
overlays, and the shared scene renderer consume that same frame. A snapshot is
read-only observation, never a second writable camera. Settled viewport
preference writes use a separate cadence.

If the primary renderer cannot start or later fails, one lifecycle operation
captures the current map frame, disposes the map-backed renderer, and hands the
equivalent local viewport once to the Canvas2D path. Only then may the existing
`CameraController` accept writes. A retry performs the inverse one-time handoff.
No path runs two writable cameras or a two-way synchronization loop.

One pointer sequence chooses its owner at gesture start. Canopi tools retain
Scene mutation, hit testing, locks, grouping, and history. A tool-owned gesture
disables map navigation for that sequence and restores it on completion,
Escape, pointer-capture loss, tool change, document replacement, or disposal.

## Rendering and layer order

The primary scene renderer is a MapLibre custom layer. MapLibre owns the WebGL2
context, framebuffer, camera, frame scheduling, resize, and context lifecycle.
The adapter owns only its scene subscriptions and graphics resources. It must
not clear or lose the shared context, start an application ticker, resize the
canvas independently, or render outside MapLibre's custom-layer callback. Scene
edits request `triggerRepaint`; live camera movement supplies frames directly.

The semantic back-to-front stack is:

```text
basemap
ordered LiDAR sources and analyses
geographic reference overlays
grid
Design objects in existing Layer order
interaction chrome
```

A Canopi-owned ordered descriptor list will reconcile stable source/layer IDs,
incremental data and paint changes, explicit moves, late insertion, and complete
reconstruction after style reload. LiDAR source and analysis visibility remain
independent. Hard-coded possible insertion anchors are not an ordering model.

The shared adapter reuses renderer-neutral scene snapshots, Zone geometry,
Plant symbol recipes, botanical colours, label admission, and interaction
visuals. It uses small local or camera-relative coordinates and never creates a
DOM node or MapLibre style layer per Plant. PDF, inspection, and Canvas2D remain
renderer-neutral consumers and do not require MapLibre or a network request.

## Lifetime, failure, and qualification

One workspace lifecycle owner creates and disposes the map, scene custom layer,
semantic layer reconciliation, subscriptions, observers, input arbitration,
frame requests, and asynchronous cancellation. Style reload and context restore
recreate graphics resources from Scene authority. Design replacement fences
late asynchronous work. Empty geographic presentation uses a local empty style.

Pixi 8.17.1 accepts an injected WebGL2 context, but its normal renderer destroy
path calls `WEBGL_lose_context.loseContext()`. Therefore ordinary Pixi
`Application` ownership is disqualified for a shared map context. The qualified
adapter uses a direct `WebGLRenderer`, explicit state reset, MapLibre-frame-only
submission, and resource-only teardown after suppressing Pixi's context-loss
extension reference. MapLibre 6.4.1 custom rendering receives
`(gl, CustomRenderMethodInput)` and requires premultiplied-alpha and context-loss
handling; implementation must follow those installed types rather than older
examples.

The accepted renderer checkpoint used the real 2,201-Plant Design, botanical
symbols and labels, Zones, grid, selection, real map layers, LiDAR ordering,
live alignment within one CSS pixel, DPR 1 and 2, resize, style reload, context
restore, input arbitration, teardown, offline empty style, and matched timing
evidence. Final performance and production-lifecycle gates still control this
ADR's transition from planned to accepted.

## Consequences

- Version 6 intentionally breaks older Design admission. Existing files and app
  data remain untouched when rejected.
- The current canvas-owned camera and noninteractive following map are temporary
  implementation state to remove after the qualified lifecycle is integrated.
- The Canvas2D renderer stays as the editing fallback and export-related scene
  projections stay independent of interactive WebGL.
- GeoLibre contributes selected ordering, resize, and lifecycle behavior rather
  than a second layer, raster, editor, or processing authority. The pinned reuse
  inventory records the source-level decisions and provenance policy.
