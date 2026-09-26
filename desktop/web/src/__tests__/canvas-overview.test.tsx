import { signal } from '@preact/signals'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraViewportSnapshot } from '../canvas/runtime/camera'
import { setCurrentCanvasSession } from '../canvas/session'
import { createTestCanvasCommandSurface, createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'

import { CanvasOverview } from '../components/canvas/CanvasOverview'

function overviewFrame(overrides: Partial<CameraViewportSnapshot['viewport']> = {}) {
  return signal<CameraViewportSnapshot>({
    viewport: { x: 200, y: 150, scale: 0.01, ...overrides },
    screenSize: { width: 400, height: 300 },
    devicePixelRatio: 1,
    referenceScale: 20,
    scaleBounds: { minimum: 0.00001, maximum: 2000 },
    overviewScaleThreshold: 0.1,
    mode: 'overview',
    groundMetersPerCssPixel: 100,
    revision: 1,
  })
}

describe('CanvasOverview', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    setCurrentCanvasSession(null)
  })

  it('shows the Design as a named pin and offers one Return to Design action', async () => {
    const returnToDesign = vi.fn()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), viewport: overviewFrame() },
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
      queries: { ...createTestCanvasQuerySurface(), viewport: overviewFrame({ x: -100 }) },
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
})
