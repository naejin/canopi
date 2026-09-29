# Canvas v2 specification: interfaces, bindings, rotation, strings

Status: agreed (2026-09-29); built in phases per docs/plans/canvas-v2-plan.md

This is the contract the canvas v2 work is built to. The phases, owners, gates and bead mapping are in `docs/plans/canvas-v2-plan.md`; what exists today and what happens to each piece is in `docs/plans/canvas-v2-inventory.md`. The reasons live in the ADRs: 0015 (rotating map and canvas controls; amends ADR 0010's control and shortcut rules), 0016 (one view transform), 0017 (input pipeline and gestures), 0018 (narrow tool interface), 0019 (rendering and the view transform), 0020 (focus and keyboard ownership). Delete this file with the plan once phase 3 ships.

Paths are relative to `desktop/web/src/` unless they start with `docs/`, `common-types/` or `desktop/`. `view/`, `input/`, `tools/`, `renderers/`, `chrome/`, `scene-runtime/` and `interaction/` are short for `canvas/runtime/<dir>/`; bare `key-chord`, `keymap`, `escape-chain`, `arming`, `focus-owner` and `key-router` modules and tests are under `app/keyboard/`; `maplibre/` is `src/maplibre/`.

## 0. Notation

- **(user)** marks a user decision (2026-09-29). **(convention)** marks a planner convention the user may overturn; the plan lists them for confirmation. **(spec)** marks a detail this specification settles that the design left implicit; the plan's handoff lists these too.
- **mod** is Cmd on macOS and Ctrl elsewhere. On macOS a physical Ctrl is never mod: from phase 2 it turns a left click into a right click, and Ctrl+arrows belong to Mission Control.
- **Phases** and the one bindings constant each ships: phase 0 and F `LEGACY_BINDINGS` (today's behaviour), phase 1 `ROTATION_BINDINGS`, phase 2 `V2_BINDINGS`, phase 3 `TOUCH_BINDINGS`. "From 1" means the behaviour exists from that phase on; a cell without a phase is unchanged from today.
- **Free gesture**: a rotation whose end angle the user did not choose exactly (pointer rotate drag, compass drag, touch twist, trackpad twist). **Explicit target**: a bearing Canopi was told (key step, reset, "Turn view to this edge", a saved view, a story step, the last view).
- Bearing: the compass direction that is up on screen, degrees clockwise from true north, normalised to [0, 360). Stored rotations (`rotationDeg` on zones, notes, stamps, Print Areas) are clockwise from true north, as today.

## 1. Interfaces

These are the types the seams commit adds before any agent starts. Names are binding; doc comments are part of the contract. Types marked "(types)" hold no code.

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

/** World-axis box in plane metres. Declared here by the seams commit; camera.ts keeps its own copies of the three bounds types
 *  until 0A-1 replaces them with a re-export from this file (plan, Seams "Types only"), and re-exports them until 0D2 ends. */
export interface SceneBounds { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
export interface SceneBoundsOptions {
  /** The scene's extent at a candidate scale: corner points of every plant, zone and note footprint, in plane metres.
   *  Notes and default-mode plants are screen-sized, so the extent depends on the scale (today camera.ts:521-565,
   *  :640-670). The runtime supplies it (command-surface.ts, query-surface.ts) from plant-presentation.ts,
   *  annotation-layout.ts and zone-geometry.ts, so view/ imports none of them (P4). Replaces camera.ts's plantContext. */
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
// ScenePersistedState and ScenePlantEntity are type-only imports from canvas/runtime/scene/types.ts (P4 allows them). Every view/ file
// imports them from '../scene/types', never the barrel '../scene' (P4 would reject it); files outside view/ keep today's barrel imports.

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

export interface ViewScreen { readonly width: number; readonly height: number; readonly devicePixelRatio: number }

/** Renderer and bulk-projection fast path. Null for non-planar projections (globe). */
export interface PlanarProjection {
  /** Row-major 3x3 homography, plane metres → CSS px (homogeneous), Float64. */
  readonly matrix: Float64Array
  /** 2x3 affine in Pixi order [a, b, c, d, tx, ty]. Always set while pitchDeg is 0; null only for a pitched homography. */
  readonly affine: readonly [number, number, number, number, number, number] | null
}

export interface ViewTransform {
  readonly revision: number          // increments on every build
  readonly planeRevision: number     // session-plane identity; stale transforms are refused after re-origin
  readonly camera: ViewCamera
  readonly screen: ViewScreen
  readonly planar: PlanarProjection | null

  worldToScreen(p: WorldPoint): ScreenPoint
  /** Null only above the horizon (pitch) or off a globe; never null at pitch 0. */
  screenToWorld(s: ScreenPoint): WorldPoint | null
  /** Bulk billboard projection: reads [x0,y0,x1,y1,…] metres, writes CSS px. No allocation. */
  projectAnchors(world: Float64Array, out: Float32Array, count: number): void

  /** Local ground resolution at a world point (view centre if omitted). Replaces `1 / viewport.scale` and the scale-bar value. */
  metresPerPixelAt(p?: WorldPoint): number
  screenDistance(a: WorldPoint, b: WorldPoint): number
  /** Unit world vectors of screen-right and screen-down at a point (view centre if omitted). */
  screenAxesInWorld(at?: WorldPoint): { readonly right: WorldVector; readonly down: WorldVector }

  visibleWorldQuad(insets?: ScreenInsets): WorldQuad
  visibleWorldBounds(insets?: ScreenInsets): SceneBounds
  screenRectToWorldQuad(a: ScreenPoint, b: ScreenPoint): WorldQuad | null
  /** Four projected corners, never two (rotation-handle anchor, menu anchor). */
  worldQuadToScreen(q: WorldQuad): readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint]

  readonly pixelsPerMetre: number            // at the plane origin: today's `viewport.scale` (zoom bands, policy)
  readonly northUp: boolean                  // angularDistanceToNorth(bearing) < 0.05° and pitch 0
}

/** Everything the runtime publishes per camera change. Runtime-only (policy P10). */
export interface ViewFrame {
  readonly view: ViewTransform
  readonly mode: 'site' | 'overview'         // overview below 0.1 px/m (canvas/workspace-camera-policy.ts)
  readonly scaleBounds: { readonly min: number; readonly max: number }   // the effective bounds: policy zooms with the single-world floor at the live bearing (§1.1b)
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

/** Injected time for the frame source (P4: view/ names no timer or clock itself). */
export interface FrameSourceDeps {
  readonly clock: () => number
  readonly timers: { set(atMs: number, cb: () => void): number; clear(id: number): void }   // the 150 ms settle
}

/**
 * Dev diagnostics published with the map contributions and the surface state. Replaces `MapFrame`
 * and its `diagnostics` (canvas/maplibre-camera.ts, deleted end of 0A); `viewportCenterWorld` is renamed `centreWorld`.
 */
export interface ViewDiagnostics {
  readonly camera: ViewCamera
  readonly centreWorld: WorldPoint
  /** Ground under the four screen corners, TL, TR, BR, BL (was viewportCornerGeo). */
  readonly groundQuadGeo: readonly [GeoPoint, GeoPoint, GeoPoint, GeoPoint]
}
```

The names `viewFrame`, `settledViewFrame` and `onViewFrame` are distinctive on purpose: policy P10 confines them by identifier.

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
  readonly moving: ReadonlySignal<boolean>
  /** Overview only: the Design origin's screen point, rounded to whole pixels, or null in site mode or within 24 px of an edge.
   *  The one read that changes during a pan (the overview pin must track the Design); it updates per frame only in overview,
   *  where nothing else re-renders, and is the named exception to the coarse-signal rule (P10). */
  readonly designPin: ReadonlySignal<ScreenPoint | null>
  /** The camera after 150 ms without change (the settled frame's camera): last view, map contributions, coverage. Never a user-triggered capture (captureView). */
  readonly settledCamera: ReadonlySignal<ViewCamera>
  /**
   * Saved-view capture, saved-view snapshot, PDF capture, story restore point: the LIVE frame's camera (viewFrame.peek(),
   * not the settled one), its four-corner ground extent and the screen it was seen on. User-triggered captures record what
   * is on screen now, as today's `queries.viewport` reads do (current-view.ts:49, :86, snapshot.ts:64, controller.ts:102),
   * so a capture within 150 ms of a pan, zoom or key pan, or during a flight, never records the previous camera. The last
   * view (settings) keeps `settledCamera`, as today.
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
  focusTemporaryBounds(bounds: SceneBounds, options: TemporaryBoundsFocusOptions): boolean          // kept: plant finder, LiDAR
  returnFromTemporaryFocus(): boolean                  // kept
  setFramingInsets(insets: ScreenInsets): void         // kept: the visible-map-area seam
  resetNorth(): void
  rotateBy(direction: 1 | -1): void                    // next absolute 15° multiple in that direction
  beginRotation(pivot: 'centre'): RotationSession      // compass drag
  showCamera(camera: ViewCamera, options?: { readonly motion?: 'fly' | 'jump' | 'ease' }): void   // saved views, stories
  /** Place search. Returns false when the place cannot be shown (today's boolean `showPlace`). */
  showPlace(place: GeoPoint, zoom: number, options?: { readonly motion?: 'fly' | 'jump' }): boolean
}
```

**How the view surfaces meet today's session surfaces (§1.1a).** `ViewCommandSurface` replaces today's `CanvasViewportCommandSurface` (`canvas/runtime/runtime.ts:82`) and is exposed as `CanvasCommandSurface.viewport`, so `currentCanvasViewportCommandSurface()` in `canvas/session.ts` keeps its name and returns it. Kept methods: `zoomIn`, `zoomOut`, `zoomBy`, `zoomToFit`, `returnToDesign`, `focusTemporaryBounds`, `returnFromTemporaryFocus`, `setFramingInsets`, `showPlace` (still boolean). New: `zoomToSelection`, `resetNorth`, `rotateBy`, `beginRotation`, `showCamera`. Removed: any method that returned or took a `SceneViewportState`. `ViewReadSurface` is added to `CanvasQuerySurface` as `view`, read through `currentCanvasQuerySurface()`. Readers of the query surface's `viewport` field move to `view` in 0A-2 (saved views, story controller, command projection, tool card, gallery snapshots, LiDAR request, map contributions); the four Components-0D2 files and `app/plant-display/coverage.ts` move in 0D2; the main agent removes the field at the end of 0D2, after those streams merged. `CanvasViewSceneRequest` (`runtime.ts:219-227`) and `ViewSnapshotScene.build` (`maplibre/view-snapshot-map.ts:44`) take a `view: ViewTransform` instead of `viewport: SceneViewportState` from 0D2; the snapshot map's own driver supplies it, and `captureViewScene` (`query-surface.ts:70-75`) decides overview from `view.pixelsPerMetre`. `CanvasQuerySurface` also gains `subscribePointerWorld(listener: (point: WorldPoint | null) => void): () => void`, forwarding `ToolHost.subscribePointerWorld` (typed optional in the seams commit so no fake changes; `query-surface.ts` and `interaction-session.ts` implement it in 0B, which makes it required and fills the fakes), which the inspection lens component uses instead of its own map-host `pointermove` (INV-ENT-23). The lens handle contract in `canvas/inspection.ts` changes twice: in 0D2 `CanvasInspectionState` gains `sourceQuad: readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint]` (the lens source outline on the main map, from the lens `ViewTransform`; the component draws it instead of `point`, `scale` and `frame` arithmetic, INV-XF-16; Renderer), and in phase 1 `panBy(delta)` in world metres is replaced by `panByScreen(deltaPx: InspectionPoint)`, which the lens turns into ground at its bearing (INV-WR-17, INV-KEY-21; View). `CanvasOverview.tsx` places the overview pin from `ViewReadSurface.designPin` (INV-XF-17). App code (`app/**`, `components/**`, `web/**`) uses only these two surfaces, except `workspace-activation.ts`, which attaches the driver (Attachment, below); `ViewFrameSource` stays inside `canvas/runtime/**` and `maplibre/**` (P10). Policy P15 names both accessors.

**Resize.** One owner changes the screen size. The host's `ResizeObserver` (`maplibre/host.ts:323-331`) no longer calls `map.resize()`; it calls `CameraDriver.setScreen(size)`. The MapLibre driver then calls `map.resize()`, re-runs `constrainCamera` at the live bearing (the zoom floor depends on the screen size and the bearing, §4.14) and publishes one frame. The other `resize()` calls (`maplibre/workspace-camera.ts:193`, `:237`, `maplibre/view-snapshot-map.ts:358`, `maplibre/surface-adapter.ts:128`, `canvas/runtime/document-surface.ts:149`) become `setScreen` calls on their driver or are deleted with their module (INV-WR-19). P1 forbids `resize` on a map outside the driver.

```ts
// canvas/runtime/view/camera-driver.ts  (types)

export type CameraMove =
  /** deltaPx is content movement: the ground under the pointer moves by deltaPx. New centre = unproject(screenCentre − deltaPx). */
  | { readonly kind: 'pan-by'; readonly deltaPx: ScreenPoint }
  | { readonly kind: 'zoom-around'; readonly anchorPx: ScreenPoint; readonly factor: number }
  /**
   * Keep the ground under anchorPx fixed while the bearing changes; the centre is an output.
   * 'ease' runs a driver tween (durationMs, default 300) about the same anchor.
   */
  | {
      readonly kind: 'rotate-around'
      readonly anchorPx: ScreenPoint | 'centre'
      readonly bearingDeg: number
      readonly animation: 'none' | 'ease'
      readonly durationMs?: number
    }
  /** Go to a full camera. The centre is an input; no anchor. 'ease' is a driver tween; 'fly' is MapLibre flyTo. */
  | {
      readonly kind: 'set'
      readonly target: ViewCamera               // pitchDeg: 0 by type
      readonly animation: 'none' | 'ease' | 'fly'
      readonly durationMs?: number              // ease: 300 default
    }

export interface CameraDriver {
  readonly frames: ViewFrameSource
  /** Synchronous for 'none' moves and the incremental kinds: `frames.viewFrame` is current on return (unless queued). */
  apply(move: CameraMove): void
  /** The bearing a running tween or flight will end at, else the live bearing. */
  bearingTarget(): number
  stopAnimation(): void
  /** Re-origin: attached rebuilds against the new plane; headless recomputes (camera is geographic). */
  planeChanged(plane: SessionPlane): void
  setScreen(screen: ViewScreen): void
  setInsets(insets: ScreenInsets): void
  dispose(): void
}

/** Injected into both drivers (P4: no clock or requestAnimationFrame in view/). */
export interface CameraDriverDeps {
  readonly clock: () => number
  /** One animation-frame callback; returns its canceller. Tests step it by hand. */
  readonly scheduleFrame: (cb: (nowMs: number) => void) => () => void
  readonly policy: () => NavigationPolicy
}

export interface CameraDriverFailure { readonly reason: 'map-lost' | 'agreement' | 'map-error'; readonly message: string }

/**
 * Owns the runtime's one camera across attach, detach and failure; replaces CameraController's detached mode.
 * The runtime starts on a HeadlessCameraDriver (tests, before attach). `frames` is stable across swaps.
 */
export interface CameraDriverHost {
  readonly frames: ViewFrameSource
  readonly current: () => CameraDriver
  /** Hands the camera to an attached driver: it starts with a 'set'/'none' move to the current camera; ViewFrame.attached becomes true. */
  attach(driver: CameraDriver): void
  /** Back to a HeadlessCameraDriver at the last camera; ViewFrame.attached becomes false. */
  detach(): void
  /** Today's replacePolicy (a new session-plane latitude): the host rebuilds its NavigationPolicy from it and re-constrains the current camera. */
  replacePolicy(policy: WorkspaceCameraPolicy): void
  /** Set when the attached driver fails; the host has already detached. */
  readonly failure: ReadonlySignal<CameraDriverFailure | null>
}
```

Attachment (`app/canvas-map-surface/workspace-activation.ts`, INV-CAM-44): the activation receives the runtime's `CameraDriverHost` in its options where it receives `MapLibreWorkspaceCameraOwner` today (`workspace-activation.ts:85`, filled by the scene runtime's construction), builds the driver with `createMapLibreCameraDriver(map, plane, deps: CameraDriverDeps)` from `maplibre/camera-driver.ts`, and calls `attach`; `replacePolicy(createWorkspaceCameraPolicy(lat))` stays as today (`:175`). It is the one app module that uses the driver host rather than the two surfaces below (P10 allows its type-only import of `camera-driver.ts`); `detach` on teardown; it subscribes to `failure` where it subscribes to `attachment.subscribeFailure` today and reports the map as unavailable with the failure's message. A rotated camera is never a failure: the old "rejected its projection" refusal is gone, and an agreement error above 0.01 px throws in tests and logs in dev builds only.

Driver rules: `MapLibreCameraDriver` (`maplibre/camera-driver.ts`) and `HeadlessCameraDriver` (`view/headless-driver.ts`) both implement `CameraDriver` with the same `camera-math`, `constrainCamera`, `BearingTween` and `buildViewTransform`. The MapLibre driver is the only code that calls camera methods on the workspace and snapshot maps; it always sends explicit `jumpTo({ center, zoom, bearing, pitch: 0 })` values (one per tween frame) and `flyTo` only for long flights. After `move` it reads back `getCenter/getZoom/getBearing` and builds the frame from them. A `CameraDriver.apply` made while a frame dispatch runs is queued and applied once, after every listener ran, in the same task. The map stays `interactive: false`, `dragRotate: false`, `touchZoomRotate: false`; `MapLibreMapInstance` gains `getBearing`, `unproject`, `stop`.

| Move | Driver work | MapLibre call |
|---|---|---|
| `pan-by` | `panCamera`; during a tween, bearing = live tween frame | `jumpTo` |
| `zoom-around` | `zoomCameraAround` | `jumpTo` |
| `rotate-around` / `none` | `rotateCameraAround` | `jumpTo` |
| `rotate-around` / `ease` | starts a `BearingTween` about the anchor | `jumpTo` per animation frame |
| `set` / `none` | `constrainCamera(target)` | `jumpTo` |
| `set` / `ease` | tween of centre, zoom and bearing | `jumpTo` per animation frame |
| `set` / `fly` | `constrainCamera(target)`; guard arc = [live bearing, target bearing] for the whole flight | `flyTo({ center, zoom, bearing })` |

The map's `transformConstrain` is an adapter over `constrainCamera` whose bearing arc is a driver field set before each call (`[b, b]` for a jump, `[from, to]` for a flight); it never reads `map.getBearing()`. Tweens are not cancelled by other moves: a pan or zoom during a tween composes with it. A flight is stopped by any other move, and the interrupting `jumpTo` carries the flight's target bearing.

```ts
// canvas/runtime/view/navigation-policy.ts  (pure; shared by both drivers)

/**
 * Built by createNavigationPolicy(base, reducedMotion) from today's WorkspaceCameraPolicy (canvas/workspace-camera-policy.ts,
 * kept: pure, and P4 lets view/ import it). The reference latitude turns zooms into px/m (cameraScaleBoundsForPolicy → ViewFrame.scaleBounds).
 */
export interface NavigationPolicy {
  readonly referenceLatitudeDeg: number    // the session plane's latitude; replacePolicy changes it
  readonly minZoom: number                 // 0
  readonly maxZoom: number                 // 27
  readonly overviewPixelsPerMetre: number  // 0.1
  readonly referencePixelsPerMetre: number // 20 px/m = 100 %
  /** prefers-reduced-motion: reduce. Read by the platform (platform/desktop.ts, platform/browser.ts) and injected; view/ never calls matchMedia (P4). Eases and tweens become 'none' moves while true. */
  readonly reducedMotion: ReadonlySignal<boolean>
}

/**
 * Clamp zoom so one world copy covers the viewport rotated by every bearing in `bearingArc`
 * (renderWorldCopies:false), then clamp the centre latitude so the rotated screen quad stays
 * inside ±85.05°. Idempotent. The zoom floor depends on the screen and the arc, never on the
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

// canvas/runtime/view/bearing-tween.ts  (pure step function; the clock is injected)
export interface BearingTween {
  readonly targetBearingDeg: number
  readonly anchorPx: ScreenPoint | 'centre'
  /** The camera for time t, computed from the LIVE camera (so pans and zooms during the tween compose). */
  step(live: ViewCamera, screen: ViewScreen, nowMs: number): { readonly camera: ViewCamera; readonly done: boolean }
}
export function startBearingTween(from: ViewCamera, move: { readonly bearingDeg: number; readonly anchorPx: ScreenPoint | 'centre'; readonly durationMs: number; readonly centerTarget?: GeoPoint; readonly zoomTarget?: number }, nowMs: number): BearingTween
```

A tween frame rotates the live camera about the anchor to the interpolated bearing (ease-out cubic, shortest arc), plus, for a `set`/`ease` move, interpolated centre and zoom. Every tween frame goes through `constrainCamera` with that frame's bearing.

```ts
// canvas/runtime/view/navigation.ts  (the camera policy; the only user of CameraDriver; implements RotationSession from read-surface.ts)

export interface ViewNavigationDeps {
  readonly driver: CameraDriverHost                   // the only CameraDriver user
  readonly policy: () => NavigationPolicy
  readonly clock: () => number
  /** The scene for zoomToFit, returnToDesign and zoomToSelection without arguments. */
  readonly readScene: () => { readonly persisted: ScenePersistedState; readonly selection: readonly WorldPoint[]; readonly bounds: SceneBoundsOptions }
}
export function createViewNavigation(deps: ViewNavigationDeps): ViewNavigation

export interface ViewNavigation extends ViewCommandSurface {
  /** Without arguments (the surface call) the navigation reads the current scene from its construction deps. */
  zoomToFit(scene?: ScenePersistedState, options?: SceneBoundsOptions): void   // keeps the bearing
  returnToDesign(scene?: ScenePersistedState, options?: SceneBoundsOptions): void
  /** Oriented at the current bearing: the box's four corners are fitted, not the box on screen axes. */
  focusTemporaryBounds(bounds: SceneBounds, options: TemporaryBoundsFocusOptions): boolean
  returnFromTemporaryFocus(): boolean        // bookmark is a ViewCamera: re-origin cannot invalidate it
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

/** Pitch 0: centre, zoom and bearing + plane.mercatorOrigin / mercatorUnitsPerMeter → similarity. Both drivers call this. */
export function buildViewTransform(input: {
  readonly camera: ViewCamera
  readonly screen: ViewScreen
  readonly plane: SessionPlane
  readonly planeRevision: number
  readonly revision: number
}): ViewTransform

// Pitch phase (not written now: no declaration, no stub; see §6). When pitch ships, this module adds
//   homographyViewTransform(input: { camera, screen, plane, homography: Float64Array, planeRevision, revision }): ViewTransform

// maplibre/view-agreement.ts  (the only caller of map.project / map.unproject in the workspace)
/**
 * Dev and test builds: unproject the four points at 25 %/75 % of width and height, map them
 * through the built transform, and report the maximum screen error. Above 0.01 px it logs a
 * diagnostic (throws in tests). Never a source of the transform.
 */
export function assertViewAgreement(map: Pick<MapLibreMapInstance, 'unproject'>, view: ViewTransform, plane: SessionPlane):
  { readonly maxErrorPx: number }
```

### 1.1b Test view and the legacy camera surface (0A to the end of 0D2)

`createTestView` is the one way tests build a camera from 0A on. View writes it in 0A-1 with its self-test `__tests__/support/test-view.test.ts`; every 0B, 0D2 and later stream builds on this shape and does not change it without the main agent (a change is a spec edit).

```ts
// __tests__/support/test-view.ts  (test support; P3 lets it call buildViewTransform)
import type { CameraController } from '../../canvas/runtime/camera'   // the legacy shim, 0A to the end of 0D2 only

export interface TestViewOptions {
  /** Default { width: 400, height: 300, devicePixelRatio: 1 }: the split files' camera today. */
  readonly screen?: Partial<ViewScreen>
  /** Bearing-0 placement in today's terms (screen = world × scale + { x, y }). Default { x: 0, y: 0, scale: 1 }. */
  readonly viewport?: { readonly x: number; readonly y: number; readonly scale: number }
  /** Instead of viewport: a full camera (rotated tests from phase 1). */
  readonly camera?: Partial<ViewCamera>
  /** Default createSessionPlane({ lon: 0, lat: 0 }). */
  readonly plane?: SessionPlane
  /** Default: the policy CameraController uses today when constructed without one. */
  readonly policy?: WorkspaceCameraPolicy
  readonly insets?: ScreenInsets
}

export interface TestView {
  /** Starts on a HeadlessCameraDriver, built with the production factories and the manual clock below. */
  readonly host: CameraDriverHost
  readonly frames: ViewFrameSource            // host.frames
  readonly navigation: ViewNavigation         // readScene returns an empty scene unless the test passes one to setScene
  /** Manual time: the drivers' clock and scheduleFrame and the frame source's timers all read it. */
  readonly clock: { now(): number; advance(ms: number): void }   // advance runs due frame callbacks, then due timers
  view(): ViewTransform                       // frames.viewFrame.peek().view
  setViewport(v: { readonly x: number; readonly y: number; readonly scale: number }): void   // a 'set'/'none' move, bearing kept
  setScene(scene: ScenePersistedState, bounds?: SceneBoundsOptions): void
  /** 0A to the end of 0D2 only: the facade's CameraController shim over this same host. Deleted with the facade. */
  readonly legacyCamera: CameraController
  dispose(): void
}

export function createTestView(options?: TestViewOptions): TestView
```

Readbacks through `legacyCamera` (`viewport`, `snapshot`, `worldToScreen`, `screenToWorld`) are derived from the host's frame, so they agree with `view()` by construction; at bearing 0, for a camera inside `constrainCamera`'s bounds (below), they match what today's `CameraController` returned within 1e-9 px. A split-file assertion that compared a readback exactly and fails only by that tolerance gets `toBeCloseTo` in the commit that fails, as a mechanical harness edit (names unchanged). In 0A only the fixture's construction changes (plan §4, 0A-1); in 0D1, `__tests__/support/recording-renderer.test.ts` passes a hand-built stub (`{ revision: 1 } as unknown as ViewTransform`) to `setView`, since the recorder stores the reference and reads nothing from it, so 0D1 does not wait for this file.

The legacy camera surface (plan §4, 0A "Legacy surface") is split by what it may import. `canvas/runtime/legacy-camera-facade.ts` sits outside `view/` because the `CameraController` shim, whose constructor takes only `policy?` as today, supplies the default clock (`performance.now`), `scheduleFrame` (`requestAnimationFrame`) and `window.devicePixelRatio`, and keeps `CameraViewportSnapshot` over `SceneViewportState` from the `scene` barrel, all of which P4 forbids in `view/**`. It imports nothing that reaches `maplibre-gl`, `pixi.js` or `src/maplibre/**`, because `tools/tool.ts` type-imports `runtime.ts`, which type-imports `./camera` until 0D2, and P5c follows type-only edges. The `MapLibreWorkspaceCameraOwner` shim is declared in `maplibre/workspace-camera.ts`, extends the facade's `CameraController` shim and wraps `maplibre/camera-driver.ts`; nothing under `canvas/runtime/**` imports it. Neither P4 nor P5c carries an exemption for either shim.

**The bare shim's plane and bounds.** A shim built as today, `new CameraController(policy?)` with no plane (15 test files at `0f05d927`), puts its host on `createSessionPlane({ lon: 0, lat: policy.referenceLatitudeDeg })`: for the default policy that is `createTestView`'s default `{ lon: 0, lat: 0 }`, and in general the plane and the policy share one latitude, so `pixelsPerMetre` and the policy's scale bounds use the same Mercator factor, which today's plane-free controller assumes. Its screen before `initialize` is `{ width: 0, height: 0, devicePixelRatio: 1 }`, as today. There is one clamp, the driver's `constrainCamera`; the shim adds none (today's `normalizeViewport` scale clamp is not kept beside it), because a second clamp would make the headless and MapLibre drivers disagree. `ViewFrame.scaleBounds` is `cameraScaleBoundsForPolicy(policy, zoomFloorForArc(screen, policy, b, b))` at the live bearing `b`, and the shim's `snapshot.scaleBounds` reports it. At bearing 0 that floor is `singleWorldEffectiveMinimumZoom(width, height)`: today's `minimumMapZoom` (0) whenever the larger screen side is at most 512 px or the screen is empty (the split files' 400 × 300, and every snapshot before `initialize`), and today's MapLibre-learned minimum otherwise. The centre latitude is also held inside ±85.05°, which no test at `0f05d927` approaches at the plane's latitude. Checked at `0f05d927`: outside the camera suites no test with a screen wider than 512 px reads a scale below that floor (`new-design-view.test.ts:70` clamps a zoom-17 scale against `snapshot.scaleBounds`, so it follows the reported bounds); inside them, `camera-controller.test.ts:96` and `:212` (a 1000 × 800 screen expecting the zoom-0 minimum) move to `view/navigation.test.ts` with the single-world floor as the minimum, a named rewrite of 0A's camera-suite move (plan §4, 0A "Legacy surface"), names kept. Any other test that fails only because of the floor or the latitude hold is a stop-and-amend, never a second clamp in the shim.

### 1.2 Input (`canvas/runtime/input/`, pure except the DOM source)

```ts
// canvas/runtime/input/platform.ts
export interface InputPlatform {
  readonly os: 'windows' | 'mac' | 'linux' | 'ios' | 'android' | 'other'
  readonly engine: 'chromium' | 'webkit' | 'webkitgtk' | 'gecko'
  readonly gestureEvents: boolean          // WKWebView / Safari gesturestart/change/end
}
export function detectPlatform(nav: Pick<Navigator, 'userAgent' | 'platform'>, win: { readonly GestureEvent?: unknown }): InputPlatform
// Called once in platform/desktop.ts and platform/browser.ts, injected everywhere else.

// canvas/runtime/input/bindings.ts  (data: the single phase switch)
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
  /** A secondary or auxiliary button added during a primary drag opens a nested navigation sub-session. */
  readonly navigateDuringPrimaryDrag: boolean
  readonly touch: { readonly gestures: boolean; readonly longPressMenu: boolean; readonly hostTouchActionNone: boolean }
  readonly penBarrel: 'ignore' | 'secondary'
  readonly trackpadGestures: boolean                       // WebKit gesture* rotate and scale
  readonly dragSlopPx: Readonly<Record<PointerKind, number>>
}
export const LEGACY_BINDINGS: Bindings
export const ROTATION_BINDINGS: Bindings
export const V2_BINDINGS: Bindings
export const TOUCH_BINDINGS: Bindings
export const CURRENT_BINDINGS: Bindings   // the one constant each phase changes

/** Help rows for F1 and tool cards, generated from the bindings (never hand-written). */
export interface GestureHelpRow { readonly inputKey: string; readonly actionKey: string; readonly platformNote?: string }
export function describeBindings(b: Bindings, platform: InputPlatform): readonly GestureHelpRow[]
```

The constants' values:

| Field | `LEGACY` (0, F) | `ROTATION` (1) | `V2` (2) | `TOUCH` (3) |
|---|---|---|---|---|
| `secondary.click` | `menu-on-native` | `menu-on-native` | `menu-on-release` | `menu-on-release` |
| `secondary.drag` | `none` | `none` | `pan` | `pan` |
| `secondary.shiftDrag` | `none` | `none` | `rotate` | `rotate` |
| `auxiliaryShiftDrag` | `pan` | `rotate` | `rotate` | `rotate` |
| `primaryDragPansIn` | `['hand-tool', 'overview']` | `['hand-tool', 'overview']` | `['hand-tool']` | `['hand-tool']` |
| `macCtrlClick` | `primary` | `primary` | `secondary` | `secondary` |
| `navigateDuringPrimaryDrag` | false | false | true | true |
| `touch` (all three flags) | false | false | false | true |
| `penBarrel` | `ignore` | `ignore` | `secondary` | `secondary` |
| `trackpadGestures` | false | true | true | true |
| `dragSlopPx` | mouse and pen: today's values (recorded by the 0B bead); touch: today's | same | same | touch 8 |

Secondary slop is 3 px in every constant that uses it (MapLibre's `clickTolerance`). Plant a row overrides the primary slop to 4 px through `configure`. After phase 2 `LEGACY_BINDINGS` and `ROTATION_BINDINGS` are deleted and tombstoned; `'overview'` leaves `PanContext`.

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

/** What was under the pointer at down, classified by the source from data attributes. */
export type TargetClass =
  | { readonly kind: 'surface' }                                   // host or [data-canvas-surface]
  | { readonly kind: 'handle'; readonly id: ToolHandleId }         // [data-canvas-handle] in the handle layer
  | { readonly kind: 'ruler'; readonly axis: 'h' | 'v' }           // [data-canvas-ruler]
  | { readonly kind: 'owned-chrome' }                              // compass, zoom group, attribution ([data-canvas-chrome])
  | { readonly kind: 'owned-text' }                                // the text-entry host
  | { readonly kind: 'foreign' }

interface At { readonly t: number }
export type RawInput =
  | At & { kind: 'down'; id: number; pointer: PointerKind; role: ButtonRole; at: ScreenPoint; mods: Modifiers; target: TargetClass; detail: number; ctrlConsumed: boolean }
  | At & { kind: 'move'; id: number; pointer: PointerKind; at: ScreenPoint; mods: Modifiers; buttons: ReadonlySet<ButtonRole> }
  | At & { kind: 'up'; id: number; pointer: PointerKind; role: ButtonRole; at: ScreenPoint; mods: Modifiers }
  | At & { kind: 'cancel'; id: number | 'all'; reason: 'pointercancel' | 'lost-capture' | 'blur' | 'hidden' }
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

export interface AdapterEffect {
  readonly kind: 'prevent-default' | 'capture' | 'release-capture' | 'set-timer' | 'clear-timer'
  readonly pointerId?: number
  readonly atMs?: number
}
/** Opaque to callers; the recogniser owns its shape. Plain data (structured-clone safe), so the property test can snapshot it. */
export interface RecogniserState {
  readonly sessions: ReadonlyMap<number, PointerSession>        // by pointerId: pointer kind, role, mode ('pending' | 'primary' | 'pan' | 'rotate' | 'ignored'), start, last point, press target, slop passed, capture held
  readonly nested: NestedNavigation | null                      // the secondary/auxiliary sub-session during a primary drag, with the frozen primary point
  readonly touchPair: TouchPair | null                          // two touch ids, their start centroid, distance and angle, twist arc accumulated
  readonly held: { readonly space: boolean; readonly mods: Modifiers }
  readonly trackpadTwistDeg: number                             // WebKit gesture rotation accumulated before the 10° threshold
  readonly deadlines: { readonly longPressAt: number | null; readonly menuEchoUntil: number | null; readonly windowsTrailUntil: number | null; readonly lastSecondaryEndAt: number | null }
  readonly context: { readonly tool: ToolId; readonly mode: 'site' | 'overview'; readonly pointingDevice: 'mouse' | 'trackpad'; readonly dragSlopPx: number | null }
}

// canvas/runtime/input/recognise.ts  (the recogniser: its three state types and its two functions; the seams commit
// writes the types, 0B Input the functions. raw-input.ts holds no function.)
// PointerSession, NestedNavigation and TouchPair: type exports imported only inside input/.
// The seams commit writes them as below, from the field comments above; 0B Input may reshape them (RecogniserState is opaque to callers).
// raw-input.ts and recognise.ts import each other's types with `import type` only (no runtime cycle).
//   export interface PointerSession { readonly pointerId: number; readonly pointer: PointerKind; readonly role: ButtonRole
//     readonly mode: 'pending' | 'primary' | 'pan' | 'rotate' | 'ignored'; readonly start: ScreenPoint; readonly last: ScreenPoint
//     readonly target: TargetClass; readonly slopPassed: boolean; readonly captured: boolean }
//   export interface NestedNavigation { readonly pointerId: number; readonly role: ButtonRole; readonly mode: 'pending' | 'pan' | 'rotate'
//     readonly start: ScreenPoint; readonly last: ScreenPoint; readonly frozenPrimary: ScreenPoint }
//   export interface TouchPair { readonly ids: readonly [number, number]; readonly startCentroid: ScreenPoint; readonly startDistancePx: number
//     readonly startAngleDeg: number; readonly twistDeg: number }
export function initialRecogniserState(): RecogniserState
export function recognise(state: RecogniserState, input: RawInput, config: RecogniserConfig):
  { readonly state: RecogniserState; readonly gestures: readonly Gesture[]; readonly effects: readonly AdapterEffect[] }

// canvas/runtime/input/normalise.ts
/** The fields normalise reads; a DOM event satisfies it structurally, and fixtures pass literals. */
export interface DomEventLike {
  readonly type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture' | 'wheel' | 'contextmenu'
    | 'gesturestart' | 'gesturechange' | 'gestureend' | 'dragover' | 'dragleave' | 'drop'
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
export function normalise(e: DomEventLike, platform: InputPlatform, bindings: Bindings, keys: { readonly physicalCtrl: boolean }): RawInput | null
```

Stages: `DomInputSource` (the only DOM listener owner for canvas input, including ruler presses, the document-capture `contextmenu` guard and, from phase F, the copied GeoLibre selection-drag guard) → `normalise` → `recognise` → `InputRouter` (navigation to `ViewNavigation`; menu requests, editing and drops to the `ToolHost`, the only opener of the context-menu port). The router computes no geometry.

Normalisation rules:
- Mouse `button` 0/1/2 → primary/auxiliary/secondary; 3 and 4 dropped. Pen tip → primary; barrel (2) → secondary when `penBarrel: 'secondary'`, else dropped; eraser (5) dropped. Touch → primary in every phase.
- On `os: 'mac'` with `macCtrlClick: 'secondary'`, mouse button 0 with `ctrlKey && !metaKey` becomes secondary with `ctrlConsumed: true`. For that session the recogniser ignores `ctrl` in `move` mods and `key-state`.
- Wheel `deltaMode` is read before `deltaY` (16 px per line; a page is the host height). A wheel with `ctrlKey` and no physical Ctrl reported by the KeyRouter becomes `pinch: true`.
- Targets are classified from data attributes; the attribution control is `data-canvas-chrome` (`owned-chrome`).

### 1.2a Shared vocabulary and interaction ports (`canvas/runtime/interaction-types.ts`, `interaction-ports.ts`)

Input and tools share a vocabulary; neither may import the other (P5). Both import `interaction-types.ts`, which has only type-only imports: exactly the two drag-payload types (`PlantStampSourceInput` from `canvas/plant-stamp-source.ts` and `SavedObjectStampPayload` from `canvas/saved-object-stamp-payload.ts`, used by `CanvasDropPayload`). A later type may also import from `view/types.ts` or `scene/types.ts`, and from nothing else. The block below is complete, and nothing in it uses `view/types.ts` or `scene/types.ts` yet. `interaction-ports.ts` types the composition: it may import types (type-only) from any runtime module, because no tool module imports it. The list is open, but each import names the type's defining module, never a barrel such as `canvas/runtime/scene/index.ts`, so no policy ever has to allow a barrel. Besides `input/`, `tools/`, `view/`, `renderers/scene-types.ts` and `runtime.ts`, its blocks need `SceneEditCoordinator` (`scene-runtime/transactions.ts`), `SceneStateReader` (`scene/store.ts`), `SceneDesignObjectTarget` and `SceneDesignObjectSelection` (`scene/design-object-targets.ts`), `CanvasToolGuidance` (`canvas/session-state.ts`), `CanvasFocusPort` (`app-adapter.ts`, added by the seams commit) and `ReadonlySignal` (`@preact/signals`). Only `tools/tool-host.ts` (exempt from P5), `input/input-router.ts`, `input/dom-input-source.ts`, `interaction-session.ts` and `keyboard-port.ts` import it. D2–D4 and the lens depend on `ToolHost` through this file, not through `tool-host.ts`.

```ts
// canvas/runtime/interaction-types.ts  (types)
export type PointerKind = 'mouse' | 'pen' | 'touch'
export interface Modifiers { readonly shift: boolean; readonly ctrl: boolean; readonly alt: boolean; readonly meta: boolean }
export type CancelReason = 'pointercancel' | 'lost-capture' | 'blur' | 'hidden' | 'escape' | 'multitouch' | 'chord' | 'tool-change'
export type ToolId =
  | 'select' | 'hand' | 'plant-stamp' | 'text' | 'line' | 'measurement-guide' | 'rectangle' | 'ellipse'
  | 'polygon' | 'object-stamp' | 'saved-object-stamp' | 'plant-spacing'
// 'hand' is the Pan tool (label "Pan", key H). It stays in every phase (user).
/** 'rotate', 'vertex:<zone id>:<index>', 'rect-corner:<id>:ne', 'guide-end:<id>:a', 'edge-mid:<zone id>:<index>'. */
export type ToolHandleId = string & { readonly __toolHandleId: true }
/** What a panel drag carries, read from dataTransfer by the DOM source (today plant-stamp-source.ts and saved-object-stamp-source.ts). */
export type CanvasDropPayload =
  | { readonly kind: 'species'; readonly species: PlantStampSourceInput }
  | { readonly kind: 'saved-stamp'; readonly stamp: SavedObjectStampPayload }
  | { readonly kind: 'unknown' }                                // over the map but not ours: the tool shows no drop cue
// PlantStampSourceInput (canvas/plant-stamp-source.ts) and SavedObjectStampPayload are type-only imports.
```

```ts
// canvas/runtime/interaction-ports.ts  (types; implementations in input/ and tools/)

export interface DomInputSourceDeps {
  readonly host: HTMLElement                                    // the map host; listeners attach here and, during an owned session, on window
  readonly platform: InputPlatform
  readonly bindings: () => Bindings                             // CURRENT_BINDINGS in production
  readonly keys: { readonly physicalCtrl: () => boolean; readonly lastKeyboardMenuAt: () => number | null }   // from the KeyRouter
  readonly clock: () => number
  readonly timers: { set(atMs: number, cb: () => void): number; clear(id: number): void }
}
export interface DomInputSource {
  /** Installs the host listeners; returns the disposer that removes every listener it added (tested: exactly once each). */
  attach(sink: (input: RawInput) => void): () => void
  /** Applies recogniser effects (preventDefault on the event being handled, capture, timers). */
  apply(effects: readonly AdapterEffect[]): void
}

/**
 * An adapter over today's controller (`createCanvasContextMenu`, interaction/canvas-context-menu.ts), which builds the
 * app's CanvasContextMenuRequest (canvas/runtime/app-adapter.ts: anchor, world, retargeted selection, commands,
 * placePlantsAt, saveSelectionAsObjectStamp, returnFocus) and hands it to CanvasRuntimeAppAdapter.contextMenu.
 * The host fills the optional entries from its hit and tool state; the request type gains them in phase 1 (D1).
 */
export interface ContextMenuPort {
  open(request: {
    readonly at: WorldPoint | 'selection'
    readonly source: MenuSource
    readonly screen: ScreenPoint | null
    readonly hit: HitTarget | null
    readonly turnViewToEdge?: () => void                        // a zone-edge hit within the source's tolerance (§4.16)
    readonly highlightEdge?: (on: boolean) => void              // while the entry is highlighted: the ochre trace (a draft)
    readonly finishShape?: () => void                           // ToolHost.command({ kind: 'finish-shape' }) during a 3+ corner draft
  }): void
  close(): void
  readonly isOpen: () => boolean
}
export interface InputRouterDeps {
  readonly navigation: Pick<ViewNavigation, 'panByPx' | 'zoomAroundPx' | 'beginRotation'>
  readonly toolHost: ToolHost
}
export interface InputRouter {
  /** Routes one gesture: navigation → ViewNavigation, menu-request → ToolHost.menuAt (the host is the only menu opener), editing and drops → ToolHost. Computes no geometry. */
  route(g: Gesture): void
}

/** Built by interaction-session.ts; everything the host needs, so tools stay narrow. */
export interface ToolHostDeps {
  readonly frames: ViewFrameSource                              // ToolView, re-emit on onViewFrame('tools'), plane changes
  readonly scene: ToolScene                                     // from createToolScene below: spatial index per scene revision
  readonly edits: SceneEditCoordinator
  readonly renderer: Pick<SceneRendererV2, 'setDraft' | 'setSelectionPreview'>
  readonly chrome: {
    setHandles(h: readonly ToolHandle[]): void; requestTextEntry(r: TextEntryRequest): Promise<string | null>; setCursor(c: string): void
    setTooltip(t: { readonly target: SceneDesignObjectTarget; readonly at: ScreenPoint } | null): void   // chrome/hover-tooltip.ts
    setLockedAffordance(target: SceneDesignObjectTarget | null): void                                     // chrome/locked-affordance.ts
  }
  readonly menu: ContextMenuPort                                // opened only by the host (menuAt, ToolEffects.requestMenu)
  readonly focus: CanvasFocusPort                               // ToolEffects.requestFocus
  readonly guidance: (g: Partial<CanvasToolGuidance> | null) => void
  readonly toolState: { readonly active: ReadonlySignal<ToolId>; set(id: ToolId): void }   // the session's tool signal
  readonly settings: ToolSettingsPort
  readonly translate: ToolContext['translate']
  readonly bindings: () => Bindings                             // modifier resolution (§2.3)
  readonly platform: InputPlatform
  readonly navigation: Pick<ViewNavigation, 'turnToEdge'>       // the "Turn view to this edge" entry
  /** Today's deps.nudge (the runtime's scene-edit commands); the host owns the series (nudge below). */
  readonly nudge: Pick<CanvasSceneEditCommandSurface, 'nudgeSelected' | 'endNudge'>
  readonly timers: { set(atMs: number, cb: () => void): number; clear(id: number): void; readonly clock: () => number }
  /** Hover restyle and the locked-object affordance: today's deps.setHoveredTarget. */
  readonly hover: (target: SceneDesignObjectTarget | null) => void
  /** The raster inspection probe (CanvasRuntimeAppAdapter.tryInspectAt, passed by scene-runtime.ts); true claims the press. INV-ENT-24. */
  readonly inspect?: (world: WorldPoint) => boolean
  /** Today's notifyTransientHistoryChange: the runtime's transientHistory revision (Edit › Undo during a draft). */
  readonly transientHistoryChanged: () => void
}
export function createToolHost(deps: ToolHostDeps): ToolHost    // tools/tool-host.ts
/** tools/tool-host.ts re-exports this factory (implemented in tools/spatial-index.ts and tools/hit-testing.ts), so
 *  interaction-session.ts builds the ToolScene while importing only the host (P5b). */
export function createToolScene(source: ToolSceneSource): ToolScene
export interface ToolSceneSource {
  readonly store: SceneStateReader                              // the runtime's scene store
  readonly sceneRevision: ReadonlySignal<number>                // the index rebuilds when it changes
  readonly selection: () => SceneDesignObjectSelection
  readonly isLayerOpenForCreation: (layer: SceneLayerKind) => boolean
}

export interface ToolHost {
  gesture(g: Gesture): void                                     // editing gestures and drops; converts to world at event time
  command(c: ToolCommand): ToolReply
  /** Hits, retargets and opens the canvas menu through ToolHostDeps.menu. */
  menuAt(at: ScreenPoint | 'selection', source: MenuSource): void
  setTool(id: ToolId, source: ToolSource | null): void
  readonly activeTool: ReadonlySignal<ToolId>
  // Esc chain queries (CanvasKeyboardPort reads these)
  hasLiveGesture(): boolean
  activeToolHasTransient(): boolean
  activeToolIsSelect(): boolean
  escapeHint(): 'drop-transient' | 'leave-tool' | 'clear-selection' | null
  /**
   * Arrow nudge, the one owner of the series: with a selection, the Select tool and site mode, turns the screen direction
   * into a world delta along screenAxesInWorld() (0.1 m, or 1 m when large), calls deps.nudge.nudgeSelected and (re)starts
   * the 800 ms idle timer that commits the series. 'no-selection' tells the keyboard port to pan instead; 'blocked' means nothing.
   */
  nudge(direction: ScreenPoint, large: boolean): 'nudged' | 'blocked' | 'no-selection'
  hasNudgeSeries(): boolean                                     // the Esc layer 65
  endNudgeSeries(commit: boolean): void                         // Esc aborts; idle, focusout, a press or another key commit
  /** Transient history (today's canUndo/…TransientHistory): forwards to CanvasTool.undoTransient and friends. */
  readonly transientHistory: {
    readonly revision: ReadonlySignal<number>
    canUndo(): boolean; canRedo(): boolean; undo(): boolean; redo(): boolean
  }
  prepareForDocumentReplacement(): void                         // deactivate('document-replaced') and drop live sessions
  refreshTranslations(): void                                   // re-publishes guidance and handle labels
  /** World point under the pointer while hovering the map (null when off it); for the inspection lens and the status line. */
  subscribePointerWorld(listener: (point: WorldPoint | null) => void): () => void
  dispose(): void
}
// Today's SceneInteractionSession members: setTool → ToolHost.setTool; plantRowSpacing → CanvasToolCommandSurface
// (the host forwards to the Plant a row tool); setOverviewMode → none (the host reads ViewFrame.mode); refreshMeasurements
// → none (drafts are world-space, ADR 0019); the four transient-history members → transientHistory; prepareForDocumentReplacement,
// refreshTranslations and dispose → the same names. interaction-session.ts keeps the old session interface over these.
// canvas/runtime/keyboard-port.ts  (0B Input writes this whole sub-block, types and function; not a seams file, since no seams type refers to it)
export interface CanvasKeyboardPortDeps {
  readonly host: HTMLElement
  readonly toolHost: ToolHost
  /** Arrow pans (64 or 256 px), + / −, N, Shift+N and Shift+←/→/↑. */
  readonly navigation: Pick<ViewNavigation, 'panByPx' | 'zoomIn' | 'zoomOut' | 'resetNorth' | 'rotateBy'>
  readonly frames: ViewFrameSource
}
export function createCanvasKeyboardPort(deps: CanvasKeyboardPortDeps): CanvasKeyboardPort
```

### 1.3 Gestures (`canvas/runtime/input/gestures.ts`)

```ts
export type NavigationSource =
  | 'secondary-drag' | 'auxiliary-drag' | 'space-drag' | 'primary-drag'   // primary-drag: the Pan tool (and legacy overview)
  | 'nested-drag'                                                          // secondary/auxiliary added during a primary drag
  | 'wheel' | 'trackpad-pinch' | 'trackpad-twist' | 'touch-two-finger'

export type MenuSource = 'mouse' | 'ctrl-click' | 'pen-barrel' | 'long-press' | 'keyboard' | 'native'
// CancelReason, PointerKind, Modifiers, ToolHandleId, CanvasDropPayload: from ../interaction-types.ts (§1.2a)

export type PressTarget =
  | { readonly kind: 'surface' }
  | { readonly kind: 'handle'; readonly id: ToolHandleId }
  | { readonly kind: 'ruler'; readonly axis: 'h' | 'v' }

export type Gesture =
  // editing: primary role only; the ToolHost converts to world space
  | { kind: 'hover'; at: ScreenPoint; pointer: PointerKind; mods: Modifiers }
  | { kind: 'hover-end' }
  | { kind: 'press'; id: number; at: ScreenPoint; pointer: PointerKind; mods: Modifiers; clickCount: number; target: PressTarget }
  | { kind: 'tap'; id: number; at: ScreenPoint; pointer: PointerKind; mods: Modifiers; clickCount: number; target: PressTarget }
  | { kind: 'drag-start'; id: number; from: ScreenPoint; at: ScreenPoint; pointer: PointerKind; mods: Modifiers; target: PressTarget }
  | { kind: 'drag-move'; id: number; at: ScreenPoint; mods: Modifiers }
  | { kind: 'drag-end'; id: number; at: ScreenPoint; mods: Modifiers }
  | { kind: 'drop'; phase: 'over' | 'leave' | 'drop'; at: ScreenPoint; payload: CanvasDropPayload }
  // navigation: never reaches tools
  /** deltaPx is content movement (the ground follows the pointer). */
  | { kind: 'pan'; phase: 'start' | 'move' | 'end'; deltaPx: ScreenPoint; source: NavigationSource }
  | { kind: 'zoom'; anchorPx: ScreenPoint; factor: number; source: NavigationSource }
  | { kind: 'rotate'; phase: 'start' | 'move' | 'end' | 'cancel'; anchorPx: ScreenPoint; totalDeltaDeg: number; step: boolean; source: NavigationSource }
  // requests
  | { kind: 'menu-request'; at: ScreenPoint | 'selection'; source: MenuSource }
  | { kind: 'cancel'; reason: CancelReason }
```

### 1.4 Tools (`canvas/runtime/tools/`)

```ts
// canvas/runtime/tools/tool.ts  (the tool contract; with interaction-types.ts, where tool implementations get their shared types)
// Every import below is `import type`, each from the module that defines the type, never from a barrel (scene/index.ts):
//   ../interaction-types.ts: ToolId, PointerKind, CancelReason, ToolHandleId, CanvasDropPayload (§1.2a)
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
// forbid-transitive-imports follows: checked at 0f05d927 by walking source-facts.ts's graph from each existing module;
// view/types.ts, draft.ts and interaction-types.ts are seams files: draft.ts imports only view/types.ts, interaction-types.ts
// and GhostEntity from this file (type-only both ways, no runtime cycle), and interaction-types.ts only the two clean
// drag-payload modules above. Tool implementations
// import these types from tool.ts, draft.ts or the same defining modules. Any later type import must keep P5c true.

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
  readonly world: WorldPoint       // raw plane metres
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
export interface HitFilter {
  readonly kinds?: readonly SceneDesignObjectTarget['kind'][]
  readonly includeLocked?: boolean                 // default false: locked objects are hit only for "select and show Unlock"
  readonly toleranceScreenPx?: number              // converted through metresPerPixelAt
}
/** The cached selection read model: today's CanvasDesignObjectSelectionModel (canvas/runtime/runtime.ts:48), unchanged. */
export type SelectionReadModel = CanvasDesignObjectSelectionModel
/** Layer names as stored (SceneLayerEntity.name): 'plants', 'zones', 'annotations', 'measurements', …
 *  Stays `string` in the seams (SceneLayerEntity.name is `string`, scene/types.ts:15; the seams do not edit scene/types.ts). Narrowing it to the known names is a later, optional change. */
export type SceneLayerKind = SceneLayerEntity['name']
/**
 * A preview of what a placement would create, drawn with the draft by the scene's own drawing code (plan 0D1 "Ghosts").
 * The entities are already where a click would put them: the tool builds the plant as a click would (today plantEntityFromStampSource)
 * and applies the stamp's offset and held rotation to the template (today objectStampEntities and rotateStampEntities).
 * `anchor` and `rotationDeg` describe the pick for tests and guidance; the renderer never re-applies them.
 * A plant ghost is the symbol only: the Place plants mature-width ring, its label and the nearest-plant guide are ellipse, label and polyline shapes.
 */
export type GhostEntity =
  | { readonly kind: 'plant'; readonly plant: ScenePlantEntity }
  | { readonly kind: 'objects'; readonly anchor: WorldPoint; readonly rotationDeg: number; readonly template: SceneArrangementTemplate }  // stamp pick, saved stamp
export interface TextEntryRequest {
  readonly anchor: WorldPoint
  readonly rotationDeg: number                     // stored note rotation; the host draws the textarea at rotationDeg − bearing
  readonly initialText: string
  readonly placeholderKey: string
  readonly kind: 'note' | 'spacing-field'
}

export type ToolGesture =
  | { readonly kind: 'hover'; readonly point: ToolPoint; readonly hit: HitTarget | null }
  | { readonly kind: 'hover-end' }
  | { readonly kind: 'press'; readonly point: ToolPoint; readonly hit: HitTarget | null; readonly clickCount: number }
  | { readonly kind: 'tap'; readonly point: ToolPoint; readonly hit: HitTarget | null; readonly clickCount: number }
  | { readonly kind: 'drag-start' | 'drag-move' | 'drag-end'; readonly point: ToolPoint; readonly start: ToolPoint; readonly startHit: HitTarget | null }
  | { readonly kind: 'handle-drag'; readonly phase: 'start' | 'move' | 'end'; readonly handle: ToolHandleId; readonly point: ToolPoint; readonly start: ToolPoint }
  | { readonly kind: 'drop'; readonly phase: 'over' | 'leave' | 'drop'; readonly point: ToolPoint; readonly payload: CanvasDropPayload }
  | { readonly kind: 'cancel'; readonly reason: CancelReason }

export type ToolCommand =
  | { readonly kind: 'escape' }                                    // only when the tool's Esc layer is top
  | { readonly kind: 'confirm' }                                   // Enter (polygon: finish)
  | { readonly kind: 'remove-last' }                               // Backspace
  | { readonly kind: 'rotate-held'; readonly stepDeg: 15 | -15 }   // [ ] while a stamp is held
  | { readonly kind: 'place-at'; readonly world: WorldPoint }      // context menu "Place plants here"
  | { readonly kind: 'finish-shape' }                              // context menu "Finish shape" during a polygon draft
  | { readonly kind: 'delete-handle' }                             // Delete on a focused or selected zone corner (phase 2)
  | { readonly kind: 'edit-text' }                                 // Enter / F2 on one selected note
  | { readonly kind: 'undo-transient' } | { readonly kind: 'redo-transient' }

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

/** Read-only scene queries, backed by a spatial index rebuilt per scene revision. */
export interface ToolScene {
  readonly persisted: Readonly<ScenePersistedState>
  hitAt(world: WorldPoint, filter?: HitFilter): HitTarget | null
  hitInQuad(quad: WorldQuad, filter?: HitFilter): readonly HitTarget[]
  nearestPlant(world: WorldPoint, excluding?: ReadonlySet<string>): { readonly plant: ScenePlantEntity; readonly distanceM: number } | null
  isLayerOpenForCreation(layer: SceneLayerKind): boolean
  selection(): SceneDesignObjectSelection
  selectionModel(): SelectionReadModel         // cached by (scene revision, selection revision)
}

/** The only way a tool changes anything. */
export interface ToolEffects {
  readonly edits: SceneEditCoordinator                      // unchanged transaction API (begin/run/mutate/setSelection/commit/abort)
  setDraft(draft: DraftPresentation | null): void           // world-space; drawn by the renderer
  setSelectionPreview(preview: SelectionPreview | null): void
  setHandles(handles: readonly ToolHandle[]): void          // DOM handle layer; hit by the source
  setGuidance(guidance: Partial<CanvasToolGuidance> | null): void
  setCursor(cursor: 'default' | 'crosshair' | 'copy' | 'move' | 'not-allowed' | 'rotate' | 'grab' | 'grabbing'): void
  requestTool(id: ToolId): void
  requestTextEntry(request: TextEntryRequest): Promise<string | null>   // the host owns the textarea
  requestMenu(at: WorldPoint | 'selection'): void
  requestFocus(target: 'map' | 'tool-card-field'): void     // ToolHostDeps.focus (CanvasFocusPort, §1.6), implemented by the FocusOwner
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
  readonly translate: (key: string, options?: Readonly<Record<string, unknown>>) => string
}

export interface CanvasTool {
  readonly id: ToolId
  readonly dragSlopPx?: number                    // per-tool threshold (Plant a row: 4), sent through `configure`
  readonly preservesTransientOnNavigate?: boolean // polygon draft survives pans
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
  /** Scene or selection changed outside the tool (undo, remote edit); drafts were already re-projected. */
  sceneChanged?(): void
  /** True while the tool holds something Esc should drop first (draft, pick, row source). */
  hasTransient(): boolean
  /** Esc hint for the tool card, read by describeEscape. */
  escapeHint(): 'drop-transient' | 'leave-tool' | 'clear-selection' | null
  cancelTransient(reason: 'escape' | 'tool-change' | 'document-replaced' | 'navigate'): void
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
  | { readonly kind: 'saved-stamp'; readonly stamp: SavedObjectStampPayload }
```

```ts
// canvas/runtime/tools/draft.ts  (world-space presentations)
export type DraftShape =
  | { readonly kind: 'polyline'; readonly points: readonly WorldPoint[]; readonly style: DraftStroke }
  | { readonly kind: 'polygon'; readonly points: readonly WorldPoint[]; readonly style: DraftStroke; readonly fill?: DraftFill }
  | { readonly kind: 'quad'; readonly corners: WorldQuad; readonly style: DraftStroke; readonly fill?: DraftFill }   // band select
  | { readonly kind: 'ellipse'; readonly center: WorldPoint; readonly radiusX: number; readonly radiusY: number; readonly rotationDeg: number; readonly style: DraftStroke }
  | { readonly kind: 'circle-px'; readonly center: WorldPoint; readonly radiusPx: number; readonly style: DraftStroke }
  | { readonly kind: 'ghost'; readonly entity: GhostEntity; readonly opacity: number }
  | { readonly kind: 'label'; readonly anchor: WorldPoint; readonly offsetPx: ScreenPoint; readonly text: string; readonly tone: 'measure' | 'hint' | 'warning' }  // upright
/** widthPx and dash (dash, gap, … lengths) are CSS px at every scale; the casing is widthPx + OVERLAY_CASING_EXTRA_PX. The renderer converts them
 *  to world units at the scale it draws with and re-traces when that scale changes (plan 0D1 "Transform until 0D2"). */
export type DraftStroke = { readonly token: 'draft' | 'draft-muted' | 'selection' | 'warning'; readonly widthPx: number; readonly dash?: readonly number[] }
export type DraftFill = { readonly token: 'draft-fill' | 'selection-fill' | 'warning-fill' }
// Draft tokens resolve to canvas colours in canvas/runtime/scene-visuals.ts (getDraftVisual, beside the overlay visuals; plan 0D1).
export interface DraftPresentation { readonly shapes: readonly DraftShape[] }

/** Move/rotate preview of the selection while dragging: a renderer transform until commit. */
export interface SelectionPreview { readonly translate: WorldVector; readonly rotateDeg: number; readonly pivot: WorldPoint }

export interface ToolHandle {
  readonly id: ToolHandleId              // 'rotate', 'vertex:3', 'rect-corner:ne', 'guide-end:a', 'edge-mid:2', …
  readonly anchor: WorldPoint
  readonly offsetPx?: ScreenPoint        // rotate handle: 42 px above the selection's projected hull
  readonly hitRadiusPx: number           // 10 today; 22 on touch (44 px target, ADR 0010)
  readonly glyph: 'vertex' | 'corner' | 'rotate' | 'midpoint'
  readonly label: string                 // aria-label (translated)
}
```

Tools never see screen coordinates in gestures; `ScreenPoint` appears only in `offsetPx`/`radiusPx` presentation fields. `ToolContext` has no navigation handle. The Pan tool's drags never reach it (the recogniser turns them into `pan`); its module sets the `grab` cursor and guidance only.

The `ToolHost` (`tools/tool-host.ts`, interface in `interaction-ports.ts`) is the only code that builds `ToolGesture`s. Its duties, in order: world conversion at event time (a null `screenToWorld` drops hovers and cancels drags); constraint and snapping once (the active tool's `constraint()` and the grid snap in the order of §2.3, filling `ToolPoint.constrained` and `.snapped`); hits (a handle target becomes `handle-drag`, a ruler target becomes ruler-guide creation only while north is up); interceptors (admission quarantine while the scene is unsettled, text-entry commit on press, the raster inspection probe `deps.inspect` on a primary press after handles and pan and before the tool, never in overview (fixture J10, §3.8), the overview rule); hover (`deps.hover`, the tooltip and the locked affordance through `chrome`); re-emit of `drag-move`/`hover` from the last screen point on every `onViewFrame('tools')`; re-projection through lon/lat on `planeRevision` change; the arrow nudge and its series (`nudge`, `hasNudgeSeries`, `endNudgeSeries`; the keyboard port pans on `'no-selection'`); menus (hit, retarget, open through `ToolHostDeps.menu`, the only opener; `turnViewToEdge` and `highlightEdge` on a zone-edge hit, §4.16; `finishShape` first during a 3+ corner polygon draft); transient history (`transientHistory`, which Edit › Undo reaches through the runtime's `transientHistory` as today, `scene-runtime/construction.ts:289-295`); Esc queries (`hasLiveGesture`, `activeToolHasTransient`, `activeToolIsSelect`, `escapeHint`); `subscribePointerWorld(cb)` for the lens and status; modifier resolution (§2.3).

### 1.5 Renderer (`canvas/runtime/renderers/scene-types.ts`)

The seams commit adds these to the existing `scene-types.ts`, beside today's renderer interface, which the code names `SceneRendererInstance` (`scene-types.ts:50-57`, `renderScene` and `setViewport`; `SceneRendererDefinition.initialize` at `:60-63` returns it), under the distinct name `SceneRendererV2`. There is no `SceneRenderer` type today. At the end of 0D2, `SceneRendererInstance` is deleted, `SceneRendererV2` is renamed `SceneRenderer` (the final name this document uses), and `SceneRendererDefinition.initialize` returns `SceneRenderer`. Until then `SceneRendererV2.syncScene` takes today's `SceneRendererSnapshot`, `viewport` field included; nothing implements `SceneRendererV2` before 0D2, and 0D2 deletes `viewport` in the commit that makes the renderer implement it.

```ts
export interface SceneChangeSet {
  readonly scene: boolean                                   // document revision
  readonly selection: boolean
  readonly hover: readonly SceneDesignObjectTarget[]        // old and new hover target only: a two-node restyle
  readonly style: boolean                                   // theme, backdrop, plant display settings
  readonly labels: boolean                                  // label admission recomputed (settled or band change)
}

export interface SceneRendererV2 {   // renamed SceneRenderer at the end of 0D2
  readonly id: 'maplibre-pixi'
  /** Data, selection, hover, style or label admission changed. Never called for a pan. No camera in the snapshot. */
  syncScene(snapshot: SceneRendererSnapshot, changes: SceneChangeSet): void
  /** The only per-frame entry: world-root matrix, visible set, billboard anchors, zoom-band re-key. */
  setView(view: ViewTransform): void
  setDraft(draft: DraftPresentation | null): void
  setSelectionPreview(preview: SelectionPreview | null): void
  dispose(): void | PromiseLike<void>
}
```

The contract split: data goes through `syncScene`, the camera through `setView`, and nothing else. `SceneRendererSnapshot.viewport` and `PlantPresentationEntry.screenPoint` are deleted; presentation entries are world-space. The stage has two content roots and, stacked in the order of the table, two draft roots on top: drafts draw over plants, notes and labels, as today's DOM previews do over the whole canvas (0D1 sets this order and 0D2 keeps it, so phase 0's by-eye draft check compares like with like):

| Root | Transform | Content |
|---|---|---|
| `worldRoot` | `view.planar.affine`, one write per frame | grid (from phase 1), zones, ruler and measurement guides, selection preview |
| `billboardRoot` | identity (CSS px) | plants, rings, badges, notes (text at `rotationDeg − bearing`), labels; positions from `view.projectAnchors` |
| `worldDraftRoot` (`world-layers.ts`) | the same `view.planar.affine`, written in the same `setView` | world drafts (polylines, polygons, quads, ellipses) and the zone shapes of an `objects` ghost |
| `billboardDraftRoot` (`billboard-layer.ts`) | identity (CSS px) | pixel-sized drafts (`circle-px`, `label`) and the plants and note text of a ghost (a plant is a billboard); positions from `view.projectAnchors` |
| DOM overlay host (`canvas/runtime/chrome/`) | `translate` only, in `onViewFrame('overlays')` | handle layer, text-entry host, hover tooltip, locked affordance |
| Canvas2D rulers (`chrome/rulers.ts`) | redrawn in `onViewFrame('overlays')` | shown only while `northUp` |

`SelectionPreview` spans both roots: `world-layers.ts` applies it to the selected world shapes (zones, guides) as a transform of their retained geometry, and `billboard-layer.ts` applies it to the anchors of selected plants and notes before `projectAnchors` (and adds `rotateDeg` to a selected note's text angle), so a move-drag moves everything selected without `syncScene` (test `renderers/billboard-layer.test.ts`: "a selection preview moves selected plants and notes without syncScene", phase R).

Culling uses `visibleWorldBounds`. Label admission is computed on `settledViewFrame` and on zoom-band change, cached per (scene revision, band, 15° bearing bucket). The layer (`maplibre/shared-scene-layer.ts`) reads `viewFrame.peek()` in `render` and calls `setView` only when `revision` changed; it never derives a transform.

### 1.6 Keyboard and focus (`app/keyboard/`, neutral)

```ts
// canvas/runtime/runtime.ts  (added role; runtime never imports app)
export type CanvasEscapeLayer = 'gesture' | 'nudge-series' | 'tool-transient' | 'tool' | 'selection'

export interface CanvasKeyboardPort {
  escapeLayers(): readonly CanvasEscapeLayer[]            // live canvas layers now
  escape(layer: CanvasEscapeLayer): void
  /** What the next Esc will do, for the tool-card hint (same source as behaviour). */
  describeEscape(): CanvasEscapeLayer | null
  command(c: CanvasKeyCommand): boolean                   // false when nothing consumed it
  keyState(s: { readonly space: boolean; readonly mods: Modifiers }): void
  readonly host: HTMLElement
}

/** The router reaches the live session's port here. 0B (Input) implements it in keyboard-port.ts, exposes it from
 *  workspace-runtime-composition.ts and the test supports, and makes it required (the 0B shape, below). */
export interface CanvasRuntimeSurfaces {
  readonly commands: CanvasCommandSurface
  readonly queries: CanvasQuerySurface
  readonly documents: CanvasDocumentSurface
  readonly keyboard: CanvasKeyboardPort          // canvas/session.ts exports currentCanvasKeyboardPort (Keyboard, 0C)
}
// Seams shape (seams commit until 0B): `readonly keyboard?: CanvasKeyboardPort`, optional so no object literal or test
// fake changes; CanvasQuerySurface.subscribePointerWorld (§1.1a) is likewise optional until 0B (plan §4 Seams, "Owns").

// canvas/runtime/app-adapter.ts  (seams commit: the field; absent in a detached runtime)
export interface CanvasRuntimeAppAdapter {
  // … today's fields …
  /** How ToolHostDeps.focus leaves the runtime. 0B: interaction-session.ts falls back to today's host focus when absent;
   *  0C: app/canvas-runtime/app-adapter.ts passes the FocusOwner (Keyboard). */
  readonly focus?: CanvasFocusPort
}

// canvas/runtime/app-adapter.ts, continued (seams commit: declared here, beside the focus? field; interaction-ports.ts and app/keyboard import it type-only)
/** How a tool's focus request (ToolEffects.requestFocus) leaves the runtime. The FocusOwner implements it. */
export interface CanvasFocusPort {
  focusMap(reason: 'tool-requested' | 'text-entry-closed'): void
  /** The tool card's field (the Plant a row spacing field), registered by ToolCard.tsx through FocusOwner.registerToolCardField. */
  focusToolCardField(reason: 'tool-requested'): void
}

// canvas/runtime/runtime.ts, continued (CanvasToolCommandSurface: the hand-off commit after 0B; CanvasKeyCommand: the seams commit)
/** The tool surface on the canvas session (today setTool(name: string), runtime.ts:78). Typed by the main agent's hand-off commit after 0B, before 0C and 0D2 start. */
export interface CanvasToolCommandSurface {
  setTool(id: ToolId, source?: ToolSource | null): void    // forwards to ToolHost.setTool; only armCanvasTool calls it (P9)
  readonly plantRowSpacing: CanvasPlantRowSpacingField
}

export type CanvasKeyCommand =
  | { kind: 'confirm' } | { kind: 'remove-last' } | { kind: 'edit-text' } | { kind: 'delete-handle' }
  | { kind: 'rotate-held'; stepDeg: 15 | -15 }
  | { kind: 'arrow'; dir: 'up' | 'down' | 'left' | 'right'; large: boolean }   // keyboard-port.ts: ToolHost.nudge, then panByPx on 'no-selection'
  | { kind: 'rotate-view'; direction: 1 | -1 } | { kind: 'reset-north' }
  | { kind: 'zoom-step'; direction: 1 | -1 }                                    // plain + / − with map focus
  | { kind: 'context-menu' }                                                    // Menu key, Shift+F10
```

```ts
// app/keyboard/key-router.ts
export interface KeyRouterDeps {
  readonly target: Pick<Window, 'addEventListener' | 'removeEventListener'>   // window in production
  readonly document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
  readonly platform: InputPlatform
  readonly keymap: readonly KeymapRow[]            // KEYMAP, filtered for the Web edition's reserved keys
  readonly commands: CommandSink                   // Desktop commands/registry.ts, Web web/browser-shell-commands.ts
  readonly canvas: () => CanvasKeyboardPort | null // the live canvas session's port
  readonly singleKeys: ReadonlySignal<boolean>     // Settings › Keyboard
  readonly focus: FocusOwner
  readonly isModalOpen: () => boolean              // useModalLayer's stack
  readonly clock: () => number
}
export interface KeyRouterHandle {
  /** For normalise (pinch vs real Ctrl+wheel) and DomInputSourceDeps.keys. */
  readonly physicalCtrl: () => boolean
  /** The last Menu key or Shift+F10 time, for the recogniser's keyboard-menu echo. */
  readonly lastKeyboardMenuAt: () => number | null
  dispose(): void
}
/** Owns the only window keydown/keyup listeners (one capture, one bubble each). Installed once by app/shell/bootstrap.ts (Desktop) and main.web.tsx (Web). */
export function installKeyRouter(deps: KeyRouterDeps): KeyRouterHandle

// app/keyboard/key-chord.ts
/** The KeyboardEvent fields the router reads; tests pass literals. */
export interface KeyboardEventLike {
  readonly type: 'keydown' | 'keyup'
  readonly key: string; readonly code: string; readonly keyCode: number
  readonly shiftKey: boolean; readonly ctrlKey: boolean; readonly altKey: boolean; readonly metaKey: boolean
  readonly repeat: boolean; readonly isComposing: boolean; readonly defaultPrevented: boolean
  readonly target: EventTarget | null
  preventDefault(): void
  stopPropagation(): void
}
/** mod = Cmd on Mac, Ctrl elsewhere. A physical Ctrl on Mac is `ctrl`, never `mod`. */
export interface KeyChord { readonly key: string; readonly mod: boolean; readonly ctrl: boolean; readonly shift: boolean; readonly alt: boolean }
/** Null for AltGr (Ctrl+Alt without Meta on Windows/Linux) and while composing. */
export function chordOf(e: KeyboardEventLike, platform: Pick<InputPlatform, 'os'>): KeyChord | null

// app/keyboard/keymap.ts
export type KeyScope =
  | 'global'          // every focus class except modal; in text only with worksInTextFields (Ctrl+K, Ctrl+S, F1, F6)
  | 'command'         // anywhere except text fields and dialogs: tool letters, Delete, [ ], N, Shift+N, Shift+L, Ctrl+Z…
  | 'view-arrows'     // Shift+←/→/↑: like 'command', but not inside an arrow-owning widget
  | 'canvas-focus'    // focus on the map host (not text inside it) or <body>: plain and mod arrows, Enter, Space, Backspace, F2, + / −, Menu
/** A shell command id (`app/shell-commands/index.ts`, e.g. 'edit.undo') or a canvas key command ('canvas.<CanvasKeyCommand kind>'). */
export type KeyCommandId = ShellCommandId | `canvas.${CanvasKeyCommand['kind']}`
export interface KeymapRow {
  readonly command: KeyCommandId
  readonly chords: readonly KeyChord[]
  readonly scope: KeyScope
  readonly singleKey: 'follows-switch' | 'always-on' | 'n/a'  // the single-key shortcut setting
  readonly worksInTextFields?: boolean        // 'global' rows only: Ctrl+K, Ctrl+S, F1, F6, Ctrl+F (finder)
  readonly worksInModal?: boolean             // F1 only today
  /** A canvas row whose port command() returns false runs this shell command instead (F2: edit the note, else rename the Design). */
  readonly fallback?: ShellCommandId
}
export const KEYMAP: readonly KeymapRow[]    // canvas and shell catalogues contribute rows; F1 renders it

/** Where a shell row goes: Desktop `commands/registry.ts`, Web `web/browser-shell-commands.ts`. Injected, so app/keyboard stays neutral (P14). */
export interface CommandSink {
  run(command: ShellCommandId): boolean      // false when the command is unavailable (the key is not consumed)
}
/** Pushed scopes: surfaces that own keys while open. A scope pushed by a surface that holds the modal layer (story-presenter, pdf-page-editor) runs as that modal's own handler (step 4); stories-undo-toast is not modal (step 6). */
export interface KeyScopeHandle { dispose(): void }
export function pushKeyScope(scope: { readonly id: 'story-presenter' | 'pdf-page-editor' | 'stories-undo-toast'; handle(e: KeyboardEventLike, chord: KeyChord): boolean }): KeyScopeHandle

// app/keyboard/escape-chain.ts
export interface EscapeLayer {
  readonly id: string
  readonly priority: number          // higher runs first
  isActive(): boolean
  escape(): void
}
export function registerEscapeLayer(layer: EscapeLayer): () => void
/** The layer the next Esc would run; the tool card renders its hint from this. */
export function describeEscape(): EscapeLayer | null

// app/keyboard/arming.ts  (the one way app code arms a canvas tool; P9)
export function armCanvasTool(
  tool: ToolId,
  options: {
    readonly from: 'rail' | 'menu' | 'palette' | 'panel' | 'card' | 'shortcut' | 'start-card' | 'drop'
    readonly source?: ToolSource
    /** 0C only: keep this caller's focus behaviour of today (arming.ts records it per `from`). Deleted in F. */
    readonly focus?: 'legacy'
  },
): boolean

// app/keyboard/focus-owner.ts
export type FocusReason = 'tool-armed' | 'drop' | 'chooser-closed' | 'text-entry-closed' | 'menu-closed' | 'story-exit' | 'region-cycle' | 'user-opened' | 'tool-requested'
export interface FocusOwner extends CanvasFocusPort {
  focusMap(reason: FocusReason): void                  // the host itself, never a control inside it
  focusRegion(region: 'title-bar' | 'tool-rail' | 'map' | 'dock', reason: FocusReason): void
  /** A component opened by a user action focuses its first field through here; content-derived UI cannot. */
  focusOnOpen(el: HTMLElement, reason: 'user-opened'): void
  /** Replaces app/shell/focus-regions.ts registerFocusRegion (components/shared/useFocusRegion.ts re-points here in 0C). */
  registerRegion(region: 'title-bar' | 'tool-rail' | 'map' | 'dock', el: HTMLElement): () => void
  registerToolCardField(el: HTMLElement): () => void
}
```

`KeyRouter` (`key-router.ts`) owns the only window `keydown`/`keyup` listeners. `armCanvasTool` selects the canvas panel if needed, writes the source to the module read models (`canvas/plant-stamp-source.ts`, `canvas/saved-object-stamp-source.ts`: they stay, as what the tool card, recents and choosers display, and their `begin…` helpers call `armCanvasTool`), calls `CanvasToolCommandSurface.setTool(id, source)`, focuses the map for every `from` except `shortcut` (from phase F; in 0C every caller passes `focus: 'legacy'`), and records rail learning.

An **arrow-owning widget** is an element with role `listbox`, `menu`, `menubar`, `slider`, `spinbutton`, `tablist`, `tree`, `grid`, `radiogroup` or `toolbar`, a focusable `separator` (one that can take focus: the dock and Favorites splitters; the rail's decorative separators are not focusable and do not count), or an element with `data-owns-keys` listing arrows. Widgets that handle arrows without such a role declare `data-owns-keys="arrows"` on their root, each in its phase: the inspection lens preview (`InspectionLens.tsx`), the phone sheet handle (`PhoneSheet.tsx`), the calendar's date grid (`components/panels/CalendarPanel.tsx:301-330`, a plain `<table>`) the plant photo carousel (`components/species-detail/PhotoViewer.tsx:64-80`) and the World map container (`components/world-map/WorldMapSurface.tsx`, whose MapLibre keyboard handler pans with arrows), all phase 1, Components. The tool rail (`role="toolbar"`, `ToolRail.tsx:90-101`), the dock splitter (`SidePanelDock.tsx:105-124`) and the Favorites splitter (`FavoritesPanel.tsx:501-511`) are covered by their roles. A widget that must keep a `command` key opts in with `data-owns-keys="Delete"` (or the key it needs) on its root.

**Listener phases.** `installKeyRouter` adds, for `keydown` and `keyup`, one window capture listener and one window bubble listener; together they are the only window key listeners (P8). Capture keeps what runs before element handlers today (`scene-interaction.ts:1578` and `focus-regions.ts:106` listen in capture); bubble keeps the shell rows' rule (`shortcuts/manager.ts:26`, bubble, skips `defaultPrevented`).

Resolution order for one keydown. Capture listener:
1. Composition (`isComposing || keyCode === 229`): return (phase F).
2. Classify focus: `modal`, `text` (input, textarea, select, contenteditable, the text-entry host), `map` (map host or inside it), `body`, `other` (rail buttons, dock lists, menus, the compass).
3. Held keys: track modifiers in every class (for `physicalCtrl`); track Space as held only in `map` and `body`, or while a canvas gesture is live; send `keyState` to the canvas port; clear on blur, `visibilitychange` and Meta keyup.
4. While a pointer gesture or nudge series is live, the canvas port takes the key first whatever the focus (today `scene-interaction.ts:1077-1092`): Esc runs the `gesture` or `nudge-series` layer. F6 and Shift+F6 cycle regions (today in capture).

Bubble listener, skipped for a key already `defaultPrevented` (an element handler of a focused widget handled it; a widget that calls `stopPropagation` hides the key from these steps, as it hides it from the shell rows today; today's widgets stop propagation only on Escape: `InspectionLens.tsx:121`, `PlantColorMenu.tsx:243`, `PlantSymbolMenu.tsx:122`, `PdfPageEditor.tsx:105`):
5. Modal: the pushed scope of the surface holding the modal layer (story presenter, PDF page editor inside the PDF workspace), then `worksInModal` rows; nothing else. The modal's element handlers have already run.
6. `global` rows (in every class but `modal`; in `text` only with `worksInTextFields`). Ctrl F is a global row whose command asks the open panel's plant finder first and otherwise opens Edit › Find plants (today `shortcuts/manager.ts:15-20`).
7. Non-modal pushed scopes: the Stories Undo toast (Ctrl Z while the toast is on screen, today `app/stories/actions.ts` `runStoryUndoShortcut`). Popovers and menus are not scopes: their Esc is an Esc layer (step 8), and their arrows are handled by their own element (arrow-owning widgets).
8. Esc runs the Esc chain (popovers 100, canvas menu 80, … §3.7). An open text entry never reaches this step: its own element handler cancels it first, and focus class `text` keeps the canvas layers off.
9. Keymap match: `command` rows in `map`, `body` and `other`; `view-arrows` the same except in an arrow-owning widget; `canvas-focus` only in `map` and `body`.
10. Dispatch: `preventDefault` and `stopPropagation`; canvas commands through the port; a port `command()` that returns false runs the row's `fallback` through the platform's `CommandSink` (Desktop `commands/registry.ts`, Web `web/browser-shell-commands.ts`), and without a fallback the key is not consumed. Each chord has one row per scope; rows are never tried in turn (fixture H27).

Canvas-focus rows run only with focus on the map host or `<body>`, where no widget handler runs, so moving them from today's capture listener to bubble changes no outcome. A focused widget without a role that handles arrows (the scale button, `ZoomControls.tsx:138-143`) runs first and prevents the default, so Shift+↑ on it opens the scale menu and does not reset north. Fixtures run under 0C: I10 "Esc during a drag with focus in the inspection lens aborts the drag and leaves the lens open"; I11 "F6 from a widget that stops propagation still cycles regions"; H23 "Shift+↑ on the focused scale button opens the menu and does not reset north".

Focus after a modal closes stays with `useModalLayer` (it restores the previously focused element, `useModalLayer.ts:25`); it is the one focus mover outside the FocusOwner that P9b allows for modals.

### 1.7 Product types

```ts
// app/canvas-pdf/types.ts  (phase 1)
export type PdfMapOrientation = 'north-up' | 'as-on-screen'
export interface PdfSetup {
  // … existing fields …
  /** "Map orientation": north up (default) or as on screen. Distinct from the paper orientation of a page. */
  readonly mapOrientation?: PdfMapOrientation
}
export interface PdfPrintArea {
  readonly id: string
  readonly name: string
  /** The area in its own frame: centre ± width/2, height/2 along axes turned by rotationDeg. */
  readonly bounds: PrintBounds
  /** Clockwise from true north; default 0. Set to the angle of the page the area was drawn on. */
  readonly rotationDeg?: number
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
  /** The turned frame → plan metres (+angle): page-editor deltas and new Print Areas. */
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

The layout modules (`overview.ts`, `field-layout.ts`, `layout.ts`, `overview-guides.ts`, `zone-labels.ts`, `coverage.ts`, `field-summary.ts`, `page-drawing.ts`, `split-sheets.ts`, `field-dimensions.ts`) keep their axis-aligned `frame + (p − ground) × scale` maths and world-box tests: they run on the turned snapshot, where "axis-aligned" means "aligned with the page". Text they place (plant marks and codes, names, zone labels, dimension readouts) is laid out level on paper, so it stays upright whatever the angle. Only the page-window rectangles on an overview whose angle differs from the area's are drawn as turned outlines (§4.12).

```rust
// common-types/src/settings.rs  (phase 1)
pub struct LastView {
    // … existing fields …
    #[serde(default)]
    pub bearing: f64,   // 0 when missing; normalised on read
}
```

Stored data: `.canopi` does not change (`SavedViewCamera.bearing` exists; writers normalise to [0, 360)). Settings gain `LastView.bearing` with a one-line default. `PdfPrintArea.rotationDeg` is in memory only today because PDF setups are not persisted. `scroll_wheel` keeps its field and values; only its UI is relabelled.

### 1.8 Module layout: new and rewritten

This is the module table the plan's ownership and policy P11 refer to. Existing modules the renderer keeps, such as `canvas/runtime/plant-presentation.ts` and `canvas/runtime/text-visibility.ts` (still imported by three modules), stay where they are.

```
desktop/web/src/
├─ canvas/runtime/interaction-types.ts  §1.2a shared vocabulary (types)
├─ canvas/runtime/interaction-ports.ts  §1.2a ToolHost, InputRouter, DomInputSource (types)
├─ canvas/runtime/keyboard-port.ts      CanvasKeyboardPort implementation (0B; fed by the key router from 0C)
├─ canvas/runtime/legacy-camera-facade.ts  0A–0D2 only: the CameraController shim and today's camera.ts names over the view drivers; outside view/ (§1.1b)
├─ canvas/runtime/view/                 pure; imports only what policy P4 (plan §5, the authority) allows: own files, canvas/projection.ts,
│                                       canvas/session-plane.ts, canvas/workspace-camera-policy.ts, @preact/signals, type-only scene/types.ts
│  ├─ types.ts                          §1.1 types
│  ├─ read-surface.ts                   ViewReadSurface, ViewCommandSurface (types)
│  ├─ camera-driver.ts                  CameraDriver, CameraMove (types)
│  ├─ camera-math.ts                    Web Mercator + bearing targets (pan, zoom-around, rotate-around, keep-point)
│  ├─ bearing-tween.ts                  BearingTween
│  ├─ view-transform.ts                 buildViewTransform (analytic), quads, projectAnchors
│  ├─ navigation-policy.ts              constrainCamera, zoomFloorForArc, bearing helpers
│  ├─ navigation.ts                     ViewNavigation, the RotationSession implementation, temporary focus, openAt
│  ├─ fit.ts                            oriented fit of point sets inside insets
│  ├─ frame-source.ts                   ViewFrameSource, ViewReadSurface implementation
│  ├─ headless-driver.ts                HeadlessCameraDriver
│  ├─ driver-host.ts                    CameraDriverHost: headless ↔ attached swaps, failure signal
│  └─ *.test.ts                         contract, round trips, constrain at bearing 45, navigation rules
├─ canvas/runtime/input/                pure except dom-input-source.ts
│  ├─ platform.ts, thresholds.ts, raw-input.ts, gestures.ts, bindings.ts
│  ├─ normalise.ts, recognise.ts
│  ├─ context-menu-gesture.ts           copy of GeoLibre @ b3d91de (MIT header, THIRD_PARTY_NOTICES row)
│  ├─ selection-drag-guard.ts           copy of GeoLibre @ b3d91de (phase F)
│  ├─ dom-input-source.ts               the only DOM listener owner for canvas input (incl. ruler presses)
│  ├─ input-router.ts
│  └─ __fixtures__/sequences.ts, *.test.ts (fixtures, property test)
├─ canvas/runtime/tools/
│  ├─ tool.ts, draft.ts                 §1.4
│  ├─ tool-host.ts, registry.ts, snapping.ts, spatial-index.ts, hit-testing.ts (moved), constraints.ts (the 45° constraint, from pointer-utils.ts)
│  ├─ select/ … (incl. reshape.ts, from zone-control-points.ts), pan.ts, plant-stamp.ts, text-note.ts, zone-drag.ts, polygon.ts,
│  │  measurement-guide.ts (incl. its control points), object-stamp.ts, saved-object-stamp.ts, plant-row.ts, stamp-rotation.ts, tool-actions.ts
│  └─ *.test.ts                         ToolHarness: gesture scripts with a recording ToolEffects, incl. a rotated ToolView
├─ canvas/runtime/interaction/          kept, outside tools/: contextual-selection-actions.ts (app importers unchanged), canvas-context-menu.ts (imported only by tools/tool-host.ts), layer-guards.ts
├─ canvas/runtime/scene-runtime/drag-state.ts  scene drag-state helpers from interaction/drag-ops.ts (D4, 0B); command-surface.ts and the move tools import it
├─ canvas/runtime/chrome/               overlay DOM: handle-layer.ts, text-entry-host.ts, hover-tooltip.ts, locked-affordance.ts, rulers.ts (moved from canvas/rulers.ts)
├─ canvas/runtime/renderers/
│  ├─ scene-types.ts                    §1.5 (SceneRendererV2 beside today's SceneRendererInstance until 0D2)
│  ├─ pixi-scene.ts                     composition only
│  ├─ draft-layer.ts                    Pixi drafts, 0D1 to the end of 0D2 only; then dissolved into the two layers below
│  ├─ world-layers.ts                   zones, guides, grid (phase 1), selection preview; worldDraftRoot (world draft shapes, from 0D2)
│  ├─ billboard-layer.ts                plants, rings, badges, notes, labels; billboardDraftRoot (upright draft shapes, from 0D2)
│  └─ label-admission.ts
├─ canvas/runtime/interaction-session.ts  composition root (~200 lines): source → recognise → router → host
├─ maplibre/
│  ├─ camera-driver.ts                  MapLibreCameraDriver; transformConstrain guard adapter
│  ├─ workspace-camera.ts               0A–0D2 only: the MapLibreWorkspaceCameraOwner shim over camera-driver.ts (§1.1b)
│  ├─ view-agreement.ts                 the only map.project/unproject caller in the workspace (assertion)
│  ├─ shared-scene-layer.ts             reads the frame
│  └─ view-snapshot-map.ts              own driver; applies saved-view bearing
├─ app/keyboard/                        key-router.ts, key-chord.ts, keymap.ts, escape-chain.ts, focus-owner.ts, arming.ts, target-class.ts, *.test.ts
├─ app/canvas-pdf/page-frame.ts         §1.7 the turned page frame (phase 1)
├─ components/canvas/Compass.tsx        button (the whole face is the drag target); reads ViewReadSurface.bearingDeg; commands via ViewCommandSurface
├─ components/canvas/RulersNorthHint.tsx  the "Rulers show when north is up" pill above the view chip (§4.6); useMapOccluder; P15
└─ __tests__/support/                   test-view.ts (createTestView, §1.1b), scene-interaction-setup.ts (split shared setup), recording-renderer.ts
```

### 1.9 Module layout: deleted, in the phase that replaces them

| File or symbol | Replaced by | Phase |
|---|---|---|
| `maplibre/scene-camera-transform.ts` | `view/view-transform.ts`, `maplibre/view-agreement.ts` | 0A |
| `canvas/maplibre-camera.ts` (`createMapFrame`) | `maplibre/camera-driver.ts` | 0A |
| `maplibre/workspace-camera.ts` internals (incl. `recordResolvedMinimum`) | `maplibre/camera-driver.ts`; the module itself declares the constructible `MapLibreWorkspaceCameraOwner` shim (extending the facade's `CameraController` shim), `MapLibreWorkspaceCameraMap` and `MapLibreWorkspaceCameraFailure` until 0D2 ends (§1.1b) (plan §4 0A, "Legacy surface") | 0A; file deleted end of 0D2 |
| `canvas/runtime/camera.ts` internals (`CameraController`) | `view/headless-driver.ts`, `view/navigation.ts`; the module re-exports the legacy surface of `canvas/runtime/legacy-camera-facade.ts` (§1.1b) until 0D2 ends: a constructible `CameraController` shim with today's constructor and public members, `WorkspaceCameraFrameReader`, `WorkspaceCameraNavigation`, `WorkspaceCameraOwner`, `CameraViewportSnapshot`, `CameraFrameInsets`, `fitCameraViewport`, `cameraFramingRect`, and `SceneBounds` with its option types from `view/types.ts` (the exact list and who moves each test off it: plan §4 0A, "Legacy surface") | 0A; file deleted end of 0D2 |
| `canvas/runtime/legacy-camera-facade.ts` | direct `ViewFrameSource`/`ViewNavigation` use | end of 0D2 |
| `SceneViewportState` (`scene/types.ts:101-105`), `worldToScreen` in `annotation-layout.ts:180-185`, `viewportCenterWorld` (`canvas/projection.ts:95-103`) and the inline copies | `ViewTransform` (tools stop reading it in 0B; the renderer, the last reader, in 0D2) | end of 0D2 |
| `SceneRendererInstance` (`scene-types.ts:50-57`: `renderScene`, `setViewport`) | `SceneRendererV2`, renamed `SceneRenderer`; `SceneRendererDefinition.initialize` returns it | end of 0D2 |
| `__tests__/v2-shared-camera-transform.test.ts` | `view/view-transform.test.ts`, `view/camera-contract.test.ts` | 0A |
| `canvas/runtime/scene-interaction.ts` (1,699 lines) | `interaction-session.ts`, `input/**`, `tools/tool-host.ts` | 0B |
| `interaction/{tool-adapter,tool-modules,shared-gestures,pointer-utils,overlay-ui,polygon-draft-overlay,plant-spacing-overlay,plant-placement-preview,plant-drag-distance-overlay,zone-measurement-overlay,control-point-overlay,selection-rotation-handle,annotation-inline-editor,text-annotation-tool}.ts` | `tools/**`, `chrome/**`, draft shapes (`pointer-utils.ts`: `isEditableTarget` → `input/editable-target.ts`, `allowsNativeContextMenuTarget` → `input/dom-input-source.ts`, `constrainPointTo45Degrees` → `tools/constraints.ts`, `hasAdditiveModifier` and `cursorForTool` → `tools/tool-host.ts`) | 0B |
| `interaction/zone-control-points.ts`, `interaction/measurement-guide-control-points.ts` | `tools/select/reshape.ts` and `tools/measurement-guide.ts`, emitting `ToolHandle` data; the host draws them through `ToolHostDeps.chrome.setHandles` (`chrome/handle-layer.ts`) | 0B |
| `interaction/drag-ops.ts` | `scene-runtime/drag-state.ts` (outside `tools/`, since `command-surface.ts` value-imports it) | 0B |
| `renderers/draft-layer.ts` | `renderers/world-layers.ts` (world shapes, a ghost's zones), `renderers/billboard-layer.ts` (upright `circle-px` and `label` shapes, a ghost's plants and note text) | end of 0D2 |
| `__tests__/scene-interaction-tool-boundary.test.ts` (exact source strings) | P5, P6 | 0B |
| `canvas/rulers.ts` listeners | `input/dom-input-source.ts`; file moves to `chrome/rulers.ts` | 0B |
| `shortcuts/manager.ts`, `web/canvas-shortcuts.ts`, `app/shell/focus-regions.ts` | `app/keyboard/**` | 0C |
| `renderers/viewport-presentation.ts` | `renderers/label-admission.ts` | 0D2 |
| `canvas/runtime/scene-chrome.ts` (grid and guides Canvas2D) | `renderers/world-layers.ts` | 1 |
| `'overview'` in `primaryDragPansIn`, `LEGACY_BINDINGS`, `ROTATION_BINDINGS` | nothing | 2 |
| `settings.scrollWheel*` UI strings | `settings.pointingDevice*` | 2 |

## 2. Gesture vocabulary

### 2.1 Kinds

| Kind | Meaning | Reaches |
|---|---|---|
| `hover`, `hover-end` | pointer over the surface with no button | ToolHost → tool (world point, hit) |
| `press` | primary button or finger down | ToolHost → tool |
| `tap` | primary up within slop | ToolHost → tool (`clickCount` from the platform or the multi-click thresholds) |
| `drag-start`, `drag-move`, `drag-end` | primary past slop | ToolHost → tool, or `handle-drag` when the press was on a handle |
| `drop` | drag-and-drop from a panel | ToolHost → tool |
| `pan` | move the ground with the pointer; `deltaPx` is content movement | `ViewNavigation.panByPx` |
| `zoom` | factor about an anchor | `ViewNavigation.zoomAroundPx` |
| `rotate` | bearing change about an anchor, `totalDeltaDeg` since start, `step` live | one `RotationSession`: `start` → `beginRotation(anchor)`, `move` → `update`, `end` → `end()`, `cancel` → `cancel()` |
| `menu-request` | open the canvas menu at a point or for the selection | ToolHost menu path (hit, retarget, open) |
| `cancel` | the live session ended without completing | ToolHost (tool `cancel`) and, for a live rotate, `rotate{cancel}` |

Pinch and twist are sources, not kinds. Keys are not gestures: key-driven navigation goes from the KeyRouter through `CanvasKeyboardPort` to `ViewNavigation`, and key-driven tool actions become `ToolCommand`s. Compass-ring rotation is outside the pipeline: `Compass.tsx` drives a `RotationSession` from `ViewCommandSurface.beginRotation('centre')`. Pan sign: a `pan` with `deltaPx = (+10, 0)` moves the ground under the pointer 10 px right.

### 2.2 Recogniser rules

- **Sessions.** One mouse or pen session at a time, by `pointerId`; touch keeps up to two touches and ignores a third. A session's mode is fixed at start: pressing Shift mid-pan does not switch to rotate, and releasing Shift mid-rotate does not switch to pan. For a secondary, auxiliary or Mac Ctrl session only Shift held at the press decides the mode (rotate or pan), for all three buttons alike; Shift pressed after the press and before the 3 px slop is ignored; Space, Alt and mod at the press are ignored for the mode, and mod held later only steps a rotate (spec; fixture A18).
- **Rotation sign (spec).** A pointer rotate turns the view by `ROTATE_DEG_PER_PX` × the horizontal travel since the start, and a rightward drag increases the bearing (MapLibre's convention: the map turns counter-clockwise on screen, as if the pointer pushed the top of the map to the left). Twists (touch two-finger, WebKit trackpad) make the ground follow the fingers: a clockwise twist of the fingers turns the map clockwise on screen, which lowers the bearing by the twist angle. The compass drag makes the needle follow the pointer around the compass centre: moving the pointer clockwise around the face turns the needle clockwise, which lowers the bearing by the same angle (§4.2).
- **Primary.** `press` on down; `tap` on an up within slop, or `drag-start` past slop, then `drag-move`, `drag-end`. Space held at press turns it into `pan` (`space-drag`). Space pressed after a primary session started does not change it (a session's mode is fixed; spec): the drag, band or move continues, and Space is only recorded for the next press. In a `primaryDragPansIn` context a primary drag is `pan` (`primary-drag`); its press and tap still reach the tool (the Pan tool ignores them).
- **Auxiliary.** Drag → `pan`; with Shift at press and `auxiliaryShiftDrag: 'rotate'` → `rotate` about the press point, `step` = mod held live. A middle tap does nothing; `pointerdown` is always default-prevented (no autoscroll, no Linux paste).
- **Secondary (legacy, `menu-on-native`).** The button is inert; a native `contextmenu` on the surface opens the menu at once, except in overview.
- **Secondary (V2).** `down` → pending, capture taken, nothing emitted. Past 3 px with no Shift at the press → `pan`; with Shift at the press → `rotate` about the press point, `step` = mod held live (a consumed Mac Ctrl never counts). An `up` within 3 px → `menu-request` at the release point on every OS (convention). The document-capture `contextmenu` guard acts only on events whose target class is `surface`, `handle`, `ruler` or `owned-chrome`, or that arrive while a canvas secondary session is live or within 250 ms of its end (the WebView2 trail, which may be retargeted to `<html>` or the open menu, A8). There, every mouse and pen native `contextmenu` is prevented; one is honoured only when `fromKeyboard`, or when no secondary session exists and none ended in the last 250 ms and it is not a keyboard-menu echo within 500 ms; it then becomes `menu-request('selection', 'keyboard')`, except on `owned-chrome`, where it emits nothing. On `owned-text` and `foreign` targets the guard does nothing: the native menu (copy and paste in the note editor and panel fields) stays and no `menu-request` is emitted (spec, as today's `allowsNativeContextMenuTarget`, `pointer-utils.ts:27`).
- **Drag end.** A drag ends when `buttons` loses its role on a `move`, on `up`, on lost capture, blur or `visibilitychange`.
- **Navigation during a primary drag (V2 on).** A `move` that adds the secondary or auxiliary bit opens a nested sub-session: `pan`, or `rotate` if Shift is held at that moment. It emits from later move deltas while the primary drag's last screen point stays frozen (no `drag-move`), ends when the bit clears, and the primary drag resumes from the frozen point. Its native menu is prevented and no `menu-request` is emitted. Esc while a nested sub-session is live runs layer 70 for the nested session only: a nested pan ends where it is, a nested rotate restores the camera from the chord moment; the primary drag keeps its draft and stays frozen until the bit clears, then resumes; a second Esc cancels the primary drag and its draft (spec; fixtures A11b, A12b). Under LEGACY and ROTATION a second button mid-session is ignored for the rest of the session.
- **Other chords.** A primary press during a secondary or auxiliary session is ignored for the rest of that session; its native menu is prevented.
- **Touch before phase 3.** One touch is a primary pointer exactly as today; a second concurrent touch is ignored; no long press, no twist; host CSS unchanged.
- **Touch (phase 3).** One finger is primary with 8 px slop. Still for 500 ms → `menu-request('long-press')` and the session ends (no `tap` on release). A second finger before slop withdraws the press (`cancel('multitouch')`); after a drag started, the drag is cancelled and its Scene Edit aborted (a polygon draft survives, as it does a pan). Two fingers: centroid → `pan`, distance ratio → `zoom` about the centroid, angle → `rotate` after 25 px of arc with the threshold subtracted. Lifting to one finger does not resume editing until every finger lifted. Android's native long-press `contextmenu` and the timer produce one menu.
- **Pen.** Tip = primary with pen slop; barrel = secondary rules when `penBarrel: 'secondary'`; eraser ignored; hover works.
- **WebKit gesture events** (`trackpadGestures`). Scale → `zoom` (`trackpad-pinch`) at once, as a ratio to the previous event. Rotation is accumulated and emits nothing until |accumulated| exceeds 10°; then `rotate` (`trackpad-twist`) starts with the threshold subtracted. A Ctrl+wheel inside an open gesture is ignored; `gesture*` defaults are prevented. On iOS the pointer-based two-finger recogniser is the only source; `gesture*` is prevented and not counted.
- **Cancel fences.** `pointercancel`, lost capture, blur, `visibilitychange`, the Esc chain's `escape`, and a tool change (`configure`) emit `cancel`; a live rotate emits `rotate{cancel}`, which restores the starting camera.

### 2.3 Modifier resolution (ToolHost)

| Meaning | LEGACY and ROTATION | V2 and TOUCH |
|---|---|---|
| `additive` | Shift, Ctrl or Cmd (today) | Shift or mod (on Mac: Shift or Cmd; Ctrl+click is a right click) |
| `subtractive` | never | Alt |
| `constrain` | Shift in Polygon, Plant a row (world axes before 1; screen axes from 1, identical at bearing 0) and on the rotate handle (15° steps from the press angle, as today) | Shift in every drawing tool (screen axes) and on the rotate handle (unchanged) |
| constrain and snap order | today's: Polygon snaps, then constrains (`zone-drawing-tool.ts:226`), so a Shift corner may be off-grid; Plant a row constrains the raw point (Shift is also no-snap) | constrain, then snap the length along the ray (Polygon changes in 2; spec) |
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
| Right or middle added during a left drag | nested pan; the tool's drag freezes and resumes (from 2). Before 2: ignored | nested turn of the view (from 2) | as no modifier | as no modifier | n/a (Space-drag is already a pan) | as no modifier |
| Space held at a left press, no movement | no press reaches the tool: Plant stamp places nothing and Polygon adds no corner (today, `beginPan` claims the press first, `scene-interaction.ts:600-606`) | — | — | — | — | — |
| Space pressed during a left drag | the drag, band or move continues; Space is not a pan until the next press (a session's mode is fixed, spec) | — | — | — | — | — |
| Several modifiers at a right, middle or Mac Ctrl press | only Shift decides: with Shift, turn; without, pan. Space, Alt and mod at the press are ignored for the mode (Space+Shift+right-drag and Alt+Shift+right-drag turn; spec) | | | | | |
| Left added during a right or middle drag | ignored for the rest of that drag; no press reaches the tool | same | same | same | same | same |
| Double right-click | two menu requests; the second replaces the first | — | — | — | — | — |

Known limitation (Linux desktop): on KDE, Xfce, Cinnamon and MATE the window manager takes Alt+left-drag (move the window) and Alt+right-drag (resize it) before WebKitGTK sees them, so Alt+click and Alt+right-drag can be unreliable there. Both actions stay reachable: Shift or mod click toggles an object, and Delete on a focused corner removes it (§3.2). The phase-2 Linux live check records the behaviour.

Rotation from the pointer is never available without Shift (user: deliberate gestures only). Release of a free rotate drag within 7° of north tweens to north in 300 ms about the press point. Esc during any rotate drag restores the camera from before the drag.

### 3.2 Left button (pen tip, one finger) per tool

"Click" is a `tap`; "drag" is past slop; "double-click" is `clickCount ≥ 2`. Every drag in every tool accepts navigation during the drag (wheel zoom, today; key turns and resets from 1, §4.3; right- or middle-drag pan and Shift+right-drag rotate from 2): the draft stays under the cursor and its start stays on the ground. Space held at press pans instead (§3.1).

| Tool (key) | Click | Drag | Double-click | Shift | mod | Alt |
|---|---|---|---|---|---|---|
| Select (V) | selects the hit object; empty ground clears; a locked object is selected and shows Unlock. From 2: a click inside a zone's fill selects the zone when no plant or note is on top | from empty ground: band select; the band is a screen rectangle and hits in its world quad (from 1). From an object or the outline of a selected zone: moves the selection. From 2 a drag that starts inside a zone's fill bands, never moves the zone. From a handle: rotate, reshape corner or vertex, guide end | on a plant: selects every plant of that species; on a note: edits its text; on a zone edge: adds a corner (from 2) | click toggles the hit; drag from empty: adds the band to the selection (never box zoom); a drag that starts on an object toggles it on press and moves nothing (today, `shared-gestures.ts:233-237`); on the rotate handle: 15° object steps from the press angle (today, every phase) | as Shift for click and band (on Mac, Cmd) | click removes the hit from the selection (from 2); Alt+click on a selected corner handle removes the corner, minimum 3 (from 2); Alt+drag bands as without Alt (spec) |
| Pan (H) | nothing | pans (mouse, pen, touch); a press on a rotate or vertex handle drags the handle (today, through phase 1) and pans from 2 (convention) | nothing | ignored (a session's mode is fixed) | ignored | ignored |
| Plant stamp (P) | places one plant of the chosen species at the snapped point; with no species the card asks to choose one | the press already placed; the drag does nothing more (today) | places a second plant (each press places one, today) | none | none | none |
| Plant a row (W) | on a placed plant: chooses it as the row source | draws the row from the source along the drag (slop 4 px); plants at the spacing interval | nothing | 45° steps against the screen axes (from 1; before: world axes). Before 2 Shift also turns snapping off | no snapping while held (from 2) | none |
| Object stamp (K) | first click on a plant, zone, note or group copies it (the pick); later clicks place the pick, level to the screen at the current bearing (from 1) | nothing more than the click | places twice | none | none | none |
| Saved object stamp (no key) | places the saved stamp, level to the screen (from 1); a drop from Favorites places it the same way (from 1) | nothing more | places twice | none | none | none |
| Text (T) | places a note and opens text entry; a note created on a rotated map is level to the screen (from 1) | nothing more | nothing more | none | none | none |
| Line (L) | nothing | draws a line | nothing | 45° steps against the screen axes (from 2) | none | none |
| Measure (M) | nothing | measures; the line stays as a guide | nothing | 45° steps against the screen axes (from 2) | none | none |
| Rectangle (R) | nothing | draws a rectangle aligned to the screen, stored with `rotationDeg = bearing` (from 1) | nothing | square (from 2) | none | none |
| Ellipse (E) | nothing | draws an ellipse aligned to the screen, stored with `rotationDeg = bearing` (from 1) | nothing | circle (from 2) | none | none |
| Polygon (Z) | the press adds a corner (today); a press on the first corner finishes (3+ corners) | the press already added the corner; the drag moves nothing (today) | the second press of a double-click finishes instead of adding a corner (3+ corners, from 2) | 45° steps against the screen axes (from 1; before: world axes) | none | none |
| Handle (any tool that shows handles) | focuses nothing; handles are DOM buttons | `handle-drag`; with Space held or the Pan tool armed at the press: `handle-drag` today (the handle is hit before the pan check, `scene-interaction.ts:584-608`), `pan` from 2 | on an edge midpoint: adds a corner (from 2) | rotate handle: 15° steps from the press angle (today) | none | removes a selected corner (from 2) |
| Ruler (press on a ruler) | nothing | pulls a guide, only while north is up | nothing | none | none | none |

Cells the table leaves implicit:
- **Select, mod at a drag that starts on an object:** as Shift: toggles the object on press and moves nothing (today: `hasAdditiveModifier` treats Ctrl and Cmd like Shift; on Mac from 2 only Cmd, since a physical Ctrl is a right-click).
- **Select, Alt+drag from an object or a selected object:** moves the selection as without Alt; Alt changes only a click (from 2, spec; today Alt is ignored).
- **Space+Shift+left-drag:** pans; Shift does nothing, since a session's mode is fixed at start (today).
- **Space held at a press on a handle:** today and through phase 1 the handle drags (the handle is hit first); from 2 it pans, as Space at any press does (§3.1; convention), and the handle is not dragged. The same holds for a Pan-tool press on a handle. Fixtures G3b and J9b pin today's order under LEGACY.
- **Text, click while an entry is open:** commits the entry and places nothing (today, `text-annotation-tool.ts:38-41`); the next click places a note.
- **Saved object stamp after the first Esc dropped the stamp:** the tool stays armed with no stamp; a click places nothing and the card offers "Choose a saved stamp" (from 2).
- **Plant a row with no source:** a click or drag on empty ground does nothing; the card asks for a placed plant (today).
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

| Input (phase 3, `TOUCH_BINDINGS`) | Every tool | Pan tool | Overview |
|---|---|---|---|
| One-finger tap | `tap` as the left-click column of §3.2 | nothing | selects a zone or note, or clears |
| One-finger drag | `drag` as the left-drag column of §3.2 (8 px slop) | pans | band select |
| One-finger long press (500 ms still) | canvas menu at the finger, source `long-press`; no tap follows | menu | no menu |
| Long press then move | no menu if the finger moved past slop before 500 ms (it is a drag) | — | — |
| Two-finger pan | pans by the centroid | same | same |
| Two-finger pinch | zooms about the centroid | same | same |
| Two-finger twist | turns the view after 25 px of arc, threshold subtracted; release within 7° of north snaps | same | same |
| Held press (tools that act on `press`: Plant stamp places a plant, Polygon adds a corner) | under TOUCH the ToolHost holds a finger's `press` until the finger passes slop (then `press` and the drag), lifts (then `press` and `tap`), or the 500 ms long-press window ends still (then the menu, and the press is dropped); so a withdrawn press never reached the tool and nothing needs undoing | same | same |
| Second finger before the first passed slop | the held press is withdrawn (`cancel('multitouch')`) before the tool saw it; the two-finger gesture starts | same | same |
| Second finger after a one-finger drag started | the drag is cancelled and its edit aborted; a polygon draft keeps its corners; the two-finger gesture starts | same | same |
| One finger lifted from two | nothing resumes until every finger is up | same | same |
| Third finger | ignored | same | same |
| Handles | 44 px targets (`hitRadiusPx` 22) | — | — |
| Touch on the text entry (`owned-text`: the note editor, a child of the map host) | no canvas session: a tap moves the caret, a long press selects text with the native callout, a drag scrolls or selects inside the entry; the 500 ms timer never runs there, so no canvas menu | same | — |

Host CSS under `TOUCH_BINDINGS` only: `touch-action: none; -webkit-touch-callout: none; overscroll-behavior: none` on the map host, and `touch-action: auto; -webkit-touch-callout: default` on the text-entry host (the callout is inherited), both asserted by a DOM test.

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

| Key | Action | Scope | Switch | Phase |
|---|---|---|---|---|
| V, H, P, W, K, Z, R, E, L, T, M | arm Select, Pan, Plant stamp, Plant a row, Object stamp, Polygon, Rectangle, Ellipse, Line, Text, Measure | `command` | follows | unchanged |
| N | reset north (300 ms) | `command` | follows | 1 (was cycle labels) |
| Shift+N | reset north (300 ms) | `command` | always | 1 |
| Shift+L | cycle labels: none, codes, names | `command` | follows | 1 (moved from N, convention) |
| Shift+← / Shift+→ | turn the view to the next 15° multiple left / right (300 ms, about the centre): from 22°, Shift+→ ends at 30°, not 37° (spec: the user said "rotates 15 degrees"; landing on the 15° grid is this document's reading) | `view-arrows` | n/a | 1 (was large nudge or large pan) |
| Shift+↑ | reset north | `view-arrows` | n/a | 1 (was large nudge or large pan) |
| Shift+↓ | unbound, reserved for tilt | — | — | 1 (convention) |
| ← → ↑ ↓ | with a selection, the Select tool armed and site mode: nudge 10 cm along the screen direction (from 1; before: world axes); with a selection in another tool or in overview: nothing (today, every phase); with none: pan 64 px along the screen, in any tool and in overview. Never while a pointer session (drag, band, move, handle drag, pan or rotate) is live: the arrow does nothing (today, `scene-interaction.ts:1152`; every phase; fixture H25) | `canvas-focus` | n/a | 1 |
| mod+arrows | as the arrows, 1 m or 256 px, along the screen | `canvas-focus` | n/a | 1 (was Shift+arrows) |
| Alt+arrows | unbound | — | — | — |
| macOS Ctrl+arrows | not bound (Mission Control) | — | — | — |
| Shift+G, Shift+S, Shift+R | grid, snap to grid, rulers (rulers while rotated: on, hidden, with the hint) | `command` | follows | unchanged |
| [ / ] | a held stamp: turn it −15° / +15°; otherwise send to back / bring to front | `command` | follows, except that a held stamp's turn also works on map focus with the switch off (today, `stamp-rotation.ts:22-31`; fixture H24) | unchanged |
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

Moved keys, in one list: N (cycle labels → reset north); Shift+L (new: cycle labels); Shift+arrows (large nudge and pan → turn view and reset north; Shift+↓ unbound); large step (Shift+arrow → mod+arrow, on the canvas, in the PDF page editor and in the inspection lens); Plant a row no-snap (Shift → mod during the drag); Esc on a held stamp pick (leave the tool → drop the pick first; Plant a row already drops its source first today); Pan tool (main rail → View and Tools menus, palette, phone strip). Moved behaviour: Space held or the Pan tool armed at a press on a rotate or vertex handle (the handle drags → the map pans, from 2).

### 3.7 Esc per tool

The text entry (note editor, spacing field) is not a layer: its element handler (`chrome/text-entry-host.ts`, the tool card's field) cancels it and returns focus to the map before the router's bubble listener runs (§1.6 step 8, §3.8).

| Priority | Layer | Active when |
|---|---|---|
| 100 | open popover, menu, dropdown, colour or symbol popover | open (phase F moves their document listeners into layers) |
| 80 | canvas context menu | open |
| 70 | live pointer gesture, including a rotate drag and a compass drag (the compass registers its own layer; both restore the starting camera) and, from 2, a pan (right-, middle- or Space-drag, the Pan tool: the pan ends where it is and the Esc is consumed; spec). A nested pan or rotate inside a primary drag (from 2) is ended first, alone; the primary drag and its draft wait for the next Esc (§2.2, A11b, A12b) | a drag, band, move, handle drag, pan or rotate is live |
| 65 | nudge series (abort) | arrows moved the selection and the series is not committed |
| 60 | tool transient | a polygon draft or a Plant a row source (today); from 2 also a held stamp pick |
| 50 | non-Select tool → Select | any tool but Select is armed |
| 30 | selection → clear | something is selected |
| 25 | raster inspection → end | inspecting |
| 10 | dock panel or phone sheet → close | open |

The canvas layers are active from every focus class except `text` and `modal` whenever a tool is armed, a gesture is live or a transient exists (phase F; phase 0 keeps today's behaviour). One Esc runs one layer. In overview only layers 100, 70 (a live pan or rotate, or today's interrupted gesture), 30 (from 2, the overview selection), 25 and 10 run; 65, 60 and 50 never run there, so Esc never leaves the tool in overview (today), and the per-tool table below applies in site mode only.

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

The tool card's "Esc …" line is rendered from `describeEscape()`.

### 3.8 Exceptions

| Surface | Rule |
|---|---|
| Text entry (note editor, the tool-card spacing field) | Focus class `text`: letters type; single-key shortcuts, Delete, arrows, Shift+arrows, N and Shift+N do not reach the canvas; `global` rows with `worksInTextFields` still work. Enter commits, Shift+Enter adds a line, Esc cancels. From phase F both are IME-safe in the entry itself: `chrome/text-entry-host.ts` ignores Enter and Esc while `isComposing || keyCode === 229`, because its element listener runs before the key router's guard. Any press on the map outside the entry, primary, middle or right, commits it first (today: `_pointerDownWhenSettled` commits on buttons 0 and 1, then focuses the host, and both textareas commit on blur; every phase), so a middle- or right-drag pan or a Shift+right- or Shift+middle-drag turn closes it; with the Text tool that primary press places no note (today, §3.2). Space held in the entry types a space and arms no pan (fixture G11), so a Space-drag never starts from it. A wheel over the map keeps the entry open and the entry follows its note; a key turn or reset cannot reach the map from the entry (focus class `text`). A still right-click (a `menu-request`) commits the entry first, then opens the menu. Esc in the entry is the entry's own element handler, which runs before the chain; no canvas pan or turn is live while it is open. Wheel over the entry itself is not handled. The textarea is drawn at `rotationDeg − bearing`. |
| PDF page editor (`components/canvas-pdf/PdfPageEditor.tsx`) | A separate surface with its own pointer handling and a pushed key scope; the canvas input pipeline does not run there. See the table below. |
| Modal dialogs | Only the modal's element handlers, its pushed scope if it has one, and `worksInModal` rows (§1.6 step 5). |
| Story presenter | A modal (`StoryPresenter.tsx:36` holds the modal layer) whose pushed presentation scope runs as its own handler: Space, arrows and Esc navigate the story; no canvas keys (fixture I12). Each step restores its bearing. |
| Canvas context menu, popovers | Their own arrows; Esc closes one at a time. |
| Arrow-owning widgets (lists, sliders, tabs, menus) | Plain and Shift+arrows stay with the widget; N, Shift+N and other `command` keys act on the canvas unless the widget claims them with `data-owns-keys`. |
| Inspection lens preview | Arrow-owning: arrows move the lens along the screen; mod+arrow moves farther (spec, matching the canvas; was Shift); Shift+arrows move by the plain step (from 1). Drag is screen-relative. |
| World map (template and place picker) | Its own MapLibre map: north-up, left-drag pans, wheel zooms, no rotation, no compass; `boxZoom: false` from 2 (convention). Its keyboard handler keeps arrow pans and +/− zoom but `disableRotation()` stops Shift+arrows turning and tilting it (from F, INV-CAM-46); its container declares `data-owns-keys="arrows"`, so Shift+←/→/↑ never reach the workspace view from it (from 1, fixture H26). |
| Inspecting a raster (Desktop LiDAR inspection) | A plain primary press (mouse left, pen tip, and a one-finger tap) anywhere on the map samples the point instead of reaching the tool, after handles and the pan check and before the tool (today, `scene-interaction.ts:609-614`; ToolHost `deps.inspect`, fixture J10). Shift, mod or Alt at the press still samples (today: the probe reads no modifier); the sampled press starts no drag, band or move. Space+drag and a Pan-tool drag pan (the pan check comes first); under TOUCH the probe runs when the held press resolves to a tap, never on a drag, a long press or a second finger. In overview the probe never runs (today: overview presses pan before 2; from 2 they select, convention). Right, middle and pen-barrel input, the canvas menu, wheel and every rotation input are unchanged; Esc layer 25 ends inspecting. |
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
| Print Area drawn on an "As on screen" page | level with the page, stored with the page's angle |

### 4.8 Labels and text orientation

Notes are map objects: stored `rotationDeg` is clockwise from true north (null reads as 0), and the text is drawn at `rotationDeg − bearing`, so notes turn with the map. Everything else stays upright on screen: plant glyphs (side-view pictograms), plant names, zone names and measurement readouts, stack badges, guide labels, draft labels, handles, the hover tooltip and the locked affordance. Billboards are never under a rotating container.

### 4.9 Hit testing and band select

Hits are world-space and unaffected by bearing; pixel tolerances convert through `metresPerPixelAt`. The band is drawn as a screen rectangle and hits everything in its world quad (`screenRectToWorldQuad` → `hitInQuad`); the draft is a `quad` shape. Selection handles anchor on the selection hull projected from four corners; the rotate handle sits 42 px above the hull's top edge on screen. The note hit box is the rotated text box, north-relative, the same model as print and GeoJSON.

### 4.10 Saved views and stories

- Capture writes `SavedViewCamera.bearing = normaliseBearing(bearing)` and the extent as the lon/lat bounding box of the ground under the four screen corners (convention; no new field).
- Restore uses centre, zoom and bearing from the camera at every bearing (from 1): going to a view or a story step no longer fits the stored extent to the window (`savedViewZoomFor`, `current-view.ts:98-104`, today), so a view saved in a large window reopens closer in a small one (plan section 8, phase 1). The extent is used only by thumbnails of north-up views (`snapshot.ts:71`; a rotated view's thumbnail scales its camera zoom to the thumbnail, as a view without an extent does today) and by older builds, which show a rotated view north-up and slightly zoomed out.
- Stories restore each step's bearing; restores are explicit targets and never snap.

### 4.11 Snapshot map and thumbnails

The snapshot map (`maplibre/view-snapshot-map.ts`) has its own `MapLibreCameraDriver` and applies the saved view's bearing. Saved-view and story thumbnails are drawn at the saved bearing (the cache key already includes the camera). Recent-file sketches (`DesignSketch`) and saved-stamp thumbnails stay north-up. PDF page-rail thumbnails follow their page's orientation.

### 4.12 PDF

- A two-option control labelled "Map orientation" under Plant colours (placement and look: `.interface-design/patterns/canvas-navigation.md`, Export planting plan); it is not the paper "Orientation" of a page. North up (default) and As on screen. The bearing is captured once when the PDF workspace opens.
- North up: every map page is north-up (`angleDeg` 0, `turnSnapshot` is the identity); a Print Area with an angle prints as the north-aligned box around its four corners.
- As on screen: the overview page is drawn at the captured bearing; each Print Area page is drawn at the area's own angle, so the area is level on the page. Each page's layout runs on `turnSnapshot(snapshot, pageFrame(angle, ground centre))`; `PdfPage.angleDeg` records the angle.
- Page windows on the overview: an area whose angle equals the overview's is drawn as today's rectangle; otherwise as the outline of its four corners turned by (area angle − overview angle), with its number at the outline's centre. The overview's coverage fit (`fitOverview`) fits those corners.
- Overview guide bands (`overview-guides.ts`): "horizontal" means horizontal on the page, in the turned frame; on an As on screen overview the band follows the screen's horizontal.
- Split sheets split in the area's own (turned) frame along the page's axes; every sheet keeps the parent's angle.
- The page editor turns its screen deltas back by `fromFrame` (+angle) before applying them to the ground; a Print Area drawn on a turned page stores that page's angle.
- The north arrow ("North arrow and scale") always points to true north: it is drawn at `−angle` with its letter. The scale bar is unchanged.

### 4.13 Inspection lens

The lens turns with the view (convention): its local transform is built at the live bearing, so the loupe matches what is under the pointer. Its drags and arrows are screen-relative.

### 4.14 Scale bar and zoom limits

The scale bar and 1:N ratio read the ground resolution at the screen centre, which does not depend on the bearing at pitch 0. Rotation can raise the zoom floor at world zoom (the rotated viewport must stay inside one world copy); `zoomLimit` reports `min` at the floor for the live bearing, so the zoom-out button disables correctly.

### 4.15 Opening a Design and the last view

Reopening a Design with content restores the last bearing (user) and fits at it (`openAt`). A new or empty Design opens north-up at the zoomed-out last-view centre, so "Where is your site?" appears over a north-up overview (convention). `LastView` is per device: the bearing carries over to whichever Design opens next. Fit, Fit to Design, zoom to selection, temporary focus and place search keep the current bearing.

### 4.16 Turn view to this edge

A canvas-menu entry when the menu request's point lies within the edge tolerance of a polygon or rectangle zone's edge (pattern), in its own group before Lock; while the entry is highlighted the edge is traced in ochre (`ContextMenuPort` `highlightEdge`, drawn as a draft). Sources: a mouse right-click, a Mac Ctrl+click (from 2) and a pen-barrel tap use 8 px; a long press (from 3) uses the 22 px touch radius. The Menu key and Shift+F10 have no point, so they never offer it: the entry is pointer-only, a named exception to the keyboard-path rule of `system.md` (the keyboard turns the view with Shift+←/→). Ellipse zones have no edges and never offer it. It turns the view by the smaller angle that makes the edge horizontal on screen, as a 300 ms tween about the centre, never snapped. The bearing is saved with any saved view captured afterwards.

### 4.17 World map

North-up, no rotation, no compass; left-drag pans (a navigation-only picker); Shift+arrows no longer turn or tilt it (phase F); Shift+drag no longer box-zooms (phase 2, convention).

### 4.18 Web Edition phone layout and touch

- Phase 1: the compass joins the phone zoom column, and the phone View menu gains "Reset north", so a phone user who opens a rotated Design (last view, saved view, story) can always return north. The compass ring turns the view by touch from phase 1.
- The Pan tool stays in the phone strip in every phase.
- Phase 3: two-finger pan, pinch and twist; long press opens the menu; one finger edits; 44 px handle targets; Fit joins the phone zoom column.
- Rulers are not shown on phones today; the hint follows the rulers.

### 4.19 Re-origin

The session plane stays north-aligned whatever the bearing. Re-origin runs on the settled frame when the ground under the screen centre is more than 10 km from the origin; the camera is geographic, so the map does not move. Drafts, gesture starts, handles and the temporary-focus bookmark survive it.

## 5. Synthetic event-sequence tests

Recogniser fixtures live in `canvas/runtime/input/__fixtures__/sequences.ts` and run through `normalise` and `recognise` with an injected platform, clock and bindings constant. Each is named by its id and title, for example `seq('A1 Windows right-click', { os: 'windows', engine: 'chromium' }, V2_BINDINGS)`. Unless a row says otherwise, a V2 expectation also holds under `TOUCH_BINDINGS`, and every fixture that exists under LEGACY pins today's behaviour.

A property test (`input/recognise.property.test.ts`) covers any interleaving of down, move (with changing `buttons`), up, cancel, blur, escape and configure: every started session and nested sub-session ends exactly once, and every `capture` effect is paired with a release.

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
| A11 Right pressed during a left drag | any | down(0) → moves `buttons 1` → move `buttons 3` → (linux) contextmenu → moves → move `buttons 1` → up(0) | nested `pan` from the moves while bits 1 and 2 are down; the primary point stays frozen and the band resumes and commits; contextmenu prevented; no menu | no pan; the band continues and commits; no menu |
| A12 Shift at the chord moment | any | as A11 with Shift held when bit 2 arrives | nested `rotate` about the frozen point | no rotate |
| A11b Esc during a nested pan (spec) | any | A11 until the nested pan moves → `escape` → moves `buttons 3` → move `buttons 1` → moves → up(0) | `pan{end}` at the escape; no `cancel` for the primary drag; later `buttons 3` moves emit nothing; `drag-move` resumes when bit 2 clears; a second `escape` would emit `cancel` | — (the right press is ignored) |
| A12b Esc during a nested rotate (spec) | any | A12 mid-rotate → `escape` → move `buttons 1` → up(0) | `rotate{cancel}` (camera back to the chord moment); the primary drag survives and resumes | — |
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
| E2 One-finger drag | touch down → moves → up | TOUCH: primary drag (band or draw), never pan; host `touch-action: none` asserted by a DOM test |
| E3 Browser steals the touch | touch down → 2 moves → pointercancel | `cancel('pointercancel')`; no half band committed |
| E4 Two-finger pan, zoom, turn | id1 down, id2 down, both move, id2 up, id1 up | TOUCH: id1 cancelled (`multitouch`) before any commit; `pan` by centroid, `zoom` by distance ratio, `rotate` after 25 px of arc; after id2 up the remaining finger does not resume |
| E5 Second finger after a drag started | one-finger draw past slop, then id2 down | TOUCH: the draw is cancelled, not committed; a polygon draft keeps its corners |
| E6 Long press on Android | touch down, hold 600 ms, contextmenu, up | TOUCH: exactly one `menu-request(long-press)` whichever arrives first; contextmenu prevented |
| E7 Long press on iOS | touch down, hold 600 ms, up | TOUCH: `menu-request(long-press)` from the timer; no tap |
| E8 Long press with movement | move past slop at 200 ms, hold, up | drag; no menu |
| E9 Trackpad pinch with rotation drift | mac/webkit, ROTATION on: gesturestart → changes with scale 1.2, 1.5 and rotation ±4° → gestureend | `zoom` only; no `rotate` |
| E10 Deliberate trackpad twist | mac/webkit: rotation 5°, 12°, 20° (WebKit `rotation` is clockwise-positive) | nothing at 5°; `rotate` starts at 12° with `totalDeltaDeg` −2°, then −10° (the ground follows the fingers: a clockwise twist lowers the bearing); snap on end if within 7° of north; defaults prevented |
| E11 Touch under V2 behaves like today, except overview (a one-finger drag bands from 2, G7) | V2: one touch down → moves → up; a second touch meanwhile | primary drag as today; the second touch is ignored; no long press |
| E13 Press-acting tools under a pinch | TOUCH, Plant stamp armed: id1 down, id2 down 40 ms later, both move; Polygon armed: same | no plant placed; no corner added; `pan`/`zoom` only |
| E14 Press-acting tools under a long press | TOUCH, Plant stamp armed, then Polygon armed: touch down, hold 600 ms, up | the menu opens; no plant placed; no corner added |
| E12 iOS gesture events alongside pointers | TOUCH, ios: id1, id2 down → gesturestart → gesturechange(1.5, 10°) → pointer moves → gestureend | one source of truth (the pointer recogniser); `gesture*` prevented, not counted twice |

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
| F11 WKWebView pinch and rotate | gesturestart → change(1.2, 5°) → change(1.5, 12°) → end | ROTATION on: `zoom(1.2)`, `zoom(1.25)`; `rotate` starts only past 10° (total 2° at 12°); LEGACY: zoom only |
| F12 WKWebView pinch with Ctrl wheels | gesturestart → wheel ctrl → change(1.1) → wheel ctrl → end | zoom only from the gesture; Ctrl wheels inside the gesture ignored |
| F13 WebKitGTK pinch | no DOM events | none possible; a manual release check records the documented absence |
| F14 Momentum tail | 20 small wheels at 16 ms, a pointerdown during the tail | wheels stay standalone; the press starts a fresh session |
| F15 Wheel over owned text | wheel on the text-entry host | not prevented; no output |
| F16 Page mode | wheel deltaMode 2, dy 1 | dy = host height |
| F17 Alt + wheel (spec) | wheel alt, dy 100, Mouse | zoom as without Alt; never `rotate` |
| F18 Wheel during a rotate (convention) | ROTATION: down(1, Shift) → moves → wheel dy 100 → moves → up | `rotate` continues; the wheel emits no `zoom`; LEGACY: the Shift+middle-drag is a `pan`, and the wheel zooms as today |

### 5.7 Middle button and Space

| Id | Sequence | Expect |
|---|---|---|
| G1 Middle-drag | down(1) → moves → up → (Firefox) auxclick | `pan`; pointerdown default prevented; auxclick ignored |
| G2 Middle-click on Linux | down(1) → up(1) → auxclick | nothing; pointerdown prevented |
| G3 Space+drag | Space down (repeats) → down(0) → moves → up → Space up | Space recorded once; `pan` (`space-drag`), not band; cursor grab → grabbing → tool cursor |
| G3b Space at a press on a handle | Space down → down(0) on the rotate handle → moves → up → Space up | LEGACY and ROTATION: `handle-drag` (today's handle-first order); V2: `pan` (`space-drag`), the handle is not dragged |
| G4 Space then alt-tab | Space down → blur → later down(0) → drag | blur releases Space; the later drag is primary |
| G5 Stale Space | Space down → hidden → down(0) | `visibilitychange` clears Space; primary drag |
| G6 X11 autorepeat pairs | Space down, up, down in the same ms during a drag | pan continues (a keyup followed by keydown within 30 ms counts as repeat) |
| G7 V2 overview left drag | V2, mode overview: down(0) → moves → up | `drag-start` (band), not `pan` |
| G8 Pan tool under V2 | V2 and TOUCH, tool hand: pen tip drag; touch drag | `pan` (`primary-drag`) |
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
| I10 Esc during a drag, focus in the lens (0C) | left drag live; focus in the inspection lens panel; Esc | the drag aborts (capture step 4); the lens stays open |
| I11 F6 past a widget that stops propagation (0C) | focus inside the inspection lens; F6 | the next region takes focus (capture listener) |
| I12 Presenter scope inside its modal (0C) | story presenter open (modal layer held): ArrowRight; N | the next step; nothing |
| H23 Scale button owns its arrows (0C, again in phase 1) | focus the scale button (`ZoomControls.tsx:138-143`): Shift+↑ | the scale menu opens; the bearing is unchanged |
| H24 Held stamp turns with the switch off (0C) | single-key shortcuts off, map focused, Object stamp holding a pick: `]`; then focus the body: `]` | the pick turns +15° on the map; nothing on the body |
| H25 Arrows during a live drag | Select with a selection; a move-drag in progress: → | nothing: no nudge and no pan (today) |
| H26 The World map owns its arrows (1) | focus the World map canvas (`data-owns-keys="arrows"`): Shift+→, Shift+↑ | the workspace view neither turns nor resets; MapLibre's rotation is off (INV-CAM-46) |
| H27 F2 falls through to the shell (0C) | map focus with nothing selected: F2; map focus with one note selected: F2 | rename the Design (the port returns false, the row's `fallback` runs); edit the note |

### 5.9 Precedence

| Id | Sequence | Expect |
|---|---|---|
| J1 Left-drag never pans | select: drag; hand: drag | band; `pan` |
| J2 Shift+drag is not box zoom | down(0, Shift) → drag | additive band; never zoom |
| J3 Legacy overview | LEGACY, overview: drag; still right-click | `pan`; contextmenu prevented, no menu |
| J9 Space with the Pan tool | hand armed, Space held, drag | `space-drag` pan (same result) |
| J9b Pan tool press on a handle | hand armed with a selected zone; down(0) on a vertex handle → drag | LEGACY and ROTATION: `handle-drag` (today); V2: `pan` (`primary-drag`) |
| J10 Inspection probe order (runs in `tools/tool-host.test.ts`) | LEGACY, an inspection claiming presses: down(0) on a rotate handle; Space held, down(0) → drag; Polygon armed, down(0, Shift) on empty ground; overview, down(0) | the handle drags; `pan`; the probe claims the press and Polygon adds no corner; `pan`, no probe (today's order: handles, pan, probe, tool) |

## 6. Pitch readiness: what it costs now

Pitch, 3D and the globe are not built, but nothing now precludes them. The cost carried today is small and all type-level:
- `ViewCamera.pitchDeg` is the literal type `0`. The literal forbids a non-zero pitch today and flags only code that assigns `camera.pitchDeg` to something typed `0`; widening it changes no method's return type, so it does not list the consumers. That list comes from making `worldToScreen`, `visibleWorldQuad` and `visibleWorldBounds` nullable when pitch ships (last paragraph).
- `screenToWorld` returns `WorldPoint | null` (null only above a horizon); its five callers (ToolHost, overlays, fit, re-origin, drop) handle null.
- `metresPerPixelAt(p)` takes a point, because resolution varies across a pitched view.
- `planar.affine` is typed nullable; the renderer's projective world root is added with pitch, not as a seam now.
- Quads, not boxes, for visible areas, bands and handle anchors.
- `homographyViewTransform` is not declared (no ambient or stub export, which would compile and fail at runtime, and would be dead code); its signature is kept as a comment in `view-transform.ts` and in §1.1.
- The vertical travel of Shift+right-drag and Shift+middle-drag is ignored and kept free for tilt; Shift+↓ is reserved.

When pitch ships: widen `pitchDeg`, set `maxPitch`, solve the homography from four `unproject` samples (keeping `affine` when the projective correction moves no viewport point more than 0.01 px), make `visibleWorldQuad`, `visibleWorldBounds` and `worldToScreen` nullable or horizon-clipped and fix their callers, add a projective world root in the renderer, choose tilt bindings, and label the scale bar "at centre". Globe: `planar` becomes null and the methods fall back to per-point projection. The changes stay in `maplibre/`, `view/`, the renderer, `tools/tool-host.ts` (null handling) and `input/bindings.ts` (tilt).

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
- A new stored enum for Pointing device, a stored PDF setup, a four-corner saved-view extent, or any `.canopi`, user-DB, LiDAR catalogue or plant-catalog change.
- Performance gates and optimisation beyond making canopi-p32r and canopi-wx8w fixable (phase R), and the select-all and delete-all slowness (its own bead).
- Instanced billboard or screen-constant line shaders (they fit behind `setView` later).

## 8. Stored data

| Store | Change |
|---|---|
| `.canopi` | none. `SavedViewCamera.bearing` is now written (normalised); `extent` keeps its meaning, computed from four corners. Notes, rectangles and ellipses created rotated store the bearing in their existing `rotationDeg`. |
| Settings | `LastView.bearing`, `#[serde(default)]` 0: a one-line default, no migration; older builds ignore it. `scroll_wheel` values unchanged. |
| PDF | `PdfSetup.mapOrientation?` and `PdfPrintArea.rotationDeg?` (default 0), in memory only. |
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
