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

  it('offers one keyboard button at the visible Design origin and shares Return to Design', async () => {
    const returnToDesign = vi.fn()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), viewport: overviewFrame() },
      commands: createTestCanvasCommandSurface({ viewport: { returnToDesign } }),
    }))

    await act(async () => render(<CanvasOverview />, container))
    const marker = container.querySelector<HTMLButtonElement>('button[aria-label="Return to the Design"]')
    expect(marker).not.toBeNull()
    expect(container.querySelectorAll('button[aria-label="Return to the Design"]')).toHaveLength(1)
    marker?.click()
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
    expect(container.querySelector('[class*="overviewMarker"]')).toBeNull()
    const returnButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Return to Design')
    returnButton?.click()
    expect(returnToDesign).toHaveBeenCalledOnce()
  })
})
