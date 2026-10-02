import { signal } from '@preact/signals'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraController } from '../canvas/runtime/camera'
import { SceneCanvasInspectionOwner } from '../canvas/runtime/inspection-lens'
import { createSessionPlane } from '../canvas/session-plane'
import { createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

interface Matrix { readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly e: number; readonly f: number }

function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f,
  }
}

/** A 2D context that keeps the current transform and records each arc's centre with it; other calls do nothing. */
function recordingContext() {
  let m: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
  const stack: Matrix[] = []
  const arcs: Array<{ readonly x: number; readonly y: number; readonly m: Matrix }> = []
  const target: Record<string | symbol, unknown> = {
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => { m = { a, b, c, d, e, f } },
    transform: (a: number, b: number, c: number, d: number, e: number, f: number) => { m = multiply(m, { a, b, c, d, e, f }) },
    getTransform: () => ({ ...m }),
    save: () => { stack.push(m) },
    restore: () => { m = stack.pop() ?? m },
    translate: (x: number, y: number) => { m = multiply(m, { a: 1, b: 0, c: 0, d: 1, e: x, f: y }) },
    scale: (x: number, y: number) => { m = multiply(m, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 }) },
    rotate: (r: number) => { m = multiply(m, { a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r), e: 0, f: 0 }) },
    arc: (x: number, y: number) => { arcs.push({ x, y, m }) },
    measureText: (text: string) => ({ width: text.length * 7 }),
  }
  const ctx = new Proxy(target, {
    get: (t, key) => (key in t ? t[key] : (t[key] = () => {})),
    set: (t, key, value) => { t[key] = value; return true },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, arcs }
}

const MINT = {
  kind: 'plant' as const, id: 'mint', canonicalName: 'Mentha spicata', commonName: 'Menthe verte', position: { x: 1, y: 2 },
  color: null, stratum: null, canopySpreadM: null, rotationDeg: null, notes: null,
  plantedDate: null, quantity: null, locked: false,
}

/** A 430 x 390 lens at device pixel ratio 2 inspecting (0.5, 1.5), half a metre up-left of the mint, with the mint highlighted. */
function mountLensBesideMint() {
  vi.useFakeTimers()
  vi.stubGlobal('devicePixelRatio', 2)
  const recording = recordingContext()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(recording.ctx as never)
  let snapshot = createTestSceneRendererSnapshot({ scene: { plants: [MINT] } })
  const camera = new CameraController()
  camera.initialize({ width: 800, height: 600 })
  const owner = new SceneCanvasInspectionOwner({ frames: camera.host.frames, revision: { scene: signal(0), plantNames: signal(0) },
    getSnapshot: () => snapshot, setHoveredTarget: (target) => { snapshot = { ...snapshot, hoverTarget: target && { ...target, state: 'hover' } } } })
  const container = document.createElement('div')
  Object.defineProperties(container, { clientWidth: { value: 430 }, clientHeight: { value: 390 } })
  const view = owner.mount(container)
  view.inspectAtWorldPoint({ x: 0.5, y: 1.5 })
  vi.advanceTimersByTime(20)
  view.highlightPlant('mint')
  recording.arcs.length = 0
  vi.advanceTimersByTime(20)
  return { camera, owner, view, arcs: recording.arcs }
}

describe('Inspection Lens ownership', () => {
  it('inspects the pointer position in canvas coordinates without editing the scene or camera', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const camera = new CameraController()
    camera.initialize({ width: 800, height: 600 })
    camera.setViewport({ x: 100, y: 50, scale: 10 })
    const snapshot = createTestSceneRendererSnapshot()
    const before = JSON.stringify(snapshot.scene)
    const owner = new SceneCanvasInspectionOwner({ frames: camera.host.frames, revision: { scene: signal(0), plantNames: signal(0) },
      getSnapshot: () => snapshot, setHoveredTarget() {} })
    const view = owner.mount(document.createElement('div'))
    view.inspectAtScreenPoint({ x: 250, y: 180 })
    vi.advanceTimersByTime(20)
    expect(view.state.value!.point).toEqual({ x: 15, y: 13 })
    expect(camera.snapshot.peek().viewport).toEqual({ x: 100, y: 50, scale: 10 })
    expect(JSON.stringify(snapshot.scene)).toBe(before)
    view.inspectAtScreenPoint({ x: Number.NaN, y: 100 })
    vi.advanceTimersByTime(20)
    expect(view.state.value!.point).toEqual({ x: 15, y: 13 })
    owner.dispose()
    view.inspectAtScreenPoint({ x: 0, y: 0 })
    vi.advanceTimersByTime(20)
    expect(view.state.value).toBeNull()
  })

  it('inspectAtWorldPoint samples the world point', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const camera = new CameraController()
    camera.initialize({ width: 800, height: 600 })
    camera.setViewport({ x: 100, y: 50, scale: 10 })
    const owner = new SceneCanvasInspectionOwner({ frames: camera.host.frames, revision: { scene: signal(0), plantNames: signal(0) },
      getSnapshot: () => createTestSceneRendererSnapshot(), setHoveredTarget() {} })
    const view = owner.mount(document.createElement('div'))

    view.inspectAtWorldPoint({ x: 15, y: 13 })
    vi.advanceTimersByTime(20)
    expect(view.state.value!.point).toEqual({ x: 15, y: 13 })
    // The same ground as the screen point that projects to it; no camera read of its own.
    view.inspectAtWorldPoint({ x: -4.5, y: 2.25 })
    vi.advanceTimersByTime(20)
    expect(view.state.value!.point).toEqual({ x: -4.5, y: 2.25 })
    view.inspectAtWorldPoint({ x: Number.POSITIVE_INFINITY, y: 0 })
    vi.advanceTimersByTime(20)
    expect(view.state.value!.point).toEqual({ x: -4.5, y: 2.25 })
    expect(camera.snapshot.peek().viewport).toEqual({ x: 100, y: 50, scale: 10 })
    owner.dispose()
    view.inspectAtWorldPoint({ x: 1, y: 1 })
    vi.advanceTimersByTime(20)
    expect(view.state.value).toBeNull()
  })

  it('keeps its inspected location when the main camera moves', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const camera = new CameraController()
    camera.initialize({ width: 800, height: 600 })
    const owner = new SceneCanvasInspectionOwner({ frames: camera.host.frames,
      revision: { scene: signal(0), plantNames: signal(0) },
      getSnapshot: () => createTestSceneRendererSnapshot(), setHoveredTarget() {} })
    const view = owner.mount(document.createElement('div'))
    vi.advanceTimersByTime(20)
    const point = view.state.value!.point
    camera.panBy({ x: 120, y: 80 })
    vi.advanceTimersByTime(20)
    expect(view.state.value!.point).toEqual(point)
    owner.dispose()
  })

  it('keeps inspecting the same ground after the session plane re-origins', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const camera = new CameraController()
    camera.initialize({ width: 800, height: 600 })
    camera.setViewport({ x: 100, y: 50, scale: 10 })
    const firstPlane = createSessionPlane({ lon: 2.3522, lat: 48.8566 })
    let plane = firstPlane
    const scene = signal(0)
    const owner = new SceneCanvasInspectionOwner({ frames: camera.host.frames,
      revision: { scene, plantNames: signal(0) },
      readSessionPlane: () => plane,
      getSnapshot: () => createTestSceneRendererSnapshot(), setHoveredTarget() {} })
    const view = owner.mount(document.createElement('div'))
    view.inspectAtScreenPoint({ x: 250, y: 180 })
    vi.advanceTimersByTime(20)
    const inspected = firstPlane.toGeo(view.state.value!.point)

    const nextPlane = createSessionPlane(firstPlane.toGeo({ x: 15_000, y: -4_000 }))
    plane = nextPlane
    camera.reprojectViewport(firstPlane.transformTo(nextPlane))
    scene.value += 1
    vi.advanceTimersByTime(20)

    const after = nextPlane.toGeo(view.state.value!.point)
    expect(after.lon).toBeCloseTo(inspected.lon, 9)
    expect(after.lat).toBeCloseTo(inspected.lat, 9)
    view.panBy({ x: 1, y: 0 })
    vi.advanceTimersByTime(20)
    const panned = nextPlane.toGeo(view.state.value!.point)
    expect(panned.lat).toBeCloseTo(inspected.lat, 6)
    owner.dispose()
  })

  it('recenters explicitly and resets the inspected location with the document', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const camera = new CameraController()
    camera.initialize({ width: 800, height: 600 })
    const owner = new SceneCanvasInspectionOwner({ frames: camera.host.frames,
      revision: { scene: signal(0), plantNames: signal(0) },
      getSnapshot: () => createTestSceneRendererSnapshot(), setHoveredTarget() {} })
    const view = owner.mount(document.createElement('div'))
    vi.advanceTimersByTime(20)
    camera.setViewport({ x: 100, y: 50, scale: 10 })
    view.centerOnCanvas()
    vi.advanceTimersByTime(20)
    expect(view.state.value!.point).toEqual({ x: 30, y: 25 })
    view.panBy({ x: 4, y: 2 })
    view.zoomBy(2)
    vi.advanceTimersByTime(20)
    owner.reset()
    vi.advanceTimersByTime(20)
    expect(view.state.value!.point).toEqual({ x: 30, y: 25 })
    expect(view.state.value!.zoomPercent).toBe(700)
    owner.dispose()
    view.centerOnCanvas()
    vi.advanceTimersByTime(20)
    expect(view.state.value).toBeNull()
  })

  it('clears identification and hover when the Plants Layer becomes hidden', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    let snapshot = createTestSceneRendererSnapshot({ scene: { layers: [{ kind: 'layer', name: 'plants', visible: true, opacity: 1, locked: false }], plants: [{
      kind: 'plant', id: 'mint', canonicalName: 'Mentha spicata', commonName: 'Menthe verte', position: { x: 0, y: 0 },
      color: null, stratum: null, canopySpreadM: null, rotationDeg: null, notes: null,
      plantedDate: null, quantity: null, locked: false,
    }] } })
    const revision = { scene: signal(0), plantNames: signal(0) }, setHoveredTarget = vi.fn(target => { snapshot = { ...snapshot, hoverTarget: target } })
    const owner = new SceneCanvasInspectionOwner({ frames: new CameraController().host.frames, revision, getSnapshot: () => snapshot, setHoveredTarget })
    const view = owner.mount(document.createElement('div'))
    view.panBy({ x: 0, y: 0 }); vi.advanceTimersByTime(20)
    view.highlightPlant('mint'); vi.advanceTimersByTime(20)
    snapshot = { ...snapshot, scene: { ...snapshot.scene, layers: snapshot.scene.layers.map(layer => layer.name === 'plants' ? { ...layer, visible: false } : layer) } }
    revision.scene.value++; vi.advanceTimersByTime(20)
    expect(view.state.value?.plants).toEqual([])
    expect(setHoveredTarget).toHaveBeenLastCalledWith(null)
    owner.dispose()
  })
  it('lays out dense plant names inside the inspection frame without overlaps', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const snapshot = createTestSceneRendererSnapshot({ scene: { plants: Array.from({ length: 12 }, (_, i) => ({
      kind: 'plant', id: String(i), canonicalName: 'Mentha spicata', commonName: 'Menthe verte',
      position: { x: (i % 4) * .2, y: Math.floor(i / 4) * .2 }, color: null, stratum: null,
      canopySpreadM: null, rotationDeg: null, scale: null, notes: null, plantedDate: null, quantity: null, locked: false,
    })) } })
    const camera = new CameraController()
    camera.initialize({ width: 800, height: 600 })
    const owner = new SceneCanvasInspectionOwner({ frames: camera.host.frames, revision: { scene: signal(0), plantNames: signal(0) },
      getSnapshot: () => snapshot, setHoveredTarget() {} })
    const container = document.createElement('div')
    Object.defineProperties(container, { clientWidth: { value: 430 }, clientHeight: { value: 390 } })
    const view = owner.mount(container)
    view.panBy({ x: -49.7, y: -49.8 })
    vi.advanceTimersByTime(20)
    expect(view.state.value?.frame).toEqual({ width: 430, height: 390 })
    expect(view.state.value!.zoomPercent).toBeGreaterThan(700)
    const boxes = view.state.value!.plants.flatMap(plant => plant.label ? [plant.label] : [])
    expect(boxes.length).toBeGreaterThan(4)
    for (const [i, box] of boxes.entries()) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(430)
      expect(box.y + box.height).toBeLessThanOrEqual(390)
      for (const other of boxes.slice(i + 1)) expect(box.x < other.x + other.width && box.x + box.width > other.x
        && box.y < other.y + other.height && box.y + box.height > other.y).toBe(false)
    }
    owner.dispose()
  })
  it('pans only the inspection view, ignoring invalid or released movement', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const snapshot = createTestSceneRendererSnapshot()
    const camera = new CameraController()
    camera.initialize({ width: 800, height: 600 })
    const viewport = { ...camera.snapshot.peek().viewport }
    const owner = new SceneCanvasInspectionOwner({ frames: camera.host.frames, revision: { scene: signal(0), plantNames: signal(0) },
      getSnapshot: () => snapshot, setHoveredTarget() {} })
    const view = owner.mount(document.createElement('div'))
    view.panBy({ x: -49, y: -48 })
    vi.advanceTimersByTime(20)
    view.panBy({ x: 2, y: -1 })
    vi.advanceTimersByTime(20)
    expect(view.state.value?.point).toEqual({ x: 3, y: 1 })
    view.panBy({ x: Number.NaN, y: 0 })
    vi.advanceTimersByTime(20)
    expect(view.state.value?.point).toEqual({ x: 3, y: 1 })
    expect(view.state.value?.scale).toBeGreaterThan(0)
    expect(camera.snapshot.peek().viewport).toEqual(viewport)
    owner.dispose()
    view.panBy({ x: 2, y: 2 })
    vi.advanceTimersByTime(20)
    expect(view.state.value).toBeNull()
  })

  it('rolls back its canvas and scheduled work if attachment fails', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      observe() { throw new Error('attachment failed') }
      disconnect = disconnect
    })
    const camera = new CameraController()
    const getSnapshot = vi.fn(() => createTestSceneRendererSnapshot())
    const owner = new SceneCanvasInspectionOwner({ frames: camera.host.frames, revision: { scene: signal(0), plantNames: signal(0) },
      getSnapshot, setHoveredTarget() {} })
    const container = document.createElement('div')
    try {
      expect(() => owner.mount(container)).toThrow('attachment failed')
      expect(container.childElementCount).toBe(0)
      expect(disconnect).toHaveBeenCalled()
      vi.advanceTimersByTime(20)
      expect(getSnapshot).not.toHaveBeenCalled()
    } finally { owner.dispose(); vi.unstubAllGlobals() }
  })

  it('identifies nearby plants and keeps its location without changing the Design', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const snapshot = createTestSceneRendererSnapshot({ scene: { plants: [{
      kind: 'plant', id: 'mint', canonicalName: 'Mentha spicata', commonName: 'Menthe verte', position: { x: 1, y: 2 },
      color: null, stratum: null, canopySpreadM: null, rotationDeg: null, notes: null,
      plantedDate: null, quantity: null, locked: false,
    }] } })
    const before = JSON.stringify(snapshot.scene)
    const camera = new CameraController()
    camera.initialize({ width: 800, height: 600 })
    const owner = new SceneCanvasInspectionOwner({ frames: camera.host.frames, revision: { scene: signal(0), plantNames: signal(0) },
      getSnapshot: () => snapshot, setHoveredTarget() {} })
    const container = document.createElement('div')
    const view = owner.mount(container)
    view.panBy({ x: -49, y: -48 })
    vi.advanceTimersByTime(20)
    expect(view.state.value?.plants.map((plant) => plant.name)).toEqual(['Menthe verte'])
    camera.panBy({ x: 5, y: 6 })
    vi.advanceTimersByTime(20)
    expect(view.state.value?.point).toEqual({ x: 1, y: 2 })
    const viewport = { ...camera.snapshot.peek().viewport }
    const lensZoom = view.state.value!.zoomPercent
    view.zoomBy(1.25)
    vi.advanceTimersByTime(20)
    expect(view.state.value!.zoomPercent).toBeGreaterThan(lensZoom)
    expect(camera.snapshot.peek().viewport).toEqual(viewport)
    expect(JSON.stringify(snapshot.scene)).toBe(before)
    const scale = camera.snapshot.peek().viewport.scale
    view.focusPlant('mint')
    vi.advanceTimersByTime(20)
    expect(camera.snapshot.peek().viewport.scale).toBe(scale)
    expect(camera.snapshot.peek().viewport).toEqual(viewport)
    expect(view.state.value?.point).toEqual({ x: 1, y: 2 })
    owner.reset()
    vi.advanceTimersByTime(20)
    expect(view.state.value?.zoomPercent).toBe(700)
    expect(JSON.stringify(snapshot.scene)).toBe(before)
    owner.dispose()
    expect(container.querySelector('canvas')).toBeNull()
    view.panBy({ x: 5, y: 6 })
    vi.advanceTimersByTime(20)
    expect(view.state.value).toBeNull()
    view.dispose()
  })
  it('the lens draws the same pixels through its view transform at bearing 0', () => {
    const { owner, view, arcs } = mountLensBesideMint()
    const { scale } = view.state.value!
    expect(arcs.length).toBeGreaterThan(0)
    // Today's lens: device pixels = dpr × (the lens centre at the frame centre, world metres × scale).
    for (const arc of arcs) {
      expect(arc).toMatchObject({ x: 1, y: 2 })
      expect(arc.m.a).toBeCloseTo(2 * scale, 6)
      expect(arc.m.b).toBeCloseTo(0, 6)
      expect(arc.m.c).toBeCloseTo(0, 6)
      expect(arc.m.d).toBeCloseTo(2 * scale, 6)
      expect(arc.m.e).toBeCloseTo(2 * (215 - 0.5 * scale), 6)
      expect(arc.m.f).toBeCloseTo(2 * (195 - 1.5 * scale), 6)
    }
    owner.dispose()
  })

  it('name buttons and rings keep today\'s positions at bearing 0', () => {
    const { owner, view, arcs } = mountLensBesideMint()
    const { scale, plants } = view.state.value!
    const today = { x: 215 + (1 - 0.5) * scale, y: 195 + (2 - 1.5) * scale }
    expect(plants.map((plant) => plant.id)).toEqual(['mint'])
    expect(plants[0]!.screenPosition.x).toBeCloseTo(today.x, 6)
    expect(plants[0]!.screenPosition.y).toBeCloseTo(today.y, 6)
    // The name button sits 13 px below its plant, as today.
    expect(plants[0]!.label!.y).toBeCloseTo(today.y + 13, 6)
    // The hover ring is drawn where the name button points.
    const ring = arcs.at(-1)!
    expect((ring.m.a * ring.x + ring.m.c * ring.y + ring.m.e) / 2).toBeCloseTo(today.x, 6)
    expect((ring.m.b * ring.x + ring.m.d * ring.y + ring.m.f) / 2).toBeCloseTo(today.y, 6)
    owner.dispose()
  })

  it('the source quad follows a main-camera frame before the next lens paint', () => {
    const { camera, owner, view } = mountLensBesideMint()
    const state = view.state.value!
    /** Today's outline: the lens footprint through the main camera, corners TL, TR, BR, BL. */
    const todayQuad = () => {
      const { x, y, scale } = camera.snapshot.peek().viewport
      const left = x + (state.point.x - state.frame.width / state.scale / 2) * scale
      const top = y + (state.point.y - state.frame.height / state.scale / 2) * scale
      const width = state.frame.width / state.scale * scale
      const height = state.frame.height / state.scale * scale
      return [{ x: left, y: top }, { x: left + width, y: top }, { x: left + width, y: top + height }, { x: left, y: top + height }]
    }
    const expectQuad = (expected: ReturnType<typeof todayQuad>) => {
      const quad = view.sourceQuad.value
      expect(quad).not.toBeNull()
      for (const [index, corner] of expected.entries()) {
        expect(quad![index]!.x).toBeCloseTo(corner.x, 6)
        expect(quad![index]!.y).toBeCloseTo(corner.y, 6)
      }
    }
    expectQuad(todayQuad())

    camera.panBy({ x: 120, y: 80 })

    // No lens paint ran: the lens state is the same object, yet the outline moved with the map.
    expect(view.state.value).toBe(state)
    expectQuad(todayQuad())
    owner.dispose()
    expect(view.sourceQuad.value).toBeNull()
  })
})
