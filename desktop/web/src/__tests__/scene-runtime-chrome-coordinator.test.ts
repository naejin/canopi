import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CameraViewportSnapshot } from '../canvas/runtime/camera'
import { pressRuler } from '../canvas/runtime/chrome/rulers'
import { SceneRuntimeChromeCoordinator } from '../canvas/runtime/scene-runtime/chrome-coordinator'

function cameraSnapshot(): CameraViewportSnapshot {
  return {
    viewport: { x: 10, y: 20, scale: 2 },
    screenSize: { width: 320, height: 240 },
    devicePixelRatio: 1,
    referenceScale: 2,
    scaleBounds: { minimum: 0.00001, maximum: 2000 },
    overviewScaleThreshold: 0.1,
    mode: 'site',
    groundMetersPerCssPixel: null,
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
      guidesVisible: true,
      guides: [],
    })

    // What the session does with a ruler press: the pressed ruler's guide port, dragged, then handed the release in
    // camera screen px (client 180, 150 on the map host at 100, 50).
    const firstPress = pressRuler(firstHost.querySelector<HTMLCanvasElement>('[data-ruler-overlay-part="horizontal"]'))
    firstPress?.drag()
    expect(firstHost.style.cursor).toBe('s-resize')

    coordinator.attach(secondHost, secondGuideCreate)
    firstPress?.end()
    firstPress?.createGuideAt('h', { x: 80, y: 100 })

    expect(firstHost.style.cursor).toBe('crosshair')
    expect(firstHost.childElementCount).toBe(0)
    expect(firstGuideCreate).not.toHaveBeenCalled()

    coordinator.update({
      camera: cameraSnapshot(),
      rulersVisible: true,
      gridVisible: false,
      guidesVisible: true,
      guides: [],
    })
    const secondPress = pressRuler(secondHost.querySelector<HTMLCanvasElement>('[data-ruler-overlay-part="vertical"]'))
    secondPress?.end()
    secondPress?.createGuideAt('v', { x: 100, y: 100 })

    expect(secondGuideCreate).toHaveBeenCalledWith('v', 45)
    coordinator.destroy()
    coordinator.destroy()
    expect(secondHost.childElementCount).toBe(0)
  })

  it('draws no ruler guides while the app hides them, and draws them again after', () => {
    const host = document.createElement('div')
    setHostRect(host)
    const coordinator = new SceneRuntimeChromeCoordinator()
    coordinator.attach(host, vi.fn())
    coordinator.show()
    const grid = () => host.querySelector<HTMLCanvasElement>('[data-scene-chrome-part="grid"]')!
    const guides = [{ id: 'guide-v', axis: 'v' as const, position: 10 }]

    coordinator.update({ camera: cameraSnapshot(), rulersVisible: false, gridVisible: false, guidesVisible: false, guides })
    expect(grid().style.display).toBe('none')

    coordinator.update({ camera: cameraSnapshot(), rulersVisible: false, gridVisible: false, guidesVisible: true, guides })
    expect(grid().style.display).toBe('block')
    coordinator.destroy()
  })
})
