import {
  CameraController,
  createInitialCameraFrame,
  type CameraScreenMetrics,
  type CameraViewportPublication,
  type WorkspaceCameraOwner,
} from '../canvas/runtime/camera'
import type { SceneViewportState } from '../canvas/runtime/scene'
import { createMapFrame } from '../canvas/maplibre-camera'
import { deriveSharedMapSceneViewport } from './scene-camera-transform'
import type { MapLibreMapInstance } from './loader'

export interface MapLibreWorkspaceCameraAttachment {
  /** One already-created map; map mounting remains owned by the workspace lifecycle. */
  readonly map: MapLibreWorkspaceCameraMap
  /** Local-world origin in geographic coordinates. */
  readonly anchor: { readonly lat: number; readonly lon: number }
  readonly northBearingDeg: number
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
  | 'getCanvas'
>>

export type MapLibreWorkspaceCameraFailure =
  | { readonly kind: 'invalid-projection'; readonly reason: string }
  | { readonly kind: 'attachment-error'; readonly error: unknown }

export interface MapLibreWorkspaceCameraOwnerOptions {
  /** Called once for each attached map that cannot provide a valid shared frame. */
  readonly onAttachmentFailure?: (failure: MapLibreWorkspaceCameraFailure) => void
}

/**
 * The future workspace lifecycle receives only this narrow map-lifetime control.
 * It never owns or replaces the camera's stable frame signal.
 */
export interface WorkspaceCameraAttachmentControl {
  attach(attachment: MapLibreWorkspaceCameraAttachment): void
  detach(): void
}

interface ActiveAttachment {
  readonly attachment: MapLibreWorkspaceCameraAttachment
  readonly generation: number
  readonly moveListener: () => void
  readonly resizeListener: () => void
  lastValidFrame: CameraViewportPublication
  failureReported: boolean
}

/**
 * A renderer-neutral owner that begins as Canvas2D and transfers ownership to
 * one attached MapLibre map. Extending CameraController keeps frame identity,
 * no-op semantics, and fallback navigation in one place.
 */
export class MapLibreWorkspaceCameraOwner extends CameraController
  implements WorkspaceCameraOwner {
  private active: ActiveAttachment | null = null
  private generation = 0
  private disposed = false

  readonly attachment: WorkspaceCameraAttachmentControl = {
    attach: (next) => this.attach(next),
    detach: () => this.detach(),
  }

  constructor(private readonly options: MapLibreWorkspaceCameraOwnerOptions = {}) {
    super()
  }

  attach(attachment: MapLibreWorkspaceCameraAttachment): void {
    if (this.disposed) return
    this.detach()

    const generation = ++this.generation
    const active: ActiveAttachment = {
      attachment,
      generation,
      moveListener: () => this.publishAttachedFrame(active),
      resizeListener: () => this.publishAttachedFrame(active),
      lastValidFrame: this.snapshot.peek(),
      failureReported: false,
    }

    try {
      this.active = active
      const current = this.snapshot.peek()
      const initialFrame = createMapFrame(
        current.viewport,
        this.mapScreenMetrics(attachment.map),
        attachment.anchor,
        attachment.northBearingDeg,
      )
      if (!initialFrame) throw new Error('Cannot attach a map camera without a finite viewport and screen size.')

      attachment.map.on('move', active.moveListener)
      attachment.map.on('resize', active.resizeListener)
      attachment.map.jumpTo({
        center: [initialFrame.center[0], initialFrame.center[1]],
        zoom: initialFrame.zoom,
        bearing: initialFrame.bearing,
      })
      this.publishAttachedFrame(active)
    } catch (error) {
      this.failAttachment(active, { kind: 'attachment-error', error })
    }
  }

  detach(): void {
    const active = this.active
    if (!active) return
    this.deactivate(active)
  }

  override initialize(screen: CameraScreenMetrics): SceneViewportState {
    this.clearTemporaryFocus()
    const active = this.active
    if (!active) return super.initialize(screen)
    return this.jumpAttachedMap(
      active,
      createInitialCameraFrame(this.mapScreenMetrics(active.attachment.map)).viewport,
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
    try {
      const frame = createMapFrame(
        viewport,
        this.mapScreenMetrics(active.attachment.map),
        active.attachment.anchor,
        active.attachment.northBearingDeg,
      )
      if (!frame) throw new Error('Cannot navigate MapLibre without a finite CSS-pixel frame.')
      active.attachment.map.jumpTo({
        center: [frame.center[0], frame.center[1]],
        zoom: frame.zoom,
        bearing: frame.bearing,
      })
      const published = this.publishAttachedFrame(active)
      if (!this.disposed && this.active === null) return super.setViewport(viewport)
      return published
    } catch (error) {
      this.failAttachment(active, { kind: 'attachment-error', error })
      if (!this.disposed && this.active === null) return super.setViewport(viewport)
      return this.viewport
    }
  }

  private publishAttachedFrame(active: ActiveAttachment): SceneViewportState {
    if (!this.isCurrent(active)) return this.viewport

    try {
      const map = active.attachment.map
      const transform = deriveSharedMapSceneViewport({
        project: ({ lng, lat }) => map.project([lng, lat]),
        anchor: active.attachment.anchor,
        northBearingDeg: active.attachment.northBearingDeg,
        pitchDeg: map.getPitch(),
        maximumWorldExtentMeters: active.attachment.maximumWorldExtentMeters,
      })
      if (!transform.accepted) {
        this.failAttachment(active, { kind: 'invalid-projection', reason: transform.reason })
        return this.viewport
      }

      const metrics = this.mapScreenMetrics(map)
      const frame: CameraViewportPublication = {
        viewport: transform.viewport,
        screenSize: { width: metrics.width, height: metrics.height },
        devicePixelRatio: metrics.devicePixelRatio ?? 1,
        referenceScale: this.snapshot.peek().referenceScale,
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

  private failAttachment(
    active: ActiveAttachment,
    failure: MapLibreWorkspaceCameraFailure,
  ): void {
    if (!this.isCurrent(active)) return
    this.deactivate(active)
    if (active.failureReported) return
    active.failureReported = true
    try {
      this.options.onAttachmentFailure?.(failure)
    } catch (observerError) {
      console.error('MapLibre workspace camera failure observer failed:', observerError)
    }
  }

  private deactivate(active: ActiveAttachment): void {
    // Fence events before restoring the fallback frame. MapLibre can emit while
    // listeners are being removed, so both cleanup order and generation matter.
    if (this.active === active) this.active = null
    this.generation += 1
    this.removeListeners(active)
    this.publishFrame(active.lastValidFrame)
  }

  private removeListeners(active: ActiveAttachment): void {
    const { map } = active.attachment
    try {
      map.off('move', active.moveListener)
    } finally {
      map.off('resize', active.resizeListener)
    }
  }

  private isCurrent(active: ActiveAttachment): boolean {
    return !this.disposed && this.active === active && this.generation === active.generation
  }
}

function finitePositive(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null
}
