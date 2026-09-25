import {
  CameraController,
  clampCameraScale,
  createInitialCameraFrame,
  type CameraScreenMetrics,
  type CameraViewportPublication,
  type WorkspaceCameraOwner,
} from '../canvas/runtime/camera'
import type { SceneViewportState } from '../canvas/runtime/scene'
import { createMapFrame } from '../canvas/maplibre-camera'
import { mapZoomToStageScale } from '../canvas/projection'
import {
  cameraScaleBoundsForPolicy,
  createWorkspaceCameraPolicy,
  singleWorldEffectiveMinimumZoom,
  type WorkspaceCameraPolicy,
  type WorkspaceCameraScaleBounds,
} from '../canvas/workspace-camera-policy'
import { deriveSharedMapSceneViewport } from './scene-camera-transform'
import type { MapLibreMapInstance } from './loader'

export interface MapLibreWorkspaceCameraAttachment {
  /** One already-created map; map mounting remains owned by the workspace lifecycle. */
  readonly map: MapLibreWorkspaceCameraMap
  /** Live session plane origin; read on every frame so re-origin needs no reattach. */
  readonly readOrigin: () => { readonly lat: number; readonly lon: number }
  readonly maximumWorldExtentMeters?: number
}

/** The only map operations required by the live workspace camera owner. */
export type MapLibreWorkspaceCameraMap = Required<Pick<MapLibreMapInstance,
  | 'jumpTo'
  | 'resize'
  | 'on'
  | 'off'
  | 'project'
  | 'getPitch'
  | 'getZoom'
  | 'getMinZoom'
  | 'getMaxZoom'
  | 'getCenter'
  | 'getCanvas'
>>

export type MapLibreWorkspaceCameraFailure =
  | { readonly kind: 'invalid-projection'; readonly reason: string }
  | { readonly kind: 'attachment-error'; readonly error: unknown }

export interface MapLibreWorkspaceCameraOwnerOptions {
  /** Called once for each attached map that cannot provide a valid shared frame. */
  readonly onAttachmentFailure?: (failure: MapLibreWorkspaceCameraFailure) => void
  readonly policy?: WorkspaceCameraPolicy
}

/**
 * The future workspace lifecycle receives only this narrow map-lifetime control.
 * It never owns or replaces the camera's stable frame signal.
 */
export interface WorkspaceCameraAttachmentControl {
  attach(attachment: MapLibreWorkspaceCameraAttachment): boolean
  detach(): void
  /** Republishes the frame after the session plane origin changed; the map stays put. */
  refreshOrigin(): void
  /** Workspace owners may observe failures without taking over camera ownership. */
  subscribeFailure(observer: (failure: MapLibreWorkspaceCameraFailure) => void): () => void
}

interface ActiveAttachment {
  readonly attachment: MapLibreWorkspaceCameraAttachment
  readonly generation: number
  readonly moveListener: () => void
  readonly resizeListener: () => void
  lastValidFrame: CameraViewportPublication
  failureReported: boolean
  resolvedMinimumZoom: number | null
}

/**
 * The workspace camera: the session-plane viewport while detached, and one
 * attached MapLibre map's camera once admitted. Extending CameraController
 * keeps frame identity, no-op semantics and detached navigation in one place.
 */
export class MapLibreWorkspaceCameraOwner extends CameraController
  implements WorkspaceCameraOwner {
  private active: ActiveAttachment | null = null
  private generation = 0
  private disposed = false
  private readonly failureObservers = new Set<(failure: MapLibreWorkspaceCameraFailure) => void>()

  readonly attachment: WorkspaceCameraAttachmentControl = {
    attach: (next) => this.attach(next),
    detach: () => this.detach(),
    refreshOrigin: () => this.refreshOrigin(),
    subscribeFailure: (observer) => this.subscribeFailure(observer),
  }

  constructor(private readonly options: MapLibreWorkspaceCameraOwnerOptions = {}) {
    super(options.policy ?? createWorkspaceCameraPolicy())
  }

  attach(attachment: MapLibreWorkspaceCameraAttachment): boolean {
    if (this.disposed) return false
    this.detach()
    this.syncPolicyToOrigin(attachment.readOrigin())

    const generation = ++this.generation
    const active: ActiveAttachment = {
      attachment,
      generation,
      moveListener: () => this.publishAttachedFrame(active),
      resizeListener: () => this.publishAttachedFrame(active),
      lastValidFrame: this.snapshot.peek(),
      failureReported: false,
      resolvedMinimumZoom: null,
    }

    try {
      this.active = active
      const current = this.snapshot.peek()
      const initialFrame = createMapFrame(
        this.boundAttachedViewport(attachment.map, current.viewport),
        this.mapScreenMetrics(attachment.map),
        attachment.readOrigin(),
        this.policy,
      )
      if (!initialFrame) throw new Error('Cannot attach a map camera without a finite viewport and screen size.')

      attachment.map.on('move', active.moveListener)
      attachment.map.on('resize', active.resizeListener)
      const beforeZoom = attachment.map.getZoom()
      attachment.map.jumpTo({
        center: [initialFrame.center[0], initialFrame.center[1]],
        zoom: initialFrame.zoom,
        bearing: initialFrame.bearing,
      })
      this.recordResolvedMinimum(active, beforeZoom, initialFrame.zoom)
      this.publishAttachedFrame(active)
      return this.active === active
    } catch (error) {
      this.failAttachment(active, { kind: 'attachment-error', error })
      return false
    }
  }

  detach(): void {
    const active = this.active
    if (!active) return
    this.deactivate(active)
  }

  refreshOrigin(): void {
    const active = this.active
    if (!active) return
    this.syncPolicyToOrigin(active.attachment.readOrigin())
    this.publishAttachedFrame(active)
  }

  private syncPolicyToOrigin(origin: { readonly lat: number }): void {
    if (this.policy.referenceLatitudeDeg !== origin.lat) {
      this.replacePolicy(createWorkspaceCameraPolicy(origin.lat))
    }
  }

  private subscribeFailure(
    observer: (failure: MapLibreWorkspaceCameraFailure) => void,
  ): () => void {
    if (this.disposed) return () => {}
    this.failureObservers.add(observer)
    return () => this.failureObservers.delete(observer)
  }

  override initialize(screen: CameraScreenMetrics): SceneViewportState {
    this.clearTemporaryFocus()
    const active = this.active
    if (!active) return super.initialize(screen)
    return this.jumpAttachedMap(
      active,
      createInitialCameraFrame(this.mapScreenMetrics(active.attachment.map), this.policy).viewport,
    )
  }

  override resize(screen: CameraScreenMetrics): SceneViewportState {
    const active = this.active
    if (!active) return super.resize(screen)
    return this.resizeAttachedMap(active)
  }

  override setViewport(viewport: SceneViewportState): SceneViewportState {
    const active = this.active
    if (!active) return super.setViewport(viewport)
    return this.jumpAttachedMap(active, viewport)
  }

  override dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearTemporaryFocus()
    this.detach()
  }

  private resizeAttachedMap(active: ActiveAttachment): SceneViewportState {
    try {
      active.attachment.map.resize()
      return this.publishAttachedFrame(active)
    } catch (error) {
      this.failAttachment(active, { kind: 'attachment-error', error })
      return this.viewport
    }
  }

  private jumpAttachedMap(
    active: ActiveAttachment,
    viewport: SceneViewportState,
  ): SceneViewportState {
    let boundedViewport = viewport
    try {
      boundedViewport = this.boundAttachedViewport(active.attachment.map, viewport)
      const current = this.snapshot.peek().viewport
      if (sameViewport(boundedViewport, current)) return this.viewport
      const frame = createMapFrame(
        boundedViewport,
        this.mapScreenMetrics(active.attachment.map),
        active.attachment.readOrigin(),
        this.policy,
      )
      if (!frame) throw new Error('Cannot navigate MapLibre without a finite CSS-pixel frame.')
      const beforeZoom = active.attachment.map.getZoom()
      active.attachment.map.jumpTo({
        center: [frame.center[0], frame.center[1]],
        zoom: frame.zoom,
        bearing: frame.bearing,
      })
      this.recordResolvedMinimum(active, beforeZoom, frame.zoom)
      const published = this.publishAttachedFrame(active)
      if (!this.disposed && this.active === null) return super.setViewport(boundedViewport)
      return published
    } catch (error) {
      this.failAttachment(active, { kind: 'attachment-error', error })
      if (!this.disposed && this.active === null) return super.setViewport(boundedViewport)
      return this.viewport
    }
  }

  private publishAttachedFrame(active: ActiveAttachment): SceneViewportState {
    if (!this.isCurrent(active)) return this.viewport

    try {
      const map = active.attachment.map
      const transform = deriveSharedMapSceneViewport({
        project: ({ lng, lat }) => map.project([lng, lat]),
        anchor: active.attachment.readOrigin(),
        pitchDeg: map.getPitch(),
        maximumWorldExtentMeters: active.attachment.maximumWorldExtentMeters,
      })
      if (!transform.accepted) {
        this.failAttachment(active, { kind: 'invalid-projection', reason: transform.reason })
        return this.viewport
      }

      const metrics = this.mapScreenMetrics(map)
      const zoom = map.getZoom()
      const scaleBounds = this.attachedScaleBounds(active, metrics, transform.viewport.scale, zoom)
      const center = map.getCenter()
      const groundMetersPerCssPixel = Number.isFinite(zoom) && Number.isFinite(center.lat)
        ? 1 / mapZoomToStageScale(zoom, center.lat)
        : null
      const frame: CameraViewportPublication = {
        viewport: transform.viewport,
        screenSize: { width: metrics.width, height: metrics.height },
        devicePixelRatio: metrics.devicePixelRatio ?? 1,
        referenceScale: this.snapshot.peek().referenceScale,
        scaleBounds,
        overviewScaleThreshold: this.policy.overviewScaleThreshold,
        groundMetersPerCssPixel: Number.isFinite(groundMetersPerCssPixel)
          && groundMetersPerCssPixel! > 0
          ? groundMetersPerCssPixel
          : null,
      }
      this.publishFrame(frame)
      active.lastValidFrame = this.snapshot.peek()
      return this.viewport
    } catch (error) {
      this.failAttachment(active, { kind: 'attachment-error', error })
      return this.viewport
    }
  }

  private mapScreenMetrics(map: MapLibreWorkspaceCameraMap): CameraScreenMetrics {
    const canvas = map.getCanvas()
    const fallback = this.snapshot.peek()
    const width = finitePositive(canvas.clientWidth) ?? fallback.screenSize.width
    const height = finitePositive(canvas.clientHeight) ?? fallback.screenSize.height
    const dprFromWidth = width > 0 ? canvas.width / width : Number.NaN
    const dprFromHeight = height > 0 ? canvas.height / height : Number.NaN
    const devicePixelRatio = finitePositive(dprFromWidth)
      ?? finitePositive(dprFromHeight)
      ?? fallback.devicePixelRatio
    return { width, height, devicePixelRatio }
  }

  private attachedScaleBounds(
    active: ActiveAttachment,
    metrics = this.mapScreenMetrics(active.attachment.map),
    actualScale?: number,
    actualZoom = active.attachment.map.getZoom(),
  ): WorkspaceCameraScaleBounds {
    const map = active.attachment.map
    const configuredMinimum = finiteNumber(map.getMinZoom()) ?? this.policy.minimumMapZoom
    const configuredMaximum = finiteNumber(map.getMaxZoom()) ?? this.policy.maximumMapZoom
    const effectiveMinimum = singleWorldEffectiveMinimumZoom(
      metrics.width,
      metrics.height,
      configuredMinimum,
    )
    const resolvedMinimum = active.resolvedMinimumZoom === null
      ? effectiveMinimum
      : Math.max(effectiveMinimum, active.resolvedMinimumZoom)
    const calculated = cameraScaleBoundsForPolicy(
      this.policy,
      resolvedMinimum,
      configuredMaximum,
    )
    if (!Number.isFinite(actualScale) || !Number.isFinite(actualZoom)) return calculated
    return Object.freeze({
      minimum: Math.abs(actualZoom - resolvedMinimum) < 1e-9
        ? actualScale!
        : calculated.minimum,
      maximum: Math.abs(actualZoom - configuredMaximum) < 1e-9
        ? actualScale!
        : calculated.maximum,
    })
  }

  private recordResolvedMinimum(
    active: ActiveAttachment,
    beforeZoom: number,
    requestedZoom: number,
  ): void {
    const actualZoom = active.attachment.map.getZoom()
    if (
      requestedZoom < beforeZoom
      && Number.isFinite(actualZoom)
      && actualZoom > requestedZoom + 1e-9
    ) active.resolvedMinimumZoom = actualZoom
  }

  private boundAttachedViewport(
    _map: MapLibreWorkspaceCameraMap,
    viewport: SceneViewportState,
  ): SceneViewportState {
    if (![viewport.x, viewport.y, viewport.scale].every(Number.isFinite)) return this.viewport
    return {
      x: viewport.x,
      y: viewport.y,
      scale: clampCameraScale(viewport.scale, this.snapshot.peek().scaleBounds),
    }
  }

  private failAttachment(
    active: ActiveAttachment,
    failure: MapLibreWorkspaceCameraFailure,
  ): void {
    if (!this.isCurrent(active)) return
    try {
      this.deactivate(active)
    } catch {
      // Failure observers still own the map-unavailable transition even when
      // MapLibre listener cleanup itself fails. Explicit detach retains that error.
    }
    if (active.failureReported) return
    active.failureReported = true
    this.notifyFailureObservers(failure)
  }

  private deactivate(active: ActiveAttachment): void {
    // Fence events before restoring the last valid frame. MapLibre can emit while
    // listeners are being removed, so both cleanup order and generation matter.
    if (this.active === active) this.active = null
    this.generation += 1
    const errors: unknown[] = []
    try {
      this.removeListeners(active)
    } catch (error) {
      errors.push(error)
    }
    try {
      this.publishFrame({
        ...active.lastValidFrame,
        groundMetersPerCssPixel: null,
      })
    } catch (error) {
      errors.push(error)
    }
    throwCameraCleanupErrors(errors)
  }

  private removeListeners(active: ActiveAttachment): void {
    const { map } = active.attachment
    const errors: unknown[] = []
    try {
      map.off('move', active.moveListener)
    } catch (error) {
      errors.push(error)
    }
    try {
      map.off('resize', active.resizeListener)
    } catch (error) {
      errors.push(error)
    }
    throwCameraCleanupErrors(errors)
  }

  private notifyFailureObservers(failure: MapLibreWorkspaceCameraFailure): void {
    const observers = [this.options.onAttachmentFailure, ...this.failureObservers]
    for (const observer of observers) {
      if (!observer) continue
      try {
        observer(failure)
      } catch (observerError) {
        console.error('MapLibre workspace camera failure observer failed:', observerError)
      }
    }
  }

  private isCurrent(active: ActiveAttachment): boolean {
    return !this.disposed && this.active === active && this.generation === active.generation
  }
}

function finitePositive(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null
}

function finiteNumber(value: number): number | null {
  return Number.isFinite(value) ? value : null
}

function sameViewport(left: Readonly<SceneViewportState>, right: Readonly<SceneViewportState>): boolean {
  return left.x === right.x && left.y === right.y && left.scale === right.scale
}

function throwCameraCleanupErrors(errors: readonly unknown[]): void {
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new MapLibreWorkspaceCameraCleanupError(errors)
}

class MapLibreWorkspaceCameraCleanupError extends Error {
  constructor(readonly errors: readonly unknown[]) {
    super('MapLibre workspace camera cleanup failed.')
  }
}
