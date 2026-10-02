// __tests__/support/test-view.ts  (test support)
//
// createTestView: the one way tests build a camera (spec §1.1b). A driver host starting on a HeadlessCameraDriver, built with the
// production factories, and the navigation over it. Tweens and the settle run on the window's animation frames and timers: a test
// that steps time uses Vitest fake timers.

import { signal } from '@preact/signals'
import type { ScenePersistedState } from '../../canvas/runtime/scene'
import type { CameraDriverHost } from '../../canvas/runtime/view/camera-driver'
import { planarToViewCamera } from '../../canvas/runtime/view/camera-math'
import { createCameraDriverHost } from '../../canvas/runtime/view/driver-host'
import { createViewNavigation, type ViewNavigation } from '../../canvas/runtime/view/navigation'
import { planarCameraOf } from '../../canvas/runtime/view/view-transform'
import { bearingCosSin } from '../../canvas/runtime/view/navigation-policy'
import type {
  PlanarCamera,
  SceneBoundsOptions,
  ScreenInsets,
  ViewCamera,
  ViewFrame,
  ViewFrameSource,
  ViewScreen,
  ViewTransform,
} from '../../canvas/runtime/view/types'
import { mapZoomToStageScale, stageScaleToMapZoom } from '../../canvas/projection'
import { createSessionPlane, type SessionPlane, type SessionPlaneTransform } from '../../canvas/session-plane'
import { createWorkspaceCameraPolicy, type WorkspaceCameraPolicy } from '../../canvas/workspace-camera-policy'

export interface TestViewOptions {
  /** Default { width: 400, height: 300, devicePixelRatio: 1 }: the split files' camera today. */
  readonly screen?: Partial<ViewScreen>
  /** Bearing-0 placement in today's terms (screen = world × scale + { x, y }). Default { x: 0, y: 0, scale: 1 }. */
  readonly viewport?: { readonly x: number; readonly y: number; readonly scale: number }
  /** Instead of viewport: a full camera (rotated tests from phase 1). */
  readonly camera?: Partial<ViewCamera>
  /** Default createSessionPlane({ lon: 0, lat: 0 }). */
  readonly plane?: SessionPlane
  /** Default: createWorkspaceCameraPolicy(). The host takes its latitude from the plane. */
  readonly policy?: WorkspaceCameraPolicy
  readonly insets?: ScreenInsets
}

export interface TestView {
  /** Starts on a HeadlessCameraDriver, built with the production factories. */
  readonly host: CameraDriverHost
  readonly frames: ViewFrameSource            // host.frames
  readonly navigation: ViewNavigation         // readScene returns an empty scene unless the test passes one to setScene
  view(): ViewTransform                       // frames.viewFrame.peek().view
  setViewport(v: { readonly x: number; readonly y: number; readonly scale: number }): void   // a 'set' to the camera the plane gives, bearing kept
  /** The bearing-0 placement in today's terms (planarCameraOf(view()) without the bearing): the split suites' camera.viewport. */
  viewport(): { readonly x: number; readonly y: number; readonly scale: number }
  /** CameraController.reprojectViewport's numbers (INV-WR-07): the placement moved by a plane transform in plane terms, shown
   *  through the plane, which stays. */
  reproject(transform: SessionPlaneTransform): void
  setScene(scene: ScenePersistedState, bounds?: SceneBoundsOptions): void
  dispose(): void
}

const DEFAULT_SCREEN: ViewScreen = { width: 400, height: 300, devicePixelRatio: 1 }

export function createTestView(options: TestViewOptions = {}): TestView {
  const plane = options.plane ?? createSessionPlane({ lon: 0, lat: 0 })
  const screen: ViewScreen = { ...DEFAULT_SCREEN, ...options.screen }
  const camera: ViewCamera = options.camera
    ? {
      center: options.camera.center ?? plane.origin,
      zoom: options.camera.zoom ?? stageScaleToMapZoom(1, plane.origin.lat),
      bearingDeg: options.camera.bearingDeg ?? 0,
      pitchDeg: 0,
    }
    : testCameraFor({ ...(options.viewport ?? { x: 0, y: 0, scale: 1 }), bearingDeg: 0 }, screen, plane)
  const policy = options.policy ?? createWorkspaceCameraPolicy()
  const host = createCameraDriverHost({
    policy,
    reducedMotion: signal(false),
    plane: () => plane,
    screen,
    camera,
    insets: options.insets,
  })
  let scene: { persisted: ScenePersistedState; bounds: SceneBoundsOptions } = { persisted: emptyScene(), bounds: {} }
  const navigation = createViewNavigation({
    driver: host,
    policy: host.driverDeps.policy,
    readScene: () => ({ persisted: scene.persisted, selection: [], bounds: scene.bounds }),
  })

  const place = (placement: PlanarCamera): void => placeOnHost(host, plane, placement)

  return {
    host,
    frames: host.frames,
    navigation,
    view: () => host.frames.viewFrame.peek().view,
    setViewport(v) {
      const bearingDeg = host.frames.viewFrame.peek().view.camera.bearingDeg
      place({ x: v.x, y: v.y, scale: v.scale, bearingDeg })
    },
    viewport() {
      const { x, y, scale } = planarCameraOf(host.frames.viewFrame.peek().view)
      return { x, y, scale }
    },
    reproject(transform) {
      place(reprojectPlacement(planarCameraOf(host.frames.viewFrame.peek().view), transform))
    },
    setScene(persisted, bounds = {}) {
      scene = { persisted, bounds }
    },
    dispose() {
      host.dispose()
    },
  }
}

/** Shows a placement on a host's live camera: the camera the plane gives for it on the live screen, as a 'set' with no animation. */
export function placeOnHost(
  host: Pick<CameraDriverHost, 'current' | 'frames'>,
  plane: SessionPlane,
  placement: { readonly x: number; readonly y: number; readonly scale: number; readonly bearingDeg?: number },
): void {
  const { view } = host.frames.viewFrame.peek()
  const target = testCameraFor({ ...placement, bearingDeg: placement.bearingDeg ?? 0 }, view.screen, plane)
  host.current().apply({ kind: 'set', target, animation: 'none' })
}

/**
 * The camera that shows a placement, its zoom nudged by the last bits so its scale reads back at or just above the placement's:
 * a zoom reads back a hair under a round scale (4 px/m reads 3.9999999999999996), and the grid, the zoom bands and the overview
 * threshold compare scales exactly, so a test placed at 4 px/m sees the 5 m grid it asked for.
 */
export function testCameraFor(placement: PlanarCamera, screen: ViewScreen, plane: SessionPlane): ViewCamera {
  const camera = planarToViewCamera(placement, screen, plane)
  let { zoom } = camera
  for (let step = 0; step < 8 && mapZoomToStageScale(zoom, plane.origin.lat) < placement.scale; step++) {
    zoom += Math.max(1, Math.abs(zoom)) * Number.EPSILON
  }
  return zoom === camera.zoom ? camera : { ...camera, zoom }
}

/**
 * The same placement in the next plane terms (CameraController.reprojectViewport's numbers): screen = turn(p × scale) + { x, y }
 * holds for p' = p × s + o, so the scale is divided by s and the offset, scaled and turned as plane points are, comes off the
 * translation.
 */
function reprojectPlacement(placement: PlanarCamera, transform: SessionPlaneTransform): PlanarCamera {
  const scale = placement.scale / transform.scale
  const [cos, sin] = bearingCosSin(placement.bearingDeg)
  const offset = { x: transform.offsetX * scale, y: transform.offsetY * scale }
  return {
    x: placement.x - (cos * offset.x + sin * offset.y),
    y: placement.y - (cos * offset.y - sin * offset.x),
    scale,
    bearingDeg: placement.bearingDeg,
  }
}

/** The frame a test view built with these options shows: for chrome that takes one frame (the rulers, the grid). */
export function testViewFrame(options: TestViewOptions = {}): ViewFrame {
  const view = createTestView(options)
  const frame = view.frames.viewFrame.peek()
  view.dispose()
  return frame
}

function emptyScene(): ScenePersistedState {
  return {
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
  }
}
