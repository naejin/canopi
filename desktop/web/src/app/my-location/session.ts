// The location session (canopi-f47t.53; U54 Q13, Q16, Q17; design check A3, A4): the one owner of Show my location's
// watch, its follow mode and the device reading. Only the button and the Web wiring import it (plan P52). The reading
// (dot, accuracy, time) is the user's whereabouts: it goes from here to the map's dot and nowhere else, never into a
// Design, Draft, export, snapshot, log or diagnostics. A camera saved while following is a view the user chose, saved
// like any other (Q10).
//
// Location runs only while a Design is open, as its button does: closing the Design turns it off.
//
// Modes: Off; Following (each fix centres the camera; a click turns location off); Moved away (any other camera move, a
// Design activation or a story presentation ended follow; fixes still move the dot, and a click re-centres and follows);
// Blocked (code 1 with the permission denied: the button is disabled until the permission changes). Codes 2 and 3 keep
// the watch and the mode: the last reading turns stale and location reads unavailable until the next fix. Every other
// code 1 answer (a dismissed prompt, the OS location off, no Permissions API) goes back to Off (GeoLibre's rule, A4).

import { computed, effect, signal, type ReadonlySignal } from '@preact/signals'
import { currentCanvasQuerySurface, currentCanvasViewportCommandSurface } from '../../canvas/session'
import type { UserLocationReading } from '../../maplibre/user-location-overlay'
import { designSessionStore } from '../document-session/store'
import { storyPresentationHidesEditingAids } from '../story-presentation/overrides'
import { startCameraFollow, type CameraFollow, type FollowView } from './follow'
import { queryGeolocationPermission, watchDevicePosition, type DeviceFix, type GeolocationErrorCode } from './geolocation'

export type MyLocationMode = 'off' | 'following' | 'moved-away' | 'blocked'

interface MyLocationSessionOptions {
  /** The current canvas's view, for follow. */
  readonly view: ReadonlySignal<FollowView | null>
  /** Changes when another Design becomes current: follow ends, location goes on (Q17). */
  readonly designIdentity: ReadonlySignal<unknown>
  /** Whether a Design is open: closing it turns location off, since the button goes with it. */
  readonly designOpen: ReadonlySignal<boolean>
  /** True while a story is presented: follow ends (Q12). */
  readonly presenting: ReadonlySignal<boolean>
}

export class MyLocationSession {
  private readonly currentMode = signal<MyLocationMode>('off')
  private readonly currentReading = signal<UserLocationReading | null>(null)
  private readonly currentUnavailable = signal(false)
  readonly mode: ReadonlySignal<MyLocationMode> = computed(() => this.currentMode.value)
  /** The latest fix while location is on; stale while the browser reports it unavailable. */
  readonly reading: ReadonlySignal<UserLocationReading | null> = computed(() => this.currentReading.value)
  /** The browser reported the position unavailable or timed out since the last fix (codes 2, 3). */
  readonly unavailable: ReadonlySignal<boolean> = computed(() => this.currentUnavailable.value)
  /** Each start and stop: a watch callback or a permission answer from an earlier one is ignored. */
  private generation = 0
  private stopWatch: (() => void) | null = null
  private follow: CameraFollow | null = null
  /** The next fix re-centres (the click's jump, at max(zoom, 17)). */
  private recentrePending = false
  private leaveBlocked: (() => void) | null = null
  private leaveDesign: (() => void) | null = null

  constructor(private readonly options: MyLocationSessionOptions) {}

  /** The button's click. */
  press(): void {
    switch (this.currentMode.peek()) {
      case 'off': this.start(); break
      case 'following': this.stop(); break
      case 'moved-away': this.resume(); break
      case 'blocked': break
    }
  }

  private start(): void {
    this.stop()
    const generation = this.generation
    this.currentMode.value = 'following'
    this.recentrePending = true
    this.beginFollow()
    // The press came from the button, which shows only with a Design open, so only a later close counts.
    let opened = true
    this.leaveDesign = effect(() => {
      const open = this.options.designOpen.value
      if (opened) opened = false
      else if (!open) this.stop()
    })
    const stop = watchDevicePosition(
      (fix) => { if (generation === this.generation) this.onFix(fix) },
      (code) => { if (generation === this.generation) this.onError(code) },
    )
    // A synchronous code 1 may already have stopped this start.
    if (generation === this.generation) this.stopWatch = stop
    else stop()
  }

  private resume(): void {
    this.currentMode.value = 'following'
    this.beginFollow()
    const reading = this.currentReading.peek()
    this.recentrePending = reading === null
    if (reading) this.follow?.follow({ lon: reading.lon, lat: reading.lat }, true)
  }

  /** Turns location off: no watch, no reading, no follow. */
  private stop(): void {
    this.generation += 1
    this.stopWatch?.()
    this.stopWatch = null
    this.follow?.dispose()
    this.follow = null
    this.leaveBlocked?.()
    this.leaveBlocked = null
    this.leaveDesign?.()
    this.leaveDesign = null
    this.recentrePending = false
    this.currentReading.value = null
    this.currentUnavailable.value = false
    this.currentMode.value = 'off'
  }

  private beginFollow(): void {
    this.follow?.dispose()
    this.follow = null
    let ended = false
    const follow = startCameraFollow({
      ...this.options,
      onEnd: () => {
        ended = true
        this.follow = null
        if (this.currentMode.peek() === 'following') this.currentMode.value = 'moved-away'
      },
    })
    if (!ended) this.follow = follow
  }

  private onFix(fix: DeviceFix): void {
    this.currentReading.value = { ...fix, stale: false }
    this.currentUnavailable.value = false
    if (this.currentMode.peek() !== 'following' || !this.follow) return
    const recentre = this.recentrePending
    this.recentrePending = false
    this.follow.follow({ lon: fix.lon, lat: fix.lat }, recentre)
  }

  private onError(code: GeolocationErrorCode): void {
    if (code !== 1) {
      // Position unavailable or timed out: keep watching; the last reading turns stale (Q16).
      this.currentUnavailable.value = true
      const reading = this.currentReading.peek()
      if (reading && !reading.stale) this.currentReading.value = { ...reading, stale: true }
      return
    }
    this.stop()
    const generation = this.generation
    void queryGeolocationPermission().then((status) => {
      if (generation !== this.generation || status?.state !== 'denied') return
      this.block(status)
    })
  }

  /** Blocked until the permission changes, when location goes back to Off (A4). */
  private block(status: PermissionStatus): void {
    this.currentMode.value = 'blocked'
    const generation = this.generation
    const changed = () => {
      if (status.state === 'denied') return
      this.leaveBlocked?.()
      this.leaveBlocked = null
      if (generation === this.generation && this.currentMode.peek() === 'blocked') this.currentMode.value = 'off'
    }
    status.addEventListener('change', changed)
    this.leaveBlocked = () => status.removeEventListener('change', changed)
  }
}

/** The current canvas's view, as follow reads and moves it. */
const currentFollowView = computed<FollowView | null>(() => {
  const queries = currentCanvasQuerySurface.value
  const commands = currentCanvasViewportCommandSurface.value
  if (!queries || !commands) return null
  return {
    settledCamera: queries.view.settledCamera,
    captureCamera: () => queries.view.captureView().camera,
    showPlace: (place, zoom, options) => commands.showPlace(place, zoom, options),
    showCamera: (camera, options) => commands.showCamera(camera, options),
  }
})

/** The app's one location session. */
export const myLocation = new MyLocationSession({
  view: currentFollowView,
  designIdentity: designSessionStore.sessionIdentity,
  designOpen: computed(() => designSessionStore.currentDesign.value !== null),
  // The presentation hides the map's editing aids for its whole run; it ends follow and hides the dot.
  presenting: storyPresentationHidesEditingAids,
})
