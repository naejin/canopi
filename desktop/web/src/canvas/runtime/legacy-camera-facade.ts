// canvas/runtime/legacy-camera-facade.ts  (0A to the end of 0D2; deleted when the renderer, the last reader of SceneViewportState,
// has moved to ViewTransform)
//
// Owns today's camera surface over the view (plan §4 0A "Legacy surface", spec §1.1b): the constructible CameraController shim, with
// today's constructor and public members, its CameraViewportSnapshot of each frame, and the two framing functions callers still
// import. The shim is a CameraDriverHost that starts on a HeadlessCameraDriver, with the view navigation over it; it adds no clamp
// of its own, and at bearing 0 it reads back what today's CameraController did, bit for bit. It sits outside view/ because it
// supplies the platform clock, animation frames, timers and device-pixel ratio, and speaks SceneViewportState (P4). It imports
// nothing that reaches MapLibre or Pixi (P5c): the MapLibre shim (maplibre/workspace-camera.ts) extends it.

import { effect, signal, untracked, type ReadonlySignal, type Signal } from '@preact/signals'
import { createSessionPlane, type SessionPlane, type SessionPlaneTransform } from '../session-plane'
import {
  createWorkspaceCameraPolicy,
  type WorkspaceCameraPolicy,
  type WorkspaceCameraScaleBounds,
} from '../workspace-camera-policy'
import type { ScenePersistedState, ScenePoint, SceneViewportState } from './scene'
import { sceneExtentPoints } from './scene-extent'
import type { CameraDriver, CameraDriverDeps } from './view/camera-driver'
import { reprojectPlanar } from './view/camera-math'
import { createCameraDriverHost, type CameraDriverHostController } from './view/driver-host'
import { fitScene, framingRect, type FitExtent, type FramingRect } from './view/fit'
import { createViewNavigation, type ViewNavigation } from './view/navigation'
import type {
  FrameSourceDeps,
  PlanarCamera,
  SceneBounds,
  SceneBoundsOptions,
  TemporaryBoundsFocusOptions,
  ViewFrame,
  ViewScreen,
} from './view/types'
import { planarCameraOf } from './view/view-transform'

/** Today's initial frame: this many metres across the shorter screen side, centred. */
const DEFAULT_VIEWPORT_METERS = 100
const ZOOM_REFERENCE_SCALE = 20
const DEFAULT_CAMERA_POLICY = createWorkspaceCameraPolicy()
/** The view's eases (rotation) wait for phase 1's platform signal; nothing eases at bearing 0. */
const NO_REDUCED_MOTION: ReadonlySignal<boolean> = signal(false)
const EMPTY_SCREEN: ViewScreen = Object.freeze({ width: 0, height: 0, devicePixelRatio: 1 })
const UNPUBLISHED_CAMERA: PlanarCamera = Object.freeze({ x: 0, y: 0, scale: 1, bearingDeg: 0 })

type WorkspaceCameraMode = 'site' | 'overview'

/**
 * CSS-pixel edges of the screen covered by floating chrome (title bar, rails,
 * the open dock). Fitting and temporary focus frame into what is left.
 */
export interface CameraFrameInsets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

const NO_CAMERA_FRAME_INSETS: CameraFrameInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })

interface CameraScreenSize {
  width: number
  height: number
}

export interface CameraScreenMetrics extends CameraScreenSize {
  /** Optional source hint; an owner must publish the density of its active surface. */
  devicePixelRatio?: number
}

/** Screen dimensions and viewport offsets use CSS pixels. */
export interface CameraViewportSnapshot {
  readonly viewport: Readonly<SceneViewportState>
  readonly screenSize: Readonly<CameraScreenSize>
  readonly devicePixelRatio: number
  readonly referenceScale: number
  readonly scaleBounds: Readonly<WorkspaceCameraScaleBounds>
  readonly overviewScaleThreshold: number
  readonly mode: WorkspaceCameraMode
  /** Geographic ground resolution for map overview chrome; absent while no map is attached. */
  readonly groundMetersPerCssPixel: number | null
  readonly revision: number
}

/** Converts between local metres and CSS-pixel screen coordinates for one frame. */
export interface WorkspaceCameraFrameReader {
  readonly snapshot: ReadonlySignal<CameraViewportSnapshot>
  readonly viewport: SceneViewportState
  readonly screenSize: CameraScreenSize
  /** Screen edges covered by floating chrome; canvas affordances stay inside them. */
  readonly frameInsets: CameraFrameInsets
  worldToScreen(point: ScenePoint): ScenePoint
  screenToWorld(point: ScenePoint): ScenePoint
}

export interface WorkspaceCameraNavigation {
  initialize(screen: CameraScreenMetrics): SceneViewportState
  resize(screen: CameraScreenMetrics): SceneViewportState
  zoomIn(): SceneViewportState
  zoomOut(): SceneViewportState
  zoomAroundScreenPoint(pointer: ScenePoint, factor: number): SceneViewportState
  zoomToFit(scene: ScenePersistedState, options?: SceneBoundsOptions): SceneViewportState
  returnToDesign(scene: ScenePersistedState, options?: SceneBoundsOptions): SceneViewportState
  panBy(delta: ScenePoint): SceneViewportState
  focusTemporaryBounds(bounds: SceneBounds, options: TemporaryBoundsFocusOptions): boolean
  returnFromTemporaryFocus(): boolean
  clearTemporaryFocus(): void
  /** Screen edges covered by floating chrome; fitting and temporary focus frame inside them. */
  setFrameInsets(insets: CameraFrameInsets): void
  /** Keeps the same view after the session plane moved: next = previous * scale + offset. */
  reprojectViewport(transform: SessionPlaneTransform): SceneViewportState
  /**
   * Puts a plane point at the centre of the screen at `scale`. `animate` asks
   * an attached map to fly there; a detached camera always jumps.
   */
  centerOn(point: ScenePoint, scale: number, options?: CameraMoveOptions): SceneViewportState
}

export interface CameraMoveOptions {
  readonly animate?: boolean
}

/** Owns the paired read and command roles admitted into one active workspace. */
export interface WorkspaceCameraOwner {
  readonly frame: WorkspaceCameraFrameReader
  readonly navigation: WorkspaceCameraNavigation
  /** The driver host the shim wraps: the runtime that adopts the shim unwraps it for the view surfaces (0A-2). */
  readonly host: CameraDriverHostController
  /**
   * The runtime that adopts the shim hands it the Scene's session plane: the host's headless drivers are built on it from then on,
   * and a headless camera keeps its plane placement when a hydration replaces it, so the view reads the Design's ground as today's
   * plane viewport did. Returns the watch's disposer.
   */
  followScenePlane(plane: ReadonlySignal<SessionPlane | null>): () => void
  /** Must detach owner-specific listeners and be safe to call during failed setup. */
  dispose(): void
}

export class CameraController implements
  WorkspaceCameraFrameReader,
  WorkspaceCameraNavigation,
  WorkspaceCameraOwner {
  /** The driver host this shim wraps: the entry points that take a camera unwrap it (0A-2). */
  readonly host: CameraDriverHostController
  /** The navigation over `host`, which every move of this shim goes through. */
  readonly viewNavigation: ViewNavigation
  readonly snapshot: ReadonlySignal<CameraViewportSnapshot>
  readonly frame: WorkspaceCameraFrameReader = this
  readonly navigation: WorkspaceCameraNavigation = this

  /** The Scene's plane once a runtime adopted this shim (followScenePlane). */
  private scenePlane: ReadonlySignal<SessionPlane | null> | null = null
  private ownPlane: SessionPlane
  private readonly _snapshot: Signal<CameraViewportSnapshot>
  private _policy: WorkspaceCameraPolicy
  /** Today's temporary-focus bookmark, in the plane terms reprojectViewport moves it in. */
  private temporaryFocusBookmark: PlanarCamera | null = null
  /** Depth of the operations that publish one snapshot for several frames (initialize, a policy change, an attach). */
  private deferredSnapshot = 0

  /**
   * Today's constructor. `over` is createTestView's only: its legacyCamera is this shim over the test view's own host (spec
   * §1.1b), built on the same policy and plane.
   */
  constructor(
    policy: WorkspaceCameraPolicy = DEFAULT_CAMERA_POLICY,
    over?: { readonly host: CameraDriverHostController; readonly plane: SessionPlane },
  ) {
    this._policy = policy
    // The bare shim's plane shares the policy's latitude, so px/m and the policy's scale bounds use one Mercator factor (§1.1b).
    this.ownPlane = over?.plane ?? createSessionPlane({ lon: 0, lat: policy.referenceLatitudeDeg })
    const clock = over?.host.driverDeps.clock ?? platformClock()
    this.host = over?.host ?? createCameraDriverHost({
      clock,
      scheduleFrame: platformFrames(),
      timers: platformTimers(clock),
      policy,
      reducedMotion: NO_REDUCED_MOTION,
      plane: () => this.plane,
      screen: EMPTY_SCREEN,
      camera: UNPUBLISHED_CAMERA,
    })
    this.viewNavigation = createViewNavigation({
      driver: this.host,
      policy: this.host.driverDeps.policy,
      clock,
      // Every call of this shim names its scene: the navigation's own scene is never read.
      readScene: () => ({ persisted: EMPTY_SCENE, selection: [], bounds: {} }),
    })
    this._snapshot = signal(snapshotOf(this.frameNow(), policy, 0))
    this.snapshot = this._snapshot
    this.host.frames.onViewFrame('tools', (frame) => {
      if (this.deferredSnapshot === 0) this.publishSnapshot(frame)
    })
  }

  get policy(): WorkspaceCameraPolicy { return this._policy }

  /**
   * The session plane the host's headless drivers are built on: the Scene's once a runtime adopted this shim, else the shim's own
   * (the bare shim's plane is not the Scene's, INV-WR-07).
   */
  protected get plane(): SessionPlane {
    return this.scenePlane?.peek() ?? this.ownPlane
  }

  protected set plane(next: SessionPlane) {
    this.ownPlane = next
  }

  /** The Scene's plane when a runtime adopted this shim, else null. */
  protected get followedScenePlane(): SessionPlane | null {
    return this.scenePlane?.peek() ?? null
  }

  followScenePlane(plane: ReadonlySignal<SessionPlane | null>): () => void {
    this.scenePlane = plane
    return effect(() => {
      const next = plane.value
      if (next) untracked(() => this.host.followPlane(next))
    })
  }

  get viewport(): SceneViewportState {
    return { ...this._snapshot.peek().viewport }
  }

  get screenSize(): CameraScreenSize {
    return { ...this._snapshot.peek().screenSize }
  }

  get frameInsets(): CameraFrameInsets {
    return this.frameNow().insets
  }

  replacePolicy(policy: WorkspaceCameraPolicy): SceneViewportState {
    this.clearTemporaryFocus()
    return this.applyPolicy(policy)
  }

  /**
   * Swaps the policy without dropping a temporary focus. A re-origin changes
   * the reference latitude but not the view the user may return to; the
   * re-origin reprojects the bookmark instead.
   */
  protected applyPolicy(policy: WorkspaceCameraPolicy): SceneViewportState {
    this.withOneSnapshot(() => {
      this._policy = policy
      // The host clamps the scale to the new bounds about the screen centre, as today's applyPolicy did.
      this.host.replacePolicy(policy)
    })
    return this.viewport
  }

  initialize(screen: CameraScreenMetrics): SceneViewportState {
    this.withOneSnapshot(() => {
      this.clearTemporaryFocus()
      // An attached map keeps its own screen: its resize hook reports it (today's owner read the map canvas here).
      if (!this.frameNow().attached) this.driver().setScreen(normalizeScreenMetrics(screen))
      const { view, scaleBounds } = this.frameNow()
      const { width, height } = view.screen
      const scale = Math.min(scaleBounds.max, Math.max(scaleBounds.min, Math.min(width, height) / DEFAULT_VIEWPORT_METERS))
      this.command(() => this.place({
        x: width / 2 - (DEFAULT_VIEWPORT_METERS / 2) * scale,
        y: height / 2 - (DEFAULT_VIEWPORT_METERS / 2) * scale,
        scale,
        bearingDeg: view.camera.bearingDeg,
      }))
    })
    return this.viewport
  }

  resize(screen: CameraScreenMetrics): SceneViewportState {
    this.driver().setScreen(normalizeScreenMetrics(screen))
    return this.viewport
  }

  setViewport(next: SceneViewportState): SceneViewportState {
    const bearingDeg = this.frameNow().view.camera.bearingDeg
    this.command(() => this.place({ x: next.x, y: next.y, scale: next.scale, bearingDeg }))
    return this.viewport
  }

  zoomIn(): SceneViewportState {
    this.command(() => this.viewNavigation.zoomIn())
    return this.viewport
  }

  zoomOut(): SceneViewportState {
    this.command(() => this.viewNavigation.zoomOut())
    return this.viewport
  }

  zoomAroundScreenPoint(pointer: ScenePoint, factor: number): SceneViewportState {
    this.command(() => this.viewNavigation.zoomAroundPx(pointer, factor))
    return this.viewport
  }

  setFrameInsets(insets: CameraFrameInsets): void {
    this.viewNavigation.setFramingInsets(insets)
  }

  zoomToFit(scene: ScenePersistedState, options: SceneBoundsOptions = {}): SceneViewportState {
    this.command(() => this.viewNavigation.zoomToFit(scene, fitExtentOf(scene, options)))
    return this.viewport
  }

  returnToDesign(scene: ScenePersistedState, options: SceneBoundsOptions = {}): SceneViewportState {
    this.command(() => this.viewNavigation.returnToDesign(scene, fitExtentOf(scene, options)))
    return this.viewport
  }

  panBy(delta: ScenePoint): SceneViewportState {
    this.command(() => this.viewNavigation.panByPx(delta))
    return this.viewport
  }

  focusTemporaryBounds(bounds: SceneBounds, options: TemporaryBoundsFocusOptions): boolean {
    return this.command(() => {
      const before = this.planar()
      if (!this.viewNavigation.focusTemporaryBounds(bounds, options)) return false
      // The shim keeps the one bookmark: reprojectViewport moves it with a re-origin in plane terms, as today.
      this.viewNavigation.clearTemporaryFocus()
      if (!this.temporaryFocusBookmark) this.temporaryFocusBookmark = before
      return true
    })
  }

  returnFromTemporaryFocus(): boolean {
    const bookmark = this.temporaryFocusBookmark
    if (!bookmark) return false
    this.temporaryFocusBookmark = null
    this.command(() => this.place(bookmark))
    return true
  }

  centerOn(point: ScenePoint, scale: number, options?: CameraMoveOptions): SceneViewportState {
    this.clearTemporaryFocus()
    this.command(() => this.viewNavigation.centerOn(point, scale, { animate: options?.animate === true }))
    return this.viewport
  }

  /**
   * Detached, the placement moves into the new plane in plane terms (today's reprojectPlaneViewport), since this shim's plane is
   * not the Scene's. Attached, the map is the camera: its frame was already re-expressed in the new plane when the attachment's
   * origin was refreshed, so only the bookmark, which the map does not hold, moves here.
   */
  reprojectViewport(transform: SessionPlaneTransform): SceneViewportState {
    const bookmark = this.temporaryFocusBookmark
    this.temporaryFocusBookmark = bookmark && reprojectPlanar(bookmark, transform)
    if (!this.frameNow().attached) this.place(reprojectPlanar(this.planar(), transform))
    return this.viewport
  }

  clearTemporaryFocus(): void {
    this.temporaryFocusBookmark = null
    this.viewNavigation.clearTemporaryFocus()
  }

  worldToScreen(point: ScenePoint): ScenePoint {
    return this.frameNow().view.worldToScreen(point)
  }

  screenToWorld(point: ScenePoint): ScenePoint {
    return this.frameNow().view.screenToWorld(point) ?? { x: Number.NaN, y: Number.NaN }
  }

  dispose(): void {
    this.clearTemporaryFocus()
  }

  /** Runs one navigation command. The MapLibre shim replays a command whose map call failed on the camera it falls back to. */
  protected command<T>(run: () => T): T {
    return run()
  }

  /**
   * Publishes one snapshot for every frame `run` makes, as today's owner published one frame per operation. The snapshot is published
   * when `run` returns, so a snapshot read (`viewport`, `screenSize`) is current only after this call.
   */
  protected withOneSnapshot(run: () => void): void {
    this.deferredSnapshot += 1
    try {
      run()
    } finally {
      this.deferredSnapshot -= 1
      if (this.deferredSnapshot === 0) this.publishSnapshot(this.frameNow())
    }
  }

  protected driver(): CameraDriver {
    return this.host.current()
  }

  protected frameNow(): ViewFrame {
    return this.host.frames.viewFrame.peek()
  }

  protected planar(): PlanarCamera {
    return planarCameraOf(this.frameNow().view)
  }

  /** setViewport's exact placement: the headless driver clamps the scale and adopts the rest; a map driver converts it once. */
  protected place(planar: PlanarCamera): void {
    this.driver().apply({ kind: 'place', planar })
  }

  /** Today's no-op identity: an unchanged snapshot keeps its object and revision. */
  private publishSnapshot(frame: ViewFrame): void {
    const current = this._snapshot.peek()
    const next = snapshotOf(frame, this._policy, current.revision + 1)
    if (!sameSnapshot(current, next)) this._snapshot.value = next
  }
}

/** Derives the fit viewport using the scale-dependent Scene bounds policy; without `extentPoints` it measures the scene itself. */
export function fitCameraViewport(
  snapshot: CameraViewportSnapshot,
  scene: ScenePersistedState,
  options: SceneBoundsOptions = {},
  insets: CameraFrameInsets = NO_CAMERA_FRAME_INSETS,
): SceneViewportState {
  const fitted = fitScene({
    screen: snapshot.screenSize,
    insets,
    scaleBounds: { min: snapshot.scaleBounds.minimum, max: snapshot.scaleBounds.maximum },
    current: { ...snapshot.viewport, bearingDeg: 0 },
  }, fitExtentOf(scene, options), 0)
  return { x: fitted.x, y: fitted.y, scale: fitted.scale }
}

/**
 * The part of the screen not covered by floating chrome. When the insets leave
 * too little room (or are invalid), the whole screen is the frame.
 */
export function cameraFramingRect(
  screen: CameraScreenSize,
  insets: CameraFrameInsets = NO_CAMERA_FRAME_INSETS,
): FramingRect {
  return framingRect(screen, insets)
}

const EMPTY_SCENE: ScenePersistedState = Object.freeze({
  plantSpeciesColors: {},
  plantSpeciesSymbols: {},
  plantSpeciesCodes: {},
  layers: [],
  plants: [],
  zones: [],
  annotations: [],
  measurementGuides: [],
  groups: [],
  guides: [],
})

/** A caller's extent, or today's computeSceneBounds footprints of the scene when it passes none. */
function fitExtentOf(scene: ScenePersistedState, options: SceneBoundsOptions): FitExtent {
  return {
    extentPoints: options.extentPoints ?? sceneExtentPoints(scene),
    emptySceneScale: options.emptySceneScale,
  }
}

function snapshotOf(frame: ViewFrame, policy: WorkspaceCameraPolicy, revision: number): CameraViewportSnapshot {
  const { view } = frame
  const placement = planarCameraOf(view)
  const ground = frame.attached ? view.metresPerPixelAt() : Number.NaN
  return Object.freeze({
    viewport: Object.freeze({ x: placement.x, y: placement.y, scale: placement.scale }),
    screenSize: Object.freeze({ width: view.screen.width, height: view.screen.height }),
    devicePixelRatio: view.screen.devicePixelRatio,
    referenceScale: ZOOM_REFERENCE_SCALE,
    scaleBounds: Object.freeze({ minimum: frame.scaleBounds.min, maximum: frame.scaleBounds.max }),
    overviewScaleThreshold: policy.overviewScaleThreshold,
    mode: frame.mode,
    groundMetersPerCssPixel: Number.isFinite(ground) && ground > 0 ? ground : null,
    revision,
  })
}

function sameSnapshot(current: CameraViewportSnapshot, next: CameraViewportSnapshot): boolean {
  return current.viewport.x === next.viewport.x
    && current.viewport.y === next.viewport.y
    && current.viewport.scale === next.viewport.scale
    && current.screenSize.width === next.screenSize.width
    && current.screenSize.height === next.screenSize.height
    && current.devicePixelRatio === next.devicePixelRatio
    && current.referenceScale === next.referenceScale
    && current.scaleBounds.minimum === next.scaleBounds.minimum
    && current.scaleBounds.maximum === next.scaleBounds.maximum
    && current.overviewScaleThreshold === next.overviewScaleThreshold
    && current.mode === next.mode
    && current.groundMetersPerCssPixel === next.groundMetersPerCssPixel
}

/** Today's normalizeScreenMetrics: invalid sizes read as 0, a missing or invalid density as the window's, then 1. */
function normalizeScreenMetrics(screen: CameraScreenMetrics): ViewScreen {
  const devicePixelRatio = screen.devicePixelRatio
    ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio)
  return {
    width: finiteNonNegative(screen.width),
    height: finiteNonNegative(screen.height),
    devicePixelRatio: Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1,
  }
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function platformClock(): () => number {
  return typeof performance === 'undefined' ? () => Date.now() : () => performance.now()
}

function platformFrames(): CameraDriverDeps['scheduleFrame'] {
  if (typeof requestAnimationFrame !== 'function') {
    return (callback) => {
      const id = setTimeout(() => callback(Date.now()), 16)
      return () => clearTimeout(id)
    }
  }
  return (callback) => {
    const id = requestAnimationFrame(callback)
    return () => cancelAnimationFrame(id)
  }
}

function platformTimers(clock: () => number): FrameSourceDeps['timers'] {
  return {
    set: (atMs, run) => setTimeout(run, Math.max(0, atMs - clock())) as unknown as number,
    clear: (id) => clearTimeout(id),
  }
}
