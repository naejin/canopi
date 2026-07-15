import { signal, type Signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentCanvasSession } from '../canvas/session'
import type { CameraViewportSnapshot } from '../canvas/runtime/camera'
import { ZoomControls } from '../components/canvas/ZoomControls'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

describe('ZoomControls', () => {
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

  it('reads zoom percentage from the canonical viewport snapshot', async () => {
    const viewport = signal<CameraViewportSnapshot>({
      viewport: { x: 0, y: 0, scale: 8 },
      screenSize: { width: 800, height: 600 },
      referenceScale: 8,
      revision: 1,
    })
    const queries = {
      ...createTestCanvasQuerySurface(),
      viewport,
    } as ReturnType<typeof createTestCanvasQuerySurface> & {
      readonly viewport: Signal<CameraViewportSnapshot>
    }
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ queries }))

    await act(async () => {
      render(<ZoomControls />, container)
      await Promise.resolve()
    })
    expect(container.textContent).toContain('100%')

    await act(async () => {
      viewport.value = {
        ...viewport.value,
        viewport: { ...viewport.value.viewport, scale: 12 },
        revision: 2,
      }
      await Promise.resolve()
    })

    expect(container.textContent).toContain('150%')
  })

  it('keeps zoom writes on the focused command surface', async () => {
    const zoomIn = vi.fn()
    const zoomOut = vi.fn()
    const zoomToFit = vi.fn()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        viewport: { zoomIn, zoomOut, zoomToFit },
      }),
    }))

    await act(async () => {
      render(<ZoomControls />, container)
      await Promise.resolve()
    })

    const button = (label: string) => container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    )!
    button('Zoom in').click()
    button('Zoom out').click()
    button('Fit to content').click()

    expect(zoomIn).toHaveBeenCalledOnce()
    expect(zoomOut).toHaveBeenCalledOnce()
    expect(zoomToFit).toHaveBeenCalledOnce()
  })
})
