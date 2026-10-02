import { beforeEach, describe, expect, it, vi } from 'vitest'
import './support/camera-tolerance'

import { SceneChromeOverlay } from '../canvas/runtime/scene-chrome'
import { pressRuler } from '../canvas/runtime/chrome/rulers'
import type { ViewFrame } from '../canvas/runtime/view/types'
import { testViewFrame } from './support/test-view'

function cameraFrame(overrides: {
  x?: number
  y?: number
  scale?: number
  width?: number
  height?: number
} = {}): ViewFrame {
  return testViewFrame({
    screen: { width: overrides.width ?? 320, height: overrides.height ?? 240 },
    viewport: { x: overrides.x ?? 0, y: overrides.y ?? 0, scale: overrides.scale ?? 8 },
  })
}

function createContextStub() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    lineCap: 'butt' as CanvasLineCap,
  } as unknown as CanvasRenderingContext2D
}

function createOverlay(onGuideCreate = vi.fn()) {
  const container = document.createElement('div')
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    x: 100,
    y: 50,
    left: 100,
    top: 50,
    right: 420,
    bottom: 290,
    width: 320,
    height: 240,
    toJSON: () => ({}),
  })
  const overlay = new SceneChromeOverlay(container, onGuideCreate)
  const gridCanvas = container.querySelector<HTMLCanvasElement>('[data-scene-chrome-part="grid"]')
  if (!gridCanvas) throw new Error('Missing Scene Chrome grid canvas')
  return { container, gridCanvas, onGuideCreate, overlay }
}

describe('SceneChromeOverlay', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('devicePixelRatio', 1)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(createContextStub() as never)
  })

  it('draws guides flush to the viewport edge when rulers are hidden', () => {
    const { gridCanvas, overlay } = createOverlay()
    const context = createContextStub()
    vi.spyOn(gridCanvas, 'getContext').mockReturnValue(context as never)

    overlay.update({
      frame: cameraFrame(),
      chromeVisible: true,
      rulersVisible: false,
      gridVisible: false,
      guides: [
        { id: 'guide-v', axis: 'v', position: 10 },
        { id: 'guide-h', axis: 'h', position: 5 },
      ],
    })

    expect(context.moveTo).toHaveBeenCalledWith(80.5, 0)
    expect(context.moveTo).toHaveBeenCalledWith(0, 40.5)
    overlay.destroy()
  })

  it('preserves the ruler gutter inset when rulers are visible', () => {
    const { gridCanvas, overlay } = createOverlay()
    const context = createContextStub()
    vi.spyOn(gridCanvas, 'getContext').mockReturnValue(context as never)

    overlay.update({
      frame: cameraFrame(),
      chromeVisible: true,
      rulersVisible: true,
      gridVisible: false,
      guides: [
        { id: 'guide-v', axis: 'v', position: 10 },
        { id: 'guide-h', axis: 'h', position: 5 },
      ],
    })

    expect(context.moveTo).toHaveBeenCalledWith(80.5, 24)
    expect(context.moveTo).toHaveBeenCalledWith(24, 40.5)
    overlay.destroy()
  })

  it('draws the visible grid in logical viewport coordinates at device pixel ratio', () => {
    vi.stubGlobal('devicePixelRatio', 2)
    const { gridCanvas, overlay } = createOverlay()
    const context = createContextStub()
    vi.spyOn(gridCanvas, 'getContext').mockReturnValue(context as never)

    overlay.update({
      frame: cameraFrame({ width: 100, height: 50 }),
      chromeVisible: true,
      rulersVisible: false,
      gridVisible: true,
      guides: [],
    })

    expect(gridCanvas.width).toBe(200)
    expect(gridCanvas.height).toBe(100)
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 100, 50)
    expect(context.lineTo).toHaveBeenCalledWith(expect.any(Number), 50)
    expect(context.lineTo).toHaveBeenCalledWith(100, expect.any(Number))
    overlay.destroy()
  })

  it('uses the normalized logical size for a collapsed viewport grid', () => {
    const { gridCanvas, overlay } = createOverlay()
    const context = createContextStub()
    vi.spyOn(gridCanvas, 'getContext').mockReturnValue(context as never)

    overlay.update({
      frame: cameraFrame({ width: 0, height: 0 }),
      chromeVisible: true,
      rulersVisible: false,
      gridVisible: true,
      guides: [],
    })

    expect(gridCanvas.width).toBe(1)
    expect(gridCanvas.height).toBe(1)
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 1, 1)
    expect(context.lineTo).toHaveBeenCalledWith(0.5, 1)
    expect(context.lineTo).toHaveBeenCalledWith(1, 0.5)
    overlay.destroy()
  })

  it('uses the normalized logical size for guides in a collapsed viewport', () => {
    const { gridCanvas, overlay } = createOverlay()
    const context = createContextStub()
    vi.spyOn(gridCanvas, 'getContext').mockReturnValue(context as never)

    overlay.update({
      frame: cameraFrame({ width: 0, height: 0 }),
      chromeVisible: true,
      rulersVisible: false,
      gridVisible: false,
      guides: [
        { id: 'guide-v', axis: 'v', position: 0 },
        { id: 'guide-h', axis: 'h', position: 0 },
      ],
    })

    expect(context.lineTo).toHaveBeenCalledWith(0.5, 1)
    expect(context.lineTo).toHaveBeenCalledWith(1, 0.5)
    overlay.destroy()
  })

  it('suppresses the grid and saved guides in overview without changing their inputs', () => {
    const { gridCanvas, overlay } = createOverlay()
    const context = createContextStub()
    vi.spyOn(gridCanvas, 'getContext').mockReturnValue(context as never)
    const guides = [{ id: 'guide-v', axis: 'v' as const, position: 10 }]

    overlay.update({
      frame: cameraFrame({ scale: 0.01 }),
      chromeVisible: true,
      rulersVisible: true,
      gridVisible: true,
      guides,
    })

    expect(gridCanvas.style.display).toBe('none')
    expect(context.beginPath).not.toHaveBeenCalled()
    expect(guides).toEqual([{ id: 'guide-v', axis: 'v', position: 10 }])
    overlay.destroy()
  })

  it('forwards the canonical camera snapshot to ruler guide creation', () => {
    const { container, onGuideCreate, overlay } = createOverlay()
    overlay.update({
      frame: cameraFrame({ y: 20, scale: 4 }),
      chromeVisible: true,
      rulersVisible: true,
      gridVisible: false,
      guides: [],
    })

    const horizontal = container.querySelector<HTMLCanvasElement>(
      '[data-ruler-overlay-part="horizontal"]',
    )
    // What the session does with a ruler press: the pressed ruler's guide port, handed the release in camera screen px
    // (client 180, 150 on the map host at 100, 50).
    pressRuler(horizontal)?.createGuideAt('h', { x: 80, y: 100 })

    expect(onGuideCreate).toHaveBeenCalledWith('h', 20)
    overlay.destroy()
  })

  it('destroys the grid and complete ruler drag lifetime together', () => {
    const { container, onGuideCreate, overlay } = createOverlay()
    overlay.update({
      frame: cameraFrame(),
      chromeVisible: true,
      rulersVisible: true,
      gridVisible: false,
      guides: [],
    })
    const horizontal = container.querySelector<HTMLCanvasElement>(
      '[data-ruler-overlay-part="horizontal"]',
    )
    // A ruler drag under way, as the session runs it: the pressed ruler's guide port, dragged.
    const press = pressRuler(horizontal)
    expect(press).not.toBeNull()
    press!.drag()
    expect(container.style.cursor).toBe('s-resize')

    overlay.destroy()
    // The drag ends with the overlay: its cursor comes back, and its release lands no guide.
    expect(container.style.cursor).toBe('')
    press!.drag()
    press!.createGuideAt('h', { x: 80, y: 100 })

    expect(container.childElementCount).toBe(0)
    expect(container.style.cursor).toBe('')
    expect(onGuideCreate).not.toHaveBeenCalled()
    expect(pressRuler(horizontal)).toBeNull()
  })

  it('rolls back the grid when ruler construction fails', () => {
    const container = document.createElement('div')
    const appendChild = container.appendChild.bind(container)
    let appendCount = 0
    vi.spyOn(container, 'appendChild').mockImplementation((node) => {
      appendCount += 1
      if (appendCount === 4) throw new Error('chrome host unavailable')
      return appendChild(node)
    })

    expect(() => new SceneChromeOverlay(container, vi.fn())).toThrow('chrome host unavailable')
    expect(container.childElementCount).toBe(0)
  })
})
