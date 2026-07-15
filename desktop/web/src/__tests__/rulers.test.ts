import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRulerOverlay } from '../canvas/rulers'
import type { CameraViewportSnapshot } from '../canvas/runtime/camera'
import { SCALE_BAR_CANVAS_WIDTH, SCALE_BAR_RESERVED_BOTTOM_PX } from '../canvas/scale-bar'

type RulerPart = 'horizontal' | 'vertical' | 'scale' | 'corner'

function cameraSnapshot(overrides: {
  x?: number
  y?: number
  scale?: number
  width?: number
  height?: number
  revision?: number
} = {}): CameraViewportSnapshot {
  return {
    viewport: {
      x: overrides.x ?? 12,
      y: overrides.y ?? 34,
      scale: overrides.scale ?? 8,
    },
    screenSize: {
      width: overrides.width ?? 424,
      height: overrides.height ?? 324,
    },
    referenceScale: 8,
    revision: overrides.revision ?? 1,
  }
}

function findPart<T extends HTMLElement>(host: HTMLElement, part: RulerPart): T {
  const element = host.querySelector<T>(`[data-ruler-overlay-part="${part}"]`)
  if (!element) throw new Error(`Missing ruler overlay part: ${part}`)
  return element
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
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    lineCap: 'butt' as CanvasLineCap,
  } as unknown as CanvasRenderingContext2D
}

function setHostRect(host: HTMLElement, left = 100, top = 50): void {
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
    x: left,
    y: top,
    left,
    top,
    right: left + 424,
    bottom: top + 324,
    width: 424,
    height: 324,
    toJSON: () => ({}),
  })
}

describe('RulerOverlay', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('devicePixelRatio', 2)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(createContextStub() as never)
  })

  it('cancels an active drag and restores the exact cursor when destroyed', () => {
    const host = document.createElement('div')
    host.style.cursor = 'crosshair'
    setHostRect(host)
    const onGuideCreate = vi.fn()
    const overlay = createRulerOverlay(host, { onGuideCreate })
    overlay.update({
      camera: cameraSnapshot(),
      chromeVisible: true,
      rulersVisible: true,
    })
    const horizontal = findPart<HTMLCanvasElement>(host, 'horizontal')

    horizontal.dispatchEvent(new MouseEvent('mousedown', { clientX: 180, clientY: 60 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 180, clientY: 100 }))
    expect(host.style.cursor).toBe('s-resize')

    overlay.destroy()

    expect(host.style.cursor).toBe('crosshair')
    expect(host.childElementCount).toBe(0)

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 140 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 200, clientY: 140 }))
    horizontal.dispatchEvent(new MouseEvent('mousedown', { clientX: 180, clientY: 60 }))
    expect(onGuideCreate).not.toHaveBeenCalled()
  })

  it('cancels the previous drag when another ruler drag starts', () => {
    const host = document.createElement('div')
    setHostRect(host)
    const onGuideCreate = vi.fn()
    const overlay = createRulerOverlay(host, { onGuideCreate })
    overlay.update({
      camera: cameraSnapshot({ x: 10, scale: 2 }),
      chromeVisible: true,
      rulersVisible: true,
    })

    findPart<HTMLCanvasElement>(host, 'horizontal').dispatchEvent(
      new MouseEvent('mousedown', { clientX: 180, clientY: 60 }),
    )
    findPart<HTMLCanvasElement>(host, 'vertical').dispatchEvent(
      new MouseEvent('mousedown', { clientX: 110, clientY: 100 }),
    )
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 150 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 200, clientY: 150 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 220, clientY: 170 }))

    expect(onGuideCreate).toHaveBeenCalledOnce()
    expect(onGuideCreate).toHaveBeenCalledWith('v', 45)
    overlay.destroy()
  })

  it('publishes once outside the ruler and cancels inside the ruler gutter', () => {
    const host = document.createElement('div')
    setHostRect(host)
    const onGuideCreate = vi.fn()
    const overlay = createRulerOverlay(host, { onGuideCreate })
    overlay.update({
      camera: cameraSnapshot({ y: 20, scale: 4 }),
      chromeVisible: true,
      rulersVisible: true,
    })
    const horizontal = findPart<HTMLCanvasElement>(host, 'horizontal')

    horizontal.dispatchEvent(new MouseEvent('mousedown', { clientX: 180, clientY: 60 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 180, clientY: 150 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 180, clientY: 170 }))

    expect(onGuideCreate).toHaveBeenCalledOnce()
    expect(onGuideCreate).toHaveBeenCalledWith('h', 20)

    horizontal.dispatchEvent(new MouseEvent('mousedown', { clientX: 180, clientY: 60 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 180, clientY: 70 }))

    expect(onGuideCreate).toHaveBeenCalledOnce()
    overlay.destroy()
  })

  it('cancels an active drag on window blur without publishing', () => {
    const host = document.createElement('div')
    host.style.cursor = 'grab'
    setHostRect(host)
    const onGuideCreate = vi.fn()
    const overlay = createRulerOverlay(host, { onGuideCreate })
    overlay.update({
      camera: cameraSnapshot(),
      chromeVisible: true,
      rulersVisible: true,
    })

    findPart<HTMLCanvasElement>(host, 'vertical').dispatchEvent(
      new MouseEvent('mousedown', { clientX: 110, clientY: 100 }),
    )
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 180, clientY: 100 }))
    expect(host.style.cursor).toBe('e-resize')

    window.dispatchEvent(new Event('blur'))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 180, clientY: 100 }))

    expect(host.style.cursor).toBe('grab')
    expect(onGuideCreate).not.toHaveBeenCalled()
    overlay.destroy()
  })

  it('converts a guide with the latest camera snapshot during a drag', () => {
    const host = document.createElement('div')
    setHostRect(host)
    const onGuideCreate = vi.fn()
    const overlay = createRulerOverlay(host, { onGuideCreate })
    overlay.update({
      camera: cameraSnapshot({ y: 10, scale: 2, revision: 1 }),
      chromeVisible: true,
      rulersVisible: true,
    })

    findPart<HTMLCanvasElement>(host, 'horizontal').dispatchEvent(
      new MouseEvent('mousedown', { clientX: 180, clientY: 60 }),
    )
    overlay.update({
      camera: cameraSnapshot({ y: 40, scale: 4, revision: 2 }),
      chromeVisible: true,
      rulersVisible: true,
    })
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 180, clientY: 140 }))

    expect(onGuideCreate).toHaveBeenCalledWith('h', 12.5)
    overlay.destroy()
  })

  it('cancels an active drag when rulers become hidden', () => {
    const host = document.createElement('div')
    host.style.cursor = 'crosshair'
    setHostRect(host)
    const onGuideCreate = vi.fn()
    const overlay = createRulerOverlay(host, { onGuideCreate })
    overlay.update({
      camera: cameraSnapshot(),
      chromeVisible: true,
      rulersVisible: true,
    })

    findPart<HTMLCanvasElement>(host, 'horizontal').dispatchEvent(
      new MouseEvent('mousedown', { clientX: 180, clientY: 60 }),
    )
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 180, clientY: 100 }))
    overlay.update({
      camera: cameraSnapshot(),
      chromeVisible: true,
      rulersVisible: false,
    })
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 180, clientY: 140 }))

    expect(host.style.cursor).toBe('crosshair')
    expect(onGuideCreate).not.toHaveBeenCalled()
    overlay.destroy()
  })

  it('owns visibility and dpr-aware sizing without exposing raw lifecycle parts', () => {
    const host = document.createElement('div')
    const ctx = createContextStub()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
    const overlay = createRulerOverlay(host, { onGuideCreate: vi.fn() })

    overlay.update({
      camera: cameraSnapshot({ width: 424, height: 324, scale: 8 }),
      chromeVisible: true,
      rulersVisible: false,
    })

    const horizontal = findPart<HTMLCanvasElement>(host, 'horizontal')
    const vertical = findPart<HTMLCanvasElement>(host, 'vertical')
    const scale = findPart<HTMLCanvasElement>(host, 'scale')
    const corner = findPart<HTMLDivElement>(host, 'corner')
    expect(horizontal.style.display).toBe('none')
    expect(vertical.style.display).toBe('none')
    expect(corner.style.display).toBe('none')
    expect(scale.style.display).toBe('block')
    expect(horizontal.width).toBe(800)
    expect(horizontal.height).toBe(48)
    expect(vertical.width).toBe(48)
    expect(vertical.height).toBe(600)
    expect(scale.width).toBe(SCALE_BAR_CANVAS_WIDTH * 2)
    expect(scale.height).toBe(SCALE_BAR_RESERVED_BOTTOM_PX * 2)
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
    expect(ctx.fillText).toHaveBeenCalledWith('20m', 120, 16)

    overlay.update({
      camera: cameraSnapshot(),
      chromeVisible: false,
      rulersVisible: true,
    })
    expect(horizontal.style.display).toBe('none')
    expect(vertical.style.display).toBe('none')
    expect(corner.style.display).toBe('none')
    expect(scale.style.display).toBe('none')
    overlay.destroy()
  })

  it('has terminal idempotent teardown', () => {
    const host = document.createElement('div')
    const onGuideCreate = vi.fn()
    const overlay = createRulerOverlay(host, { onGuideCreate })

    overlay.destroy()
    overlay.destroy()
    overlay.refreshTheme()
    overlay.update({
      camera: cameraSnapshot(),
      chromeVisible: true,
      rulersVisible: true,
    })

    expect(host.childElementCount).toBe(0)
    expect(onGuideCreate).not.toHaveBeenCalled()
  })

  it('rolls back partially acquired DOM when construction fails', () => {
    const host = document.createElement('div')
    const appendChild = host.appendChild.bind(host)
    let appendCount = 0
    vi.spyOn(host, 'appendChild').mockImplementation((node) => {
      appendCount += 1
      if (appendCount === 3) throw new Error('overlay host unavailable')
      return appendChild(node)
    })

    expect(() => createRulerOverlay(host, { onGuideCreate: vi.fn() })).toThrow(
      'overlay host unavailable',
    )
    expect(host.childElementCount).toBe(0)
  })
})
