import { signal } from '@preact/signals'
import { options, render, type VNode } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale } from '../app/settings/state'
import { workspaceCanvasCommandProjection } from '../app/workspace-commands/canvas-actions'
import { setCurrentCanvasSession } from '../canvas/session'
import type { ViewReadSurface } from '../canvas/runtime/view/read-surface'
import { createViewReadSurface } from '../canvas/runtime/view/frame-source'
import { createSessionPlane } from '../canvas/session-plane'
import { ZoomControls } from '../components/canvas/ZoomControls'
import { phoneLayout } from '../app/shell/phone-layout'
import { registerMapArea, visibleMapFrame } from '../app/shell/visible-map-area'
import { createTestCanvasQuerySurface, createTestViewReadSurface } from './support/canvas-query-surface'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'
import { createTestView } from './support/test-view'

/** The view at the Design default, 20 CSS px per metre, unless the test overrides its signals. */
function view(overrides: Partial<ViewReadSurface> = {}): ViewReadSurface {
  return { ...createTestViewReadSurface(), groundMetresPerPixel: signal(1 / 20), ...overrides }
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

  it('stands as a column of zoom in, zoom out, Fit and the compass on a phone, with no ratio, covering no edge of the map', async () => {
    const zoomToFit = vi.fn()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), view: view() },
      commands: createTestCanvasCommandSurface({ viewport: { zoomToFit } }),
    }))
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
      'Zoom in', 'Zoom out', 'Fit to Design', 'Reset north',
    ])
    expect(container.querySelector('[role="img"]')).toBeNull()
    // Fit is the desktop group's Fit to Design (and Home): the same command.
    button('Fit to Design').click()
    expect(zoomToFit).toHaveBeenCalledOnce()
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

  it('the compass is the last button of the registered zoom group', async () => {
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ queries: { ...createTestCanvasQuerySurface(), view: view() } }))
    const area = document.createElement('div')
    document.body.appendChild(area)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const box = this === area ? { left: 0, top: 0, width: 1200, height: 800 } : this.dataset.zoomGroup !== undefined ? { left: 700, top: 748, width: 488, height: 40 } : { left: 0, top: 0, width: 0, height: 0 }
      return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => ({}) } as DOMRect
    })
    const release = registerMapArea(area)
    await mount()
    const group = container.querySelector<HTMLElement>('[data-zoom-group]')!
    const buttons = [...group.querySelectorAll('button')]
    expect(buttons.map((element) => element.getAttribute('aria-label'))).toEqual([
      'Zoom out', 'Map scale 1:190. Choose a scale', 'Zoom in', 'Fit to Design', 'Reset north',
    ])
    expect(buttons.at(-1)!.hasAttribute('data-compass')).toBe(true)
    // It is a button of the group, which keeps the map's bottom edge clear; it registers nothing of its own.
    expect(visibleMapFrame.value.bottom).toBe(800 - 748)
    expect(buttons.at(-1)!.getAttribute('aria-keyshortcuts')).toBe('N Shift+N Shift+ArrowUp')
    release()
    area.remove()
    vi.restoreAllMocks()
  })

  it('shows the map scale as a ratio and a scale bar, the same whatever the window size', async () => {
    const plane = createSessionPlane({ lon: 0, lat: 0 })
    for (const screen of [{ width: 1000, height: 800 }, { width: 600, height: 400 }]) {
      const camera = createTestView({ plane, screen, viewport: { x: 0, y: 0, scale: 20 } })
      setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
        queries: { ...createTestCanvasQuerySurface(), view: createViewReadSurface(camera.frames) },
      }))
      await mount()
      expect(ratio().textContent).toBe('1:190')
      expect(ratio().getAttribute('aria-label')).toBe('Map scale 1:190. Choose a scale')
      expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Scale bar: 5 m')
      await act(async () => {
        camera.host.current().setScreen({ width: 1200, height: 900, devicePixelRatio: 1 })
        camera.setViewport({ x: 0, y: 0, scale: 10 })
      })
      expect(ratio().textContent).toBe('1:380')
      camera.dispose()
    }
  })

  it('an east-west pan at a constant zoom does not re-render the zoom group', async () => {
    // A17: groundMetresPerPixel reads the camera centre's latitude, so a north-south pan may re-render the group; an east-west one
    // keeps the ratio, the scale bar and the button tooltips still.
    const camera = createTestView({ plane: createSessionPlane({ lon: 2.35, lat: 48.85 }), screen: { width: 1000, height: 800 } })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), view: createViewReadSurface(camera.frames) },
    }))
    let renders = 0
    const previous = options.diffed
    options.diffed = (vnode: VNode) => {
      if (typeof vnode.type === 'function') renders++
      previous?.(vnode)
    }
    try {
      await mount()
      const label = ratio().textContent
      const lon = camera.view().camera.center.lon
      renders = 0
      for (const deltaX of [40, 120, -300, 75]) {
        await act(async () => { camera.navigation.panByPx({ x: deltaX, y: 0 }) })
      }
      expect(camera.view().camera.center.lon).not.toBeCloseTo(lon, 6)
      expect(renders).toBe(0)
      expect(ratio().textContent).toBe(label)
      // The count is live: a zoom re-renders the group.
      await act(async () => { camera.navigation.zoomAroundPx({ x: 500, y: 400 }, 2) })
      expect(renders).toBeGreaterThan(0)
    } finally {
      options.diffed = previous
      camera.dispose()
    }
  })

  it('formats the ratio and distance for the interface language', async () => {
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), view: view({ groundMetresPerPixel: signal(400) }) },
    }))
    locale.value = 'de'
    await mount()
    expect(ratio().textContent).toBe('1:1.500.000')
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('50 km')
  })

  it('offers common scales as a menu and zooms about the centre to the chosen one', async () => {
    const zoomBy = vi.fn()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), view: view() },
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
      queries: { ...createTestCanvasQuerySurface(), view: view() },
      commands: createTestCanvasCommandSurface({ viewport: { zoomIn, zoomOut, zoomToFit } }),
    }))
    await mount()

    button('Zoom in').click()
    button('Zoom out').click()
    button('Fit to Design').click()

    expect(zoomIn).toHaveBeenCalledOnce()
    expect(zoomOut).toHaveBeenCalledOnce()
    expect(zoomToFit).toHaveBeenCalledOnce()
    // Home fits too, with the map focused.
    expect(button('Fit to Design').getAttribute('aria-keyshortcuts')).toBe('Shift+F Control+0 Meta+0 Home')
  })

  it('shows the world scale in overview and disables exhausted navigation', async () => {
    const zoomOut = vi.fn()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: {
        ...createTestCanvasQuerySurface(),
        view: view({ mode: signal('overview'), groundMetresPerPixel: signal(50_000), zoomLimit: signal('min') }),
      },
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
