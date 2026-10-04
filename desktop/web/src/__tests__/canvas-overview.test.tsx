import { signal } from '@preact/signals'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createViewReadSurface } from '../canvas/runtime/view/frame-source'
import type { ViewReadSurface } from '../canvas/runtime/view/read-surface'
import type { ScreenPoint } from '../canvas/runtime/view/types'
import { createSessionPlane } from '../canvas/session-plane'
import { setCurrentCanvasSession } from '../canvas/session'
import { createTestCanvasCommandSurface, createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface, createTestViewReadSurface } from './support/canvas-query-surface'
import { createTestView, type TestView } from './support/test-view'

import { CanvasOverview } from '../components/canvas/CanvasOverview'

describe('CanvasOverview', () => {
  let container: HTMLDivElement
  let testView: TestView | null = null

  /** The view of a 400 x 300 map placed as today's viewport { x, y, scale }. */
  function overviewView(viewport: { x?: number; y?: number } = {}): ViewReadSurface {
    const plane = createSessionPlane({ lon: 0, lat: 0 })
    testView = createTestView({ plane, viewport: { x: 200, y: 150, scale: 0.01, ...viewport } })
    return createViewReadSurface(testView.frames)
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    setCurrentCanvasSession(null)
    testView?.dispose()
    testView = null
  })

  it('shows the Design as a named pin and offers one Return to Design action', async () => {
    const returnToDesign = vi.fn()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), view: overviewView() },
      commands: createTestCanvasCommandSurface({ viewport: { returnToDesign } }),
    }))

    await act(async () => render(<CanvasOverview />, container))
    const notice = container.querySelector('[data-overview-notice]')!
    expect(notice.getAttribute('role')).toBe('status')
    expect(notice.textContent).toContain('Zoom in to edit. Plants are hidden at this scale.')
    const pin = container.querySelector<HTMLElement>('[data-overview-pin]')!
    expect(pin.getAttribute('role')).toBe('img')
    expect(pin.getAttribute('aria-label')).toMatch(/^Design: /)
    expect(pin.style.left).toBe('200px')
    const buttons = container.querySelectorAll('button')
    expect([...buttons].map((button) => button.textContent)).toEqual(['Return to Design'])
    ;(buttons[0] as HTMLButtonElement).click()
    expect(returnToDesign).toHaveBeenCalledOnce()
  })

  it('omits an offscreen marker while retaining the notice action', async () => {
    const returnToDesign = vi.fn()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), view: overviewView({ x: -100 }) },
      commands: createTestCanvasCommandSurface({ viewport: { returnToDesign } }),
    }))

    await act(async () => render(<CanvasOverview />, container))
    expect(container.textContent).toContain('Zoom in to edit')
    expect(container.querySelector('[data-overview-pin]')).toBeNull()
    const returnButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Return to Design')
    returnButton?.click()
    expect(returnToDesign).toHaveBeenCalledOnce()
  })

  it('places the pin at ViewReadSurface.designPin', async () => {
    const designPin = signal<ScreenPoint | null>({ x: 123, y: 45 })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: {
        ...createTestCanvasQuerySurface(),
        view: { ...createTestViewReadSurface(), mode: signal('overview'), designPin },
      },
    }))

    await act(async () => render(<CanvasOverview />, container))
    const pin = container.querySelector<HTMLElement>('[data-overview-pin]')!
    expect([pin.style.left, pin.style.top]).toEqual(['123px', '45px'])

    await act(async () => { designPin.value = { x: 300, y: 200 } })
    expect([pin.style.left, pin.style.top]).toEqual(['300px', '200px'])

    // Within 24 px of an edge the surface publishes no pin; the notice stays.
    await act(async () => { designPin.value = null })
    expect(container.querySelector('[data-overview-pin]')).toBeNull()
    expect(container.querySelector('[data-overview-notice]')).not.toBeNull()
  })
})
