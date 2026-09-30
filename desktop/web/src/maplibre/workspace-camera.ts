// maplibre/workspace-camera.ts  (0A to the end of 0D2)
//
// Owns today's MapLibre workspace camera surface over the view (plan §4 0A "Legacy surface", spec §1.1b): the
// MapLibreWorkspaceCameraOwner shim, with today's options, attachment control and failure reports. It extends the facade's
// CameraController shim and hands its driver host one map at a time as a maplibre/camera-driver.ts driver, which is the map's
// only camera owner: this shim calls no map method.

import { logMapError } from './redact-credentials'
import { createMapLibreCameraDriver } from './camera-driver'
import type { MapLibreMapInstance } from './loader'
import { CameraController } from '../canvas/runtime/legacy-camera-facade'
import type { CameraDriverFailure } from '../canvas/runtime/view/camera-driver'
import { createSessionPlane } from '../canvas/session-plane'
import { createWorkspaceCameraPolicy, type WorkspaceCameraPolicy } from '../canvas/workspace-camera-policy'

interface MapLibreWorkspaceCameraAttachment {
  /** One already-created map; map mounting remains owned by the workspace lifecycle. */
  readonly map: MapLibreWorkspaceCameraMap
  /** Live session plane origin; read on attach and on each origin refresh. */
  readonly readOrigin: () => { readonly lat: number; readonly lon: number }
  /** The shared scene layer's world limit, passed with the map; the driver builds frames from the camera and needs none. */
  readonly maximumWorldExtentMeters?: number
}

/** The map operations the camera driver needs: the camera read-backs describe one camera (spec §1.1 driver rules). */
export type MapLibreWorkspaceCameraMap = Required<Pick<MapLibreMapInstance,
  | 'jumpTo'
  | 'resize'
  | 'on'
  | 'off'
  | 'getCenter'
  | 'getZoom'
  | 'getBearing'
  | 'getPitch'
  | 'unproject'
  | 'getCanvas'
>> & Pick<MapLibreMapInstance, 'flyTo' | 'stop' | 'setTransformConstrain'>

export type MapLibreWorkspaceCameraFailure =
  | { readonly kind: 'invalid-projection'; readonly reason: string }
  | { readonly kind: 'attachment-error'; readonly error: unknown }

interface MapLibreWorkspaceCameraOwnerOptions {
  /** Called once for each attached map that cannot provide a valid shared frame. */
  readonly onAttachmentFailure?: (failure: MapLibreWorkspaceCameraFailure) => void
  readonly policy?: WorkspaceCameraPolicy
}

/**
 * The workspace lifecycle receives only this narrow map-lifetime control.
 * It never owns or replaces the camera's stable frame signal.
 */
interface WorkspaceCameraAttachmentControl {
  attach(attachment: MapLibreWorkspaceCameraAttachment): boolean
  detach(): void
  /** Re-expresses the frame in the session plane after its origin changed; the map stays put. */
  refreshOrigin(): void
  /** Workspace owners may observe failures without taking over camera ownership. */
  subscribeFailure(observer: (failure: MapLibreWorkspaceCameraFailure) => void): () => void
}

interface ActiveAttachment {
  readonly attachment: MapLibreWorkspaceCameraAttachment
  failureReported: boolean
}

/**
 * The workspace camera: the facade's headless camera while detached, and one attached MapLibre map's camera, through its driver,
 * once admitted. A driver failure (a pitched camera, a map call that throws) detaches the host and is reported once per attachment.
 */
export class MapLibreWorkspaceCameraOwner extends CameraController {
  private active: ActiveAttachment | null = null
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
    this.host.failure.subscribe((failure) => {
      if (failure) this.reportDriverFailure(failure)
    })
  }

  /**
   * Today's attach: the current placement, on the map's screen, in the plane of the attachment's origin. The host hands the new
   * driver the last camera, which this shim's own plane expressed, so the placement follows as an exact 'place' move.
   */
  attach(attachment: MapLibreWorkspaceCameraAttachment): boolean {
    if (this.disposed) return false
    this.detach()
    this.syncPolicyToOrigin(attachment.readOrigin())

    const active: ActiveAttachment = { attachment, failureReported: false }
    this.active = active
    try {
      this.withOneSnapshot(() => {
        const placement = this.planar()
        this.plane = createSessionPlane(attachment.readOrigin())
        const driver = createMapLibreCameraDriver(attachment.map, this.plane, this.host.driverDeps)
        this.host.attach(driver)
        if (this.host.current() === driver) driver.apply({ kind: 'place', planar: placement })
      })
    } catch (error) {
      this.failAttachment(active, { kind: 'attachment-error', error })
      return false
    }
    return this.active === active
  }

  /** Hands the camera back to a headless driver at the last frame; release errors of the map surface after the hand-back. */
  detach(): void {
    if (!this.active) return
    this.active = null
    this.host.detach()
  }

  /**
   * Re-expresses the attached map's frame in the session plane after its origin changed; the map stays put. An attachment made
   * through this shim reads its own origin; one the workspace made on the host (0A-2) follows the Scene's plane.
   */
  refreshOrigin(): void {
    const active = this.active
    const scenePlane = this.followedScenePlane
    if (!active && !(scenePlane && this.frameNow().attached)) return
    this.withOneSnapshot(() => {
      const origin = active ? active.attachment.readOrigin() : scenePlane!.origin
      // A re-origin keeps the temporary focus; reprojectViewport moves it into
      // the new plane. A Document load clears it through its own surface.
      this.syncPolicyToOrigin(origin, { keepTemporaryFocus: true })
      if (!active) {
        this.driver().planeChanged(scenePlane!)
        return
      }
      if (this.plane.origin.lat === origin.lat && this.plane.origin.lon === origin.lon) return
      this.plane = createSessionPlane(origin)
      this.driver().planeChanged(this.plane)
    })
  }

  override dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearTemporaryFocus()
    this.detach()
  }

  /**
   * Today's owner replayed a move whose map call failed on the camera it fell back to; so does this shim, whichever side attached
   * the map.
   */
  protected override command<T>(run: () => T): T {
    const attached = this.frameNow().attached
    const failureBefore = this.host.failure.peek()
    const result = run()
    const failure = this.host.failure.peek()
    if (!attached || this.disposed || !failure || failure === failureBefore || this.frameNow().attached) return result
    return run()
  }

  private syncPolicyToOrigin(
    origin: { readonly lat: number },
    options: { readonly keepTemporaryFocus?: boolean } = {},
  ): void {
    if (this.policy.referenceLatitudeDeg === origin.lat) return
    const policy = createWorkspaceCameraPolicy(origin.lat)
    if (options.keepTemporaryFocus) this.applyPolicy(policy)
    else this.replacePolicy(policy)
  }

  private subscribeFailure(
    observer: (failure: MapLibreWorkspaceCameraFailure) => void,
  ): () => void {
    if (this.disposed) return () => {}
    this.failureObservers.add(observer)
    return () => this.failureObservers.delete(observer)
  }

  /** The host has already detached; the attachment it belonged to reports it once. */
  private reportDriverFailure(failure: CameraDriverFailure): void {
    const active = this.active
    if (!active) return
    this.failAttachment(active, { kind: 'attachment-error', error: new Error(failure.message) })
  }

  private failAttachment(active: ActiveAttachment, failure: MapLibreWorkspaceCameraFailure): void {
    if (this.active === active) {
      this.active = null
      try {
        this.host.detach()
      } catch {
        // Failure observers still own the map-unavailable transition even when
        // MapLibre listener cleanup itself fails. Explicit detach retains that error.
      }
    }
    if (active.failureReported) return
    active.failureReported = true
    this.notifyFailureObservers(failure)
  }

  private notifyFailureObservers(failure: MapLibreWorkspaceCameraFailure): void {
    const observers = [this.options.onAttachmentFailure, ...this.failureObservers]
    for (const observer of observers) {
      if (!observer) continue
      try {
        observer(failure)
      } catch (observerError) {
        logMapError('MapLibre workspace camera failure observer failed:', observerError)
      }
    }
  }
}
