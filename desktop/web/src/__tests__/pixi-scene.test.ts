import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SceneRendererSnapshot } from '../canvas/runtime/renderers/scene-types'

vi.mock('pixi.js', () => {
  const state = {
    apps: [] as MockApplication[],
    containers: [] as MockContainer[],
    graphics: [] as MockGraphics[],
    texts: [] as MockText[],
  }

  class MockContainer {
    children: unknown[] = []
    visible = true
    alpha = 1
    position = { set: vi.fn() }
    scale = { set: vi.fn() }
    addChild(...children: unknown[]) {
      this.children.push(...children)
      return children[0]
    }
    removeChildren = vi.fn(() => {
      this.children = []
    })
    constructor() {
      state.containers.push(this)
    }
  }

  class MockGraphics {
    visible = true
    clear = vi.fn(() => this)
    circle = vi.fn(() => this)
    rect = vi.fn(() => this)
    ellipse = vi.fn(() => this)
    moveTo = vi.fn(() => this)
    lineTo = vi.fn(() => this)
    closePath = vi.fn(() => this)
    fill = vi.fn(() => this)
    stroke = vi.fn(() => this)
    removeFromParent = vi.fn()
    destroy = vi.fn()
    constructor() {
      state.graphics.push(this)
    }
  }

  class MockText {
    visible = true
    alpha = 1
    text = ''
    style: unknown = {}
    anchor = { set: vi.fn() }
    position = { set: vi.fn() }
    scale = { set: vi.fn() }
    removeFromParent = vi.fn()
    destroy = vi.fn()
    constructor() {
      state.texts.push(this)
    }
  }

  class MockApplication {
    canvas = document.createElement('canvas')
    stage = new MockContainer()
    renderer = { resize: vi.fn() }
    init = vi.fn(async () => {})
    render = vi.fn()
    destroy = vi.fn()
    constructor() {
      state.apps.push(this)
    }
  }

  class MockTextStyle {
    constructor(public readonly options: Record<string, unknown>) {}
  }

  return {
    Application: MockApplication,
    Container: MockContainer,
    Graphics: MockGraphics,
    Text: MockText,
    TextStyle: MockTextStyle,
    __pixiMockState: state,
  }
})

describe('createPixiSceneRenderer', () => {
  beforeEach(async () => {
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        apps: unknown[]
        containers: unknown[]
        graphics: unknown[]
        texts: unknown[]
      }
    }
    pixi.__pixiMockState.apps.length = 0
    pixi.__pixiMockState.containers.length = 0
    pixi.__pixiMockState.graphics.length = 0
    pixi.__pixiMockState.texts.length = 0
  })

  it('retains plant and annotation display objects across viewport updates', async () => {
    const { createPixiSceneRenderer } = await import('../canvas/runtime/renderers/pixi-scene')
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        apps: Array<{ render: ReturnType<typeof vi.fn> }>
        containers: Array<{ removeChildren: ReturnType<typeof vi.fn> }>
        graphics: unknown[]
        texts: unknown[]
      }
    }

    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    const renderer = await createPixiSceneRenderer().initialize({ container: host }, {
      backendId: 'pixi',
      capabilities: {
        domCanvas: true,
        canvas2d: true,
        offscreenCanvas: false,
        offscreenCanvas2d: false,
        webgl: true,
        webgl2: true,
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
        version: 1,
        name: 'Renderer test',
        description: null,
        location: null,
        northBearingDeg: 0,
        plants: [{
          kind: 'plant',
          id: 'plant-1',
          canonicalName: 'Malus domestica',
          commonName: 'Apple',
          color: null,
          stratum: 'mid',
          canopySpreadM: 3,
          position: { x: 10, y: 20 },
          rotationDeg: null,
          scale: 3,
          notes: null,
          plantedDate: null,
          quantity: 1,
        }],
        zones: [],
        annotations: [{
          kind: 'annotation',
          id: 'annotation-1',
          annotationType: 'text',
          position: { x: 25, y: 35 },
          text: 'Hello',
          fontSize: 16,
          rotationDeg: null,
        }],
        groups: [],
        layers: [],
        plantSpeciesColors: {},
        consortiums: [],
        createdAt: '2026-04-02T00:00:00.000Z',
        updatedAt: '2026-04-02T00:00:00.000Z',
        extra: {},
      },
      viewport: { x: 0, y: 0, scale: 1 },
      selectedPlantIds: new Set<string>(),
      selectedZoneIds: new Set<string>(),
      selectedAnnotationIds: new Set<string>(['annotation-1']),
      sizeMode: 'default' as const,
      colorByAttr: null,
      localizedCommonNames: new Map(),
      hoveredCanonicalName: null,
      selectionLabels: [],
      speciesCache: new Map(),
    }

    renderer.renderScene(snapshot)

    const graphicsAfterSceneRender = pixi.__pixiMockState.graphics.length
    const textsAfterSceneRender = pixi.__pixiMockState.texts.length
    const removeChildrenCallsAfterSceneRender = pixi.__pixiMockState.containers
      .reduce((count, container) => count + container.removeChildren.mock.calls.length, 0)

    renderer.setViewport({ x: 15, y: 25, scale: 1.5 })

    expect(pixi.__pixiMockState.graphics).toHaveLength(graphicsAfterSceneRender)
    expect(pixi.__pixiMockState.texts).toHaveLength(textsAfterSceneRender)
    expect(
      pixi.__pixiMockState.containers
        .reduce((count, container) => count + container.removeChildren.mock.calls.length, 0),
    ).toBe(removeChildrenCallsAfterSceneRender)
    expect(pixi.__pixiMockState.apps[0]?.render).toHaveBeenCalledTimes(2)

    renderer.dispose()
  })
})
