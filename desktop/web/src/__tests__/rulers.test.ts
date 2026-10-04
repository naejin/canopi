import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRulerOverlay, pressRuler } from '../canvas/runtime/chrome/rulers'
import type { ViewFrame } from '../canvas/runtime/view/types'
import { mapZoomToStageScale, stageScaleToMapZoom } from '../canvas/projection'
import { createSessionPlane } from '../canvas/session-plane'
import { refreshCanvasColorCache } from '../canvas/theme-refresh'
import { testViewFrame } from './support/test-view'
import './support/camera-tolerance'

type RulerPart = 'horizontal' | 'vertical' | 'corner'

function cameraFrame(overrides: {
  x?: number
  y?: number
  scale?: number
  width?: number
  height?: number
} = {}): ViewFrame {
  return testViewFrame({
    screen: { width: overrides.width ?? 424, height: overrides.height ?? 324 },
    viewport: { x: overrides.x ?? 12, y: overrides.y ?? 34, scale: overrides.scale ?? 8 },
  })
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
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as unknown as CanvasRenderingContext2D
}

/** A guide pulled out of the host's `axis` ruler and released at `at`, as the session lands it. */
function pullGuide(host: HTMLElement, axis: 'h' | 'v', at: { x: number; y: number }): void {
  const part = host.querySelector(`[data-canvas-ruler="${axis}"]`)
  pressRuler(part)?.createGuideAt(at)
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

  /** The fill each ruler band was painted with, in draw order. */
  function recordBandFills(): string[] {
    const fills: string[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const context = createContextStub()
      vi.mocked(context.fillRect).mockImplementation(() => { fills.push(String(context.fillStyle)) })
      return context as never
    })
    return fills
  }

  /** A theme switch as the workspace runs it: the canvas colours re-read from the container's tokens. */
  function switchTheme(tokens: Record<string, string>): void {
    const container = document.createElement('div')
    for (const [name, value] of Object.entries(tokens)) container.style.setProperty(name, value)
    refreshCanvasColorCache(container)
  }
  const LIGHT_RULER = { '--canvas-ruler-bg': '#F3EEE3', '--canvas-ruler-text': '#645A4C', '--color-border': 'rgba(58, 46, 28, 0.14)' }
  const DARK_RULER = { '--canvas-ruler-bg': '#2A2721', '--canvas-ruler-text': '#B5AC9D', '--color-border': 'rgba(255, 248, 235, 0.12)' }

  it('refreshTheme redraws at once with the new palette', () => {
    const fills = recordBandFills()
    const overlay = createRulerOverlay(document.createElement('div'), { onGuideCreate: vi.fn() })
    overlay.update({ frame: cameraFrame(), chromeVisible: true, rulersVisible: true })
    fills.length = 0
    try {
      switchTheme(DARK_RULER)
      overlay.refreshTheme()
      // No new frame came: the theme alone repaints both bands.
      expect(fills).toEqual(['#2A2721', '#2A2721'])
    } finally {
      switchTheme(LIGHT_RULER)
      overlay.destroy()
    }
  })

  it('a dark theme refresh changes the ruler fill', () => {
    const fills = recordBandFills()
    const overlay = createRulerOverlay(document.createElement('div'), { onGuideCreate: vi.fn() })
    const frame = cameraFrame()
    try {
      overlay.update({ frame, chromeVisible: true, rulersVisible: true })
      expect(fills.at(-1)).toBe('#F3EEE3')
      switchTheme(DARK_RULER)
      overlay.refreshTheme()
      overlay.update({ frame, chromeVisible: true, rulersVisible: true })
      expect(fills.at(-1)).toBe('#2A2721')
    } finally {
      switchTheme(LIGHT_RULER)
      overlay.destroy()
    }
  })

  it('keeps every part hidden until the first visibility snapshot', () => {
    const host = document.createElement('div')
    const overlay = createRulerOverlay(host, { onGuideCreate: vi.fn() })

    expect(findPart<HTMLCanvasElement>(host, 'horizontal').style.display).toBe('none')
    expect(findPart<HTMLCanvasElement>(host, 'vertical').style.display).toBe('none')
    expect(findPart<HTMLDivElement>(host, 'corner').style.display).toBe('none')
    // The scale bar lives in the zoom group, not on the canvas.
    expect(host.querySelector('[data-ruler-overlay-part="scale"]')).toBeNull()

    overlay.destroy()
  })

  it('creates a guide at a camera screen point past the gutter, and none inside it or while hidden', () => {
    const host = document.createElement('div')
    const onGuideCreate = vi.fn()
    const overlay = createRulerOverlay(host, { onGuideCreate })

    pullGuide(host, 'h', { x: 80, y: 100 })
    expect(onGuideCreate).not.toHaveBeenCalled()

    overlay.update({ frame: cameraFrame({ x: 12, y: 20, scale: 4 }), chromeVisible: true, rulersVisible: true })
    pullGuide(host, 'h', { x: 80, y: 100 })
    pullGuide(host, 'v', { x: 52, y: 10 })
    pullGuide(host, 'h', { x: 80, y: 24 })
    pullGuide(host, 'v', { x: 24, y: 80 })
    expect(onGuideCreate.mock.calls).toEqual([['h', 20], ['v', 10]])
    expect(findPart<HTMLCanvasElement>(host, 'horizontal').dataset.canvasRuler).toBe('h')
    expect(findPart<HTMLCanvasElement>(host, 'vertical').dataset.canvasRuler).toBe('v')

    overlay.update({ frame: cameraFrame({ x: 12, y: 20, scale: 4 }), chromeVisible: true, rulersVisible: false })
    pullGuide(host, 'h', { x: 80, y: 100 })
    overlay.destroy()
    pullGuide(host, 'h', { x: 80, y: 100 })
    expect(onGuideCreate).toHaveBeenCalledTimes(2)
  })

  it('rulers hide when rotated and return at north', () => {
    const host = document.createElement('div')
    const onGuideCreate = vi.fn()
    const overlay = createRulerOverlay(host, { onGuideCreate })
    const display = () => (['horizontal', 'vertical', 'corner'] as const).map((part) => findPart(host, part).style.display)
    const north = cameraFrame({ y: 20, scale: 4 })
    const turned = testViewFrame({ screen: { width: 424, height: 324 }, camera: { bearingDeg: 30 } })

    overlay.update({ frame: north, chromeVisible: true, rulersVisible: true })
    expect(display()).toEqual(['block', 'block', 'block'])
    const press = pressRuler(findPart(host, 'horizontal'))

    // Turned, the rulers hide and no guide can be pulled, not even by a press made at north.
    overlay.update({ frame: turned, chromeVisible: true, rulersVisible: true })
    expect(display()).toEqual(['none', 'none', 'none'])
    pullGuide(host, 'h', { x: 80, y: 100 })
    press?.createGuideAt({ x: 80, y: 100 })
    expect(onGuideCreate).not.toHaveBeenCalled()

    overlay.update({ frame: north, chromeVisible: true, rulersVisible: true })
    expect(display()).toEqual(['block', 'block', 'block'])
    pullGuide(host, 'h', { x: 80, y: 100 })
    expect(onGuideCreate).toHaveBeenCalledExactlyOnceWith('h', 20)
    overlay.destroy()
  })

  it('a ruler tick meets the grid line it labels at a bearing inside the north-up tolerance', () => {
    // An exact "Turn view to this edge" on a hand-drawn 120 m fence with 5 cm of drift, about 400 m south and east of the plane origin.
    const plane = createSessionPlane({ lon: 2.3522, lat: 48.8566 })
    const frame = testViewFrame({
      plane,
      screen: { width: 1400, height: 324 },
      camera: {
        center: plane.toGeo({ x: 400, y: 400 }),
        zoom: stageScaleToMapZoom(25, plane.origin.lat),
        bearingDeg: Math.atan2(0.05, 120) * 180 / Math.PI,
      },
    })
    expect(frame.view.northUp).toBe(true)
    expect(frame.view.camera.bearingDeg).not.toBe(0)

    const host = document.createElement('div')
    const contexts = new Map<HTMLCanvasElement, CanvasRenderingContext2D>()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      if (!contexts.has(this)) contexts.set(this, createContextStub())
      return contexts.get(this) as never
    })
    const overlay = createRulerOverlay(host, { onGuideCreate: vi.fn() })
    overlay.update({ frame, chromeVisible: true, rulersVisible: true })
    const metres = (label: string): number => Number.parseFloat(label)
    const view = frame.view

    // The top ruler's labelled ticks: where each meets the canvas (screen row 24), the world x is the tick's own value.
    const horizontal = contexts.get(findPart<HTMLCanvasElement>(host, 'horizontal'))!
    const topLabels = vi.mocked(horizontal.fillText).mock.calls
    expect(topLabels.length).toBeGreaterThan(2)
    for (const [label, canvasX] of topLabels) {
      const ground = view.screenToWorld({ x: canvasX + 24, y: 24 })
      expect(Math.abs(ground.x - metres(label)) * view.pixelsPerMetre).toBeLessThan(0.05)
    }

    // The left ruler's labelled ticks: where each meets the canvas (screen column 24), the world y is the tick's own value.
    const vertical = contexts.get(findPart<HTMLCanvasElement>(host, 'vertical'))!
    const leftLabels = vi.mocked(vertical.fillText).mock.calls.map(([label]) => label)
    const leftRows = vi.mocked(vertical.translate).mock.calls.map(([, canvasY]) => canvasY)
    expect(leftLabels.length).toBeGreaterThan(2)
    leftLabels.forEach((label, index) => {
      const ground = view.screenToWorld({ x: 24, y: leftRows[index]! + 24 })
      expect(Math.abs(ground.y - metres(label)) * view.pixelsPerMetre).toBeLessThan(0.05)
    })
    overlay.destroy()
  })

  it('refuses a guide in overview', () => {
    const host = document.createElement('div')
    const onGuideCreate = vi.fn()
    const overlay = createRulerOverlay(host, { onGuideCreate })

    overlay.update({ frame: cameraFrame({ scale: 0.01 }), chromeVisible: true, rulersVisible: true })
    pullGuide(host, 'h', { x: 80, y: 100 })
    expect(onGuideCreate).not.toHaveBeenCalled()

    overlay.update({ frame: cameraFrame({ y: 20, scale: 4 }), chromeVisible: true, rulersVisible: true })
    pullGuide(host, 'h', { x: 80, y: 100 })
    expect(onGuideCreate).toHaveBeenCalledExactlyOnceWith('h', 20)
    overlay.destroy()
  })

  it('a pressed ruler finds its own overlay\'s guide port', () => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    const firstGuide = vi.fn()
    const secondGuide = vi.fn()
    const firstOverlay = createRulerOverlay(first, { onGuideCreate: firstGuide })
    const secondOverlay = createRulerOverlay(second, { onGuideCreate: secondGuide })
    firstOverlay.update({ frame: cameraFrame({ x: 12, y: 20, scale: 4 }), chromeVisible: true, rulersVisible: true })
    secondOverlay.update({ frame: cameraFrame({ x: 10, y: 20, scale: 2 }), chromeVisible: true, rulersVisible: true })

    const vertical = pressRuler(findPart<HTMLCanvasElement>(second, 'vertical'))
    vertical?.createGuideAt({ x: 100, y: 80 })
    expect(secondGuide).toHaveBeenCalledExactlyOnceWith('v', 45)
    expect(firstGuide).not.toHaveBeenCalled()

    expect(pressRuler(findPart<HTMLDivElement>(first, 'corner'))).toBeNull()
    expect(pressRuler(first)).toBeNull()
    expect(pressRuler(null)).toBeNull()
    const horizontal = findPart<HTMLCanvasElement>(first, 'horizontal')
    firstOverlay.destroy()
    expect(pressRuler(horizontal)).toBeNull()
    secondOverlay.destroy()
  })

  it('a ruler pressed before the rulers hide lands no guide, even once they show again', () => {
    const host = document.createElement('div')
    const onGuideCreate = vi.fn()
    const overlay = createRulerOverlay(host, { onGuideCreate })
    const visible = { frame: cameraFrame({ y: 20, scale: 4 }), chromeVisible: true, rulersVisible: true }
    overlay.update(visible)
    const horizontal = findPart<HTMLCanvasElement>(host, 'horizontal')

    for (const hidden of [
      { ...visible, rulersVisible: false },
      { ...visible, chromeVisible: false },
      { ...visible, frame: cameraFrame({ scale: 0.01 }) },
    ]) {
      const press = pressRuler(horizontal)
      overlay.update(hidden)
      overlay.update(visible)
      press?.createGuideAt({ x: 80, y: 100 })
    }
    expect(onGuideCreate).not.toHaveBeenCalled()

    // A press after the rulers came back lands, and so does one across an update that keeps them shown.
    const press = pressRuler(horizontal)
    overlay.update({ ...visible, frame: cameraFrame({ y: 40, scale: 4 }) })
    press?.createGuideAt({ x: 80, y: 100 })
    expect(onGuideCreate).toHaveBeenCalledExactlyOnceWith('h', 15)

    const beforeDestroy = pressRuler(horizontal)
    overlay.destroy()
    beforeDestroy?.createGuideAt({ x: 80, y: 100 })
    expect(onGuideCreate).toHaveBeenCalledOnce()
  })

  it('a press\'s drag cursor comes back when it ends, when the next press starts, and when the rulers hide or go', () => {
    const host = document.createElement('div')
    host.style.cursor = 'crosshair'
    const overlay = createRulerOverlay(host, { onGuideCreate: vi.fn() })
    const visible = { frame: cameraFrame(), chromeVisible: true, rulersVisible: true }
    overlay.update(visible)
    const horizontal = findPart<HTMLCanvasElement>(host, 'horizontal')
    const vertical = findPart<HTMLCanvasElement>(host, 'vertical')

    const first = pressRuler(horizontal)
    first?.drag()
    expect(host.style.cursor).toBe('s-resize')
    first?.end()
    first?.end()
    expect(host.style.cursor).toBe('crosshair')
    first?.drag()
    expect(host.style.cursor).toBe('crosshair')

    pressRuler(horizontal)?.drag()
    const next = pressRuler(vertical)
    expect(host.style.cursor).toBe('crosshair')
    next?.drag()
    expect(host.style.cursor).toBe('e-resize')

    overlay.update({ ...visible, rulersVisible: false })
    expect(host.style.cursor).toBe('crosshair')
    next?.drag()
    expect(host.style.cursor).toBe('crosshair')

    overlay.update(visible)
    pressRuler(horizontal)?.drag()
    overlay.destroy()
    expect(host.style.cursor).toBe('crosshair')
    expect(host.childElementCount).toBe(0)
  })

  it('draws rulers from the overlay inset so ticks and guides stay on camera coordinates', () => {
    const host = document.createElement('div')
    Object.defineProperty(host, 'offsetTop', { value: 64 })
    Object.defineProperty(host, 'offsetLeft', { value: 0 })
    setHostRect(host, 100, 114)
    const context = createContextStub()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
    const onGuideCreate = vi.fn()
    const overlay = createRulerOverlay(host, { onGuideCreate })
    overlay.update({ frame: cameraFrame({ y: 0, scale: 10 }), chromeVisible: true, rulersVisible: true })

    const vertical = findPart<HTMLCanvasElement>(host, 'vertical')
    expect(vertical.height).toBe((324 - 64 - 24) * 2)
    // World 10 m sits at camera y 100, which is 12 px into the vertical ruler below the inset.
    const drawnYs = vi.mocked(context.moveTo).mock.calls.map(([, y]) => y)
    expect(drawnYs.some((y) => Math.abs(y - (100 - 64 - 24)) < 1e-6)).toBe(true)

    // A guide released at camera y 100 (the map host's screen) lands at world 10; the gutter ends below the inset.
    const press = pressRuler(findPart<HTMLCanvasElement>(host, 'horizontal'))
    press?.createGuideAt({ x: 80, y: 64 + 24 })
    press?.createGuideAt({ x: 80, y: 100 })
    expect(onGuideCreate).toHaveBeenCalledExactlyOnceWith('h', 10)
    overlay.destroy()
  })

  it('draws tick labels at 12 px or more and leaves out labels that would touch', () => {
    const host = document.createElement('div')
    const context = createContextStub()
    const fonts: string[] = []
    vi.mocked(context.fillText).mockImplementation(() => { fonts.push(context.font) })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
    const overlay = createRulerOverlay(host, { onGuideCreate: vi.fn() })

    for (const scale of [0.12, 0.9, 3, 17, 60, 240, 900, 1900]) {
      vi.mocked(context.fillText).mockClear()
      fonts.length = 0
      overlay.update({
        frame: cameraFrame({ scale, width: 1400 }),
        chromeVisible: true,
        rulersVisible: true,
      })
      expect(fonts.length).toBeGreaterThan(0)
      for (const font of fonts) expect(Number.parseFloat(font)).toBeGreaterThanOrEqual(12)
      const horizontal = vi.mocked(context.fillText).mock.calls
        .filter(([, , y]) => y !== 0)
        .map(([text, x]) => ({ start: x - text.length * 3.5, end: x + text.length * 3.5 }))
        .sort((a, b) => a.start - b.start)
      for (let index = 1; index < horizontal.length; index += 1) {
        expect(horizontal[index]!.start).toBeGreaterThanOrEqual(horizontal[index - 1]!.end)
      }
    }
    overlay.destroy()
  })

  it('ticks every metre on a camera placed at exactly 15 px/m, though its scale reads back a hair under', () => {
    const host = document.createElement('div')
    const context = createContextStub()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
    const overlay = createRulerOverlay(host, { onGuideCreate: vi.fn() })
    const plane = createSessionPlane({ lon: 2.3522, lat: 48.8566 })
    const labelsAt = (zoom: number): string[] => {
      vi.mocked(context.fillText).mockClear()
      const frame = testViewFrame({ plane, screen: { width: 424, height: 324 }, camera: { zoom } })
      overlay.update({ frame, chromeVisible: true, rulersVisible: true })
      return vi.mocked(context.fillText).mock.calls.map(([text]) => text)
    }

    const placed = stageScaleToMapZoom(15, plane.origin.lat)
    expect(mapZoomToStageScale(placed, plane.origin.lat)).toBeLessThan(15)
    // A 1 m tick labels every 5 m; a 2 m tick labels every 10 m.
    expect(labelsAt(placed)).toContain('5m')
    expect(labelsAt(stageScaleToMapZoom(14.99, plane.origin.lat))).not.toContain('5m')
    overlay.destroy()
  })

  it('owns visibility and dpr-aware sizing without exposing raw lifecycle parts', () => {
    const host = document.createElement('div')
    const ctx = createContextStub()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
    const overlay = createRulerOverlay(host, { onGuideCreate: vi.fn() })

    overlay.update({
      frame: cameraFrame({ width: 424, height: 324, scale: 8 }),
      chromeVisible: true,
      rulersVisible: false,
    })

    const horizontal = findPart<HTMLCanvasElement>(host, 'horizontal')
    const vertical = findPart<HTMLCanvasElement>(host, 'vertical')
    const corner = findPart<HTMLDivElement>(host, 'corner')
    expect(horizontal.style.display).toBe('none')
    expect(vertical.style.display).toBe('none')
    expect(corner.style.display).toBe('none')
    expect(horizontal.width).toBe(800)
    expect(horizontal.height).toBe(48)
    expect(vertical.width).toBe(48)
    expect(vertical.height).toBe(600)
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)

    overlay.update({
      frame: cameraFrame(),
      chromeVisible: false,
      rulersVisible: true,
    })
    expect(horizontal.style.display).toBe('none')
    expect(vertical.style.display).toBe('none')
    expect(corner.style.display).toBe('none')
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
      frame: cameraFrame(),
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
