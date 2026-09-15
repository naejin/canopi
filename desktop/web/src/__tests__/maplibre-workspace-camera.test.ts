import { describe, expect, it, vi } from 'vitest'
import {
  MapLibreWorkspaceCameraOwner,
  type MapLibreWorkspaceCameraMap,
} from '../maplibre/workspace-camera'
import { createMapFrame } from '../canvas/maplibre-camera'

class FakeMap implements MapLibreWorkspaceCameraMap {
  readonly canvas = document.createElement('canvas')
  readonly jumpTo = vi.fn()
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
  private projectIndex = 0
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
  }

  emit(type: 'move' | 'resize'): void {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }
}

const attachmentFor = (map: FakeMap) => ({
  map,
  anchor: { lat: 48.8566, lon: 2.3522 },
  northBearingDeg: 0,
  maximumWorldExtentMeters: 1_000,
})

describe('MapLibreWorkspaceCameraOwner', () => {
  it('keeps one frame signal while a map publishes CSS-pixel camera facts', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 800, height: 600, devicePixelRatio: 1 })
    const frameSignal = owner.frame.snapshot
    const map = new FakeMap()
    const expectedInitialMapFrame = createMapFrame(
      owner.viewport,
      { width: 400, height: 300 },
      { lat: 48.8566, lon: 2.3522 },
      0,
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

    expect(map.jumpTo).toHaveBeenCalledTimes(mapCallsBeforeNavigation + 6)
    const expectedInitializeFrame = createMapFrame(
      { x: 50, y: 0, scale: 3 },
      { width: 400, height: 300 },
      { lat: 48.8566, lon: 2.3522 },
      0,
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
    expect(owner.snapshot.value).toBe(beforeDetach)

    owner.panBy({ x: 10, y: 0 })
    expect(owner.viewport).toEqual({ x: beforeDetach.viewport.x + 10, y: beforeDetach.viewport.y, scale: beforeDetach.viewport.scale })
    expect(map.jumpTo).toHaveBeenCalledTimes(mapCallsBeforeNavigation + 6)
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
    expect(map.jumpTo).toHaveBeenCalledTimes(jumps + 2)

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
    expect(owner.snapshot.value).toBe(beforeAttach)

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
    expect(owner.snapshot.value).toBe(beforeAttach)
    expect(consoleError).toHaveBeenCalledWith(
      'MapLibre workspace camera failure observer failed:',
      observerError,
    )
    consoleError.mockRestore()
  })

  it('makes disposal idempotent and fences all late events', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 300 })
    const map = new FakeMap()
    owner.attach(attachmentFor(map))
    const beforeDispose = owner.snapshot.value

    owner.dispose()
    owner.dispose()
    map.setProjection({ x: 800, y: 800 }, 10)
    map.emit('resize')

    expect(owner.snapshot.value).toBe(beforeDispose)
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
