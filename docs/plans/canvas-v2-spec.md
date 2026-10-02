# Canvas v2 specification: interfaces, bindings, rotation, strings

Trimmed 2026-10-02 at the phase-0 close; the full earlier text is at commit 76bd08a659d916069a340fc06e670e54e32f54c7.

Status: agreed (2026-09-29); phase 0 built (2026-10-02); F, 1, 2, 3 and R build on it per docs/plans/canvas-v2-plan.md

This is the contract the canvas v2 work is built to. The phases, owners, gates and bead mapping are in `docs/plans/canvas-v2-plan.md`; what exists today and what happens to each piece is in `docs/plans/canvas-v2-inventory.md`. The reasons live in the ADRs: 0015 (rotating map and canvas controls; amends ADR 0010's control and shortcut rules), 0016 (one view transform), 0017 (input pipeline and gestures), 0018 (narrow tool interface), 0019 (rendering and the view transform), 0020 (focus and keyboard ownership). Delete this file with the plan at the 2.0 release close.

Paths are relative to `desktop/web/src/` unless they start with `docs/`, `common-types/` or `desktop/`. `view/`, `input/`, `tools/`, `renderers/`, `chrome/`, `scene-runtime/` and `interaction/` are short for `canvas/runtime/<dir>/`; bare `key-chord`, `keymap`, `escape-chain`, `arming`, `focus-owner` and `key-router` modules and tests are under `app/keyboard/`; `maplibre/` is `src/maplibre/`.

## 0. Notation

- **(user)** marks a user decision (2026-09-29). **(convention)** marks a planner convention the user may overturn; the plan lists them for confirmation. **(spec)** marks a detail this specification settles that the design left implicit; the plan's handoff lists these too.
- **mod** is Cmd on macOS and Ctrl elsewhere. On macOS a physical Ctrl is never mod: from phase 2 it turns a left click into a right click, and Ctrl+arrows belong to Mission Control.
- **Phases.** All phases ship together as 2.0 (user, 2026-10-01). There is one bindings constant, edited in place by the phase that changes a field (§1.2); in this document LEGACY names its values in phase 0 (today's behaviour, F's hover end aside), ROTATION its values from phase 1, V2 from phase 2 and TOUCH from phase 3. "From 1" means the behaviour exists from that phase on; a cell without a phase is unchanged from today.
- **Decisions of 2026-10-01** (user; plan §1): one release; no second-button navigation during a drag; one map angle for the whole PDF layout; no edge highlight; a panel drag hides the tool's preview; the hover end lands in F; the keyboard is built once, in F; LiDAR's Return to Design keeps the exact view.
- **Free gesture**: a rotation whose end angle the user did not choose exactly (pointer rotate drag, compass drag, touch twist, trackpad twist). **Explicit target**: a bearing Canopi was told (key step, reset, "Turn view to this edge", a saved view, a story step, the last view).
- Bearing: the compass direction that is up on screen, degrees clockwise from true north, normalised to [0, 360). Stored rotations (`rotationDeg` on zones, notes and stamps) are clockwise from true north, as today; Print Areas carry no angle (one layout angle, §4.12).

## 1. Interfaces

Phase 0 built §1.1–§1.5; for what is built, the code and its tests are the reference, and this section keeps the contract the later phases rely on and the members they add or change. §1.6 is built in F and §1.7 in phase 1. Names are binding; doc comments are part of the contract. Types marked "(types)" hold no code.

### 1.1 View (`canvas/runtime/view/`, pure)

```ts
// canvas/runtime/view/types.ts  (pure: no DOM, MapLibre, Pixi)

/** Session-plane metres: x east, y south (ADR 0001). */
export interface WorldPoint { readonly x: number; readonly y: number }
export interface WorldVector { readonly x: number; readonly y: number }
/** CSS px relative to the map canvas' top-left corner. */
export interface ScreenPoint { readonly x: number; readonly y: number }
/** Screen TL, TR, BR, BL order. */
export type WorldQuad = readonly [WorldPoint, WorldPoint, WorldPoint, WorldPoint]
export interface ScreenInsets { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }
export interface GeoPoint { readonly lon: number; readonly lat: number }
export interface GeoBounds { readonly west: number; readonly south: number; readonly east: number; readonly north: number }

/** World-axis box in plane metres. */
export interface SceneBounds { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
export interface SceneBoundsOptions {
  /** The scene's extent at a candidate scale: corner points of every plant, zone and note footprint, in plane metres.
   *  Notes and default-mode plants are screen-sized, so the extent depends on the scale. The runtime supplies it
   *  (command-surface.ts, document-surface.ts) through canvas/runtime/scene-extent.ts, from plant-presentation.ts,
   *  annotation-layout.ts and zone-geometry.ts, so view/ imports none of them (P4). */
  readonly extentPoints?: (pixelsPerMetre: number) => readonly WorldPoint[]
  /** Scale that frames an empty Design, centred on the session plane origin. */
  readonly emptySceneScale?: number
}
export interface TemporaryBoundsFocusOptions {
  /** Symmetric CSS-pixel padding reserved by the caller's presentation. */
  readonly paddingCssPx: number
  /** Optional external ceiling, such as a MapLibre zoom-limit equivalent. */
  readonly maximumScale?: number
}
// This file uses no scene type. A view/ file that needs one (navigation.ts: ScenePersistedState) imports it type-only from
// '../scene/types' (P4 allows it), never the barrel '../scene' (P4 would reject it); files outside view/ keep today's barrel imports.

/**
 * The geographic camera in MapLibre's terms. bearingDeg: the compass direction that is
 * up on screen, degrees clockwise from true north, normalised to [0, 360)
 * (common-types views.rs validates [0, 360]).
 */
export interface ViewCamera {
  readonly center: GeoPoint          // ground point under the screen centre
  readonly zoom: number              // MapLibre zoom
  readonly bearingDeg: number
  /** Literal 0 until the pitch phase widens it to number; the compiler then lists every consumer. */
  readonly pitchDeg: 0
}

/**
 * A placement in CSS px and session-plane metres, read off a transform by planarCameraOf (view-transform.ts) for the chrome and the
 * test view; no driver holds one. A plane point p lands on screen at turn(p × scale, bearingDeg) + { x, y }: scaled, turned
 * counter-clockwise on screen by bearingDeg about the screen origin (so the compass direction bearingDeg points up), then translated,
 * so { x, y } is the plane origin's screen point; at bearing 0 it is the pre-v2 viewport. Tests compare with toBeCloseTo.
 */
export interface PlanarCamera { readonly x: number; readonly y: number; readonly scale: number; readonly bearingDeg: number }

export interface ViewScreen { readonly width: number; readonly height: number; readonly devicePixelRatio: number }

/** Renderer and bulk-projection fast path. Pitch adds a homography (§6). */
export interface PlanarProjection {
  /** 2x3 affine in Pixi order [a, b, c, d, tx, ty]. Non-null at pitch 0. */
  readonly affine: readonly [number, number, number, number, number, number]
}

export interface ViewTransform {
  readonly revision: number          // increments on every build
  readonly planeRevision: number     // session-plane identity; stale transforms are refused after re-origin
  readonly camera: ViewCamera
  readonly screen: ViewScreen
  readonly planar: PlanarProjection

  worldToScreen(p: WorldPoint): ScreenPoint
  /** Non-null at pitch 0; pitch widens it again (§6). */
  screenToWorld(s: ScreenPoint): WorldPoint
  /** Bulk billboard projection: reads [x0,y0,x1,y1,…] metres, writes CSS px. No allocation. */
  projectAnchors(world: Float64Array, out: Float32Array, count: number): void

  /** Local ground resolution at a world point (view centre if omitted). Replaces `1 / viewport.scale` and the scale-bar value. */
  metresPerPixelAt(p?: WorldPoint): number
  screenDistance(a: WorldPoint, b: WorldPoint): number
  /** Unit world vectors of screen-right and screen-down at a point (view centre if omitted). */
  screenAxesInWorld(at?: WorldPoint): { readonly right: WorldVector; readonly down: WorldVector }

  visibleWorldQuad(insets?: ScreenInsets): WorldQuad   // captureView().extent
  /** Four projected corners, never two (rotation-handle anchor, menu anchor). */
  worldQuadToScreen(q: WorldQuad): readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint]

  readonly pixelsPerMetre: number            // at the plane origin: today's `viewport.scale` (zoom bands, policy)
  readonly northUp: boolean                  // angularDistanceToNorth(bearing) < 0.05° and pitch 0
}

/** Everything the runtime publishes per camera change. Runtime-only (policy P10). */
export interface ViewFrame {
  readonly view: ViewTransform
  readonly mode: 'site' | 'overview'         // overview below 0.1 px/m (canvas/workspace-camera-policy.ts)
  readonly scaleBounds: { readonly min: number; readonly max: number }   // the effective bounds: policy zooms with the single-world floor at the live bearing (constrainCamera)
  readonly insets: ScreenInsets              // from the visible-map-area seam
  readonly attached: boolean
  readonly moving: boolean                   // gesture, rotation session, tween or flight in flight
  readonly revision: number
}

export type FramePhase = 'tools' | 'overlays'   // run in this order inside the `move` handler

export interface ViewFrameSource {
  readonly viewFrame: ReadonlySignal<ViewFrame>
  /** The frame after 150 ms without camera change (re-origin, last view, label admission, coverage). */
  readonly settledViewFrame: ReadonlySignal<ViewFrame>
  /** Synchronous per-frame callbacks; never effects, so per-frame work cannot fan out into Preact. */
  onViewFrame(phase: FramePhase, listener: (frame: ViewFrame) => void): () => void
}

/** Dev diagnostics published with the map contributions and the surface state. */
export interface ViewDiagnostics {
  readonly camera: ViewCamera
  readonly centreWorld: WorldPoint
  /** Ground under the four screen corners, TL, TR, BR, BL (was viewportCornerGeo). */
  readonly groundQuadGeo: readonly [GeoPoint, GeoPoint, GeoPoint, GeoPoint]
}
```

The names `viewFrame`, `settledViewFrame` and `onViewFrame` are distinctive on purpose: policy P10 confines them by identifier. `view/` and the drivers read the window's clock, animation frames and timers themselves; tests use Vitest fake timers (P4 keeps only its import ban).

```ts
// canvas/runtime/view/read-surface.ts  (types; the app-facing side, exposed on the canvas session)

/** Returned by ViewCommandSurface.beginRotation (the compass) and ViewNavigation.beginRotation; here so app code can name it (P10). */
export interface RotationSession {
  /**
   * totalDeltaDeg: rotation since begin. With step, the published bearing is
   * roundToStep(start + totalDeltaDeg, 15): absolute multiples of 15°, not start + 15k.
   */
  update(totalDeltaDeg: number, options: { readonly step: boolean }): void
  /** snapBearing: within 7° of north tweens to 0 in 300 ms about the session pivot; else keeps. */
  end(): void
  /** Restores the full starting ViewCamera with animation 'none' (Esc during a rotate). */
  cancel(): void
}

/** What app code and components may observe. Each signal changes only when its own value changes. */
export interface ViewReadSurface {
  readonly mode: ReadonlySignal<'site' | 'overview'>
  readonly zoomBand: ReadonlySignal<number>              // floor(log(pixelsPerMetre) / log(1.25)): LOD key
  readonly bearingDeg: ReadonlySignal<number>            // rounded to 0.1° (compass needle, PDF "As on screen")
  readonly northUp: ReadonlySignal<boolean>              // rulers and their hint; never hides the compass
  readonly groundMetresPerPixel: ReadonlySignal<number>  // at the screen centre, 3 significant figures (scale bar, ratio)
  readonly zoomLimit: ReadonlySignal<'min' | 'max' | null>
  /** Overview only: the Design origin's screen point, rounded to whole pixels, or null in site mode or within 24 px of an edge.
   *  The one read that changes during a pan (the overview pin must track the Design); it updates per frame only in overview,
   *  where nothing else re-renders, and is the named exception to the coarse-signal rule (P10). */
  readonly designPin: ReadonlySignal<ScreenPoint | null>
  /** The camera after 150 ms without change (the settled frame's camera): last view, map contributions. Never a user-triggered capture (captureView). */
  readonly settledCamera: ReadonlySignal<ViewCamera>
  /** The settled frame's revision: changes once per settle, whatever settled (camera, screen, insets, re-origin). The labels count. */
  readonly settledRevision: ReadonlySignal<number>
  /**
   * Saved-view capture, saved-view snapshot, PDF capture, story restore point: the LIVE frame's camera (viewFrame.peek(),
   * not the settled one), its four-corner ground extent and the screen it was seen on. User-triggered captures record what
   * is on screen now, so a capture within 150 ms of a pan, zoom or key pan, or during a flight, never records the previous
   * camera. The last view (settings) keeps `settledCamera`.
   */
  captureView(): { readonly camera: ViewCamera; readonly extent: GeoBounds; readonly screen: ViewScreen }
}

/** What app code and components may command. Implemented by ViewNavigation; nothing else is exposed. */
export interface ViewCommandSurface {
  zoomIn(): void
  zoomOut(): void
  zoomBy(factor: number): void                         // kept from today's viewport surface (zoom slider)
  zoomToFit(): void                                    // Fit to Design, Home
  zoomToSelection(): void                              // Shift+2
  returnToDesign(): void                               // kept: "Back to my Design"
  /** Kept: LiDAR's Fit to data. Bookmarks the current view unless an unreturned focus holds one, then frames the bounds as frameBounds does. */
  focusTemporaryBounds(bounds: SceneBounds, options: TemporaryBoundsFocusOptions): boolean
  /** Kept: LiDAR's Return to Design. Restores the bookmark; false without one (the caller then calls returnToDesign). */
  returnFromTemporaryFocus(): boolean
  /** The plant finder's Zoom to them: the temporary-focus fit with no bookmark. Not named fitBounds: P1 forbids that MapLibre
   *  name as a call. Phase 1 adds the rotation-safe circle fit for zoom to matches (INV-CAM-40). */
  frameBounds(bounds: SceneBounds, options: TemporaryBoundsFocusOptions): boolean
  setFramingInsets(insets: ScreenInsets): void         // kept: the visible-map-area seam
  resetNorth(): void
  rotateBy(direction: 1 | -1): void                    // next absolute 15° multiple in that direction
  beginRotation(pivot: 'centre'): RotationSession      // compass drag
  showCamera(camera: ViewCamera, options?: { readonly motion?: 'fly' | 'jump' }): void   // saved views, stories
  /** Place search. Returns false when the place cannot be shown (today's boolean `showPlace`). */
  showPlace(place: GeoPoint, zoom: number, options?: { readonly motion?: 'fly' | 'jump' }): boolean
}
```

**How the view surfaces meet the session surfaces (§1.1a).** `ViewCommandSurface` is `CanvasCommandSurface.viewport` (`canvas/runtime/runtime.ts`); `ViewReadSurface` is `CanvasQuerySurface.view`. `CanvasQuerySurface.subscribePointerWorld` forwards `ToolHost.subscribePointerWorld` (the world and screen point, R1, so a hover readout over analysis results can call `queryRenderedFeatures` while P2 stays strict); the inspection lens component uses it instead of a map-host `pointermove`. The lens handle (`canvas/inspection.ts`) publishes `sourceQuad`, the lens footprint's four screen corners on the main map; phase 1 replaces its `panBy(delta)` (world metres) with `panByScreen(deltaPx: InspectionPoint)`, turned into ground at the lens's bearing (INV-WR-17, INV-KEY-21). `CanvasOverview.tsx` places the overview pin from `ViewReadSurface.designPin`. App code (`app/**`, `components/**`, `web/**`) uses only these two surfaces, except `workspace-runtime-composition.ts` and `workspace-activation.ts`, which wire the driver host directly (Attachment, below); `ViewFrameSource` stays inside `canvas/runtime/**` and `maplibre/**` (P10).

**Resize.** One owner changes the screen size: the MapLibre driver calls `map.resize()`, re-runs `constrainCamera` at the live bearing (the zoom floor depends on screen size and bearing, §4.14) and publishes one frame; the World map (no driver, exempt from P1) resizes itself. `setScreen` is a no-op when the size is unchanged. The runtime's two resize entries call the live driver's `setScreen` (`cameraHost.current().setScreen`) with `window.devicePixelRatio`. P1 forbids `resize` on a map outside the driver.

```ts
// canvas/runtime/view/camera-driver.ts  (types)

export type CameraMove =
  /** deltaPx is content movement: the ground under the pointer moves by deltaPx. New centre = unproject(screenCentre − deltaPx). */
  | { readonly kind: 'pan-by'; readonly deltaPx: ScreenPoint }
  | { readonly kind: 'zoom-around'; readonly anchorPx: ScreenPoint; readonly factor: number }
  /**
   * Keep the ground under anchorPx fixed while the bearing changes; the centre is an output.
   * 'ease' runs a driver tween (VIEW_EASE_MS) about the same anchor.
   */
  | {
      readonly kind: 'rotate-around'
      readonly anchorPx: ScreenPoint | 'centre'
      readonly bearingDeg: number
      readonly animation: 'none' | 'ease'
    }
  /** Go to a full camera. The centre is an input; no anchor. 'fly' is MapLibre flyTo. */
  | {
      readonly kind: 'set'
      readonly target: ViewCamera               // pitchDeg: 0 by type
      readonly animation: 'none' | 'fly'
    }

export interface CameraDriver {
  readonly frames: ViewFrameSource
  /** Synchronous for 'none' moves and the incremental kinds: `frames.viewFrame` is current on return (unless queued). */
  apply(move: CameraMove): void
  /** The bearing a running tween or flight will end at, else the live bearing. */
  bearingTarget(): number
  stopAnimation(): void
  /** The runtime's plane effect calls it on a re-origin and on any plane change while attached (a detached hydration goes
   *  through CameraDriverHost.followPlane): the MapLibre driver rebuilds against the new plane and the map stays put; the headless
   *  driver rebuilds its frame against the new plane, keeping the camera's ground. */
  planeChanged(plane: SessionPlane): void
  setScreen(screen: ViewScreen): void
  setInsets(insets: ScreenInsets): void
  /** Set when this driver can no longer drive its map (a map error or a pitched read-back); the host detaches it. */
  readonly failure: ReadonlySignal<CameraDriverFailure | null>
  dispose(): void
}

/** Injected into both drivers; they read the window's clock and animation frames themselves. Only the host's frames settle. */
export interface CameraDriverDeps {
  readonly policy: () => NavigationPolicy
}

/** One reason. */
export interface CameraDriverFailure { readonly reason: 'map-error'; readonly message: string }

/**
 * Owns the runtime's one camera across attach, detach and failure.
 * The runtime starts on a HeadlessCameraDriver (tests, before attach). `frames` is stable across swaps. Moves, resizes and re-origins
 * go to the live driver, `current()`: ViewNavigation's moves (`apply`), the two resize entries (`setScreen`) and the runtime's plane
 * effect on a re-origin (`planeChanged`). The NavigationPolicy takes the reference latitude of options.plane(), rebuilt once per
 * plane, so a re-origin moves the scale bounds (and the zoom buttons' limits) with the plane.
 */
export interface CameraDriverHost {
  readonly frames: ViewFrameSource
  readonly current: () => CameraDriver
  /** Hands the camera to an attached driver: it starts with a 'set'/'none' move to the current camera; ViewFrame.attached becomes true. */
  attach(driver: CameraDriver): void
  /** Back to a HeadlessCameraDriver at the last camera; ViewFrame.attached becomes false. An attached driver that fails ends here
   *  too, before `failure` is set; the move that failed is not applied again (ADR 0004: nothing renders after a failure). */
  detach(): void
  /** The Scene's plane after a detached hydration: the headless driver keeps its plane placement and takes the new plane; an attached
   *  camera stays put, re-expressed in the plane. The runtime's plane effect calls it for every plane change that is neither a
   *  re-origin nor made while frames.viewFrame.peek().attached; those go to current().planeChanged, since a mount-existing start
   *  hydrates with the map attached (runtime.start() resolves after the activation attached the MapLibre driver; then
   *  startAttachedDesignSession → replacement.attach → canvas.loadDocument(file) → zoomToFit). Without it the headless camera would
   *  report another plane's ground. */
  followPlane(plane: SessionPlane): void
  /** The deps the host built its drivers with; the activation builds the MapLibre driver with them. */
  readonly driverDeps: CameraDriverDeps
  /** Set when the attached driver fails; the host has already detached. */
  readonly failure: ReadonlySignal<CameraDriverFailure | null>
}

// canvas/runtime/view/driver-host.ts
export interface CameraDriverHostOptions {
  /** The zoom range and overview threshold; the reference latitude is options.plane()'s, rebuilt once per plane. */
  readonly policy: WorkspaceCameraPolicy
  readonly reducedMotion: ReadonlySignal<boolean>   // a false signal until phase 1 injects the platform's
  readonly plane: () => SessionPlane
  readonly screen?: ViewScreen
  readonly camera?: ViewCamera
  readonly insets?: ScreenInsets
}
export interface CameraDriverHostController extends CameraDriverHost { dispose(): void }
export function createCameraDriverHost(options: CameraDriverHostOptions): CameraDriverHostController
```

**Attachment** (`app/canvas-map-surface/workspace-activation.ts`). The activation builds each map's `MapLibreCameraDriver` and calls `attach`/`detach`, and subscribes to `CameraDriverHost.failure` to report the map as unavailable. A rotated camera is never a failure; a read-back pitch other than 0 is (`'map-error'`). The composition and the activation are the only two app modules that touch the driver host directly (P10 allows their type-only import of `camera-driver.ts`); everything else goes through the two surfaces above. The runtime builds its one host in `scene-runtime/construction.ts` (`SceneCanvasRuntime.cameraHost`) and follows the Scene's plane itself, through one plane effect there.

**Driver rules** (ADR 0016, amended 2026-09-30). `MapLibreCameraDriver` and `HeadlessCameraDriver` both implement `CameraDriver` with the same `camera-math`, `constrainCamera` and `BearingTween`, and both build their frames with `buildViewTransform` from a geographic `ViewCamera`: the MapLibre driver's is MapLibre's own camera, the headless driver's its own; `view/camera-contract.test.ts` holds the transform to MapLibre's (1e-6 px), and tests compare with `toBeCloseTo`. The MapLibre driver is the only code that calls camera methods on the workspace and snapshot maps, always with explicit `jumpTo`/`flyTo` values; each publishes one frame from the read-back camera (bearing normalised to [0, 360)). A `CameraDriver.apply` made mid-dispatch is queued and applied once, after every listener ran. The map stays `interactive: false`, `dragRotate: false`, `touchZoomRotate: false`.

| Move | Driver work | MapLibre call |
|---|---|---|
| `pan-by` | `panCamera`; during a tween, bearing = live tween frame | `jumpTo` |
| `zoom-around` | `zoomCameraAround` | `jumpTo` |
| `rotate-around` / `none` | `rotateCameraAround` | `jumpTo` |
| `rotate-around` / `ease` | starts a `BearingTween` about the anchor | `jumpTo` per animation frame |
| `set` / `none` | `constrainCamera(target)` | `jumpTo` |
| `set` / `fly` | `constrainCamera(target)`; guard arc = [live bearing, target bearing] for the whole flight | `flyTo({ center, zoom, bearing })` |

The map's `transformConstrain` is an adapter over `constrainCamera` whose bearing arc is a driver field set before each call (`[b, b]` for a jump, `[from, to]` for a flight); it never reads `map.getBearing()`. Tweens are not cancelled by other moves: a pan or zoom during a tween composes with it. A flight is stopped by any other move, and the interrupting `jumpTo` carries the flight's target bearing.

```ts
// canvas/runtime/view/navigation-policy.ts  (pure; shared by both drivers)

/**
 * Built by createNavigationPolicy(base, reducedMotion) from today's WorkspaceCameraPolicy (canvas/workspace-camera-policy.ts,
 * kept: pure, and P4 lets view/ import it). The reference latitude turns zooms into px/m (cameraScaleBoundsForPolicy → ViewFrame.scaleBounds).
 */
export interface NavigationPolicy {
  readonly referenceLatitudeDeg: number    // the session plane's latitude (the host's, rebuilt once per plane)
  readonly minZoom: number                 // 0
  readonly maxZoom: number                 // 27
  readonly overviewPixelsPerMetre: number  // 0.1
  readonly referencePixelsPerMetre: number // 20 px/m = 100 %
  /** prefers-reduced-motion: reduce. Read by the platform (platform/desktop.ts, platform/browser.ts) and injected; view/ never calls matchMedia (P4). Eases and tweens become 'none' moves while true. */
  readonly reducedMotion: ReadonlySignal<boolean>
}

/**
 * Clamp zoom to [max(policy.minZoom, zoomFloorForArc(screen, policy, arc)), policy.maxZoom], the floor keeping one world copy
 * under the viewport rotated by every bearing in `bearingArc` (renderWorldCopies:false), then hold the rotated screen quad inside
 * one world: latitude inside ±85.05° and longitude inside ±180°. It replaces all of MapLibre's defaultConstrain (setConstrainOverride
 * replaces the zoom range and the longitude hold too). Idempotent. The zoom floor depends on the screen and the arc, never on the
 * centre, because MapLibre calls the guard on intermediate (old centre, new zoom) states.
 */
export function constrainCamera(camera: ViewCamera, screen: ViewScreen, policy: NavigationPolicy,
  bearingArc?: { readonly fromDeg: number; readonly toDeg: number }): ViewCamera
export function createNavigationPolicy(base: WorkspaceCameraPolicy, reducedMotion: ReadonlySignal<boolean>): NavigationPolicy
/** Zoom floor for a bearing arc: the maximum over the arc (largest near 45° + k·90°); for the arc [0, 0] it equals singleWorldEffectiveMinimumZoom. */
export function zoomFloorForArc(screen: ViewScreen, policy: NavigationPolicy, fromDeg: number, toDeg: number): number

/** Any angle to [0, 360); results ≥ 360 − 1e-9 become 0 (so normaliseBearing(-1e-14) === 0). */
export function normaliseBearing(deg: number): number
/** min(b mod 360, 360 − b mod 360): the one test for "near north". */
export function angularDistanceToNorth(deg: number): number
/** End of a free gesture: angularDistanceToNorth(deg) ≤ 7 → 0, else deg. */
export function snapBearing(deg: number): number
/** Absolute 15° multiples: round(deg / 15) * 15, normalised. */
export function roundToStep(deg: number, stepDeg: 15): number
/** Key and compass steps: the next absolute multiple of 15 strictly in `direction` (22 → 15 → 0; 0 → 345). */
export function nextStep(deg: number, direction: 1 | -1, stepDeg: 15): number
/** Shortest signed arc from a to b, in (-180, 180]. */
export function shortestArc(fromDeg: number, toDeg: number): number
export const ROTATE_DEG_PER_PX = 0.8                                  // MapLibre's rate
export const SNAP_TO_NORTH_DEG = 7
export const VIEW_EASE_MS = 300
```

```ts
// canvas/runtime/view/camera-math.ts  (pure; the only place camera targets are computed)

/** Web Mercator + bearing: the camera that keeps `ground` under `screenPoint`. */
export function cameraKeepingPoint(camera: ViewCamera, screen: ViewScreen, ground: GeoPoint, screenPoint: ScreenPoint): ViewCamera
export function panCamera(camera: ViewCamera, screen: ViewScreen, deltaPx: ScreenPoint): ViewCamera
export function zoomCameraAround(camera: ViewCamera, screen: ViewScreen, anchorPx: ScreenPoint, factor: number): ViewCamera
export function rotateCameraAround(camera: ViewCamera, screen: ViewScreen, anchorPx: ScreenPoint | 'centre', bearingDeg: number): ViewCamera
export function screenToGeo(camera: ViewCamera, screen: ViewScreen, s: ScreenPoint): GeoPoint
export function geoToScreen(camera: ViewCamera, screen: ViewScreen, g: GeoPoint): ScreenPoint
/** A placement to the camera it shows (createTestView's setViewport and reproject; the chrome's placement reads go the other way, planarCameraOf). */
export function planarToViewCamera(camera: PlanarCamera, screen: ViewScreen, plane: SessionPlane): ViewCamera

// canvas/runtime/view/bearing-tween.ts  (pure step function; the caller passes the time)
export interface BearingTween {
  readonly targetBearingDeg: number
  readonly anchorPx: ScreenPoint | 'centre'
  /** The camera for time t, computed from the LIVE camera (so pans and zooms during the tween compose). */
  step(live: ViewCamera, screen: ViewScreen, nowMs: number): { readonly camera: ViewCamera; readonly done: boolean }
}
export function startBearingTween(from: ViewCamera, move: { readonly bearingDeg: number; readonly anchorPx: ScreenPoint | 'centre'; readonly durationMs: number }, nowMs: number): BearingTween
```

A tween frame rotates the live camera about the anchor to the interpolated bearing (ease-out cubic, shortest arc). Every tween frame goes through `constrainCamera` with that frame's bearing.

```ts
// canvas/runtime/view/navigation.ts  (the camera policy; the only mover of the camera, through the live driver, deps.driver.current();
//   implements RotationSession from read-surface.ts)

export interface ViewNavigationDeps {
  readonly driver: CameraDriverHost                   // the only CameraDriver user
  readonly policy: () => NavigationPolicy
  /** The scene for zoomToFit, returnToDesign and zoomToSelection without arguments. */
  readonly readScene: () => { readonly persisted: ScenePersistedState; readonly selection: readonly WorldPoint[]; readonly bounds: SceneBoundsOptions }
}
export function createViewNavigation(deps: ViewNavigationDeps): ViewNavigation

export interface ViewNavigation extends ViewCommandSurface {
  /** Without arguments (the surface call) the navigation reads the current scene from its construction deps. */
  zoomToFit(scene?: ScenePersistedState, options?: SceneBoundsOptions): void   // keeps the bearing
  returnToDesign(scene?: ScenePersistedState, options?: SceneBoundsOptions): void
  /** LiDAR's Fit to data. The one bookmark (its ViewCamera) takes the current view unless an unreturned focus already holds one,
   *  so it is the view before the first focus; then the bounds are framed as frameBounds frames them, oriented at the current
   *  bearing (the box's four corners are fitted, not the box on screen axes). The plant finder calls frameBounds, which sets no bookmark. */
  focusTemporaryBounds(bounds: SceneBounds, options: TemporaryBoundsFocusOptions): boolean
  /** restore(bookmark): its ViewCamera; false without one. */
  returnFromTemporaryFocus(): boolean
  /** Design load or replace (document-surface.ts). Every other move drops the bookmark too: manual navigation (pan, zoom, turn, the
   *  zoom buttons, Fit to Design, Return to Design) and the jumps (openAt, centerOn, showPlace, showCamera); frameBounds keeps it. */
  clearTemporaryFocus(): void
  centerOn(point: WorldPoint, pixelsPerMetre: number, options?: { readonly animate?: boolean; readonly bearingDeg?: number | 'keep' }): void
  /** Opening a Design: oriented fit at the given bearing. */
  openAt(scene: ScenePersistedState, bearingDeg: number): void

  // rotation
  turnToEdge(a: WorldPoint, b: WorldPoint): void   // smaller turn that makes a→b horizontal; never snapped
  beginRotation(pivot: ScreenPoint | 'centre'): RotationSession

  // gesture sinks (InputRouter only)
  panByPx(deltaPx: ScreenPoint): void
  zoomAroundPx(anchor: ScreenPoint, factor: number): void
}
```

Fit is oriented: it projects the point set onto `screenAxesInWorld()` at the target bearing, takes the extent along those axes, and solves centre and zoom inside the insets. It never fits a world-axis bounding box. Because `SceneBoundsOptions.extentPoints` depends on the scale, `view/fit.ts` keeps today's convergence loop (up to 20 rounds, stopping when the scale changes by less than the threshold), recomputing the oriented extent at each candidate scale; at bearing 0 this reproduces today's fit (INV-CAM-09).

```ts
// canvas/runtime/view/view-transform.ts  (pure)

/** Pitch 0, geographic: centre, zoom and bearing + plane.mercatorOrigin / mercatorUnitsPerMeter → similarity. Both drivers, the
 *  snapshot map's driver and the inspection lens (a camera at the lens centre) build with it; P3 confines it. */
export function buildViewTransform(input: {
  readonly camera: ViewCamera
  readonly screen: ViewScreen
  readonly plane: SessionPlane
  readonly planeRevision: number
  readonly revision: number
}): ViewTransform

// Pitch phase (not written now: no declaration, no stub; see §6). When pitch ships, this module adds
//   homographyViewTransform(input: { camera, screen, plane, homography: Float64Array, planeRevision, revision }): ViewTransform

// No module calls map.project / map.unproject in the workspace (P2); view/camera-contract.test.ts holds the transform to
// MapLibre's own MercatorTransform (1e-6 px).
```

### 1.1b Test view

`createTestView` (self-test `__tests__/support/test-view.test.ts`) is the one way tests build a camera. A change to its shape is a spec edit.

```ts
// __tests__/support/test-view.ts  (test support; P3 lets it call buildViewTransform)
export interface TestViewOptions {
  /** Default { width: 400, height: 300, devicePixelRatio: 1 }. */
  readonly screen?: Partial<ViewScreen>
  /** Bearing-0 placement (screen = world × scale + { x, y }). Default { x: 0, y: 0, scale: 1 }. */
  readonly viewport?: { readonly x: number; readonly y: number; readonly scale: number }
  /** Instead of viewport: a full camera (rotated tests from phase 1). */
  readonly camera?: Partial<ViewCamera>
  /** Default createSessionPlane({ lon: 0, lat: 0 }). */
  readonly plane?: SessionPlane
  /** The host gives it the plane's latitude. */
  readonly policy?: WorkspaceCameraPolicy
  readonly insets?: ScreenInsets
}

export interface TestView {
  /** Starts on a HeadlessCameraDriver, built with the production factories; tests drive time with Vitest fake timers. */
  readonly host: CameraDriverHost
  readonly frames: ViewFrameSource            // host.frames
  readonly navigation: ViewNavigation         // readScene returns an empty scene unless the test passes one to setScene
  view(): ViewTransform                       // frames.viewFrame.peek().view
  setViewport(v: { readonly x: number; readonly y: number; readonly scale: number }): void   // a 'set' to the camera the plane gives, bearing kept
  /** The bearing-0 placement (planarCameraOf(view()) without the bearing). */
  viewport(): { readonly x: number; readonly y: number; readonly scale: number }
  /** A re-origin's placement move by a plane transform; the plane stays. */
  reproject(transform: SessionPlaneTransform): void
  setScene(scene: ScenePersistedState, bounds?: SceneBoundsOptions): void
  dispose(): void
}

export function createTestView(options?: TestViewOptions): TestView
```

Readbacks agree with each other and, attached, with MapLibre's own camera (`view/camera-contract.test.ts`, ADR 0016, 1e-6 px); tests compare with `toBeCloseTo(…, 6)`.

### 1.2 Input (`canvas/runtime/input/`, pure except the DOM source)

```ts
// canvas/runtime/input/platform.ts
export interface InputPlatform {
  readonly os: 'windows' | 'mac' | 'linux' | 'ios' | 'android' | 'other'
  readonly engine: 'chromium' | 'webkit' | 'webkitgtk' | 'gecko'
  readonly gestureEvents: boolean          // WKWebView / Safari gesturestart/change/end
}
export function detectPlatform(nav: Pick<Navigator, 'userAgent' | 'platform'>, win: { readonly GestureEvent?: unknown }): InputPlatform
// Called once in interaction-session.ts until F moves the call to platform/desktop.ts and platform/browser.ts with
// KeyRouterDeps.platform. Injected everywhere else.

// canvas/runtime/input/bindings.ts  (data: one constant, edited in place by the phase that changes a field)
export type PanContext = 'hand-tool' | 'overview'
export interface Bindings {
  readonly secondary: {
    readonly click: 'menu-on-native' | 'menu-on-release'   // legacy: native contextmenu opens at once
    readonly drag: 'none' | 'pan'
    readonly shiftDrag: 'none' | 'rotate'
  }
  /** Shift+middle-drag. Plain middle-drag always pans. */
  readonly auxiliaryShiftDrag: 'pan' | 'rotate'
  /** Contexts in which a primary drag pans. */
  readonly primaryDragPansIn: readonly PanContext[]
  readonly macCtrlClick: 'primary' | 'secondary'
  // No navigateDuringPrimaryDrag: a second button during a primary drag is ignored in every phase (U2, 2026-10-01).
  readonly touch: { readonly gestures: boolean; readonly longPressMenu: boolean; readonly hostTouchActionNone: boolean }
  readonly penBarrel: 'ignore' | 'secondary'
  readonly trackpadGestures: boolean                       // WebKit gesture* rotate and scale
  readonly dragSlopPx: Readonly<Record<PointerKind, number>>
  /** A button-less move over owned chrome, the text entry or a handle (§2.2 "Hover"): 'legacy' keeps today's split, 'end' ends
   *  the hover; the Unlock affordance keeps it under both. */
  readonly ownedHover: 'legacy' | 'end'
}
export const CURRENT_BINDINGS: Bindings     // the one constant; no ROTATION_BINDINGS, V2_BINDINGS or TOUCH_BINDINGS (audit 1.2)
// LEGACY_BINDINGS (phase 0's values, `CURRENT_BINDINGS` points at it today) is folded into CURRENT_BINDINGS by F's first Input
// commit, its importers re-pointed and the name tombstoned (P11); from F there is one bindings constant, no frozen LEGACY copy.
// F1's gesture rows are a static list with three platform notes (Linux pinch, Mac Control-click, the pen button; §9.3), not generated
// from the bindings (audit 1.7); GestureHelpRow and describeBindings are not written.
```

The current constant's values, by the phase that sets them (each phase rewrites the fixtures whose outcome it changes and deletes the superseded expectations; the release close hard-codes the fields that end with one value):

| Field | 0 | from F | from 1 | from 2 | from 3 |
|---|---|---|---|---|---|
| `secondary.click` | `menu-on-native` | same | same | `menu-on-release` | same |
| `secondary.drag` | `none` | same | same | `pan` | same |
| `secondary.shiftDrag` | `none` | same | same | `rotate` | same |
| `auxiliaryShiftDrag` | `pan` | same | `rotate` | same | same |
| `primaryDragPansIn` | `['hand-tool', 'overview']` | same | same | `['hand-tool']` | same |
| `macCtrlClick` | `primary` | same | same | `secondary` | same |
| `touch` (all three flags) | false | same | same | same | true |
| `penBarrel` | `ignore` | same | same | `secondary` | same |
| `trackpadGestures` | false | same | true | same | same |
| `dragSlopPx` | 0 for mouse, pen and touch | mouse and pen 3 (U6) | same | same | touch 8 |
| `ownedHover` | `legacy` | `end` (U6) | same | same | same |

Primary slop compares `d >= slop && d > 0`, so under 0 any movement is a drag, as today; from F the mouse and pen slop is 3 px (U6, user 2026-10-01), so a click with a little jitter stays a click; the tools keep today's own thresholds (band and handles more than 2 px, measured at release through `ToolView.screenDistance`). Secondary slop is 3 px wherever the secondary drag pans (MapLibre's `clickTolerance`). A tool may override the primary slop through `configure`, which the session sends with `ToolHost.activeToolDragSlopPx()` on every tool change; Plant a row keeps slop 0 and measures today's 4 px itself through `ToolView.screenDistance`, like the band and handles, so the moves inside it still preview the row. In phase 2 `'overview'` leaves `PanContext`; `LEGACY_BINDINGS` is folded into `CURRENT_BINDINGS` and tombstoned in F's first Input commit; each LEGACY expectation is deleted or rewritten by the commit that changes its field, never kept to the release close.

```ts
// canvas/runtime/input/thresholds.ts  (plain numbers; tests may pass others)
export interface Thresholds {
  readonly longPressMs: number               // 500
  readonly multiClickMs: number              // today's double-click interval
  readonly multiClickSlopPx: number          // 6 (today's DOUBLE_CLICK_DISTANCE_PX)
  readonly menuEchoMs: number                // 500: keyboard-menu echo
  readonly windowsMenuTrailMs: number        // 250: WebView2 trailing contextmenu
  readonly twistStartArcPx: number           // 25: touch twist
  readonly trackpadTwistStartDeg: number     // 10: WebKit gesture rotation before any rotate is emitted
}
export const DEFAULT_THRESHOLDS: Thresholds

// canvas/runtime/input/raw-input.ts  (PointerKind, Modifiers, ToolId, ToolHandleId, CanvasDropPayload come from ../interaction-types.ts, §1.2a)
export type ButtonRole = 'primary' | 'secondary' | 'auxiliary'

/** What was under the pointer at a down, a move or an up (a hover carries it, §1.3), classified by the source from data attributes. */
export type TargetClass =
  | { readonly kind: 'surface' }                                   // host or [data-canvas-surface]
  | { readonly kind: 'handle'; readonly id: ToolHandleId }         // [data-canvas-handle] in the handle layer
  | { readonly kind: 'ruler'; readonly axis: 'h' | 'v' }           // [data-canvas-ruler]
  | { readonly kind: 'owned-chrome'; readonly lockedAffordance?: true }   // compass, zoom group, attribution ([data-canvas-chrome]); any other button, input, select,
                                                                   // [contenteditable] or [data-preserve-overlays] in the host (the inspection lens's skip set);
                                                                   // lockedAffordance: the Unlock affordance ([data-locked-object-affordance], classified in
                                                                   // dom-input-source.ts), which keeps the hover in every phase (§2.2)
  | { readonly kind: 'owned-text' }                                // the text-entry host
  | { readonly kind: 'foreign' }

interface At { readonly t: number }
export type RawInput =
  | At & { kind: 'down'; id: number; pointer: PointerKind; role: ButtonRole; at: ScreenPoint; mods: Modifiers; target: TargetClass; detail: number; ctrlConsumed: boolean }
  | At & { kind: 'move'; id: number; pointer: PointerKind; at: ScreenPoint; mods: Modifiers; buttons: ReadonlySet<ButtonRole>; target: TargetClass
      buttonMask: number }                                                    // PointerEvent.buttons as delivered, every bit: the lens's held-button rule (§1.4 "Hover")
  | At & { kind: 'up'; id: number; pointer: PointerKind; role: ButtonRole; at: ScreenPoint; mods: Modifiers; target: TargetClass }
  | At & { kind: 'cancel'; id: number | 'all'; reason: 'pointercancel' | 'lost-capture' | 'blur' | 'hidden' }
  | At & { kind: 'leave' }                                                    // host pointerleave: hover-end (the host's passive hover; the tool decides on its preview)
  | At & { kind: 'focus-out' }                                                // host focusout: the host ends the nudge series
  | At & { kind: 'reject'; id: number }                                       // the session, on a GestureOutcome.rejectSession: ends that session with no gesture
  | At & { kind: 'wheel'; at: ScreenPoint; dxPx: number; dyPx: number; mods: Modifiers; pinch: boolean; target: TargetClass }
  | At & { kind: 'platform-gesture'; phase: 'start' | 'change' | 'end'; at: ScreenPoint; scale: number; rotationDeg: number }
  | At & { kind: 'native-contextmenu'; at: ScreenPoint | null; fromKeyboard: boolean; target: TargetClass }
  | At & { kind: 'key-state'; space: boolean; mods: Modifiers }               // from the KeyRouter
  | At & { kind: 'escape' }                                                   // from the Esc chain's 'gesture' layer
  | At & { kind: 'drop'; phase: 'over' | 'leave' | 'drop'; at: ScreenPoint; payload: CanvasDropPayload }
  | At & { kind: 'configure'; context: { readonly tool: ToolId; readonly mode: 'site' | 'overview'; readonly pointingDevice: 'mouse' | 'trackpad'; readonly dragSlopPx?: number } }
  | At & { kind: 'tick' }

export interface RecogniserConfig {
  readonly platform: InputPlatform
  readonly bindings: Bindings
  readonly thresholds: Thresholds
}

/** Applied by the source to the event it is handling. 'stop-propagation' (stopImmediatePropagation) and 'drop-effect' come from
 *  a GestureOutcome (§1.2a): a quarantine is 'prevent-default' plus 'stop-propagation'. */
export interface AdapterEffect {
  readonly kind: 'prevent-default' | 'stop-propagation' | 'capture' | 'release-capture' | 'set-timer' | 'clear-timer' | 'drop-effect'
  readonly pointerId?: number
  readonly atMs?: number
  readonly dropEffect?: 'copy' | 'move' | 'none'                // 'drop-effect': dataTransfer.dropEffect on dragover and drop
}
/** Opaque to callers; the recogniser owns its shape. Plain data (structured-clone safe), so the property test can snapshot it. */
export interface RecogniserState {
  readonly sessions: ReadonlyMap<number, PointerSession>        // by pointerId: pointer kind, role, mode ('pending' | 'primary' | 'pan' | 'rotate' | 'ignored'), start, last point, press target, slop passed, capture held
  readonly touchPair: TouchPair | null                          // two touch ids, their start centroid, distance and angle, twist arc accumulated
  readonly held: { readonly space: boolean; readonly mods: Modifiers }
  readonly trackpadTwistDeg: number                             // WebKit gesture rotation accumulated before the 10° threshold
  readonly deadlines: { readonly longPressAt: number | null; readonly menuEchoUntil: number | null; readonly windowsTrailUntil: number | null; readonly lastSecondaryEndAt: number | null }
  readonly context: { readonly tool: ToolId; readonly mode: 'site' | 'overview'; readonly pointingDevice: 'mouse' | 'trackpad'; readonly dragSlopPx: number | null }
}

// canvas/runtime/input/recognise.ts  (the recogniser: its state types and its two functions; raw-input.ts holds no function).
// PointerSession and TouchPair are imported only inside input/; RecogniserState is opaque to callers. raw-input.ts and
// recognise.ts import each other's types with `import type` only (no runtime cycle).
export function initialRecogniserState(): RecogniserState
export function recognise(state: RecogniserState, input: RawInput, config: RecogniserConfig):
  { readonly state: RecogniserState; readonly gestures: readonly Gesture[]; readonly effects: readonly AdapterEffect[] }

// canvas/runtime/input/normalise.ts
/** The fields normalise reads; a DOM event satisfies it structurally, and fixtures pass literals. */
export interface DomEventLike {
  readonly type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture' | 'pointerleave' | 'focusout'
    | 'wheel' | 'contextmenu' | 'gesturestart' | 'gesturechange' | 'gestureend' | 'dragover' | 'dragleave' | 'drop'
  readonly timeStamp: number
  readonly clientX: number; readonly clientY: number          // converted to host-relative CSS px by the source before normalise
  readonly pointerId?: number; readonly pointerType?: string; readonly button?: number; readonly buttons?: number; readonly detail?: number
  readonly shiftKey: boolean; readonly ctrlKey: boolean; readonly altKey: boolean; readonly metaKey: boolean
  readonly deltaX?: number; readonly deltaY?: number; readonly deltaMode?: number
  readonly scale?: number; readonly rotation?: number           // WebKit GestureEvent
  readonly target: TargetClass                                  // classified by the source from data attributes
  readonly fromKeyboard?: boolean                               // contextmenu: set by the source from the KeyRouter's echo record
  readonly dropPayload?: CanvasDropPayload                      // drag events: read by the source from dataTransfer
}
export function normalise(e: DomEventLike, platform: InputPlatform, bindings: Bindings, keys: { readonly physicalCtrl: boolean },
  host: { readonly width: number; readonly height: number }): RawInput | null   // host: CSS px, for page-mode wheels
```

Stages: `DomInputSource` (the only DOM listener owner for canvas input, including ruler presses, the document-capture `contextmenu` guard and, from phase F, the copied GeoLibre selection-drag guard) → `normalise` → `recognise` → `InputRouter` (navigation to `ViewNavigation`; menu requests, editing and drops to the `ToolHost`, the only opener of the context-menu port; a pointer-source pan's `at` to `ToolHost.notePointer`, §1.4 "Re-emit"). The router computes no geometry.

The way back: `route` returns the host's `GestureOutcome` (§1.2a); the source applies `quarantine` as `prevent-default` plus `stop-propagation`, `dropEffect` as `drop-effect`, and `rejectSession` by skipping the press's capture and feeding the recogniser `{ kind: 'reject', id }` (its later moves are hovers). A cancellation that throws with an edit open aborts the edit; the next press is still admitted. A sink that throws on a map-host press quarantines that event then rethrows; on any other event it rethrows and the event goes on. Every raw pointerdown also reaches `ToolHost.rawPress(button)` before routing (§1.4 "Raw presses"), so presses the host never sees as gestures still commit the nudge series and, for primary and middle, close the canvas menu and focus the map. See `input/dom-input-source.ts` and its tests for the exact fault matrix.

Window key listeners (keydown capture, keyup bubble) live in the source and go through `legacyKeys` to `keyboard-port.ts` until phase F replaces them with the key router (§1.6). Host `pointerleave` becomes `leave`, `focusout` becomes `focus-out`, window `blur` becomes `cancel('all', 'blur')`. Window `pointermove`/`pointerup`/`pointercancel` capture listeners stay installed from `attach` until phase F, which listens on window only during an owned session (plan §4 F).

Normalisation rules:
- Mouse `button` 0/1/2 → primary/auxiliary/secondary; 3 and 4 dropped. Pen tip → primary; barrel (2) → secondary when `penBarrel: 'secondary'`, else dropped; eraser (5) dropped. Touch → primary in every phase. These drop presses only: an `up` is never dropped, and one whose button no press takes (a mouse's 3 or 4, a pen's eraser, its barrel under `ignore`) is a primary `up`, so it ends its pointer's session whatever the button, as today's pointerup did (a pen drag whose tip lifts before its barrel commits).
- On `os: 'mac'` with `macCtrlClick: 'secondary'`, mouse button 0 with `ctrlKey && !metaKey` becomes secondary with `ctrlConsumed: true`. For that session the recogniser ignores `ctrl` in `move` mods and `key-state`.
- Wheel `deltaMode` is read before the deltas (16 px per line; a page is the host width for `deltaX` and the host height for `deltaY`). A wheel with `ctrlKey` and no physical Ctrl reported by the KeyRouter becomes `pinch: true`.
- Targets are classified from data attributes; the attribution control is `data-canvas-chrome` (`owned-chrome`).
- Rulers sit beside the map host, so the source listens at document capture for `pointerdown` on `[data-canvas-ruler]`. Under LEGACY a mouse or pen press of any button there is a primary `down` with a `ruler` target (today's ruler drag heard `mousedown`, which a pen sends too); a touch press there is dropped (a touch sends its `mousedown` only once it lifts).

### 1.2a Shared vocabulary and interaction ports (`canvas/runtime/interaction-types.ts`, `interaction-ports.ts`)

Input and tools share a vocabulary; neither may import the other (P5). Both import `interaction-types.ts`, whose only type-only imports are the two drag-payload types used by `CanvasDropPayload`; a later type may also import from `view/types.ts` or `scene/types.ts`, and nothing else. `interaction-ports.ts` types the composition and may import types from any runtime module (no tool module imports it), each import naming the type's defining module, never a barrel. Only `tools/tool-host.ts` (exempt from P5), `input/input-router.ts`, `input/dom-input-source.ts`, `interaction-session.ts` and `keyboard-port.ts` import it; D2–D4 and the lens depend on `ToolHost` through this file, not through `tool-host.ts`.

```ts
// canvas/runtime/interaction-types.ts  (types)
export type PointerKind = 'mouse' | 'pen' | 'touch'
export interface Modifiers { readonly shift: boolean; readonly ctrl: boolean; readonly alt: boolean; readonly meta: boolean }
export type CancelReason = 'pointercancel' | 'lost-capture' | 'blur' | 'hidden' | 'escape' | 'multitouch' | 'chord' | 'tool-change'
  | 'navigate'                                                  // a Pan-tool press whose drag panned: after its pan end (spec §2.2)
export type ToolId =
  | 'select' | 'hand' | 'plant-stamp' | 'text' | 'line' | 'measurement-guide' | 'rectangle' | 'ellipse'
  | 'polygon' | 'object-stamp' | 'saved-object-stamp' | 'plant-spacing'
// 'hand' is the Pan tool (label "Pan", key H). It stays in every phase (user).
/** 'rotate', 'vertex:<zone id>:<index>', 'rect-corner:<id>:ne', 'guide-end:<id>:a', 'edge-mid:<zone id>:<index>'. */
export type ToolHandleId = string & { readonly __toolHandleId: true }
/** What a panel drag carries, read from dataTransfer by the DOM source (today plant-stamp-source.ts and saved-object-stamp-source.ts). */
export type CanvasDropPayload =
  | { readonly kind: 'species'; readonly species: PlantStampSourceInput | null }   // null on dragover: the browser hides the data until the drop; the MIME type says species
  | { readonly kind: 'saved-stamp'; readonly stamp: SavedObjectStampPayload }
  | { readonly kind: 'unknown' }                                // over the map but not ours: no drop cue
// PlantStampSourceInput (canvas/plant-stamp-source.ts) and SavedObjectStampPayload are type-only imports.
```

```ts
// canvas/runtime/interaction-ports.ts  (types; implementations in input/ and tools/)

/** What a route answers for the event being handled; the source applies it. Every field optional; {} changes nothing. */
export interface GestureOutcome {
  /** preventDefault and stopImmediatePropagation (an unsettled scene, a refused drop). */
  readonly quarantine?: boolean
  /** dragover and drop: dataTransfer.dropEffect. */
  readonly dropEffect?: 'copy' | 'move' | 'none'
  /** A refused press: its capture is not taken and its recogniser session ends without a gesture (later moves are hovers). */
  readonly rejectSession?: boolean
}

export interface DomInputSourceDeps {
  readonly host: HTMLElement                                    // the map host; listeners attach here and on window (from attach until F; from F only during an owned session)
  readonly platform: InputPlatform
  readonly bindings: () => Bindings                             // CURRENT_BINDINGS in production
  readonly keys: { readonly physicalCtrl: () => boolean; readonly lastKeyboardMenuAt: () => number | null }   // the session's keyboard port, fed by the key router's keyState from F
  readonly clock: () => number
  readonly timers: { set(atMs: number, cb: () => void): number; clear(id: number): void }
  /** Until F: today's window keydown (capture) and keyup (bubble), handed to keyboard-port.ts; F's key router replaces it. */
  readonly legacyKeys?: { keydown(e: KeyboardEvent): void; keyup(e: KeyboardEvent): void }
  /** True when the session runs ruler drags: the source listens at document capture for ruler pointerdowns and hands them
   *  on as presses on a 'ruler' target. The session finds the pressed ruler's overlay and lands its guide itself (north-up
   *  only); the source carries no guide port. */
  readonly listensToRulers: boolean
}
export interface DomInputSource {
  /** Installs the listeners; returns the disposer that removes every listener it added (tested: exactly once each) and
   *  releases every pointer capture the source still holds (a press live at disposal), after the sink is gone. A sink
   *  that throws on a press on the map host quarantines that event, then rethrows; on any other event it rethrows and the
   *  event goes on. */
  attach(sink: (input: RawInput) => void): () => void
  /** Applies effects to the event being handled: the recogniser's, and a GestureOutcome's as 'prevent-default',
   *  'stop-propagation' and 'drop-effect'. */
  apply(effects: readonly AdapterEffect[]): void
  /** The DOM event being handled, or null: the session finds the pressed ruler's overlay from its target. */
  currentEvent(): Event | null
}

/**
 * An adapter over today's controller (`createCanvasContextMenu`, interaction/canvas-context-menu.ts), which builds the
 * app's CanvasContextMenuRequest (canvas/runtime/app-adapter.ts: anchor, world, retargeted selection, commands,
 * placePlantsAt, saveSelectionAsObjectStamp, returnFocus) and hands it to CanvasRuntimeAppAdapter.contextMenu.
 * The host fills the optional entries from its hit and tool state; the request type gains turnViewToEdge in phase 1 and finishShape in
 * phase 2, each with its first caller (no highlightEdge, U4).
 */
export interface ContextMenuPort {
  open(request: {
    readonly at: WorldPoint | 'selection'
    readonly source: MenuSource
    readonly screen: ScreenPoint | null
    readonly hit: HitTarget | null
    readonly turnViewToEdge?: () => void                        // phase 1: a zone-edge hit within the source's tolerance (§4.16); no edge highlight (U4)
    readonly finishShape?: () => void                           // phase 2: ToolHost.command({ kind: 'finish-shape' }) during a 3+ corner draft
  }): void
  close(): void
  readonly isOpen: () => boolean
}
export interface InputRouterDeps {
  readonly navigation: Pick<ViewNavigation, 'panByPx' | 'zoomAroundPx' | 'beginRotation'>
  readonly toolHost: ToolHost
}
export interface InputRouter {
  /** Routes one gesture: navigation → ViewNavigation, menu-request → ToolHost.menuAt (the host is the only menu opener), editing and drops → ToolHost.
   *  A pan from a pointer source (middle, Space, the Pan tool's and overview drags; not a wheel) also hands its `at` to
   *  ToolHost.notePointer, so the host's resting pointer moves with the pointer. Computes no geometry. */
  route(g: Gesture): GestureOutcome
}

/** Built by interaction-session.ts; everything the host needs, so tools stay narrow. */
export interface ToolHostDeps {
  readonly frames: ViewFrameSource                              // ToolView, re-emit on onViewFrame('tools'), plane changes
  readonly scene: ToolScene                                     // from createToolScene below
  readonly edits: SceneEditCoordinator
  readonly admission: SceneCommandAdmission                     // presses, menus, drops and commands run when settled (today's quarantine)
  readonly settled: SettledSceneReader                          // dragover reads
  /** History-free, dirty-free selection (today's deps.setSelection/clearSelection); backs ToolEffects.setSelection and the menu retarget. */
  readonly setSelection: (targets: readonly SceneDesignObjectTarget[]) => void
  readonly plane: () => SessionPlane                            // CanvasTool.planeChanged when its identity changes
  readonly renderer: Pick<SceneRenderer, 'setDraft' | 'setSelectionPreview'>
  /** Redraw request after a tool call that mutated an open transaction or changed its draft or handles. */
  readonly invalidate: () => void
  readonly chrome: {
    setHandles(h: readonly ToolHandle[], active: ToolHandleId | null): void; setCursor(c: string): void
    requestTextEntry(r: TextEntryRequest, submit: (text: string) => 'close' | 'keep', onCancel?: () => void): void; closeTextEntry(): void
    /** Submits an open entry that no longer holds focus (its blur commit was refused), which the map taking focus cannot
     *  blur again; an entry that holds focus is left to that blur. A press or a menu calls it before focusing the map. */
    submitUnfocusedTextEntry(): void
    /** Today's hasActiveEditor(), read live wherever the host needs the entry's state (handles hidden while it is open, the
     *  'text-entry-closed' focus reason on the next press); the host keeps no flag of its own. Esc in the entry stays the
     *  entry's own element handler, which calls the request's onCancel once the entry is gone. */
    isTextEntryOpen(): boolean
    setTooltip(t: { readonly at: ScreenPoint; readonly lines: readonly string[] } | null): void   // chrome/hover-tooltip.ts; this shape from phase R
    // R2: the tooltip takes lines of text, a plant under the pointer winning over a layer readout, so analysis readouts reuse it
    /** chrome/locked-affordance.ts; its factory takes onUnlock, wired by interaction-session.ts. */
    setLockedAffordance(a: { readonly target: SceneDesignObjectTarget; readonly at: ScreenPoint } | null): void
  }
  readonly menu: ContextMenuPort                                // opened only by the host (menuAt)
  readonly focus: CanvasFocusPort                               // ToolEffects.requestFocus
  readonly guidance: (g: Partial<CanvasToolGuidance> | null) => void
  readonly toolState: { readonly active: ReadonlySignal<ToolId>; set(id: ToolId): void }   // the session's tool signal
  readonly settings: ToolSettingsPort
  /** Settings › Canvas: Snap to grid and Snap to guides, read at each point (interaction-session.ts wires the runtime settings
   *  adapter's readSnapToGridEnabled and readSnapToGuidesEnabled); the shape tools/snapping.ts takes. */
  readonly snapping: () => { readonly grid: boolean; readonly guides: boolean }
  readonly translate: ToolContext['translate']
  // bindings and platform (modifier resolution, phase 2) and navigation.turnToEdge (the menu entry, phase 1) come with their
  // first callers.
  /** Today's deps.nudge (the runtime's scene-edit commands); the host owns the series (nudge below). */
  readonly nudge: Pick<CanvasSceneEditCommandSurface, 'nudgeSelected' | 'endNudge'>
  readonly timers: { set(atMs: number, cb: () => void): number; clear(id: number): void; readonly clock: () => number }
  /** Hover restyle and the locked-object affordance: today's deps.setHoveredTarget. */
  readonly hover: (target: SceneDesignObjectTarget | null) => void
  /** The raster inspection probe (CanvasRuntimeAppAdapter.tryInspectAt, passed by scene-runtime.ts); true claims the press (fixture J10). */
  readonly inspect?: (world: WorldPoint) => boolean
  /** Today's notifyTransientHistoryChange: the runtime's transientHistory revision (Edit › Undo during a draft). */
  readonly transientHistoryChanged: () => void
  /** A drop the host placed, once its edit committed, Select is armed and the map has focus (§1.4 "Drops"): the session clears
   *  the saved stamp's drag source after a saved-stamp drop and focuses the map again on the next animation frame, after the
   *  browser's drag end (cancelled by a window blur, a document replacement and dispose), as today's drop did. */
  readonly dropped: (kind: 'species' | 'saved-stamp') => void
}

export function createToolHost(deps: ToolHostDeps): ToolHost    // tools/tool-host.ts; its tests put stub tools in through a vi.mock of tools/registry.ts
/** tools/tool-host.ts re-exports these factories (createToolScene is implemented in tools/spatial-index.ts over today's hit tests;
 *  createContextMenuPort wraps interaction/canvas-context-menu.ts), so interaction-session.ts builds the ToolScene and
 *  ToolHostDeps.menu while importing only the host (P5b). */
export function createToolScene(source: ToolSceneSource): ToolScene
/** Besides today's controller options, the port reads the ToolScene and the selection model, from which open() rebuilds
 *  today's three menu states (openAtPointer with and without a selection, openFromKeyboard). */
export function createContextMenuPort(/* today's createCanvasContextMenu options, the ToolScene and a selection-model reader */): ContextMenuPort
/** What createToolScene reads (tools/tool-host.ts re-exports the factory). Hit tests need the scale and the plant presentation
 *  for screen-sized plants and notes; the hovered note comes from store.session.hoveredTarget. Nothing is cached. */
export interface ToolSceneSource {
  readonly store: SceneStateReader                              // the runtime's scene store
  readonly selection: () => SceneDesignObjectSelection
  readonly isLayerOpenForCreation: (layer: SceneLayerKind) => boolean
  readonly pixelsPerMetre: () => number                         // frame.view.pixelsPerMetre: exact at bearing 0 (metresPerPixelAt is not)
  readonly speciesCache: () => ReadonlyMap<string, SpeciesCacheEntry>
  readonly plantContext: (pixelsPerMetre: number) => PlantPresentationContext   // incl. localised common names
  readonly selectionModel: () => CanvasDesignObjectSelectionModel               // querySurface.getDesignObjectSelection
}

export interface ToolHost {
  /** Editing gestures, hovers and drops (drops go to the host's shared drop handler, whatever tool is armed); converts to world at event time. */
  gesture(g: Gesture): GestureOutcome
  command(c: ToolCommand): ToolReply
  /** Hits, retargets and opens the canvas menu through ToolHostDeps.menu; quarantines a menu the scene does not admit. */
  menuAt(at: ScreenPoint | 'selection', source: MenuSource): GestureOutcome
  setTool(id: ToolId, source: ToolSource | null): void
  /** A new source for the armed tool (the session's read-model bridge): forwards to CanvasTool.sourceChanged. */
  sourceChanged(source: ToolSource | null): void
  readonly activeTool: ReadonlySignal<ToolId>
  /** The active tool's dragSlopPx, sent in the recogniser's configure on every tool change. */
  activeToolDragSlopPx(): number | null
  /**
   * Presses the host never sees as gestures: the session calls it for every raw pointerdown on the map host before routing it
   * (from the source's raw input, not a gesture; the down's role, 'auxiliary' as 'middle'). Commits the nudge series for any
   * button. For an admitted primary or middle press outside the text entry ('owned-text') and the Unlock affordance, with no
   * live press from another pointer id, it also closes the canvas menu and focuses the map (so an open text
   * entry commits on its blur): today's _onPointerDown conditions.
   */
  rawPress(button: 'primary' | 'secondary' | 'middle', target: TargetClass, pointerId?: number): void
  /**
   * Where the pointer is during a pointer-source pan (the router, from the pan's `at`): updates the host's stored resting
   * pointer and emits nothing; the next camera frame re-emits at the updated point, so a ghost stays under the pointer (today
   * it keeps its world point). Wheel and key pans leave the resting pointer where it is. null: no pointer rests on the map.
   */
  notePointer(screen: ScreenPoint | null): void
  /** Scene or selection changed outside a tool call (select all, undo, menu commands, nudges): refresh handles and decorations. */
  sceneChanged(): void
  /** A pointer release that ended no press of the tool's, reported by the session after routing it (§1.4 "Releases"): the
   *  end or cancel of a pointer pan, an up with no press of the map's. Runs today's pointerup cancellation with the tool's
   *  cancelTransient('navigate'); a press of the tool's still live is left to its own release. */
  released(): void
  /** The open text entry's mode ('create': a new note's field, 'edit': the in-place editor), null with none open. The
   *  keyboard port's Space hold reads it: a 'create' entry, focused or not, arms no pan (§1.4 "Releases"). */
  openTextEntryMode(): 'create' | 'edit' | null
  // Esc chain queries (CanvasKeyboardPort reads these)
  hasLiveGesture(): boolean
  activeToolHasTransient(): boolean
  activeToolIsSelect(): boolean
  escapeHint(): 'drop-transient' | 'leave-tool' | 'clear-selection' | null
  /**
   * Arrow nudge, the one owner of the series: with a selection, the Select tool and site mode, turns the screen direction
   * into a world delta along screenAxesInWorld() (0.1 m, or 1 m when large), calls deps.nudge.nudgeSelected and (re)starts
   * the 800 ms idle timer that commits the series ('handled'). 'refused': the runtime refused the nudge, and the key is
   * swallowed (today). 'pass': Select is not armed, the map is in overview or nothing is selected; the key goes on to the
   * keyboard port's arrow rule (§3.6: with nothing selected it pans; otherwise the key is not consumed).
   */
  nudge(direction: ScreenPoint, large: boolean): 'handled' | 'refused' | 'pass'
  hasNudgeSeries(): boolean                                     // the Esc layer 65
  endNudgeSeries(commit: boolean): void                         // Esc aborts; idle, focusout, a press or another key commit
  /**
   * Today's _cancelInterruptedInteraction, which the session calls on window blur after feeding the recogniser (which releases
   * Space and ends the live sessions): commits the nudge series, clears the passive hover, the tooltip and the locked
   * affordance, calls the active tool's cancelTransient('navigate') (a tool that keeps its draft through a pan keeps it
   * here too) and resets the cursor to the tool's. A cancellation that throws with an edit open aborts the edit.
   */
  interrupted(): void
  /** Transient history (today's canUndo/…TransientHistory): sends the active tool the 'undo-transient' and 'redo-transient' commands and
   *  reads its canUndoTransient?/canRedoTransient?; revision bumps after every call into the tool and after a deferred onCommitted. */
  readonly transientHistory: {
    readonly revision: ReadonlySignal<number>
    canUndo(): boolean; canRedo(): boolean; undo(): boolean; redo(): boolean
  }
  prepareForDocumentReplacement(): void                         // deactivate('document-replaced') and drop live sessions
  refreshTranslations(): void                                   // re-publishes guidance and handle labels
  /** Every hover whose target is the map (`surface`), before the overview and hover-suppression filters; null on hover-end
   *  (the pointer left the map; from F also a move over owned chrome, the text entry or a handle, never the Unlock
   *  affordance). A hover over owned chrome, a ruler or anything off the map publishes nothing, and a move over the text
   *  entry, a handle or the Unlock affordance emits no gesture before F, so the lens keeps its point there, as today's
   *  lens skips buttons, inputs, textareas, contenteditable and [data-preserve-overlays] (spec §1.4 "Hover", §2.2 "Hover").
   *  A hover made with a button held is published too: the interaction session's subscribePointerWorld drops it (its raw
   *  buttonMask, as today's lens skipped a move with any button held). For the inspection lens, the status line and, later, hover
   *  readouts over analysis results: with the screen point (R1), so a readout can call queryRenderedFeatures without a
   *  map.project (P2). */
  subscribePointerWorld(listener: (point: PointerWorld | null) => void): () => void
  dispose(): void
}
export interface PointerWorld { readonly world: WorldPoint; readonly screen: ScreenPoint }
// canvas/runtime/keyboard-port.ts  (from F its deps are flattened; the key router feeds it, §1.6)
export interface CanvasKeyboardPortDeps {
  readonly host: HTMLElement
  readonly toolHost: ToolHost
  /** Today's getSelection().length > 0, read per key: on a 'pass' nudge the arrow pans with nothing selected and is let through
   *  otherwise; the Esc 'selection' layer is live while it holds. */
  hasSelection(): boolean
  /** Arrow pans (64 or 256 px), + / −, N, Shift+N and Shift+←/→/↑. */
  readonly navigation: Pick<ViewNavigation, 'panByPx' | 'zoomIn' | 'zoomOut' | 'resetNorth' | 'rotateBy'>
  readonly frames: ViewFrameSource
  pointerSessionLive(): boolean              // arrows and the Menu key wait; Esc cancels it; keyState's hold and 'pass-live'
  overview(): boolean                        // Esc runs the interrupted cancel; the Menu key and the tool keys do nothing
  spaceHeld(): boolean
  setHeldKeys(state: { readonly space: boolean; readonly mods: Modifiers }): void   // the recogniser's key state and the navigation cursor
  escapeGesture(): void                      // the recogniser's 'escape': cancels a live pointer session, releases Space
  requestTool(id: ToolId): void              // the Esc chain's Select (the runtime's setTool, as a tool's own request)
  clearSelection(): void                     // the Esc chain's last step: history-free, redrawn
}
/** The session's own view of the port: DomInputSourceDeps.keys and the blur release. */
export interface SessionCanvasKeyboardPort extends CanvasKeyboardPort {
  physicalCtrl(): boolean
  lastKeyboardMenuAt(): number | null
  releaseKeys(): void
}
export function createCanvasKeyboardPort(deps: CanvasKeyboardPortDeps): SessionCanvasKeyboardPort
```

Until F `CanvasKeyboardPort` is fed by the source's `legacyKeys` (§1.2) with today's canvas key gating (`keyboard-port.ts`). **From F** (§1.6; no legacy rebuild, U7) the key router feeds it in the target form instead: `keyState` first for every key, then the keymap's canvas rows through `command()` and the canvas Esc layers; the router applies the single-key gate (`KeyRouterDeps.singleKeys`) and the port the state gates (pointer session, overview, Select). An arrow still asks `ToolHost.nudge` first (never while a pointer session is live, fixture H25) and falls through to the arrow rule (§3.6) on `'pass'`. `workspace-runtime-composition.ts` exposes a forwarding `keyboard` port that reaches the session's port once `runtime.init` creates it.

### 1.3 Gestures (`canvas/runtime/input/gestures.ts`)

```ts
export type NavigationSource =
  | 'secondary-drag' | 'auxiliary-drag' | 'space-drag' | 'primary-drag'   // primary-drag: the Pan tool (and legacy overview)
  | 'wheel' | 'trackpad-pinch' | 'trackpad-twist' | 'touch-two-finger'

export type MenuSource = 'mouse' | 'ctrl-click' | 'pen-barrel' | 'long-press' | 'keyboard' | 'native'
// CancelReason, PointerKind, Modifiers, ToolHandleId, CanvasDropPayload: from ../interaction-types.ts (§1.2a); TargetClass: from ./raw-input.ts (§1.2)

export type PressTarget =
  | { readonly kind: 'surface' }
  | { readonly kind: 'handle'; readonly id: ToolHandleId }
  | { readonly kind: 'ruler'; readonly axis: 'h' | 'v' }

export type Gesture =
  // editing: primary role only; the ToolHost converts to world space
  /** target: the class the recogniser saw under the pointer; the host publishes to subscribePointerWorld only for 'surface'. */
  | { kind: 'hover'; at: ScreenPoint; pointer: PointerKind; mods: Modifiers; target: TargetClass }
  | { kind: 'hover-end' }
  | { kind: 'press'; id: number; at: ScreenPoint; pointer: PointerKind; mods: Modifiers; clickCount: number; target: PressTarget }
  | { kind: 'tap'; id: number; at: ScreenPoint; pointer: PointerKind; mods: Modifiers; clickCount: number; target: PressTarget }
  | { kind: 'drag-start'; id: number; from: ScreenPoint; at: ScreenPoint; pointer: PointerKind; mods: Modifiers; target: PressTarget }
  | { kind: 'drag-move'; id: number; at: ScreenPoint; mods: Modifiers }
  | { kind: 'drag-end'; id: number; at: ScreenPoint; mods: Modifiers }
  | { kind: 'drop'; phase: 'over' | 'leave' | 'drop'; at: ScreenPoint; payload: CanvasDropPayload }
  // navigation: never reaches tools
  /** deltaPx is content movement (the ground follows the pointer). at: the pointer's screen point for a pointer source (every
   *  source but 'wheel'), which the router hands to ToolHost.notePointer; absent for a wheel pan. */
  | { kind: 'pan'; phase: 'start' | 'move' | 'end'; deltaPx: ScreenPoint; source: NavigationSource; at?: ScreenPoint }
  | { kind: 'zoom'; anchorPx: ScreenPoint; factor: number; source: NavigationSource }
  | { kind: 'rotate'; phase: 'start' | 'move' | 'end' | 'cancel'; anchorPx: ScreenPoint; totalDeltaDeg: number; step: boolean; source: NavigationSource }
  // requests
  | { kind: 'menu-request'; at: ScreenPoint | 'selection'; source: MenuSource }
  | { kind: 'cancel'; reason: CancelReason }
```

`hover-end` comes from `leave`, and from F also from a button-less move over owned chrome, the text entry or a handle, never over the Unlock affordance (U6); before F such a move emits nothing or an ordinary `hover` (§2.2 "Hover"). A `hover` carries the target class the recogniser saw, so the host feeds `subscribePointerWorld` only over the map (§1.4 "Hover"); a pointer-source `pan` carries the pointer's screen point, so the router can move the host's resting pointer (§1.4 "Re-emit"). A `cancel('navigate')` ends a Pan-tool press whose drag panned (§2.2 "Primary"). Under LEGACY `clickCount` is the platform's pointerdown `detail` as delivered (0 in jsdom), never counted by the recogniser, so a double-click selects a species only when the platform says so, as today; Select keeps its own 500 ms / 6 px note-edit rule. A `drop` reaches the host's shared drop handler, not the active tool (§1.4).

### 1.4 Tools (`canvas/runtime/tools/`)

```ts
// canvas/runtime/tools/tool.ts  (the tool contract; with interaction-types.ts, where tool implementations get their shared types)
// Every import below is `import type`, each from the module that defines the type, never from a barrel (scene/index.ts):
//   ../interaction-types.ts: ToolId, PointerKind, CancelReason, ToolHandleId (§1.2a)
//   ./draft.ts: DraftPresentation, SelectionPreview, ToolHandle
//   ../view/types.ts: WorldPoint, WorldVector, WorldQuad
//   ../scene/types.ts: ScenePersistedState, ScenePlantEntity, SceneLayerEntity
//   ../scene/design-object-targets.ts: SceneDesignObjectTarget, SceneDesignObjectSelection
//   ../scene-runtime/transactions.ts: SceneEditCoordinator
//   ../scene-runtime/arrangement-placement.ts: SceneArrangementTemplate
//   ../runtime.ts: CanvasDesignObjectSelectionModel
//   ../../session-state.ts: CanvasToolGuidance
//   ../../plant-stamp-source.ts: PlantStampSourceInput; ../../saved-object-stamp-payload.ts: SavedObjectStampPayload
// P5 allows all of them (it forbids view/** values, not type-only view/types.ts, and names none of the others). P5c holds
// because no listed module reaches maplibre-gl, pixi.js or src/maplibre/**, even through type-only edges, which
// forbid-transitive-imports follows. Tool implementations import these types from tool.ts, draft.ts or the same defining
// modules. Any later type import must keep P5c true.

/** Modifiers by meaning, resolved per platform and per phase by the ToolHost. */
export interface ToolModifiers {
  /** Toggle into the selection: Shift, or mod (Cmd on Mac, Ctrl elsewhere). */
  readonly additive: boolean
  /** Remove from the selection: Alt (phase 2). */
  readonly subtractive: boolean
  /** Shift. Every phase: Polygon and Plant a row 45° steps; the rotate handle's 15° steps from the press angle. Phase 2 adds square/circle for Rectangle and Ellipse and 45° screen steps for Line and Measure. */
  readonly constrain: boolean
  /** Alt, reserved (unused). */
  readonly fromCentre: boolean
  /** Plant a row only. LEGACY/ROTATION: Shift. Phase 2: mod held during the drag. */
  readonly noSnap: boolean
}

export interface ToolPoint {
  readonly world: WorldPoint       // raw plane metres (for a tool with clampsToView, from the screen point clamped to the view)
  /** world snapped to grid and guides without the constraint: Polygon's close test under LEGACY (today snap(raw)). Equals world when snap is off. */
  readonly free: WorldPoint
  /** world after the tool's constraint (CanvasTool.constraint, Shift): 'direction' turns origin → point to the step and keeps the length; 'rotation-delta' turns the point about the pivot so the angle since the press is a step multiple. Equals world when none applies. */
  readonly constrained: WorldPoint
  /** Grid and guides on world axes (user). Order per §2.3: LEGACY and ROTATION keep today's (Polygon snaps, then constrains; a Plant a row Shift is also no-snap); V2 constrains, then snaps the length along the ray. Equals constrained when snap is off, noSnap is held or the constraint is 'rotation-delta'. */
  readonly snapped: WorldPoint
  readonly modifiers: ToolModifiers
  readonly pointer: PointerKind
}

/** What a hit query returns: a design object, or a part of one. */
export type HitTarget =
  | { readonly kind: 'object'; readonly target: SceneDesignObjectTarget }                          // scene/design-object-targets.ts
  | { readonly kind: 'zone-edge'; readonly zoneId: string; readonly edgeIndex: number; readonly distancePx: number }
  | { readonly kind: 'guide'; readonly guideId: string }
/** No filter is today's hitTestTopLevel exactly: interactive layers, a group as the top-level target, guides, the revealed
 *  (selected or hovered) note, and object-locked objects, which the caller rejects itself (Select shows Unlock). */
export interface HitFilter {
  readonly kinds?: readonly SceneDesignObjectTarget['kind'][]
  /** hitAt: also locked layers that are visible (today's hitTestVisibleTopLevel, the host's hover). hitInQuad: a phase-1
   *  feature; until then the façade throws a clear error (the band select skips locked layers). */
  readonly includeLocked?: boolean
  /** A phase-1 feature (the zone-edge hits of "Turn view to this edge", spec §4.16), converted at the frame's pixelsPerMetre;
   *  until then the façade throws a clear error (the hit tests carry their own tolerances). */
  readonly toleranceScreenPx?: number
}
/** The selection read model: today's CanvasDesignObjectSelectionModel (canvas/runtime/runtime.ts:48), unchanged. */
export type SelectionReadModel = CanvasDesignObjectSelectionModel
/** Layer names as stored (SceneLayerEntity.name): 'plants', 'zones', 'annotations', 'measurements', … A `string`; narrowing it
 *  to the known names is a later, optional change. */
export type SceneLayerKind = SceneLayerEntity['name']
/**
 * A preview of what a placement would create, drawn with the draft by the scene's own drawing code (plan §4, "Conventions still in force").
 * The entities are already where a click would put them: the tool builds the plant as a click would (today plantEntityFromStampSource)
 * and applies the stamp's offset and held rotation to the template (today objectStampEntities and rotateStampEntities).
 * `anchor` and `rotationDeg` describe the pick for tests and guidance; the renderer never re-applies them.
 * A plant ghost is the plant's mark only: the Place plants mature-width ring, its label and the nearest-plant guide are ellipse, label and polyline shapes.
 * mark 'symbol' (default) draws the plant's symbol; 'dot' draws Plant a row's look: a filled disc in the plant's display colour with a 2 px
 * border of the same colour, radius half the plant's world AABB (today plant-spacing-overlay.ts:158-181; Plant a row emits its row ghosts
 * with 'dot' at opacity 0.35). Colours come from the scene's plant presentation, never a raw colour in the draft. `sizeFrom` is the point
 * whose plant presentation gives a 'dot' its radius: Plant a row passes its source plant's position, so every disc in the row has the
 * source's size, as today (plant-spacing-tool.ts:423-427); without it the ghost's own position is used.
 * Object and saved-stamp ghosts draw zones and plants at 0.62 and notes at 0.68 today: the tool emits the notes as a second 'objects'
 * ghost at 0.68 (the draft layer multiplies by each note's own marker and text opacity).
 */
export type GhostEntity =
  | { readonly kind: 'plant'; readonly plant: ScenePlantEntity; readonly mark?: 'symbol' | 'dot'; readonly sizeFrom?: WorldPoint }
  | { readonly kind: 'objects'; readonly anchor: WorldPoint; readonly rotationDeg: number; readonly template: SceneArrangementTemplate }  // stamp pick, saved stamp
/** A note's text entry; the host owns the textarea. The tool card's spacing field is not one (it sends spacing commands). */
export interface TextEntryRequest {
  readonly anchor: WorldPoint
  readonly rotationDeg: number                     // stored note rotation; the host draws the textarea at rotationDeg − bearing
  readonly initialText: string
  readonly placeholderKey: string
  /** 'create': today's new-note field (--text-base, line-height 1.4); 'edit': the in-place editor (the note's font size, line-height 1.25, select-all). */
  readonly mode: 'create' | 'edit'
  readonly fontSizePx?: number                     // 'edit': the note's stored font size
}

export type ToolGesture =
  | { readonly kind: 'hover'; readonly point: ToolPoint; readonly hit: HitTarget | null }
  | { readonly kind: 'hover-end' }
  | { readonly kind: 'press'; readonly point: ToolPoint; readonly hit: HitTarget | null; readonly clickCount: number }
  | { readonly kind: 'tap'; readonly point: ToolPoint; readonly hit: HitTarget | null; readonly clickCount: number }
  | { readonly kind: 'drag-start' | 'drag-move' | 'drag-end'; readonly point: ToolPoint; readonly start: ToolPoint; readonly startHit: HitTarget | null }
  | { readonly kind: 'handle-drag'; readonly phase: 'start' | 'move' | 'end'; readonly handle: ToolHandleId; readonly point: ToolPoint; readonly start: ToolPoint }
  | { readonly kind: 'cancel'; readonly reason: CancelReason }
// Drops are not tool gestures: the host's shared drop handler serves every tool (§1.4).

export type ToolCommand =
  | { readonly kind: 'escape' }                                    // only when the tool's Esc layer is top
  | { readonly kind: 'confirm' }                                   // Enter (polygon: finish)
  | { readonly kind: 'remove-last' }                               // Backspace
  | { readonly kind: 'rotate-held'; readonly stepDeg: 15 | -15 }   // [ ] while a stamp is held
  | { readonly kind: 'place-at'; readonly world: WorldPoint }      // context menu "Place plants here": snapped by the host; dropped in overview
  | { readonly kind: 'finish-shape' }                              // phase 2: context menu "Finish shape" during a polygon draft, with its first caller
  | { readonly kind: 'delete-handle' }                             // Delete on a focused or selected zone corner (phase 2)
  | { readonly kind: 'edit-text' }                                 // Enter / F2 on one selected note
  | { readonly kind: 'undo-transient' } | { readonly kind: 'redo-transient' }
  // The tool card's Plant a row spacing field (CanvasToolCommandSurface.plantRowSpacing, forwarded by the session):
  | { readonly kind: 'spacing-input'; readonly text: string }                 // typing: the preview follows a valid spacing
  | { readonly kind: 'spacing-commit'; readonly via: 'enter' | 'blur' }       // keeps a valid spacing; Enter returns focus to the map, blur moves none
  | { readonly kind: 'spacing-cancel' }                                       // Esc in the field: drops the source, focus to the map

/** A 'handled' hover clears and skips the host's passive hover (restyle, tooltip, Unlock affordance); 'pass' lets it run. */
export type ToolReply = 'handled' | 'pass'

/** Read-only view queries: everything a tool may know about the camera. */
export interface ToolView {
  readonly bearingDeg: number
  readonly mode: 'site' | 'overview'
  metresPerPixelAt(p: WorldPoint): number
  screenDistance(a: WorldPoint, b: WorldPoint): number
  screenAxesInWorld(at?: WorldPoint): { readonly right: WorldVector; readonly down: WorldVector }
  /** Screen-aligned rectangle from two world corners: rotationDeg = normaliseBearing(bearing). Shift's square and circle use `square`. */
  screenAlignedRect(a: WorldPoint, b: WorldPoint, options?: { readonly square?: boolean; readonly fromCentre?: boolean }):
    { readonly center: WorldPoint; readonly width: number; readonly height: number; readonly rotationDeg: number }
}
// Angle constraints are not a ToolView query: the host applies them (CanvasTool.constraint), so ToolPoint.snapped is always right.

/** Read-only scene queries: a façade over the linear hit tests at the frame's pixelsPerMetre (an index may come later). */
export interface ToolScene {
  readonly persisted: Readonly<ScenePersistedState>
  hitAt(world: WorldPoint, filter?: HitFilter): HitTarget | null
  hitInQuad(quad: WorldQuad, filter?: HitFilter): readonly HitTarget[]
  nearestPlant(world: WorldPoint, excluding?: ReadonlySet<string>): { readonly plant: ScenePlantEntity; readonly distanceM: number } | null
  /** How the scene presents a plant (or a species by canonical name) now: the name in today's order (localised, stored common,
   *  canonical), the display colour and the symbol radius in CSS px. For tool-card names, row glyphs and the source ring. */
  plantPresentation(plant: ScenePlantEntity | string): { readonly commonName: string; readonly color: string; readonly radiusPx: number } | null
  isLayerOpenForCreation(layer: SceneLayerKind): boolean
  selection(): SceneDesignObjectSelection
  selectionModel(): SelectionReadModel         // read per call, not cached (as today)
}

/** The only way a tool changes anything. */
export interface ToolEffects {
  readonly edits: SceneEditCoordinator                      // unchanged transaction API (begin/run/mutate/setSelection/commit/abort)
  /** History-free, dirty-free selection: click, band, clearing (today's session setSelection; a transaction's setSelection records an undo step). */
  setSelection(targets: readonly SceneDesignObjectTarget[]): void
  setDraft(draft: DraftPresentation | null): void           // world-space; drawn by the renderer
  setSelectionPreview(preview: SelectionPreview | null): void   // phase R (move-drags), with its first caller
  setHandles(handles: readonly ToolHandle[]): void          // DOM handle layer; hit by the source
  setGuidance(guidance: Partial<CanvasToolGuidance> | null): void
  setCursor(cursor: 'default' | 'crosshair' | 'copy' | 'move' | 'not-allowed' | 'rotate' | 'grab' | 'grabbing'): void
  requestTool(id: ToolId): void
  /** Opens the host's text entry; submit runs on Enter and on blur and keeps the field open on 'keep' (a refused commit). */
  requestTextEntry(request: TextEntryRequest, submit: (text: string) => 'close' | 'keep', onCancel?: () => void): void  // onCancel: closed by its own Esc
  closeTextEntry(): void
  requestFocus(target: 'map'): void                         // ToolHostDeps.focus (CanvasFocusPort, §1.6), implemented by the FocusOwner from F
  // requestMenu and requestFocus('tool-card-field') come only with a first caller.
}

export interface ToolSettingsPort {
  plantSpacingIntervalM(): number
  commitPlantSpacingIntervalM(metres: number): void
}

export interface ToolContext {
  readonly view: ToolView
  readonly scene: ToolScene
  readonly effects: ToolEffects
  readonly settings: ToolSettingsPort
  /** The host's grid and guide snapping of any world point (the move-drag snaps the dragged object's reference point, not the pointer). */
  snap(point: WorldPoint): WorldPoint
  now(): number                                         // the host's clock (ToolHostDeps.timers.clock): double-click windows
  readonly translate: (key: string, options?: Readonly<Record<string, unknown>>) => string
}

export interface CanvasTool {
  readonly id: ToolId
  readonly dragSlopPx?: number                    // per-tool threshold, sent through `configure` on every tool change (Plant a row: 0; it measures today's 4 px itself)
  /** True while the tool's next release must be admitted by the scene (Select's band: today's requiresSettledPointerUp). */
  settledRelease?(): boolean
  readonly clampsToView?: boolean                 // the host clamps the screen point to the view before converting (Plant a row)
  /**
   * The constraint for the next point while Shift (modifiers.constrain) is held, or null. 'direction': the last polygon
   * corner, the row source, the line or guide start; the host turns origin → point to stepDeg against the screen axes
   * (identical to world axes at bearing 0) and keeps the length. 'rotation-delta': the rotate handle; the angle turned
   * about the pivot since startDeg rounds to stepDeg (relative steps, as today, bearing-independent). Order with
   * snapping: §2.3.
   */
  constraint?(): ToolConstraint | null
  activate(ctx: ToolContext, source: ToolSource | null): void
  /** A new source arrives while armed (species picked again, saved stamp changed). */
  sourceChanged?(source: ToolSource | null): void
  gesture(g: ToolGesture): ToolReply
  command(c: ToolCommand): ToolReply
  /** Scene or selection changed outside the tool (undo, remote edit). */
  sceneChanged?(): void
  /** The session plane changed (re-origin): re-project retained world points (corners, redo stack, row source) with reproject. */
  planeChanged?(reproject: (p: WorldPoint) => WorldPoint): void
  /** A camera frame on which the host re-emitted nothing (the pointer off the map): rebuild a draft whose look depends on the
   *  scale, such as the polygon's edge chips hidden below 36 px (today's refreshViewportDependent). */
  viewChanged?(): void
  /** True while the tool holds something Esc should drop first (draft, pick, row source). */
  hasTransient(): boolean
  /** Esc hint for the tool card, read by describeEscape. */
  escapeHint(): 'drop-transient' | 'leave-tool' | 'clear-selection' | null
  cancelTransient(reason: 'escape' | 'tool-change' | 'document-replaced' | 'navigate' | 'overview'): void   // 'overview': the map entered overview; drop what today's overview reset dropped (a stamp keeps its pick and hides only its ghost)
  /** Transient history (polygon corners), read by ToolHost.transientHistory; the tool acts on the undo-transient and redo-transient commands. */
  canUndoTransient?(): boolean
  canRedoTransient?(): boolean
  deactivate(reason: 'switch' | 'document-replaced' | 'dispose'): void
}

export type ToolConstraint =
  | { readonly kind: 'direction'; readonly origin: WorldPoint; readonly stepDeg: 45 }
  | { readonly kind: 'rotation-delta'; readonly pivot: WorldPoint; readonly startDeg: number; readonly stepDeg: 15 }

/** Arming payloads that today arrive through module-level signals. */
export type ToolSource =
  | { readonly kind: 'species'; readonly species: PlantStampSourceInput }
  /** name (from F): armCanvasTool writes it for the tool card (readSavedObjectStampName); the tool ignores it;
   *  sources the session rebuilds from the read models omit it. */
  | { readonly kind: 'saved-stamp'; readonly stamp: SavedObjectStampPayload; readonly name?: string | null }
```

```ts
// canvas/runtime/tools/draft.ts  (world-space presentations)
export type DraftShape =
  | { readonly kind: 'polyline'; readonly points: readonly WorldPoint[]; readonly style: DraftStroke }
  | { readonly kind: 'polygon'; readonly points: readonly WorldPoint[]; readonly style: DraftStroke; readonly fill?: DraftFill }
  | { readonly kind: 'quad'; readonly corners: WorldQuad; readonly style: DraftStroke; readonly fill?: DraftFill }   // band select
  | { readonly kind: 'ellipse'; readonly center: WorldPoint; readonly radiusX: number; readonly radiusY: number; readonly rotationDeg: number; readonly style: DraftStroke; readonly fill?: DraftFill }
  | { readonly kind: 'circle-px'; readonly center: WorldPoint; readonly radiusPx: number; readonly style: DraftStroke }
  | { readonly kind: 'ghost'; readonly entity: GhostEntity; readonly opacity: number }
  | { readonly kind: 'label'; readonly anchor: WorldPoint; readonly offsetPx: ScreenPoint; readonly text: string; readonly tone: 'measure' | 'measure-quiet' | 'hint' | 'hint-primary' | 'warning' }  // upright chip
// A label is today's UI chip, drawn upright in Pixi; its tone carries the whole chip style (spec §1.4): 'measure' centred mono,
// 'measure-quiet' the same at weight 400, 'hint' bottom-centre sans, 'hint-primary' the same in the primary colour, 'warning' as 'hint'.
/** widthPx and dash (dash, gap, … lengths) are CSS px at every scale; the casing is widthPx + OVERLAY_CASING_EXTRA_PX. The renderer converts them
 *  to world units at the scale it draws with and re-traces when that scale changes. */
export type DraftStroke = { readonly token: 'draft' | 'draft-muted' | 'selection' | 'warning'; readonly widthPx: number; readonly dash?: readonly number[] }
export type DraftFill = { readonly token: 'draft-fill' | 'selection-fill' | 'warning-fill' }
// Draft tokens resolve to canvas colours in canvas/runtime/scene-visuals.ts (getDraftVisual, beside the overlay visuals).
export interface DraftPresentation { readonly shapes: readonly DraftShape[] }

/** Move/rotate preview of the selection while dragging: a renderer transform until commit. */
export interface SelectionPreview { readonly translate: WorldVector; readonly rotateDeg: number; readonly pivot: WorldPoint }

export interface ToolHandle {
  readonly id: ToolHandleId              // unique across objects: 'rotate', 'vertex:<zone id>:<index>', 'rect-corner:<id>:ne', 'guide-end:<id>:a', 'edge-mid:<zone id>:<index>'
  readonly anchor: WorldPoint
  readonly offsetPx?: ScreenPoint        // rotate handle: 42 px above the selection's projected hull
  readonly hitRadiusPx: number           // 10 today; 22 on touch (44 px target, ADR 0010)
  readonly glyph: 'vertex' | 'corner' | 'rotate' | 'midpoint'
  readonly label: string                 // aria-label: the rotate handle's is translated; zone and guide points keep today's literal English (phase 0)
  readonly readout?: string              // live chip beside the handle (the rotate handle's '+15°'); the host marks the dragged handle active
}
```

**Label tones.** Today's draft labels are UI chips, not canvas text, so a `label`'s tone carries the whole chip style; the Renderer draws the chip in Pixi, upright, in the draft screen container. Every tone has a 1 px `--color-border-strong` border, radius 5 px, `--text-xs` size (13 px under zh, ja and ko) and `--shadow-sm`:

| Tone | Placement | Font | Text on background | Today |
|---|---|---|---|---|
| `measure` | centred on anchor + offset | mono, weight 600 | `--color-text` on `--color-surface-muted` | zone area chips and plant drag distances |
| `measure-quiet` | as `measure` | mono, weight 400 | as `measure` | edge and dimension chips: zone edges, W/H, Line and Measure lengths, guide ends (`zone-measurement-overlay.ts:53`) |
| `hint` | bottom-centre, 4 px above anchor + offset | sans, weight 600 | `--color-text` on `--color-surface` | placement and spacing labels |
| `hint-primary` | as `hint` | as `hint` | `--color-primary` on `--color-surface` | Plant a row's row label |
| `warning` | as `hint` until a later phase gives it its own colour | as `hint` | as `hint` | none |

An `ellipse` takes `fill?` because today's ellipse zone draft is filled with the zone fill.

Tools never see screen coordinates in gestures; `ScreenPoint` appears only in `offsetPx`/`radiusPx` presentation fields. A tool that needs today's clamp to the visible map (Plant a row) sets `clampsToView`, and the host clamps the screen point before conversion, constraint and snapping. `ToolContext` has no navigation handle. The Pan tool's drags never reach it (the recogniser turns them into `pan`); its press ends with a `tap` or, after a drag, with `cancel('navigate')` (§2.2); its module sets the `grab` cursor and guidance only.

The `ToolHost` (`tools/tool-host.ts`, interface in `interaction-ports.ts`) is the only code that builds `ToolGesture`s. Its duties, in order:

- **Admission.** Presses, menus, drops and commands, and the releases of a tool whose `settledRelease()` answers true (Select's band), run inside `deps.admission.runWhenSettled` (dragover inside `deps.settled.readWhenSettled`); a refused press answers `{ quarantine, rejectSession }`, a refused settled release cancels the tool and answers `{ quarantine }`, a refused menu or drop `{ quarantine }`. A release or handle-press whose tool call throws after a Scene Edit opened runs the cancellation at once, closing the edit so the next press is admitted; if the cancellation itself fails with the edit open, the host aborts the open edits and the failing call's error is the one reported. A tool whose activation throws leaves Select armed and the error is rethrown. There is no quarantine outside the host.
- **Raw presses** (`rawPress(button, target, pointerId)`): the session calls it for every raw pointerdown on the map host before routing it, including presses the host never sees as gestures (secondary, middle, Space and overview presses, presses on owned chrome). The host commits the nudge series for any button, and for an admitted primary or middle press (not in the text entry, not on the Unlock affordance, no live press from another pointer id) also closes the canvas menu, submits an unfocused open text entry (`chrome.submitUnfocusedTextEntry()`) and focuses the map through `deps.focus`.
- **World conversion** at event time (a null `screenToWorld` drops hovers and cancels drags); a tool with `clampsToView` gets the screen point clamped to the view first.
- **Constraint and snapping** once, filling `ToolPoint.free`, `.constrained` and `.snapped` in the order of §2.3: the active tool's `constraint()`, then the grid and guide snap (`tools/snapping.ts`, `deps.snapping()` read per point). `ToolContext.snap` exposes the same snapping; `place-at` arrives snapped and is dropped in overview.
- **Hits.** A handle target becomes `handle-drag`; a ruler target is a press the tool never hears (the interaction session runs its drag and lands its guide).
- **Interceptors:** a press that committed an open `'create'` note entry reaches no tool (nor its drag or release); one that committed an `'edit'` entry goes on. An admitted press takes its capture first and stops if the capture was lost while taking it. The raster probe `deps.inspect` runs on a primary press after handles and pan and before the tool, never in overview or while Pan is armed (fixture J10, §3.8). An overview press reaches no tool; entering overview closes an `'edit'` entry, the menu and every transient (`cancelTransient('overview')`) and keeps a `'create'` entry for the next press there to commit.
- **Hover.** Every `hover` whose target is the map (`surface`) is published to `subscribePointerWorld` first, in overview too; `hover-end` publishes `null`. The interaction session's `subscribePointerWorld` drops the point of a move whose raw `buttonMask` has any bit set. A hover over owned chrome, a ruler or anything off the map publishes nothing. Outside overview the tool then gets it: `'pass'` runs the passive hover (restyle, tooltip, locked affordance); `'handled'` clears and skips it. On `hover-end` the tool decides what to keep (Place plants hides its preview; the stamps keep their ghost; every other tool keeps its draft). A `drag-start`/`drag-move` the tool answers `'pass'` runs the passive hover too; one it answers `'handled'` runs no hover over its moves (Select's move and band, Text, Place plants, the zone drags).
- **Drops.** One shared drop handler serves every tool: a species drop places with `tools/plant-stamp.ts`'s code, a saved stamp with `tools/saved-object-stamp.ts`'s; dragover answers `dropEffect` from the payload kind and the open layers. Dragover shows a drop preview merged with the decorations (a species payload: a small `quad`; a saved stamp: its `'objects'` ghosts at the snapped point), cleared on dragleave, drop, a refused dragover, overview, a cancellation or a document replacement. Any dragover hides the active tool's own draft; the next hover or press over the map shows it again. A drop places at the snapped point inside `deps.admission`; once its edit commits, the host requests Select, focuses the map and calls `ToolHostDeps.dropped(kind)`.
- **Re-emit** of the live drag, or of the resting pointer, on every `onViewFrame('tools')`, so a draft, ghost or preview stays on the ground under a still pointer (plan §4, phase 0, exception 1). A pointer-source pan hands its `at` to `notePointer`, which moves the resting pointer and emits nothing (the next frame re-emits under it); wheel and key pans leave it where it is. With the pointer off the map the host calls the tool's `viewChanged?()` instead.
- **Plane.** When `deps.plane()` changes identity (a re-origin), the host re-projects its own drag start and last hover through lon/lat, then calls the tool's `planeChanged(reproject)`.
- **Drafts and decorations.** The host owns the selection decorations whatever tool is armed: the selected zone's W/H, edge and area chips (`tools/measure-labels.ts`), and the rotation handle and handles while Select is armed and the text entry is closed (`tools/select/reshape.ts`, `tools/select/guide-ends.ts`). These chips hide while an armed Line, Rectangle, Ellipse or Polygon draft carries its own measure labels. Rebuilt on every `onViewFrame('tools')` and on `sceneChanged()`, merged with the active tool's draft before `renderer.setDraft`. The host calls `deps.invalidate()` after any tool call that mutated an open transaction or changed its draft or handles: a tool call path that forgets this leaves a stale render.
- **Arrow nudge** and its series (`nudge`, `hasNudgeSeries`, `endNudgeSeries`; `'handled'`, `'refused'` or `'pass'`, and on `'pass'` the keyboard port applies the arrow's rule; `focus-out` commits the series).
- **Interruption** (`interrupted()`): on window blur the series commits, the passive hover, tooltip and locked affordance clear, the tool's `cancelTransient('navigate')` keeps a draft that survives pans, and the cursor returns to the tool's.
- **Releases** (`released()`): the host hears a tool press's own release; for the rest the session calls `released()` after routing (the end of a pointer pan, an up with no press of the map's). It commits the series, clears the drop preview and passive hover, runs `cancelTransient('navigate')` and resets the cursor. A press of the tool's still live is left to its own release. `released()` does not run for: another pointer's still-live press, an up in overview (the recogniser swallows it), and an up over the note editor, a handle or the Unlock affordance. The keyboard port's Space hold also reads `openTextEntryMode()`: while a `'create'` entry is open, Space arms no pan.
- **Menus**: with the text entry open the map takes focus first; hit, retarget the selection through `deps.setSelection`, open through `ToolHostDeps.menu` (the only opener); `turnViewToEdge` on a zone-edge hit from phase 1 (§4.16, no edge highlight); `finishShape` first during a 3+ corner polygon draft from phase 2.
- **Transient history** (`transientHistory`, revision bumps after every tool call and after a deferred `onCommitted`, read by Edit › Undo through the runtime's own `transientHistory`). Tool calls run untracked and the bump itself reads nothing (`x.value = x.peek() + 1`), because the runtime refreshes the session from inside its effects, which must neither depend on what a tool reads nor loop on the bump.
- **Esc queries** (`hasLiveGesture`, `activeToolHasTransient`, `activeToolIsSelect`, `escapeHint`); modifier resolution (§2.3); `activeToolDragSlopPx()` for the recogniser's `configure`.

Every tool, drop and piece of chrome runs on the host and `chrome/*.ts`; tools decide what a navigation keeps by `cancelTransient`'s reason.

`interaction-session.ts` is the composition root (`interaction-session.test.ts` holds its wiring).

### 1.5 Renderer (`canvas/runtime/renderers/scene-types.ts`)

`SceneRendererDefinition.initialize` returns a `SceneRenderer`; `SceneRendererSnapshot` carries no camera.

```ts
export interface SceneChangeSet {
  readonly scene: boolean                                   // document revision
  readonly selection: boolean
  readonly hover: readonly SceneDesignObjectTarget[]        // old and new hover target only: a two-node restyle
  readonly style: boolean                                   // theme, backdrop, plant display settings
  readonly labels: boolean                                  // label admission recomputed (each scale change; from phase R, settle or band change)
}

export interface SceneRenderer {
  readonly id: 'maplibre-pixi'
  /** Data, selection, hover, style or label admission changed. Never called for a pan. No camera in the snapshot. */
  syncScene(snapshot: SceneRendererSnapshot, changes: SceneChangeSet): void
  /** The only per-frame entry: world-root matrix, visible set, billboard anchors, zoom-band re-key. */
  setView(view: ViewTransform): void
  setDraft(draft: DraftPresentation | null): void
  setSelectionPreview(preview: SelectionPreview | null): void   // phase R
  dispose(): void | PromiseLike<void>
}
```

The contract split: data goes through `syncScene`, the camera through `setView`, and nothing else; presentation entries are world-space. The stage has two content roots and, stacked in the order of the table, two draft roots on top: drafts draw over plants, notes and labels:

| Root | Transform | Content |
|---|---|---|
| `worldRoot` | `view.planar.affine`, one write per frame | grid (from phase 1), zones, ruler and measurement guides, selection preview |
| `billboardRoot` | identity (CSS px) | plants, rings, badges, notes (text at `rotationDeg − bearing`), labels; positions from `view.projectAnchors` |
| `worldDraftRoot` (`draft-layer.ts`) | the same `view.planar.affine`, written in the same `setView` | world drafts (polylines, polygons, quads, ellipses) and the zone shapes of an `objects` ghost |
| `billboardDraftRoot` (`draft-layer.ts`) | identity (CSS px) | pixel-sized drafts (`circle-px`, `label`) and the plants and note text of a ghost (a plant is a billboard); positions from `view.projectAnchors` |
| DOM overlay host (`canvas/runtime/chrome/`) | placed in `onViewFrame('overlays')`, no element created per frame (`left`/`top` until phase R, then `translate` only) | handle layer, text-entry host, hover tooltip, locked affordance |
| Canvas2D rulers (`chrome/rulers.ts`) | redrawn in `onViewFrame('overlays')` | shown only while `northUp` |

`SelectionPreview` spans both roots: `world-layers.ts` applies it to the selected world shapes (zones, guides) as a transform of their retained geometry, and `billboard-layer.ts` applies it to the anchors of selected plants and notes before `projectAnchors` (and adds `rotateDeg` to a selected note's text angle), so a move-drag moves everything selected without `syncScene` (test `renderers/billboard-layer.test.ts`: "a selection preview moves selected plants and notes without syncScene", phase R).

Culling stays in screen space. From phase R, label admission is computed on `settledViewFrame` and on zoom-band change, with no admission cache (audit 1.6); mid-zoom, the labels admitted for the previous band move with their plants until the band changes or the view settles (convention, plan §8). Until then `renderers/label-admission.ts` keeps today's cadence: a pan translates the admitted labels and any scale change admits again. The labels count (`app/plant-display/coverage.ts`) re-reads on `ViewReadSurface.settledRevision` and `zoomBand` (a by-eye convention, plan §1). The layer (`maplibre/shared-scene-layer.ts`) reads `viewFrame.peek()` in `render` and calls `setView` only when `revision` changed; it never derives a transform.

### 1.6 Keyboard and focus (`app/keyboard/`, neutral)

```ts
// canvas/runtime/runtime.ts  (added role; runtime never imports app)
export type CanvasEscapeLayer = 'gesture' | 'nudge-series' | 'tool-transient' | 'tool' | 'selection'

export interface CanvasKeyboardPort {
  escapeLayers(): readonly CanvasEscapeLayer[]            // live canvas layers now
  escape(layer: CanvasEscapeLayer): void
  /** What the next Esc will do, for the tool-card hint (same source as behaviour). */
  describeEscape(): CanvasEscapeLayer | null
  /** False when nothing consumed it. As today: confirm, remove-last, rotate-held, edit-text and context-menu return false in overview
   *  (today's overview branch, keyboard-port.ts:278-286); edit-text only under Select; the other kinds are unchanged. context-menu
   *  stamps the keyboard-menu echo (lastKeyboardMenuAt) with the time keyState recorded for a Menu key or Shift+F10, and only when
   *  that was the last keydown, so a non-key caller never stamps a stale key. */
  command(c: CanvasKeyCommand): boolean
  /** The key router's first call for every keydown (capture) and keyup: the nudge commit on any key but an arrow, a modifier or Esc,
   *  the physical Ctrl, the Menu key's time and the Space hold (code Space, not text, and a live pointer session or not a control,
   *  read with the port's own pointerSessionLive()). The verdict tells the router what to do; the port never touches the event
   *  (no KeyConsumer; the canvas Esc layers answer through their return value, §3.7). */
  keyState(k: CanvasKeyState): CanvasKeyVerdict
  readonly host: HTMLElement
}
export interface CanvasKeyState {
  readonly type: 'keydown' | 'keyup'
  readonly key: string             // 'Control' sets the physical Ctrl; arrows, modifiers and Escape keep a nudge series
  readonly code: string            // 'Space'
  readonly mods: Modifiers
  readonly timeStamp: number       // KeyboardEvent.timeStamp: the clock of the contextmenu echo
  readonly text: boolean           // the target is a text field (isEditableTarget)
  readonly control: boolean        // the target is inside a control, field, menu or dialog (app/keyboard/target-class.ts)
}
/** held: the router prevents and Space is held for panning, nothing else runs; pass-live and pass: the router goes on, with a pointer
 *  session live or not. */
export type CanvasKeyVerdict = 'held' | 'pass-live' | 'pass'
/** The router reaches the live session's port here (keyboard-port.ts, exposed by workspace-runtime-composition.ts and the
 *  test supports). */
export interface CanvasRuntimeSurfaces {
  readonly commands: CanvasCommandSurface
  readonly queries: CanvasQuerySurface
  readonly documents: CanvasDocumentSurface
  readonly keyboard: CanvasKeyboardPort          // canvas/session.ts exports currentCanvasKeyboardPort (Keyboard, F)
}

// canvas/runtime/app-adapter.ts  (the field is absent in a detached runtime)
export interface CanvasRuntimeAppAdapter {
  // … today's fields …
  /** How ToolHostDeps.focus leaves the runtime. Unset until F, so interaction-session.ts focuses the host as today;
   *  F: app/canvas-runtime/app-adapter.ts passes the FocusOwner (Keyboard). */
  readonly focus?: CanvasFocusPort
}

// canvas/runtime/app-adapter.ts, continued (beside the focus? field; interaction-ports.ts and app/keyboard import it type-only)
/** How a tool's focus request (ToolEffects.requestFocus) leaves the runtime. The FocusOwner implements it. */
export interface CanvasFocusPort {
  focusMap(reason: 'tool-requested' | 'text-entry-closed'): void
  // focusToolCardField comes only with the first tool that asks for its card's field.
}

// canvas/runtime/runtime.ts, continued
/** The tool surface on the canvas session. Still setTool(name: string): typing it ToolId end to end is 0B-5's open item 7
 *  (plan §4, phase 0), with the source-text pin of item 18. */
export interface CanvasToolCommandSurface {
  setTool(id: ToolId): void                                // only armCanvasTool calls it (P9, from F); no source parameter:
                                                           // the session reads the read models armCanvasTool writes first
  readonly plantRowSpacing: CanvasPlantRowSpacingField
}

export type CanvasKeyCommand =
  | { kind: 'confirm' } | { kind: 'remove-last' } | { kind: 'edit-text' } | { kind: 'delete-handle' }
  | { kind: 'rotate-held'; stepDeg: 15 | -15 }
  | { kind: 'arrow'; dir: 'up' | 'down' | 'left' | 'right'; large: boolean }   // keyboard-port.ts: ToolHost.nudge, then panByPx on 'pass' with nothing selected
  | { kind: 'rotate-view'; direction: 1 | -1 } | { kind: 'reset-north' }
  | { kind: 'zoom-step'; direction: 1 | -1 }                                    // plain + / − with map focus
  | { kind: 'context-menu' }                                                    // Menu key, Shift+F10
```

```ts
// app/keyboard/key-router.ts
export interface KeyRouterDeps {
  readonly target: Pick<Window, 'addEventListener' | 'removeEventListener'>   // window in production
  readonly keymap: readonly KeymapRow[]            // composed per edition: its shellKeymapRows(…), then CANVAS_KEYMAP_ROWS
  readonly commands: CommandSink                   // Desktop: private to commands/registry.ts; Web: web/browser-shell-commands.ts
  readonly canvas: () => CanvasKeyboardPort | null // canvas/session.ts currentCanvasKeyboardPort
  readonly singleKeys: ReadonlySignal<boolean>     // Settings › Keyboard
  readonly focus: FocusOwner
  readonly isModalOpen: () => boolean              // modalLayerOpen, saveProblem, savedViewDialogOpen (equal in practice: every modal holds the layer)
  readonly platform: InputPlatform                 // the Mac chord rule; detectPlatform runs in the platforms
  readonly document: Pick<Document, 'addEventListener' | 'removeEventListener'>   // visibilitychange
}
export interface KeyRouterHandle { dispose(): void }
/** Owns the only window key listeners: keydown in capture and bubble, keyup in capture. Installed once per edition: Desktop's
 *  platform/desktop.ts passes it to commands/registry.ts installDesktopKeyRouter(installKeyRouter, deps), which composes the Desktop
 *  keymap and keeps its sink private; Web's web/browser-shell-commands.ts installWebKeyRouter, which main.web.tsx calls (main.web.tsx
 *  may not import src/app/**). The keyboard port, not the router, keeps the physical Ctrl and the keyboard-menu time. */
export function installKeyRouter(deps: KeyRouterDeps): KeyRouterHandle

// app/keyboard/key-chord.ts
/** The KeyboardEvent fields the router reads; tests pass literals. */
export interface KeyboardEventLike {
  readonly type: 'keydown' | 'keyup'
  readonly key: string; readonly code: string; readonly keyCode: number
  readonly shiftKey: boolean; readonly ctrlKey: boolean; readonly altKey: boolean; readonly metaKey: boolean
  readonly repeat: boolean; readonly isComposing: boolean; readonly defaultPrevented: boolean
  readonly cancelable: boolean; readonly timeStamp: number
  readonly target: EventTarget | null
  preventDefault(): void
  stopPropagation(): void
  stopImmediatePropagation(): void
}
/** mod = Cmd on Mac, Ctrl elsewhere. A physical Ctrl on Mac is `ctrl`, never `mod`. */
export interface KeyChord { readonly key: string; readonly mod: boolean; readonly ctrl: boolean; readonly shift: boolean; readonly alt: boolean }
/** The Mac rule above; letters, digits and brackets fall back to event.code on non-Latin layouts; null for AltGr and while composing. */
export function chordOf(e: KeyboardEventLike, platform: Pick<InputPlatform, 'os'>): KeyChord | null

// app/keyboard/keymap.ts
export type KeyScope =
  | 'global'          // every focus class except modal; in text only with worksInTextFields (Ctrl+K, Ctrl+S, F1, F6)
  | 'command'         // anywhere except text fields and dialogs: tool letters, Delete, [ ], N, Shift+N, Shift+L, Ctrl+Z…
  | 'view-arrows'     // Shift+←/→/↑: like 'command', but not inside an arrow-owning widget
  | 'canvas-focus'    // focus on the map host (not text inside it) or <body>: plain and mod arrows, Enter, Space, Backspace, F2, + / −, Menu
/** A shell command (app/shell-commands), a canvas catalogue command (CanvasCommandId, app/canvas-commands/index.ts: tool letters,
 *  edit.undo, canvas.deleteSelected, view.zoomIn …) or a canvas key command ('canvas.<CanvasKeyCommand kind>'). */
export type KeyCommandId = ShellCommandId | CanvasCommandId | `canvas.${CanvasKeyCommand['kind']}`
export interface KeymapRow {
  readonly command: KeyCommandId
  readonly chords: readonly KeyChord[]
  readonly scope: KeyScope
  readonly singleKey: 'follows-switch' | 'always-on' | 'n/a'  // the single-key shortcut setting
  readonly worksInTextFields?: boolean        // 'global' rows only: Ctrl+K, Ctrl+S, F1, F6, Ctrl+F (finder)
  readonly worksInModal?: boolean             // Desktop's help.commandPalette only: its sink closes the open palette and refuses it
                                              // under any other modal; F1 does not run in a modal
  /** A canvas row whose port command() returns false runs this instead (F2 → file.rename; Backspace's remove-last →
   *  canvas.deleteSelected). */
  readonly fallback?: ShellCommandId | CanvasCommandId
}
/** Both editions' canvas catalogue rows, from each definition's `shortcuts` through the switch, never from its key hint (so no
 *  row has Escape). */
export const CANVAS_KEYMAP_ROWS: readonly KeymapRow[]
/** One edition's shell rows from its own catalogue (capability-filtered; Web omits BROWSER_RESERVED_SHORTCUTS, none of which is a
 *  canvas chord). Each edition composes [...shellKeymapRows(…), ...CANVAS_KEYMAP_ROWS] (P14 holds); F1 (F) renders the result. */
export function shellKeymapRows(catalog: readonly ShellCommandCatalogEntry[], options?: { readonly omit?: ReadonlySet<string> }): readonly KeymapRow[]

/** Where a keymap row runs: Desktop's sink, private to commands/registry.ts; Web web/browser-shell-commands.ts. Injected, so
 *  app/keyboard stays neutral (P14). */
export interface CommandSink {
  /** False when the key is not consumed; the router prevents and stops a consumed key (step 10 below). */
  run(command: ShellCommandId | CanvasCommandId): boolean
}
/** Pushed scopes: surfaces that own keys while open. A scope pushed by a surface that holds the modal layer (story-presenter, pdf-page-editor) runs as that modal's own handler (step 4); stories-undo-toast is not modal (step 6). The story presenter's handle returns false unless its root holds the target, as today's root handler (fixture I12b). */
export interface KeyScopeHandle { dispose(): void }
export function pushKeyScope(scope: { readonly id: 'story-presenter' | 'pdf-page-editor' | 'stories-undo-toast'; handle(e: KeyboardEventLike, chord: KeyChord): boolean }): KeyScopeHandle

// app/keyboard/escape-chain.ts
export interface EscapeLayer {
  readonly id: string
  readonly priority: number          // higher runs first
  isActive(): boolean
  /** The Esc being dispatched; false when it consumed nothing and the next active layer runs. */
  escape(key: EscapeKey): boolean
}
export interface EscapeKey { readonly event: KeyboardEventLike }   // the router prevents and stops the key when a layer returns true
export function registerEscapeLayer(layer: EscapeLayer): () => void
/** The router's Esc step: active layers by priority until one consumes the key (§3.7); the canvas port registers its layers. */
export function runEscape(key: EscapeKey): boolean
/** The layer the next Esc would run; the tool card renders its hint from this. */
export function describeEscape(): EscapeLayer | null

// app/keyboard/arming.ts  (the one way app code arms a canvas tool; P9)
export function armCanvasTool(
  tool: ToolId,
  options: {
    /** Each caller passes its own: the rail, menus, palette and both editions' keys no longer share one 'command' value through
     *  workspaceCanvasIntentAdapter.selectTool (F threads the caller through app/workspace-commands/canvas-actions.ts). */
    readonly from: 'rail' | 'menu' | 'palette' | 'panel' | 'card' | 'shortcut' | 'start-card' | 'drop'
    readonly source?: ToolSource
  },
): boolean   // true when a canvas session took the tool

// app/keyboard/focus-owner.ts
export type FocusReason = 'tool-armed' | 'drop' | 'chooser-closed' | 'text-entry-closed' | 'menu-closed' | 'story-exit' | 'region-cycle' | 'user-opened' | 'tool-requested'
export interface FocusOwner extends CanvasFocusPort {
  focusMap(reason: FocusReason): void                  // the host itself, never a control inside it
  focusRegion(region: 'title-bar' | 'tool-rail' | 'map' | 'dock', reason: FocusReason): void
  /** A component opened by a user action focuses its first field through here; content-derived UI cannot. */
  focusOnOpen(el: HTMLElement, reason: 'user-opened'): void
  /** Replaces app/shell/focus-regions.ts registerFocusRegion (components/shared/useFocusRegion.ts re-points here in F). */
  registerRegion(region: 'title-bar' | 'tool-rail' | 'map' | 'dock', el: HTMLElement): () => void
  /** F6 and Shift+F6 (today's cycleFocusRegion); false while the modal layer is held. */
  cycleRegion(step: 1 | -1): boolean
}
```

`KeyRouter` (`key-router.ts`) owns the only window key listeners. It and the rest of this section are built once, in F, in their target form (no legacy rebuild, U7); until then the keyboard port keeps today's key handling. `armCanvasTool` writes the source to the module read models (`canvas/plant-stamp-source.ts`, `canvas/saved-object-stamp-source.ts`: they stay, as what the tool card, recents and choosers display; their `begin…` helpers are deleted in F, so the runtime, which value-imports both modules, never reaches `app/keyboard/**`), selects the canvas panel for the command and Start-card callers, calls `CanvasToolCommandSurface.setTool(id)` and focuses the map for every `from` except `shortcut`. F decides whether it records rail learning, which until then stays an effect on every tool change (`app/tool-rail/learning.ts`).

| `from` (callers) | Source | Canvas panel | No canvas session | Focus |
|---|---|---|---|---|
| `rail` (`ToolRail.tsx`), `menu` (`menus.ts`), `palette` (`CommandPalette.tsx`), `shortcut` (Desktop and Web keys, their sinks) | — | selected unless active | primes the tool mirror (`canvas/session.ts`) | the map host, except `shortcut`, which leaves focus where it is |
| `start-card`: `SiteOnboarding.tsx` (after canopi-f47t.6.1) | — | selected unless active | primes | the map host; no disabled gate (arms Polygon in overview, as today) |
| `panel`: `place-species.ts` | species | — | writes the source and recents, arms nothing | the map host |
| `panel`: `FavoritesPanel.tsx`; `card`: `StampChooser.tsx` (both through `workbench.placeStamp(stamp, from)`) | saved-stamp | — | writes nothing, false | the map host (the card's `closeChooser` focus moves to the owner, INV-FOC-05) |
| `card`: `StampChooser.tsx`'s `select`, then `object-stamp` (never short-circuits a same-id arm) | — | — | nothing | the map host |
| `drop` | — | — | — | the map host (no app caller: the runtime arms at a drop, `FocusReason 'drop'`) |

F deletes `app/shell/focus-regions.ts` with today's `focusRegion(id)` and `focusMapSurface()` and moves their callers (`app/story-presentation/controller.ts`, `place-species.ts`, `FavoritesPanel.tsx`) to the owner in the same change; P11 tombstones them.

An **arrow-owning widget** is an element with role `listbox`, `menu`, `menubar`, `slider`, `spinbutton`, `tablist`, `tree`, `grid`, `radiogroup` or `toolbar`, a focusable `separator` (one that can take focus: the dock and Favorites splitters; the rail's decorative separators are not focusable and do not count), or an element with `data-owns-keys` listing arrows. Widgets that handle arrows without such a role declare `data-owns-keys="arrows"` on their root, each in its phase: the inspection lens preview (`InspectionLens.tsx`), the phone sheet handle (`PhoneSheet.tsx`), the calendar's date grid (`components/panels/CalendarPanel.tsx:301-330`, a plain `<table>`) the plant photo carousel (`components/species-detail/PhotoViewer.tsx:64-80`) and the World map container (`components/world-map/WorldMapSurface.tsx`, whose MapLibre keyboard handler pans with arrows), all phase 1, Components. The tool rail (`role="toolbar"`, `ToolRail.tsx:90-101`), the dock splitter (`SidePanelDock.tsx:105-124`) and the Favorites splitter (`FavoritesPanel.tsx:501-511`) are covered by their roles. A widget that must keep a `command` key opts in with `data-owns-keys="Delete"` (or the key it needs) on its root.

**Listener phases.** `installKeyRouter` adds a window capture and a window bubble listener for `keydown` and a window capture listener for `keyup`; they are the only window key listeners (P8). Capture keeps what runs before element handlers today (`focus-regions.ts:106`, then `dom-input-source.ts:275`); bubble keeps the shell rows' rule (`shortcuts/manager.ts:26`, `web/canvas-shortcuts.ts:69`, both skipping `defaultPrevented`); today's keyup listener (`dom-input-source.ts:276`, bubble) moves to capture, which changes no order, since no other keyup listener exists in `src/`.

`app/keyboard/target-class.ts` classifies the focus (step 2 below), importing `isEditableTarget` from `canvas/runtime/input/editable-target.ts` (it stays there for its runtime users).

Resolution order for one keydown. Capture listener:
1. Composition (`isComposing || keyCode === 229`): return (phase F).
2. Classify focus: `modal`, `text` (input, textarea, select, contenteditable, the text-entry host), `map` (map host or inside it), `body`, `other` (rail buttons, dock lists, menus, the compass).
3. Held keys: track modifiers in every class (for `physicalCtrl`); track Space as held only in `map` and `body`, or while a canvas gesture is live; send `keyState` to the canvas port; clear on blur, `visibilitychange` and Meta keyup.
4. While a pointer gesture or nudge series is live, the canvas port takes the key first whatever the focus (today `keyboard-port.ts:260-277`): Esc runs the `gesture` or `nudge-series` layer. F6 and Shift+F6 cycle regions (today in capture).

Bubble listener, skipped for a key already `defaultPrevented` (an element handler of a focused widget handled it; a widget that calls `stopPropagation` hides the key from these steps, as it hides it from the shell rows today; today's widgets stop propagation on Escape (`InspectionLens.tsx:119`, `PlantColorMenu.tsx:243`, `PlantSymbolMenu.tsx:122`, `PdfPageEditor.tsx:105` and about 15 more), `ToolCard.tsx:240` also on Enter, `SegmentedControl.tsx:52-53` on arrows, Home and End):
5. Modal: the pushed scope of the surface holding the modal layer (story presenter, PDF page editor inside the PDF workspace), then `worksInModal` rows; nothing else. The modal's element handlers have already run.
6. `global` rows (in every class but `modal`; in `text` only with `worksInTextFields`). Ctrl F is a global row whose command asks the open panel's plant finder first and otherwise opens Edit › Find plants (today `shortcuts/manager.ts:15-20`).
7. Non-modal pushed scopes: the Stories Undo toast (Ctrl Z while the toast is on screen, today `app/stories/actions.ts` `runStoryUndoShortcut`). Popovers and menus are not scopes: their Esc is an Esc layer (step 8), and their arrows are handled by their own element (arrow-owning widgets).
8. Esc runs the Esc chain (popovers 100, canvas menu 80, … §3.7). An open text entry never reaches this step: its own element handler cancels it first, and focus class `text` keeps the canvas layers off.
9. Keymap match: `command` rows in `map`, `body` and `other`; `view-arrows` the same except in an arrow-owning widget; `canvas-focus` only in `map` and `body`.
10. Dispatch: `preventDefault` and `stopPropagation`; canvas commands through the port; a port `command()` that returns false runs the row's `fallback` through the platform's `CommandSink` (Desktop `commands/registry.ts`, Web `web/browser-shell-commands.ts`), and without a fallback the key is not consumed. Each chord has one row per scope; rows are never tried in turn (fixture H27).

Canvas-focus rows run only with focus on the map host or `<body>`, where no widget handler runs, so moving them from today's capture listener to bubble changes no outcome. A focused widget without a role that handles arrows (the scale button, `ZoomControls.tsx:138-143`) runs first and prevents the default, so Shift+↑ on it opens the scale menu and does not reset north. Fixtures I10, I11, I12, I12b and H23–H27 hold the outcomes (§5.8).

Focus after a modal closes stays with `useModalLayer` (it restores the previously focused element, `useModalLayer.ts:25`); it is the one focus mover outside the FocusOwner, for modals.

### 1.7 Product types

```ts
// app/canvas-pdf/types.ts  (phase 1)
export type PdfMapOrientation = 'north-up' | 'as-on-screen'
export interface PdfSetup {
  // … existing fields …
  /** "Map orientation": north up (default) or as on screen. Distinct from the paper orientation of a page. */
  readonly mapOrientation?: PdfMapOrientation
}
export interface PdfPrintArea {           // unchanged: no rotationDeg (one layout angle, user 2026-10-01, §4.12)
  readonly id: string
  readonly name: string
  /** The area in the layout's frame: centre ± width/2, height/2 along the page's axes at the layout angle. */
  readonly bounds: PrintBounds
}
// CanvasPrintSnapshot (canvas/print) gains the view bearing captured at PDF open:
//   readonly viewBearingDeg: number   // from ViewReadSurface.captureView().camera.bearingDeg
// page-furniture groundScale gains northAngleDeg: the north arrow and its letter are drawn rotated by it.
// PdfPage gains: readonly angleDeg: number   // 0 on North up pages; PdfPage.ground is a PrintBounds in the page's turned frame

// app/canvas-pdf/page-frame.ts  (phase 1; the only place the PDF turns geometry)
export interface PdfPageFrame {
  readonly angleDeg: number                 // clockwise from true north; 0 = north up
  readonly pivot: PrintPoint                // the page's ground centre, in plan metres
  /** Plan metres → the turned frame (rotate by −angle about the pivot). */
  toFrame(p: PrintPoint): PrintPoint
  /** The turned frame → plan metres (+angle): page-editor deltas. */
  fromFrame(p: PrintPoint): PrintPoint
}
export function pageFrame(angleDeg: number, pivot: PrintPoint): PdfPageFrame
/**
 * The print snapshot as seen in the frame: zone paths, bounds, plant positions, note positions,
 * measurement ends and guide ends turned by −angle; note rotationDeg becomes rotationDeg − angle.
 * Identity (same object) when angleDeg is 0, so North up pages are byte-identical to today.
 */
export function turnSnapshot(snapshot: CanvasPrintSnapshot, frame: PdfPageFrame): CanvasPrintSnapshot
```

The layout modules (`overview.ts`, `field-layout.ts`, `layout.ts`, `overview-guides.ts`, `zone-labels.ts`, `coverage.ts`, `field-summary.ts`, `page-drawing.ts`, `split-sheets.ts`, `field-dimensions.ts`) keep their axis-aligned `frame + (p − ground) × scale` maths and world-box tests: they run on the turned snapshot, where "axis-aligned" means "aligned with the page". Text they place (plant marks and codes, names, zone labels, dimension readouts) is laid out level on paper, so it stays upright whatever the angle. Every page shares the layout angle, so no page window is drawn as a turned outline (§4.12).

```rust
// common-types/src/settings.rs  (phase 1)
pub struct LastView {
    // … existing fields …
    #[serde(default)]
    pub bearing: f64,   // 0 when missing; normalised on read
}
```

Stored data: `.canopi` does not change (`SavedViewCamera.bearing` exists; writers normalise to [0, 360)). Settings gain `LastView.bearing` with a one-line default. PDF setups are not persisted, so Map orientation and the layout angle live in memory only; `PdfPrintArea` gains no angle (U3; decided with the user, 2026-10-01). `scroll_wheel` keeps its field and values; only its UI is relabelled.

### 1.8 Module layout: what later phases add

Phase 0 built the modules of `canvas/runtime/{view,input,tools,renderers,chrome}/`, `interaction-types.ts`, `interaction-ports.ts`, `keyboard-port.ts`, `scene-extent.ts`, `scene-runtime/drag-state.ts`, `maplibre/camera-driver.ts` and the test supports (`test-view.ts`, `tool-harness.ts`, `recording-renderer.ts`, `canvas-interaction-setup.ts`); the tree under `desktop/web/src/` is their reference. `view/` imports only what policy P4 (plan §5) allows. Later phases add:

```
desktop/web/src/
├─ canvas/runtime/input/
│  ├─ selection-drag-guard.ts           copy of GeoLibre @ b3d91de, MIT header, THIRD_PARTY_NOTICES row (phase F)
│  └─ context-menu-gesture.ts           copy of GeoLibre @ b3d91de, MIT header, THIRD_PARTY_NOTICES row (phase 2, V2 only)
├─ app/keyboard/                        key-router.ts, key-chord.ts, keymap.ts, escape-chain.ts, focus-owner.ts, arming.ts, target-class.ts, *.test.ts (F)
├─ app/canvas-pdf/page-frame.ts         §1.7 the turned page frame (phase 1)
├─ components/canvas/Compass.tsx        button (the whole face is the drag target); reads ViewReadSurface.bearingDeg; commands via ViewCommandSurface (phase 1)
└─ components/canvas/RulersNorthHint.tsx  the "Rulers show when north is up" pill above the view chip (§4.6); useMapOccluder (phase 1)
```

Phase 1 also mounts the grid and ruler guides in `renderers/world-layers.ts`; phase R retains billboard geometry per zoom band in `renderers/billboard-layer.ts` and admits labels on settle in `renderers/label-admission.ts`.

### 1.9 Module layout: deleted, in the phase that replaces them

Phase 0's deletions are done; P11 tombstones them. Left:

| File or symbol | Replaced by | Phase |
|---|---|---|
| `readSingleKeyShortcuts` (the session's deps, `scene-runtime.ts`'s deps line, the app adapters' `settings` reader) | `KeyRouterDeps.singleKeys`, in the same change (no dual path) | F |
| `shortcuts/manager.ts`, `web/canvas-shortcuts.ts`, `app/shell/focus-regions.ts` | `app/keyboard/**` | F |
| `beginPlantStampFromSpecies` (`canvas/plant-stamp-source.ts`), `beginSavedObjectStampPlacement` (`canvas/saved-object-stamp-source.ts`), `selectCanvasTool` (`app/workspace-commands/canvas-actions.ts`) | `armCanvasTool` | F |
| `LEGACY_BINDINGS` | `CURRENT_BINDINGS` (the one constant; its importers re-pointed) | F |
| `canvas/runtime/scene-chrome.ts` (grid and guides Canvas2D) | `renderers/world-layers.ts` | 1 |
| `'overview'` in `primaryDragPansIn` | nothing | 2 |
| `settings.scrollWheel*` UI strings | `settings.pointingDevice*` | 2 |
| The `Bindings` fields that end with one value | the end values, hard-coded in the recogniser (no `ROTATION_BINDINGS`, `V2_BINDINGS` or `TOUCH_BINDINGS` is written: each phase edits the current constant in place) | release close |

## 2. Gesture vocabulary

### 2.1 Kinds

| Kind | Meaning | Reaches |
|---|---|---|
| `hover`, `hover-end` | pointer over the map with no button, with the target class under it; `hover-end` on leaving the map, and from F on moving over owned chrome, the text entry or a handle, never the Unlock affordance (§2.2 "Hover") | ToolHost → `subscribePointerWorld` (a `surface` target only), then the tool (world point, hit) and the passive hover |
| `press` | primary button or finger down | ToolHost → tool |
| `tap` | primary up within slop | ToolHost → tool (`clickCount`: under LEGACY the platform's `detail`; later bindings may count with the multi-click thresholds) |
| `drag-start`, `drag-move`, `drag-end` | primary past slop | ToolHost → tool, or `handle-drag` when the press was on a handle |
| `drop` | drag-and-drop from a panel | the ToolHost's shared drop handler, whatever tool is armed; dragover answers a drop effect |
| `pan` | move the ground with the pointer; `deltaPx` is content movement | `ViewNavigation.panByPx` |
| `zoom` | factor about an anchor | `ViewNavigation.zoomAroundPx` |
| `rotate` | bearing change about an anchor, `totalDeltaDeg` since start, `step` live | one `RotationSession`: `start` → `beginRotation(anchor)`, `move` → `update`, `end` → `end()`, `cancel` → `cancel()` |
| `menu-request` | open the canvas menu at a point or for the selection | ToolHost menu path (hit, retarget, open) |
| `cancel` | the live session ended without completing; `navigate`: a Pan-tool press whose drag panned (§2.2 "Primary") | ToolHost (tool `cancel`) and, for a live rotate, `rotate{cancel}` |

Pinch and twist are sources, not kinds. Keys are not gestures: key-driven navigation goes from the KeyRouter through `CanvasKeyboardPort` to `ViewNavigation`, and key-driven tool actions become `ToolCommand`s. Compass-ring rotation is outside the pipeline: `Compass.tsx` drives a `RotationSession` from `ViewCommandSurface.beginRotation('centre')`. Pan sign: a `pan` with `deltaPx = (+10, 0)` moves the ground under the pointer 10 px right.

### 2.2 Recogniser rules

- **Sessions.** One mouse or pen session at a time, by `pointerId`; touch keeps up to two touches and ignores a third. A `down` for a pointer id whose session is live ends that session first, and a `move` with buttons but no session is a hover (both happen in today's tests and after a lost `pointerup`). A press the host refuses (`rejectSession`) ends its session with no gesture (the session feeds `reject`, §1.2). In overview an `up` with no live session, from anywhere in the app, passes untouched (plan §4, phase 0, exception 4). A session's mode is fixed at start: pressing Shift mid-pan does not switch to rotate, and releasing Shift mid-rotate does not switch to pan. For a secondary, auxiliary or Mac Ctrl session only Shift held at the press decides the mode (rotate or pan), for all three buttons alike; Shift pressed after the press and before the 3 px slop is ignored; Space, Alt and mod at the press are ignored for the mode, and mod held later only steps a rotate (spec; fixture A18).
- **Rotation sign (spec).** A pointer rotate turns the view by `ROTATE_DEG_PER_PX` × the horizontal travel since the start, and a rightward drag increases the bearing (MapLibre's convention: the map turns counter-clockwise on screen, as if the pointer pushed the top of the map to the left). Twists (touch two-finger, WebKit trackpad) make the ground follow the fingers: a clockwise twist of the fingers turns the map clockwise on screen, which lowers the bearing by the twist angle. The compass drag makes the needle follow the pointer around the compass centre: moving the pointer clockwise around the face turns the needle clockwise, which lowers the bearing by the same angle (§4.2).
- **Primary.** `press` on down; `tap` on an up within slop, or `drag-start` past slop, then `drag-move`, `drag-end` (under LEGACY slop 0: any movement is a drag; §1.2). Space held at press turns it into `pan` (`space-drag`). Space pressed after a primary session started does not change it (a session's mode is fixed; spec): the drag, band or move continues, and Space is only recorded for the next press. In a `primaryDragPansIn` context a primary drag is `pan` (`primary-drag`). With the Pan tool its press still reaches the tool and ends with a `tap`, or after a drag with `cancel('navigate')` right after the `pan{end}`, so every press the host sees ends (the Pan tool ignores them); a legacy overview press never reaches the host.
- **Hover.** A move with no live session, buttons or not, is a `hover` wherever the pointer is, carrying the target class it saw (only a `surface` target reaches `subscribePointerWorld`, §1.4 "Hover"), except over the targets `Bindings.ownedHover` names. `legacy` (phase 0): over the text entry (`owned-text`), a handle or the Unlock affordance (`owned-chrome` with `lockedAffordance`) it emits nothing, as today's early return (`scene-interaction.ts:693-696`), so the passive hover, the tooltip, the Unlock affordance and the Place plants preview stay; over other owned chrome in the map (buttons, inputs) it is an ordinary `hover`, and today's hover runs and hit-tests what is beneath. `end` (from F, U6): over owned chrome, the text entry or a handle it emits `hover-end`, except over the Unlock affordance, which keeps the hover in every phase and still emits nothing, or the affordance would clear before it could be clicked.
- **Auxiliary.** Drag → `pan`; with Shift at press and `auxiliaryShiftDrag: 'rotate'` → `rotate` about the press point, `step` = mod held live. A middle tap does nothing; `pointerdown` is always default-prevented (no autoscroll, no Linux paste).
- **Secondary (legacy, `menu-on-native`).** The button is inert; a native `contextmenu` on the surface opens the menu at once, except in overview.
- **Secondary (V2).** `down` → pending, capture taken, nothing emitted. Past 3 px with no Shift at the press → `pan`; with Shift at the press → `rotate` about the press point, `step` = mod held live (a consumed Mac Ctrl never counts). An `up` within 3 px → `menu-request` at the release point on every OS (convention). The document-capture `contextmenu` guard acts only on events whose target class is `surface`, `handle`, `ruler` or `owned-chrome`, or that arrive while a canvas secondary session is live or within 250 ms of its end (the WebView2 trail, which may be retargeted to `<html>` or the open menu, A8). There, every mouse and pen native `contextmenu` is prevented; one is honoured only when `fromKeyboard`, or when no secondary session exists and none ended in the last 250 ms and it is not a keyboard-menu echo within 500 ms; it then becomes `menu-request('selection', 'keyboard')`, except on `owned-chrome`, where it emits nothing. On `owned-text` and `foreign` targets the guard does nothing: the native menu (copy and paste in the note editor and panel fields) stays and no `menu-request` is emitted (spec, as today's `allowsNativeContextMenuTarget`, `pointer-utils.ts:27`).
- **Drag end.** A drag ends when `buttons` loses its role on a `move`, on `up`, on lost capture, blur or `visibilitychange` (not under LEGACY, below).
- **A second button during a primary drag** is ignored for the rest of the session in every phase (U2, 2026-10-01): no nested pan or rotate, and from phase 2 its native `contextmenu` is prevented and no `menu-request` is emitted. Wheel zoom and key navigation stay live during a drag.
- **Other chords.** A primary press during a secondary or auxiliary session is ignored for the rest of that session; its native menu is prevented.
- **Touch before phase 3.** One touch is a primary pointer exactly as today; a second concurrent touch is ignored; no long press, no twist; host CSS unchanged.
- **Touch (phase 3).** One finger is primary with 8 px slop. Still for 500 ms → `menu-request('long-press')` and the session ends (no `tap` on release). A second finger before slop withdraws the press (`cancel('multitouch')`); after a drag started, the drag is cancelled and its Scene Edit aborted (a polygon draft survives, as it does a pan). Two fingers: centroid → `pan`, distance ratio → `zoom` about the centroid, angle → `rotate` after 25 px of arc with the threshold subtracted. Lifting to one finger does not resume editing until every finger lifted. Android's native long-press `contextmenu` and the timer produce one menu.
- **Pen.** Tip = primary with pen slop; barrel = secondary rules when `penBarrel: 'secondary'`; eraser ignored; hover works.
- **WebKit gesture events** (`trackpadGestures`). Scale → `zoom` (`trackpad-pinch`) at once, as a ratio to the previous event. Rotation is accumulated and emits nothing until |accumulated| exceeds 10°; then `rotate` (`trackpad-twist`) starts with the threshold subtracted. A Ctrl+wheel inside an open gesture is ignored; `gesture*` defaults are prevented. On iOS the pointer-based two-finger recogniser is the only source; `gesture*` is prevented and not counted.
- **Cancel fences.** `pointercancel`, lost capture, blur, `visibilitychange`, the Esc chain's `escape`, and a tool change (`configure`) emit `cancel`; a live rotate emits `rotate{cancel}`, which restores the starting camera. Under LEGACY the source listens to no `visibilitychange` and no `gesture*` event (today), so only blur releases Space and WebKit's Ctrl wheels zoom. After a window blur the session also calls `ToolHost.interrupted()` (§1.4).

### 2.3 Modifier resolution (ToolHost)

| Meaning | Phase 0 to 1 | From phase 2 |
|---|---|---|
| `additive` | Shift, Ctrl or Cmd (today) | Shift or mod (on Mac: Shift or Cmd; Ctrl+click is a right click) |
| `subtractive` | never | Alt |
| `constrain` | Shift in Polygon, Plant a row (world axes before 1; screen axes from 1, identical at bearing 0) and on the rotate handle (15° steps from the press angle, as today) | Shift in every drawing tool (screen axes) and on the rotate handle (unchanged) |
| constrain and snap order | today's, keyed by tool id in the host: Polygon snaps, then constrains (`zone-drawing-tool.ts:226`), so a Shift corner may be off-grid, and closes on its first corner by `ToolPoint.free`; Plant a row constrains the raw point (Shift is also no-snap) | constrain, then snap the length along the ray (Polygon changes in 2; spec) |
| `noSnap` | Shift in Plant a row | mod held during a Plant a row drag |
| `fromCentre` | never | never (reserved) |

## 3. Binding tables

The tables give the end state (phase 3) with the phase each behaviour arrives in. A cell without a phase keeps today's behaviour in every phase. "Mouse" and "Trackpad" are the two values of Settings › Canvas › Pointing device (stored `scroll_wheel`: `zoom` = Mouse, `pan` = Trackpad). **Only the wheel rows (§3.3) and the Select tool card hint differ between the two settings; every other row is identical for both.** Touch ignores the setting.

### 3.1 Navigation that works in every tool

Rows are pointer inputs whose meaning does not depend on the tool. "Every tool" includes all twelve tool ids and overview mode; §3.8 lists the exceptions (text entry, the PDF page editor, modals, the story presenter, the World map).

| Input | No modifier | Shift | mod (Ctrl; Cmd on Mac) | Alt | Space held | macOS Ctrl (physical) |
|---|---|---|---|---|---|---|
| Right press, drag past 3 px | pan (from 2). Before 2: nothing, and on Linux and macOS the menu opens at press | turn the view about the press point, 0.8° per px of horizontal travel, rightward raises the bearing (§2.2), vertical ignored (from 2) | pan (from 2); added during a Shift rotate: 15° steps | pan (from 2) | pan (from 2) | pan (from 2); Ctrl is consumed, never steps |
| Right click (still, ≤ 3 px) | canvas menu at the release point (from 2, convention). Before 2: native menu at press (Linux, macOS) or release (Windows). Overview: no menu | menu (Shift matters only past slop) | menu | menu | menu | menu |
| Middle press, drag | pan | turn the view about the press point (from 1; before: pan) | pan; added during a Shift rotate: 15° steps (from 1) | pan | pan | pan |
| Middle click | nothing (no autoscroll, no paste) | nothing | nothing | nothing | nothing | nothing |
| Left press, drag | tool-dependent (§3.2) | tool-dependent | tool-dependent | tool-dependent | pan in every tool and in overview | see next row |
| macOS Ctrl + left click | — | — | — | — | — | canvas menu at release, source `ctrl-click`; no selection change (from 2). Before 2: toggles the selection and the native menu opens (today) |
| macOS Ctrl + left drag | — | — | — | — | — | pan (from 2); with Shift at press: turn the view unstepped; adding Cmd steps 15° (from 2) |
| Right or middle added during a left drag | ignored (U2): no pan; before 2 a right press's native `contextmenu` opens the menu unless a Scene Edit is live (today); from 2 no menu | ignored | as no modifier | as no modifier | n/a (Space-drag is already a pan) | as no modifier |
| Space held at a left press, no movement | no press reaches the tool: Plant stamp places nothing and Polygon adds no corner (today, `beginPan` claims the press first, `scene-interaction.ts:600-606`) | — | — | — | — | — |
| Space pressed during a left drag | the drag, band or move continues; Space is not a pan until the next press (a session's mode is fixed, spec) | — | — | — | — | — |
| Several modifiers at a right, middle or Mac Ctrl press | only Shift decides: with Shift, turn; without, pan. Space, Alt and mod at the press are ignored for the mode (Space+Shift+right-drag and Alt+Shift+right-drag turn; spec) | | | | | |
| Left added during a right or middle drag | ignored for the rest of that drag; no press reaches the tool | same | same | same | same | same |
| Double right-click | two menu requests; the second replaces the first | — | — | — | — | — |

Known limitation (Linux desktop): on KDE, Xfce, Cinnamon and MATE the window manager takes Alt+left-drag (move the window) and Alt+right-drag (resize it) before WebKitGTK sees them, so Alt+click and Alt+right-drag can be unreliable there. Both actions stay reachable: Shift or mod click toggles an object, and Delete on a focused corner removes it (§3.2). The phase-2 Linux live check records the behaviour.

Rotation from the pointer is never available without Shift (user: deliberate gestures only). Release of a free rotate drag within 7° of north tweens to north in 300 ms about the press point. Esc during any rotate drag restores the camera from before the drag.

### 3.2 Left button (pen tip, one finger) per tool

"Click" is a `tap`; "drag" is past slop; "double-click" is `clickCount ≥ 2`. Every drag in every tool accepts the wheel and keys during the drag (wheel zoom, today; key turns and resets from 1, §4.3; a right or middle press during it is ignored, U2): the draft stays under the cursor and its start stays on the ground. Space held at press pans instead (§3.1).

| Tool (key) | Click | Drag | Double-click | Shift | mod | Alt |
|---|---|---|---|---|---|---|
| Select (V) | selects the hit object; empty ground clears; a locked object is selected and shows Unlock. From 2: a click inside a zone's fill selects the zone when no plant or note is on top | from empty ground: band select; the band is a screen rectangle and hits in its world quad (from 1). From an object or the outline of a selected zone: moves the selection. From 2 a drag that starts inside a zone's fill bands, never moves the zone. From a handle: rotate, reshape corner or vertex, guide end | on a plant: selects every plant of that species; on a note: edits its text; on a zone edge: adds a corner (from 2) | click toggles the hit; drag from empty: adds the band to the selection (never box zoom); a drag that starts on an object toggles it on press and moves nothing (today, `shared-gestures.ts:233-237`); on the rotate handle: 15° object steps from the press angle (today, every phase) | as Shift for click and band (on Mac, Cmd) | click removes the hit from the selection (from 2); Alt+click on a selected corner handle removes the corner, minimum 3 (from 2); Alt+drag bands as without Alt (spec) |
| Pan (H) | nothing | pans (mouse, pen, touch); no handles show while Pan is armed (as today; only Select shows them), so a press never lands on one | nothing | ignored (a session's mode is fixed) | ignored | ignored |
| Plant stamp (P) | places one plant of the chosen species at the snapped point; with no species the card asks to choose one | the press already placed; the drag does nothing more (today) | places a second plant (each press places one, today) | none | none | none |
| Plant a row (W) | on a placed plant: chooses it as the row source | draws the row from the source along the drag (4 px, measured by the tool); plants at the spacing interval | nothing | 45° steps against the screen axes (from 1; before: world axes). Before 2 Shift also turns snapping off | no snapping while held (from 2) | none |
| Object stamp (K) | first click on a plant, zone, note or group copies it (the pick); later clicks place the pick, level to the screen at the current bearing (from 1) | nothing more than the click | places twice | none | none | none |
| Saved object stamp (no key) | places the saved stamp, level to the screen (from 1), then returns to Select (today); a drop from Favorites places it the same way (from 1) | nothing more | places once; the second press reaches Select (today) | none | none | none |
| Text (T) | places a note and opens text entry; a note created on a rotated map is level to the screen (from 1) | nothing more | nothing more | none | none | none |
| Line (L) | nothing | draws a line | nothing | 45° steps against the screen axes (from 2) | none | none |
| Measure (M) | nothing | measures; the line stays as a guide | nothing | 45° steps against the screen axes (from 2) | none | none |
| Rectangle (R) | nothing | draws a rectangle aligned to the screen, stored with `rotationDeg = bearing` (from 1) | nothing | square (from 2) | none | none |
| Ellipse (E) | nothing | draws an ellipse aligned to the screen, stored with `rotationDeg = bearing` (from 1) | nothing | circle (from 2) | none | none |
| Polygon (Z) | the press adds a corner (today); a press on the first corner finishes (3+ corners) | the press already added the corner; the drag moves nothing (today) | the second press of a double-click finishes instead of adding a corner (3+ corners, from 2) | 45° steps against the screen axes (from 1; before: world axes) | none | none |
| Handle (any tool that shows handles) | focuses nothing; handles are DOM buttons | `handle-drag`; with Space held at the press: `handle-drag` today (the handle is hit before the pan check, `scene-interaction.ts:584-608`), `pan` from 2 | on an edge midpoint: adds a corner (from 2) | rotate handle: 15° steps from the press angle (today) | none | removes a selected corner (from 2) |
| Ruler (press on a ruler) | nothing | pulls a guide, only while north is up | nothing | none | none | none |

Cells the table leaves implicit:
- **Select, mod at a drag that starts on an object:** as Shift: toggles the object on press and moves nothing (today: `hasAdditiveModifier` treats Ctrl and Cmd like Shift; on Mac from 2 only Cmd, since a physical Ctrl is a right-click).
- **Select, Alt+drag from an object or a selected object:** moves the selection as without Alt; Alt changes only a click (from 2, spec; today Alt is ignored).
- **Space+Shift+left-drag:** pans; Shift does nothing, since a session's mode is fixed at start (today).
- **Space held at a press on a handle:** today and through phase 1 the handle drags (the handle is hit first); from 2 it pans, as Space at any press does (§3.1; convention), and the handle is not dragged. Fixture G3b pins today's order under LEGACY. The Pan tool has no such case: handles show only while Select is armed (`scene-interaction.ts:1283-1289`).
- **Text, click while an entry is open:** commits the entry and places nothing (today, `text-annotation-tool.ts:38-41`); the next click places a note.
- **Saved object stamp after the first Esc dropped the stamp:** the tool stays armed with no stamp; a click places nothing and the card offers "Choose a saved stamp" (from 2).
- **Plant a row with no source:** a click or drag on empty ground does nothing; the card asks for a placed plant (today).
- **Polygon, a drag after a corner press:** `drag-start` and `drag-move` move the rubber band as hovers; neither a `tap` nor a `drag-end` adds a corner (the press did, today).
- **Alt+click on Linux desktops:** may be taken by the window manager (known limitation, §3.1); Shift or mod click and Delete on a focused corner reach the same results.

Overview (below 0.1 px/m) replaces the rows above:

| Input in overview | Behaviour |
|---|---|
| Left click | selects the hit zone or note (plants are hidden and not hit); empty ground clears (from 2; before: nothing) |
| Left drag | band-selects zones and notes (from 2); before 2 it pans |
| Shift, mod, Alt with a left click or drag | as in the Select row from 2: Shift or mod click toggles, Alt+click removes, Shift or mod band adds, Alt+drag bands as without Alt; a Mac Ctrl+left-drag pans as in site mode (before 2: every left drag pans) |
| Left drag with the Pan tool, Space+drag, middle-drag | pan |
| Right-drag | pan (from 2; before: nothing) |
| Shift+middle-drag | turns the view (from 1; before: pan), as in site mode |
| Any drawing, stamp or row tool | stays armed; draws nothing; the card reads "Zoom in to edit. Plants are hidden at this scale." |
| Handles, moves | none |
| Still right-click, long press, Menu key, Shift+F10, Mac Ctrl+click (from 2), pen barrel tap (today, every phase) | no menu (today's rule, convention) |
| Double-click | as a click (from 2): no note text edit, no corner added, no same-species select (plants are hidden) |
| Esc | cancels an interrupted gesture only; never leaves the tool (today). From 2 it also clears an overview selection (spec) |
| Arrows | with nothing selected: pan (today); with a selection: nothing (today; no nudge in overview) |
| Wheel, pinch, twist | as in site mode |
| Other keys | tool letters arm tools (today); N, Shift+N and Shift+←/→/↑ turn the view (from 1); `+`, `−`, Shift+2 and Home navigate (from 2). Mutation commands stay unavailable (`canvas-actions.ts:55` `spatialEditingAvailable`, today), also on an overview selection from 2: Delete, duplicate, paste, `[` `]` do nothing. Enter and F2 (note edit), Backspace and Enter in a polygon draft, the Menu key and Shift+F10 do nothing (today, `scene-interaction.ts:1093-1105`) |

### 3.3 Wheel and trackpad

| Input | Pointing device: Mouse | Pointing device: Trackpad |
|---|---|---|
| Wheel or two-finger scroll, no modifier | zoom about the pointer, factor `exp(clamp(−dy × 0.002, ±1))`; from 2 one notch (`deltaMode` line, or \|dy\| = 100) is one zoom step, the same as the buttons | pan by (−dx, −dy) |
| Shift + wheel | pan by (−dx, −dy) as delivered (today: no swap; Chromium on Windows and Linux and macOS already deliver a Shift+wheel notch as dx). WebKitGTK, the Linux desktop engine, is not verified: whether its notch arrives as dx or dy is recorded by the phase-2 live check; if it arrives as dy, Shift+wheel pans vertically on Linux desktop, a known limitation filed as a bead, never swapped by platform sniffing | horizontal pan: dy becomes x when dx is 0 (today, `scene-interaction.ts:847-849`); macOS's swapped axes are accepted, never swapped twice |
| Ctrl or Cmd + wheel (physical) | zoom | zoom |
| Pinch (Chromium and WebView2 synthetic Ctrl wheel; Firefox line-mode pinch) | zoom; no Ctrl is recorded as held | zoom |
| Alt + wheel | as without Alt (no rotation, convention) | as without Alt |
| Space held + wheel | as without Space | as without Space |
| macOS WebKit gesture: scale | zoom about the gesture centre (from 1) | same |
| macOS WebKit gesture: rotation | nothing until 10° accumulated, then turns the view with the 10° subtracted; release within 7° of north snaps (from 1) | same |
| Linux WebKitGTK trackpad pinch | not delivered to the page (user): zoom with Ctrl + scroll or the buttons; the F1 gesture list shows the note on Linux | same |
| Trackpad twist on Windows (WebView2), and in Chromium or Firefox on any OS (Web edition) | not delivered: no rotation event reaches the page (the user's "where available"); turn with Shift+right-drag, the compass or Shift+←/→. `trackpadGestures` is true only on WebKit (WKWebView and Safari), so F1 lists the twist only there | same |
| Wheel during a drawing, move or band drag | as above; the draft stays under the cursor (from 2, convention) | same |
| Wheel, pinch or WebKit gesture during a rotate session (Shift+middle-drag, Shift+right-drag, compass drag) | ignored while the rotate owns the camera, so Esc restores exactly the camera at its press (from 1, convention; fixture F18) | same |
| Wheel over the text-entry host, the compass, the zoom group or any foreign target | not handled by the canvas | same |
| Momentum tail | handled as ordinary wheel events | same |

The Select tool card hint differs by setting (phase 2 copy in §9.3): Mouse "… right-drag pans · wheel zooms", Trackpad "… two fingers pan · pinch zooms".

### 3.4 Touch

Before phase 3 one touch is a primary pointer exactly as today (so it selects, draws or, in legacy overview and with the Pan tool, pans) and a second touch is ignored.

| Input (from phase 3: the current constant's touch fields) | Every tool | Pan tool | Overview |
|---|---|---|---|
| One-finger tap | `tap` as the left-click column of §3.2 | nothing | selects a zone or note, or clears |
| One-finger drag | `drag` as the left-drag column of §3.2 (8 px slop) | pans | band select |
| One-finger long press (500 ms still) | canvas menu at the finger, source `long-press`; no tap follows | menu | no menu |
| Long press then move | no menu if the finger moved past slop before 500 ms (it is a drag) | — | — |
| Two-finger pan | pans by the centroid | same | same |
| Two-finger pinch | zooms about the centroid | same | same |
| Two-finger twist | turns the view after 25 px of arc, threshold subtracted; release within 7° of north snaps | same | same |
| Held press (tools that act on `press`: Plant stamp places a plant, Polygon adds a corner) | from phase 3 (`touch.gestures`) the ToolHost holds a finger's `press` until the finger passes slop (then `press` and the drag), lifts (then `press` and `tap`), or the 500 ms long-press window ends still (then the menu, and the press is dropped); so a withdrawn press never reached the tool and nothing needs undoing | same | same |
| Second finger before the first passed slop | the held press is withdrawn (`cancel('multitouch')`) before the tool saw it; the two-finger gesture starts | same | same |
| Second finger after a one-finger drag started | the drag is cancelled and its edit aborted; a polygon draft keeps its corners; the two-finger gesture starts | same | same |
| One finger lifted from two | nothing resumes until every finger is up | same | same |
| Third finger | ignored | same | same |
| Handles | 44 px targets (`hitRadiusPx` 22) | — | — |
| Touch on the text entry (`owned-text`: the note editor, a child of the map host) | no canvas session: a tap moves the caret, a long press selects text with the native callout, a drag scrolls or selects inside the entry; the 500 ms timer never runs there, so no canvas menu | same | — |

Host CSS only when `touch.hostTouchActionNone` (from phase 3): `touch-action: none; -webkit-touch-callout: none; overscroll-behavior: none` on the map host, and `touch-action: auto; -webkit-touch-callout: default` on the text-entry host (the callout is inherited), both asserted by a DOM test.

### 3.5 Pen

| Input | Before phase 2 | From phase 2 |
|---|---|---|
| Tip (contact) | primary, as the left-button rows of §3.2 | same |
| Hover | `hover` | same |
| Barrel button, drag | no pan; the native `contextmenu` the barrel fires opens the canvas menu (at press on Linux and macOS, at release on Windows), as the right button of §3.1 | pan; with Shift at press: turn the view |
| Barrel button, tap | the native `contextmenu` opens the canvas menu (at press on Linux and macOS, at release on Windows), as the right button | canvas menu, source `pen-barrel` |
| Eraser | ignored | ignored |
| Tip drag with the Pan tool | pans | pans (the Pan tool exists for pens without a barrel button) |

A Wacom that Firefox on Linux reports as a mouse is handled as a mouse (documented limitation).

### 3.6 Keys

Scope and switch are defined in §1.6. "Switch" is Settings › Keyboard › single-key shortcuts: `follows` rows stop when it is off; `always` rows keep working. Mac chords replace Ctrl with Cmd for every mod row.

The Scope column is built in F (no legacy rebuild, U7); until then the keyboard port keeps today's gates.

| Key | Action | Scope | Switch | Phase |
|---|---|---|---|---|
| V, H, P, W, K, Z, R, E, L, T, M | arm Select, Pan, Plant stamp, Plant a row, Object stamp, Polygon, Rectangle, Ellipse, Line, Text, Measure | `command` | follows | unchanged |
| N | reset north (300 ms) | `command` | follows | 1 (was cycle labels) |
| Shift+N | reset north (300 ms) | `command` | always | 1 |
| Shift+L | cycle labels: none, codes, names | `command` | follows | 1 (moved from N, convention) |
| Shift+← / Shift+→ | turn the view to the next 15° multiple left / right (300 ms, about the centre): from 22°, Shift+→ ends at 30°, not 37° (spec: the user said "rotates 15 degrees"; landing on the 15° grid is this document's reading) | `view-arrows` | n/a | 1 (was large nudge or large pan) |
| Shift+↑ | reset north | `view-arrows` | n/a | 1 (was large nudge or large pan) |
| Shift+↓ | unbound, reserved for tilt | — | — | 1 (convention) |
| ← → ↑ ↓ | with a selection, the Select tool armed and site mode: nudge 10 cm along the screen direction (from 1; before: world axes); with a selection in another tool or in overview: nothing (today, every phase); with none: pan 64 px along the screen, in any tool and in overview. Never while a pointer session (drag, band, move, handle drag, pan or rotate) is live: the arrow does nothing (today, `keyboard-port.ts:146`; every phase; fixture H25) | `canvas-focus` | n/a | 1 |
| mod+arrows | as the arrows, 1 m or 256 px, along the screen | `canvas-focus` | n/a | 1 (was Shift+arrows) |
| Alt+arrows | unbound | — | — | — |
| macOS Ctrl+arrows | not bound (Mission Control) | — | — | — |
| Shift+G, Shift+S, Shift+R | grid, snap to grid, rulers (rulers while rotated: on, hidden, with the hint) | `command` | follows | unchanged |
| [ / ] | a held stamp: turn it −15° / +15°; otherwise send to back / bring to front | `command` | follows, except that a held stamp's turn also works on map focus with the switch off (today, `keyboard-port.ts:198-206`; fixture H24) | unchanged |
| Delete, Backspace | delete the selection. Backspace during a polygon draft removes the last corner instead. Delete on a focused or selected corner handle removes that corner (from 2) | `command` (Backspace in a draft: `canvas-focus`) | n/a | unchanged, corner from 2 |
| Enter | Polygon draft: finish (3+ corners). One selected note: edit its text. Compass focused: reset north | `canvas-focus` | n/a | unchanged; compass 1 |
| F2 | one selected note with map focus: edit its text; otherwise rename the Design | `canvas-focus`, then shell | n/a | unchanged |
| Space (held) | a left drag pans in every tool | `canvas-focus` | n/a | unchanged |
| Space (press) on a focused button | activates it (compass: reset north) | the button | n/a | compass 1 |
| Esc | the Esc chain (§3.7) | chain | n/a | per §3.7 |
| Menu key, Shift+F10 | canvas menu for the selection (beside its bounds, else mid-map) | `canvas-focus` | n/a | unchanged |
| + / − (no modifier) | zoom in / out one step | `canvas-focus` | n/a: like a held stamp's `[` `]`, they stay on with the switch off because they act only while the map has focus (WCAG 2.1.4 allows a shortcut active only on focus), and the Settings hint and the `settings.rs` doc comment say so from phase 2 | 2 |
| Ctrl+Plus / Ctrl+Minus | zoom in / out one step | `command` | n/a | step unified in 2 |
| Shift+F, Ctrl+0, Home | fit the Design at the current bearing | `command` (Home: `canvas-focus`, spec) | Shift+F follows | Home 2 |
| Shift+2 | zoom to the selection at the current bearing | `command` | follows (spec: like Shift+G) | 2 |
| Ctrl+Alt+R | rotate the selection | `command` | n/a | unchanged |
| Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y | undo, redo; during a polygon draft they undo and redo corners | `command` | n/a | unchanged |
| Ctrl+X, C, V, D, A, Shift+A, G, Shift+G, Shift+L | cut, copy, paste, duplicate, select all, same species, group, ungroup, lock | `command` | n/a | unchanged |
| Ctrl+K, Ctrl+S, F1, F6 | place search, save, shortcuts, next region; work in text fields | `global` | n/a | unchanged |
| Tab, Shift+Tab | focus navigation | browser | n/a | unchanged |

Tool letters and where the tools live:

| Tool id | Label | Key | Main rail | Phone strip | Menus |
|---|---|---|---|---|---|
| `select` | Select | V | yes | yes | Tools, palette |
| `hand` | Pan | H | no (from 2; before: yes) | yes | View and Tools (from 2), palette |
| `plant-stamp` | Plant stamp | P | yes | yes | Tools, palette |
| `plant-spacing` | Plant a row | W | yes | no | Tools, palette |
| `object-stamp` | Object stamp | K | yes | no | Tools, palette |
| `saved-object-stamp` | saved stamp | none (hidden) | no | no | armed from Favorites and the stamp chooser with a `saved-stamp` source |
| `polygon` | Polygon | Z | yes | yes | Tools, palette |
| `rectangle` | Rectangle | R | yes | no | Tools, palette |
| `ellipse` | Ellipse | E | yes | no | Tools, palette |
| `line` | Line | L | yes | no | Tools, palette |
| `text` | Text | T | yes | no | Tools, palette |
| `measurement-guide` | Measure | M | yes | no | Tools, palette |

Chords whose character needs Shift (spec): the router matches `+` by the produced key and ignores Shift for it (US QWERTY sends Shift+= as key `+`, shiftKey true), and matches Shift+2 by `code` `Digit2` with Shift on every layout (US QWERTY produces `@`, AZERTY `2`). Fixtures H20–H22.

Moved keys, in one list: N (cycle labels → reset north); Shift+L (new: cycle labels); Shift+arrows (large nudge and pan → turn view and reset north; Shift+↓ unbound); large step (Shift+arrow → mod+arrow, on the canvas, in the PDF page editor and in the inspection lens); Plant a row no-snap (Shift → mod during the drag); Esc on a held stamp pick (leave the tool → drop the pick first; Plant a row already drops its source first today); Pan tool (main rail → View and Tools menus, palette, phone strip). Moved behaviour: Space held at a press on a rotate or vertex handle (the handle drags → the map pans, from 2).

### 3.7 Esc per tool

The text entry (note editor, spacing field) is not a layer: its element handler (`chrome/text-entry-host.ts`, the tool card's field) cancels it and returns focus to the map before the router's bubble listener runs (§1.6 step 8, §3.8).

| Priority | Layer | Active when |
|---|---|---|
| 100 | open popover, menu, dropdown, colour or symbol popover | open (phase F moves their document listeners into layers) |
| 80 | canvas context menu | open |
| 70 | live pointer gesture, including a rotate drag and a compass drag (the compass registers its own layer; both restore the starting camera) and, from 2, a pan (right-, middle- or Space-drag, the Pan tool: the pan ends where it is and the Esc is consumed; spec). | a drag, band, move, handle drag, pan or rotate is live |
| 65 | nudge series (abort) | arrows moved the selection and the series is not committed |
| 60 | tool transient | a polygon draft or a Plant a row source (today); from 2 also a held stamp pick |
| 50 | non-Select tool → Select | any tool but Select is armed |
| 30 | selection → clear | something is selected |
| 25 | raster inspection → end | inspecting |
| 10 | dock panel or phone sheet → close | open |

The canvas layers are active from every focus class except `text` and `modal` whenever a tool is armed, a gesture is live or a transient exists (phase F; phase 0 keeps today's behaviour). One Esc runs one layer. In overview only layers 100, 70 (a live pan or rotate, or today's interrupted gesture), 30 (from 2, the overview selection), 25 and 10 run; 65, 60 and 50 never run there, so Esc never leaves the tool in overview (today), and the per-tool table below applies in site mode only.

The priority table is built in F, the popover layers in the same window as the chain (fixture I8); until then the keyboard port keeps today's Esc order and popovers keep their document listeners. No canvas row matches Esc: `deselect` carries only a key hint (`app/canvas-commands/index.ts:351`) and the canvas rows come from `definition.shortcuts`.

| Tool | 1st Esc | 2nd Esc | 3rd Esc |
|---|---|---|---|
| Select | clears the selection | — | — |
| Pan | Select | clears the selection | — |
| Plant stamp | Select ("Esc to stop placing") | clears | — |
| Plant a row, source chosen | drops the source (today, `plant-spacing-tool.ts:205-211`) | Select | clears |
| Object stamp, pick held | drops the pick (from 2; before: Select at once) | Select | clears |
| Saved object stamp | drops the saved stamp; the card offers "Choose a saved stamp" (from 2; before: Select) | Select | clears |
| Polygon, draft | drops the draft | Select | clears |
| Line, Measure, Rectangle, Ellipse, during the drag | cancels the drag | Select | clears |
| Text, entry open | cancels the entry | Select | clears |
| Any tool, rotate drag live | restores the camera | next layer | — |
| Any tool, pan live (from 2, spec) | ends the pan where it is; the tool stays armed | next layer | — |

The tool card's "Esc …" line is rendered from `describeEscape()`. Phase 0 keeps today's order for Plant a row (INV-KEY-09): its Esc runs before the live-gesture layer, so it drops the source even mid-drag, and with no source it requests Select itself.

### 3.8 Exceptions

| Surface | Rule |
|---|---|
| Text entry (note editor, the tool-card spacing field) | Focus class `text`: letters type; single-key shortcuts, Delete, arrows, Shift+arrows, N and Shift+N do not reach the canvas; `global` rows with `worksInTextFields` still work. Enter commits, Shift+Enter adds a line, Esc cancels. From phase F both are IME-safe in the entry itself: `chrome/text-entry-host.ts` ignores Enter and Esc while `isComposing || keyCode === 229`, because its element listener runs before the key router's guard. Any press on the map outside the entry, primary, middle or right, commits it first (today: `_pointerDownWhenSettled` commits on buttons 0 and 1, then focuses the host; the map taking focus commits an entry that holds focus on its blur, and the host submits one whose blur commit was refused; every phase), so a middle- or right-drag pan or a Shift+right- or Shift+middle-drag turn closes it; a primary press that commits a new note's entry places no note and reaches no tool (today, §3.2). Space held in the entry types a space and arms no pan (fixture G11), so a Space-drag never starts from it; while a new note's entry is open without focus (the frame before it takes focus, or after a refused blur commit), Space reaching the map arms no pan either, as today's Text adapter (§1.4 "Releases"). A wheel over the map keeps the entry open and the entry follows its note; a key turn or reset cannot reach the map from the entry (focus class `text`). A still right-click (a `menu-request`) commits the entry first, then opens the menu. Esc in the entry is the entry's own element handler, which runs before the chain; no canvas pan or turn is live while it is open. Wheel over the entry itself is not handled. The textarea is drawn at `rotationDeg − bearing`. |
| PDF page editor (`components/canvas-pdf/PdfPageEditor.tsx`) | A separate surface with its own pointer handling and a pushed key scope; the canvas input pipeline does not run there. See the table below. |
| Modal dialogs | Only the modal's element handlers, its pushed scope if it has one, and `worksInModal` rows (§1.6 step 5). |
| Story presenter | A modal (`StoryPresenter.tsx:36` holds the modal layer) whose pushed presentation scope runs as its own handler: Space, arrows and Esc navigate the story; no canvas keys (fixture I12). Each step restores its bearing. |
| Canvas context menu, popovers | Their own arrows; Esc closes one at a time. |
| Arrow-owning widgets (lists, sliders, tabs, menus) | Plain and Shift+arrows stay with the widget; N, Shift+N and other `command` keys act on the canvas unless the widget claims them with `data-owns-keys`. |
| Inspection lens preview | Arrow-owning: arrows move the lens along the screen; mod+arrow moves farther (spec, matching the canvas; was Shift); Shift+arrows move by the plain step (from 1). Drag is screen-relative. |
| World map (template and place picker) | Its own MapLibre map: north-up, left-drag pans, wheel zooms, no rotation, no compass; `boxZoom: false` from 2 (convention). Its keyboard handler keeps arrow pans and +/− zoom but `disableRotation()` stops Shift+arrows turning and tilting it (from F, INV-CAM-46); its container declares `data-owns-keys="arrows"`, so Shift+←/→/↑ never reach the workspace view from it (from 1, fixture H26). |
| Inspecting a raster (Desktop LiDAR inspection) | A plain primary press (mouse left, pen tip, and a one-finger tap) anywhere on the map samples the point instead of reaching the tool, after handles and the pan check and before the tool (today, `scene-interaction.ts:609-614`; ToolHost `deps.inspect`, fixture J10). Shift, mod or Alt at the press still samples (today: the probe reads no modifier); the sampled press starts no drag, band or move. Space+drag and a Pan-tool drag pan (the pan check comes first), and a Pan-tool click does not sample (today); from phase 3 (`touch.gestures`) a touch probe runs when the held press resolves to a tap, never on a drag, a long press or a second finger. In overview the probe never runs (today: overview presses pan before 2; from 2 they select, convention). Right, middle and pen-barrel input, the canvas menu, wheel and every rotation input are unchanged; Esc layer 25 ends inspecting. |
| Compass, zoom group, attribution | `owned-chrome`: a press there never starts a canvas gesture; the attribution no longer starts a band (phase F). |

PDF page editor, every phase unless marked (today: `PdfPageEditor.tsx:60` accepts only button 0; `:106-107` arrows):

| Input | Behaviour |
|---|---|
| Left drag (mouse), pen tip, one finger | moves the page window, or draws a Print Area while adding (pointer events: pen and touch act as the left button, today) |
| Shift, mod or Alt during a page-window drag or a Print Area draw | nothing: the Print Area is drawn free, not squared (convention; the canvas rule "Shift constrains every drawing tool" covers canvas tools only) |
| Right, middle, pen barrel (press, drag, click) | nothing; no canvas menu and no pan (the editor has no context menu) |
| Wheel, pinch, trackpad twist | nothing (no wheel handler); the wheel scrolls the dialog as it does elsewhere |
| Two-finger touch | nothing over the editor: its interactive SVG sets `touch-action: none` (`PdfPageEditor.tsx:102`), so the browser neither scrolls nor zooms; touch users scroll the dialog outside the editor |
| Space held | nothing |
| Arrows | move the content 5 pt, the way the canvas does (from F; today the page window moves) |
| Arrows while adding a Print Area or in navigation-only mode | nothing (today, `PdfPageEditor.tsx:106`: the handler returns while `adding` or `navigationOnly`) |
| Drag in navigation-only mode | moves nothing (today) |
| Click (under 4 px of travel) on a page window of the overview (`data-pdf-target`), except while adding | opens that page (`onPage`, today); in navigation-only mode only page windows take a press |
| mod+arrows | 30 pt (from 1; was Shift) |
| Shift+arrows | nothing (from 1) |
| Alt+arrows | nothing (today) |
| Esc | cancels a live drag; otherwise the dialog's own Esc |
| Rotation (from 1) | drag and arrow offsets are screen deltas turned into ground deltas by the page angle (`PdfPageFrame.fromFrame`, §1.7) |

## 4. Rotation behaviour

### 4.1 Where rotation comes from

Rotation starts only from deliberate inputs (user): Shift+right-drag (from 2), Shift+middle-drag (from 1), macOS Ctrl+Shift+left-drag (from 2), pen barrel + Shift (from 2), Shift+← and Shift+→ (from 1), the compass ring (from 1), a macOS trackpad twist past 10° (from 1), a two-finger touch twist past 25 px of arc (from 3), "Turn view to this edge" (from 1), and restores (saved views, stories, last view). There is no Alt+wheel rotation and no setting to turn rotation off.

### 4.2 Compass

- **Place.** Always visible (at north too): in the zoom group on desktop and in the phone zoom column on the Web edition (from 1). As a button inside that group it inherits the group's layer on the stacking scale and its visible-map-area registration (`useMapOccluder` in `ZoomControls.tsx`); it adds no entry to `global.css` or the seam. Its look is set in `.interface-design/patterns/canvas-navigation.md` (a round button whose needle points to true north, turned by `−bearingDeg`).
- **Click.** Tweens to north in 300 ms about the centre; at north it does nothing.
- **Drag.** A primary drag anywhere on the compass face (the hit area is the whole button, though the copy says "ring"; past 3 px of travel, under that it is a click) turns the view about the screen centre by the pointer's angle around the compass centre (`beginRotation('centre')`); the needle follows the pointer, so moving clockwise around the face lowers the bearing by the angle swept (§2.2, rotation sign). Shift steps to absolute 15° multiples while held; release returns to the raw angle. Release within 7° of north snaps to north in 300 ms. Works with mouse, pen and touch from phase 1 (the compass sets `touch-action: none`). While dragging, the face takes `--color-accent-soft` and a grabbing cursor (pattern).
- **Keyboard.** A focusable button: Enter or Space resets north; Shift+←/→ turn as anywhere; Esc during a compass drag restores the starting camera: while dragging, `Compass.tsx` registers an Esc layer at priority 70 (`registerEscapeLayer`, active while its `RotationSession` is live) that calls `cancel()`, because the compass drag runs outside the input pipeline and `ToolHost.hasLiveGesture()` cannot see it (fixture I9).
- **Words.** `aria-label` "Reset north" and `aria-keyshortcuts="N Shift+N"`; description (`aria-description`) "View turned {{degrees}}° from north" (Intl number) or "North is up"; no `title`: a `ButtonTooltip` shows "Reset north" with N and the hint as its second line (pattern `canvas-navigation.md`).

### 4.3 Reset and the animation

Reset north comes from N (follows the switch), Shift+N (always), Shift+↑, a compass click, View › Reset north (also the phone View menu) and the palette. Every reset and key step is a 300 ms ease-out cubic tween about the screen centre along the shortest arc; with `prefers-reduced-motion: reduce` it jumps to the target instead. A pan or zoom during it composes with it. Repeated key presses compute from `bearingTarget()`, so three Shift+→ presses within 300 ms end at 45°. A running flight is interrupted by any move, which lands at the flight's target bearing.

Turning while something else is live (convention):
- **During a primary drag in phase 1** (a band, move, draw or handle drag): key turns, resets and a compass click apply, and the draft stays in world space, like a wheel zoom during a drag today; the ToolHost re-emits the drag on the camera frame. The trackpad twist starts no rotation while a primary session is live (one session at a time, §2.2). From phase 2 the same holds for every navigation input (§3.2).
- **During a live rotate session** (Shift+right- or Shift+middle-drag, a trackpad twist, a compass drag), every phase: key turns, resets and compass clicks are ignored; the session owns the bearing until it ends.
- **The snap to north after a rotate release** (300 ms) is a tween like a reset: a key turn or reset during it computes from `bearingTarget()`, a pan or zoom composes with it, and it is not an Esc layer (Esc does not restore the pre-release bearing).

Fixtures in `view/navigation.test.ts`: "Shift+→ during a left drag turns the view and keeps the draft's start on the ground" (phase 1), "Shift+→ during a rotate drag does nothing", "Esc during the snap to north does not restore the bearing".

### 4.4 Snapping and steps

| Rule | Applies to |
|---|---|
| Snap to north on release within 7° (`angularDistanceToNorth`), 300 ms tween about the gesture pivot | free gestures: pointer rotate drags, compass drag, touch twist, trackpad twist |
| 15° steps while held, absolute multiples (`roundToStep`), raw angle again when released | mod added during Shift+right-drag or Shift+middle-drag (recorded resolution: Shift is already held); Shift during a compass drag |
| A Mac Ctrl that made the press a right click never steps | macOS Ctrl+Shift+left-drag; adding Cmd steps |
| Next 15° multiple in the key's direction (22 → 15 → 0; 0 → 345) | Shift+← and Shift+→ |
| Never snapped | explicit targets: "Turn view to this edge", saved views, stories, `showPlace`, `centerOn` with a bearing, the last view; a saved view at 3° restores at 3° |
| No stepping | touch and trackpad twist |

### 4.5 Nudges and key pans

Arrows move the selection along screen directions (↑ = up on screen) by 10 cm, or 1 m with mod, converted through `screenAxesInWorld()`, only with the Select tool in site mode (today's condition, kept); with a selection in another tool or in overview they do nothing. With nothing selected they pan 64 px, or 256 px with mod, along the screen, in any tool. The PDF page editor turns its screen deltas into ground deltas by the page angle. The inspection lens moves along the screen.

### 4.6 Grid, snapping, rulers and guides

- The grid, grid snapping and guides stay on true east and north (world axes) and turn with the map (user). The grid is drawn in `worldRoot` from phase 1.
- Rulers show only while north is up. When the view is rotated `chrome/rulers.ts` hides them, and a glass pill above the view chip (`components/canvas/RulersNorthHint.tsx`, rendered by `ViewChip.tsx`, registered with the visible-map-area seam through `useMapOccluder`, reading `ViewReadSurface` and the rulers toggle) shows "Rulers show when north is up" with a Reset north link (pattern: the ruler corner sits under the title bar); resetting north brings them back if the Rulers option is on. Turning rulers on while rotated shows only the hint.
- Ruler guides already on the map stay: they are world east-west and north-south lines and turn with the map. New ruler guides can be pulled only while north is up. Measurement guides are world lines and turn with the map; their labels stay upright.

### 4.7 Objects created on a rotated map

| Object | Rule |
|---|---|
| Rectangle, ellipse | drawn aligned to the screen (`screenAlignedRect`), stored with `rotationDeg = normaliseBearing(bearing)` (user; identical at 0) |
| Note | created level to the screen, stored with `rotationDeg = normaliseBearing(bearing)`; at bearing 0 it writes 0 instead of null, which renders identically |
| Object and saved stamps | the held pick starts at `rotationDeg = bearing`, so it reads as saved relative to the screen; [ and ] step 15° from there (convention). A saved stamp dropped from Favorites, and its dragover ghost, use the same `rotationDeg = bearing` as a click (convention; today both pass 0, `saved-object-stamp-tool.ts:170-180`, `:219-223`) |
| Paste, duplicate | keep north-relative geometry |
| Polygon, line, measure, plant row | vertices are where the pointer is; Shift constrains to 45° against the screen axes |
| Print Area drawn on an "As on screen" page | level with the page; the area has no angle of its own (one layout angle, §4.12) |

### 4.8 Labels and text orientation

Notes are map objects: stored `rotationDeg` is clockwise from true north (null reads as 0), and the text is drawn at `rotationDeg − bearing`, so notes turn with the map. Everything else stays upright on screen: plant glyphs (side-view pictograms), plant names, zone names and measurement readouts, stack badges, guide labels, draft labels, handles, the hover tooltip and the locked affordance. Billboards are never under a rotating container.

### 4.9 Hit testing and band select

Hits are world-space and unaffected by bearing; pixel tolerances convert through `metresPerPixelAt`. The band is drawn as a screen rectangle and hits everything in its world quad (the band's corners through `screenAxesInWorld`, `tools/select/band.ts`, → `hitInQuad`); the draft is a `quad` shape. Selection handles anchor on the selection hull projected from four corners; the rotate handle sits 42 px above the hull's top edge on screen. The note hit box is the rotated text box, north-relative, the same model as print and GeoJSON.

### 4.10 Saved views and stories

- Capture writes `SavedViewCamera.bearing = normaliseBearing(bearing)` and the extent as the lon/lat bounding box of the ground under the four screen corners (convention; no new field).
- Restore uses centre, zoom and bearing from the camera at every bearing (from 1): going to a view or a story step no longer fits the stored extent to the window (`savedViewZoomFor`, `current-view.ts:98-104`, today), so a view saved in a large window reopens closer in a small one (plan section 8, phase 1). The extent is used only by thumbnails of north-up views (`snapshot.ts:71`; a rotated view's thumbnail scales its camera zoom to the thumbnail, as a view without an extent does today) and by older builds, which show a rotated view north-up and slightly zoomed out.
- Stories restore each step's bearing; restores are explicit targets and never snap.

### 4.11 Snapshot map and thumbnails

The snapshot map (`maplibre/view-snapshot-map.ts`) has its own `MapLibreCameraDriver` and applies the saved view's bearing. Saved-view and story thumbnails are drawn at the saved bearing (the cache key already includes the camera). Recent-file sketches (`DesignSketch`) and saved-stamp thumbnails stay north-up. PDF page-rail thumbnails follow their page's orientation.

### 4.12 PDF

- A two-option control labelled "Map orientation" under Plant colours (placement and look: `.interface-design/patterns/canvas-navigation.md`, Export planting plan); it is not the paper "Orientation" of a page. North up (default) and As on screen. The bearing is captured once when the PDF workspace opens.
- **One angle for the whole layout** (user, 2026-10-01): 0 under North up, the captured bearing under As on screen. Every page, the overview and each Print Area's, is drawn at it, so Print Areas carry no angle of their own (no `PdfPrintArea.rotationDeg`).
- North up: every map page is north-up (`angleDeg` 0, `turnSnapshot` is the identity).
- As on screen: every map page is drawn at the captured bearing. Each page's layout runs on `turnSnapshot(snapshot, pageFrame(angle, ground centre))`; `PdfPage.angleDeg` records the angle.
- Page windows on the overview are today's rectangles, since every area shares the overview's angle; the overview's coverage fit (`fitOverview`) is today's.
- A Print Area is a rectangle in the layout's frame. Switching Map orientation turns every area about its own centre with the layout, so each area stays level on its page (convention; plan §8).
- Overview guide bands (`overview-guides.ts`): "horizontal" means horizontal on the page, in the turned frame; on an As on screen overview the band follows the screen's horizontal.
- Split sheets split along the page's axes in the layout's frame; every sheet keeps the layout angle.
- The page editor turns its screen deltas back by `fromFrame` (+angle) before applying them to the ground.
- The north arrow ("North arrow and scale") always points to true north: it is drawn at `−angle` with its letter. The scale bar is unchanged.

### 4.13 Inspection lens

The lens turns with the view (convention): its local transform is built at the live bearing, so the loupe matches what is under the pointer. Its drags and arrows are screen-relative.

### 4.14 Scale bar and zoom limits

The scale bar and 1:N ratio read the ground resolution at the screen centre, which does not depend on the bearing at pitch 0. Rotation can raise the zoom floor at world zoom (the rotated viewport must stay inside one world copy); `zoomLimit` reports `min` at the floor for the live bearing, so the zoom-out button disables correctly.

### 4.15 Opening a Design and the last view

Reopening a Design with content restores the last bearing (user) and fits at it (`openAt`). A new or empty Design opens north-up at the zoomed-out last-view centre, so "Where is your site?" appears over a north-up overview (convention). `LastView` is per device: the bearing carries over to whichever Design opens next. Fit, Fit to Design, zoom to selection, temporary focus and place search keep the current bearing.

### 4.16 Turn view to this edge

A canvas-menu entry when the menu request's point lies within the edge tolerance of a polygon or rectangle zone's edge (pattern), in its own group before Lock. The edge is not highlighted while the entry is (user, 2026-10-01: no `highlightEdge` hook). Sources: a mouse right-click, a Mac Ctrl+click (from 2) and a pen-barrel tap use 8 px; a long press (from 3) uses the 22 px touch radius. The Menu key and Shift+F10 have no point, so they never offer it: the entry is pointer-only, a named exception to the keyboard-path rule of `system.md` (the keyboard turns the view with Shift+←/→). Ellipse zones have no edges and never offer it. It turns the view by the smaller angle that makes the edge horizontal on screen, as a 300 ms tween about the centre, never snapped. The bearing is saved with any saved view captured afterwards.

### 4.17 World map

North-up, no rotation, no compass; left-drag pans (a navigation-only picker); Shift+arrows no longer turn or tilt it (phase F); Shift+drag no longer box-zooms (phase 2, convention).

### 4.18 Web Edition phone layout and touch

- Phase 1: the compass joins the phone zoom column, and the phone View menu gains "Reset north", so a phone user who opens a rotated Design (last view, saved view, story) can always return north. The compass ring turns the view by touch from phase 1.
- The Pan tool stays in the phone strip in every phase.
- Phase 3: two-finger pan, pinch and twist; long press opens the menu; one finger edits; 44 px handle targets; Fit joins the phone zoom column.
- Rulers are not shown on phones today; the hint follows the rulers.

### 4.19 Re-origin

The session plane stays north-aligned whatever the bearing. Re-origin runs on the settled frame when the ground under the screen centre is more than 10 km from the origin; the camera keeps its ground (the MapLibre driver's camera is geographic, and the headless driver applies the plane change to its `PlanarCamera` in plane terms, as today's reprojection does), so the map does not move. Drafts, gesture starts, handles and the temporary-focus bookmark survive it.

## 5. Synthetic event-sequence tests

Recogniser fixtures live in `canvas/runtime/input/__fixtures__/sequences.ts` and run through `normalise` and `recognise` with an injected platform, clock and bindings. Each is named by its id and title, for example `seq('A1 Windows right-click', { os: 'windows', engine: 'chromium' })`. The "V2" column is the one current constant's values from phase 2 (touch fields from phase 3), "LEGACY" its values in phase 0 and F (§1.2); unless a row says otherwise a V2 expectation also holds from phase 3, and every LEGACY expectation pins today's behaviour. There is no per-constant matrix: the phase that changes a field rewrites the fixtures whose outcome changes and deletes the superseded expectations (audit 1.2), so after the release close only the end state remains.

A property test (`input/recognise.property.test.ts`) covers any interleaving of down, move (with changing `buttons`), up, cancel, reject, blur, escape and configure: every started session ends exactly once, every press the host sees ends with exactly one `tap`, `drag-end` or `cancel` (a Pan-tool drag's with `cancel('navigate')`; a reject ends its session with no gesture), and every `capture` effect is paired with a release.

### 5.1 Secondary button

| Id | Platform | Sequence | Expect (V2) | Expect (LEGACY) |
|---|---|---|---|---|
| A1 Windows right-click | windows/chromium | down(2) → up(2) within 1 px → contextmenu +66 ms | one `menu-request(release point, mouse)` on up; contextmenu prevented, emits nothing | contextmenu opens the menu |
| A2 Windows right-drag | windows/chromium | down(2) → moves `buttons 2` to (+100, +80) → up → contextmenu | `pan` deltas summing to (100, 80), the first including the sub-slop offset; trailing contextmenu prevented; no menu | no pan; menu on the trailing contextmenu |
| A3 Linux right-click | linux/webkitgtk and chromium | down(2) → contextmenu → up(2) | contextmenu prevented; one menu on up | menu at the contextmenu |
| A4 Linux or macOS right-drag | linux, mac | down(2) → contextmenu → moves → up | pan; no menu | menu at press; no pan |
| A5 Right press, pointerup lost | linux | down(2) → contextmenu → move `buttons 0` | session ends silently; no pan from that move; no menu; next down starts fresh | — |
| A6 WKWebView capture then nothing | mac/webkit | down(2) → contextmenu → lost capture | `cancel('lost-capture')`; no menu; nothing stuck | — |
| A7 Right-drag then pointercancel | any | down(2) → moves → pointercancel | `cancel('pointercancel')`; the camera keeps the panned position; no menu | — |
| A8 Windows retargeted late contextmenu | windows/chromium | down(2) → up(2) → contextmenu on `<html>` or the open menu | one menu; the retargeted contextmenu is prevented by the document guard | — |
| A9 Right-drag in every tool | each of the 12 tools, polygon with 2 corners | A2 | `pan` only; the tool receives no press or drag; the polygon keeps its corners | — |
| A10 Left pressed during a right-drag | any | down(2) → moves → move `buttons 3` → move `buttons 2` → up(2) | pan continues; no press reaches the tool; no selection change | — |
| A11 Right pressed during a left drag | any | down(0) → moves `buttons 1` → move `buttons 3` → (linux) contextmenu → moves → move `buttons 1` → up(0) | ignored (U2): no pan; the band continues and commits; contextmenu prevented; no menu | no pan; the band continues and commits; the native contextmenu opens the menu unless a Scene Edit is live (today) |
| A13 Shift+right-drag with mod steps (spec) | windows, linux | down(2, Shift) → moves right → mod pressed (key-state) → moves → mod released → up | `rotate` with `step` false, then true, then false, `totalDeltaDeg` positive (rightward raises the bearing); `rotate{end}` on up | nothing |
| A14 Esc during a right rotate (spec) | any | A13 without mod → `escape` | `rotate{cancel}`; no menu | — |
| A15 Right-click in the note editor (spec) | linux, windows | down(2) on the text-entry host (`owned-text`) → contextmenu → up(2) | contextmenu not prevented (native text menu); no `menu-request`; no session | same |
| A16 Right-click on a dock input (spec) | any | down(2) on a panel field (`foreign`) → contextmenu → up(2) | nothing emitted; contextmenu not prevented | same |
| A17 Esc during a right-drag pan (spec) | any | A2 until mid-drag → `escape` → more moves → up(2) | `pan{end}` at the escape; later moves emit nothing; no menu on up | — |
| A18 Shift after the press (spec) | any | down(2) → key-state Shift → moves past 3 px → up(2) | `pan`, not `rotate` (Shift at the press decides) | no pan |

### 5.2 macOS Ctrl+click

| Id | Platform | Sequence | Expect (V2) | Expect (LEGACY) |
|---|---|---|---|---|
| B1 macOS Ctrl+click | mac/webkit, chromium, gecko | down(0, ctrl) → contextmenu → up(0, ctrl) → (Safari, Firefox) click | `menu-request(at, ctrl-click)` on up; no selection toggle; click ignored | additive toggle and the native menu |
| B2 macOS Ctrl+drag | mac | down(0, ctrl) → contextmenu → moves → up | `pan`; no band; no menu | band with additive toggle; menu |
| B3 Ctrl+click on Windows and Linux | windows, linux | B1 without contextmenu | `tap` with ctrl → additive toggle; no menu | same |
| B4 macOS two-finger trackpad click | mac | down(2) → contextmenu → up(2) | as A3 | as A3 legacy |
| B6 Mac Ctrl+Shift+click drag | mac | down(0, ctrl, shift) → moves → Cmd pressed → moves | `rotate` unstepped; `step` true after Cmd; Ctrl never steps | band |
| B7 Mac Ctrl+drag never opens the menu | mac | B2 with the contextmenu at press | pan; the contextmenu is prevented; no `menu-request` on up | — |

B5 is not used.

### 5.3 Keyboard menu

| Id | Sequence | Expect |
|---|---|---|
| C1 Menu key on Windows | focus map; keydown ContextMenu → keyup → contextmenu within 500 ms | one `menu-request('selection', keyboard)` on keydown; contextmenu prevented |
| C2 Shift+F10, both orders | keydown F10+Shift → contextmenu before or after keyup | one menu request |
| C3 Menu key held | keydown, 3 repeats, keyup, contextmenu | one menu request |
| C4 Menu key in the text entry | focus text | no request; native text menu allowed |
| C5 Late echo | keydown at 0, contextmenu at 600 ms | V2: a keyboard-sourced contextmenu while a keyboard menu is open is ignored; LEGACY: today's behaviour pinned |

### 5.4 Pen

| Id | Sequence | Expect (V2) | Expect (LEGACY) |
|---|---|---|---|
| D1 Pen barrel tap | pen down(2) → up(2) → contextmenu | one `menu-request(at, pen-barrel)`; contextmenu prevented | nothing from the barrel; native menu today |
| D2 Pen barrel drag | pen down(2) → moves → up | `pan` | nothing |
| D3 Pen tip draw | pen down(0) → moves (coalesced samples) → up | primary drag; samples fall back to the event | same |
| D4 Eraser | pen down(5, buttons 32) → up | nothing | nothing |
| D5 Pen hover | pen moves `buttons 0` | `hover` only | same |
| D6 Wacom as mouse (Firefox on Linux) | D3 with `pointerType mouse` | mouse drag; documents the limitation | same |
| D7 Pen barrel + Shift drag | pen down(2, Shift) → moves; add Cmd or Ctrl (mod) during the drag | `rotate` unstepped, then 15° steps while mod is held | nothing from the barrel |

### 5.5 Touch and trackpad gestures

| Id | Sequence | Expect |
|---|---|---|
| E1 One-finger tap | touch down → up | `tap`; no hover left behind |
| E2 One-finger drag | touch down → moves → up | from phase 3: primary drag (band or draw), never pan; host `touch-action: none` asserted by a DOM test |
| E3 Browser steals the touch | touch down → 2 moves → pointercancel | `cancel('pointercancel')`; no half band committed |
| E4 Two-finger pan, zoom, turn | id1 down, id2 down, both move, id2 up, id1 up | from phase 3: id1 cancelled (`multitouch`) before any commit; `pan` by centroid, `zoom` by distance ratio, `rotate` after 25 px of arc; after id2 up the remaining finger does not resume |
| E5 Second finger after a drag started | one-finger draw past slop, then id2 down | from phase 3: the draw is cancelled, not committed; a polygon draft keeps its corners |
| E6 Long press on Android | touch down, hold 600 ms, contextmenu, up | from phase 3: exactly one `menu-request(long-press)` whichever arrives first; contextmenu prevented |
| E7 Long press on iOS | touch down, hold 600 ms, up | from phase 3: `menu-request(long-press)` from the timer; no tap |
| E8 Long press with movement | move past slop at 200 ms, hold, up | drag; no menu |
| E9 Trackpad pinch with rotation drift | mac/webkit, ROTATION on: gesturestart → changes with scale 1.2, 1.5 and rotation ±4° → gestureend | `zoom` only; no `rotate` |
| E10 Deliberate trackpad twist | mac/webkit: rotation 5°, 12°, 20° (WebKit `rotation` is clockwise-positive) | nothing at 5°; `rotate` starts at 12° with `totalDeltaDeg` −2°, then −10° (the ground follows the fingers: a clockwise twist lowers the bearing); snap on end if within 7° of north; defaults prevented |
| E11 Touch under V2 behaves like today, except overview (a one-finger drag bands from 2, G7) | V2: one touch down → moves → up; a second touch meanwhile | primary drag as today; the second touch is ignored; no long press |
| E13 Press-acting tools under a pinch | from phase 3, Plant stamp armed: id1 down, id2 down 40 ms later, both move; Polygon armed: same | no plant placed; no corner added; `pan`/`zoom` only |
| E14 Press-acting tools under a long press | from phase 3, Plant stamp armed, then Polygon armed: touch down, hold 600 ms, up | the menu opens; no plant placed; no corner added |
| E12 iOS gesture events alongside pointers | from phase 3, ios: id1, id2 down → gesturestart → gesturechange(1.5, 10°) → pointer moves → gestureend | one source of truth (the pointer recogniser); `gesture*` prevented, not counted twice |

### 5.6 Wheel and trackpad

| Id | Sequence | Expect |
|---|---|---|
| F1 Windows wheel notch, Mouse | wheel dy 100 | `zoom(pointer, exp(−0.2))`; from phase 2 one zoom step |
| F2 Same, Trackpad | wheel dy 100 | `pan(0, −100)` |
| F3 Firefox line mode | wheel deltaMode 1, dy 3 | dy normalised to 48 px; guard test that `deltaMode` is read first |
| F4 Chromium pinch (synthetic Ctrl) | wheel ctrl, dy −2.3, no Control keydown | `zoom(factor > 1)` in both settings; no Ctrl recorded as held; default prevented |
| F5 Real Ctrl + wheel | keydown Control → wheel ctrl dy 100 → keyup | zoom, same path, clamped |
| F6 Trackpad scroll, Trackpad | wheel dx 3.5, dy −7.25 | `pan(−3.5, 7.25)` |
| F7 Trackpad scroll, Mouse | same | zoom on dy; dx ignored (today) |
| F8 Shift + wheel, Trackpad, one axis | Trackpad: wheel shift, dx 0, dy 100 | `pan(−100, 0)` (LEGACY pins it: today's swap) |
| F9 Shift + wheel, macOS swapped | Trackpad, mac: wheel shift, dx 100, dy 0 | `pan(−100, 0)`; never a double swap |
| F10 Shift + wheel, Mouse | Mouse: wheel shift, dx 0, dy 100 | `pan(0, −100)` (LEGACY pins it: today's Mouse Shift+wheel pans as delivered, no swap) |
| F10b Shift + wheel delivered as dx | Mouse: wheel shift, dx 100, dy 0 (Chromium, and WebKitGTK if the live check shows dx) | `pan(−100, 0)` |
| F11 WKWebView pinch and rotate | gesturestart → change(1.2, 5°) → change(1.5, 12°) → end | ROTATION on: `zoom(1.2)`, `zoom(1.25)`; `rotate` starts only past 10° (total 2° at 12°); LEGACY: `gesture*` ignored (no listener today), WebKit's Ctrl wheels zoom |
| F12 WKWebView pinch with Ctrl wheels | gesturestart → wheel ctrl → change(1.1) → wheel ctrl → end | zoom only from the gesture; Ctrl wheels inside the gesture ignored; LEGACY: the gesture is ignored and each Ctrl wheel zooms |
| F13 WebKitGTK pinch | no DOM events | none possible; a manual release check records the documented absence |
| F14 Momentum tail | 20 small wheels at 16 ms, a pointerdown during the tail | wheels stay standalone; the press starts a fresh session |
| F15 Wheel over owned text | wheel on the text-entry host | not prevented; no output |
| F16 Page mode | wheel deltaMode 2, dy 1; then dx 0.25 at host width 400 | dy = host height; dx = 100 (a page of dx is the host width) |
| F17 Alt + wheel (spec) | wheel alt, dy 100, Mouse | zoom as without Alt; never `rotate` |
| F18 Wheel during a rotate (convention) | ROTATION: down(1, Shift) → moves → wheel dy 100 → moves → up | `rotate` continues; the wheel emits no `zoom`; LEGACY: the Shift+middle-drag is a `pan`, and the wheel zooms as today |

### 5.7 Middle button and Space

| Id | Sequence | Expect |
|---|---|---|
| G1 Middle-drag | down(1) → moves → up → (Firefox) auxclick | `pan`; pointerdown default prevented; auxclick ignored |
| G2 Middle-click on Linux | down(1) → up(1) → auxclick | nothing; pointerdown prevented |
| G3 Space+drag | Space down (repeats) → down(0) → moves → up → Space up | Space recorded once; `pan` (`space-drag`), not band; cursor grab → grabbing → tool cursor (the session's navigation cursor, §1.4) |
| G3b Space at a press on a handle | Space down → down(0) on the rotate handle → moves → up → Space up | LEGACY and ROTATION: `handle-drag` (today's handle-first order); V2: `pan` (`space-drag`), the handle is not dragged |
| G4 Space then alt-tab | Space down → blur → later down(0) → drag | blur releases Space; the later drag is primary |
| G5 Stale Space | Space down → hidden → down(0) | `visibilitychange` clears Space; primary drag. LEGACY: no `visibilitychange` listener, so only blur clears Space (today) |
| G6 X11 autorepeat pairs | Space down, up, down in the same ms during a drag | pan continues (a keyup followed by keydown within 30 ms counts as repeat) |
| G7 V2 overview left drag | V2, mode overview: down(0) → moves → up | `drag-start` (band), not `pan` |
| G8 Pan tool under V2 | V2 (touch from phase 3), tool hand: pen tip drag; touch drag | `pan` (`primary-drag`) |
| G9 Shift+middle-drag rotates (spec) | ROTATION: down(1, Shift) → moves 20 px right → up | `rotate` about the press point with `totalDeltaDeg` +16 (rightward raises the bearing); LEGACY: `pan` |
| G10 Space while a rail button has focus | focus rail button; Space down → down(0) on the map → drag → Space up | the press moves focus to the host; primary drag; no button click |
| G11 Space in the text entry | focus text; Space down | no pan arming |
| G12 Space during IME | compositionstart → keydown Space, key Process, isComposing | no pan arming |

### 5.8 Keys, focus and Esc (KeyRouter tests)

These run in `app/keyboard/*.test.ts` with `KeyboardEventLike` literals.

| Id | Sequence | Expect |
|---|---|---|
| H1 AZERTY Ctrl+Z | key z, code KeyW, ctrl | undo |
| H2 AZERTY physical Z | key w, code KeyZ, ctrl | not undo (label wins on Latin layouts) |
| H3 QWERTZ Ctrl+Z and Ctrl+Y | key z code KeyY; key y code KeyZ | undo; redo |
| H4 Russian Ctrl+Z | key я, code KeyZ, ctrl | undo (phase F `code` fallback) |
| H5 Russian single key | key м, code KeyV, map focus | Select (phase F) |
| H6 AZERTY Ctrl+1 | key &, code Digit1, ctrl | Layers (phase F) |
| H7 AZERTY Ctrl+Shift+1 | key 1, code Digit1, ctrl, shift | pinned policy: Layers |
| H8 AltGr | key @, code Digit0, ctrl, alt | nothing |
| H9 macOS Cmd+Option+R | key ®, code KeyR, meta, alt | rotate selection |
| H10 macOS lost keyup under Cmd | Meta down → s with meta → Meta up | Save once; held set empty after Meta up |
| H11 IME commit in WebKit | composition, Process keys, compositionend, Enter with keyCode 229 | nothing |
| H12 Single keys off | key v, switch off | nothing |
| H13 Web reserved shortcut | web: ctrl+1 | not intercepted |
| H14 N and Shift+N with the switch (spec) | switch on: N; switch off: N, Shift+N | reset, nothing, reset |
| H15 Shift+arrows in a listbox (spec) | focus listbox: Shift+→; focus the compass (a button outside any arrow-owning widget): Shift+→ | listbox keeps it; the view turns |
| H16 Shift+L and N moved (spec) | Shift+L; N | cycle labels; reset north (never cycle labels) |
| H17 mod+arrow on Mac (spec) | mac: Cmd+→ with a selection; Ctrl+→ | 1 m nudge; nothing |
| H18 Arrow-owning splitter and rail (spec) | focus the dock splitter: Shift+ArrowLeft; focus a tool-rail button: Shift+ArrowUp | the splitter resizes and the view does not turn; the rail keeps the key and north is not reset |
| H19 Declared arrow owners (spec) | focus the lens preview (`data-owns-keys="arrows"`): Shift+→; the phone sheet handle: Shift+↑; a calendar date button: Shift+→; the photo carousel: Shift+← | the lens moves by the plain step (as an unmodified arrow); the sheet, the calendar and the carousel handle it; the view does not turn |
| H20 QWERTY `+` (spec) | en-US, map focus: key `+`, code Equal, shift | zoom in one step |
| H21 QWERTY Shift+2 (spec) | en-US: key `@`, code Digit2, shift | zoom to the selection |
| H22 AZERTY Shift+2 (spec) | fr: key `2`, code Digit2, shift | zoom to the selection |
| I1 Arm from a panel, then Esc | click Place → armed → focus map → Esc | tool disarmed |
| I2 Panel kept focus | armed, focus on the panel button, Esc | from F: the canvas Esc layer runs |
| I3 WKWebView focus model | armed, focus body; Esc; Menu key | Esc disarms; the menu opens for the selection |
| I4 Esc in the canvas menu | Esc on a menu item | menu closes; tool stays armed; focus returns to the map |
| I5 F6 then Space | F6 → Space | Space goes to the region; no pan arming |
| I6 Press on the host | pointerdown on the host | focus with `preventScroll`; no `:focus-visible` |
| I7 Blur mid-gesture | down(0) → move → blur | `cancel('blur')`; Space released |
| I8 One Esc, one thing (spec) | popover open over an armed polygon draft: Esc, Esc, Esc | popover closes; draft drops; Select |
| I9 Esc during a compass drag (spec) | Select with a selection; compass drag in progress; Esc | the starting camera returns; the selection stays |
| I10 Esc during a drag, focus in the lens (F) | left drag live; focus in the inspection lens panel; Esc | the drag aborts and the lens stays open (today the lens also closes; no rebuild pins that bug) |
| I11 F6 past a widget that stops propagation (F) | focus inside the inspection lens; F6 | the next region takes focus (capture listener) |
| I12 Presenter scope inside its modal (F) | story presenter open (modal layer held): ArrowRight; N | the next step; nothing |
| I12b Presenter keys need its focus (F) | story presenter open, focus on `<body>`: ArrowRight; Space; Esc | nothing (today: the presenter hears only keys inside its root) |
| H23 Scale button owns its arrows (F, again in phase 1) | focus the scale button (`ZoomControls.tsx:138-143`): Shift+↑ | the scale menu opens; no nudge or pan (the button handles its arrows first); from 1 the bearing is unchanged |
| H24 Held stamp turns with the switch off (F) | single-key shortcuts off, map focused, Object stamp holding a pick: `]`; then focus the body: `]` | the pick turns +15° on the map; nothing on the body |
| H25 Arrows during a live drag | Select with a selection; a move-drag in progress: → | nothing: no nudge and no pan (today) |
| H26 The World map owns its arrows (1) | focus the World map canvas (`data-owns-keys="arrows"`): Shift+→, Shift+↑ | the workspace view neither turns nor resets; MapLibre's rotation is off (INV-CAM-46) |
| H27 F2 falls through to the shell (F) | map focus with nothing selected: F2; map focus with one note selected: F2 | rename the Design (the row's `fallback`, after the port's `edit-text` returns false); edit the note |

### 5.9 Precedence

| Id | Sequence | Expect |
|---|---|---|
| J1 Left-drag never pans | select: drag; hand: drag | band; `press`, `pan`, then `cancel('navigate')` after the `pan{end}` (J1_HAND: every press the host sees ends) |
| J2 Shift+drag is not box zoom | down(0, Shift) → drag | additive band; never zoom |
| J3 Legacy overview | LEGACY, overview: drag; still right-click | `pan`; contextmenu prevented, no menu |
| J9 Space with the Pan tool | hand armed, Space held, drag | `space-drag` pan (same result) |
| J10 Inspection probe order (the host rows in `tools/tool-host.test.ts` with harness tools, the pan rows in `input/recognise.test.ts`) | LEGACY, an inspection claiming presses: down(0) on a rotate handle; Space held, down(0) → drag; Polygon armed, down(0, Shift) on empty ground; overview, down(0); Pan armed, down(0) → up | the handle drags; `pan`; the probe claims the press and Polygon adds no corner; `pan`, no probe; no probe (today's order: handles, pan, probe, tool; a pan never reaches the host) |

## 6. Pitch readiness: what it costs now

Pitch, 3D and the globe are not built and are not on the roadmap (canopi-f47t.11 is not scheduled). The code carries no pitch readiness beyond the literal: `screenToWorld`, `planar` and `affine` are non-null, so their callers hold no null branches, and the compiler lists them again when pitch widens the types. What stays:
- `ViewCamera.pitchDeg` is the literal type `0`. The literal forbids a non-zero pitch; widening it, and `screenToWorld`, `planar`, `affine`, `worldToScreen` and `visibleWorldQuad`, gives the compiler the list of consumers (last paragraph).
- `metresPerPixelAt(p)` takes a point, because resolution varies across a pitched view.
- Quads, not boxes, for visible areas, bands and handle anchors.
- `homographyViewTransform` is not declared (no ambient or stub export, which would compile and fail at runtime, and would be dead code); its signature is kept as a comment in `view-transform.ts` and in §1.1.
- The vertical travel of Shift+right-drag and Shift+middle-drag is ignored and kept free for tilt; Shift+↓ is reserved.

When pitch ships (this paragraph is the recipe; the main agent notes it on canopi-f47t.11, R3, so it survives the spec's deletion): widen `pitchDeg`, set `maxPitch`, re-add `unproject` as a read-back and solve the homography from four samples (keeping `affine` when the projective correction moves no viewport point more than 0.01 px), make `screenToWorld`, `planar`, `affine`, `visibleWorldQuad` and `worldToScreen` nullable or horizon-clipped and fix their callers, add a projective world root in the renderer, choose tilt bindings, and label the scale bar "at centre". Globe: `planar` becomes null and the methods fall back to per-point projection. The changes stay in `maplibre/`, `view/`, the renderer, `tools/tool-host.ts` (null handling) and `input/bindings.ts` (tilt).

## 7. Out of scope

- Pitch or tilt, and any tilt binding (Shift+↓ stays unbound).
- 3D terrain, 3D buildings, extrusions and the globe projection.
- Linux native trackpad pinch (a separate Rust bead investigates `GtkGestureZoom` interception).
- Lasso selection and subtractive band selection (Alt+drag bands as without Alt).
- View history (back and forward between views).
- Alt+wheel or any wheel rotation; a setting to turn rotation off; automatic mouse or trackpad detection; a shortcut remapping UI.
- Rotating the World map, recent-file sketches or saved-stamp thumbnails.
- Rotated rulers, pulling ruler guides while rotated, and selecting, moving or deleting ruler guides.
- A pen eraser tool; coalesced pointer samples for tools.
- Box zoom (Shift+drag) anywhere.
- Navigating with a second button during a drag (user, 2026-10-01): wheel zoom and keys stay live during a drag; a right or middle press during it is ignored.
- An angle per Print Area (user, 2026-10-01: one angle for the whole PDF layout) and an edge highlight for "Turn view to this edge" (user, 2026-10-01).
- A new stored enum for Pointing device, a stored PDF setup, a four-corner saved-view extent, or any `.canopi`, user-DB, LiDAR catalogue or plant-catalog change.
- Performance gates and optimisation beyond making canopi-p32r and canopi-wx8w fixable (phase R), and the select-all and delete-all slowness (its own bead).
- Instanced billboard or screen-constant line shaders (they fit behind `setView` later).

## 8. Stored data

| Store | Change |
|---|---|
| `.canopi` | none. `SavedViewCamera.bearing` is now written (normalised); `extent` keeps its meaning, computed from four corners. Notes, rectangles and ellipses created rotated store the bearing in their existing `rotationDeg`. |
| Settings | `LastView.bearing`, `#[serde(default)]` 0: a one-line default, no migration; older builds ignore it. `scroll_wheel` values unchanged. |
| PDF | `PdfSetup.mapOrientation?` (default North up), in memory only; one layout angle, the bearing captured at PDF open (`CanvasPrintSnapshot.viewBearingDeg`), also in memory. `PdfPrintArea.rotationDeg` is dropped (user, 2026-10-01): no stored format replaces it, since PDF setups are not saved (plan §8). |
| User DB, LiDAR catalogue, plant catalog | none |

## 9. User-facing strings

Every new or changed key exists in all 11 locales (`desktop/web/src/i18n/*.json`), English in sentence case (`i18n-copy.test.ts`); removed keys are deleted from every locale in the change that replaces them. Keys follow the existing layout: nested camelCase, menu items as dotted keys under `menu`. `{{mod}}` is filled with the platform's localised Ctrl or Cmd label; numbers and degrees use `Intl` through `{{value, number}}`. Rows marked (spec) were not in the design and are settled here.

### 9.1 Phase 1 (rotation)

| Key | English | Where |
|---|---|---|
| `menu` → `view.resetNorth` | Reset north | View menu, phone View menu, palette |
| `menu` → `view.turnViewLeft` | Turn view left 15° | View menu, palette (Shift+←) |
| `menu` → `view.turnViewRight` | Turn view right 15° | View menu, palette (Shift+→) |
| `canvas.contextMenu.turnViewToEdge` | Turn view to this edge | canvas menu on a zone edge |
| `canvas.compass.resetNorth` | Reset north | compass `aria-label` |
| `canvas.compass.bearing` | View turned {{degrees, number}}° from north | compass description when rotated |
| `canvas.compass.northUp` | North is up | compass description at 0° |
| `canvas.compass.hint` | Click to reset north. Drag the ring to turn the view; hold Shift for 15° steps. | compass tooltip, second line |
| `canvas.grid.rulersNorthUpOnly` | Rulers show when north is up | pill above the view chip when rotated with Rulers on; its link reuses `canvas.compass.resetNorth` |
| `pdf.mapOrientation` | Map orientation | PDF setup |
| `pdf.mapOrientationNorthUp` | North up | PDF setup option (default) |
| `pdf.mapOrientationAsOnScreen` | As on screen | PDF setup option |
| `shortcuts.turnView` | Turn the view 15° | F1 row (Shift+←, Shift+→) |
| `shortcuts.resetNorth` | Reset north | F1 row (N, Shift+N, Shift+↑) |
| `shortcuts.resetNorthAlways` | Shift+N works even when single-key shortcuts are off. | F1 note |
| `shortcuts.gestures.shiftDrag` | Shift + middle-drag | F1 gesture input (phase 2 changes it, §9.3) |
| `shortcuts.gestures.turnView` | Turn the view; add {{mod}} for 15° steps | F1 gesture action |
| `shortcuts.gestures.compass` | Compass | F1 gesture input |
| `shortcuts.gestures.compassAction` | Click to reset north, drag to turn the view | F1 gesture action |
| `shortcuts.gestures.trackpadTwist` | Twist two fingers on the trackpad | F1 gesture input, macOS only (spec) |

Changed copy in phase 1:

| Key | New English |
|---|---|
| `shortcuts.nudge` | Nudge the selection 10 cm in the arrow's direction on screen |
| `shortcuts.nudgeLarge` | Nudge the selection 1 m (the chord column shows Ctrl or Cmd + arrow) |
| `shortcuts.pan` | Pan the map when nothing is selected (unchanged text; now along the screen) |
| `shortcuts.panLarge` | Pan the map farther when nothing is selected (chord Ctrl or Cmd + arrow) |
| `settings.singleKeyShortcutsHint` | Tool keys such as V, P and Z, N to reset north, brackets and Shift G, S, R, L. Shift N always resets north. Off keeps Ctrl shortcuts, Delete, Esc, arrows and F keys. |
| `canvas.map.description` | Press a tool's key to choose it, as the tool rail shows. Shift F10 opens the menu for the selection. Esc cancels, then returns to Select, then clears the selection. Arrow keys move the selection 10 cm on screen, or 1 m with Ctrl; with nothing selected they pan the map. Shift with left or right arrow turns the view; N or Shift with up arrow resets north. F6 moves to the next area: title bar, tools, map, panel. |
| `canvas.inspection.panHint` | Inspection preview. Drag or use arrow keys to explore; {{mod}} moves farther. (spec) |
| `menu` → `view.cycleLabels` | Labels: none, codes, names (unchanged text; its key moves from N to Shift+L) |

`common-types/src/settings.rs` single-key doc comment: "character-key shortcuts (tool keys such as V or P, N, Shift G, Shift L, brackets). Off leaves only shortcuts with Ctrl, Alt or a named key (Delete, Esc, arrows, F keys), plus Shift N, which always resets north." The Web copy of `canvas.map.description` names Ctrl; macOS builds that show Cmd use the `{{mod}}` form if `i18n-copy.test.ts` requires it (the Keyboard agent decides with the string owner).

### 9.2 Phase F

| Key | New English |
|---|---|
| `shortcuts.toolsHeading` | {{menu}} (anywhere except text fields) |
| `shortcuts.footnote` | Tool keys work anywhere except text fields. |
| `shortcuts.escape` | unchanged text; now true for popovers too |

### 9.3 Phase 2 (controls)

| Key | English | Where |
|---|---|---|
| `settings.singleKeyShortcutsHint` | Tool keys such as V, P and Z, N to reset north, brackets and Shift G, S, R, L. Shift N always resets north. Off keeps Ctrl shortcuts, Delete, Esc, arrows, F keys, and + and − on the map. | Settings › Keyboard (changed from §9.1); the `settings.rs` doc comment adds "and + and − while the map has focus" in the same commit |
| `settings.pointingDevice` | Pointing device | Settings › Canvas (replaces `settings.scrollWheel`) |
| `settings.pointingDeviceMouse` | Mouse: the wheel zooms | option, stored `zoom` (replaces `settings.scrollWheelZoom`) |
| `settings.pointingDeviceTrackpad` | Trackpad: two fingers pan | option, stored `pan` (replaces `settings.scrollWheelPan`) |
| `settings.pointingDeviceHint` | Pinch and Ctrl + wheel always zoom. Shift + wheel pans. | hint (replaces `settings.scrollWheelHint`) |
| `canvas.contextMenu.finishShape` | Finish shape | canvas menu during a polygon draft |
| `menu` → `view.zoomToSelection` | Zoom to selection | View menu (Shift+2) |
| `shortcutKeys.home` | Home | the Home key's name in menus, F1 and tooltips (`formatShortcut`, INV-KEY-25) |
| `canvas.toolCard.escClearStamp` | Esc to clear the stamp | tool card while a pick or saved stamp is held |
| `canvas.toolCard.escClearRow` | Esc to clear the row | tool card while a row source is held |
| `canvas.toolCard.panHint` | Drag to move the map | Pan tool card, shown because Pan is off the rail (pattern) |
| `canvas.toolCard.rectangleKeys` | Shift draws a square | Rectangle tool card (spec) |
| `canvas.toolCard.ellipseKeys` | Shift draws a circle | Ellipse tool card (spec) |
| `canvas.toolCard.lineKeys` | Shift keeps 45° angles | Line and Measure tool cards (spec) |
| `shortcuts.gestures.heading` | Mouse, trackpad and pen | F1 section |
| `shortcuts.gestures.rightDrag` | Right-drag, middle-drag or Space + drag | F1 input |
| `shortcuts.gestures.pan` | Pan the map | F1 action |
| `shortcuts.gestures.rightClick` | Right-click | F1 input |
| `shortcuts.gestures.macCtrlClick` | Control-click | F1 input (macOS) |
| `shortcuts.gestures.menu` | Open the menu | F1 action |
| `shortcuts.gestures.penButton` | Pen side button: drag or tap | F1 input (spec) |
| `shortcuts.gestures.wheel` | Scroll wheel | F1 input |
| `shortcuts.gestures.pinch` | Pinch or Ctrl + wheel | F1 input |
| `shortcuts.gestures.zoom` | Zoom | F1 action |
| `shortcuts.gestures.altClick` | Alt + click | F1 input |
| `shortcuts.gestures.removeFromSelection` | Remove from the selection | F1 action |
| `shortcuts.gestures.linuxPinch` | On Linux, trackpad pinch is not supported yet. Use Ctrl + scroll to zoom. | F1 note (Linux only) |
| `shortcuts.zoomStep` | Zoom in or out one step | F1 row (+, −) |
| `shortcuts.fitHome` | Fit the Design | F1 row (Home, Shift+F, Ctrl+0) |

Changed copy in phase 2:

| Key | New English |
|---|---|
| `shortcuts.gestures.shiftDrag` | Shift + right-drag or Shift + middle-drag |
| `canvas.toolCard.selectHint` | Drag to select · Shift-click adds · Alt-click removes · right-drag pans · wheel zooms |
| `canvas.toolCard.selectHintPan` | Drag to select · Shift-click adds · Alt-click removes · two fingers pan · pinch zooms (spec) |
| `canvas.toolCard.polygon` | Click to add corners. Click the first corner, double-click or press Enter to finish. (spec) |
| `canvas.toolCard.rowKeys` | Shift keeps 45° angles · {{mod}} turns off snapping (spec) |
| `canvas.tools.hand` | Pan (unchanged text; now in the View and Tools menus and the phone strip, not the main rail) |

Deleted in phase 2: `settings.scrollWheel`, `settings.scrollWheelZoom`, `settings.scrollWheelPan`, `settings.scrollWheelHint`.

### 9.4 Phase 3 (touch)

| Key | English | Where |
|---|---|---|
| `shortcuts.gestures.touchHeading` | Touch | F1 section |
| `shortcuts.gestures.oneFinger` | One finger | F1 input (spec) |
| `shortcuts.gestures.oneFingerAction` | Select or draw; with the Pan tool, pan | F1 action (spec) |
| `shortcuts.gestures.twoFingers` | Two fingers | F1 input |
| `shortcuts.gestures.touchNavigate` | Pan, zoom and turn the view | F1 action |
| `shortcuts.gestures.longPress` | Press and hold | F1 input (action: `shortcuts.gestures.menu`) |

Release-note text is written once per release and is not an i18n key.
