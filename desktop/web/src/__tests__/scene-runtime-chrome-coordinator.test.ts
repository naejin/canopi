import { beforeEach, describe, expect, it, vi } from 'vitest'
import './support/camera-tolerance'

import type { ViewFrame } from '../canvas/runtime/view/types'
import { testViewFrame } from './support/test-view'
import { pressRuler } from '../canvas/runtime/chrome/rulers'
import { SceneRuntimeChromeCoordinator } from '../canvas/runtime/scene-runtime/chrome-coordinator'
import { SceneRuntimePresentationController } from '../canvas/runtime/scene-runtime/presentation'
import { SceneStore } from '../canvas/runtime/scene'
import { getMapBackdropInk } from '../canvas/runtime/scene-visuals'

function cameraFrame(): ViewFrame {
  return testViewFrame({ screen: { width: 320, height: 240 }, viewport: { x: 10, y: 20, scale: 2 } })
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
      frame: cameraFrame(),
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
      frame: cameraFrame(),
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

    coordinator.update({ frame: cameraFrame(), rulersVisible: false, gridVisible: false, guidesVisible: false, guides })
    expect(grid().style.display).toBe('none')

    coordinator.update({ frame: cameraFrame(), rulersVisible: false, gridVisible: false, guidesVisible: true, guides })
    expect(grid().style.display).toBe('block')
    coordinator.destroy()
  })

  it('the grid and guides reach the workspace renderer and never a thumbnail', () => {
    const coordinator = new SceneRuntimeChromeCoordinator()
    coordinator.attach(document.createElement('div'), vi.fn())
    const presentation = new SceneRuntimePresentationController({
      sceneStore: new SceneStore(),
      readPixelsPerMetre: () => 2,
      getLocale: () => 'en',
      resolveHighlightedTargets: () => ({ plantIds: [], zoneIds: [] }),
      onPlantNamesChanged: vi.fn(),
    })
    const snapshot = {
      frame: cameraFrame(),
      rulersVisible: true,
      gridVisible: true,
      guidesVisible: true,
      guides: [{ id: 'guide-v', axis: 'v' as const, position: 10 }],
    }

    // Hidden chrome (a Design opening, a document replacement) draws no aids.
    expect(presentation.setEditingAids(coordinator.update(snapshot))).toBe(false)
    expect(presentation.buildRendererSnapshot().editingAids).toBeUndefined()

    coordinator.show()
    expect(presentation.setEditingAids(coordinator.update(snapshot))).toBe(true)
    // The same aids again change nothing, so a camera frame never re-syncs the scene.
    expect(presentation.setEditingAids(coordinator.update(snapshot))).toBe(false)
    const ink = getMapBackdropInk()
    expect(presentation.buildRendererSnapshot().editingAids).toEqual({
      grid: { ink: ink.grid, majorInk: ink.gridMajor },
      rulerGuides: [{ axis: 'v', position: 10 }],
    })

    // The overview, a saved view's or story's thumbnail and a presented story draw none.
    expect(presentation.buildRendererSnapshot({ overview: true }).editingAids).toBeUndefined()
    expect(presentation.buildViewCaptureSnapshot({
      overview: false, visibleLayerNames: ['plants'], focusedSpecies: null,
    }).editingAids).toBeUndefined()
    presentation.presentLayers(['plants'])
    expect(presentation.buildRendererSnapshot().editingAids).toBeUndefined()
    presentation.presentLayers(null)

    // Grid off and guides hidden: nothing to draw.
    expect(presentation.setEditingAids(coordinator.update({ ...snapshot, gridVisible: false, guidesVisible: false }))).toBe(true)
    expect(presentation.buildRendererSnapshot().editingAids).toBeUndefined()
    coordinator.destroy()
  })
})
