import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale } from '../app/settings/state'
import { workspaceCanvasCommandProjection } from '../app/workspace-commands/canvas-actions'
import { setCurrentCanvasSession } from '../canvas/session'
import { CameraController, type CameraViewportSnapshot } from '../canvas/runtime/camera'
import { ZoomControls } from '../components/canvas/ZoomControls'
import { phoneLayout } from '../app/shell/phone-layout'
import { registerMapArea, visibleMapFrame } from '../app/shell/visible-map-area'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

function frame(overrides: Partial<CameraViewportSnapshot> = {}): CameraViewportSnapshot {
  return {
    viewport: { x: 0, y: 0, scale: 20 },
    screenSize: { width: 800, height: 600 },
    devicePixelRatio: 1,
    referenceScale: 20,
    scaleBounds: { minimum: 0.00001, maximum: 2000 },
    overviewScaleThreshold: 0.1,
    mode: 'site',
    groundMetersPerCssPixel: null,
    revision: 1,
    ...overrides,
  }
}

describe('ZoomControls', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    locale.value = 'en'
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    setCurrentCanvasSession(null)
    locale.value = 'en'
    phoneLayout.value = null
  })

  it('stands as a column of zoom in, zoom out and the ratio on a phone, covering no edge of the map', async () => {
    const viewport = signal(frame())
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ queries: { ...createTestCanvasQuerySurface(), viewport } }))
    const area = document.createElement('div')
    document.body.appendChild(area)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const box = this === area ? { left: 0, top: 0, width: 390, height: 844 } : this.dataset.zoomGroup ? { left: 330, top: 500, width: 52, height: 150 } : { left: 0, top: 0, width: 0, height: 0 }
      return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => ({}) } as DOMRect
    })
    const release = registerMapArea(area)
    phoneLayout.value = 'portrait'
    await mount()
    const group = container.querySelector<HTMLElement>('[data-zoom-group]')!
    expect(group.dataset.zoomGroup).toBe('phone')
    expect([...group.querySelectorAll('button')].map((element) => element.getAttribute('aria-label'))).toEqual([
      'Zoom in', 'Zoom out', 'Map scale 1:190. Choose a scale',
    ])
    expect(container.querySelector('[role="img"]')).toBeNull()
    expect(visibleMapFrame.value).toMatchObject({ right: 0, bottom: 0 })

    await act(async () => { phoneLayout.value = null })
    expect(visibleMapFrame.value.bottom).toBeGreaterThan(0)
    release()
    area.remove()
    vi.restoreAllMocks()
  })

  const mount = async () => {
    await act(async () => {
      render(<ZoomControls viewActions={workspaceCanvasCommandProjection.value.viewActions} />, container)
      await Promise.resolve()
    })
  }
  const ratio = () => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
  const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!

  it('shows the map scale as a ratio and a scale bar, the same whatever the window size', async () => {
    const camera = new CameraController()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), viewport: camera.snapshot },
    }))
    for (const screen of [{ width: 1000, height: 800 }, { width: 600, height: 400 }]) {
      await act(async () => {
        camera.initialize(screen)
        camera.setViewport({ x: 0, y: 0, scale: 20 })
      })
      await mount()
      expect(ratio().textContent).toBe('1:190')
      expect(ratio().getAttribute('aria-label')).toBe('Map scale 1:190. Choose a scale')
      expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Scale bar: 5 m')
      await act(async () => {
        camera.resize({ width: 1200, height: 900 })
        camera.setViewport({ x: 0, y: 0, scale: 10 })
      })
      expect(ratio().textContent).toBe('1:380')
    }
  })

  it('formats the ratio and distance for the interface language', async () => {
    const viewport = signal(frame({ viewport: { x: 0, y: 0, scale: 0.0025 }, groundMetersPerCssPixel: 400 }))
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ queries: { ...createTestCanvasQuerySurface(), viewport } }))
    locale.value = 'de'
    await mount()
    expect(ratio().textContent).toBe('1:1.500.000')
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('50 km')
  })

  it('offers common scales as a menu and zooms about the centre to the chosen one', async () => {
    const zoomBy = vi.fn()
    const viewport = signal(frame())
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), viewport },
      commands: createTestCanvasCommandSurface({ viewport: { zoomBy } }),
    }))
    await mount()

    await act(async () => { ratio().click() })
    const items = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
    expect(items.map((item) => item.textContent)).toEqual([
      '1:100', '1:200', '1:500', '1:1,000', '1:2,000', '1:5,000', '1:10,000', '1:25,000',
    ])
    expect(document.activeElement).toBe(items[0])

    await act(async () => { items[3]!.click() })
    expect(zoomBy).toHaveBeenCalledOnce()
    expect(zoomBy.mock.calls[0]![0]).toBeCloseTo(0.189, 3)
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(ratio())
  })

  it('keeps zoom writes on the focused command surface', async () => {
    const zoomIn = vi.fn()
    const zoomOut = vi.fn()
    const zoomToFit = vi.fn()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), viewport: signal(frame()) },
      commands: createTestCanvasCommandSurface({ viewport: { zoomIn, zoomOut, zoomToFit } }),
    }))
    await mount()

    button('Zoom in').click()
    button('Zoom out').click()
    button('Fit to Design').click()

    expect(zoomIn).toHaveBeenCalledOnce()
    expect(zoomOut).toHaveBeenCalledOnce()
    expect(zoomToFit).toHaveBeenCalledOnce()
    expect(button('Fit to Design').getAttribute('aria-keyshortcuts')).toBe('Shift+F Control+0 Meta+0')
  })

  it('shows the world scale in overview and disables exhausted navigation', async () => {
    const zoomOut = vi.fn()
    const viewport = signal(frame({
      viewport: { x: 100, y: 50, scale: 0.00002 },
      scaleBounds: { minimum: 0.00002, maximum: 2000 },
      mode: 'overview',
      groundMetersPerCssPixel: 50_000,
    }))
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), viewport },
      commands: createTestCanvasCommandSurface({ viewport: { zoomOut } }),
    }))
    await mount()

    expect(ratio().textContent).toBe('1:190,000,000')
    expect(button('Zoom out').getAttribute('aria-disabled')).toBe('true')
    button('Zoom out').click()
    expect(zoomOut).not.toHaveBeenCalled()
    expect(button('Zoom in').getAttribute('aria-disabled')).toBeNull()
  })
})
