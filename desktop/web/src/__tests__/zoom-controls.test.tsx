import { signal, type Signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentCanvasSession } from '../canvas/session'
import { CameraController, type CameraViewportSnapshot } from '../canvas/runtime/camera'
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

  it('shows the same magnification across different initial window sizes and reinitialization', async () => {
    const camera = new CameraController()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), viewport: camera.snapshot },
    }))
    for (const screen of [{ width: 1000, height: 800 }, { width: 600, height: 400 }]) {
      await act(async () => {
        camera.initialize(screen)
        camera.setViewport({ x: 0, y: 0, scale: 20 })
        render(<ZoomControls />, container)
      })
      expect(container.textContent).toContain('100%')
      await act(async () => {
        camera.resize({ width: 1200, height: 900 })
        camera.setViewport({ x: 0, y: 0, scale: 10 })
      })
      expect(container.textContent).toContain('50%')
    }
  })

  it('reads zoom percentage from the canonical viewport snapshot', async () => {
    const viewport = signal<CameraViewportSnapshot>({
      viewport: { x: 0, y: 0, scale: 8 },
      screenSize: { width: 800, height: 600 },
      devicePixelRatio: 1,
      referenceScale: 8,
      scaleBounds: { minimum: 0.00001, maximum: 2000 },
      overviewScaleThreshold: 0.1,
      mode: 'site',
      groundMetersPerCssPixel: null,
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

  it('shows overview at world scale and disables exhausted navigation', async () => {
    const returnToDesign = vi.fn()
    const viewport = signal<CameraViewportSnapshot>({
      viewport: { x: 100, y: 50, scale: 0.00002 },
      screenSize: { width: 800, height: 600 },
      devicePixelRatio: 1,
      referenceScale: 20,
      scaleBounds: { minimum: 0.00002, maximum: 2000 },
      overviewScaleThreshold: 0.1,
      mode: 'overview',
      groundMetersPerCssPixel: 50_000,
      revision: 1,
    })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), viewport },
      commands: createTestCanvasCommandSurface({ viewport: { returnToDesign } }),
    }))

    await act(async () => {
      render(<ZoomControls />, container)
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Overview')
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Zoom out"]')?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')?.disabled).toBe(false)
  })
})
