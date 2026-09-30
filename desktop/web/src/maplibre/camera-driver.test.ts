import { signal } from '@preact/signals'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { geoToMercator, mercatorToGeo } from '../canvas/projection'
import type { CameraDriver } from '../canvas/runtime/view/camera-driver'
import { createNavigationPolicy, zoomFloorForArc } from '../canvas/runtime/view/navigation-policy'
import type { GeoPoint, ViewFrame, ViewScreen } from '../canvas/runtime/view/types'
import { createSessionPlane } from '../canvas/session-plane'
import { createWorkspaceCameraPolicy } from '../canvas/workspace-camera-policy'
import { createMapLibreCameraDriver } from './camera-driver'
import type { MapLibreLngLat, MapLibreTransformConstrain } from './loader'

const PLANE = createSessionPlane({ lon: 2.35, lat: 48.85 })
const POLICY = createNavigationPolicy(createWorkspaceCameraPolicy(PLANE.origin.lat), signal(false))

/** MapLibre's LngLat class: the constrain must hand back the class it was given. */
class FakeLngLat implements MapLibreLngLat {
  constructor(readonly lng: number, readonly lat: number) {}
}

interface FakeCamera { center: FakeLngLat; zoom: number; bearing: number; pitch: number }

type Listener = (event?: unknown) => void

/**
 * A consistent MapLibre fake (plan §4, 0A "Attached-map fakes"): getCenter, getZoom, getBearing and unproject describe one camera
 * in Web Mercator at 512-px tiles; jumpTo sets zoom, then centre (each through the installed constrain, as MapLibre does), then the
 * bearing wrapped to (−180, 180], and fires 'move' synchronously; flights run only when the test steps them.
 */
class ConsistentMap {
  readonly listeners = new Map<string, Set<Listener>>()
  /** The container: resize() adopts it, as MapLibre reads its container. */
  container: { width: number; height: number }
  size: { width: number; height: number }
  readonly pixelRatio = 2
  camera: FakeCamera
  constrain: MapLibreTransformConstrain | null = null
  flight: { center: [number, number]; zoom: number; bearing: number } | null = null
  readonly canvas: HTMLCanvasElement

  readonly jumpTo = vi.fn((options: { center: [number, number]; zoom: number; bearing: number; pitch?: number }) => {
    this.stop()
    this.setCameraAsMapLibre(options)
    this.fire('movestart')
    this.fire('move')
    this.fire('moveend')
  })

  readonly flyTo = vi.fn((options: { center: [number, number]; zoom: number; bearing: number }) => {
    this.stop()
    this.flight = options
    this.fire('movestart')
  })

  readonly stop = vi.fn(() => {
    if (!this.flight) return
    this.flight = null
    this.fire('moveend')
  })

  readonly resize = vi.fn(() => {
    this.size = { ...this.container }
    this.applyConstrain()
    this.fire('movestart')
    this.fire('move')
    this.fire('resize')
    this.fire('moveend')
  })

  readonly setTransformConstrain = vi.fn((constrain: MapLibreTransformConstrain | null) => {
    this.constrain = constrain
    this.applyConstrain()
  })

  readonly on = vi.fn((type: string, listener: Listener) => {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  })

  readonly off = vi.fn((type: string, listener: Listener) => {
    this.listeners.get(type)?.delete(listener)
  })

  constructor(camera: { center: GeoPoint; zoom: number; bearing?: number; pitch?: number }, size = { width: 400, height: 300 }) {
    this.camera = {
      center: new FakeLngLat(camera.center.lon, camera.center.lat),
      zoom: camera.zoom,
      bearing: wrapBearing(camera.bearing ?? 0),
      pitch: camera.pitch ?? 0,
    }
    this.container = { ...size }
    this.size = { ...size }
    this.canvas = document.createElement('canvas')
    Object.defineProperties(this.canvas, {
      clientWidth: { get: () => this.size.width },
      clientHeight: { get: () => this.size.height },
      width: { get: () => this.size.width * this.pixelRatio },
      height: { get: () => this.size.height * this.pixelRatio },
    })
  }

  getCenter(): FakeLngLat { return new FakeLngLat(this.camera.center.lng, this.camera.center.lat) }
  getZoom(): number { return this.camera.zoom }
  getBearing(): number { return this.camera.bearing }
  getPitch(): number { return this.camera.pitch }
  getCanvas(): HTMLCanvasElement { return this.canvas }

  unproject([x, y]: [number, number]): FakeLngLat {
    const worldSize = 512 * 2 ** this.camera.zoom
    const centre = geoToMercator(this.camera.center.lng, this.camera.center.lat)
    const radians = this.camera.bearing * Math.PI / 180
    const dx = x - this.size.width / 2
    const dy = y - this.size.height / 2
    const ground = mercatorToGeo(
      centre.x + (Math.cos(radians) * dx - Math.sin(radians) * dy) / worldSize,
      centre.y + (Math.sin(radians) * dx + Math.cos(radians) * dy) / worldSize,
    )
    return new FakeLngLat(ground.lng, ground.lat)
  }

  /** One animation frame of a running flight: MapLibre moves its camera (through the constrain) and fires 'move'. */
  flightFrame(camera: { center: GeoPoint; zoom: number; bearing: number }): void {
    if (!this.flight) throw new Error('No flight is running.')
    this.setCameraAsMapLibre({ center: [camera.center.lon, camera.center.lat], zoom: camera.zoom, bearing: camera.bearing })
    this.fire('move')
  }

  endFlight(): void {
    const flight = this.flight
    if (!flight) throw new Error('No flight is running.')
    this.setCameraAsMapLibre(flight)
    this.fire('move')
    this.flight = null
    this.fire('moveend')
  }

  fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener()
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0)
  }

  private setCameraAsMapLibre(options: { center: [number, number]; zoom: number; bearing: number; pitch?: number }): void {
    if (options.zoom !== this.camera.zoom) {
      this.camera.zoom = options.zoom
      this.applyConstrain()
    }
    this.camera.center = new FakeLngLat(options.center[0], options.center[1])
    this.applyConstrain()
    this.camera.bearing = wrapBearing(options.bearing)
    if (options.pitch !== undefined) this.camera.pitch = options.pitch
  }

  private applyConstrain(): void {
    if (!this.constrain) return
    const { center, zoom } = this.constrain(this.camera.center, this.camera.zoom)
    this.camera.center = center as FakeLngLat
    this.camera.zoom = zoom
  }
}

/** MapLibre's wrap(bearing, −180, 180). */
function wrapBearing(bearing: number): number {
  const wrapped = ((bearing + 180) % 360 + 360) % 360 - 180
  return wrapped === -180 ? 180 : wrapped
}

function createManualFrames() {
  let now = 0
  let nextId = 1
  let frames = new Map<number, (nowMs: number) => void>()
  return {
    clock: () => now,
    scheduleFrame(callback: (nowMs: number) => void): () => void {
      const id = nextId++
      frames.set(id, callback)
      return () => { frames.delete(id) }
    },
    advance(ms: number): void {
      now += ms
      const due = frames
      frames = new Map()
      for (const callback of due.values()) callback(now)
    },
  }
}

const drivers: CameraDriver[] = []

function attach(map: ConsistentMap, policy = POLICY) {
  const time = createManualFrames()
  const driver = createMapLibreCameraDriver(map, PLANE, {
    clock: time.clock,
    scheduleFrame: time.scheduleFrame,
    policy: () => policy,
  }, { timers: { set: () => 0, clear: () => {} } })
  drivers.push(driver)
  const published: ViewFrame[] = []
  driver.frames.onViewFrame('overlays', (frame) => published.push(frame))
  return { driver, published, time }
}

function screenOf(frame: ViewFrame): ViewScreen {
  return frame.view.screen
}

afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose()
})

describe('MapLibre camera driver', () => {
  it('sends explicit jumpTo values', () => {
    const map = new ConsistentMap({ center: PLANE.origin, zoom: 18 })
    const { driver, published } = attach(map)

    driver.apply({ kind: 'zoom-around', anchorPx: { x: 100, y: 80 }, factor: 2 })
    driver.apply({ kind: 'rotate-around', anchorPx: { x: 300, y: 200 }, bearingDeg: 300, animation: 'none' })
    driver.apply({ kind: 'pan-by', deltaPx: { x: -7, y: 12 } })
    driver.apply({ kind: 'set', target: { center: { lon: 2.36, lat: 48.86 }, zoom: 17.5, bearingDeg: 15, pitchDeg: 0 }, animation: 'none' })

    expect(map.jumpTo).toHaveBeenCalledTimes(4)
    for (const [options] of map.jumpTo.mock.calls) {
      // Every value explicit: centre, zoom, bearing and a zero pitch, never a partial camera for MapLibre to complete.
      expect(Object.keys(options).sort()).toEqual(['bearing', 'center', 'pitch', 'zoom'])
      expect(options.pitch).toBe(0)
      expect([...options.center, options.zoom, options.bearing].every(Number.isFinite)).toBe(true)
    }
    expect(map.jumpTo.mock.calls[0]![0].zoom).toBe(19)
    expect(map.jumpTo.mock.calls[1]![0].bearing).toBe(300)
    expect(map.jumpTo.mock.calls[3]![0]).toEqual({ center: [2.36, 48.86], zoom: 17.5, bearing: 15, pitch: 0 })
    // One frame per jumpTo, built from the read-backs, the bearing normalised from MapLibre's (−180, 180] to [0, 360).
    expect(published).toHaveLength(4)
    expect(map.getBearing()).toBe(15)
    expect(published[1]!.view.camera.bearingDeg).toBe(300)
    expect(published[3]!.view.camera).toEqual({ center: { lon: 2.36, lat: 48.86 }, zoom: 17.5, bearingDeg: 15, pitchDeg: 0 })
    expect(published.map((frame) => frame.revision)).toEqual([1, 2, 3, 4])
  })

  it('a pan of +10 px moves the ground 10 px right', () => {
    for (const bearing of [0, 30]) {
      const map = new ConsistentMap({ center: { lon: 2.351, lat: 48.852 }, zoom: 19.3, bearing })
      const { driver, published } = attach(map)
      const ground = map.unproject([120, 90])

      driver.apply({ kind: 'pan-by', deltaPx: { x: 10, y: 0 } })

      // MapLibre's own projection: the ground that was under (120, 90) is now under (130, 90).
      const moved = map.unproject([130, 90])
      expect(moved.lng).toBeCloseTo(ground.lng, 10)
      expect(moved.lat).toBeCloseTo(ground.lat, 10)
      expect(map.getBearing()).toBe(bearing)
      // And the published frame says the same.
      expect(published).toHaveLength(1)
      const onScreen = published[0]!.view.worldToScreen(PLANE.toPlane({ lon: ground.lng, lat: ground.lat }))
      expect(onScreen.x).toBeCloseTo(130, 6)
      expect(onScreen.y).toBeCloseTo(90, 6)
    }
  })

  it('moves during frame dispatch are queued', () => {
    const map = new ConsistentMap({ center: PLANE.origin, zoom: 18 })
    const { driver } = attach(map)
    const seen: Array<readonly [string, number]> = []
    let panned = false
    driver.frames.onViewFrame('tools', (frame) => {
      seen.push(['tools', frame.revision])
      if (panned) return
      panned = true
      driver.apply({ kind: 'pan-by', deltaPx: { x: 10, y: 0 } })
      // Neither sent to the map nor published while the frame is dispatched.
      seen.push(['after the move', driver.frames.viewFrame.peek().revision])
      seen.push(['jumps', map.jumpTo.mock.calls.length])
    })
    driver.frames.onViewFrame('overlays', (frame) => seen.push(['overlays', frame.revision]))
    const ground = map.unproject([200, 150])

    driver.apply({ kind: 'pan-by', deltaPx: { x: 1, y: 0 } })

    expect(seen).toEqual([
      ['tools', 1],
      ['after the move', 1],
      ['jumps', 1],
      ['overlays', 1],
      ['tools', 2],
      ['overlays', 2],
    ])
    const moved = map.unproject([211, 150])
    expect(moved.lng).toBeCloseTo(ground.lng, 10)
    expect(moved.lat).toBeCloseTo(ground.lat, 10)
  })

  it('the guard arc covers a flight', () => {
    const screen = { width: 1000, height: 800 }
    const map = new ConsistentMap({ center: PLANE.origin, zoom: 3, bearing: 0 }, screen)
    const { driver, published } = attach(map)
    const viewScreen = { ...screen, devicePixelRatio: 2 }
    const floorAt = (fromDeg: number, toDeg: number) => zoomFloorForArc(viewScreen, POLICY, fromDeg, toDeg)
    // The guard installed on the map: MapLibre calls it on every candidate (centre, zoom), and it never sees the bearing.
    const guard = (zoom: number) => map.constrain!(new FakeLngLat(2.35, 48.85), zoom)
    expect(guard(0).zoom).toBeCloseTo(floorAt(0, 0), 12)

    driver.apply({ kind: 'set', target: { center: { lon: 2.4, lat: 48.9 }, zoom: 5, bearingDeg: 90, pitchDeg: 0 }, animation: 'fly' })

    expect(map.flyTo).toHaveBeenCalledWith({ center: [2.4, 48.9], zoom: 5, bearing: 90 })
    expect(map.jumpTo).not.toHaveBeenCalled()
    expect(driver.bearingTarget()).toBe(90)
    expect(published.at(-1)!.moving).toBe(true)
    // For the whole flight the floor is the arc's: largest near 45°, above both ends.
    expect(floorAt(0, 90)).toBeGreaterThan(floorAt(0, 0) + 0.1)
    expect(floorAt(0, 90)).toBeGreaterThan(floorAt(90, 90) + 0.1)
    const inFlight = guard(0)
    expect(inFlight.zoom).toBeCloseTo(floorAt(0, 90), 12)
    expect(inFlight.center).toBeInstanceOf(FakeLngLat)

    // Flight frames are MapLibre's own moves: each rebuilds the frame from the read-backs.
    map.flightFrame({ center: { lon: 2.38, lat: 48.88 }, zoom: 4, bearing: 45 })
    expect(published.at(-1)!.view.camera).toMatchObject({ zoom: 4, bearingDeg: 45 })
    expect(published.at(-1)!.moving).toBe(true)
    expect(guard(0).zoom).toBeCloseTo(floorAt(0, 90), 12)

    map.endFlight()
    const landed = published.at(-1)!
    expect(landed.moving).toBe(false)
    expect(landed.view.camera).toEqual({ center: { lon: 2.4, lat: 48.9 }, zoom: 5, bearingDeg: 90, pitchDeg: 0 })
    expect(driver.bearingTarget()).toBe(90)
    // Landed, the arc is the live bearing's alone.
    expect(guard(0).zoom).toBeCloseTo(floorAt(90, 90), 12)
  })

  it('a resize publishes one frame with the new screen size and keeps the camera', () => {
    const map = new ConsistentMap({ center: { lon: 2.351, lat: 48.852 }, zoom: 18.5, bearing: 20 })
    const { driver, published } = attach(map)
    const before = driver.frames.viewFrame.peek()
    expect(screenOf(before)).toEqual({ width: 400, height: 300, devicePixelRatio: 2 })

    map.container = { width: 640, height: 480 }
    driver.setScreen({ width: 640, height: 480, devicePixelRatio: 2 })

    expect(map.resize).toHaveBeenCalledTimes(1)
    expect(published).toHaveLength(1)
    expect(screenOf(published[0]!)).toEqual({ width: 640, height: 480, devicePixelRatio: 2 })
    expect(published[0]!.view.camera).toEqual(before.view.camera)
    expect(published[0]!.view.worldToScreen(PLANE.toPlane(before.view.camera.center)).x).toBeCloseTo(320, 6)

    // The second observer reports the same size: nothing happens.
    driver.setScreen({ width: 640, height: 480, devicePixelRatio: 2 })
    expect(map.resize).toHaveBeenCalledTimes(1)
    expect(published).toHaveLength(1)
  })

  it('resizing at 45 degrees near the world floor keeps zoom at or above zoomFloorForArc and keeps the bearing', () => {
    const small = { width: 400, height: 300 }
    const map = new ConsistentMap({ center: { lon: 10, lat: 20 }, zoom: 0, bearing: 45 }, small)
    const { driver, published } = attach(map)
    expect(driver.frames.viewFrame.peek().view.camera.zoom).toBe(0)

    const large = { width: 1600, height: 1200, devicePixelRatio: 2 }
    map.container = { width: large.width, height: large.height }
    driver.setScreen(large)

    const floor = zoomFloorForArc(large, POLICY, 45, 45)
    expect(floor).toBeGreaterThan(1.5)
    expect(published).toHaveLength(1)
    const { camera } = published[0]!.view
    expect(camera.zoom).toBeGreaterThanOrEqual(floor - 1e-12)
    expect(camera.bearingDeg).toBe(45)
    expect(map.getZoom()).toBe(camera.zoom)
    expect(map.getBearing()).toBe(45)
    expect(published[0]!.scaleBounds.min).toBeLessThanOrEqual(published[0]!.view.pixelsPerMetre * (1 + 1e-12))
  })

  it('a read-back pitch other than 0 fails with map-error', () => {
    const pitched = new ConsistentMap({ center: PLANE.origin, zoom: 18, pitch: 10 })
    const { driver: refused } = attach(pitched)
    expect(refused.failure.value).toMatchObject({ reason: 'map-error' })

    const map = new ConsistentMap({ center: PLANE.origin, zoom: 18 })
    const { driver, published } = attach(map)
    expect(driver.failure.value).toBeNull()
    map.camera.pitch = 5
    map.fire('move')

    expect(driver.failure.value).toMatchObject({ reason: 'map-error' })
    expect(published).toHaveLength(0)
    // A failed driver drives nothing.
    driver.apply({ kind: 'pan-by', deltaPx: { x: 10, y: 0 } })
    expect(map.jumpTo).not.toHaveBeenCalled()
  })

  it('a map without getCenter, getZoom, getBearing or unproject fails with map-error', () => {
    for (const missing of ['getCenter', 'getZoom', 'getBearing', 'unproject'] as const) {
      const map = new ConsistentMap({ center: PLANE.origin, zoom: 18 })
      Object.defineProperty(map, missing, { value: undefined })
      const { driver } = attach(map)

      expect(driver.failure.value).toMatchObject({ reason: 'map-error' })
      expect(driver.failure.value!.message).toContain(missing)
      expect(map.listenerCount()).toBe(0)
      expect(map.setTransformConstrain).not.toHaveBeenCalled()
    }
  })

  it('a move during a flight stops it and carries its target bearing', () => {
    const map = new ConsistentMap({ center: PLANE.origin, zoom: 12, bearing: 0 })
    const { driver, published } = attach(map)
    driver.apply({ kind: 'set', target: { center: { lon: 2.5, lat: 49 }, zoom: 14, bearingDeg: 60, pitchDeg: 0 }, animation: 'fly' })
    map.flightFrame({ center: { lon: 2.4, lat: 48.9 }, zoom: 13, bearing: 20 })

    driver.apply({ kind: 'pan-by', deltaPx: { x: 5, y: 0 } })

    expect(map.stop).toHaveBeenCalled()
    expect(map.flight).toBeNull()
    expect(map.jumpTo).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 60, zoom: 13 }))
    expect(published.at(-1)!.moving).toBe(false)
    expect(driver.bearingTarget()).toBe(60)
  })

  it('an attached map that disagrees with the frame fails the move in tests', async () => {
    await vi.dynamicImportSettled()
    const map = new ConsistentMap({ center: PLANE.origin, zoom: 18 })
    const { driver } = attach(map)
    driver.apply({ kind: 'pan-by', deltaPx: { x: 3, y: 0 } })

    const unproject = map.unproject.bind(map)
    map.unproject = ([x, y]) => unproject([x + 0.5, y])
    expect(() => driver.apply({ kind: 'pan-by', deltaPx: { x: 3, y: 0 } })).toThrow('agree')
  })

  it('dispose releases its map listeners and the guard', () => {
    const map = new ConsistentMap({ center: PLANE.origin, zoom: 18 })
    const { driver } = attach(map)
    expect(map.listenerCount()).toBe(2)
    expect(map.constrain).not.toBeNull()

    driver.dispose()

    expect(map.listenerCount()).toBe(0)
    expect(map.setTransformConstrain).toHaveBeenLastCalledWith(null)
    driver.apply({ kind: 'pan-by', deltaPx: { x: 10, y: 0 } })
    expect(map.jumpTo).not.toHaveBeenCalled()
  })
})
