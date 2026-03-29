import { beforeEach, describe, expect, it, vi } from 'vitest'
import { zoomLevel, zoomReference } from '../state/canvas'
import { CanvasViewport } from '../canvas/runtime/viewport'

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = []

  readonly observe = vi.fn()
  readonly disconnect = vi.fn()

  constructor(public readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this)
  }
}

function createStageStub(container: HTMLDivElement) {
  let width = 1000
  let height = 800
  let x = 0
  let y = 0
  let scaleX = 1
  let scaleY = 1
  let pointer = { x: 250, y: 200 }
  const handlers = new Map<string, Function[]>()

  const stage = {
    container: () => container,
    width: () => width,
    height: () => height,
    x: () => x,
    y: () => y,
    scaleX: () => scaleX,
    scaleY: () => scaleY,
    getPointerPosition: () => pointer,
    setPointerPosition: (next: { x: number; y: number }) => {
      pointer = next
    },
    setAttrs: vi.fn((attrs: Record<string, number>) => {
      if (typeof attrs.scaleX === 'number') scaleX = attrs.scaleX
      if (typeof attrs.scaleY === 'number') scaleY = attrs.scaleY
      if (typeof attrs.x === 'number') x = attrs.x
      if (typeof attrs.y === 'number') y = attrs.y
    }),
    scale: vi.fn((attrs: { x: number; y: number }) => {
      scaleX = attrs.x
      scaleY = attrs.y
    }),
    position: vi.fn((attrs: { x: number; y: number }) => {
      x = attrs.x
      y = attrs.y
    }),
    size: vi.fn((attrs: { width: number; height: number }) => {
      width = attrs.width
      height = attrs.height
    }),
    on: vi.fn((event: string, handler: Function) => {
      const current = handlers.get(event) ?? []
      current.push(handler)
      handlers.set(event, current)
    }),
    off: vi.fn((event: string, handler: Function) => {
      const current = handlers.get(event) ?? []
      handlers.set(event, current.filter((entry) => entry !== handler))
    }),
    emit: (event: string, payload: unknown) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(payload)
      }
    },
  }

  return stage
}

function createLayerStub(options: {
  visible?: boolean
  children?: Array<{ getClientRect: () => { x: number; y: number; width: number; height: number } }>
  shapeNodes?: Array<{
    getClientRect: () => { x: number; y: number; width: number; height: number }
    isVisible?: () => boolean
  }>
  plantNodes?: Array<{ scale: ReturnType<typeof vi.fn> }>
} = {}) {
  return {
    visible: () => options.visible ?? true,
    getChildren: () => options.children ?? [],
    batchDraw: vi.fn(),
    find: vi.fn((selector: string) => {
      if (selector === '.plant-group') return options.plantNodes ?? []
      if (selector === '.shape') return options.shapeNodes ?? []
      return []
    }),
  }
}

describe('CanvasViewport', () => {
  beforeEach(() => {
    ResizeObserverStub.instances = []
    zoomLevel.value = 1
    zoomReference.value = 1
    vi.restoreAllMocks()
    vi.stubGlobal('ResizeObserver', ResizeObserverStub as unknown as typeof ResizeObserver)
    vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }) as typeof requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  it('initializes the default viewport and updates zoom signals', () => {
    const container = document.createElement('div')
    const stage = createStageStub(container)
    const uiLayer = createLayerStub()
    const plantsLayer = createLayerStub()
    const viewport = new CanvasViewport({
      stage: stage as any,
      layers: new Map([
        ['ui', uiLayer as any],
        ['plants', plantsLayer as any],
      ]),
      syncOverlayTransforms: vi.fn(),
      scheduleOverlayRedraw: vi.fn(),
      scheduleLODUpdate: vi.fn(),
      reconcileMaterializedScene: vi.fn(),
    })

    viewport.initializeViewport()

    expect(stage.scale).toHaveBeenCalledWith({ x: 8, y: 8 })
    expect(stage.position).toHaveBeenCalledWith({ x: 100, y: 0 })
    expect(zoomLevel.value).toBe(8)
    expect(zoomReference.value).toBe(8)
  })

  it('zooms around the viewport center and reconciles materialized scene', () => {
    const container = document.createElement('div')
    const stage = createStageStub(container)
    const plantNode = { scale: vi.fn() }
    const uiLayer = createLayerStub()
    const plantsLayer = createLayerStub({ plantNodes: [plantNode] })
    const reconcileMaterializedScene = vi.fn()
    const viewport = new CanvasViewport({
      stage: stage as any,
      layers: new Map([
        ['ui', uiLayer as any],
        ['plants', plantsLayer as any],
      ]),
      syncOverlayTransforms: vi.fn(),
      scheduleOverlayRedraw: vi.fn(),
      scheduleLODUpdate: vi.fn(),
      reconcileMaterializedScene,
    })

    viewport.initializeViewport()
    viewport.zoomIn()

    expect(stage.scaleX()).toBeCloseTo(8.8)
    expect(stage.scaleY()).toBeCloseTo(8.8)
    expect(stage.x()).toBeCloseTo(60)
    expect(stage.y()).toBeCloseTo(-40)
    expect(plantNode.scale).toHaveBeenCalledWith({ x: 1 / 8.8, y: 1 / 8.8 })
    expect(zoomLevel.value).toBe(8.8)
    expect(reconcileMaterializedScene).toHaveBeenCalled()
  })

  it('fits visible content into the viewport bounds', () => {
    const container = document.createElement('div')
    const stage = createStageStub(container)
    const contentNode = {
      getClientRect: () => ({ x: 100, y: 50, width: 400, height: 200 }),
      isVisible: () => true,
    }
    const overlayNode = {
      getClientRect: () => ({ x: -1000, y: -1000, width: 3000, height: 3000 }),
      isVisible: () => true,
    }
    const uiLayer = createLayerStub()
    const annotationsLayer = createLayerStub({ shapeNodes: [contentNode] })
    const baseLayer = createLayerStub({ shapeNodes: [overlayNode] })
    const viewport = new CanvasViewport({
      stage: stage as any,
      layers: new Map([
        ['base', baseLayer as any],
        ['ui', uiLayer as any],
        ['annotations', annotationsLayer as any],
        ['plants', createLayerStub() as any],
      ]),
      syncOverlayTransforms: vi.fn(),
      scheduleOverlayRedraw: vi.fn(),
      scheduleLODUpdate: vi.fn(),
      reconcileMaterializedScene: vi.fn(),
    })

    viewport.zoomToFit()

    expect(stage.scaleX()).toBeCloseTo(2)
    expect(stage.scaleY()).toBeCloseTo(2)
    expect(stage.x()).toBeCloseTo(-100)
    expect(stage.y()).toBeCloseTo(100)
    expect(zoomLevel.value).toBeCloseTo(2)
  })

  it('resizes the stage and schedules overlay redraws through the observer', () => {
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 640 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 480 })
    const stage = createStageStub(container)
    const scheduleOverlayRedraw = vi.fn()
    const viewport = new CanvasViewport({
      stage: stage as any,
      layers: new Map([
        ['ui', createLayerStub() as any],
        ['plants', createLayerStub() as any],
      ]),
      syncOverlayTransforms: vi.fn(),
      scheduleOverlayRedraw,
      scheduleLODUpdate: vi.fn(),
      reconcileMaterializedScene: vi.fn(),
    })

    viewport.init(container)
    ResizeObserverStub.instances[0]!.callback([] as ResizeObserverEntry[], {} as ResizeObserver)

    expect(stage.size).toHaveBeenCalledWith({ width: 640, height: 480 })
    expect(scheduleOverlayRedraw).toHaveBeenCalled()
  })

  it('handles wheel zoom with immediate overlay sync and deferred lod scheduling', () => {
    const container = document.createElement('div')
    const stage = createStageStub(container)
    stage.position({ x: 100, y: 0 })
    stage.scale({ x: 8, y: 8 })
    const plantNode = { scale: vi.fn() }
    const syncOverlayTransforms = vi.fn()
    const scheduleLODUpdate = vi.fn()
    const uiLayer = createLayerStub()
    const plantsLayer = createLayerStub({ plantNodes: [plantNode] })
    const viewport = new CanvasViewport({
      stage: stage as any,
      layers: new Map([
        ['ui', uiLayer as any],
        ['plants', plantsLayer as any],
      ]),
      syncOverlayTransforms,
      scheduleOverlayRedraw: vi.fn(),
      scheduleLODUpdate,
      reconcileMaterializedScene: vi.fn(),
    })

    viewport.init(container)
    stage.emit('wheel', {
      evt: { deltaY: -10, ctrlKey: false },
    })

    expect(stage.scaleX()).toBeCloseTo(8.8)
    expect(stage.scaleY()).toBeCloseTo(8.8)
    expect(stage.x()).toBeCloseTo(85)
    expect(stage.y()).toBeCloseTo(-20)
    expect(syncOverlayTransforms).toHaveBeenCalled()
    expect(uiLayer.batchDraw).toHaveBeenCalled()
    expect(plantNode.scale).toHaveBeenCalledWith({ x: 1 / 8.8, y: 1 / 8.8 })
    expect(scheduleLODUpdate).toHaveBeenCalled()
    expect(zoomLevel.value).toBe(8.8)
  })
})
