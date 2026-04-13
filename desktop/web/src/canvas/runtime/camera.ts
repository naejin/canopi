import { zoomLevel, zoomReference } from '../view-state'
import type { ScenePersistedState, ScenePoint, SceneViewportState } from './scene'
import { getAnnotationWorldBounds } from './annotation-layout'
import { getPlantWorldBounds, type PlantPresentationContext } from './plant-presentation'

const DEFAULT_VIEWPORT_METERS = 100
const DEFAULT_FIT_PADDING = 0.1
const FIT_MAX_ITERATIONS = 20
const FIT_CONVERGENCE_THRESHOLD = 0.0001
const ZOOM_FACTOR = 1.1
const ZOOM_MIN = 0.1
const ZOOM_MAX = 200

export interface CameraScreenSize {
  width: number
  height: number
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

export class CameraController {
  private _viewport: SceneViewportState = { x: 0, y: 0, scale: 1 }
  private _screen: CameraScreenSize = { width: 0, height: 0 }
  private _referenceScale = 1

  get viewport(): SceneViewportState {
    return { ...this._viewport }
  }

  get screenSize(): CameraScreenSize {
    return { ...this._screen }
  }

  initialize(screen: CameraScreenSize): SceneViewportState {
    this._screen = { ...screen }
    const scale = Math.min(screen.width, screen.height) / DEFAULT_VIEWPORT_METERS
    this._referenceScale = scale > 0 ? scale : 1
    zoomReference.value = this._referenceScale
    return this.setViewport({
      x: screen.width / 2 - (DEFAULT_VIEWPORT_METERS / 2) * scale,
      y: screen.height / 2 - (DEFAULT_VIEWPORT_METERS / 2) * scale,
      scale,
    })
  }

  resize(screen: CameraScreenSize): SceneViewportState {
    this._screen = { ...screen }
    return this.setViewport(this._viewport)
  }

  setViewport(next: SceneViewportState): SceneViewportState {
    this._viewport = {
      x: next.x,
      y: next.y,
      scale: clampScale(next.scale),
    }
    zoomLevel.value = this._viewport.scale
    return this.viewport
  }

  zoomIn(): SceneViewportState {
    return this.zoomAroundScreenPoint(
      { x: this._screen.width / 2, y: this._screen.height / 2 },
      ZOOM_FACTOR,
    )
  }

  zoomOut(): SceneViewportState {
    return this.zoomAroundScreenPoint(
      { x: this._screen.width / 2, y: this._screen.height / 2 },
      1 / ZOOM_FACTOR,
    )
  }

  zoomAroundScreenPoint(pointer: ScenePoint, factor: number): SceneViewportState {
    const oldScale = this._viewport.scale
    const newScale = clampScale(oldScale * factor)
    const worldPoint = this.screenToWorld(pointer)

    return this.setViewport({
      x: pointer.x - worldPoint.x * newScale,
      y: pointer.y - worldPoint.y * newScale,
      scale: newScale,
    })
  }

  zoomToFit(scene: ScenePersistedState, options: SceneBoundsOptions = {}): SceneViewportState {
    if (this._screen.width <= 0 || this._screen.height <= 0) {
      return this.viewport
    }

    // Annotations and default-mode plants have screen-space dimensions, so their
    // world-space footprint is inversely proportional to scale. Computing bounds
    // once with the current scale and deriving a new scale creates a circular
    // dependency - each call only moves partway toward the true fit. Iterate
    // until the scale converges (typically 2-3 rounds).
    let currentScale = options.annotationViewportScale ?? this._viewport.scale
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
        (this._screen.width * (1 - DEFAULT_FIT_PADDING * 2)) / contentWidth,
        (this._screen.height * (1 - DEFAULT_FIT_PADDING * 2)) / contentHeight,
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
      x: (this._screen.width - contentWidth * scale) / 2 - finalBounds.minX * scale,
      y: (this._screen.height - contentHeight * scale) / 2 - finalBounds.minY * scale,
      scale,
    })
  }

  panBy(delta: ScenePoint): SceneViewportState {
    return this.setViewport({
      x: this._viewport.x + delta.x,
      y: this._viewport.y + delta.y,
      scale: this._viewport.scale,
    })
  }

  worldToScreen(point: ScenePoint): ScenePoint {
    return {
      x: point.x * this._viewport.scale + this._viewport.x,
      y: point.y * this._viewport.scale + this._viewport.y,
    }
  }

  screenToWorld(point: ScenePoint): ScenePoint {
    return {
      x: (point.x - this._viewport.x) / this._viewport.scale,
      y: (point.y - this._viewport.y) / this._viewport.scale,
    }
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
    const bounds = getPlantWorldBounds(plant, plantBoundsContext(basePlantContext, annotationViewportScale))
    includePoint({ x: bounds.x, y: bounds.y })
    includePoint({ x: bounds.x + bounds.width, y: bounds.y + bounds.height })
  }

  for (const zone of scene.zones) {
    if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
      const center = zone.points[0]!
      const radii = zone.points[1]!
      includePoint({ x: center.x - radii.x, y: center.y - radii.y })
      includePoint({ x: center.x + radii.x, y: center.y + radii.y })
      continue
    }

    for (const point of zone.points) includePoint(point)
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
    sizeMode: 'default',
    colorByAttr: null,
    speciesCache: new Map(),
    zoomReference: zoomReference.value > 0 ? zoomReference.value : 1,
  }
}

function clampScale(scale: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))
}
