import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CameraViewportSnapshot } from '../canvas/runtime/camera'
import { SceneRuntimeChromeCoordinator } from '../canvas/runtime/scene-runtime/chrome-coordinator'

function cameraSnapshot(): CameraViewportSnapshot {
  return {
    viewport: { x: 10, y: 20, scale: 2 },
    screenSize: { width: 320, height: 240 },
    referenceScale: 2,
    revision: 1,
  }
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
    setLineDash: vi.fn(),
  }
}

function setHostRect(host: HTMLElement): void {
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
    x: 100,
    y: 50,
    left: 100,
    top: 50,
    right: 420,
    bottom: 290,
    width: 320,
    height: 240,
    toJSON: () => ({}),
  })
}

describe('SceneRuntimeChromeCoordinator', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      createContextStub() as never,
    )
  })

  it('cancels the predecessor drag before attaching a replacement overlay', () => {
    const firstHost = document.createElement('div')
    const secondHost = document.createElement('div')
    firstHost.style.cursor = 'crosshair'
    setHostRect(firstHost)
    setHostRect(secondHost)
    const firstGuideCreate = vi.fn()
    const secondGuideCreate = vi.fn()
    const coordinator = new SceneRuntimeChromeCoordinator()
    coordinator.attach(firstHost, firstGuideCreate)
    coordinator.show()
    coordinator.update({
      camera: cameraSnapshot(),
      rulersVisible: true,
      gridVisible: false,
      guides: [],
    })

    firstHost.querySelector<HTMLCanvasElement>('[data-ruler-overlay-part="horizontal"]')
      ?.dispatchEvent(new MouseEvent('mousedown', { clientX: 180, clientY: 60 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 180, clientY: 100 }))
    expect(firstHost.style.cursor).toBe('s-resize')

    coordinator.attach(secondHost, secondGuideCreate)
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 180, clientY: 150 }))

    expect(firstHost.style.cursor).toBe('crosshair')
    expect(firstHost.childElementCount).toBe(0)
    expect(firstGuideCreate).not.toHaveBeenCalled()

    coordinator.update({
      camera: cameraSnapshot(),
      rulersVisible: true,
      gridVisible: false,
      guides: [],
    })
    secondHost.querySelector<HTMLCanvasElement>('[data-ruler-overlay-part="vertical"]')
      ?.dispatchEvent(new MouseEvent('mousedown', { clientX: 110, clientY: 100 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 200, clientY: 150 }))

    expect(secondGuideCreate).toHaveBeenCalledWith('v', 45)
    coordinator.destroy()
    coordinator.destroy()
    expect(secondHost.childElementCount).toBe(0)
  })
})
