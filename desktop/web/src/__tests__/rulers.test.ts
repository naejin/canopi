import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHtmlRulers, setHtmlOverlayVisibility, updateHtmlRulers } from '../canvas/rulers'
import { SCALE_BAR_CANVAS_WIDTH, SCALE_BAR_RESERVED_BOTTOM_PX } from '../canvas/scale-bar'

function createStageStub(container: HTMLDivElement, overrides: {
  scaleX?: number
  scaleY?: number
  position?: { x: number; y: number }
} = {}) {
  return {
    scaleX: () => overrides.scaleX ?? 8,
    scaleY: () => overrides.scaleY ?? 8,
    position: () => overrides.position ?? { x: 12, y: 34 },
    container: () => container,
  } as any
}

describe('html rulers overlay', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('devicePixelRatio', 2)
  })

  it('creates a dedicated html scale bar canvas in the overlay container', () => {
    const overlay = document.createElement('div')
    const rulers = createHtmlRulers(overlay)

    expect(rulers.scaleCanvas.parentElement).toBe(overlay)
    expect(rulers.scaleCanvas.style.width).toBe(`${SCALE_BAR_CANVAS_WIDTH}px`)
    expect(rulers.scaleCanvas.style.height).toBe(`${SCALE_BAR_RESERVED_BOTTOM_PX}px`)
    expect(rulers.scaleCanvas.style.bottom).toBe('0px')
    expect(rulers.scaleCanvas.style.pointerEvents).toBe('none')

    rulers.destroy()
    expect(rulers.scaleCanvas.isConnected).toBe(false)
  })

  it('keeps the scale bar visible when chrome is on but rulers are hidden', () => {
    const overlay = document.createElement('div')
    const rulers = createHtmlRulers(overlay)

    setHtmlOverlayVisibility(rulers, { chromeVisible: true, rulersVisible: false })

    expect(rulers.hCanvas.style.display).toBe('none')
    expect(rulers.vCanvas.style.display).toBe('none')
    expect(rulers.corner.style.display).toBe('none')
    expect(rulers.scaleCanvas.style.display).toBe('block')
  })

  it('redraws the html scale bar with dpr-aware canvas sizing', () => {
    const overlay = document.createElement('div')
    const container = document.createElement('div')
    container.style.setProperty('--color-text-muted', 'rgba(1, 2, 3, 0.6)')
    const rulers = createHtmlRulers(overlay)
    const stage = createStageStub(container)

    Object.defineProperty(rulers.hCanvas, 'offsetWidth', { configurable: true, value: 400 })
    Object.defineProperty(rulers.vCanvas, 'offsetHeight', { configurable: true, value: 300 })
    Object.defineProperty(rulers.scaleCanvas, 'offsetWidth', { configurable: true, value: SCALE_BAR_CANVAS_WIDTH })
    Object.defineProperty(rulers.scaleCanvas, 'offsetHeight', { configurable: true, value: SCALE_BAR_RESERVED_BOTTOM_PX })

    const ctx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      scale: vi.fn(),
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
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      font: '',
      textAlign: 'left' as CanvasTextAlign,
      textBaseline: 'alphabetic' as CanvasTextBaseline,
      lineCap: 'butt' as CanvasLineCap,
    }

    vi.spyOn(rulers.scaleCanvas, 'getContext').mockReturnValue(ctx as never)
    vi.spyOn(rulers.hCanvas, 'getContext').mockReturnValue(ctx as never)
    vi.spyOn(rulers.vCanvas, 'getContext').mockReturnValue(ctx as never)

    updateHtmlRulers(rulers, stage)

    expect(rulers.scaleCanvas.width).toBe(SCALE_BAR_CANVAS_WIDTH * 2)
    expect(rulers.scaleCanvas.height).toBe(SCALE_BAR_RESERVED_BOTTOM_PX * 2)
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
    expect(ctx.fillText).toHaveBeenCalledWith('20 m', 120, 16)
  })
})
