import { beforeEach, describe, expect, it, vi } from 'vitest'

const rulersModule = vi.hoisted(() => {
  const createHtmlRulers = vi.fn((container: HTMLElement) => {
    const hCanvas = document.createElement('canvas')
    const vCanvas = document.createElement('canvas')
    const scaleCanvas = document.createElement('canvas')
    const corner = document.createElement('div')
    container.appendChild(hCanvas)
    container.appendChild(vCanvas)
    container.appendChild(scaleCanvas)
    container.appendChild(corner)
    return {
      hCanvas,
      vCanvas,
      scaleCanvas,
      corner,
      onGuideCreate: null,
      destroy() {
        hCanvas.remove()
        vCanvas.remove()
        scaleCanvas.remove()
        corner.remove()
      },
    }
  })

  return {
    createHtmlRulers,
    refreshRulerColors: vi.fn(),
    setHtmlOverlayVisibility: vi.fn(),
    updateHtmlRulers: vi.fn(),
  }
})

vi.mock('../canvas/rulers', () => rulersModule)

import { SceneChromeOverlay } from '../canvas/runtime/scene-chrome'

function createContextStub() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D
}

describe('SceneChromeOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('devicePixelRatio', 1)
  })

  it('draws guides flush to the viewport edge when rulers are hidden', () => {
    const container = document.createElement('div')
    const overlay = new SceneChromeOverlay(container)
    const gridCanvas = container.querySelector('canvas')
    const ctx = createContextStub()

    vi.spyOn(gridCanvas!, 'getContext').mockReturnValue(ctx as never)

    overlay.update({
      viewport: { x: 0, y: 0, scale: 8 },
      width: 320,
      height: 240,
      chromeVisible: true,
      rulersVisible: false,
      gridVisible: false,
      guides: [
        { id: 'guide-v', axis: 'v', position: 10 },
        { id: 'guide-h', axis: 'h', position: 5 },
      ],
    })

    expect(ctx.moveTo).toHaveBeenNthCalledWith(1, 80.5, 0)
    expect(ctx.moveTo).toHaveBeenNthCalledWith(2, 0, 40.5)
  })

  it('preserves the ruler gutter inset when rulers are visible', () => {
    const container = document.createElement('div')
    const overlay = new SceneChromeOverlay(container)
    const gridCanvas = container.querySelector('canvas')
    const ctx = createContextStub()

    vi.spyOn(gridCanvas!, 'getContext').mockReturnValue(ctx as never)

    overlay.update({
      viewport: { x: 0, y: 0, scale: 8 },
      width: 320,
      height: 240,
      chromeVisible: true,
      rulersVisible: true,
      gridVisible: false,
      guides: [
        { id: 'guide-v', axis: 'v', position: 10 },
        { id: 'guide-h', axis: 'h', position: 5 },
      ],
    })

    expect(ctx.moveTo).toHaveBeenNthCalledWith(1, 80.5, 24)
    expect(ctx.moveTo).toHaveBeenNthCalledWith(2, 24, 40.5)
  })
})
