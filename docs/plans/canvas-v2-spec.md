# Canvas v2 specification: interfaces, bindings, rotation, strings

Trimmed 2026-10-02 at the phase-0 close (the full earlier text is at commit 76bd08a659d916069a340fc06e670e54e32f54c7) and 2026-10-03 at the phase-1 close (the text before it is at `da12600b`): §4.5, §4.11, §9.1 and §9.2, built and read by no later step, were deleted; section numbers are not reused, so code comments citing them resolve at that commit.

Status: agreed (2026-09-29); phase 0 and phase F built (2026-10-02); phase 1 built (2026-10-03); amended 2026-10-05 for U33 (rulers, ruler guides and the locked chip removed; key admission; no last-bearing fallback; required ground size), and 2026-10-06 for phase 2's design check and U34 (turns jump; the bearing-free floor; one `contextmenu` listener; one modifier source; the cut stage's rules), and for U36 (overview selects nothing; Shift steps only the rotate handle; the native-menu trail; key admission as built), and for U37 (Delete on a corner selects the next one; the trail follows a real chord and a lost secondary release), and for U38 (edge chips beside the midpoint dots; a wheel over a handle is a map wheel), and for U39 (no menu retarget, Cut or Delete during a gesture or tool transient), and for U40 (only a still press selects a corner), and for U41, phase 3's design check (the recogniser holds every touch press; `Bindings` deleted; touch handles, feel values and phone chrome); 2, 3 and R build on it per docs/plans/canvas-v2-plan.md

This is the contract the canvas v2 work is built to. The phases, owners, gates and bead mapping are in `docs/plans/canvas-v2-plan.md`; what exists today and what happens to each piece is in `docs/plans/canvas-v2-inventory.md`. The reasons live in the ADRs: 0015 (rotating map and canvas controls; amends ADR 0010's control and shortcut rules), 0016 (one view transform), 0017 (input pipeline and gestures), 0018 (narrow tool interface), 0019 (rendering and the view transform), 0020 (focus and keyboard ownership). Delete this file with the plan at the 2.0 release close.

Paths are relative to `desktop/web/src/` unless they start with `docs/`, `common-types/` or `desktop/`. `view/`, `input/`, `tools/`, `renderers/`, `chrome/`, `scene-runtime/` and `interaction/` are short for `canvas/runtime/<dir>/`; bare `key-chord`, `keymap`, `escape-chain`, `arming`, `focus-owner` and `key-router` modules and tests are under `app/keyboard/`; `maplibre/` is `src/maplibre/`.

## 0. Notation

- **(user)** marks a user decision (2026-09-29). **(convention)** marks a planner convention the user may overturn; the plan lists them for confirmation. **(spec)** marks a detail this specification settles that the design left implicit; the plan's handoff lists these too.
- **mod** is Cmd on macOS and Ctrl elsewhere. On macOS a physical Ctrl is never mod: from phase 2 it turns a left click into a right click, and Ctrl+arrows belong to Mission Control.
- **Phases.** All phases ship together as 2.0 (user, 2026-10-01). There is no bindings constant: phase 2 hard-coded its final behaviour and phase 3 deletes `Bindings` (A7, U41), so touch behaviour is unconditional and the drag slop is a threshold (§1.2). In this document LEGACY names the behaviour before phase 1 (phase 0's with F's hover end and 3 px slop), ROTATION from phase 1, V2 from phase 2 and TOUCH from phase 3. These are names of expectation columns, never constants: each phase rewrites the expectations it changes in place. "From 1" means the behaviour exists from that phase on; a cell without a phase is unchanged from today.
- **Decisions of 2026-10-01** (user; plan §1): one release; no second-button navigation during a drag; one map angle for the whole PDF layout; no edge highlight; a panel drag hides the tool's preview; the hover end lands in F; the keyboard is built once, in F; LiDAR's Return to Design keeps the exact view.
- **Free gesture**: a rotation whose end angle the user did not choose exactly (pointer rotate drag, compass drag, touch twist, trackpad twist). **Explicit target**: a bearing Canopi was told (key step, reset, "Turn view to this edge", a saved view, a story step, the view a file was saved with, `map_view`).
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
  /** Unit world vectors of screen-right and screen-down: one pair for the whole plane (the camera has no pitch). */
  screenAxesInWorld(): { readonly right: WorldVector; readonly down: WorldVector }

  visibleWorldQuad(insets?: ScreenInsets): WorldQuad
  /** Four projected corners, never two (rotation-handle anchor, menu anchor). */
  worldQuadToScreen(q: WorldQuad): readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint]

  readonly pixelsPerMetre: number            // at the plane origin: today's `viewport.scale` (zoom bands, policy)
  readonly northUp: boolean                  // angularDistanceToNorth(bearing) < 0.05° and pitch 0
}

/** Everything the runtime publishes per camera change. Runtime-only (policy P10). */
export interface ViewFrame {
  readonly view: ViewTransform
  readonly mode: 'site' | 'overview'         // overview below 0.1 px/m (canvas/workspace-camera-policy.ts)
  readonly scaleBounds: { readonly min: number; readonly max: number }   // the effective bounds: policy zooms with the bearing-free single-world floor (constrainCamera)
  readonly insets: ScreenInsets              // from the visible-map-area seam
  readonly attached: boolean
  readonly moving: boolean                   // gesture, rotation session or flight in flight
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
  /** snapBearing: within 7° of north jumps to 0 about the session pivot; else keeps. */
  end(): void
  /** Restores the full starting ViewCamera with animation 'none' (Esc during a rotate). */
  cancel(): void
}

/** What app code and components may observe. Each signal changes only when its own value changes. */
export interface ViewReadSurface {
  readonly mode: ReadonlySignal<'site' | 'overview'>
  readonly zoomBand: ReadonlySignal<number>              // floor(log(pixelsPerMetre) / log(1.25)): LOD key
  readonly bearingDeg: ReadonlySignal<number>            // rounded to 0.1° (compass needle, PDF "As on screen")
  readonly northUp: ReadonlySignal<boolean>              // the compass's turned state and label; never hides the compass
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
   * not the settled one), and the screen it was seen on. User-triggered captures record what
   * is on screen now, so a capture within 150 ms of a pan, zoom or key pan, or during a flight, never records the previous
   * camera. The last view (settings) keeps `settledCamera`.
   */
  captureView(): { readonly camera: ViewCamera; readonly screen: ViewScreen }
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
   *  name as a call. It fits the box's four corners at the bearing, so every match stays framed (no circle fit: phase-1 drop). */
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

**How the view surfaces meet the session surfaces (§1.1a).** `ViewCommandSurface` is `CanvasCommandSurface.viewport` (`canvas/runtime/runtime.ts`); `ViewReadSurface` is `CanvasQuerySurface.view`. `CanvasQuerySurface.subscribePointerWorld` forwards `ToolHost.subscribePointerWorld` (the world and screen point, R1, so a hover readout over analysis results can call `queryRenderedFeatures` while P2 stays strict); the inspection lens component uses it instead of a map-host `pointermove`. The lens handle (`canvas/inspection.ts`) publishes `sourceQuad`, the lens footprint's four screen corners on the main map; phase 1's hand-off commit renames its `panBy(delta)` to `panByScreen(deltaPx: InspectionPoint)`, which View turns into ground at the lens's bearing (INV-WR-17, INV-KEY-21): the lens window moves by `deltaPx` in preview pixels, and a drag passes its start minus the current point. `CanvasOverview.tsx` places the overview pin from `ViewReadSurface.designPin`. App code (`app/**`, `components/**`, `web/**`) uses only these two surfaces, except `workspace-runtime-composition.ts` and `workspace-activation.ts`, which wire the driver host directly (Attachment, below); `ViewFrameSource` stays inside `canvas/runtime/**` and `maplibre/**` (P10).

**Resize.** One owner changes the screen size: the MapLibre driver calls `map.resize()`, re-runs `constrainCamera` (the zoom floor depends on the screen size only, §4.14) and publishes one frame; the World map (no driver, exempt from P1) resizes itself. `setScreen` is a no-op when the size is unchanged. The runtime's two resize entries call the live driver's `setScreen` (`cameraHost.current().setScreen`) with `window.devicePixelRatio`. P1 forbids `resize` on a map outside the driver.

```ts
// canvas/runtime/view/camera-driver.ts  (types)

export type CameraMove =
  /** deltaPx is content movement: the ground under the pointer moves by deltaPx. New centre = unproject(screenCentre − deltaPx). */
  | { readonly kind: 'pan-by'; readonly deltaPx: ScreenPoint }
  | { readonly kind: 'zoom-around'; readonly anchorPx: ScreenPoint; readonly factor: number }
  /** Keep the ground under anchorPx fixed while the bearing changes; the centre is an output. Every turn jumps (U34). */
  | {
      readonly kind: 'rotate-around'
      readonly anchorPx: ScreenPoint | 'centre'
      readonly bearingDeg: number
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
  /** The bearing a running flight will end at, else the live bearing. */
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
  /** Default WORKSPACE_MAP_MAX_ZOOM: a test lowers it to compare both drivers at the zoom-in clamp. The navigation policy's
   *  reference latitude is options.plane()'s, rebuilt once per plane. */
  readonly maxZoom?: number
  readonly reducedMotion: ReadonlySignal<boolean>   // from phase 1 a live matchMedia signal from app/canvas-runtime/app-adapter.ts
  readonly plane: () => SessionPlane
  readonly screen?: ViewScreen
  readonly camera?: ViewCamera
  readonly insets?: ScreenInsets
}
export interface CameraDriverHostController extends CameraDriverHost { dispose(): void }
export function createCameraDriverHost(options: CameraDriverHostOptions): CameraDriverHostController
```

**Attachment** (`app/canvas-map-surface/workspace-activation.ts`). The activation builds each map's `MapLibreCameraDriver` and calls `attach`/`detach`, and subscribes to `CameraDriverHost.failure` to report the map as unavailable. Map notices (U22, C4, C5; 2.0 bug fixes, canopi-0p2n) use fixed localized strings, never engine text, from one shared component in both editions. A lost WebGL context reads "The map stopped drawing. Your Design is safe." with Retry; Retry rebuilds the map and keeps the view, selection and undo, can be pressed any number of times, and nothing restarts on its own. Without WebGL2, or when the renderer init destroyed the runtime, "Map unavailable" stays with no Retry. A failed basemap download reads "Basemap couldn't load. Check your connection." with Retry in the map's status chip, until the basemap loads, is hidden or Satellite is chosen; it ranks below a map error and above a skipped layer. A rotated camera is never a failure; a read-back pitch other than 0 is (`'map-error'`). The composition and the activation are the only two app modules that touch the driver host directly (P10 allows their type-only import of `camera-driver.ts`); everything else goes through the two surfaces above. The runtime builds its one host in `scene-runtime/construction.ts` (`SceneCanvasRuntime.cameraHost`) and follows the Scene's plane itself, through one plane effect there.

**Driver rules** (ADR 0016, amended 2026-09-30). `MapLibreCameraDriver` and `HeadlessCameraDriver` both implement `CameraDriver` with the same `camera-math` and `constrainCamera`, and both build their frames with `buildViewTransform` from a geographic `ViewCamera`: the MapLibre driver's is MapLibre's own camera, the headless driver's its own; `view/camera-contract.test.ts` holds the transform to MapLibre's (1e-6 px), and tests compare with `toBeCloseTo`. The MapLibre driver is the only code that calls camera methods on the workspace and snapshot maps, always with explicit `jumpTo`/`flyTo` values; each publishes one frame from the read-back camera (bearing normalised to [0, 360)). A `CameraDriver.apply` made mid-dispatch is queued and applied once, after every listener ran. The map stays `interactive: false`, `dragRotate: false`, `touchZoomRotate: false`.

| Move | Driver work | MapLibre call |
|---|---|---|
| `pan-by` | `panCamera` | `jumpTo` |
| `zoom-around` | `zoomCameraAround` | `jumpTo` |
| `rotate-around` | `rotateCameraAround` | `jumpTo` |
| `set` / `none` | `constrainCamera(target)` | `jumpTo` |
| `set` / `fly` | `constrainCamera(target)` | `flyTo({ center, zoom, bearing })` |

The map's `transformConstrain` is an adapter over `constrainCamera`, which needs no bearing (U34), so the driver keeps no arc state. There are no bearing tweens: every turn is one `jumpTo` (U34; `bearing-tween.ts` and both animation-frame loops are deleted). A flight is stopped by any other move, and the interrupting `jumpTo` carries the flight's target bearing.

```ts
// canvas/runtime/view/navigation-policy.ts  (pure; shared by both drivers)

/**
 * Built by createNavigationPolicy(referenceLatitudeDeg, reducedMotion) from the workspace camera's limits
 * (canvas/workspace-camera-policy.ts: pure, and P4 lets view/ import it). The reference latitude turns zooms into px/m (scaleBoundsAt →
 * ViewFrame.scaleBounds).
 */
export interface NavigationPolicy {
  readonly referenceLatitudeDeg: number    // the session plane's latitude (the host's, rebuilt once per plane)
  readonly minZoom: number                 // 0
  readonly maxZoom: number                 // 27
  /** prefers-reduced-motion: reduce, a live matchMedia signal made in app/canvas-runtime/app-adapter.ts, declared on canvas/runtime/app-adapter.ts and
   *  passed to createCameraDriverHost; app/saved-views/current-view.ts reads the same source. view/ never calls matchMedia (P4). Flights become jumps while true. */
  readonly reducedMotion: ReadonlySignal<boolean>
}

/**
 * Clamp zoom to [max(policy.minZoom, worldZoomFloor(screen)), policy.maxZoom], then hold the screen centre at least half the
 * screen diagonal (in px at that zoom) inside one world: latitude inside ±85.05° and longitude inside ±180°. Bearing-free (U34): the
 * floor and the hold cover the viewport at every bearing, so a turn never changes them. It replaces all of MapLibre's
 * defaultConstrain (setConstrainOverride replaces the zoom range and the longitude hold too). Idempotent. The floor depends on the
 * screen only, never on the centre, because MapLibre calls the guard on intermediate (old centre, new zoom) states.
 */
export function constrainCamera(camera: ViewCamera, screen: ViewScreen, policy: NavigationPolicy): ViewCamera
export function createNavigationPolicy(referenceLatitudeDeg: number, reducedMotion: ReadonlySignal<boolean>): NavigationPolicy
/** ViewFrame.scaleBounds: the policy's zoom range with the world floor, in px/m at the reference latitude. */
export function scaleBoundsAt(screen: ViewScreen, policy: NavigationPolicy): { readonly min: number; readonly max: number }
/** The world floor: log2(hypot(width, height) / 512), so the screen diagonal never exceeds one world (U34). */
export function worldZoomFloor(screen: ViewScreen): number

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
```

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
  /** Opening a Design: the camera it was saved with (`saved`, from `map_view`, already framed for this map) or else the oriented
   *  fit at the given bearing; an empty scene opens on the north-up fit either way (§4.15). Every open path calls it through
   *  document-surface.ts's open fit; Fit to Design stays zoomToFit. */
  openAt(bearingDeg: number, saved?: ViewCamera | null): void

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
  /** The host's zoom-in limit; default WORKSPACE_MAP_MAX_ZOOM. */
  readonly maxZoom?: number
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
export function detectPlatform(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>, win: { readonly GestureEvent?: unknown }): InputPlatform
// iPadOS is 'ios': a Macintosh user agent with maxTouchPoints > 1 (GeoLibre isIpadDesktopUserAgent, attributed; phase 3, A8).
// Called by platform/desktop.ts and web/browser-shell-commands.ts for KeyRouterDeps.platform, and by interaction-session.ts
// when its deps carry none. Injected everywhere else.

// No bindings constant (deleted in phase 3, A7; P11 tombstones `Bindings`, `CURRENT_BINDINGS`, `DomInputSourceDeps.bindings`,
// phase 2's `PanContext` and F's `LEGACY_BINDINGS`). Phase 2 hard-coded its final fields (A19); phase 3 makes touch unconditional and moves the drag slop
// into Thresholds. F1's gesture rows are a static list with three platform notes (Linux pinch, Mac Control-click, the pen button; §9.3)
// and the Touch section (§9.4), not generated from bindings (audit 1.7).
```

Primary slop compares `d >= slop && d > 0`: mouse and pen 3 px (U6, user 2026-10-01; MapLibre's click tolerance), so a click with a little jitter stays a click, and touch 8 px (phase 3). Secondary slop is 3 px. Every tool takes `tap` and `drag-end` from the recogniser's slop: Plant a row's own 4 px rule went in phase 2's cut stage (U33, P29), and phase 3 deletes the band's and point handles' 2 px release checks (A9), so the slop alone tells a tap from a drag. A handle tap ends its handle drag at the press point, so a jitter within slop moves nothing.

```ts
// canvas/runtime/input/thresholds.ts  (plain numbers; tests may pass others)
export interface Thresholds {
  readonly dragSlopPx: Readonly<Record<PointerKind, number>>        // mouse 3, pen 3, touch 8 (from Bindings in phase 3, A7); the compass reads it (U17)
  readonly longPressMs: number               // 500
  readonly multiClickMs: number              // 500: a primary press this soon after the last one counts as its next click
  readonly multiClickSlopPx: Readonly<Record<PointerKind, number>>  // and this close to it: 6, touch 30 (MapLibre tap_recognizer MAX_DIST; U41)
  readonly twistStartArcPx: number           // 25 px of arc over the smallest finger diameter seen (MapLibre _isBelowThreshold, BSD-3; A12)
  readonly pinchZoomStartLevels: number      // 0.1: a touch pinch zooms only past this zoom-level change (MapLibre defaultZoomThreshold; U41)
  readonly trackpadTwistStartDeg: number     // 10: WebKit gesture rotation before any rotate is emitted
}
export const DEFAULT_THRESHOLDS: Thresholds

// canvas/runtime/input/raw-input.ts  (PointerKind, Modifiers, ToolId, ToolHandleId, CanvasDropPayload come from ../interaction-types.ts, §1.2a)
export type ButtonRole = 'primary' | 'secondary' | 'auxiliary'

/** What was under the pointer at a down, a move or an up (a hover carries it, §1.3), classified by the source from data attributes. */
export type TargetClass =
  | { readonly kind: 'surface' }                                   // host or [data-canvas-surface]
  | { readonly kind: 'handle'; readonly id: ToolHandleId }         // [data-canvas-handle] in the handle layer
  | { readonly kind: 'owned-chrome' }                              // MapLibre controls in the host (.maplibregl-ctrl: the attribution, from F); any other button, input, select,
                                                                   // [contenteditable] or [data-preserve-overlays] in the host (the inspection lens's skip set)
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
  | At & { kind: 'wheel'; at: ScreenPoint; dxPx: number; dyPx: number; mods: Modifiers; target: TargetClass }
  | At & { kind: 'platform-gesture'; phase: 'start' | 'change' | 'end'; at: ScreenPoint; rotationDeg: number }
  | At & { kind: 'key-state'; space: boolean; mods: Modifiers }               // from the KeyRouter
  | At & { kind: 'escape' }                                                   // from the Esc chain's 'gesture' layer
  | At & { kind: 'drop'; phase: 'over' | 'leave' | 'drop'; at: ScreenPoint; payload: CanvasDropPayload }
  | At & { kind: 'configure'; context: { readonly tool: ToolId; readonly mode: 'site' | 'overview'; readonly pointingDevice: 'mouse' | 'trackpad' } }
  | At & { kind: 'tick' }

export interface RecogniserConfig {
  readonly platform: InputPlatform
  readonly thresholds: Thresholds
}

/** Applied by the source to the event it is handling. 'stop-propagation' (stopImmediatePropagation) and 'drop-effect' come from
 *  a GestureOutcome (§1.2a): a quarantine is 'prevent-default' plus 'stop-propagation'. */
export interface AdapterEffect {
  readonly kind: 'prevent-default' | 'stop-propagation' | 'capture' | 'release-capture' | 'disown' | 'set-timer' | 'clear-timer' | 'drop-effect'   // 'disown': a session ended with its release lost (§2.2 "Drag end"); the source stops following the pointer
  readonly pointerId?: number
  readonly atMs?: number
  readonly dropEffect?: 'copy' | 'move' | 'none'                // 'drop-effect': dataTransfer.dropEffect on dragover and drop
}
/** Opaque to callers; the recogniser owns its shape. Plain data (structured-clone safe), so the property test can snapshot it. */
export interface RecogniserState {
  readonly sessions: ReadonlyMap<number, PointerSession>        // by pointerId: pointer kind, role, mode ('pending' | 'primary' | 'pan' | 'rotate'), start, last point, slop passed, capture held
  readonly touchPair: TouchPair | null                          // two touch ids, their last points, the smallest diameter seen, whether the twist is active (A12)
  readonly held: { readonly space: boolean }                    // the only gesture-state record of a held key (ADR 0017)
  readonly trackpadTwistDeg: number                             // WebKit gesture rotation accumulated before the 10° threshold
  readonly deadlines: { readonly longPressAt: number | null }
  readonly context: { readonly tool: ToolId; readonly mode: 'site' | 'overview'; readonly pointingDevice: 'mouse' | 'trackpad' }
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
    | 'wheel' | 'gesturestart' | 'gesturechange' | 'gestureend' | 'dragover' | 'dragleave' | 'drop'
  readonly timeStamp: number
  readonly clientX: number; readonly clientY: number          // converted to host-relative CSS px by the source before normalise
  readonly pointerId?: number; readonly pointerType?: string; readonly button?: number; readonly buttons?: number; readonly detail?: number
  readonly shiftKey: boolean; readonly ctrlKey: boolean; readonly altKey: boolean; readonly metaKey: boolean
  readonly deltaX?: number; readonly deltaY?: number; readonly deltaMode?: number
  readonly rotation?: number                                    // WebKit GestureEvent (its scale is never read: the pinch arrives as Ctrl+wheel)
  readonly target: TargetClass                                  // classified by the source from data attributes
  readonly dropPayload?: CanvasDropPayload                      // drag events: read by the source from dataTransfer
}
export function normalise(e: DomEventLike, platform: InputPlatform,
  host: { readonly width: number; readonly height: number }): RawInput | null   // host: CSS px, for page-mode wheels
```

Stages: `DomInputSource` (the only DOM listener owner for canvas input, including the one document-capture `contextmenu` listener (§2.2 "Native menu") and, from phase F, the copied GeoLibre selection-drag guard) → `normalise` → `recognise` → `InputRouter` (navigation to `ViewNavigation`; menu requests, editing and drops to the `ToolHost`, the only opener of the context-menu port; a pointer-source pan's `at` to `ToolHost.notePointer`, §1.4 "Re-emit"). The router computes no geometry.

The way back: `route` returns the host's `GestureOutcome` (§1.2a); the source applies `quarantine` as `prevent-default` plus `stop-propagation`, `dropEffect` as `drop-effect`, and `rejectSession` by skipping the press's capture and feeding the recogniser `{ kind: 'reject', id }` (its later moves are hovers). A tool call that throws follows the host's fault rule (§1.4 "Faults"); the next press is still admitted. A sink that throws on a map-host press quarantines that event then rethrows; on any other event it rethrows and the event goes on. Every raw pointerdown also reaches `ToolHost.rawPress(button)` before routing (§1.4 "Raw presses"), so presses the host never sees as gestures still commit the nudge series, close the canvas menu and focus the map, for every button (phase 2). See `input/dom-input-source.ts` and its tests for the exact fault matrix.

The source has no key listeners: the key router (§1.6) owns them and feeds the canvas through `CanvasKeyboardPort` (F). Host `pointerleave` becomes `leave`, `focusout` becomes `focus-out`, window `blur` becomes `cancel('all', 'blur')`. Window `pointermove`/`pointerup`/`pointercancel` capture listeners exist only while a session is owned; a host `pointermove` carries hover moves (F).

Normalisation rules:
- Mouse `button` 0/1/2 → primary/auxiliary/secondary; 3 and 4 dropped. Pen tip → primary; barrel (2) → secondary (phase 2); eraser (5) dropped. Touch → primary in every phase. These drop presses only: an `up` is never dropped, and one whose button no press takes (a mouse's 3 or 4, a pen's eraser) is a primary `up`, so it ends its pointer's session whatever the button, as today's pointerup did (a pen drag whose tip lifts before its barrel commits).
- On `os: 'mac'` (phase 2), mouse button 0 with `ctrlKey && !metaKey` becomes secondary with `ctrlConsumed: true`. For that session the recogniser ignores `ctrl` in `move` mods and `key-state` (`ctrlConsumed` may also key §2.2's drag end on the physical bit).
- Wheel `deltaMode` is read before the deltas (16 px per line; a page is the host width for `deltaX` and the host height for `deltaY`). A wheel with `ctrlKey`, a trackpad pinch or a physical Ctrl+wheel alike, zooms continuously like any wheel (P14): no pinch flag, no physical-Ctrl record and no notch detection.
- Targets are classified from data attributes and selectors; from F the MapLibre attribution inside the host is `owned-chrome` through `.maplibregl-ctrl` in `OWNED_CHROME_SELECTOR` (no element carries `data-canvas-chrome`). The zoom group, compass, tool card and rail sit beside the host, so their presses are `foreign`.

### 1.2a Shared vocabulary and interaction ports (`canvas/runtime/interaction-types.ts`, `interaction-ports.ts`)

Input and tools share a vocabulary; neither may import the other (P5). Both import `interaction-types.ts`, whose only type-only imports are the two drag-payload types used by `CanvasDropPayload`; a later type may also import from `view/types.ts` or `scene/types.ts`, and nothing else. `interaction-ports.ts` types the composition and may import types from any runtime module (no tool module imports it), each import naming the type's defining module, never a barrel. Only `tools/tool-host.ts` (exempt from P5), `input/input-router.ts`, `input/dom-input-source.ts`, `interaction-session.ts` and `keyboard-port.ts` import it; D2–D4 and the lens depend on `ToolHost` through this file, not through `tool-host.ts`.

```ts
// canvas/runtime/interaction-types.ts  (types)
export type PointerKind = 'mouse' | 'pen' | 'touch'
export interface Modifiers { readonly shift: boolean; readonly ctrl: boolean; readonly alt: boolean; readonly meta: boolean }
export type CancelReason = 'pointercancel' | 'lost-capture' | 'blur' | 'hidden' | 'escape' | 'multitouch' | 'tool-change'
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
  readonly host: HTMLElement                                    // the map host; listeners attach here, and on window only during an owned session
  readonly platform: InputPlatform
  readonly clock: () => number
  readonly timers: { set(atMs: number, cb: () => void): number; clear(id: number): void }   // a set-timer waits atMs minus the last delivered input's t (A1)
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
    readonly screen: ScreenPoint | null
    readonly turnViewToEdge?: () => void                        // phase 1: a zone-edge hit within the source's tolerance (§4.16); no edge highlight (U4)
    readonly finishShape?: () => void                           // phase 2: set while the active tool's canFinish?() is true; runs ToolHost.command({ kind: 'confirm' })
    readonly holdsSelectionDeletes?: true                       // U39: the host's re-origin hold at the open; the menu disables Cut and Delete
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
  readonly renderer: Pick<SceneRenderer, 'setDraft' | 'setSelectionPreview'>
  /** Redraw request after a tool call that mutated an open transaction or changed its draft or handles. */
  readonly invalidate: () => void
  readonly chrome: {
    setHandles(h: readonly ToolHandle[], active: ToolHandleId | null): void; setCursor(c: string): void
    requestTextEntry(r: TextEntryRequest, submit: (text: string) => 'close' | 'keep', onCancel?: () => void): void; closeTextEntry(): void
    /** Discards the open entry and calls its onCancel, as its own Esc does: entering overview with a commit refused (B5). */
    cancelTextEntry(): void
    /** Submits an open entry that no longer holds focus (its blur commit was refused), which the map taking focus cannot
     *  blur again; an entry that holds focus is left to that blur. A press or a menu calls it before focusing the map. */
    submitUnfocusedTextEntry(): void
    /** Today's hasActiveEditor(), read live wherever the host needs the entry's state (handles hidden while it is open, the
     *  re-origin hold); the host keeps no flag of its own. Esc in the entry stays the
     *  entry's own element handler, which calls the request's onCancel once the entry is gone. */
    isTextEntryOpen(): boolean
    setTooltip(t: { readonly at: ScreenPoint; readonly lines: readonly string[] } | null): void   // chrome/hover-tooltip.ts; this shape from phase R
    // R2: the tooltip takes lines of text, a plant under the pointer winning over a layer readout, so analysis readouts reuse it
  }
  readonly menu: ContextMenuPort                                // opened only by the host (menuAt)
  readonly focus: CanvasFocusPort                               // ToolEffects.requestFocus
  readonly guidance: (g: Partial<CanvasToolGuidance> | null) => void
  readonly toolState: { readonly active: ReadonlySignal<ToolId>; set(id: ToolId): void }   // the session's tool signal
  readonly settings: ToolSettingsPort
  /** Settings › Canvas: Snap to grid, read at each point (interaction-session.ts wires the runtime settings adapter's
   *  readSnapToGridEnabled); the shape tools/snapping.ts takes. No Snap to guides (U33). */
  readonly snapping: () => { readonly grid: boolean }
  readonly translate: ToolContext['translate']
  /** "Turn view to this edge" (§4.16); added by phase 1's hand-off commit. */
  readonly navigation: Pick<ViewNavigation, 'turnToEdge'>
  // Modifier resolution needs no bindings or platform (§2.3): a Mac Ctrl press never reaches a tool.
  /** Today's deps.nudge (the runtime's scene-edit commands); the host owns the series (nudge below). */
  readonly nudge: Pick<CanvasSceneEditCommandSurface, 'nudgeSelected' | 'endNudge'>
  readonly timers: { set(atMs: number, cb: () => void): number; clear(id: number): void; readonly clock: () => number }
  /** Hover restyle (a directly locked object shows the locked hover stroke): today's deps.setHoveredTarget. */
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
  /**
   * Presses the host never sees as gestures: the session calls it for every raw pointerdown on the map host before routing it
   * (from the source's raw input, not a gesture; the down's role, 'auxiliary' as 'middle'). Commits the nudge series for any
   * button. For an admitted press of any button outside the text entry ('owned-text'), with no live press from another
   * pointer id, it also closes the canvas menu and focuses the map (so an open text entry commits on its blur; phase 2: every
   * button, so a double right-click replaces the menu).
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
  /** True while a note's text entry is open (one mode, phase 2). The keyboard port's Space hold reads it: an open entry,
   *  focused or not, arms no pan (§1.4 "Releases"). */
  textEntryOpen(): boolean
  /** The re-origin hold (§4.19): a live press, the active tool's transient or an open text entry. */
  holdsReorigin(): boolean
  // Esc chain queries (CanvasKeyboardPort reads these)
  hasLiveGesture(): boolean
  /** The active tool holds a transient its Esc drops first (none whose tool `escapeLeaves`: Place plants' waiting point). */
  activeToolHasEscapeTransient(): boolean
  activeToolIsSelect(): boolean
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
   * Space and ends the live sessions): commits the nudge series, clears the passive hover and the tooltip, calls the active tool's cancelTransient('navigate') (a tool that keeps its draft through a pan keeps it
   * here too) and resets the cursor to the tool's. A tool call that throws follows the fault rule (§1.4 "Faults").
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
   *  (the pointer left the map; from F also a move over owned chrome, the text entry or a handle). A hover over owned
   *  chrome or anything off the map publishes nothing, and a move over the text entry or a handle emits no gesture before F, so the lens keeps its point there, as today's
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
  spaceHeld(): boolean                       // the recogniser's held.space, the one record (ADR 0017)
  setHeldKeys(state: { readonly space: boolean; readonly mods: Modifiers }): void   // the recogniser's key state and the navigation cursor
  escapeGesture(): void                      // the recogniser's 'escape': cancels a live pointer session, releases Space
  requestTool(id: ToolId): void              // the Esc chain's Select (the runtime's setTool, as a tool's own request)
  clearSelection(): void                     // the Esc chain's last step: history-free, redrawn
}
export function createCanvasKeyboardPort(deps: CanvasKeyboardPortDeps): CanvasKeyboardPort
// No physicalCtrl, releaseKeys or keyboard-menu echo record (P14, P2): modifiers are read from the event that carries them.
```

Since F (§1.6; no legacy rebuild, U7) the key router feeds `CanvasKeyboardPort` in the target form: `keyState` first for every key, then the keymap's canvas rows through `command()` and the canvas Esc layers; the router applies the single-key gate (`KeyRouterDeps.singleKeys`) and the port the state gates (pointer session, overview, Select). An arrow still asks `ToolHost.nudge` first (never while a pointer session is live, fixture H25) and falls through to the arrow rule (§3.6) on `'pass'`. `workspace-runtime-composition.ts` exposes a forwarding `keyboard` port that reaches the session's port once `runtime.init` creates it.

### 1.3 Gestures (`canvas/runtime/input/gestures.ts`)

```ts
export type NavigationSource =
  | 'secondary-drag' | 'auxiliary-drag' | 'space-drag' | 'primary-drag'   // primary-drag: the Pan tool
  | 'wheel' | 'trackpad-twist' | 'touch-two-finger'                         // a pinch is a 'wheel' (P14)

export type MenuSource = 'mouse' | 'long-press' | 'keyboard'   // every pointer menu (right, Mac Ctrl+click, pen barrel) is 'mouse', 8 px
// CancelReason, PointerKind, Modifiers, ToolHandleId, CanvasDropPayload: from ../interaction-types.ts (§1.2a); TargetClass: from ./raw-input.ts (§1.2)

export type PressTarget =
  | { readonly kind: 'surface' }
  | { readonly kind: 'handle'; readonly id: ToolHandleId }

export type Gesture =
  // editing: primary role only; the ToolHost converts to world space
  /** target: the class the recogniser saw under the pointer; the host publishes to subscribePointerWorld only for 'surface'. */
  | { kind: 'hover'; at: ScreenPoint; pointer: PointerKind; mods: Modifiers; target: TargetClass }
  | { kind: 'hover-end' }
  | { kind: 'press'; id: number; at: ScreenPoint; pointer: PointerKind; mods: Modifiers; clickCount: number; target: PressTarget }
  /** The host takes a tap's and a drag's start point, pointer kind and handle from its own live press (the `press` carries the target). */
  | { kind: 'tap'; id: number; at: ScreenPoint; pointer: PointerKind; mods: Modifiers; clickCount: number }
  | { kind: 'drag-start'; id: number; at: ScreenPoint; mods: Modifiers }
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

`hover-end` comes from `leave`, and from F also from a button-less move over owned chrome, the text entry or a handle (U6); before F such a move emits nothing or an ordinary `hover` (§2.2 "Hover"). A `hover` carries the target class the recogniser saw, so the host feeds `subscribePointerWorld` only over the map (§1.4 "Hover"); a pointer-source `pan` carries the pointer's screen point, so the router can move the host's resting pointer (§1.4 "Re-emit"). A `cancel('navigate')` ends a Pan-tool press whose drag panned (§2.2 "Primary"). Under LEGACY `clickCount` is the platform's pointerdown `detail` as delivered (0 in jsdom), never counted by the recogniser, so a double-click selects a species only when the platform says so, as today; Select keeps its own 500 ms / 6 px note-edit rule. A `drop` reaches the host's shared drop handler, not the active tool (§1.4).

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

/** Modifiers by meaning, resolved by the ToolHost from the event's own flags, with no platform dependency (§2.3, ADR 0017). */
export interface ToolModifiers {
  /** Toggle into the selection: Shift, Ctrl or Cmd (Meta). */
  readonly additive: boolean
  /** Remove from the selection: Alt (phase 2). */
  readonly subtractive: boolean
  /** Shift: Polygon, Plant a row, Line and Measure 45° screen steps; Rectangle and Ellipse square and circle (phase 2); handle drags (the rotate handle's 15° steps from the press angle). */
  readonly constrain: boolean
  /** Plant a row only: Ctrl or Cmd held (phase 2, every OS). */
  readonly noSnap: boolean
}

export interface ToolPoint {
  readonly world: WorldPoint       // raw plane metres (for a tool with clampsToView, from the screen point clamped to the view)
  /** world snapped to the grid without the constraint: Polygon's close test under LEGACY (today snap(raw)). Equals world when snap is off. */
  readonly free: WorldPoint
  /** world after the tool's constraint (CanvasTool.constraint, Shift): 'direction' turns origin → point to the step and keeps the length; 'rotation-delta' turns the point about the pivot so the angle since the press is a step multiple. Equals world when none applies. */
  readonly constrained: WorldPoint
  /** The grid on world axes (user; no ruler guides, U33). Order per §2.3, one for every tool from phase 2: constrain, then round the length along the ray to the grid interval. Equals constrained when snap is off, noSnap is held or the constraint is 'rotation-delta'. */
  readonly snapped: WorldPoint
  readonly modifiers: ToolModifiers
  readonly pointer: PointerKind
}

/** What a hit query returns: a design object, or a part of one. */
export type HitTarget =
  | { readonly kind: 'object'; readonly target: SceneDesignObjectTarget }                          // scene/design-object-targets.ts
  | { readonly kind: 'zone-edge'; readonly zoneId: string; readonly edgeIndex: number; readonly distancePx: number }
/** No filter is today's hitTestTopLevel exactly: interactive layers, a group as the top-level target, guides, the revealed
 *  (selected or hovered) note, and object-locked objects, which the caller rejects itself (Select selects them; Unlock is in the canvas menu and Edit, U33). */
export interface HitFilter {
  /** Select only (phase 2, canopi-f47t.2): when nothing else hits, the topmost zone whose fill
   *  contains the point (pointInPolygon; rectangle and ellipse polygons). Plain hitAt callers are unchanged. */
  readonly fill?: true
  /** hitAt: also locked layers that are visible (hitTestVisibleTopLevel, the host's hover). hitInQuad throws a clear error
   *  (the band select skips locked layers). */
  readonly includeLocked?: boolean
  /** hitAt only: answers only the nearest zone edge within this many CSS px ("Turn view to this edge", §4.16), converted at the
   *  frame's pixelsPerMetre. A band has no tolerance (the object hit tests carry their own). */
  readonly toleranceScreenPx?: number
}
/** The selection read model: CanvasDesignObjectSelectionModel (canvas/runtime/runtime.ts), with `plantNamePinning` required; an empty
 *  selection reads the one frozen EMPTY_SELECTION_MODEL (scene-runtime/selection.ts), as does the host's disabled menu. */
export type SelectionReadModel = CanvasDesignObjectSelectionModel
/** Layer names as stored (SceneLayerEntity.name): 'plants', 'zones', 'annotations', 'measurements', … A `string`; narrowing it
 *  to the known names is a later, optional change. */
export type SceneLayerKind = SceneLayerEntity['name']
/**
 * A preview of what a placement would create, drawn with the draft by the scene's own drawing code (plan §4, "Conventions still in force").
 * The entities are already where a click would put them: the tool builds the plant as a click would (plantEntityFromStampSource),
 * and a stamp tool draws the template a press would add: `stampTemplateAt(template, anchor, at, degrees)` (tools/stamp-rotation.ts)
 * turns it about the stamp's anchor, then moves it by at − anchor; the placement adds that same template. The tool card reads the
 * held turn from guidance (`stampRotationDeg`), never from the ghost.
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
  | { readonly kind: 'objects'; readonly template: SceneArrangementTemplate }  // stamp pick, saved stamp
/** A note's text entry; the host owns the textarea. The tool card's spacing field is not one (it sends spacing commands). */
export interface TextEntryRequest {
  readonly anchor: WorldPoint
  readonly rotationDeg: number                     // stored note rotation; the host draws the textarea at rotationDeg − bearing
  readonly initialText: string
  readonly placeholderKey: string
  /** One mode (phase 2, U34): the field is drawn at the note's font size and line height, where the note will draw. */
  readonly fontSizePx?: number                     // the note's stored font size; a new note's default 16 px
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
  | { readonly kind: 'escape' }                                    // only when the tool's Esc layer is top: drops the transient, else 'pass' (the chain's tool layer leaves)
  | { readonly kind: 'confirm' }                                   // Enter and the menu's "Finish shape" (polygon: finish)
  | { readonly kind: 'remove-last' }                               // Backspace: a draft's last corner; in Select, as delete-handle (U36)
  | { readonly kind: 'rotate-held'; readonly stepDeg: 15 | -15 }   // [ ] while a stamp is held
  | { readonly kind: 'place-at'; readonly world: WorldPoint }      // context menu "Place plants here": snapped by the host; dropped in overview
  | { readonly kind: 'delete-handle' }                             // Delete on a focused or selected polygon corner (phase 2); Backspace's remove-last does the same in Select (U36); a refused removal keeps the corner
  | { readonly kind: 'edit-text' }                                 // Enter / F2 on one selected note
  | { readonly kind: 'undo-transient' } | { readonly kind: 'redo-transient' }
  // The tool card's Plant a row spacing field (CanvasToolCommandSurface.plantRowSpacing, forwarded by the session):
  | { readonly kind: 'spacing-input'; readonly text: string }                 // typing: the preview follows a valid spacing
  | { readonly kind: 'spacing-commit'; readonly via: 'enter' | 'blur' }       // keeps a valid spacing; Enter returns focus to the map, blur moves none
  | { readonly kind: 'spacing-cancel' }                                       // Esc in the field: drops the source, focus to the map

/** A 'handled' hover clears and skips the host's passive hover (restyle, tooltip); 'pass' lets it run. */
export type ToolReply = 'handled' | 'pass'

/** Read-only view queries: everything a tool may know about the camera. */
export interface ToolView {
  readonly bearingDeg: number                  // ViewCamera.bearingDeg as the drivers keep it, in [0, 360); not normalised again
  readonly mode: 'site' | 'overview'
  metresPerPixelAt(p: WorldPoint): number
  screenDistance(a: WorldPoint, b: WorldPoint): number
  screenAxesInWorld(): { readonly right: WorldVector; readonly down: WorldVector }
  /** Screen-aligned rectangle from two world corners: rotationDeg = the bearing, already in [0, 360) (T2). Shift's square and circle use `square`. */
  screenAlignedRect(a: WorldPoint, b: WorldPoint, options?: { readonly square?: boolean }):
    { readonly center: WorldPoint; readonly width: number; readonly height: number; readonly rotationDeg: number }
}
// Angle constraints are not a ToolView query: the host applies them (CanvasTool.constraint), so ToolPoint.snapped is always right.

/** Read-only scene queries: a façade over the linear hit tests at the frame's pixelsPerMetre (an index may come later). */
export interface ToolScene {
  readonly persisted: Readonly<ScenePersistedState>
  hitAt(world: WorldPoint, filter?: HitFilter): HitTarget | null
  hitInQuad(quad: WorldQuad, filter?: HitFilter): readonly HitTarget[]
  nearestPlant(world: WorldPoint): { readonly plant: ScenePlantEntity; readonly distanceM: number } | null
  /** How the scene presents a plant now, among the scene's plants (for its crowding): the name in today's order (localised,
   *  stored common, canonical), the display colour and the symbol radius in CSS px. For tool-card names, row glyphs and the
   *  source ring; a preview passes the plant a click would place (plantEntityFromStampSource). */
  plantPresentation(plant: ScenePlantEntity): { readonly commonName: string; readonly color: string; readonly radiusPx: number }
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
  /** The host's grid snapping of any world point (the move-drag snaps the dragged object's reference point, not the pointer). */
  snap(point: WorldPoint): WorldPoint
  /** The pointer kind that last hovered, pressed or tapped the map, whichever tool heard it (Select's handle size, Q1). */
  pointer(): PointerKind
  readonly translate: (key: string, options?: Readonly<Record<string, unknown>>) => string
}

export interface CanvasTool {
  readonly id: ToolId
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
  /** A camera frame on which the host re-emitted nothing (the pointer off the map): rebuild a draft whose look depends on the
   *  scale, such as the polygon's edge chips hidden below 36 px (today's refreshViewportDependent). */
  viewChanged?(): void
  /** True while the tool holds a draft, pick, row source or Place plants' waiting point: Esc drops it first unless
   *  `escapeLeaves`, and it holds re-origin, through which it blocks Delete and Ctrl+X (§4.19; §1.6 step 10, `holdsSelectionDeletes`). */
  hasTransient(): boolean
  /** Esc leaves the tool even while it holds a transient, which is then no Esc layer (Place plants' waiting point, U35). */
  readonly escapeLeaves?: true
  /** True while the menu's "Finish shape" applies (Polygon: at least 3 corners); the entry sends `confirm`. */
  canFinish?(): boolean
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
  | { readonly kind: 'label'; readonly anchor: WorldPoint; readonly offsetPx: ScreenPoint; readonly text: string; readonly tone: 'measure' | 'measure-quiet' | 'hint' | 'hint-primary' | 'warning'
      readonly beside?: { readonly normalPx: ScreenPoint; readonly gapPx: number } }  // upright chip; beside: moved along the unit normal until its nearest side is gapPx past anchor + offset (U38)
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
  readonly offsetPx?: ScreenPoint        // rotate handle: centred 28 px above the selection's projected hull; 48 px while the selected polygon shows midpoint dots, so it clears a dotted edge's chip (U38, canopi-f47t.29)
  readonly hitRadiusPx: number           // 10 for mouse and pen; 22 after a touch (44 px target, ADR 0010): the kind that last pressed or hovered (U41)
  readonly glyph: 'vertex' | 'corner' | 'rotate' | 'midpoint'
  readonly label: string                 // aria-label, always translated: the rotate handle, "Zone control point N", "Measurement guide endpoint N" (C8)
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

Tools never see screen coordinates in gestures; `ScreenPoint` appears only in `offsetPx`/`radiusPx` presentation fields. A tool that needs today's clamp to the visible map (Plant a row) sets `clampsToView`, and the host clamps the screen point before conversion, constraint and snapping. `ToolContext` has no navigation handle. The Pan tool's drags never reach it (the recogniser turns them into `pan`); its press ends with a `tap` or, after a drag, with `cancel('navigate')` (§2.2); its module sets guidance only; the `grab` cursor comes from the host's cursor per tool (`cursorForTool`), which no tool overrides.

The `ToolHost` (`tools/tool-host.ts`, interface in `interaction-ports.ts`) is the only code that builds `ToolGesture`s. Its duties, in order:

- **Admission.** Presses, menus, drops and commands, and the releases of a tool whose `settledRelease()` answers true (Select's band), run inside `deps.admission.runWhenSettled` (dragover inside `deps.settled.readWhenSettled`); a refused press answers `{ quarantine, rejectSession }`, a refused settled release cancels the tool and answers `{ quarantine }`, a refused menu or drop `{ quarantine }`. There is no quarantine outside the host. A Scene operation runs its steps once and nothing resumes it (phase 2, P1): an edit that throws before history accepts restores its before-state; after acceptance each remaining publication step runs once, errors are collected (`throwCanvasRuntimeCleanupErrors`), the authority is released and the error rethrown. Undo and redo move the cursor first, then apply the patch as one store update, then publish: a store-update throw rolls the cursor back, a publication throw keeps the step. A hydrate or replace that throws rethrows and keeps the Scene (U35): while the document surface is `settling`, presses, edits, undo and saves are refused until the next open or replace succeeds and takes it over; the document session's retry is a fresh `replaceDocument`. Edits and undo/redo keep the run-once rule above. No `resumePending` path, once-per-token record or step flag exists; `capturePersistence` reads the active transaction's own `historyAccepted`.
- **Faults** (phase 2, P18). At the outermost tool call only (`callDepth` 0), once: a tool call that throws aborts the host's open edits, ends the live press, arms a fresh instance of the current tool (Select if activation threw) and rethrows. A failure during the re-arm is not handled again; the host keeps a fresh Select. The faulted instance gets no `deactivate`; the re-arm closes an open text entry, and drops in-tool state such as an Object stamp pick. An aborted transaction is closed before the run-once restore, so the restore never applies twice. No tool keeps a commit-fault branch.
- **Raw presses** (`rawPress(button, target, pointerId)`): the session calls it for every raw pointerdown on the map host before routing it, including presses the host never sees as gestures (secondary, middle, Space and overview presses, presses on owned chrome). The host commits the nudge series for any button, and for an admitted press of any button (phase 2; not in the text entry, no live press from another pointer id) also closes the canvas menu, submits an unfocused open text entry (`chrome.submitUnfocusedTextEntry()`) and focuses the map through `deps.focus`, so a double right-click replaces the menu.
- **World conversion** at event time (a null `screenToWorld` drops hovers and cancels drags); a tool with `clampsToView` gets the screen point clamped to the view first.
- **Constraint and snapping** once, filling `ToolPoint.free`, `.constrained` and `.snapped` in the order of §2.3: the active tool's `constraint()`, then the grid snap (`tools/snapping.ts`, `deps.snapping()` read per point). `ToolContext.snap` exposes the same snapping; `place-at` arrives snapped and is dropped in overview.
- **Hits.** A handle target becomes `handle-drag`.
- **Interceptors:** while Text is armed, a press that committed an open note entry reaches no tool (nor its drag or release); otherwise it goes on. An admitted press takes its capture first and stops if the capture was lost while taking it. The raster probe `deps.inspect` runs on a primary press after handles and pan and before the tool, never in overview or while Pan is armed (fixture J10, §3.8). Entering overview commits and closes any open entry (U34); one whose commit is refused is discarded through `cancelTextEntry`, so its tool resets; and closes the menu and every transient (`cancelTransient('overview')`).
- **Overview.** No primary press reaches the host in overview: the recogniser pans it (§2.2), so nothing is selectable there, since the overview draws no zones or notes (U36); `menuAt` stays refused.
- **Hover.** Every `hover` whose target is the map (`surface`) is published to `subscribePointerWorld` first, in overview too; `hover-end` publishes `null`. The interaction session's `subscribePointerWorld` drops the point of a move whose raw `buttonMask` has any bit set. A hover over owned chrome or anything off the map publishes nothing. Outside overview the tool then gets it: `'pass'` runs the passive hover (restyle, tooltip); `'handled'` clears and skips it. On `hover-end` the tool decides what to keep (Place plants hides its preview; the stamps keep their ghost; every other tool keeps its draft). A `drag-start`/`drag-move` the tool answers `'pass'` runs the passive hover too; one it answers `'handled'` runs no hover over its moves (Select's move and band, Text, Place plants, the zone drags).
- **Drops.** One shared drop handler serves every tool: a species drop places with `tools/plant-stamp.ts`'s code, a saved stamp with `tools/saved-object-stamp.ts`'s; dragover answers `dropEffect` from the payload kind and the open layers. Dragover shows a drop preview merged with the decorations (a species payload: a small `quad`; a saved stamp: its `'objects'` ghosts at the snapped point), cleared on dragleave, drop, a refused dragover, overview, a cancellation or a document replacement. Any dragover hides the active tool's own draft; the next hover or press over the map shows it again. A drop places at the snapped point inside `deps.admission`; once its edit commits, the host requests Select, focuses the map and calls `ToolHostDeps.dropped(kind)`.
- **Re-emit** of the live drag, or of the resting pointer, on every `onViewFrame('tools')`, so a draft, ghost or preview stays on the ground under a still pointer (plan §4, phase 0, exception 1). A pointer-source pan hands its `at` to `notePointer`, which moves the resting pointer and emits nothing (the next frame re-emits under it); wheel and key pans leave it where it is. With the pointer off the map the host calls the tool's `viewChanged?()` instead.
- **Re-origin hold** (phase 2, P8). `holdsReorigin()` is true while a press is live, the active tool has a transient or the text entry is open; re-origin waits and runs on the last frame when the hold clears (§4.19). On a plane change the host hides tool ghosts only when no pointer rests on the map, until the next hover; under a still pointer the re-emitted hover shows them again in the new plane. No tool hook re-projects anything.
- **Drafts and decorations.** The host owns the selection decorations whatever tool is armed: the selected zone's W/H, edge and area chips (`tools/measure-labels.ts`), and the rotation handle and handles while Select is armed and the text entry is closed (`tools/select/reshape.ts`, `tools/select/guide-ends.ts`). These chips hide while an armed Line, Rectangle, Ellipse or Polygon draft carries its own measure labels. While Select shows a polygon's midpoint dots, the chip of each edge that shows its dot is drawn beside the dot, outside the edge (U38): the label carries `beside` (the edge's outward normal on screen, away from the polygon's interior, and a 6 px gap), and the Renderer moves the chip along that normal until its nearest side is 6 px beyond the anchor, so it clears the dot whatever its text; edges without a dot, the W/H and area chips, drafts and every other zone's labels are drawn on their anchor as before. Rebuilt on every `onViewFrame('tools')` and on `sceneChanged()`, merged with the active tool's draft before `renderer.setDraft`. The host calls `deps.invalidate()` after any tool call that mutated an open transaction or changed its draft or handles: a tool call path that forgets this leaves a stale render.
- **Arrow nudge** and its series (`nudge`, `hasNudgeSeries`, `endNudgeSeries`; `'handled'`, `'refused'` or `'pass'`, and on `'pass'` the keyboard port applies the arrow's rule; `focus-out` commits the series).
- **Interruption** (`interrupted()`): on window blur the series commits, the passive hover and tooltip clear, the tool's `cancelTransient('navigate')` keeps a draft that survives pans, and the cursor returns to the tool's.
- **Releases** (`released()`): the host hears a tool press's own release; for the rest the session calls `released()` after routing (the end of a pointer pan, an up with no press of the map's). It commits the series, clears the drop preview and passive hover, runs `cancelTransient('navigate')` and resets the cursor. A press of the tool's still live is left to its own release. `released()` does not run for: another pointer's still-live press, an up in overview (the recogniser swallows it), and an up over the note editor or a handle. The keyboard port's Space hold also reads `textEntryOpen()`: while an entry is open, Space arms no pan.
- **Menus**: with the text entry open the map takes focus first; hit, retarget the selection through `deps.setSelection` (not while `holdsReorigin()` holds, U39: a live press, a tool transient or a text entry left open keeps the current selection, and the request carries `holdsSelectionDeletes`, so the menu, pointer or keyboard, disables Cut and Delete as key admission refuses Delete and Ctrl+X; Finish shape and Turn view to this edge stay), open through `ToolHostDeps.menu` (the only opener); `turnViewToEdge` on a zone-edge hit from phase 1 (§4.16, no edge highlight); `finishShape` first while the active tool's `canFinish?()` is true (a polygon draft of 3+ corners) from phase 2: it runs `command({ kind: 'confirm' })`, travelling through the controller's `openAtPointer` like `turnViewToEdge`, and through `openFromKeyboard` too, since Finish shape leads every menu, the keyboard's included.
- **Transient history** (`transientHistory`, revision bumps after every tool call and after a deferred `onCommitted`, read by Edit › Undo through the runtime's own `transientHistory`). Tool calls run untracked and the bump itself reads nothing (`x.value = x.peek() + 1`), because the runtime refreshes the session from inside its effects, which must neither depend on what a tool reads nor loop on the bump.
- **Esc queries** (`hasLiveGesture`, `activeToolHasEscapeTransient`, `activeToolIsSelect`); modifier resolution (§2.3).

Every tool, drop and piece of chrome runs on the host and `chrome/*.ts`; tools decide what a navigation keeps by `cancelTransient`'s reason.

`interaction-session.ts` is the composition root (`interaction-session.test.ts` holds its wiring).

### 1.5 Renderer (`canvas/runtime/renderers/scene-types.ts`)

`SceneRendererDefinition.initialize` returns a `SceneRenderer`; `SceneRendererSnapshot` carries no camera.

The grid is an editing aid, not scene data: the same Pixi presentation draws saved-view and story thumbnails, the overview and the lens, which must not show it. It travels in its own optional field, set only on the workspace renderer (phase 1). Ruler guides and `scene.guides` are gone (U33):

```ts
export interface SceneRendererSnapshot {
  // … existing fields …
  /** The grid (null when off; its ink and major ink, the interval coming from `gridInterval` at the view's scale); the
   *  Renderer names the shape. Absent: nothing is drawn (thumbnails, overview, lens). */
  readonly editingAids?: { readonly grid: unknown }
}
```

The presentation controller gains `setEditingAids(aids)`, the pattern of `presentLayers`; `SceneCanvasRuntime` keeps `_chromeShown` and computes `editingAids = shown && gridVisible ? { grid: ink } : null`, recomputed by `onChromeOverlay` and `onMapBackdrop`, then `invalidate('scene')`. There is no `'chrome'` render kind, chrome coordinator or per-frame `renderChrome` (phase 2's cut stage). `world-layers.ts` traces the grid over a padded box around `visibleWorldQuad()` and retraces only it when the view leaves that box or the scale changes (zones keep the scale-only rule); the grid uses `snapping.ts`'s `gridInterval`, and its ink is part of the reuse key.

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
| `worldRoot` | `view.planar.affine`, one write per frame | grid (from phase 1, `editingAids`, under every billboard), zones, measurement guides, selection preview |
| `billboardRoot` | identity (CSS px) | plants, rings, badges, notes (text at `rotationDeg − bearing`), labels; positions from `view.projectAnchors` |
| `worldDraftRoot` (`draft-layer.ts`) | the same `view.planar.affine`, written in the same `setView` | world drafts (polylines, polygons, quads, ellipses) and the zone shapes of an `objects` ghost |
| `billboardDraftRoot` (`draft-layer.ts`) | identity (CSS px) | pixel-sized drafts (`circle-px`, `label`) and the plants and note text of a ghost (a plant is a billboard); positions from `view.projectAnchors` |
| DOM overlay host (`canvas/runtime/chrome/`) | placed in `onViewFrame('overlays')`, no element created per frame (`left`/`top` until phase R, then `translate` only) | handle layer, text-entry host, hover tooltip |

`SelectionPreview` spans both roots: `world-layers.ts` applies it to the selected world shapes (zones, guides) as a transform of their retained geometry, and `billboard-layer.ts` applies it to the anchors of selected plants and notes before `projectAnchors` (and adds `rotateDeg` to a selected note's text angle), so a move-drag moves everything selected without `syncScene` (test `renderers/billboard-layer.test.ts`: "a selection preview moves selected plants and notes without syncScene", phase R).

Culling stays in screen space. From phase R, label admission is computed on `settledViewFrame` and on zoom-band change, with no admission cache (audit 1.6); mid-zoom, the labels admitted for the previous band move with their plants until the band changes or the view settles (convention, plan §8). Until then `renderers/label-admission.ts` keeps today's cadence: a pan translates the admitted labels and any scale change admits again. The labels count (`app/plant-display/coverage.ts`) re-reads on `ViewReadSurface.settledRevision` and `zoomBand` (a by-eye convention, plan §1). The layer (`maplibre/shared-scene-layer.ts`) reads `viewFrame.peek()` in `render` and calls `setView` only when `revision` changed; it never derives a transform.

### 1.6 Keyboard and focus (`app/keyboard/`, neutral)

```ts
// canvas/runtime/runtime.ts  (added role; runtime never imports app)
export type CanvasEscapeLayer = 'gesture' | 'nudge-series' | 'tool-transient' | 'tool' | 'selection'

export interface CanvasKeyboardPort {
  escapeLayers(): readonly CanvasEscapeLayer[]            // live canvas layers now
  escape(layer: CanvasEscapeLayer): void
  /** False when nothing consumed it. As today: confirm, remove-last, rotate-held, edit-text and context-menu return false in overview
   *  (today's overview branch, keyboard-port.ts:278-286); edit-text only under Select; the other kinds are unchanged. No keyboard-menu echo is recorded
   *  (phase 2, P2: a native contextmenu never opens the canvas menu). */
  command(c: CanvasKeyCommand): boolean
  /** The key router's first call for every keydown (capture) and keyup: the nudge commit on any key but an arrow, a modifier or Esc,
   *  and the Space hold (code Space, not text, and a live pointer session or not a control,
   *  read with the port's own pointerSessionLive()). The verdict tells the router what to do; the port never touches the event
   *  (no KeyConsumer; the canvas Esc layers answer through their return value, §3.7). */
  keyState(k: CanvasKeyState): CanvasKeyVerdict
  /** Key admission (U33, canopi-f47t.21; step 10): a selection delete (Delete, Backspace's fallback, Ctrl+X) runs nothing
   *  while this holds: a live pointer session, or ToolHost.holdsReorigin() (a live press, a tool transient, an open text entry). */
  holdsSelectionDeletes(): boolean
  readonly host: HTMLElement
}
export interface CanvasKeyState {
  readonly type: 'keydown' | 'keyup'
  readonly key: string             // arrows, modifiers and Escape keep a nudge series
  readonly code: string            // 'Space'
  readonly mods: Modifiers
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
  focusMap(): void                 // no reason (phase 2, P30)
  // focusToolCardField comes only with the first tool that asks for its card's field.
}

// canvas/runtime/runtime.ts, continued
/** The tool surface on the canvas session. setTool takes a ToolId end to end, and TOOL_REGISTRY is a total
 *  Record<ToolId, ToolFactory>: every id is a tool, so the armed tool is never none (phase 2, P28). */
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
 *  may not import src/app/**). Nobody keeps a physical-Ctrl record or a keyboard-menu time (phase 2). */
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
/** mod = Cmd on Mac, Ctrl elsewhere (`modKeyIsCmd`, input/platform.ts, the one definition; the recogniser's `stepsRotate` uses it too). A physical Ctrl on Mac is `ctrl`, never `mod`. */
export interface KeyChord { readonly key: string; readonly mod: boolean; readonly ctrl: boolean; readonly shift: boolean; readonly alt: boolean }
/** The Mac rule above; letters, digits and brackets fall back to event.code on non-Latin layouts; null for AltGr and while composing. */
export function chordOf(e: KeyboardEventLike, platform: Pick<InputPlatform, 'os'>): KeyChord | null

// app/keyboard/keymap.ts
export type KeyScope =
  | 'global'          // every focus class except modal; in text only with worksInTextFields (every shell chord, Ctrl+K)
  | 'command'         // anywhere except text fields and dialogs: tool letters, [ ], N, Shift+N, Shift+L, Ctrl+V, Ctrl+Z…
  | 'view-arrows'     // Shift+←/→/↑: like 'command', but not inside an arrow-owning widget
  | 'outside-dock'    // like 'command', but not from the side-panel dock or phone sheet (focus there, or <body> after a press or focus there): the selection edits, Delete, Backspace
  | 'canvas-focus'    // focus on the map host (not text inside it), or <body> after a press or focus on the map: plain and mod arrows, Enter, Space, Backspace in a draft, F2, + / −, Menu
/** A shell command (app/shell-commands), a canvas catalogue command (CanvasCommandId, app/canvas-commands/index.ts: tool letters,
 *  edit.undo, canvas.deleteSelected, view.zoomIn …) or a canvas key command ('canvas.<CanvasKeyCommand kind>'). */
export type KeyCommandId = ShellCommandId | CanvasCommandId | `canvas.${CanvasKeyCommand['kind']}`
export interface KeymapRow {
  readonly command: KeyCommandId
  readonly chords: readonly KeyChord[]
  readonly scope: KeyScope
  readonly singleKey: 'follows-switch' | 'always-on' | 'n/a'  // the single-key shortcut setting
  readonly worksInTextFields?: boolean        // also runs in a text field: every shell row but a single key (F2 too), and Ctrl+K
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
 *  canvas chord). Each edition composes [...shellKeymapRows(…), ...CANVAS_KEYMAP_ROWS] (P14 holds). F1 keeps rendering the menus; phase 2 makes it a static list. */
export function shellKeymapRows(catalog: readonly ShellCommandCatalogEntry[], options?: { readonly omit?: ReadonlySet<string> }): readonly KeymapRow[]

/** Where a keymap row runs: Desktop's sink, private to commands/registry.ts; Web web/browser-shell-commands.ts. Injected, so
 *  app/keyboard stays neutral (P14). */
export interface CommandSink {
  /** False when the key is not consumed; the router prevents and stops a consumed key (step 10 below). */
  run(command: ShellCommandId | CanvasCommandId): boolean
}
/** Pushed scopes: non-modal surfaces that own keys while open (step 7). Modal surfaces push none: the story presenter's and the PDF
 *  page editor's own element onKeyDown run before the router, under the modal step (step 5), so the presenter hears only keys inside
 *  its root (fixture I12b). */
/** Pushes a scope that takes a chord by answering true (the Stories Undo toast's Ctrl Z); returns the function that removes it. The
 *  router tries the pushed scopes latest first. */
export function pushKeyScope(handle: (chord: KeyChord) => boolean): () => void

// app/keyboard/escape-chain.ts
export interface EscapeLayer {
  readonly priority: number          // higher runs first
  isActive(): boolean
  /** The Esc being dispatched; false when it consumed nothing and the next active layer runs. */
  escape(key: EscapeKey): boolean
}
export interface EscapeKey { readonly event: KeyboardEventLike }   // the router prevents and stops the key when a layer returns true
export function registerEscapeLayer(layer: EscapeLayer): () => void
/** The router's Esc step: active layers by priority until one consumes the key (§3.7); the canvas port registers its layers. */
export function runEscape(key: EscapeKey): boolean

// app/keyboard/arming.ts  (the one way app code arms a canvas tool; P9)
export function armCanvasTool(
  tool: ToolId,
  options: {
    /** Each caller passes its own: the rail, menus, palette and both editions' keys no longer share one 'command' value. They
     *  reach arming through shared dispatch, so F threads `from` as an argument through runCatalogCommand and the
     *  projected action(from) to runCanvasIntent (app/workspace-commands/canvas-actions.ts). A drop arms in the runtime,
     *  with no from. */
    readonly from: 'rail' | 'menu' | 'palette' | 'panel' | 'card' | 'shortcut' | 'start-card'
    readonly source?: ToolSource
  },
): boolean   // true when a canvas session took the tool

// app/keyboard/focus-owner.ts
// No FocusReason (phase 2, P30): focusMap and focusOnOpen take no reason; arming's `from` stays.
export interface FocusOwner extends CanvasFocusPort {
  focusMap(): void                                     // the host itself, never a control inside it
  /** A component opened by a user action focuses its first field through here; content-derived UI cannot. */
  focusOnOpen(el: HTMLElement): void
  /** Replaces app/shell/focus-regions.ts registerFocusRegion (components/shared/useFocusRegion.ts re-points here in F). */
  registerRegion(region: 'title-bar' | 'tool-rail' | 'map' | 'dock', el: HTMLElement): () => void
  /** F6 and Shift+F6 (today's cycleFocusRegion); false while the modal layer is held. */
  cycleRegion(step: 1 | -1): boolean
}
```

`KeyRouter` (`key-router.ts`) owns the only window key listeners. It and the rest of this section are built once, in F, in their target form (no legacy rebuild, U7); until then the keyboard port keeps today's key handling. `armCanvasTool` writes the source to the module read models (`canvas/plant-stamp-source.ts`, `canvas/saved-object-stamp-source.ts`: they stay, as what the tool card, recents and choosers display; their `begin…` helpers are deleted in F, so the runtime, which value-imports both modules, never reaches `app/keyboard/**`), selects the canvas panel for the command and Start-card callers, calls `CanvasToolCommandSurface.setTool(id)` and focuses the map for every `from` except `shortcut`. It records no rail learning: that stays an effect on every tool change (`app/tool-rail/learning.ts`, unchanged in F).

| `from` (callers) | Source | Canvas panel | No canvas session | Focus |
|---|---|---|---|---|
| `rail` (`ToolRail.tsx`), `menu` (`menus.ts`), `palette` (`CommandPalette.tsx`), `shortcut` (Desktop and Web keys, their sinks) | — | selected unless active | primes the tool mirror (`canvas/session.ts`) | the map host, except `shortcut`, which leaves focus where it is |
| `start-card`: `SiteOnboarding.tsx` (after canopi-f47t.6.1) | — | selected unless active | primes | the map host; no disabled gate (arms Polygon in overview, as today) |
| `panel`: `place-species.ts` | species | — | writes the source and recents, arms nothing | the map host |
| `panel`: `FavoritesPanel.tsx`; `card`: `StampChooser.tsx` (both through `workbench.placeStamp(stamp, from)`) | saved-stamp | — | writes nothing, false | the map host (the card's `closeChooser` focus moves to the owner, INV-FOC-05) |
| `card`: `StampChooser.tsx`'s `select`, then `object-stamp` (never short-circuits a same-id arm) | — | — | nothing | the map host |
| a drop (no `from`) | — | — | — | the map host (no app caller: the runtime arms at a drop and focuses the map) |

F deletes `app/shell/focus-regions.ts` with today's `focusRegion(id)` and `focusMapSurface()` and moves their callers (`app/story-presentation/controller.ts`, `place-species.ts`, `FavoritesPanel.tsx`) to the owner in the same change; P11 tombstones them.

An **arrow-owning widget** is an element with role `listbox`, `menu`, `menubar`, `slider`, `spinbutton`, `tablist`, `tree`, `grid`, `radiogroup` or `toolbar`, a focusable `separator` (one that can take focus: the dock and Favorites splitters; the rail's decorative separators are not focusable and do not count), or an element with `data-owns-keys` listing arrows. Widgets that handle arrows without such a role declare `data-owns-keys="arrows"` on their root, each in its phase: the inspection lens preview (`InspectionLens.tsx`), the phone sheet handle (`PhoneSheet.tsx`), the calendar's date grid (`components/panels/CalendarPanel.tsx:301-330`, a plain `<table>`) the plant photo carousel (`components/species-detail/PhotoViewer.tsx:64-80`) and the World map container (`components/world-map/WorldMapSurface.tsx`, whose MapLibre keyboard handler pans with arrows), all phase 1, Components. The tool rail (`role="toolbar"`, `ToolRail.tsx:90-101`), the dock splitter (`SidePanelDock.tsx:105-124`) and the Favorites splitter (`FavoritesPanel.tsx:501-511`) are covered by their roles. A widget that must keep a `command` key opts in with `data-owns-keys="Delete"` (or the key it needs) on its root.

**Listener phases.** `installKeyRouter` adds a window capture and a window bubble listener for `keydown` and a window capture listener for `keyup`; they are the only window key listeners (P8). Capture keeps what runs before element handlers today (`focus-regions.ts:106`, then `dom-input-source.ts:275`); bubble keeps the shell rows' rule (`shortcuts/manager.ts:26`, `web/canvas-shortcuts.ts:69`, both skipping `defaultPrevented`); today's keyup listener (`dom-input-source.ts:276`, bubble) moves to capture, which changes no order, since no other keyup listener exists in `src/`.

`app/keyboard/target-class.ts` classifies the focus (step 2 below), importing `isEditableTarget` from `canvas/runtime/input/editable-target.ts` (it stays there for its runtime users).

Resolution order for one keydown. Capture listener:
1. Composition (`isComposing || keyCode === 229`): return (phase F).
2. Classify focus: `modal`, `text` (input, textarea, select, contenteditable, the text-entry host), `map` (map host or inside it), `other` (rail buttons, dock lists, menus, the compass). Nothing focused (`<body>`) is `map` when the last pointer press in the document landed in the map host and `other` otherwise, since a click on a dock panel's text also leaves focus on `<body>`; the router records the press at document capture.
3. Held keys: keep the keys held down so a lost keyup (Meta, blur, hidden page) releases them; modifiers are read from each event, never from this list (ADR 0017); track Space as held only in `map` or with nothing focused (wherever the last press landed), or while a canvas gesture is live; send `keyState` to the canvas port; clear on blur, `visibilitychange` and Meta keyup.
4. While a pointer gesture or nudge series is live, the canvas port takes the key first whatever the focus (today `keyboard-port.ts:260-277`): Esc runs the `gesture` or `nudge-series` layer. F6 and Shift+F6 cycle regions (today in capture).

Bubble listener, skipped for a key already `defaultPrevented` (an element handler of a focused widget handled it; a widget that calls `stopPropagation` hides the key from these steps, as it hides it from the shell rows today; today's widgets stop propagation on Escape (`InspectionLens.tsx:119`, `PlantColorMenu.tsx:243`, `PlantSymbolMenu.tsx:122`, `PdfPageEditor.tsx:105` and about 15 more), `ToolCard.tsx:240` also on Enter, `SegmentedControl.tsx:52-53` on arrows, Home and End):
5. Modal: `worksInModal` rows only; nothing else. The modal's element handlers (the story presenter's and the PDF page editor's own `onKeyDown` among them) have already run.
6. In `text`, the rows with `worksInTextFields`: every shell row but a single key, F2 (rename the Design) included, as before the router, and Ctrl+K; canvas rows stay out. In every other class but `modal`, the `global` rows. Ctrl F is a global row whose command asks the open panel's plant finder first and otherwise opens Edit › Find plants (today `shortcuts/manager.ts:15-20`).
7. Non-modal pushed scopes: the Stories Undo toast (Ctrl Z while the toast is on screen, today `app/stories/actions.ts` `runStoryUndoShortcut`). Popovers and menus are not scopes: their Esc is an Esc layer (step 8), and their arrows are handled by their own element (arrow-owning widgets).
8. Esc runs the Esc chain (popovers 100, canvas menu 80, … §3.7). An open text entry never reaches this step: its own element handler cancels it first, and focus class `text` keeps the canvas layers off; the selection layer also needs focus class `map` (U10).
9. Keymap match: `command` rows in `map` and `other`; `view-arrows` the same except in an arrow-owning widget; `outside-dock` the same except from the side-panel dock or phone sheet (focus there, or `<body>` after a press or focus there); `canvas-focus` only in `map`.
10. Dispatch: `preventDefault` and `stopPropagation`; canvas commands through the port; a port `command()` that returns false runs the row's `fallback` through the platform's `CommandSink` (Desktop `commands/registry.ts`, Web `web/browser-shell-commands.ts`), and without a fallback the key is not consumed. Key admission (U33, canopi-f47t.21) is one condition in the router's `runSink`, which every fallback also passes: while `CanvasKeyboardPort.holdsSelectionDeletes()` holds (a live pointer session, or `ToolHost.holdsReorigin()`: a live press, a tool transient, Place plants' waiting point included though it is no Esc layer (U35), or an open text entry), a selection delete (Delete, Backspace's fallback, Ctrl+X) runs nothing and the key is consumed, from any focus. Each chord has one row per scope; rows are never tried in turn (fixture H27).

Canvas-focus rows run only with focus on the map host, or on `<body>` after a press on the map, where no widget handler runs, so moving them from today's capture listener to bubble changes no outcome. A focused widget without a role that handles arrows (the scale button, `ZoomControls.tsx:138-143`) runs first and prevents the default, so Shift+↑ on it opens the scale menu and does not reset north. Fixtures I10, I11, I12, I12b and H23–H27 hold the outcomes (§5.8).

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
  /** Frame-independent: the area's centre in plan metres, and its width and height along the page axes. Each build converts
   *  it into the layout frame, so a switch of Map orientation or a reopen at a new bearing needs no code. */
  readonly bounds: PrintBounds
}
// Page-editor offsets are stored in plan metres too. The layout, contains, split and whole-design steps convert at each build.
// PdfInput gains: readonly viewBearingDeg?: number   // live.ts: captureView().camera.bearingDeg at each capture (exact, not the
//                                                    // rounded ViewReadSurface.bearingDeg); canvas/print.ts and print-snapshot.ts unchanged
// PdfPlan gains: readonly angleDeg: number           // the one layout angle: 0 under North up, viewBearingDeg under As on screen
// page-furniture groundScale gains northAngleDeg: the north arrow and its letter are drawn rotated by it.

// app/canvas-pdf/page-frame.ts  (phase 1; the only place the PDF turns geometry)
export interface PdfPageFrame {
  readonly angleDeg: number                 // clockwise from true north; 0 = north up
  readonly pivot: PrintPoint                // one pivot per plan, {0, 0} in plan metres (a per-page pivot breaks the page windows)
  /** Plan metres → the turned frame (rotate by −angle about the pivot). */
  toFrame(p: PrintPoint): PrintPoint
  /** The turned frame → plan metres (+angle): page-editor deltas. */
  fromFrame(p: PrintPoint): PrintPoint
}
export function pageFrame(angleDeg: number, pivot?: PrintPoint): PdfPageFrame   // pivot defaults to {0, 0}
/**
 * The print snapshot as seen in the frame, applied once per build: every coordinate pair of zone paths, plant positions, note
 * positions, measurement ends and guide ends turned by −angle, each zone's geometry turned (`PrintZone.geometry` is
 * required), bounds recomputed, and an annotation's `rotation` becomes `rotation − angle`. Print paths hold only absolute
 * M, L, C and Z; any other command throws `unsupported-print-path`. Identity (same object) when angleDeg is 0, so North up
 * plans are byte-identical to today.
 */
export function turnSnapshot(snapshot: CanvasPrintSnapshot, frame: PdfPageFrame): CanvasPrintSnapshot
```

The layout modules (`overview.ts`, `field-layout.ts`, `layout.ts`, `overview-guides.ts`, `zone-labels.ts`, `coverage.ts`, `field-summary.ts`, `page-drawing.ts`, `split-sheets.ts`, `field-dimensions.ts`) keep their axis-aligned `frame + (p − ground) × scale` maths and world-box tests: they run on the turned snapshot, where "axis-aligned" means "aligned with the page". Text they place (plant marks and codes, names, zone labels, dimension readouts) is laid out level on paper, so it stays upright whatever the angle. Every page shares the layout angle, so no page window is drawn as a turned outline, and split and detail lookup read the turned plants (§4.12).

`LastView` (settings) keeps its centre and zoom; phase 1's `bearing` field goes in phase 2 (U33, P36).

Stored data: `.canopi` gains the optional top-level `map_view`, the view a save writes (U28), and the required `SavedViewCamera.ground_size_m` (U33), loses `SavedView.extent` (§4.10) and ruler guides (`extra.guides`) are no longer read or written by the scene: the scene owns no `extra` key, and a key left in a development file stays as unknown extra (ADR 0011, U33); new positions are written rounded to 1e-9° (§8); the version stays 9 (ADR 0021). `SavedViewCamera.bearing` exists; writers normalise it to [0, 360), locally (P10). Settings lose `snap_to_guides` and `LastView.bearing` (U33). PDF setups are not persisted, so Map orientation and the layout angle live in memory only; `PdfPrintArea` gains no angle (U3; decided with the user, 2026-10-01). `scroll_wheel` keeps its field and values; only its UI is relabelled.

### 1.8 Module layout: what later phases add

Phase 0 built the modules of `canvas/runtime/{view,input,tools,renderers,chrome}/`, `interaction-types.ts`, `interaction-ports.ts`, `keyboard-port.ts`, `scene-extent.ts`, `scene-runtime/drag-state.ts`, `maplibre/camera-driver.ts` and the test supports (`test-view.ts`, `tool-harness.ts`, `recording-renderer.ts`, `canvas-interaction-setup.ts`); F built `app/keyboard/**` and `input/selection-drag-guard.ts`; phase 1 built `app/canvas-pdf/page-frame.ts` (§1.7), `components/canvas/Compass.tsx` (§4.2) and moved the grid into `renderers/world-layers.ts`; the tree under `desktop/web/src/` is their reference. `view/` imports only what policy P4 (plan §5) allows. Phase 2 adds no module: P2's secondary session lives in `recognise.ts` and its one `contextmenu` listener in `dom-input-source.ts` (no copied GeoLibre tracker, U33).

Phase R retains billboard geometry per zoom band in `renderers/billboard-layer.ts` and admits labels on settle in `renderers/label-admission.ts`.

### 1.9 Module layout: deleted, in the phase that replaces them

Phase 0's, F's and phase 1's deletions are done; P11 tombstones them. Left:

| File or symbol | Replaced by | Phase |
|---|---|---|
| Rulers, the rulers hint and the Rulers toggle (`chrome/rulers.ts`, `RulersNorthHint.tsx`, Shift+R, `rulersVisible`); ruler guides (`extra.guides`, the ruler `Guide` of `canvas/guides.ts`, `editingAids.rulerGuides`); Snap to guides (`snap_to_guides`); the `ruler` target and press kinds, `listensToRulers`, `currentEvent()` (U33) | nothing; measurement guides keep what they use | 2 (cut stage) |
| `chrome/locked-affordance.ts`, `setLockedAffordance`, `lockedAffordance` (U33, P4) | the locked hover stroke; Unlock in the canvas menu and Edit | 2 (cut stage) |
| `LastView.bearing` and the open-at-last-bearing fallback (U33, P36) | the live bearing | 2 (cut stage) |
| `view/bearing-tween.ts`, both animation-frame tween loops, the driver's bearing arc and `zoomFloorForArc` (U34, P7) | turns jump; the bearing-free floor (§4.14) | 2 (View) |
| `secondary.*`, `auxiliaryShiftDrag`, `primaryDragPansIn` with `PanContext`, `macCtrlClick`, `penBarrel`, `trackpadGestures` | their phase-2 values, hard-coded (§1.2) | 2 |
| The native-menu input path: the `native-contextmenu` RawInput, normalise's `contextmenu` case, `fromKeyboard`, `menuEchoMs`, `windowsMenuTrailMs`, the three dead deadlines, the `'ignored'` mode and the keyboard echo record (`lastKeyboardMenuAt`, `CanvasKeyState.timeStamp`) (U33 and U34, P2) | one `contextmenu` listener (§2.2); the Menu key and Shift+F10 | 2 |
| `settings.scrollWheel*` UI strings | `settings.pointingDevice*` | 2 |
| `Bindings`, `CURRENT_BINDINGS`, `RecogniserConfig.bindings`, `DomInputSourceDeps.bindings` (A7) | touch behaviour unconditional; `dragSlopPx` in `Thresholds`; P11 tombstones the names | 3 |

## 2. Gesture vocabulary

### 2.1 Kinds

| Kind | Meaning | Reaches |
|---|---|---|
| `hover`, `hover-end` | pointer over the map with no button, with the target class under it; `hover-end` on leaving the map, and from F on moving over owned chrome, the text entry or a handle (§2.2 "Hover") | ToolHost → `subscribePointerWorld` (a `surface` target only), then the tool (world point, hit) and the passive hover |
| `press` | primary button or finger down | ToolHost → tool |
| `tap` | primary up within slop | ToolHost → tool (`clickCount`: the platform's `detail`, or the recogniser's own count when higher: one more than the last primary press's within `multiClickMs` and `multiClickSlopPx`, by the same kind of pointer, since some engines send `detail` 0) |
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
- **Primary.** `press` on down; `tap` on an up within slop, or `drag-start` past slop, then `drag-move`, `drag-end`; a touch press is held ("Touch" below). Space held at press turns it into `pan` (`space-drag`). Space pressed after a primary session started does not change it (a session's mode is fixed; spec): the drag, band or move continues, and Space is only recorded for the next press. With the Pan tool a primary drag is `pan` (`primary-drag`); its press still reaches the tool and ends with a `tap`, or after a drag with `cancel('navigate')` right after the `pan{end}`, so every press the host sees ends (the Pan tool ignores them). In overview a primary press pans (`primary-drag`) for every pointer, touch included, and never reaches the host (U36).
- **Hover.** A move with no live session, buttons or not, is a `hover` wherever the pointer is, carrying the target class it saw (only a `surface` target reaches `subscribePointerWorld`, §1.4 "Hover"), except over owned chrome, the text entry or a handle, where it emits `hover-end` (F, U6; hard-coded in `recognise.ts`, no bindings field).
- **Auxiliary.** Drag → `pan`. With Shift at press the press opens a pending rotate: capture taken, default prevented, nothing emitted; `rotate{start}` comes only past the 3 px drag slop, with the total measured from the press (fixture G9), so a still Shift+middle click turns nothing (G9b). Shift is checked before the overview branch, so a Shift+middle-drag rotates in overview too (G9c). `step` = mod held live: a modifier change during a live rotate re-emits `rotate{move}` with the new step. A middle tap does nothing; `pointerdown` is always default-prevented (no autoscroll, no Linux paste).
- **Secondary (V2).** `down` → pending, capture taken, nothing emitted. Past 3 px with no Shift at the press → `pan`; with Shift at the press → `rotate` about the press point, `step` = mod held live (a consumed Mac Ctrl never counts). An `up` within 3 px → `menu-request` (source `mouse`) at the release point on every OS (convention); a pen barrel and a Mac Ctrl+click follow the same rules.
- **Native menu** (phase 2, P2; U34). The DOM source owns one document-capture `contextmenu` listener (on `host.ownerDocument`), which delivers nothing to the recogniser; ActionMenu keeps its own prevent. It prevents the default (1) over the map host, except over `owned-text` and `foreign` targets; (2) anywhere while the source owns a canvas session's pointer; (3) anywhere within 500 ms (`event.timeStamp`) of releasing a canvas session's pointer whose press normalised as secondary, or whose release reports the right or pen-barrel button after that session saw bit 2 in `buttons` over the canvas (a chorded right button released last, U36; a right release ending a stale primary press starts none, U37). A move that drops a secondary session's bit is its release ("Drag end"), so the trail starts at that move's `timeStamp` (U37). A canvas session is a press whose target class was `surface`, `handle` or `owned-chrome`: presses on the note editor and map fields keep their native copy and paste menu, on all three orderings (press-time, release-time, Mac Ctrl+click). "Anywhere" is the event's own target, so the WebView2 trail retargeted to `<html>` or the open menu is still prevented. A native `contextmenu` with no right, pen-barrel or Mac Control press (a Windows pen's press-and-hold, VoiceOver's VO+Shift+M) opens nothing (user, 2026-10-06, U34); the Menu key and Shift+F10 reach the selection menu through the keymap. Known Web limitation: Firefox always shows its native menu on Shift+right-click (`dom.event.contextmenu.shift_suppresses_event`), at the press on Linux (taking over the rotate) and after the release on Windows; Shift+middle, the compass and Shift+←/→ turn the view there.
- **Drag end.** A drag ends on `up`, lost capture, blur or `visibilitychange`. A navigation or pending-secondary session also ends when `buttons` loses its physical bit on a `move` (primary when `ctrlConsumed`), as MapLibre's `isValidMoveEvent`, and the DOM source then disowns the pointer (`disown`) with that move as its release, so the native-menu listener no longer treats it as a held canvas press, and a secondary press's trail starts at the move (a chorded right button released first while left is held, `buttons` 1; U37); a primary session does not, since a lost primary up already ends at the next down, so Mac Ctrl-drags are not cut short.
- **A second button during a primary drag** is ignored for the rest of the session in every phase (U2, 2026-10-01): no nested pan or rotate, and from phase 2 its native `contextmenu` is prevented and no `menu-request` is emitted. Wheel zoom and key navigation stay live during a drag.
- **Other chords.** A primary press during a secondary or auxiliary session is ignored for the rest of that session; its native menu is prevented.
- **Touch (phase 3, A2; U41).** A touch `down` emits no `press`: the recogniser holds it in every tool. Past 8 px it emits `press` (at the down point, with the down's modifiers, target and click count), then `drag-start`; a lift within slop emits `press`, then `tap`; 500 ms still emits only `menu-request('long-press')`. A second finger before slop emits nothing and starts the pair, so a pinch never changes the selection or adds anything; a second finger after the drag started emits `cancel('multitouch')` (a polygon draft keeps its corners); a third finger is ignored; lifting back to one finger resumes nothing until every finger is up. The session routes a press resolved at an `up` as live, so a tap places at the lift (A3). In overview, past slop a pan starts whose first move carries the whole travel, and a lift or 500 ms emits nothing; with the Pan tool the pan starts the same way, a lift emits `press` and `tap`, and 500 ms opens the menu.
- **Long press (A4).** After `menu-request('long-press')` the session stays alive and spent: it keeps its capture and ignores moves, the timer and extra fingers, and its `up` or `cancel` emits nothing, with `prevent-default` and `stop-propagation`, so the lift never reaches the open menu's outside-press close. The browser's own touch `contextmenu` is prevented while a canvas press is held (§2.2 "Native menu"), so one menu opens. Deadlines are base-free: the source schedules `atMs` minus the `t` of the last input it delivered, and the timer's `tick` carries `t: atMs` (A1).
- **Pair (A5, A12, A14).** Per move: `pan` by the centroid's movement, `zoom` about the centroid by the distance ratio once it passes 0.1 zoom level, then `rotate` about the centroid once the arc passes 25 px over the smallest finger diameter seen, counted from the vector at the crossing (MapLibre's `pinchAround` order). Pair pans carry no `at`, so a touch never moves the resting hover. A pair's cancel (Esc, blur, `pointercancel`, `configure`) ends in place: `pan{end}` and `rotate{end}` with the 7° north snap, never `rotate{cancel}`. Entering overview with the same tool is no fence for a live pair: a pinch's own zoom publishes the overview frame mid-pinch, so a pinch out carries on into overview.
- **Pen.** Tip = primary with pen slop; barrel = secondary rules (from 2); eraser ignored; hover works.
- **WebKit gesture events** (from phase 1; the DOM source adds `gesturestart`, `gesturechange` and `gestureend` listeners only when `platform.gestureEvents` is also true, copies `rotation`, prevents the default and removes them on detach). Only the rotation is used: WKWebView already delivers the pinch as Ctrl+wheel, so the gesture's scale is ignored and Ctrl-wheels zoom as everywhere (phase-1 drop). Rotation is accumulated and emits nothing until |accumulated| exceeds 10°; then `rotate` (`trackpad-twist`) starts with the threshold subtracted. A live twist is a session in `sessions` under a reserved non-pointer id (mode `rotate`, navigation `trackpad-twist`, slop passed at 10°), so Esc, blur, `configure` and the gesture Esc layer cancel it like a pointer rotate. The session exists from `gesturestart`, but the keys count it as a live pointer session only once its slop has passed, so a plain pinch-zoom keeps Esc, the arrows, Enter, F2 and the Menu key (from 1). One session at a time: a twist is ignored while a pointer pan or rotate is live, and a pointer down during a twist is ignored. On iOS the pointer-based two-finger recogniser is the only source; `gesture*` is prevented and ignored.
- **Cancel fences.** `pointercancel`, lost capture, blur, `visibilitychange`, the Esc chain's `escape`, and a `configure` that changes the tool or enters overview (not one entering overview with the same tool while a touch pair is live) emit `cancel`; a live pointer rotate emits `rotate{cancel}`, which restores the starting camera, while a touch pair ends in place ("Pair" above, A6). After a window blur the session also calls `ToolHost.interrupted()` (§1.4).

### 2.3 Modifier resolution (ToolHost)

Gesture modifiers are read from the event that carries them (ADR 0017), with no platform dependency: a Mac Ctrl press is secondary in `normalise`, so it never reaches a tool.

| Meaning | From phase 2 |
|---|---|
| `additive` | Shift, Ctrl or Cmd (Meta) |
| `subtractive` | Alt |
| `constrain` | Shift in Polygon, Plant a row, Line, Measure (45° screen steps), Rectangle (square, `screenAlignedRect`'s `square`), Ellipse (circle) and the rotate handle (15° steps from the press angle); point handles (corners, vertices, guide ends) ignore Shift and snap as usual (U36) |
| constrain and snap order | one order for every tool, with no tool-id branch: the constraint, then the length along the ray rounded to `gridInterval(ppm).interval` when grid snap is on; `rotation-delta` is not snapped |
| `noSnap` | Ctrl or Cmd during a Plant a row drag (so Super on Windows and Linux, and Ctrl during a Mac drag, also turn snapping off: accepted) |

A modifier change while the pointer is still changes a draft at the next pointer move; only a live rotate re-steps at once (fixture A8). Drafts are not re-emitted on a key change.

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
| macOS Ctrl + left click | — | — | — | — | — | canvas menu at release, source `mouse`; no selection change (from 2). Before 2: toggles the selection and the native menu opens (today) |
| macOS Ctrl + left drag | — | — | — | — | — | pan (from 2); with Shift at press: turn the view unstepped; adding Cmd steps 15° (from 2) |
| Right or middle added during a left drag | ignored (U2): no pan; before 2 a right press's native `contextmenu` opens the menu unless a Scene Edit is live (today); from 2 no menu | ignored | as no modifier | as no modifier | n/a (Space-drag is already a pan) | as no modifier |
| Space held at a left press, no movement | no press reaches the tool: Plant stamp places nothing and Polygon adds no corner (today, `beginPan` claims the press first, `scene-interaction.ts:600-606`) | — | — | — | — | — |
| Space pressed during a left drag | the drag, band or move continues; Space is not a pan until the next press (a session's mode is fixed, spec) | — | — | — | — | — |
| Several modifiers at a right, middle or Mac Ctrl press | only Shift decides: with Shift, turn; without, pan. Space, Alt and mod at the press are ignored for the mode (Space+Shift+right-drag and Alt+Shift+right-drag turn; spec) | | | | | |
| Left added during a right or middle drag | ignored for the rest of that drag; no press reaches the tool | same | same | same | same | same |
| Double right-click | two menu requests; the second replaces the first | — | — | — | — | — |

Known limitation (Linux desktop): on KDE, Xfce, Cinnamon and MATE the window manager takes Alt+left-drag (move the window) and Alt+right-drag (resize it) before WebKitGTK sees them, so Alt+click and Alt+right-drag can be unreliable there. Both actions stay reachable: Shift or mod click toggles an object, and Delete on a focused or selected corner removes it (§3.2). The phase-2 Linux live check records the behaviour. Known Web limitation: Firefox shows its own menu on Shift+right-click (§2.2 "Native menu").

Rotation from the pointer is never available without Shift (user: deliberate gestures only). Release of a free rotate drag within 7° of north jumps to north about the press point (U34). Esc during any rotate drag restores the camera from before the drag.

### 3.2 Left button (pen tip, one finger) per tool

"Click" is a `tap`; "drag" is past slop; "double-click" is `clickCount ≥ 2`. Every drag in every tool accepts the wheel and keys during the drag (wheel zoom, today; key turns and resets from 1, §4.3; a right or middle press during it is ignored, U2): the draft stays under the cursor and its start stays on the ground. Space held at press pans instead (§3.1).

| Tool (key) | Click | Drag | Double-click | Shift | mod | Alt |
|---|---|---|---|---|---|---|
| Select (V) | selects the hit object; empty ground clears; a locked object is selected (Unlock is in the canvas menu and Edit, U33). From 2 (`HitFilter.fill`): a tap inside a zone's fill selects the topmost zone when no plant or note is on top (Shift or mod toggles, Alt removes); a press there changes the selection only when it resolves: its click (an up within the recogniser's slop) selects, its band replaces the selection, and a cancel keeps it | from empty ground: band select; the band is a screen rectangle and hits in its world quad (from 1). From an object or the outline of a selected zone: moves the selection. From 2 a drag that starts inside a zone's fill bands, never moves the zone. From a handle: rotate, reshape corner or vertex, guide end | on a plant: selects every plant of that species; on a note: edits its text; on a polygon edge: adds a corner (from 2, reusing `hitZoneEdge`) | click toggles the hit; drag from empty: adds the band to the selection (never box zoom); a drag that starts on an object toggles it on press and moves nothing (today, `shared-gestures.ts:233-237`); on the rotate handle: 15° object steps from the press angle (today, every phase) | as Shift for click and band (on Mac, Cmd) | click removes the hit from the selection (from 2); Alt+click on a corner handle removes the corner, minimum 3 (from 2, polygons only); Alt+drag bands as without Alt (spec) |
| Pan (H) | nothing | pans (mouse, pen, touch); no handles show while Pan is armed (as today; only Select shows them), so a press never lands on one | nothing | ignored (a session's mode is fixed) | ignored | ignored |
| Plant stamp (P) | places one plant of the chosen species at the snapped point; with no species the card asks to choose one | the press already placed; the drag does nothing more (today) | places a second plant (each press places one, today) | none | none | none |
| Plant a row (W) | on a placed plant: chooses it as the row source | draws the row from the source along the drag (past the recogniser's 3 px slop, P29); plants at the spacing interval | nothing | 45° steps against the screen axes (from 1; before: world axes). Before 2 Shift also turns snapping off | Ctrl or Cmd: no snapping while held (from 2, every OS) | none |
| Object stamp (K) | first click on a plant, zone, note or group copies it (the pick); later clicks place the pick at its source's orientation, turned by [ and ] (§4.7, A13) | nothing more than the click | places twice | none | none | none |
| Saved object stamp (no key) | places the saved stamp, level to the screen (from 1), then returns to Select (today); a drop from Favorites places it the same way (from 1) | nothing more | places once; the second press reaches Select (today) | none | none | none |
| Text (T) | places a note and opens text entry; a note created on a rotated map is level to the screen (from 1) | nothing more | nothing more | none | none | none |
| Line (L) | nothing | draws a line | nothing | 45° steps against the screen axes (from 2) | none | none |
| Measure (M) | nothing | measures; the line stays as a guide | nothing | 45° steps against the screen axes (from 2) | none | none |
| Rectangle (R) | nothing | draws a rectangle aligned to the screen, stored with `rotationDeg = bearing` (from 1) | nothing | square (from 2) | none | none |
| Ellipse (E) | nothing | draws an ellipse aligned to the screen, stored with `rotationDeg = bearing` (from 1) | nothing | circle (from 2) | none | none |
| Polygon (Z) | the press adds a corner (today); a press on the first corner finishes (3+ corners; within 8 px, 22 px on touch from 3, U41) | the press already added the corner; the drag moves nothing (today) | the second press of a double-click finishes instead of adding a corner (3+ corners, from 2) | 45° steps against the screen axes (from 1; before: world axes) | none | none |
| Handle (any tool that shows handles) | focuses nothing; handles are DOM buttons; the handle drag ends at the press point, so nothing moves (from 3, A9) | `handle-drag`; with Space held at the press: `handle-drag` today (the handle is hit before the pan check, `scene-interaction.ts:584-608`), `pan` from 2 | on a polygon edge midpoint dot (smaller and fainter than a corner: radius 4, opacity 0.5, GeoLibre's edge marker; aria "Add a corner on edge {{index}}"; shown only on an edge at least 52 px long on screen, U36; after a touch the dot is a 44 px target and shows on edges of 132 px or more, U41; while it shows, that edge's length chip sits beside it, just outside the edge, U38): adds a corner (from 2) | rotate handle: 15° steps from the press angle (today); point handles (corners, vertices, guide ends) ignore Shift and snap as usual (U36) | none | removes the corner, minimum 3 (from 2, polygons only) |

Cells the table leaves implicit:
- **Select, mod at a drag that starts on an object:** as Shift: toggles the object on press and moves nothing (today: `hasAdditiveModifier` treats Ctrl and Cmd like Shift; on Mac from 2 only Cmd, since a physical Ctrl is a right-click).
- **Select, Alt+drag from an object or a selected object:** moves the selection as without Alt; Alt changes only a click (from 2, spec; today Alt is ignored).
- **Space+Shift+left-drag:** pans; Shift does nothing, since a session's mode is fixed at start (today).
- **Space held at a press on a handle:** today and through phase 1 the handle drags (the handle is hit first); from 2 it pans, as Space at any press does (§3.1; convention), and the handle is not dragged. Fixture G3b pins today's order under LEGACY. The Pan tool has no such case: handles show only while Select is armed (`scene-interaction.ts:1283-1289`).
- **Text, click while an entry is open:** commits the entry and places nothing (today, `text-annotation-tool.ts:38-41`); the next click places a note.
- **Polygon corners (from 2, polygons only):** Select keeps `selectedCorner`, the last corner pressed without moving (a corner that moved during its drag, even back to its start, is not selected, U40), shown as the handle layer's active handle; Delete or Backspace removes it (or a focused corner: handles are tabbable), keeping at least 3; the corner now at the same index (wrapped to the first) becomes the selected corner and keeps focus if a corner had it, so Delete goes on removing corners down to 3; a press elsewhere, Esc or a selection change clears it (U37); a refused removal (a triangle) keeps the corner selected and the zone (U36). Rectangles, ellipses and lines keep their own reshape (corner insertion would need a new stored zone type).
- **Plant a row with no source:** a click or drag on empty ground does nothing; the card asks for a placed plant (today).
- **Polygon, a drag after a corner press:** `drag-start` and `drag-move` move the rubber band as hovers; neither a `tap` nor a `drag-end` adds a corner (the press did, today).
- **Alt+click on Linux desktops:** may be taken by the window manager (known limitation, §3.1); Shift or mod click and Delete on a focused corner reach the same results.

Overview (below 0.1 px/m) replaces the rows above:

| Input in overview | Behaviour |
|---|---|
| Left click | nothing: the overview draws no zones or notes, so nothing is selectable (today; U36) |
| Left drag | pans, in every tool (today; U36) |
| Shift, mod, Alt with a left click or drag | as without them: a left drag pans; a Mac Ctrl+left-drag pans as in site mode |
| Left drag with the Pan tool, Space+drag, middle-drag | pan |
| Right-drag | pan (from 2; before: nothing) |
| Shift+middle-drag | turns the view (from 1; before: pan), as in site mode |
| Any drawing, stamp or row tool | stays armed; draws nothing; the card reads "Zoom in to edit. Plants are hidden at this scale." |
| Handles, moves | none |
| Still right-click, long press, Menu key, Shift+F10, Mac Ctrl+click (from 2), pen barrel tap (today, every phase) | no menu (today's rule, convention) |
| Double-click | nothing (no note text edit, no corner added, no same-species select) |
| Esc | cancels an interrupted gesture only; never leaves the tool and keeps the selection (today; U36) |
| Arrows | with nothing selected: pan (today); with a selection: nothing (today; no nudge in overview) |
| Wheel, pinch, twist | as in site mode |
| Other keys | tool letters arm tools (today); N, Shift+N and Shift+←/→/↑ turn the view (from 1); `+`, `−`, Shift+2 and Home navigate (from 2). Mutation commands stay unavailable (`canvas-actions.ts:55` `spatialEditingAvailable`, today): Delete, duplicate, paste, `[` `]` do nothing. Enter and F2 (note edit), Backspace and Enter in a polygon draft, the Menu key and Shift+F10 do nothing (today, `scene-interaction.ts:1093-1105`) |

### 3.3 Wheel and trackpad

| Input | Pointing device: Mouse | Pointing device: Trackpad |
|---|---|---|
| Wheel or two-finger scroll, no modifier | zoom about the pointer, factor `exp(clamp(−dy × 0.002, ±1))`, so a notch zooms ×1.22 as today; no notch detection (P14) | pan by (−dx, −dy) |
| Shift + wheel | pan by (−dx, −dy) as delivered (today: no swap; Chromium on Windows and Linux and macOS already deliver a Shift+wheel notch as dx). WebKitGTK, the Linux desktop engine, is not verified: whether its notch arrives as dx or dy is recorded by the phase-2 live check; if it arrives as dy, Shift+wheel pans vertically on Linux desktop, a known limitation filed as a bead, never swapped by platform sniffing | horizontal pan: dy becomes x when dx is 0 (today, `scene-interaction.ts:847-849`); macOS's swapped axes are accepted, never swapped twice |
| Ctrl or Cmd + wheel (physical) | zoom | zoom |
| Pinch (Chromium and WebView2 synthetic Ctrl wheel; Firefox line-mode pinch) | zoom continuously, by the same path as a physical Ctrl+wheel (P14) | zoom |
| Alt + wheel | as without Alt (no rotation, convention) | as without Alt |
| Space held + wheel | as without Space | as without Space |
| macOS WebKit gesture: scale | ignored: WKWebView also delivers the pinch as Ctrl+wheel, which zooms (row above) | same |
| macOS WebKit gesture: rotation | nothing until 10° accumulated, then turns the view with the 10° subtracted; release within 7° of north snaps; Esc cancels it (from 1) | same |
| Linux WebKitGTK trackpad pinch | not delivered to the page (user): zoom with Ctrl + scroll or the buttons; the F1 gesture list shows the note on Linux | same |
| Trackpad twist on Windows (WebView2), and in Chromium or Firefox on any OS (Web edition) | not delivered: no rotation event reaches the page (the user's "where available"); turn with Shift+right-drag, the compass or Shift+←/→. gesture events exist only on WebKit (WKWebView and Safari), so F1 lists the twist only there | same |
| Wheel during a drawing, move or band drag | as above; the draft stays under the cursor (from 2, convention) | same |
| Wheel or pinch during a pointer rotate session (Shift+middle-drag, Shift+right-drag) | ignored while the rotate owns the camera, so Esc restores exactly the camera at its press (from 1, convention; fixture F18) | same |
| Wheel or pinch during a trackpad twist or a compass drag | as without them: the twist never zooms and Ctrl-wheels keep zooming; a compass drag composes with the wheel, and its cancel restores the whole starting camera | same |
| Wheel over a canvas handle (corner, vertex, midpoint, rotate, guide end) | as over the map: no handle uses the wheel (U38, fixture F15b) | same |
| Wheel over the text-entry host, the compass, the zoom group or any foreign target | not handled by the canvas | same |
| Momentum tail | handled as ordinary wheel events | same |

The Select tool card hint differs by setting (phase 2 copy in §9.3): Mouse "… right-drag pans · wheel zooms", Trackpad "… two fingers pan · pinch zooms"; on a coarse pointer it shows the Trackpad line whatever the setting (from 3, U41).

### 3.4 Touch

From phase 3 (U41; recogniser rules in §2.2 "Touch", "Long press" and "Pair"). Every touch press is held until 8 px, the lift or 500 ms, in every tool.

| Input | Every tool | Pan tool | Overview |
|---|---|---|---|
| One-finger tap | `press` and `tap` at the lift, at the down point, as the left-click column of §3.2 | press and tap (the tool ignores them) | nothing (U36) |
| One-finger drag | past 8 px, `press` at the down point and the drag, as the left-drag column of §3.2 | pans, the first move carrying the whole travel | same as the Pan tool (U36) |
| One-finger double tap | `clickCount` 2 within 500 ms and 30 px (MapLibre) | — | — |
| One-finger long press (500 ms still) | canvas menu at the finger, source `long-press`, with "Turn view to this edge" within 22 px (A11); no press reached the tool, and the lift emits nothing, so the menu stays open | menu | no menu |
| Long press then move | no menu if the finger passed slop before 500 ms (it is a drag) | — | — |
| Two-finger pan | pans by the centroid | same | same |
| Two-finger pinch | zooms about the centroid past 0.1 zoom level | same | same |
| Two-finger twist | turns the view about the centroid after 25 px of arc (MapLibre's rule); release within 7° of north snaps | same | same |
| Second finger before the first passed slop | the tool sees nothing; the pair starts | same | same |
| Second finger after a one-finger drag started | `cancel('multitouch')`: the drag is cancelled and its edit aborted; a polygon draft keeps its corners; the pair starts | same | same |
| Pair cancel (Esc, blur, `pointercancel`) | the view stays where it is; a bearing within 7° of north snaps | same | same |
| One finger lifted from two | nothing resumes until every finger is up | same | same |
| Third finger | ignored | same | same |
| Handles | after a touch press or hover, 44 px targets (`hitRadiusPx` 22) until a mouse or pen presses or hovers; the rotate handle keeps its 28 px look in a transparent 44 px box; a shape under about 44 px on screen can be reshaped but not moved by a finger (zoom in) | — | — |
| Touch on the text entry (`owned-text`: the note editor, a child of the map host) | no canvas session: a tap moves the caret, a long press selects text with the native callout, a drag scrolls or selects inside the entry; no canvas menu. The entry focuses synchronously when it opens from a touch, so iOS shows the keyboard (A15) | same | — |

Host CSS, unconditional while attached (A13): `touch-action: none; -webkit-touch-callout: none` on the map host, and `-webkit-touch-callout: default` on the text-entry host (the callout is inherited; `touch-action` is not); `overscroll-behavior: none` on `html` (`styles/global.css`), which stops a drag on the Web top bar or strip from pulling to refresh and also turns off the Web desktop browser's two-finger history swipe.

### 3.5 Pen

| Input | Before phase 2 | From phase 2 |
|---|---|---|
| Tip (contact) | primary, as the left-button rows of §3.2 | same |
| Hover | `hover` | same |
| Barrel button, drag | no pan; the native `contextmenu` the barrel fires opens the canvas menu (at press on Linux and macOS, at release on Windows), as the right button of §3.1 | pan; with Shift at press: turn the view |
| Barrel button, tap | the native `contextmenu` opens the canvas menu (at press on Linux and macOS, at release on Windows), as the right button | canvas menu at release, source `mouse` |
| Eraser | ignored | ignored |
| Tip drag with the Pan tool | pans | pans (the Pan tool exists for pens without a barrel button) |

A Wacom that Firefox on Linux reports as a mouse is handled as a mouse (documented limitation).

### 3.6 Keys

Scope and switch are defined in §1.6. "Switch" is Settings › Keyboard › single-key shortcuts: `follows` rows stop when it is off; `always` rows keep working. Mac chords replace Ctrl with Cmd for every mod row.

The Scope column is built in F (no legacy rebuild, U7); until then the keyboard port keeps today's gates.

Where the rotation rows live (phase 1): Shift+←/→ and Shift+↑ (`view-arrows`) and Shift+N (`command`, always on) are canvas key rows of `CANVAS_KEYMAP_ROWS` sending `rotate-view` and `reset-north`, never chords of a catalogue definition: catalogue rows are not in the `view-arrows` scope, so they would turn the map from an arrow-owning widget. The catalogue keeps N (`view.resetNorth`, follows the switch) and Shift+L (`view.cycleLabels`). Its rotation definitions sit after Fit to Design and show the routed chords through display-only `keyHints: readonly string[]`, also appended to `aria-keyshortcuts`. On macOS every label shows Cmd for mod (U13).

| Key | Action | Scope | Switch | Phase |
|---|---|---|---|---|
| V, H, P, W, K, Z, R, E, L, T, M | arm Select, Pan, Plant stamp, Plant a row, Object stamp, Polygon, Rectangle, Ellipse, Line, Text, Measure | `command` | follows | unchanged |
| N | reset north (a jump) | `command` | follows | 1 (was cycle labels) |
| Shift+N | reset north (a jump) | `command` | always | 1 |
| Shift+L | cycle labels: none, codes, names | `command` | follows | 1 (moved from N, convention) |
| Shift+← / Shift+→ | turn the view to the next 15° multiple left / right (a jump about the centre): from 22°, Shift+→ ends at 30°, not 37° (spec: the user said "rotates 15 degrees"; landing on the 15° grid is this document's reading) | `view-arrows` | n/a | 1 (was large nudge or large pan) |
| Shift+↑ | reset north | `view-arrows` | n/a | 1 (was large nudge or large pan) |
| Shift+↓ | unbound, reserved for tilt | — | — | 1 (convention) |
| ← → ↑ ↓ | with a selection, the Select tool armed and site mode: nudge 10 cm along the screen direction (from 1; before: world axes); with a selection in another tool or in overview: nothing (today, every phase); with none: pan 64 px along the screen, in any tool and in overview. Never while a pointer session (drag, band, move, handle drag, pan or rotate) is live: the arrow does nothing (today, `keyboard-port.ts:146`; every phase; fixture H25). While a canvas handle (corner, midpoint, guide end) holds focus the arrow does nothing (U36) | `canvas-focus` | n/a | 1 |
| mod+arrows | as the arrows, 1 m or 256 px, along the screen; on the focused map the chord is always consumed, even when nothing moves (Web Mac Cmd+← would go Back); away from the map outside text fields mod+←/→ runs nothing and is only kept from the browser (a `command` row, `keepsFromBrowser`) | `canvas-focus` | n/a | 1 (was Shift+arrows) |
| Alt+arrows | unbound | — | — | — |
| macOS Ctrl+arrows | not bound (Mission Control) | — | — | — |
| Shift+G, Shift+S | grid, snap to grid (Shift+R is unbound: rulers are gone, U33) | `command` | follows | unchanged |
| [ / ] | a held stamp: turn it −15° / +15°; otherwise send to back / bring to front | `command` | follows, except that a held stamp's turn also works on map focus with the switch off (today, `keyboard-port.ts:198-206`; fixture H24) | unchanged |
| Delete, Backspace | delete the selection, never while `CanvasKeyboardPort.holdsSelectionDeletes()` holds (a live pointer session, a still drag, twist or rotate included, or `ToolHost.holdsReorigin()`: a live press, a tool transient or an open text entry): the key is consumed (pointer session from 1; draft from 2, U33, canopi-f47t.21; Ctrl+X follows the same condition). This one condition on today's denylist (§1.6 step 10, `runSink`) is the whole key admission; there is no allowlist of keys that act mid-gesture (U33 replaced U16's). A row source, Place plants' waiting point and a held Object stamp pick are tool transients too, so Delete and Ctrl+X do nothing while one is held. Other keys stay live (U2). Backspace during a polygon draft removes the last corner instead. In Select, Delete or Backspace on a focused or selected polygon corner removes that corner, keeping at least 3 (from 2; Backspace U36; the `delete-handle` and `remove-last` rows fall back to `canvas.deleteSelected` through `runSink`) | `outside-dock` (Backspace in a draft: `canvas-focus`) | n/a | F (was `command`), corner from 2 |
| Enter | Polygon draft: finish (3+ corners). One selected note: edit its text, never while a pointer session (a still twist or rotate included) is live (from 1). Compass focused: reset north | `canvas-focus` | n/a | unchanged; compass 1 |
| F2 | one selected note with map focus: edit its text; otherwise rename the Design. While a pointer session is live on the map: nothing, and the key is consumed (from 1) | `canvas-focus`, then shell | n/a | unchanged |
| Space (held) | a left drag pans in every tool | `canvas-focus` | n/a | unchanged |
| Space (press) on a focused button | activates it (compass: reset north) | the button | n/a | compass 1 |
| Esc | the Esc chain (§3.7) | chain | n/a | per §3.7 |
| Menu key, Shift+F10 | canvas menu for the selection (beside its bounds, else mid-map); the keyboard's only route to the menu (a native `contextmenu` with no pointer press opens nothing, U34) | `canvas-focus` | n/a | unchanged |
| + / − (no modifier) | zoom in / out one step | `canvas-focus` | n/a: like a held stamp's `[` `]`, they stay on with the switch off because they act only while the map has focus (WCAG 2.1.4 allows a shortcut active only on focus), and the Settings hint and the `settings.rs` doc comment say so from phase 2 | 2 |
| Ctrl+Plus / Ctrl+Minus | zoom in / out one step | `command` | n/a | step unified in 2 |
| Shift+F, Ctrl+0, Home | fit the Design at the current bearing | `command` (Home: `canvas-focus`, spec) | Shift+F follows | Home 2 |
| Shift+2 | zoom to the selection at the current bearing | `command` | follows (spec: like Shift+G) | 2 |
| Ctrl+Alt+R | rotate the selection | `outside-dock` | n/a | F (was `command`) |
| Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y | undo, redo; during a polygon draft they undo and redo corners | `command` | n/a | unchanged |
| Ctrl+X, C, D, A, Shift+A, G, Shift+G, Shift+L | cut, copy, duplicate, select all, same species, group, ungroup, lock: they act on the map's selection from any focus but a text field and the dock or phone sheet, so a panel keeps the browser's copy and select all. Cut, which deletes the selection, does nothing while `holdsSelectionDeletes()` holds (as Delete): the key is consumed (pointer session from 1; draft from 2, U33, canopi-f47t.21) | `outside-dock` | n/a | F (was `command`) |
| Ctrl+V | paste | `command` | n/a | unchanged |
| Ctrl+K, Ctrl+S, F1, F6 | place search, save, shortcuts, next region; work in text fields, as every shell shortcut but a single key does (F2 included) | `global` | n/a | unchanged |
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

Moved keys, in one list: N (cycle labels → reset north); Shift+L (new: cycle labels); Shift+arrows (large nudge and pan → turn view and reset north; Shift+↓ unbound); large step (Shift+arrow → mod+arrow, on the canvas, in the PDF page editor and in the inspection lens); Plant a row no-snap (Shift → mod during the drag); Esc on a held Object stamp pick (leave the tool → drop it first; Plant a row already drops its source first today; Place plants' waiting point leaves with the tool, U35); Pan tool (main rail → View and Tools menus, palette, phone strip). Moved behaviour: Space held at a press on a rotate or vertex handle (the handle drags → the map pans, from 2).

### 3.7 Esc per tool

The text entry (note editor, spacing field) is not a layer: its element handler (`chrome/text-entry-host.ts`, the tool card's field) cancels it and returns focus to the map before the router's bubble listener runs (§1.6 step 8, §3.8).

| Priority | Layer | Active when |
|---|---|---|
| 100 | open popover, menu, dropdown, colour or symbol popover | open (phase F moves their document listeners into layers) |
| 80 | canvas context menu | open |
| 70 | live pointer gesture, including a rotate drag and a compass drag (the compass registers its own layer; both restore the starting camera) and, from 2, a pan (right-, middle- or Space-drag, the Pan tool: the pan ends where it is and the Esc is consumed; spec). | a drag, band, move, handle drag, pan or rotate is live |
| 65 | nudge series (abort) | arrows moved the selection and the series is not committed |
| 60 | tool transient | a polygon draft or a Plant a row source (today); from 2 also a held Object stamp pick. A tool's `escape` only drops its transient and answers `pass` otherwise; the tool layer (50) leaves. Place plants' waiting point is a transient but no layer (`escapeLeaves`): the tool layer's Esc leaves at once, the point with it (U35) |
| 50 | non-Select tool → Select | any tool but Select is armed |
| 30 | selection → clear | something is selected |
| 25 | raster inspection → end | inspecting |

From F, per layer: the gesture (70), nudge-series (65), tool-transient (60) and tool (50) layers run from every focus class except `text` and `modal`; the selection layer (30) runs only with focus class `map`, so Esc with focus in a side panel keeps the map selection (U10, user 2026-10-02). No layer closes the dock panel or the phone sheet (U11). Phase 0 keeps today's behaviour. One Esc runs one layer. In overview only layers 100, 70 (a live pan or rotate, or today's interrupted gesture) and 25 run (U36: no selection layer there); 65, 60 and 50 never run there, so Esc never leaves the tool in overview (today), and the per-tool table below applies in site mode only.

The priority table is built in F, the popover layers in the same window as the chain (fixture I8); until then the keyboard port keeps today's Esc order and popovers keep their document listeners. No canvas row matches Esc: `deselect` carries only a key hint (`app/canvas-commands/index.ts:351`) and the canvas rows come from `definition.shortcuts`.

| Tool | 1st Esc | 2nd Esc | 3rd Esc |
|---|---|---|---|
| Select | clears the selection | — | — |
| Pan | Select | clears the selection | — |
| Plant stamp | Select ("Esc to stop placing") | clears | — |
| Plant stamp, waiting placement (from 2) | Select at once; the waiting point goes with the tool (U35) | clears | — |
| Plant a row, source chosen | drops the source (today, `plant-spacing-tool.ts:205-211`) | Select | clears |
| Plant a row, during a drag (from F) | cancels the drag; the source stays | drops the source | Select |
| Object stamp, pick held | drops the pick; the card shows `stampPick` (from 2; before: Select at once) | Select | clears |
| Saved object stamp | Select at once (today; a one-shot tool, so no first Esc drops the stamp) | clears | — |
| Polygon, draft | drops the draft | Select | clears |
| Line, Measure, Rectangle, Ellipse, during the drag | cancels the drag | Select | clears |
| Text, entry open | cancels the entry | Select | clears |
| Any tool, rotate drag live | restores the camera | next layer | — |
| Any tool, pan live (from 2, spec) | ends the pan where it is; the tool stays armed | next layer | — |

Nothing reports which layer the next Esc runs: the tool card keeps its own "Esc …" hint (phase 2, p1-20). Phase 0 keeps today's order for Plant a row (INV-KEY-09): its Esc runs before the live-gesture layer, so it drops the source even mid-drag, and with no source it requests Select itself. From F the gesture layer (70) runs above the transient (60), so an Esc mid-drag cancels only the drag (plan §8).

### 3.8 Exceptions

| Surface | Rule |
|---|---|
| Text entry (note editor, the tool-card spacing field) | Focus class `text`: letters type; single-key shortcuts, Delete, arrows, Shift+arrows, N and Shift+N do not reach the canvas; the rows with `worksInTextFields` (every shell shortcut but a single key, F2 included) still work. Enter commits, Shift+Enter adds a line, Esc cancels. From phase F both are IME-safe in the entry itself: `chrome/text-entry-host.ts` ignores Enter and Esc while `isComposing || keyCode === 229`, because its element listener runs before the key router's guard. Any press on the map outside the entry, primary, middle or right, commits it first (`rawPress` on every button from 2; the map taking focus commits an entry that holds focus on its blur, and the host submits one whose blur commit was refused), so a middle- or right-drag pan or a Shift+right- or Shift+middle-drag turn closes it; while Text is armed a press that commits the entry places no note and reaches no tool (§3.2). Entering overview commits and closes any open entry (U34). One entry mode (U34): the field is drawn at the note's font size and line height. A right-click inside the entry keeps the native menu (§2.2). Space held in the entry types a space and arms no pan (fixture G11), so a Space-drag never starts from it; while an entry is open without focus (the frame before it takes focus, or after a refused blur commit), Space reaching the map arms no pan either (§1.4 "Releases"). A wheel over the map keeps the entry open and the entry follows its note; a key turn or reset cannot reach the map from the entry (focus class `text`). A still right-click (a `menu-request`) commits the entry first, then opens the menu. Esc in the entry is the entry's own element handler, which runs before the chain; no canvas pan or turn is live while it is open. Wheel over the entry itself is not handled. The textarea is drawn at `rotationDeg − bearing`. |
| PDF page editor (`components/canvas-pdf/PdfPageEditor.tsx`) | A separate surface with its own pointer handling and its own element key handler (no pushed scope); the canvas input pipeline does not run there. See the table below. |
| Modal dialogs | Only the modal's element handlers and `worksInModal` rows (§1.6 step 5). |
| Story presenter | A modal (`StoryPresenter.tsx:36` holds the modal layer) whose own root `onKeyDown` handles its keys (no pushed scope): Space, arrows and Esc navigate the story; no canvas keys (fixture I12). Each step restores its bearing. |
| Canvas context menu, popovers | Their own arrows; Esc closes one at a time. |
| Arrow-owning widgets (lists, sliders, tabs, menus) | Plain and Shift+arrows stay with the widget; N, Shift+N and other `command` keys act on the canvas unless the widget claims them with `data-owns-keys`. |
| Inspection lens preview | Arrow-owning: arrows move the lens along the screen; mod+arrow moves farther (spec, matching the canvas; was Shift); Shift+arrows move by the plain step (from 1). Drag is screen-relative. |
| World map (template and place picker) | Its own MapLibre map: north-up, left-drag pans, wheel zooms, a touch pinch zooms with rotation disabled (from 3, U41), no rotation, no compass; `boxZoom: false` from 2 (convention; Shift+drag box-zooms it until then). Its keyboard handler keeps arrow pans and +/− zoom but `disableRotation()` stops Shift+arrows turning and tilting it (from F); its container declares `data-owns-keys="arrows"`, so Shift+←/→/↑ never reach the workspace view from it (from 1, fixture H26). |
| Inspecting a raster (Desktop LiDAR inspection) | A plain primary press (mouse left, pen tip, and a one-finger tap) anywhere on the map samples the point instead of reaching the tool, after handles and the pan check and before the tool (today, `scene-interaction.ts:609-614`; ToolHost `deps.inspect`, fixture J10). Shift, mod or Alt at the press still samples (today: the probe reads no modifier); the sampled press starts no drag, band or move. Space+drag and a Pan-tool drag pan (the pan check comes first), and a Pan-tool click does not sample (today); from phase 3 a touch probe samples at the press the recogniser resolves (§3.4), as a mouse does; a long press or a pinch resolves no press and samples nothing (A16). In overview the probe never runs (overview presses pan, today; U36). Right, middle and pen-barrel input, the canvas menu, wheel and every rotation input are unchanged; Esc layer 25 ends inspecting. |
| Compass, zoom group, attribution | A press there never starts a canvas gesture: the zoom group and compass sit beside the host (`foreign`); the attribution inside it is `owned-chrome` through `.maplibregl-ctrl` and no longer starts a band (phase F). |

PDF page editor, every phase unless marked (today: `PdfPageEditor.tsx:60` accepts only button 0; `:106-107` arrows):

| Input | Behaviour |
|---|---|
| Left drag (mouse), pen tip, one finger | moves the page window, or draws a Print Area while adding (pointer events: pen and touch act as the left button, today) |
| Shift, mod or Alt during a page-window drag or a Print Area draw | nothing: the Print Area is drawn free, not squared (convention; the canvas rule "Shift constrains every drawing tool" covers canvas tools only) |
| Right, middle, pen barrel (press, drag, click) | nothing; no canvas menu and no pan (the editor has no context menu) |
| Wheel, pinch, trackpad twist | nothing (no wheel handler); the wheel scrolls the dialog as it does elsewhere |
| Two-finger touch | nothing over the editor: its interactive SVG sets `touch-action: none` (`PdfPageEditor.tsx:102`), so the browser neither scrolls nor zooms; touch users scroll the dialog outside the editor |
| Space held | nothing |
| Arrows | move the page window 5 pt, so ArrowLeft moves the content left, as a drag does (today; kept, U12, user 2026-10-02) |
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

Rotation starts only from deliberate inputs (user): Shift+right-drag (from 2), Shift+middle-drag (from 1), macOS Ctrl+Shift+left-drag (from 2), pen barrel + Shift (from 2), Shift+← and Shift+→ (from 1), the compass ring (from 1), a macOS trackpad twist past 10° (from 1), a two-finger touch twist past 25 px of arc (from 3), "Turn view to this edge" (from 1), and restores (saved views, stories, a file's `map_view`). There is no Alt+wheel rotation and no setting to turn rotation off.

### 4.2 Compass

- **Place.** Always visible (at north too): in the zoom group on desktop and in the phone zoom column on the Web edition (from 1). As a button inside that group it inherits the group's layer on the stacking scale and its visible-map-area registration (`useMapOccluder` in `ZoomControls.tsx`); it adds no entry to `global.css` or the seam, and its size comes from the `.button` class `ZoomControls` passes in. Its look is set in `.interface-design/patterns/canvas-navigation.md`: a round button whose needle, an inline SVG coloured from the compass's CSS module (not a `ControlIcon` glyph), points to true north, turned by `−bearingDeg`. Its styling and description follow `northUp`.
- **Click.** Jumps to north about the centre (U34); at north it does nothing.
- **Drag.** A primary drag anywhere on the compass face (the hit area is the whole button, though the copy says "ring"; past the canvas's drag slop, `DEFAULT_THRESHOLDS.dragSlopPx` (3 px for a mouse or pen, 8 px for a finger; U17, from 3); under that it is a click) turns the view about the screen centre by the pointer's angle around the compass centre (`beginRotation('centre')`); the needle follows the pointer, so moving clockwise around the face lowers the bearing by the angle swept (§2.2, rotation sign). Shift steps to absolute 15° multiples while held, re-read on each move; release returns to the raw angle. Release within 7° of north snaps to north (a jump). The button takes focus at `pointerdown` (`focus({ preventScroll: true })`); `pointercancel`, `lostpointercapture` and blur cancel the drag. A wheel during the drag composes with it (§3.3). Works with mouse, pen and touch from phase 1 (the compass sets `touch-action: none`). While dragging, the face takes `--color-accent-soft` and a grabbing cursor (pattern).
- **Keyboard.** A focusable button: Enter or Space resets north; Shift+←/→ turn as anywhere; Esc during a compass drag restores the starting camera: while dragging, `Compass.tsx` registers an Esc layer at priority 70 (`registerEscapeLayer`, active while its `RotationSession` is live) that calls `cancel()`, because the compass drag runs outside the input pipeline and `ToolHost.hasLiveGesture()` cannot see it (fixture I9). An Esc before the drag threshold ends the press, so the release does not reset north.
- **Words.** Action, label and shortcut come from Keyboard's `reset-north` command: `aria-label` is its label ("Reset north") and `aria-keyshortcuts` its `ariaShortcut`, which already holds N and Shift+N. The bearing text, "View turned {{degrees}}° from north" (Intl number) or "North is up", is a visually hidden span named by `aria-describedby` (not `aria-description`). No `title`: a `ButtonTooltip` shows "Reset north" with N and the hint as its second line (pattern `canvas-navigation.md`).

### 4.3 Reset and turns jump

Reset north comes from N (follows the switch), Shift+N (always), Shift+↑, a compass click, View › Reset north (phones share the View menu) and the palette. Every turn jumps, with no animation (user, 2026-10-06, U34): resets, key steps, a compass click, "Turn view to this edge" and the ≤7° snap to north are one `rotate-around` move about the screen centre (the snap about the gesture pivot). Three Shift+→ presses end at 45°. A running flight (saved views, stories) is interrupted by any move, which lands at the flight's target bearing.

Turning while something else is live (convention):
- **During a primary drag in phase 1** (a band, move, draw or handle drag): key turns, resets and a compass click apply, and the draft stays in world space, like a wheel zoom during a drag today; the ToolHost re-emits the drag on the camera frame. The trackpad twist starts no rotation while a primary session is live (one session at a time, §2.2). From phase 2 the same holds for every navigation input (§3.2).
- **During a live rotate session** (Shift+right- or Shift+middle-drag, a trackpad twist, a compass drag), every phase: key turns, resets and compass clicks are ignored; the session owns the bearing until it ends.
- **The snap to north after a rotate release** is a jump like a reset, and it is not an Esc layer (Esc after it does not restore the pre-release bearing).

Fixtures: "Shift+→ during a left drag keeps the draft's start on the ground" in `tools/tool-host.test.ts`, through the tool harness (phase 1); "Shift+→ during a rotate drag does nothing" and "Esc during the snap to north does not restore the bearing" in `view/navigation.test.ts`.

### 4.4 Snapping and steps

| Rule | Applies to |
|---|---|
| Snap to north on release within 7° (`angularDistanceToNorth`), a jump about the gesture pivot | free gestures: pointer rotate drags, compass drag, touch twist, trackpad twist |
| 15° steps while held, absolute multiples (`roundToStep`), raw angle again when released | mod added during Shift+right-drag or Shift+middle-drag (recorded resolution: Shift is already held); Shift during a compass drag |
| A Mac Ctrl that made the press a right click never steps | macOS Ctrl+Shift+left-drag; adding Cmd steps |
| Next 15° multiple in the key's direction (22 → 15 → 0; 0 → 345) | Shift+← and Shift+→ |
| Never snapped | explicit targets: "Turn view to this edge", saved views, stories, `showPlace`, `centerOn` with a bearing, a file's `map_view`; a saved view at 3° restores at 3° |
| No stepping | touch and trackpad twist |

### 4.6 Grid, snapping and guides

- The grid, grid snapping and measurement guides stay on true east and north (world axes) and turn with the map (user). From phase 1 the grid is drawn in `worldRoot` under plants, notes, labels and drafts (convention), on the snap lattice (§1.5).
- There are no rulers, ruler guides (the lines pulled out of rulers) or Snap to guides (user, 2026-10-05, U33): they go in the phase-2 cut stage with the rulers hint, the Rulers toggle and Shift+R. The scale bar stays.
- Measurement guides (the Measure tool, PDF field dimensions, overview measurements) are world lines and turn with the map; their labels stay upright. They depend on no ruler-guide code (checked at phase 2's design check: `getGuideLineVisual` and grid snapping already sit in neutral modules), so the cut stage deletes `canvas/guides.ts` whole.

### 4.7 Objects created on a rotated map

| Object | Rule |
|---|---|
| Rectangle, ellipse | drawn aligned to the screen (`screenAlignedRect`: the unturned box about its centre), stored with `rotationDeg = normaliseBearing(bearing)` (user; identical at 0) |
| Note | created level to the screen, stored with `rotationDeg = normaliseBearing(bearing)`; at bearing 0 it writes 0 instead of null, which renders identically |
| Object stamp | the held pick starts at 0, so copies keep their source's orientation, like Paste and Duplicate; [ and ] step 15° from there (convention) |
| Saved stamp | the held pick starts at `rotationDeg = normaliseBearing(bearing)` when the stamp is chosen, so it reads as saved relative to the screen, and keeps that ground angle when the view turns, as an Object stamp pick does; a saved stamp dropped from Favorites, and its dragover ghost, take the bearing at drop time (convention) |
| Stamp angle on the tool card | `rotationDeg` minus the pick's start, so a fresh pick reads 0°, never "turned 30°" |
| Paste, duplicate | keep north-relative geometry |
| Polygon, line, measure, plant row | vertices are where the pointer is; Shift constrains to 45° against the screen axes (the host passes `screenAxesInWorld()`, bit-identical at 0) |
| Print Area drawn on an "As on screen" page | level with the page; the area has no angle of its own (one layout angle, §4.12) |

### 4.8 Labels and text orientation

Notes are map objects: stored `rotationDeg` is clockwise from true north (null reads as 0), and the text is drawn at `rotationDeg − bearing`, so notes turn with the map. Everything else stays upright on screen: plant glyphs (side-view pictograms), plant names and measurement readouts, stack badges, guide labels, draft labels, handles and the hover tooltip. Billboards are never under a rotating container.

### 4.9 Hit testing and band select

Hits are world-space and unaffected by bearing; pixel tolerances convert through `metresPerPixelAt`. The band is drawn as a screen rectangle and hits everything in its world quad (the band's corners through `screenAxesInWorld`, `tools/select/band.ts`, → `hitInQuad`); the draft is a `quad` shape. `hitInQuad` is a polygon test against shapes and a circle test for plants, never the quad's world box; `hitAt` with `toleranceScreenPx` returns the nearest polygon, rectangle (from its turned corners) or line edge; both skip hidden layers. Selection handles, and the keyboard menu's anchor, use the selection hull: the screen box of the shapes the selection draws, as a world quad (`tools/select/selection-hull.ts`, INV-XF-22), never the box of its world bounds; the rotate handle is centred 28 px above the projected hull on screen; 48 px while the selected polygon shows midpoint dots, so it clears a dotted edge's chip (U38, canopi-f47t.29). The note hit box is the rotated text box, north-relative, the same model as print and GeoJSON.

### 4.10 Saved views and stories

- Capture writes `SavedViewCamera.bearing`, normalised locally (P10: rounded to 1e-6, 360 folded to 0), and the ground size of the framing rule below. `SavedView.extent` is deleted (no reader; C6), and recapture does not write it back.
- User captures (Save view, story restore) record the live frame's camera (`captureView().camera`), including mid-flight, never its `bearingTarget()` (convention, 2026-10-03). PDF open is the exception: it holds the bearing a running flight ends at, so pages are never laid out at an angle a flight only passed through (`app/canvas-pdf/live.ts`, `canvas-pdf-workflow.test.ts`).
- One framing rule (U21 and U23, user 2026-10-03; built in the 2.0 bug fixes, canopi-f47t.17). `SavedViewCamera` gains an optional ground size, `ground_size_m {width, height}`: the visible ground in metres along the view's turned frame, positive, finite, at most 1e8 m, checked on both trust boundaries. It is required (U33): every saved view and `map_view` records it, capture clamps each side to the 1e8 m cap, and a zero-size map saves no view; only development files lacked it, so the format changes in place at version 9 (ADR 0021). Going to a saved view or story step fits that turned rectangle into the whole map at the saved bearing, including what floating panels and the story card cover (U23): `zoom = saved + min(0, log2(min(W·mpp/w, H·mpp/h)))`, with mpp from the stored zoom, and the saved zoom itself within 1e-6. The same window gives back the exact saved camera, a smaller one zooms out just enough that nothing framed is cut off, a larger one shows more and never zooms in past the saved zoom. Thumbnails use the same rule and show the framed area, with no redraw on resize. While presenting, the current step refits with a jump when the settled screen changes (full screen ends, the window resizes).
- Story restore after presenting stores `captureView().camera` and returns through `showCamera`. Stories restore each step's bearing; restores are explicit targets and never snap.
- `ViewSnapshotCamera` carries the bearing with its validation. `LastView` carries no bearing (U33).

### 4.12 PDF

- A two-option control labelled "Map orientation" under Plant colours (placement and look: `.interface-design/patterns/canvas-navigation.md`, Export planting plan); it is not the paper "Orientation" of a page. North up (default) and As on screen.
- **One angle for the whole layout** (user, 2026-10-01): 0 under North up; under As on screen the view's bearing, read at each capture (`captureView().camera.bearingDeg`, exact) and constant while the workspace is open. Every page, the overview and each Print Area's, is drawn at it, so Print Areas carry no angle of their own (no `PdfPrintArea.rotationDeg`). `PdfPlan.angleDeg` records it.
- One layout frame per plan, `pageFrame(angle)` about the plan origin, applied once per build: the layout runs on `turnSnapshot(snapshot, frame)`. North up is the identity.
- Page windows on the overview are today's rectangles, since every area shares the overview's angle; the overview's coverage fit (`fitOverview`) is today's.
- Print setup is stored independently of the frame: a Print Area is its centre in plan metres plus its size along the page axes, and page-editor offsets are plan metres. Each build converts them, so switching Map orientation, or reopening the workspace at a new bearing, turns every area about its own centre with the layout and keeps each level on its page (convention; plan section 8, named with U3). The sheets of one split share the split's centre and turn together about it, so they keep tiling the area they replaced; an area added with Add whole design refits to the printed design at every build, at the layout angle (convention, 2026-10-03).
- Overview guide bands (`overview-guides.ts`): "horizontal" means horizontal on the page, in the turned frame; on an As on screen overview the band follows the screen's horizontal.
- Split sheets split along the page's axes in the layout's frame; split and detail lookup use the turned plants; every sheet keeps the layout angle.
- The page editor turns its screen deltas back by `fromFrame` (+angle) before applying them to the ground. Its arrows keep their direction (U12); mod is the large step (`metaKey` on a Mac, else `ctrlKey`), and Shift, like Alt, is ignored.
- The north arrow ("North arrow and scale") always points to true north: it is drawn at `−angle` with its letter. The scale bar is unchanged.

### 4.13 Inspection lens

The lens turns with the view (convention): its local transform is built at the live bearing, so the loupe matches what is under the pointer. Its plant glyphs are drawn in screen space at `lensView.worldToScreen(position)`, unrotated, so they stay upright; names, rings and the cull go through the same transform. The layout splits into `inspectionScale(…)` and `inspectionLayout(plants, lensView, …)`, and `inspection-lens.ts` builds the transform between the two calls. Its drags and arrows are screen-relative (`panByScreen`, §1.1a); mod is the large step. It does not take focus when it opens (user, 2026-10-06, U34, canopi-f47t.24): while it shows, arrows nudge and Esc clears on the map, and its own keys (Esc closes it) work after a click or Tab into it.

### 4.14 Scale bar and zoom limits

The scale bar and 1:N ratio read the ground resolution at the screen centre, which does not depend on the bearing at pitch 0. The zoom floor ignores the bearing (user, 2026-10-06, U34): zoom ≥ log2(hypot(w, h) / 512), so the screen diagonal fits in one world copy at any bearing, and the pan hold keeps the centre half the screen diagonal inside ±85.05° and ±180°. The world view therefore stops 0.14–0.5 zoom levels sooner than a north-up floor, cannot pan at the floor, and panning stops 43–749 px short at ±85° and ±180°; a turn never changes the zoom. `zoomLimit` reports `min` at the floor, so the zoom-out button disables correctly.

### 4.15 Opening a Design and the last view

Every open (the first load, a replace, the first generation) goes through `document-surface.ts`'s open fit, which calls `openAt(openingBearing, saved)`. A file saved with its view (`map_view`, U28) opens at that view's centre and bearing, its framed ground fitted into the whole map by the saved-view rule (U21, U23), in any window (user, 2026-10-04). A file without it opens on the fit at the live bearing (`bearingTarget()`, so no 750 ms settle lag), north up on the runtime's first open; `LastView.bearing` and the open-at-last-bearing fallback are gone (U33). `readLastView` returns the centre and zoom; the new-Design clamp lives in `construction.ts`. `openAt` opens an empty scene at 0, so a new or empty Design opens north-up at the zoomed-out last-view centre and "Where is your site?" appears over a north-up overview (convention). Fit, Fit to Design, zoom to selection, temporary focus and place search keep the current bearing.

### 4.16 Turn view to this edge

A canvas-menu entry when the menu request's point lies within the edge tolerance of a polygon, rectangle or line zone's edge (convention; ADR 0015's "a zone edge"), locked zones included, since it only moves the view. In the empty-map menu it is its own first group; in the selection menu it sits before Lock. The edge is not highlighted while the entry is (user, 2026-10-01: no `highlightEdge` hook). Native sources (a mouse right-click, from 2 a Mac Ctrl+click, a pen-barrel tap) use 8 px; a long press uses 22 px (from 3, A11). The keyboard menu (the Menu key and Shift+F10) has no point, so it never offers it: the entry is pointer-only, a named exception to the keyboard-path rule of `system.md` (the keyboard turns the view with Shift+←/→). Ellipse zones have no edges and never offer it. It turns the view by the smaller angle that makes the edge horizontal on screen, as a jump about the centre (U34), never snapped. The bearing is saved with any saved view captured afterwards.

### 4.17 World map

North-up, no rotation, no compass; left-drag pans (a navigation-only picker); Shift+arrows no longer turn or tilt it (phase F); Shift+drag no longer box-zooms (phase 2, convention).

### 4.18 Web Edition phone layout and touch

- Phase 1: the compass joins the phone zoom column after the ratio, and the View menu, which phones share, gains its three rotation rows (convention), so a phone user who opens a rotated Design (its `map_view`, a saved view, a story) can always return north. The compass ring turns the view by touch from phase 1.
- The Pan tool stays in the phone strip in every phase.
- Phase 3 (U41): two-finger pan, pinch and twist; long press opens the menu; one finger edits; 44 px handle targets after a touch. The phone zoom column is zoom in, zoom out, Fit to Design and the compass: the ratio leaves phones, which have no scale bar either. On a touch screen (`hover: none`) a tooltip shows only on keyboard focus, and on a coarse pointer menu rows are at least `--control-size-touch` (44 px) tall.

### 4.19 Re-origin

The session plane stays north-aligned whatever the bearing. Re-origin runs on the settled frame when the ground under the screen centre is more than 10 km from the origin; the camera keeps its ground (the MapLibre driver's camera is geographic, and the headless driver applies the plane change to its `PlanarCamera` in plane terms, as today's reprojection does), so the map does not move. The temporary-focus bookmark and handles survive it. From phase 2 (P8) re-origin waits while the tool host holds it (`holdsReorigin()`: a live press, a tool transient such as a draft, a row source, a stamp pick or Place plants' waiting point, or an open text entry), checked in `observe()` and again in `reoriginAt()`; when the hold clears it re-runs `observe` on the last frame, so a long pan during a hold is not left at the old origin. A plane change hides tool ghosts until the next hover only when no pointer rests on the map (a still pointer's re-emitted hover redraws them); no tool re-projects anything (`syncPlane`, `CanvasTool.planeChanged` and the tools' hooks go). Accepted (named at handoff): while a row source, a stamp pick or a waiting placement is held, the plane's metre scale drifts by tan(lat)·Δnorth/6371 km (0.16 % at 10 km and 45°, 0.8 % at 50 km, 7.8 % at 500 km; nothing east-west), and grid-snapped points, row spacing, typed rectangle sizes and stamp offsets made then keep it.

## 5. Synthetic event-sequence tests

Recogniser fixtures live in `canvas/runtime/input/__fixtures__/sequences.ts` and run through `normalise` and `recognise` with an injected platform, clock and thresholds. Each is named by its id and title, for example `seq('A1 Windows right-click', { os: 'windows', engine: 'chromium' })`. "V2" names the behaviour from phase 2 (touch from phase 3), "LEGACY" the behaviour in phase 0 and F (§0); unless a row says otherwise a V2 expectation also holds from phase 3. The phase that changes a behaviour rewrites the fixtures whose outcome changes and deletes the superseded expectations (audit 1.2), so only the end state remains.

A property test (`input/recognise.property.test.ts`) covers any interleaving of down, move (with changing `buttons`), up, cancel, reject, blur, escape, configure, `tick` and touch moves and ups (A17): every started session ends exactly once, every press the host sees ends with exactly one `tap`, `drag-end` or `cancel` (a Pan-tool drag's with `cancel('navigate')`; a reject ends its session with no gesture), and every `capture` effect is paired with a release.

### 5.1 Secondary button

| Id | Platform | Sequence | Expect (V2) | Expect (LEGACY) |
|---|---|---|---|---|
| A1 Windows right-click | windows/chromium | down(2) → up(2) within 1 px → contextmenu +66 ms | one `menu-request(release point, mouse)` on up; the contextmenu is prevented by the source's listener and never reaches the recogniser | contextmenu opens the menu |
| A2 Windows right-drag | windows/chromium | down(2) → moves `buttons 2` to (+100, +80) → up → contextmenu | `pan` deltas summing to (100, 80), the first including the sub-slop offset; the trailing contextmenu prevented (within 500 ms of the secondary release); no menu | no pan; menu on the trailing contextmenu |
| A3 Linux right-click | linux/webkitgtk and chromium | down(2) → contextmenu → up(2) | contextmenu prevented; one menu on up | menu at the contextmenu |
| A4 Linux or macOS right-drag | linux, mac | down(2) → contextmenu → moves → up | pan; no menu | menu at press; no pan |
| A5 Right press, pointerup lost | linux | down(2) → contextmenu → move `buttons 0` | session ends silently; no pan from that move; no menu; next down starts fresh | — |
| A6 WKWebView capture then nothing | mac/webkit | down(2) → contextmenu → lost capture | `cancel('lost-capture')`; no menu; nothing stuck | — |
| A7 Right-drag then pointercancel | any | down(2) → moves → pointercancel | `cancel('pointercancel')`; the camera keeps the panned position; no menu | — |
| A8 Windows retargeted late contextmenu | windows/chromium | down(2) → up(2) → contextmenu on `<html>` or the open menu | a `dom-input-source.test.ts` case (only the source sees it): one menu; the retargeted contextmenu is prevented by the listener's 500 ms rule | — |
| A9 Right-drag in every tool | each of the 12 tools, polygon with 2 corners | A2 | `pan` only; the tool receives no press or drag; the polygon keeps its corners | — |
| A10 Left pressed during a right-drag | any | down(2) → moves → move `buttons 3` → move `buttons 2` → up(2) | pan continues; no press reaches the tool; no selection change | — |
| A11 Right pressed during a left drag | any | down(0) → moves `buttons 1` → move `buttons 3` → (linux) contextmenu → moves → move `buttons 1` → up(0) | ignored (U2): no pan; the band continues and commits; contextmenu prevented; no menu | no pan; the band continues and commits; the native contextmenu opens the menu unless a Scene Edit is live (today) |
| A13 Shift+right-drag with mod steps (spec) | windows, linux | down(2, Shift) → moves right → mod pressed (key-state) → moves → mod released → up | `rotate` with `step` false, then true, then false, `totalDeltaDeg` positive (rightward raises the bearing); `rotate{end}` on up | nothing |
| A14 Esc during a right rotate (spec) | any | A13 without mod → `escape` | `rotate{cancel}`; no menu | — |
| A15 Right-click in the note editor (spec) | linux, windows | down(2) on the text-entry host (`owned-text`) → contextmenu → up(2) | contextmenu not prevented (native text menu); no `menu-request`; no session | same |
| A16 Right-click on a dock input (spec) | any | down(2) on a panel field (`foreign`) → contextmenu → up(2) | nothing emitted; contextmenu not prevented | same |
| A17 Esc during a right-drag pan (spec) | any | A2 until mid-drag → `escape` → more moves → up(2) | `pan{end}` at the escape; no pan after the Esc (hovers only); no menu on up | — |
| A18 Shift after the press (spec) | any | down(2) → key-state Shift → moves past 3 px → up(2) | `pan`, not `rotate` (Shift at the press decides) | no pan |

### 5.2 macOS Ctrl+click

| Id | Platform | Sequence | Expect (V2) | Expect (LEGACY) |
|---|---|---|---|---|
| B1 macOS Ctrl+click | mac/webkit, chromium, gecko | down(0, ctrl) → contextmenu → up(0, ctrl) → (Safari, Firefox) click | `menu-request(at, mouse)` on up; no selection toggle; click ignored | additive toggle and the native menu |
| B2 macOS Ctrl+drag | mac | down(0, ctrl) → contextmenu → moves → up | `pan`; no band; no menu | band with additive toggle; menu |
| B3 Ctrl+click on Windows and Linux | windows, linux | B1 without contextmenu | `tap` with ctrl → additive toggle; no menu | same |
| B4 macOS two-finger trackpad click | mac | down(2) → contextmenu → up(2) | as A3 | as A3 legacy |
| B6 Mac Ctrl+Shift+click drag | mac | down(0, ctrl, shift) → moves → Cmd pressed → moves | `rotate` unstepped; `step` true after Cmd; Ctrl never steps | band |
| B7 Mac Ctrl+drag never opens the menu | mac | B2 with the contextmenu at press | pan; the contextmenu is prevented; no `menu-request` on up | — |

B5 is not used.

### 5.3 Keyboard menu

The keyboard menu comes only from the keymap row (phase 2, U34): a native `contextmenu` never opens a menu, so no echo is recorded.

| Id | Sequence | Expect |
|---|---|---|
| C1 Menu key on Windows | focus map; keydown ContextMenu → keyup → contextmenu on the map host | one `menu-request('selection', keyboard)` on keydown; the contextmenu is prevented and opens nothing |
| C2 Shift+F10, both orders | keydown F10+Shift → contextmenu before or after keyup | one menu request |
| C3 Menu key held | keydown, 3 repeats, keyup, contextmenu | one menu request |
| C4 Menu key in the text entry | focus text | no request; native text menu allowed |
| C5 Native menu with no press | contextmenu on the map host with no pointer press (a pen press-and-hold, VO+Shift+M) | prevented; no menu (U34) |

### 5.4 Pen

| Id | Sequence | Expect (V2) | Expect (LEGACY) |
|---|---|---|---|
| D1 Pen barrel tap | pen down(2) → up(2) → contextmenu | one `menu-request(at, mouse)` on up; contextmenu prevented | nothing from the barrel; native menu today |
| D2 Pen barrel drag | pen down(2) → moves → up | `pan` | nothing |
| D3 Pen tip draw | pen down(0) → moves (coalesced samples) → up | primary drag; samples fall back to the event | same |
| D4 Eraser | pen down(5, buttons 32) → up | nothing | nothing |
| D5 Pen hover | pen moves `buttons 0` | `hover` only | same |
| D6 Wacom as mouse (Firefox on Linux) | D3 with `pointerType mouse` | mouse drag; documents the limitation | same |
| D7 Pen barrel + Shift drag | pen down(2, Shift) → moves; add Cmd or Ctrl (mod) during the drag | `rotate` unstepped, then 15° steps while mod is held | nothing from the barrel |

### 5.5 Touch and trackpad gestures

| Id | Sequence | Expect |
|---|---|---|
| E1 One-finger tap | touch down → up | from phase 3: `press` then `tap` at the up, at the down point (A2); no hover left behind |
| E2 One-finger drag | touch down → moves → up | from phase 3: nothing until 8 px, then `press` at the down point and the drag (band or draw), never pan; host `touch-action: none` asserted by a DOM test |
| E3 Browser steals the touch | touch down → 2 moves → pointercancel | `cancel('pointercancel')`; no half band committed |
| E4 Two-finger pan, zoom, turn | id1 down, id2 down, both move, id2 up, id1 up | from phase 3: nothing for id1 (its press was held); `pan` by centroid, `zoom` past 0.1 zoom level, `rotate` after 25 px of arc, all about the centroid; after id2 up the remaining finger does not resume |
| E5 Second finger after a drag started | one-finger draw past slop, then id2 down | from phase 3: the draw is cancelled, not committed; a polygon draft keeps its corners |
| E7 Long press | touch down, hold 600 ms, up | from phase 3: `menu-request(long-press)` from the timer; no press or tap; the up emits nothing, with `prevent-default` and `stop-propagation` (A4). Android's `contextmenu` during a held press is prevented by the DOM source (a DOM test, which replaces E6) |
| E8 Long press with movement | move past slop at 200 ms, hold, up | drag; no menu |
| E9 Trackpad pinch with rotation drift | mac/webkit: gesturestart → changes with scale 1.2, 1.5 and rotation ±4° → gestureend | no `rotate`; no `zoom` from the gesture (the pinch zooms through WebKit's Ctrl wheels, F12) |
| E10 Deliberate trackpad twist | mac/webkit: rotation 5°, 12°, 20° (WebKit `rotation` is clockwise-positive) | nothing at 5°; `rotate` starts at 12° with `totalDeltaDeg` −2°, then −10° (the ground follows the fingers: a clockwise twist lowers the bearing); snap on end if within 7° of north; defaults prevented |
| E13 A pinch with a tool armed | from phase 3, Plant stamp, Polygon or Select armed: id1 down, id2 down 40 ms later, both move | no `press` reaches the host: no plant, no corner, the selection unchanged; `pan`/`zoom` only |
| E14 A long press with a tool armed | from phase 3, Plant stamp armed, then Polygon armed: touch down, hold 600 ms, up | the menu opens; no plant placed; no corner added |
| E15 Touch in overview and the Pan tool | from phase 3: hold 600 ms; drag 120 px; pinch | overview: no menu, the pan carries the whole travel, the pinch zooms; Pan tool: the hold opens the menu, the drag pans |
| E16 A third finger; a pair cancelled | from phase 3: a pair, then a third finger; a pinch-twist of 40°, then blur | the third finger is ignored; after the blur the view stays and a bearing within 7° snaps (A6) |
| E12 iOS gesture events alongside pointers | from phase 3, ios (an iPad desktop user agent too, A8): id1, id2 down → gesturestart → gesturechange(1.5, 10°) → pointer moves → gestureend | one source of truth (the pointer recogniser); `gesture*` prevented, not counted twice |

### 5.6 Wheel and trackpad

| Id | Sequence | Expect |
|---|---|---|
| F1 Windows wheel notch, Mouse | wheel dy 100 | `zoom(pointer, exp(−0.2))`, ×1.22 as today, `source: 'wheel'` (no notch detection, P14) |
| F2 Same, Trackpad | wheel dy 100 | `pan(0, −100)` |
| F3 Firefox line mode | wheel deltaMode 1, dy 3 | dy normalised to 48 px; guard test that `deltaMode` is read first |
| F4 Chromium pinch (synthetic Ctrl) | wheel ctrl, dy −2.3, no Control keydown | `zoom(factor > 1)`, `source: 'wheel'`, in both settings: the same path as F5; default prevented |
| F5 Real Ctrl + wheel | keydown Control → wheel ctrl dy 100 → keyup | zoom, same path, clamped |
| F6 Trackpad scroll, Trackpad | wheel dx 3.5, dy −7.25 | `pan(−3.5, 7.25)` |
| F7 Trackpad scroll, Mouse | same | zoom on dy; dx ignored (today) |
| F8 Shift + wheel, Trackpad, one axis | Trackpad: wheel shift, dx 0, dy 100 | `pan(−100, 0)` (LEGACY pins it: today's swap) |
| F9 Shift + wheel, macOS swapped | Trackpad, mac: wheel shift, dx 100, dy 0 | `pan(−100, 0)`; never a double swap |
| F10 Shift + wheel, Mouse | Mouse: wheel shift, dx 0, dy 100 | `pan(0, −100)` (LEGACY pins it: today's Mouse Shift+wheel pans as delivered, no swap) |
| F10b Shift + wheel delivered as dx | Mouse: wheel shift, dx 100, dy 0 (Chromium, and WebKitGTK if the live check shows dx) | `pan(−100, 0)` |
| F11 WKWebView pinch and rotate | gesturestart → change(1.2, 5°) → change(1.5, 12°) → end | no `zoom` from the scale; `rotate` starts only past 10° (total 2° at 12°) |
| F12 WKWebView pinch with Ctrl wheels | gesturestart → wheel ctrl → change(1.1) → wheel ctrl → end | each Ctrl wheel zooms, `source: 'wheel'`; the gesture's scale is never read (p1-7) |
| F13 WebKitGTK pinch | no DOM events | none possible; a manual release check records the documented absence |
| F14 Momentum tail | 20 small wheels at 16 ms, a pointerdown during the tail | wheels stay standalone; the press starts a fresh session |
| F15 Wheel over owned text | wheel on the text-entry host | not prevented; no output |
| F15b Wheel over a handle (U38) | wheel dy 100 on a corner, a midpoint, the rotate handle and a guide end, Mouse; then Trackpad | prevented; as F1 (Mouse) and F2 (Trackpad), as over the map |
| F16 Page mode | wheel deltaMode 2, dy 1; then dx 0.25 at host width 400 | dy = host height; dx = 100 (a page of dx is the host width) |
| F17 Alt + wheel (spec) | wheel alt, dy 100, Mouse | zoom as without Alt; never `rotate` |
| F18 Wheel during a pointer rotate (convention) | down(1, Shift) → moves → wheel dy 100 → moves → up | `rotate` continues; the wheel emits no `zoom` (pointer rotate sessions only; a twist does not stop Ctrl wheels) |

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
| G7 V2 overview left drag (mouse and touch) | V2, mode overview: down(0) → moves → up | `pan` (`primary-drag`); no press or tap reaches the host (U36) |
| G8 Pan tool under V2 | V2 (touch from phase 3), tool hand: pen tip drag; touch drag | `pan` (`primary-drag`) |
| G9 Shift+middle-drag rotates (spec) | down(1, Shift) → moves 20 px right → up | nothing until 3 px, then `rotate` about the press point with `totalDeltaDeg` +16 measured from the press (rightward raises the bearing) |
| G9b Still Shift+middle click | down(1, Shift) → up within 3 px | nothing emitted; default prevented; the bearing is unchanged |
| G9c Shift+middle-drag in overview | mode overview: down(1, Shift) → moves 20 px right → up | `rotate`, as in site mode (Shift is checked before the overview branch) |
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
| H17 mod+arrow (spec) | Ctrl+→ with a selection; Shift+→; mac: Cmd+→ with a selection; Ctrl+→ | 1 m nudge; the view turns; 1 m nudge; nothing |
| H18 Arrow-owning splitter and rail (spec) | focus the dock splitter: Shift+ArrowLeft; focus a tool-rail button: Shift+ArrowUp | the splitter resizes and the view does not turn; the rail keeps the key and north is not reset |
| H19 Declared arrow owners (spec) | focus the lens preview (`data-owns-keys="arrows"`): Shift+→; the phone sheet handle: Shift+↑; a calendar date button (its grid prevents every arrow itself, so it declares nothing): Shift+→; the photo carousel: Shift+← | the lens moves by the plain step (as an unmodified arrow); the sheet, the calendar and the carousel handle it; the view does not turn |
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
| I9 Esc during a compass drag (spec) | in `Compass.test.tsx` through the real router: Select with a selection; compass drag in progress; Esc with map focus, then with `<body>` focus | the starting camera returns; the selection stays |
| I10 Esc during a drag, focus in the lens (F) | left drag live; focus in the inspection lens panel; Esc | the drag aborts and the lens stays open (today the lens also closes; no rebuild pins that bug) |
| I11 F6 past a widget that stops propagation (F) | focus inside the inspection lens; F6 | the next region takes focus (capture listener) |
| I12 Presenter scope inside its modal (F) | story presenter open (modal layer held): ArrowRight; N | the next step; nothing |
| I12b Presenter keys need its focus (F) | story presenter open, focus on `<body>`: ArrowRight; Space; Esc | nothing (today: the presenter hears only keys inside its root) |
| H23 Scale button owns its arrows (F, again in phase 1) | focus the scale button (`ZoomControls.tsx:138-143`): Shift+↑ | the scale menu opens; no nudge or pan (the button handles its arrows first); from 1 the bearing is unchanged |
| H24 Held stamp turns with the switch off (F) | single-key shortcuts off, map focused, Object stamp holding a pick: `]`; then focus the body: `]` | the pick turns +15° on the map; nothing on the body |
| H25 Arrows during a live drag | Select with a selection; a move-drag in progress: → | nothing: no nudge and no pan (today) |
| H26 The World map owns its arrows (1) | focus the World map canvas (`data-owns-keys="arrows"`): Shift+→, Shift+↑; then the same press on a plain focusable div | the workspace view neither turns nor resets, and MapLibre's rotation is off (INV-CAM-46); the plain div's press turns the view (the positive control) |
| H27 F2 falls through to the shell (F) | map focus with nothing selected: F2; map focus with one note selected: F2 | rename the Design (the row's `fallback`, after the port's `edit-text` returns false); edit the note |

### 5.9 Precedence

| Id | Sequence | Expect |
|---|---|---|
| J1 Left-drag never pans | select: drag; hand: drag | band; `press`, `pan`, then `cancel('navigate')` after the `pan{end}` (J1_HAND: every press the host sees ends) |
| J2 Shift+drag is not box zoom | down(0, Shift) → drag | additive band; never zoom |
| J3 Overview right-click | overview: still right-click | contextmenu prevented, no menu (the overview left drag is G7) |
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
- Rulers, ruler guides and Snap to guides (removed, U33); the locked-object hover chip (removed, U33).
- A pen eraser tool; coalesced pointer samples for tools.
- Box zoom (Shift+drag) anywhere.
- Navigating with a second button during a drag (user, 2026-10-01): wheel zoom and keys stay live during a drag; a right or middle press during it is ignored.
- An angle per Print Area (user, 2026-10-01: one angle for the whole PDF layout) and an edge highlight for "Turn view to this edge" (user, 2026-10-01).
- A new stored enum for Pointing device, a stored PDF setup, or any `.canopi` change beyond the saved-view ground size and the deleted `SavedView.extent` (§4.10), or any user-DB, LiDAR catalogue or plant-catalog change.
- Performance gates and optimisation beyond making canopi-p32r and canopi-wx8w fixable (phase R), and the select-all and delete-all slowness (its own bead).
- Instanced billboard or screen-constant line shaders (they fit behind `setView` later).

## 8. Stored data

| Store | Change |
|---|---|
| `.canopi` | version stays 9. `SavedViewCamera.bearing` is now written (normalised); `SavedViewCamera.ground_size_m` added, required (U33), and `SavedView.extent` deleted (§4.10); optional top-level `map_view` added (U28, §4.15; ADR 0021, "Additive `.canopi` changes"); ruler guides (`extra.guides`) no longer read or written by the scene, a key left in a development file staying as unknown extra (U33, ADR 0011). Positions are written rounded to the 1e-9° grid, latitude clamped to ±85.051128779 (the largest grid value inside Web Mercator's limit): an unedited position on the grid is written unchanged after open, chained re-origins and save, one with more decimals is rounded once (phase 2, P26; the geo ledger goes). A plant without a saved width is no longer given the catalog's width on open and save (P3).  Notes, rectangles and ellipses created rotated store the bearing in their existing `rotationDeg`. |
| Settings | `LastView.bearing` (phase 1) and `snap_to_guides` deleted (U33); older settings still load, since settings have no `deny_unknown_fields`. `scroll_wheel` values unchanged. |
| PDF | `PdfSetup.mapOrientation?` (default North up), in memory only; one layout angle, the view's bearing read at each capture (`PdfInput.viewBearingDeg`), also in memory; Print Areas and offsets in plan metres, independent of the frame. `PdfPrintArea.rotationDeg` is dropped (user, 2026-10-01): no stored format replaces it, since PDF setups are not saved (plan §8). |
| User DB, LiDAR catalogue, plant catalog | none |

## 9. User-facing strings

Every new or changed key exists in all 11 locales (`desktop/web/src/i18n/*.json`), English in sentence case (`i18n-copy.test.ts`); removed keys are deleted from every locale in the change that replaces them. Keys follow the existing layout: nested camelCase, menu items as dotted keys under `menu`. `{{mod}}` is filled with the platform's localised Ctrl label, or `shortcutKeys.cmd` on macOS, where every shortcut label reads Cmd for mod (U13, from phase 1); numbers and degrees use `Intl` through `{{value, number}}`. Rows marked (spec) were not in the design and are settled here.

### 9.3 Phase 2 (controls)

| Key | English | Where |
|---|---|---|
| `settings.singleKeyShortcutsHint` | Tool keys such as V, P and Z, N to reset north, brackets and Shift G, S, L, 2. Shift N always resets north. Off keeps {{mod}} shortcuts, Delete, Esc, arrows, F keys, and + and − on the map. | Settings › Keyboard (changed from its phase-1 text); the `settings.rs` doc comment adds "and + and − while the map has focus" in the same commit |
| `settings.pointingDevice` | Pointing device | Settings › Canvas (replaces `settings.scrollWheel`) |
| `settings.pointingDeviceMouse` | Mouse: the wheel zooms | option, stored `zoom` (replaces `settings.scrollWheelZoom`) |
| `settings.pointingDeviceTrackpad` | Trackpad: two fingers pan | option, stored `pan` (replaces `settings.scrollWheelPan`) |
| `settings.pointingDeviceHint` | Pinch and Ctrl + wheel always zoom. Shift + wheel pans. | hint (replaces `settings.scrollWheelHint`) |
| `canvas.contextMenu.finishShape` | Finish shape | canvas menu during a polygon draft |
| `canvas.zoneEdgeMidpoint.label` | Add a corner on edge {{index}} | aria-label of a polygon's edge midpoint dot |
| `menu` → `view.zoomToSelection` | Zoom to selection | View menu (Shift+2) |
| `shortcutKeys.home` | Home | the Home key's name in menus, F1 and tooltips (`formatShortcut`, INV-KEY-25) |
| `canvas.toolCard.escClearStamp` | Esc to clear the stamp | tool card while an Object stamp pick is held (kept only if that card uses it; the saved stamp's Esc leaves at once) |
| `canvas.toolCard.escClearRow` | Esc to clear the row | tool card while a row source is held |
| `canvas.toolCard.panHint` | Drag to move the map | Pan tool card, shown because Pan is off the rail (pattern) |
| `canvas.toolCard.rectangleKeys` | Shift draws a square | Rectangle tool card (spec) |
| `canvas.toolCard.ellipseKeys` | Shift draws a circle | Ellipse tool card (spec) |
| `canvas.toolCard.lineKeys` | Shift keeps 45° angles | Line and Measure tool cards (spec) |
| `shortcuts.gestures.heading` | Mouse, trackpad and pen | F1 section |
| `shortcuts.gestures.shiftDrag` | Shift + right-drag or Shift + middle-drag | F1 gesture input (moved from phase 1 with the static list, U1) |
| `shortcuts.gestures.turnView` | Turn the view; add {{mod}} for 15° steps | F1 gesture action |
| `shortcuts.gestures.compass` | Compass | F1 gesture input |
| `shortcuts.gestures.compassAction` | Click to reset north, drag to turn the view | F1 gesture action |
| `shortcuts.gestures.trackpadTwist` | Twist two fingers on the trackpad | F1 gesture input, macOS only (spec) |
| `shortcuts.gestures.rightDrag` | Right-drag, middle-drag or Space + drag | F1 input |
| `shortcuts.gestures.pan` | Pan the map | F1 action |
| `shortcuts.gestures.rightClick` | Right-click | F1 input |
| `shortcuts.gestures.macCtrlClick` | Control-click | F1 input (macOS) |
| `shortcuts.gestures.menu` | Open the menu | F1 action |
| `shortcuts.gestures.penButton` | Pen side button: drag or tap | F1 input (spec) |
| `shortcuts.gestures.pinch` | Pinch or Ctrl + wheel | F1 input, the zoom row's only one (U36) |
| `shortcuts.gestures.zoom` | Zoom | F1 action |
| `shortcuts.gestures.altClick` | Alt + click | F1 input |
| `shortcuts.gestures.removeFromSelection` | Remove from the selection | F1 action |
| `shortcuts.gestures.linuxPinch` | On Linux, trackpad pinch is not supported yet. Use Ctrl + scroll to zoom. | F1 note (Linux only) |
| `shortcuts.zoomStep` | Zoom in or out one step | F1 row (+, −) |
| `shortcuts.fitHome` | Fit the Design | F1 row (Home, Shift+F, Ctrl+0) |

Changed copy in phase 2:

| Key | New English |
|---|---|
| `canvas.toolCard.selectHint` | Drag to select · Shift-click adds · Alt-click removes · right-drag pans · wheel zooms |
| `canvas.toolCard.selectHintPan` | Drag to select · Shift-click adds · Alt-click removes · two fingers pan · pinch zooms (spec) |
| `canvas.toolCard.polygon` | Click to add corners. Click the first corner, double-click or press Enter to finish. (spec) |
| `canvas.toolCard.rowKeys` | Shift keeps 45° angles · {{mod}} turns off snapping (spec) |
| `canvas.tools.hand` | Pan (unchanged text; now in the View and Tools menus and the phone strip, not the main rail) |

Deleted in phase 2: `settings.scrollWheel`, `settings.scrollWheelZoom`, `settings.scrollWheelPan`, `settings.scrollWheelHint`.

### 9.4 Phase 3 (touch)

F1 shows a Touch section with these three rows on every device, after "Mouse, trackpad and pen" (U41). The coarse-pointer Select card reuses `canvas.toolCard.selectHintPan` (no new key).

| Key | English | Where |
|---|---|---|
| `shortcuts.gestures.touchHeading` | Touch | F1 section |
| `shortcuts.gestures.oneFinger` | One finger | F1 input (spec) |
| `shortcuts.gestures.oneFingerAction` | Select or draw; with the Pan tool, pan | F1 action (spec) |
| `shortcuts.gestures.twoFingers` | Two fingers | F1 input |
| `shortcuts.gestures.touchNavigate` | Pan, zoom and turn the view | F1 action |
| `shortcuts.gestures.longPress` | Press and hold | F1 input (action: `shortcuts.gestures.menu`) |

Release-note text is written once per release and is not an i18n key.
