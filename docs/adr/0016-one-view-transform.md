# One view transform

Status: Accepted (2026-09-29, Canopi v2); amended 2026-09-30 and 2026-10-01

Amends [ADR 0004](0004-one-renderer.md) (camera ownership) and [ADR 0001](0001-geolocated-map-canvas.md) (bearing is a view property). Product rules: [ADR 0015](0015-rotating-map-and-canvas-controls.md).

Amended 2026-09-30 and 2026-10-01: one `ViewTransform` type and one module that builds it. From phase 0A to 0E the headless driver anchors it on a planar camera (today's `x, y, scale` plus a bearing), so tests written against the old camera keep exact readbacks while the legacy facade lives. From 0E (user, 2026-10-01) both drivers hold a geographic camera and build through the one builder: no user sees bit-for-bit numbers, so tests compare within a tolerance, and a re-origin keeps the camera's ground through lon/lat.

## Context

Screen to world conversion was derived in several places (renderer, scene camera, rulers, annotation layout, snapshots, the inspection lens), each assuming `x, y, scale` and bearing 0; rotation was refused outright. MapLibre 6.10.0 does not constrain a rotate-only move (`setBearing` skips the constrain step, `jumpTo` sets bearing after centre and zoom, the constrain callback cannot see the bearing) and `easeTo` ignores `center` when `around` is set, so letting MapLibre compute targets would make the live map diverge from any headless model exactly on rotation.

## Decision

- **MapLibre's transform holds the camera state** the map renders from. Canopi computes every camera target itself (pure camera maths shared by the MapLibre and headless drivers), constrains it for the target bearing, and applies it through one `CameraDriver` with explicit `jumpTo` (and `flyTo` for long flights). The map stays non-interactive.
- **One writer.** The driver is the only code that calls camera methods on the workspace and snapshot maps; the World map is exempt. A `transformConstrain` guard over the same constrain function covers MapLibre-internal changes (flight steps) with the bearing arc the driver sets. A resize is a driver move too: the host reports the new size and the driver resizes the map, constrains at the live bearing and publishes one frame.
- **Short animations** (≤ 300 ms: keys, compass, snap to north, "Turn view to this edge") are driver-owned rotation tweens that start from the live camera each frame, so a pan or zoom during a tween composes with it instead of cancelling it. Repeated steps compute from the tween's target bearing. Saved views and stories jump or fly; nothing eases centre and zoom.
- **One `ViewTransform`.** At pitch 0 one module builds it analytically for both drivers, from centre, zoom, bearing and the session plane. Nobody calls `map.project` or `map.unproject`; a contract test holds the builder to MapLibre's `MercatorTransform`. Everything else (renderer, tools, overlays, rulers, re-origin, fit, lens) reads this transform. PDF capture reads the live frame when the PDF workspace opens (`captureView`, like saved views; only the last view reads the settled camera) and turns plan geometry with its own page frame, which maps page to ground, not a view.
- **Frames.** The runtime publishes a per-frame `viewFrame`, synchronous ordered `onViewFrame` phases (tools, then overlays), and a `settledViewFrame` after 150 ms. App code and components see only coarse signals (`ViewReadSurface`: mode, zoom band, bearing, north-up, scale, zoom limit, and, in overview only, the Design pin's screen point) and command through `ViewCommandSurface`.
- **Pitch slot.** `ViewCamera.pitchDeg` is the literal 0, and nothing else is carried for pitch (2026-10-01: pitch is not on the roadmap): `screenToWorld`, the planar projection and its affine are non-null from 0E. When pitch ships, widening them gives the compiler the list of consumers; the recipe is kept on the pitch bead (spec §6).
- **Session plane stays north-aligned** (x east, y south) whatever the bearing; re-origin runs on the settled frame and keeps the camera's ground (MapLibre's camera is geographic; the headless driver applies the plane change in plane terms).

## Options considered

- **Canopi owns the camera state and MapLibre follows**: contradicts ADR 0004's camera ownership and needs an echo loop against MapLibre's own transform. Computing targets differs: the frame is read back from MapLibre.
- **MapLibre computes targets** (`easeTo` with `around`, `transformConstrain` as the only clamp): the 6.10.0 behaviours above break rotation moves and the headless contract.
- **Four-point homography from `unproject` as the source**: sample noise at zoom 27 defeats any affine test; kept for pitch with a pixel tolerance.
- **Matrices from the custom-layer render callback**: exist only inside `render`; tools and DOM need the transform synchronously.
- **MapLibre's internal transform getters**: fragile across upgrades.
- **Mirroring or learning MapLibre's zoom clamp** (today): disagrees under rotation.
- **A second "presented" signal or a microtask view phase**: synchronous ordered phases paint chrome in the same frame and are deterministic in tests.
- **Cancelling a bearing ease on pan** (MapLibre's behaviour): leaves bearings like 2.7° that nobody chose.
- **A world-root strategy interface now**: one implementation for an unscheduled feature.

## Consequences

- The camera code, the shared-scene viewport derivation, `createMapFrame` (`bearing: 0`) and the clamp-learning path are deleted; policy tests keep one camera writer, no projection caller outside the World map and a view module that imports no MapLibre, Pixi or DOM node.
- A headless/MapLibre contract test runs the same camera scripts through both drivers over MapLibre's real `MercatorTransform` and requires 1e-6 px agreement with its forward projection (its own inverse drifts by up to 8e-6 px above zoom 19; multi-move scripts stay below zoom 20).
- The zoom floor depends on bearing, so the zoom-out button reads the floor for the live bearing.
- Details: [`canvas-v2-spec.md`](../plans/canvas-v2-spec.md).
