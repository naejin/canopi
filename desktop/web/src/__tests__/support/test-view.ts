// __tests__/support/test-view.ts  (test support)
//
// createTestView: the one way tests build a camera (spec §1.1b). A driver host starting on a HeadlessCameraDriver, built with the
// production factories, the navigation over it, one manual clock that the drivers' clock and animation frames and the frame
// source's settle timers all read, and (0A to the end of 0D2) the legacy CameraController shim over the same host.

import { signal } from '@preact/signals'
import { CameraController } from '../../canvas/runtime/camera'
import type { ScenePersistedState } from '../../canvas/runtime/scene'
import type { CameraDriverHost } from '../../canvas/runtime/view/camera-driver'
import { viewCameraToPlanar } from '../../canvas/runtime/view/camera-math'
import { createCameraDriverHost } from '../../canvas/runtime/view/driver-host'
import { createViewNavigation, type ViewNavigation } from '../../canvas/runtime/view/navigation'
import type {
  SceneBoundsOptions,
  ScreenInsets,
  ViewCamera,
  ViewFrameSource,
  ViewScreen,
  ViewTransform,
} from '../../canvas/runtime/view/types'
import { stageScaleToMapZoom } from '../../canvas/projection'
import { createSessionPlane, type SessionPlane } from '../../canvas/session-plane'
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
  setViewport(v: { readonly x: number; readonly y: number; readonly scale: number }): void   // an exact 'place' move, bearing kept
  setScene(scene: ScenePersistedState, bounds?: SceneBoundsOptions): void
  /** 0A to the end of 0D2 only: the facade's CameraController shim over this same host. Deleted with the facade. */
  readonly legacyCamera: CameraController
  dispose(): void
}

const DEFAULT_SCREEN: ViewScreen = { width: 400, height: 300, devicePixelRatio: 1 }

export function createTestView(options: TestViewOptions = {}): TestView {
  const clock = createManualClock()
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
    clock: clock.now,
    scheduleFrame: clock.scheduleFrame,
    timers: clock.timers,
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
    clock: clock.now,
    readScene: () => ({ persisted: scene.persisted, selection: [], bounds: scene.bounds }),
  })

  return {
    host,
    frames: host.frames,
    navigation,
    clock: { now: clock.now, advance: clock.advance },
    view: () => host.frames.viewFrame.peek().view,
    setViewport(v) {
      const bearingDeg = host.frames.viewFrame.peek().view.camera.bearingDeg
      host.current().apply({ kind: 'place', planar: { x: v.x, y: v.y, scale: v.scale, bearingDeg } })
    },
    setScene(persisted, bounds = {}) {
      scene = { persisted, bounds }
    },
    legacyCamera: new CameraController(policy, { host, plane }),
    dispose() {
      host.dispose()
      clock.clear()
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

/** Frame callbacks run on the next advance, at its end time; timers run once due, earliest first. */
function createManualClock() {
  let now = 0
  let nextId = 1
  let frames = new Map<number, (nowMs: number) => void>()
  const timers = new Map<number, { readonly atMs: number; readonly run: () => void }>()

  return {
    now: () => now,
    scheduleFrame(callback: (nowMs: number) => void): () => void {
      const id = nextId++
      frames.set(id, callback)
      return () => {
        frames.delete(id)
      }
    },
    timers: {
      set(atMs: number, run: () => void): number {
        const id = nextId++
        timers.set(id, { atMs, run })
        return id
      },
      clear(id: number): void {
        timers.delete(id)
      },
    },
    advance(ms: number): void {
      now += ms
      const due = frames
      frames = new Map()
      for (const callback of due.values()) callback(now)
      for (;;) {
        let next: [number, { readonly atMs: number; readonly run: () => void }] | null = null
        for (const entry of timers) {
          if (entry[1].atMs <= now && (!next || entry[1].atMs < next[1].atMs)) next = entry
        }
        if (!next) return
        timers.delete(next[0])
        next[1].run()
      }
    },
    clear(): void {
      frames.clear()
      timers.clear()
    },
  }
}
