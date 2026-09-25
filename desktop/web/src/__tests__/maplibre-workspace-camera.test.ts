import { describe, expect, it, vi } from 'vitest'
import {
  MapLibreWorkspaceCameraOwner,
  type MapLibreWorkspaceCameraMap,
} from '../maplibre/workspace-camera'
import { createMapFrame } from '../canvas/maplibre-camera'
import { mapZoomToStageScale } from '../canvas/projection'

class FakeMap implements MapLibreWorkspaceCameraMap {
  readonly canvas = document.createElement('canvas')
  readonly jumpTo = vi.fn((options: { center: [number, number]; zoom: number }) => {
    if (options.zoom > this.maximumZoom) {
      this.currentZoom = this.maximumZoom
      const origin = this.projection[0]!
      this.setProjection({ x: origin.x + 12, y: origin.y - 7 }, this.projectionScale)
    } else {
      this.currentZoom = Math.max(this.minimumZoom, options.zoom)
    }
    this.center = { lng: options.center[0], lat: options.center[1] }
  })
  readonly resize = vi.fn()
  readonly on = vi.fn((type: string, listener: () => void) => {
    this.listeners.get(type)?.add(listener) ?? this.listeners.set(type, new Set([listener]))
  })
  readonly off = vi.fn((type: string, listener: () => void) => {
    this.listeners.get(type)?.delete(listener)
  })
  readonly project = vi.fn(() => this.projection[this.projectIndex++ % this.projection.length]!)
  readonly getPitch = vi.fn(() => this.pitch)
  readonly getCanvas = vi.fn(() => this.canvas)

  pitch = 0
  minimumZoom = 0
  maximumZoom = 27
  currentZoom = 18
  center = { lng: 2.3522, lat: 48.8566 }
  private projectIndex = 0
  private projectionScale = 2
  private projection = [{ x: 100, y: 50 }, { x: 102, y: 50 }, { x: 100, y: 52 }]
  private readonly listeners = new Map<string, Set<() => void>>()

  constructor(width = 400, height = 300, devicePixelRatio = 2) {
    Object.defineProperties(this.canvas, {
      clientWidth: { value: width, configurable: true },
      clientHeight: { value: height, configurable: true },
      width: { value: width * devicePixelRatio, configurable: true, writable: true },
      height: { value: height * devicePixelRatio, configurable: true, writable: true },
    })
  }

  setProjection(origin: { x: number; y: number }, scale: number): void {
    this.projection = [
      origin,
      { x: origin.x + scale, y: origin.y },
      { x: origin.x, y: origin.y + scale },
    ]
    this.projectIndex = 0
    this.projectionScale = scale
  }

  getZoom(): number { return this.currentZoom }
  getMinZoom(): number { return this.minimumZoom }
  getMaxZoom(): number { return this.maximumZoom }
  getCenter(): { lng: number; lat: number } { return this.center }

  emit(type: 'move' | 'resize'): void {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }
}

const attachmentFor = (map: FakeMap) => ({
  map,
  readOrigin: () => ({ lat: 48.8566, lon: 2.3522 }),
  maximumWorldExtentMeters: 1_000,
})

describe('MapLibreWorkspaceCameraOwner', () => {
  it('does not turn exhausted zoom into a centre-only map movement', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 300 })
    const map = new FakeMap()
    map.maximumZoom = 22
    owner.attach(attachmentFor(map))
    const maximumScale = mapZoomToStageScale(22, 48.8566)
    map.currentZoom = 22
    map.setProjection({ x: 100, y: 50 }, maximumScale)
    map.emit('move')
    const boundary = owner.snapshot.value
    expect(boundary.viewport.scale).toBe(boundary.scaleBounds.maximum)
    const jumps = map.jumpTo.mock.calls.length

    for (let input = 0; input < 100; input += 1) owner.zoomIn()

    expect(map.jumpTo).toHaveBeenCalledTimes(jumps)
    expect(owner.snapshot.value).toBe(boundary)
  })

  it('makes repeated zoom-out an exact no-op at the single-world viewport limit', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 1024 })
    const map = new FakeMap(400, 1024)
    const minimumScale = mapZoomToStageScale(1, 48.8566)
    owner.attach(attachmentFor(map))
    map.currentZoom = 1
    map.setProjection({ x: 200, y: 512 }, minimumScale)
    map.emit('move')
    const boundary = owner.snapshot.value
    const jumps = map.jumpTo.mock.calls.length

    expect(boundary.scaleBounds.minimum).toBeCloseTo(minimumScale, 12)
    for (let input = 0; input < 100; input += 1) owner.zoomOut()

    expect(map.jumpTo).toHaveBeenCalledTimes(jumps)
    expect(owner.snapshot.value).toBe(boundary)
  })

  it('publishes the exact zoom-27 scale at a high-latitude session plane origin', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 300 })
    const map = new FakeMap()
    const maximumScale = mapZoomToStageScale(27, 80)
    owner.attach({
      ...attachmentFor(map),
      readOrigin: () => ({ lat: 80, lon: 179.9 }),
    })
    map.currentZoom = 27
    map.center = { lng: 179.9, lat: 80 }
    map.setProjection({ x: 100, y: 50 }, maximumScale)
    map.emit('move')

    expect(owner.snapshot.value.viewport.scale).toBe(maximumScale)
    expect(owner.snapshot.value.scaleBounds.maximum).toBe(maximumScale)
    expect(owner.snapshot.value.mode).toBe('site')
  })

  it('keeps one frame signal while a map publishes CSS-pixel camera facts', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 800, height: 600, devicePixelRatio: 1 })
    const frameSignal = owner.frame.snapshot
    const map = new FakeMap()
    const expectedInitialMapFrame = createMapFrame(
      owner.viewport,
      { width: 400, height: 300 },
      { lat: 48.8566, lon: 2.3522 },
    )!

    owner.attachment.attach(attachmentFor(map))

    expect(owner.frame.snapshot).toBe(frameSignal)
    expect(map.jumpTo).toHaveBeenCalledWith({
      center: expectedInitialMapFrame.center,
      zoom: expectedInitialMapFrame.zoom,
      bearing: expectedInitialMapFrame.bearing,
    })
    expect(owner.snapshot.value).toMatchObject({
      viewport: { x: 100, y: 50, scale: 2 },
      screenSize: { width: 400, height: 300 },
      devicePixelRatio: 2,
    })
    const revision = owner.snapshot.value.revision

    map.emit('move')
    expect(owner.snapshot.value.revision).toBe(revision)

    map.setProjection({ x: 140, y: 80 }, 4)
    map.emit('move')
    expect(owner.snapshot.value).toMatchObject({
      viewport: { x: 140, y: 80, scale: 4 },
      screenSize: { width: 400, height: 300 },
      devicePixelRatio: 2,
      revision: revision + 1,
    })
  })

  it('re-derives an attached view from the map when the session plane moves, never transforming it twice', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 300 })
    const map = new FakeMap()
    owner.attach(attachmentFor(map))
    // The origin effect has already republished the map's frame for the new
    // plane; the re-origin transform must not be applied on top of it.
    const mapFrame = owner.viewport
    const jumps = map.jumpTo.mock.calls.length

    const result = owner.reprojectViewport({ scale: 0.7, offsetX: 783_189, offsetY: 2_378_261 })

    expect(result).toEqual(mapFrame)
    expect(owner.viewport).toEqual(mapFrame)
    expect(map.jumpTo).toHaveBeenCalledTimes(jumps)
  })

  it('reprojects a detached view through the transform', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 300 })
    owner.setViewport({ x: 10, y: 20, scale: 2 })
    const before = owner.viewport
    const after = owner.reprojectViewport({ scale: 0.5, offsetX: 4, offsetY: -6 })
    expect(after).not.toEqual(before)
  })

  it('routes attached navigation into the map and returns to Canvas2D after detach', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 300 })
    const map = new FakeMap()
    owner.attach(attachmentFor(map))
    const mapCallsBeforeNavigation = map.jumpTo.mock.calls.length

    owner.panBy({ x: 15, y: -5 })
    owner.zoomAroundScreenPoint({ x: 200, y: 150 }, 1.1)
    owner.zoomIn()
    owner.zoomOut()
    owner.zoomToFit({
      plantSpeciesColors: {}, plantSpeciesSymbols: {}, plantSpeciesCodes: {},
      layers: [], plants: [], zones: [], annotations: [], measurementGuides: [], groups: [], guides: [],
    })
    owner.initialize({ width: 1, height: 1 })

    expect(map.jumpTo).toHaveBeenCalledTimes(mapCallsBeforeNavigation + 5)
    const expectedInitializeFrame = createMapFrame(
      { x: 50, y: 0, scale: 3 },
      { width: 400, height: 300 },
      { lat: 48.8566, lon: 2.3522 },
    )!
    expect(map.jumpTo).toHaveBeenLastCalledWith({
      center: expectedInitializeFrame.center,
      zoom: expectedInitializeFrame.zoom,
      bearing: expectedInitializeFrame.bearing,
    })
    const beforeDetach = owner.snapshot.value
    owner.detach()
    expect(map.off).toHaveBeenCalledWith('move', expect.any(Function))
    expect(map.off).toHaveBeenCalledWith('resize', expect.any(Function))

    map.setProjection({ x: 500, y: 500 }, 8)
    map.emit('move')
    expect(owner.snapshot.value.viewport).toEqual(beforeDetach.viewport)
    expect(owner.snapshot.value.scaleBounds).toEqual(beforeDetach.scaleBounds)
    expect(owner.snapshot.value.groundMetersPerCssPixel).toBeNull()

    owner.panBy({ x: 10, y: 0 })
    expect(owner.viewport).toEqual({ x: beforeDetach.viewport.x + 10, y: beforeDetach.viewport.y, scale: beforeDetach.viewport.scale })
    expect(map.jumpTo).toHaveBeenCalledTimes(mapCallsBeforeNavigation + 5)
  })

  it('retains overview and resolved limits without claiming geographic scale after fallback', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 300 })
    const map = new FakeMap()
    owner.attach(attachmentFor(map))
    map.currentZoom = 0
    map.setProjection({ x: 200, y: 150 }, 0.01)
    map.emit('move')
    const attached = owner.snapshot.value
    expect(attached.mode).toBe('overview')
    expect(attached.groundMetersPerCssPixel).not.toBeNull()

    owner.detach()

    expect(owner.snapshot.value.viewport).toEqual(attached.viewport)
    expect(owner.snapshot.value.scaleBounds).toEqual(attached.scaleBounds)
    expect(owner.snapshot.value.mode).toBe('overview')
    expect(owner.snapshot.value.groundMetersPerCssPixel).toBeNull()
  })

  it('resizes the attached map and uses its backing-to-CSS-pixel density', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 300 })
    const map = new FakeMap(400, 300, 2)
    owner.attach(attachmentFor(map))
    Object.defineProperties(map.canvas, {
      clientWidth: { value: 600, configurable: true },
      clientHeight: { value: 400, configurable: true },
      width: { value: 1800, configurable: true, writable: true },
      height: { value: 1200, configurable: true, writable: true },
    })

    owner.resize({ width: 1, height: 1, devicePixelRatio: 1 })

    expect(map.resize).toHaveBeenCalledTimes(1)
    expect(owner.snapshot.value.screenSize).toEqual({ width: 600, height: 400 })
    expect(owner.snapshot.value.devicePixelRatio).toBe(3)
  })

  it('routes temporary focus and return through attached map jumps and clears it on initialize', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 300 })
    const map = new FakeMap()
    owner.attach(attachmentFor(map))
    const jumps = map.jumpTo.mock.calls.length

    expect(owner.focusTemporaryBounds(
      { minX: 0, minY: 0, maxX: 100, maxY: 50 },
      { paddingCssPx: 48 },
    )).toBe(true)
    expect(owner.returnFromTemporaryFocus()).toBe(true)
    expect(map.jumpTo).toHaveBeenCalledTimes(jumps + 1)

    owner.focusTemporaryBounds({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, { paddingCssPx: 48 })
    owner.initialize({ width: 1, height: 1 })
    expect(owner.returnFromTemporaryFocus()).toBe(false)
  })

  it('replays a failed attached return through the Canvas2D fallback', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 300 })
    const map = new FakeMap()
    owner.attach(attachmentFor(map))
    const bookmark = owner.viewport

    expect(owner.focusTemporaryBounds(
      { minX: 0, minY: 0, maxX: 100, maxY: 50 },
      { paddingCssPx: 48 },
    )).toBe(true)
    map.setProjection({ x: 240, y: 160 }, 5)
    map.emit('move')
    expect(owner.viewport).not.toEqual(bookmark)
    map.jumpTo.mockImplementationOnce(() => { throw new Error('map navigation failed') })

    expect(owner.returnFromTemporaryFocus()).toBe(true)
    expect(owner.viewport).toEqual(bookmark)
    expect(map.off).toHaveBeenCalledWith('move', expect.any(Function))

    owner.panBy({ x: 10, y: 0 })
    expect(owner.viewport.x).toBe(bookmark.x + 10)
  })

  it('removes listeners, restores the last valid frame, and reports an invalid map once', () => {
    const failure = vi.fn()
    const owner = new MapLibreWorkspaceCameraOwner({ onAttachmentFailure: failure })
    owner.initialize({ width: 400, height: 300 })
    const beforeAttach = owner.snapshot.value
    const map = new FakeMap()
    map.pitch = 1

    owner.attach(attachmentFor(map))

    expect(failure).toHaveBeenCalledTimes(1)
    expect(failure).toHaveBeenCalledWith({ kind: 'invalid-projection', reason: 'pitched-camera' })
    expect(map.off).toHaveBeenCalledWith('move', expect.any(Function))
    expect(map.off).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(owner.snapshot.value.viewport).toEqual(beforeAttach.viewport)
    expect(owner.policy.referenceLatitudeDeg).toBe(48.8566)

    map.emit('move')
    expect(failure).toHaveBeenCalledTimes(1)
  })

  it('keeps attachment failure observers outside the camera lifecycle boundary', () => {
    const observerError = new Error('observer failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const owner = new MapLibreWorkspaceCameraOwner({
      onAttachmentFailure: () => { throw observerError },
    })
    owner.initialize({ width: 400, height: 300 })
    const beforeAttach = owner.snapshot.value
    const map = new FakeMap()
    map.pitch = 1

    expect(() => owner.attach(attachmentFor(map))).not.toThrow()
    expect(owner.snapshot.value.viewport).toEqual(beforeAttach.viewport)
    expect(owner.policy.referenceLatitudeDeg).toBe(48.8566)
    expect(consoleError).toHaveBeenCalledWith(
      'MapLibre workspace camera failure observer failed:',
      observerError,
    )
    consoleError.mockRestore()
  })

  it('notifies attachment subscribers and restores the last frame when listener removal fails', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 300 })
    const map = new FakeMap()
    owner.attach(attachmentFor(map))
    const lastFrame = owner.snapshot.value
    const failure = vi.fn()
    owner.attachment.subscribeFailure(failure)
    map.off.mockImplementation(() => { throw new Error('off failed') })
    map.pitch = 1

    expect(() => map.emit('move')).not.toThrow()
    expect(failure).toHaveBeenCalledWith({ kind: 'invalid-projection', reason: 'pitched-camera' })
    expect(map.off).toHaveBeenCalledTimes(2)
    expect(owner.snapshot.value.viewport).toEqual(lastFrame.viewport)
    expect(owner.snapshot.value.groundMetersPerCssPixel).toBeNull()
  })

  it('surfaces listener cleanup errors from explicit detach after trying both removals', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 300 })
    const map = new FakeMap()
    owner.attach(attachmentFor(map))
    map.off.mockImplementation(() => { throw new Error('off failed') })

    expect(() => owner.detach()).toThrow('MapLibre workspace camera cleanup failed.')
    expect(map.off).toHaveBeenCalledTimes(2)
  })

  it('makes disposal idempotent and fences all late events', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 300 })
    const map = new FakeMap()
    owner.attach(attachmentFor(map))
    const beforeDispose = owner.snapshot.value

    owner.dispose()
    const afterDispose = owner.snapshot.value
    owner.dispose()
    map.setProjection({ x: 800, y: 800 }, 10)
    map.emit('resize')

    expect(afterDispose.viewport).toEqual(beforeDispose.viewport)
    expect(afterDispose.groundMetersPerCssPixel).toBeNull()
    expect(owner.snapshot.value).toBe(afterDispose)
    expect(map.off).toHaveBeenCalledTimes(2)
  })

  it('fences the active generation before removing listeners and replacing a map', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 300 })
    const firstMap = new FakeMap()
    owner.attach(attachmentFor(firstMap))
    const lastFirstFrame = owner.snapshot.value

    firstMap.off.mockImplementation((type) => {
      if (type !== 'move') return
      firstMap.setProjection({ x: 900, y: 700 }, 12)
      firstMap.emit('move')
    })

    const secondMap = new FakeMap()
    secondMap.setProjection({ x: 20, y: 30 }, 3)
    owner.attach(attachmentFor(secondMap))

    expect(lastFirstFrame.viewport).not.toEqual({ x: 900, y: 700, scale: 12 })
    expect(owner.snapshot.value.viewport).toEqual({ x: 20, y: 30, scale: 3 })

    firstMap.setProjection({ x: 500, y: 600 }, 9)
    firstMap.emit('move')
    expect(owner.snapshot.value.viewport).toEqual({ x: 20, y: 30, scale: 3 })
  })
})
