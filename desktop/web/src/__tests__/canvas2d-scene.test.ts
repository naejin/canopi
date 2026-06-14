import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCanvas2DSceneRenderer } from '../canvas/runtime/renderers/canvas2d-scene'
import type { SceneRendererSnapshot } from '../canvas/runtime/renderers/scene-types'

describe('createCanvas2DSceneRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies text annotation rotation in screen space', async () => {
    const ctx = createMockCanvasContext()
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext') as unknown as {
      mockImplementation(implementation: (contextId: string) => CanvasRenderingContext2D | null): void
    }
    getContextSpy.mockImplementation((contextId: string) => {
      return contextId === '2d' ? ctx as unknown as CanvasRenderingContext2D : null
    })

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = await createCanvas2DSceneRenderer().initialize({ container: host }, {
      backendId: 'canvas2d',
      capabilities: {
        domCanvas: true,
        canvas2d: true,
        offscreenCanvas: false,
        offscreenCanvas2d: false,
        webgl: false,
        webgl2: false,
        webgpu: false,
        imageBitmap: false,
        createImageBitmap: false,
        worker: false,
        devicePixelRatio: 1,
        prefersReducedMotion: null,
      },
    } as never)

    const snapshot: SceneRendererSnapshot = {
      scene: {
        plants: [],
        zones: [],
        annotations: [{
          kind: 'annotation',
          locked: false,
          id: 'annotation-1',
          annotationType: 'text',
          position: { x: 25, y: 35 },
          text: 'Hello',
          fontSize: 16,
          rotationDeg: 90,
        }],
        groups: [],
        layers: [],
        plantSpeciesColors: {},
        plantSpeciesSymbols: {},
        guides: [],
      },
      viewport: { x: 10, y: 20, scale: 2 },
      selectedPlantIds: new Set<string>(),
      selectedZoneIds: new Set<string>(),
      selectedAnnotationIds: new Set<string>(),
      highlightedPlantIds: new Set<string>(),
      highlightedZoneIds: new Set<string>(),
      sizeMode: 'default',
      colorByAttr: null,
      localizedCommonNames: new Map(),
      hoveredCanonicalName: null,
      selectionLabels: [],
      speciesCache: new Map(),
    }

    renderer.renderScene(snapshot)

    expect(ctx.translate).toHaveBeenCalledWith(60, 90)
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2)
    expect(ctx.fillText).toHaveBeenCalledWith('Hello', 0, 0)
    renderer.dispose()
  })
})

function createMockCanvasContext() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    ellipse: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    rotate: vi.fn(),
    getTransform: vi.fn(() => ({ a: 1 })),
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
  }
}
