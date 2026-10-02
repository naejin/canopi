// canvas/runtime/view/frame-source.ts  (pure; the clock and timers are injected)
//
// Owns the published view (ADR 0016): the per-frame ViewFrame signal with its synchronous phases (tools, then overlays), the settled
// frame 150 ms after the last one, and ViewReadSurface, the coarse signals app code observes instead of frames (P10).

import { computed, signal, type ReadonlySignal } from '@preact/signals'
import type { SessionPlane } from '../../session-plane'
import { normaliseBearing } from './navigation-policy'
import type { ViewReadSurface } from './read-surface'
import type {
  DriverFrameSource,
  FramePhase,
  FrameSourceDeps,
  GeoBounds,
  ScreenPoint,
  ViewCamera,
  ViewFrame,
  ViewFrameSource,
  ViewScreen,
} from './types'

/** A frame this long without a newer one is the settled frame. */
export const SETTLE_MS = 150
/** The overview pin shows only this many CSS px or more inside every screen edge (today's CanvasOverview margin). */
const DESIGN_PIN_EDGE_MARGIN_PX = 24
/** One zoom band per factor of 1.25 in px/m: the level-of-detail key. */
const ZOOM_BAND_FACTOR = 1.25
const FRAME_PHASES: readonly FramePhase[] = ['tools', 'overlays']

/** A ViewFrameSource its owner publishes into: a camera driver, or the driver host that relays the live driver. */
export interface ViewFramePublisher extends ViewFrameSource {
  /** True while publish runs, listeners and effects included: a driver queues the moves made then. */
  readonly dispatching: boolean
  /**
   * Sets viewFrame, runs the 'tools' and then the 'overlays' listeners synchronously, and restarts the settle timer. A frame published
   * while listeners run (a move made on a frame the driver host relays itself, at a swap) is dispatched after them, in order.
   */
  publish(frame: ViewFrame): void
  /** Stops the settle timer; later publishes are ignored. */
  dispose(): void
}

interface FrameListener { readonly run: (frame: ViewFrame) => void }

export function createViewFrameSource(initial: ViewFrame, deps: FrameSourceDeps): ViewFramePublisher {
  const viewFrame = signal(initial)
  const settledViewFrame = signal(initial)
  const listeners: Record<FramePhase, FrameListener[]> = { tools: [], overlays: [] }
  let settleTimer: number | null = null
  let dispatching = false
  let disposed = false
  const deferred: ViewFrame[] = []

  const settle = (): void => {
    settleTimer = null
    settledViewFrame.value = viewFrame.peek()
  }

  return {
    viewFrame,
    settledViewFrame,
    get dispatching() {
      return dispatching
    },
    onViewFrame(phase, listener) {
      const entry: FrameListener = { run: listener }
      listeners[phase] = [...listeners[phase], entry]
      return () => {
        listeners[phase] = listeners[phase].filter((candidate) => candidate !== entry)
      }
    },
    publish(frame) {
      if (disposed) return
      if (dispatching) {
        deferred.push(frame)
        return
      }
      dispatching = true
      try {
        for (let next: ViewFrame | undefined = frame; next && !disposed; next = deferred.shift()) {
          if (settleTimer !== null) deps.timers.clear(settleTimer)
          settleTimer = deps.timers.set(deps.clock() + SETTLE_MS, settle)
          viewFrame.value = next
          for (const phase of FRAME_PHASES) {
            for (const listener of listeners[phase]) listener.run(next)
          }
        }
      } finally {
        dispatching = false
        // A listener that threw ends the dispatch: the frames it left waiting are not dispatched out of order later.
        deferred.length = 0
      }
    },
    dispose() {
      disposed = true
      if (settleTimer !== null) deps.timers.clear(settleTimer)
      settleTimer = null
      deferred.length = 0
      listeners.tools = []
      listeners.overlays = []
    },
  }
}

export interface DriverFramePublisher extends DriverFrameSource {
  /** True while publish runs, listeners included: a move made then is queued. */
  readonly dispatching: boolean
  /** Sets viewFrame and runs the listeners synchronously. A frame published while listeners run is dispatched after them, in order. */
  publish(frame: ViewFrame): void
  /** Later publishes are ignored. */
  dispose(): void
}

/** A driver's own frame stream (headless-driver.ts, maplibre/camera-driver.ts): one unphased listener list, no settle timer. */
export function createDriverFrameSource(initial: ViewFrame): DriverFramePublisher {
  const viewFrame = signal(initial)
  let listeners: FrameListener[] = []
  let dispatching = false
  let disposed = false
  const deferred: ViewFrame[] = []

  return {
    viewFrame,
    get dispatching() {
      return dispatching
    },
    onViewFrame(listener) {
      const entry: FrameListener = { run: listener }
      listeners = [...listeners, entry]
      return () => {
        listeners = listeners.filter((candidate) => candidate !== entry)
      }
    },
    publish(frame) {
      if (disposed) return
      if (dispatching) {
        deferred.push(frame)
        return
      }
      dispatching = true
      try {
        for (let next: ViewFrame | undefined = frame; next && !disposed; next = deferred.shift()) {
          viewFrame.value = next
          for (const listener of listeners) listener.run(next)
        }
      } finally {
        dispatching = false
        deferred.length = 0
      }
    },
    dispose() {
      disposed = true
      deferred.length = 0
      listeners = []
    },
  }
}

/**
 * The app-facing view of a frame source. Each signal changes only when its own value does. `plane` is the session plane the frames
 * are built on: captureView turns the four screen corners into lon/lat through it, as today's plane viewport did.
 */
export function createViewReadSurface(frames: ViewFrameSource, plane: () => SessionPlane): ViewReadSurface {
  const view = () => frames.viewFrame.value.view
  return {
    mode: computed(() => frames.viewFrame.value.mode),
    zoomBand: computed(() => Math.floor(Math.log(view().pixelsPerMetre) / Math.log(ZOOM_BAND_FACTOR))),
    bearingDeg: computed(() => normaliseBearing(Math.round(view().camera.bearingDeg * 10) / 10)),
    northUp: computed(() => view().northUp),
    groundMetresPerPixel: computed(() => threeSignificantFigures(view().metresPerPixelAt())),
    zoomLimit: computed(() => {
      const { view: current, scaleBounds } = frames.viewFrame.value
      if (current.pixelsPerMetre <= scaleBounds.min) return 'min'
      if (current.pixelsPerMetre >= scaleBounds.max) return 'max'
      return null
    }),
    designPin: coarse(() => designPin(frames.viewFrame.value), samePoint),
    settledCamera: coarse(() => frames.settledViewFrame.value.view.camera, sameCamera),
    settledRevision: computed(() => frames.settledViewFrame.value.revision),
    captureView() {
      const current = frames.viewFrame.peek().view
      const onPlane = plane()
      const corners = current.visibleWorldQuad().map((corner) => onPlane.toGeo(corner))
      const lons = corners.map((corner) => corner.lon)
      const lats = corners.map((corner) => corner.lat)
      const extent: GeoBounds = {
        west: Math.min(...lons),
        south: Math.min(...lats),
        east: Math.max(...lons),
        north: Math.max(...lats),
      }
      return { camera: current.camera, extent, screen: current.screen }
    },
  }
}

/** The plane origin's screen point in overview, rounded after the edge test, or null. */
function designPin(frame: ViewFrame): ScreenPoint | null {
  if (frame.mode !== 'overview') return null
  const origin = frame.view.worldToScreen({ x: 0, y: 0 })
  const screen: ViewScreen = frame.view.screen
  const inside = origin.x >= DESIGN_PIN_EDGE_MARGIN_PX
    && origin.x <= screen.width - DESIGN_PIN_EDGE_MARGIN_PX
    && origin.y >= DESIGN_PIN_EDGE_MARGIN_PX
    && origin.y <= screen.height - DESIGN_PIN_EDGE_MARGIN_PX
  return inside ? { x: Math.round(origin.x), y: Math.round(origin.y) } : null
}

function threeSignificantFigures(value: number): number {
  return Number.isFinite(value) && value > 0 ? Number(value.toPrecision(3)) : value
}

/** A computed that keeps its previous value while the next one is equal, so dependents see changes of value only. */
function coarse<T>(read: () => T, same: (previous: T, next: T) => boolean): ReadonlySignal<T> {
  let previous: { readonly value: T } | null = null
  return computed(() => {
    const next = read()
    if (previous && same(previous.value, next)) return previous.value
    previous = { value: next }
    return next
  })
}

function samePoint(previous: ScreenPoint | null, next: ScreenPoint | null): boolean {
  return previous === next || (previous !== null && next !== null && previous.x === next.x && previous.y === next.y)
}

function sameCamera(previous: ViewCamera, next: ViewCamera): boolean {
  return previous.center.lon === next.center.lon
    && previous.center.lat === next.center.lat
    && previous.zoom === next.zoom
    && previous.bearingDeg === next.bearingDeg
    && previous.pitchDeg === next.pitchDeg
}
