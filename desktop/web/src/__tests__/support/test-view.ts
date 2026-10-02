// __tests__/support/test-view.ts  (test support)
//
// createTestView: the one way tests build a camera (spec §1.1b). A driver host starting on a HeadlessCameraDriver, built with the
// production factories, the navigation over it, and (0A to 0E) the legacy CameraController shim over the same host. Tweens and the
// settle run on the window's animation frames and timers: a test that steps time uses Vitest fake timers.

import { signal } from '@preact/signals'
import { CameraController } from '../../canvas/runtime/camera'
import type { ScenePersistedState } from '../../canvas/runtime/scene'
import type { CameraDriverHost } from '../../canvas/runtime/view/camera-driver'
import { reprojectPlanar, viewCameraToPlanar } from '../../canvas/runtime/view/camera-math'
import { createCameraDriverHost } from '../../canvas/runtime/view/driver-host'
import { createViewNavigation, type ViewNavigation } from '../../canvas/runtime/view/navigation'
import { planarCameraOf } from '../../canvas/runtime/view/view-transform'
import type {
  SceneBoundsOptions,
  ScreenInsets,
  ViewCamera,
  ViewFrameSource,
  ViewScreen,
  ViewTransform,
} from '../../canvas/runtime/view/types'
import { stageScaleToMapZoom } from '../../canvas/projection'
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
  /** Default: the policy CameraController uses today when constructed without one. The host takes its latitude from the plane. */
  readonly policy?: WorkspaceCameraPolicy
  readonly insets?: ScreenInsets
}

export interface TestView {
  /** Starts on a HeadlessCameraDriver, built with the production factories. */
  readonly host: CameraDriverHost
  readonly frames: ViewFrameSource            // host.frames
  readonly navigation: ViewNavigation         // readScene returns an empty scene unless the test passes one to setScene
  view(): ViewTransform                       // frames.viewFrame.peek().view
  setViewport(v: { readonly x: number; readonly y: number; readonly scale: number }): void   // an exact 'place' move, bearing kept
  /** The bearing-0 placement in today's terms (planarCameraOf(view()) without the bearing): the split suites' camera.viewport. */
  viewport(): { readonly x: number; readonly y: number; readonly scale: number }
  /** CameraController.reprojectViewport's numbers (INV-WR-07): a 'place' by a plane transform in plane terms; the plane stays. */
  reproject(transform: SessionPlaneTransform): void
  setScene(scene: ScenePersistedState, bounds?: SceneBoundsOptions): void
  /** 0A to the end of 0D2 only: the facade's CameraController shim over this same host. Deleted with the facade. */
  readonly legacyCamera: CameraController
  dispose(): void
}

const DEFAULT_SCREEN: ViewScreen = { width: 400, height: 300, devicePixelRatio: 1 }

export function createTestView(options: TestViewOptions = {}): TestView {
  const plane = options.plane ?? createSessionPlane({ lon: 0, lat: 0 })
  const screen: ViewScreen = { ...DEFAULT_SCREEN, ...options.screen }
  const camera = options.camera
    ? viewCameraToPlanar({
      center: options.camera.center ?? plane.origin,
      zoom: options.camera.zoom ?? stageScaleToMapZoom(1, plane.origin.lat),
      bearingDeg: options.camera.bearingDeg ?? 0,
      pitchDeg: 0,
    }, screen, plane)
    : { ...(options.viewport ?? { x: 0, y: 0, scale: 1 }), bearingDeg: 0 }
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

  return {
    host,
    frames: host.frames,
    navigation,
    view: () => host.frames.viewFrame.peek().view,
    setViewport(v) {
      const bearingDeg = host.frames.viewFrame.peek().view.camera.bearingDeg
      host.current().apply({ kind: 'place', planar: { x: v.x, y: v.y, scale: v.scale, bearingDeg } })
    },
    viewport() {
      const { x, y, scale } = planarCameraOf(host.frames.viewFrame.peek().view)
      return { x, y, scale }
    },
    reproject(transform) {
      host.current().apply({ kind: 'place', planar: reprojectPlanar(planarCameraOf(host.frames.viewFrame.peek().view), transform) })
    },
    setScene(persisted, bounds = {}) {
      scene = { persisted, bounds }
    },
    legacyCamera: new CameraController(policy, { host, plane }),
    dispose() {
      host.dispose()
    },
  }
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
