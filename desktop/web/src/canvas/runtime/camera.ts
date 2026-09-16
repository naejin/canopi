import { signal, type ReadonlySignal } from '@preact/signals'
import type { ScenePersistedState, ScenePoint, SceneViewportState } from './scene'
import { getAnnotationWorldBounds } from './annotation-layout'
import { getPlantWorldBounds, type PlantPresentationContext } from './plant-presentation'
import { getZoneWorldBounds } from './zone-geometry'
import {
  cameraScaleBoundsForPolicy,
  createWorkspaceCameraPolicy,
  isWorkspaceOverviewScale,
  type WorkspaceCameraPolicy,
  type WorkspaceCameraScaleBounds,
} from '../workspace-camera-policy'

const DEFAULT_VIEWPORT_METERS = 100
const ZOOM_REFERENCE_SCALE = 20
const DEFAULT_FIT_PADDING = 0.1
const FIT_MAX_ITERATIONS = 20
const FIT_CONVERGENCE_THRESHOLD = 0.0001
const ZOOM_FACTOR = 1.1
const DEFAULT_CAMERA_POLICY = createWorkspaceCameraPolicy()
const DEFAULT_SCALE_BOUNDS = cameraScaleBoundsForPolicy(DEFAULT_CAMERA_POLICY)

export type WorkspaceCameraMode = 'site' | 'overview'

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
  readonly scaleBounds: Readonly<WorkspaceCameraScaleBounds>
  readonly overviewScaleThreshold: number
  readonly mode: WorkspaceCameraMode
  /** Geographic ground resolution for map overview chrome; absent in local fallback. */
  readonly groundMetersPerCssPixel: number | null
  readonly revision: number
}

/** The complete immutable-frame payload published by a workspace camera owner. */
export interface CameraViewportPublication {
  readonly viewport: Readonly<SceneViewportState>
  readonly screenSize: Readonly<CameraScreenSize>
  readonly devicePixelRatio: number
  readonly referenceScale: number
  readonly scaleBounds: Readonly<WorkspaceCameraScaleBounds>
  readonly overviewScaleThreshold: number
  readonly groundMetersPerCssPixel: number | null
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
  returnToDesign(scene: ScenePersistedState, options?: SceneBoundsOptions): SceneViewportState
  panBy(delta: ScenePoint): SceneViewportState
  focusTemporaryBounds(bounds: SceneBounds, options: TemporaryBoundsFocusOptions): boolean
  returnFromTemporaryFocus(): boolean
  clearTemporaryFocus(): void
}

/** Owns the paired read and command roles admitted into one active workspace. */
export interface WorkspaceCameraOwner {
  readonly frame: WorkspaceCameraFrameReader
  readonly navigation: WorkspaceCameraNavigation
  /** Must detach owner-specific listeners and be safe to call during failed setup. */
  dispose(): void
}

export interface WorkspaceCameraPolicyOwner {
  readonly policy: WorkspaceCameraPolicy
  replacePolicy(policy: WorkspaceCameraPolicy): SceneViewportState
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

export interface TemporaryBoundsFocusOptions {
  /** Symmetric CSS-pixel padding reserved by the caller's presentation. */
  readonly paddingCssPx: number
  /** Optional external ceiling, such as a MapLibre zoom-limit equivalent. */
  readonly maximumScale?: number
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
    scaleBounds: DEFAULT_SCALE_BOUNDS,
    overviewScaleThreshold: DEFAULT_CAMERA_POLICY.overviewScaleThreshold,
    groundMetersPerCssPixel: null,
    mode: 'site',
    revision: 0,
  }))
  private temporaryFocusBookmark: SceneViewportState | null = null
  private _policy: WorkspaceCameraPolicy

  readonly snapshot: ReadonlySignal<CameraViewportSnapshot> = this._snapshot
  readonly frame: WorkspaceCameraFrameReader = this
  readonly navigation: WorkspaceCameraNavigation = this

  constructor(policy: WorkspaceCameraPolicy = DEFAULT_CAMERA_POLICY) {
    this._policy = policy
    const bounds = cameraScaleBoundsForPolicy(policy)
    this._snapshot.value = createCameraViewportSnapshot({
      ...this._snapshot.peek(),
      scaleBounds: bounds,
      overviewScaleThreshold: policy.overviewScaleThreshold,
      mode: isWorkspaceOverviewScale(1, policy) ? 'overview' : 'site',
    })
  }

  get policy(): WorkspaceCameraPolicy { return this._policy }

  get viewport(): SceneViewportState {
    return { ...this._snapshot.peek().viewport }
  }

  get screenSize(): CameraScreenSize {
    return { ...this._snapshot.peek().screenSize }
  }

  replacePolicy(policy: WorkspaceCameraPolicy): SceneViewportState {
    this.clearTemporaryFocus()
    const current = this._snapshot.peek()
    const scaleBounds = cameraScaleBoundsForPolicy(policy)
    const viewport = zoomCameraViewportToScale(
      current,
      { x: current.screenSize.width / 2, y: current.screenSize.height / 2 },
      clampCameraScale(current.viewport.scale, scaleBounds),
    )
    this._policy = policy
    return this.publishFrame({
      viewport,
      screenSize: current.screenSize,
      devicePixelRatio: current.devicePixelRatio,
      referenceScale: current.referenceScale,
      scaleBounds,
      overviewScaleThreshold: policy.overviewScaleThreshold,
      groundMetersPerCssPixel: null,
    })
  }

  initialize(screen: CameraScreenMetrics): SceneViewportState {
    this.clearTemporaryFocus()
    return this.publishFrame(createInitialCameraFrame(screen, this._policy))
  }

  resize(screen: CameraScreenMetrics): SceneViewportState {
    const current = this._snapshot.peek()
    const metrics = normalizeScreenMetrics(screen)
    return this.publishFrame({
      viewport: current.viewport,
      screenSize: metrics,
      devicePixelRatio: metrics.devicePixelRatio,
      referenceScale: current.referenceScale,
      scaleBounds: current.scaleBounds,
      overviewScaleThreshold: current.overviewScaleThreshold,
      groundMetersPerCssPixel: current.groundMetersPerCssPixel,
    })
  }

  setViewport(next: SceneViewportState): SceneViewportState {
    const current = this._snapshot.peek()
    const viewport = normalizeViewport(next, current.scaleBounds)
    if (!viewport) return this.viewport
    return this.publishFrame({
      viewport,
      screenSize: current.screenSize,
      devicePixelRatio: current.devicePixelRatio,
      referenceScale: current.referenceScale,
      scaleBounds: current.scaleBounds,
      overviewScaleThreshold: current.overviewScaleThreshold,
      groundMetersPerCssPixel: current.groundMetersPerCssPixel,
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
    return this.setViewport(zoomCameraViewport(
      this._snapshot.peek(),
      pointer,
      factor,
    ))
  }

  zoomToFit(scene: ScenePersistedState, options: SceneBoundsOptions = {}): SceneViewportState {
    return this.setViewport(fitCameraViewport(this._snapshot.peek(), scene, options))
  }

  returnToDesign(scene: ScenePersistedState, options: SceneBoundsOptions = {}): SceneViewportState {
    const snapshot = this._snapshot.peek()
    const fitted = fitCameraViewport(snapshot, scene, options)
    if (
      fitted.scale >= snapshot.overviewScaleThreshold
      && !sameViewport(fitted, snapshot.viewport)
    ) return this.setViewport(fitted)

    const scale = clampCameraScale(
      Math.min(snapshot.screenSize.width, snapshot.screenSize.height) / DEFAULT_VIEWPORT_METERS,
      snapshot.scaleBounds,
    )
    return this.setViewport({
      x: snapshot.screenSize.width / 2,
      y: snapshot.screenSize.height / 2,
      scale: Math.max(snapshot.overviewScaleThreshold, scale),
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

  focusTemporaryBounds(
    bounds: SceneBounds,
    options: TemporaryBoundsFocusOptions,
  ): boolean {
    const focusedViewport = fitTemporaryBoundsViewport(this._snapshot.peek(), bounds, options)
    if (!focusedViewport) return false
    if (!this.temporaryFocusBookmark) this.temporaryFocusBookmark = { ...this._snapshot.peek().viewport }
    this.setViewport(focusedViewport)
    return true
  }

  returnFromTemporaryFocus(): boolean {
    const bookmark = this.temporaryFocusBookmark
    if (!bookmark) return false
    this.temporaryFocusBookmark = null
    this.setViewport(bookmark)
    return true
  }

  clearTemporaryFocus(): void {
    this.temporaryFocusBookmark = null
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

  dispose(): void {
    this.clearTemporaryFocus()
  }

  /** Lets a specialized owner publish its externally-derived active frame. */
  protected publishFrame(next: CameraViewportPublication): SceneViewportState {
    const current = this._snapshot.peek()
    this._snapshot.value = nextCameraViewportSnapshot(current, next)
    return this.viewport
  }
}

/** Creates the shared default local-metre frame without publishing it. */
export function createInitialCameraFrame(
  screen: CameraScreenMetrics,
  policy: WorkspaceCameraPolicy = DEFAULT_CAMERA_POLICY,
): CameraViewportPublication {
  const metrics = normalizeScreenMetrics(screen)
  const scaleBounds = cameraScaleBoundsForPolicy(policy)
  const scale = clampCameraScale(
    Math.min(metrics.width, metrics.height) / DEFAULT_VIEWPORT_METERS,
    scaleBounds,
  )
  return {
    viewport: {
      x: metrics.width / 2 - (DEFAULT_VIEWPORT_METERS / 2) * scale,
      y: metrics.height / 2 - (DEFAULT_VIEWPORT_METERS / 2) * scale,
      scale,
    },
    screenSize: metrics,
    devicePixelRatio: metrics.devicePixelRatio,
    referenceScale: ZOOM_REFERENCE_SCALE,
    scaleBounds,
    overviewScaleThreshold: policy.overviewScaleThreshold,
    groundMetersPerCssPixel: null,
  }
}

/**
 * Applies one frame transition while preserving immutable nested values,
 * monotonic revisions, and exact no-op identity. Shared camera owners use this
 * instead of keeping a second mutable viewport representation.
 */
export function nextCameraViewportSnapshot(
  current: CameraViewportSnapshot,
  next: CameraViewportPublication,
): CameraViewportSnapshot {
  if (
    !validScaleBounds(next.scaleBounds)
    || !Number.isFinite(next.screenSize.width)
    || !Number.isFinite(next.screenSize.height)
    || next.screenSize.width < 0
    || next.screenSize.height < 0
    || !Number.isFinite(next.devicePixelRatio)
    || next.devicePixelRatio <= 0
    || !Number.isFinite(next.referenceScale)
    || next.referenceScale <= 0
    || !Number.isFinite(next.overviewScaleThreshold)
    || next.overviewScaleThreshold <= 0
    || (next.groundMetersPerCssPixel !== null && (
      !Number.isFinite(next.groundMetersPerCssPixel)
      || next.groundMetersPerCssPixel <= 0
    ))
  ) return current
  const viewport = finiteViewportWithinBounds(next.viewport, next.scaleBounds)
  if (!viewport) return current
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
    && current.scaleBounds.minimum === next.scaleBounds.minimum
    && current.scaleBounds.maximum === next.scaleBounds.maximum
    && current.overviewScaleThreshold === next.overviewScaleThreshold
    && current.groundMetersPerCssPixel === next.groundMetersPerCssPixel
  ) {
    return current
  }

  return createCameraViewportSnapshot({
    viewport,
    screenSize,
    devicePixelRatio: next.devicePixelRatio,
    referenceScale: next.referenceScale,
    scaleBounds: next.scaleBounds,
    overviewScaleThreshold: next.overviewScaleThreshold,
    groundMetersPerCssPixel: next.groundMetersPerCssPixel,
    mode: isWorkspaceOverviewScale(viewport.scale, {
      overviewScaleThreshold: next.overviewScaleThreshold,
    }) ? 'overview' : 'site',
    revision: current.revision + 1,
  })
}

/** Derives a pointer-anchored zoom without publishing a second frame. */
export function zoomCameraViewport(
  snapshot: CameraViewportSnapshot,
  pointer: ScenePoint,
  factor: number,
): SceneViewportState {
  const currentViewport = snapshot.viewport
  if (!Number.isFinite(factor) || factor <= 0 || !finitePoint(pointer)) return { ...currentViewport }
  const newScale = clampCameraScale(currentViewport.scale * factor, snapshot.scaleBounds)
  return zoomCameraViewportToScale(snapshot, pointer, newScale)
}

function zoomCameraViewportToScale(
  snapshot: Pick<CameraViewportSnapshot, 'viewport'>,
  pointer: ScenePoint,
  newScale: number,
): SceneViewportState {
  const currentViewport = snapshot.viewport
  if (newScale === currentViewport.scale) return { ...currentViewport }
  const worldPoint = {
    x: (pointer.x - currentViewport.x) / currentViewport.scale,
    y: (pointer.y - currentViewport.y) / currentViewport.scale,
  }
  return {
    x: pointer.x - worldPoint.x * newScale,
    y: pointer.y - worldPoint.y * newScale,
    scale: newScale,
  }
}

/** Derives the fit viewport using the same scale-dependent bounds policy as Canvas2D. */
export function fitCameraViewport(
  snapshot: CameraViewportSnapshot,
  scene: ScenePersistedState,
  options: SceneBoundsOptions = {},
): SceneViewportState {
  const screen = snapshot.screenSize
  if (screen.width <= 0 || screen.height <= 0) return { ...snapshot.viewport }

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
    if (!bounds) return { ...snapshot.viewport }

    const contentWidth = Math.max(bounds.maxX - bounds.minX, 1)
    const contentHeight = Math.max(bounds.maxY - bounds.minY, 1)
    scale = clampCameraScale(Math.min(
      (screen.width * (1 - DEFAULT_FIT_PADDING * 2)) / contentWidth,
      (screen.height * (1 - DEFAULT_FIT_PADDING * 2)) / contentHeight,
    ), snapshot.scaleBounds)

    if (Math.abs(scale - currentScale) / Math.max(scale, currentScale) < FIT_CONVERGENCE_THRESHOLD) break
    currentScale = scale
  }

  const finalBounds = bounds!
  const contentWidth = Math.max(finalBounds.maxX - finalBounds.minX, 1)
  const contentHeight = Math.max(finalBounds.maxY - finalBounds.minY, 1)
  return {
    x: (screen.width - contentWidth * scale) / 2 - finalBounds.minX * scale,
    y: (screen.height - contentHeight * scale) / 2 - finalBounds.minY * scale,
    scale,
  }
}

/**
 * Fits finite local-world bounds inside the current CSS-pixel frame. The
 * calculation is renderer-neutral; callers choose their own presentation
 * padding and any external scale ceiling.
 */
export function fitTemporaryBoundsViewport(
  snapshot: CameraViewportSnapshot,
  bounds: SceneBounds,
  options: TemporaryBoundsFocusOptions,
): SceneViewportState | null {
  const { width, height } = snapshot.screenSize
  const { minX, minY, maxX, maxY } = bounds
  const padding = options.paddingCssPx
  const maximumScale = options.maximumScale ?? snapshot.scaleBounds.maximum
  if (
    ![width, height, minX, minY, maxX, maxY, padding, maximumScale].every(Number.isFinite)
    || width <= 0
    || height <= 0
    || minX >= maxX
    || minY >= maxY
    || padding < 0
    || maximumScale < snapshot.scaleBounds.minimum
  ) return null

  const availableWidth = width - padding * 2
  const availableHeight = height - padding * 2
  if (availableWidth <= 0 || availableHeight <= 0) return null

  const scale = clampCameraScale(Math.min(
    availableWidth / (maxX - minX),
    availableHeight / (maxY - minY),
    maximumScale,
  ), snapshot.scaleBounds)
  if (!Number.isFinite(scale) || scale > maximumScale) return null

  return {
    x: width / 2 - ((minX + maxX) / 2) * scale,
    y: height / 2 - ((minY + maxY) / 2) * scale,
    scale,
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
    scaleBounds: Object.freeze({ ...snapshot.scaleBounds }),
    overviewScaleThreshold: snapshot.overviewScaleThreshold,
    groundMetersPerCssPixel: snapshot.groundMetersPerCssPixel,
    mode: snapshot.mode,
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

export function clampCameraScale(
  scale: number,
  bounds: WorkspaceCameraScaleBounds = DEFAULT_SCALE_BOUNDS,
): number {
  return Math.min(bounds.maximum, Math.max(bounds.minimum, scale))
}

function normalizeViewport(
  viewport: SceneViewportState,
  bounds: WorkspaceCameraScaleBounds,
): SceneViewportState | null {
  if (!finitePoint(viewport) || !Number.isFinite(viewport.scale) || !validScaleBounds(bounds)) return null
  return {
    x: viewport.x,
    y: viewport.y,
    scale: clampCameraScale(viewport.scale, bounds),
  }
}

function finiteViewportWithinBounds(
  viewport: SceneViewportState,
  bounds: WorkspaceCameraScaleBounds,
): SceneViewportState | null {
  if (
    !finitePoint(viewport)
    || !Number.isFinite(viewport.scale)
    || viewport.scale < bounds.minimum
    || viewport.scale > bounds.maximum
  ) return null
  return { x: viewport.x, y: viewport.y, scale: viewport.scale }
}

function validScaleBounds(bounds: WorkspaceCameraScaleBounds): boolean {
  return Number.isFinite(bounds.minimum)
    && Number.isFinite(bounds.maximum)
    && bounds.minimum > 0
    && bounds.maximum >= bounds.minimum
}

function finitePoint(point: ScenePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function sameViewport(left: Readonly<SceneViewportState>, right: Readonly<SceneViewportState>): boolean {
  return left.x === right.x && left.y === right.y && left.scale === right.scale
}
