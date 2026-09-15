import { signal, type ReadonlySignal } from '@preact/signals'
import type { ScenePersistedState, ScenePoint, SceneViewportState } from './scene'
import { getAnnotationWorldBounds } from './annotation-layout'
import { getPlantWorldBounds, type PlantPresentationContext } from './plant-presentation'
import { getZoneWorldBounds } from './zone-geometry'

const DEFAULT_VIEWPORT_METERS = 100
const ZOOM_REFERENCE_SCALE = 20
const DEFAULT_FIT_PADDING = 0.1
const FIT_MAX_ITERATIONS = 20
const FIT_CONVERGENCE_THRESHOLD = 0.0001
const ZOOM_FACTOR = 1.1
const ZOOM_MIN = 0.1
const ZOOM_MAX = 1000

export interface CameraScreenSize {
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
  readonly revision: number
}

/** Converts between local metres and CSS-pixel screen coordinates for one frame. */
export interface WorkspaceCameraFrameReader {
  readonly snapshot: ReadonlySignal<CameraViewportSnapshot>
  readonly viewport: SceneViewportState
  readonly screenSize: CameraScreenSize
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
  panBy(delta: ScenePoint): SceneViewportState
}

/** Owns the paired read and command roles admitted into one active workspace. */
export interface WorkspaceCameraOwner {
  readonly frame: WorkspaceCameraFrameReader
  readonly navigation: WorkspaceCameraNavigation
  /** Must detach owner-specific listeners and be safe to call during failed setup. */
  dispose(): void
}

export interface SceneBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface SceneBoundsOptions {
  annotationViewportScale?: number
  plantContext?: PlantPresentationContext
}

export class CameraController implements
  WorkspaceCameraFrameReader,
  WorkspaceCameraNavigation,
  WorkspaceCameraOwner {
  private readonly _snapshot = signal<CameraViewportSnapshot>(createCameraViewportSnapshot({
    viewport: { x: 0, y: 0, scale: 1 },
    screenSize: { width: 0, height: 0 },
    devicePixelRatio: 1,
    referenceScale: ZOOM_REFERENCE_SCALE,
    revision: 0,
  }))

  readonly snapshot: ReadonlySignal<CameraViewportSnapshot> = this._snapshot
  readonly frame: WorkspaceCameraFrameReader = this
  readonly navigation: WorkspaceCameraNavigation = this

  get viewport(): SceneViewportState {
    return { ...this._snapshot.peek().viewport }
  }

  get screenSize(): CameraScreenSize {
    return { ...this._snapshot.peek().screenSize }
  }

  initialize(screen: CameraScreenMetrics): SceneViewportState {
    const metrics = normalizeScreenMetrics(screen)
    const scale = Math.min(metrics.width, metrics.height) / DEFAULT_VIEWPORT_METERS
    return this._publish({
      viewport: {
        x: metrics.width / 2 - (DEFAULT_VIEWPORT_METERS / 2) * scale,
        y: metrics.height / 2 - (DEFAULT_VIEWPORT_METERS / 2) * scale,
        scale,
      },
      screenSize: metrics,
      devicePixelRatio: metrics.devicePixelRatio,
      referenceScale: ZOOM_REFERENCE_SCALE,
    })
  }

  resize(screen: CameraScreenMetrics): SceneViewportState {
    const current = this._snapshot.peek()
    const metrics = normalizeScreenMetrics(screen)
    return this._publish({
      viewport: current.viewport,
      screenSize: metrics,
      devicePixelRatio: metrics.devicePixelRatio,
      referenceScale: current.referenceScale,
    })
  }

  setViewport(next: SceneViewportState): SceneViewportState {
    const current = this._snapshot.peek()
    return this._publish({
      viewport: next,
      screenSize: current.screenSize,
      devicePixelRatio: current.devicePixelRatio,
      referenceScale: current.referenceScale,
    })
  }

  zoomIn(): SceneViewportState {
    const screen = this._snapshot.peek().screenSize
    return this.zoomAroundScreenPoint(
      { x: screen.width / 2, y: screen.height / 2 },
      ZOOM_FACTOR,
    )
  }

  zoomOut(): SceneViewportState {
    const screen = this._snapshot.peek().screenSize
    return this.zoomAroundScreenPoint(
      { x: screen.width / 2, y: screen.height / 2 },
      1 / ZOOM_FACTOR,
    )
  }

  zoomAroundScreenPoint(pointer: ScenePoint, factor: number): SceneViewportState {
    const currentViewport = this._snapshot.peek().viewport
    const oldScale = currentViewport.scale
    const newScale = clampScale(oldScale * factor)
    if (newScale === oldScale) return this.viewport
    const worldPoint = this.screenToWorld(pointer)

    return this.setViewport({
      x: pointer.x - worldPoint.x * newScale,
      y: pointer.y - worldPoint.y * newScale,
      scale: newScale,
    })
  }

  zoomToFit(scene: ScenePersistedState, options: SceneBoundsOptions = {}): SceneViewportState {
    const snapshot = this._snapshot.peek()
    const screen = snapshot.screenSize
    if (screen.width <= 0 || screen.height <= 0) {
      return this.viewport
    }

    // Annotations and default-mode plants have screen-space dimensions, so their
    // world-space footprint is inversely proportional to scale. Computing bounds
    // once with the current scale and deriving a new scale creates a circular
    // dependency - each call only moves partway toward the true fit. Iterate
    // until the scale converges (typically 2-3 rounds).
    let currentScale = options.annotationViewportScale ?? snapshot.viewport.scale
    let bounds: SceneBounds | null = null
    let scale = currentScale

    for (let i = 0; i < FIT_MAX_ITERATIONS; i++) {
      bounds = computeSceneBounds(scene, {
        annotationViewportScale: currentScale,
        plantContext: options.plantContext,
      })
      if (!bounds) return this.viewport

      const contentWidth = Math.max(bounds.maxX - bounds.minX, 1)
      const contentHeight = Math.max(bounds.maxY - bounds.minY, 1)
      scale = clampScale(Math.min(
        (screen.width * (1 - DEFAULT_FIT_PADDING * 2)) / contentWidth,
        (screen.height * (1 - DEFAULT_FIT_PADDING * 2)) / contentHeight,
      ))

      if (Math.abs(scale - currentScale) / Math.max(scale, currentScale) < FIT_CONVERGENCE_THRESHOLD) {
        break
      }
      currentScale = scale
    }

    const finalBounds = bounds!
    const contentWidth = Math.max(finalBounds.maxX - finalBounds.minX, 1)
    const contentHeight = Math.max(finalBounds.maxY - finalBounds.minY, 1)

    return this.setViewport({
      x: (screen.width - contentWidth * scale) / 2 - finalBounds.minX * scale,
      y: (screen.height - contentHeight * scale) / 2 - finalBounds.minY * scale,
      scale,
    })
  }

  panBy(delta: ScenePoint): SceneViewportState {
    const viewport = this._snapshot.peek().viewport
    return this.setViewport({
      x: viewport.x + delta.x,
      y: viewport.y + delta.y,
      scale: viewport.scale,
    })
  }

  worldToScreen(point: ScenePoint): ScenePoint {
    const viewport = this._snapshot.peek().viewport
    return {
      x: point.x * viewport.scale + viewport.x,
      y: point.y * viewport.scale + viewport.y,
    }
  }

  screenToWorld(point: ScenePoint): ScenePoint {
    const viewport = this._snapshot.peek().viewport
    return {
      x: (point.x - viewport.x) / viewport.scale,
      y: (point.y - viewport.y) / viewport.scale,
    }
  }

  dispose(): void {}

  private _publish(next: {
    readonly viewport: Readonly<SceneViewportState>
    readonly screenSize: Readonly<CameraScreenSize>
    readonly devicePixelRatio: number
    readonly referenceScale: number
  }): SceneViewportState {
    const current = this._snapshot.peek()
    const viewport = {
      x: next.viewport.x,
      y: next.viewport.y,
      scale: clampScale(next.viewport.scale),
    }
    const screenSize = {
      width: next.screenSize.width,
      height: next.screenSize.height,
    }
    if (
      current.viewport.x === viewport.x
      && current.viewport.y === viewport.y
      && current.viewport.scale === viewport.scale
      && current.screenSize.width === screenSize.width
      && current.screenSize.height === screenSize.height
      && current.devicePixelRatio === next.devicePixelRatio
      && current.referenceScale === next.referenceScale
    ) {
      return this.viewport
    }

    this._snapshot.value = createCameraViewportSnapshot({
      viewport,
      screenSize,
      devicePixelRatio: next.devicePixelRatio,
      referenceScale: next.referenceScale,
      revision: current.revision + 1,
    })
    return this.viewport
  }
}

export function computeSceneBounds(
  scene: ScenePersistedState,
  options: number | SceneBoundsOptions = {},
): SceneBounds | null {
  const annotationViewportScale = typeof options === 'number'
    ? options
    : (options.annotationViewportScale ?? 1)
  const basePlantContext = typeof options === 'number'
    ? null
    : (options.plantContext ?? null)
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  const includePoint = (point: ScenePoint): void => {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }

  for (const plant of scene.plants) {
    const bounds = getPlantWorldBounds(plant, { ...plantBoundsContext(basePlantContext, annotationViewportScale), plants: scene.plants })
    includePoint({ x: bounds.x, y: bounds.y })
    includePoint({ x: bounds.x + bounds.width, y: bounds.y + bounds.height })
  }

  for (const zone of scene.zones) {
    const bounds = getZoneWorldBounds(zone)
    if (!bounds) continue
    includePoint({ x: bounds.x, y: bounds.y })
    includePoint({ x: bounds.x + bounds.width, y: bounds.y + bounds.height })
  }

  for (const annotation of scene.annotations) {
    const bounds = getAnnotationWorldBounds(annotation, annotationViewportScale)
    includePoint({ x: bounds.x, y: bounds.y })
    includePoint({ x: bounds.x + bounds.width, y: bounds.y + bounds.height })
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  return { minX, minY, maxX, maxY }
}

function plantBoundsContext(
  context: PlantPresentationContext | null,
  viewportScale: number,
): PlantPresentationContext {
  if (context) {
    return {
      ...context,
      viewport: {
        x: 0,
        y: 0,
        scale: viewportScale,
      },
    }
  }

  return {
    viewport: { x: 0, y: 0, scale: viewportScale },
    speciesCache: new Map(),
  }
}

function createCameraViewportSnapshot(
  snapshot: CameraViewportSnapshot,
): CameraViewportSnapshot {
  return Object.freeze({
    viewport: Object.freeze({ ...snapshot.viewport }),
    screenSize: Object.freeze({
      width: snapshot.screenSize.width,
      height: snapshot.screenSize.height,
    }),
    devicePixelRatio: snapshot.devicePixelRatio,
    referenceScale: snapshot.referenceScale,
    revision: snapshot.revision,
  })
}

function normalizeScreenMetrics(screen: CameraScreenMetrics): Required<CameraScreenMetrics> {
  const devicePixelRatio = screen.devicePixelRatio
    ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio)
  return {
    width: finiteNonNegative(screen.width),
    height: finiteNonNegative(screen.height),
    devicePixelRatio: Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1,
  }
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function clampScale(scale: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))
}
