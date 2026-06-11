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
    rotation = 0
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
        plants: [{
          kind: 'plant',
          locked: false,
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
          locked: false,
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
        guides: [],
      },
      viewport: { x: 0, y: 0, scale: 1 },
      selectedPlantIds: new Set<string>(),
      selectedZoneIds: new Set<string>(),
      selectedAnnotationIds: new Set<string>(['annotation-1']),
      highlightedPlantIds: new Set<string>(),
      highlightedZoneIds: new Set<string>(),
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

  it('applies text annotation rotation in world space', async () => {
    const { createPixiSceneRenderer } = await import('../canvas/runtime/renderers/pixi-scene')
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        texts: Array<{
          text: string
          rotation: number
          position: { set: ReturnType<typeof vi.fn> }
        }>
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
        guides: [],
      },
      viewport: { x: 10, y: 20, scale: 2 },
      selectedPlantIds: new Set<string>(),
      selectedZoneIds: new Set<string>(),
      selectedAnnotationIds: new Set<string>(),
      highlightedPlantIds: new Set<string>(),
      highlightedZoneIds: new Set<string>(),
      sizeMode: 'default' as const,
      colorByAttr: null,
      localizedCommonNames: new Map(),
      hoveredCanonicalName: null,
      selectionLabels: [],
      speciesCache: new Map(),
    }

    renderer.renderScene(snapshot)

    const annotationText = pixi.__pixiMockState.texts.find((text) => text.text === 'Hello')
    expect(annotationText?.position.set).toHaveBeenCalledWith(25, 35)
    expect(annotationText?.rotation).toBeCloseTo(Math.PI / 2)
    renderer.dispose()
  })

  it('renders elliptical zones from center and radii geometry', async () => {
    const { createPixiSceneRenderer } = await import('../canvas/runtime/renderers/pixi-scene')
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{ ellipse: ReturnType<typeof vi.fn> }>
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
        plants: [],
        zones: [{
          kind: 'zone',
          locked: false,
          name: 'ellipse-1',
          zoneType: 'ellipse',
          points: [
            { x: 50, y: 60 },
            { x: 30, y: 20 },
          ],
          rotationDeg: 0,
          fillColor: null,
          notes: null,
        }],
        annotations: [],
        groups: [],
        layers: [],
        plantSpeciesColors: {},
        guides: [],
      },
      viewport: { x: 0, y: 0, scale: 1 },
      selectedPlantIds: new Set<string>(),
      selectedZoneIds: new Set<string>(),
      selectedAnnotationIds: new Set<string>(),
      highlightedPlantIds: new Set<string>(),
      highlightedZoneIds: new Set<string>(),
      sizeMode: 'default' as const,
      colorByAttr: null,
      localizedCommonNames: new Map(),
      hoveredCanonicalName: null,
      selectionLabels: [],
      speciesCache: new Map(),
    }

    renderer.renderScene(snapshot)

    const ellipseGraphic = pixi.__pixiMockState.graphics.find((graphics) => graphics.ellipse.mock.calls.length > 0)
    expect(ellipseGraphic?.ellipse).toHaveBeenCalledWith(50, 60, 30, 20)
    renderer.dispose()
  })

  it('renders rotated rectangular zones as oriented paths', async () => {
    const { createPixiSceneRenderer } = await import('../canvas/runtime/renderers/pixi-scene')
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{
          rect: ReturnType<typeof vi.fn>
          moveTo: ReturnType<typeof vi.fn>
          lineTo: ReturnType<typeof vi.fn>
        }>
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
        plants: [],
        zones: [{
          kind: 'zone',
          locked: false,
          name: 'zone-1',
          zoneType: 'rect',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 4 },
            { x: 0, y: 4 },
          ],
          rotationDeg: 90,
          fillColor: null,
          notes: null,
        }],
        annotations: [],
        groups: [],
        layers: [],
        plantSpeciesColors: {},
        guides: [],
      },
      viewport: { x: 0, y: 0, scale: 1 },
      selectedPlantIds: new Set<string>(),
      selectedZoneIds: new Set<string>(),
      selectedAnnotationIds: new Set<string>(),
      highlightedPlantIds: new Set<string>(),
      highlightedZoneIds: new Set<string>(),
      sizeMode: 'default' as const,
      colorByAttr: null,
      localizedCommonNames: new Map(),
      hoveredCanonicalName: null,
      selectionLabels: [],
      speciesCache: new Map(),
    }

    renderer.renderScene(snapshot)

    const zoneGraphic = pixi.__pixiMockState.graphics.find((graphics) =>
      graphics.rect.mock.calls.length > 0 || graphics.moveTo.mock.calls.length > 0,
    )
    expect(zoneGraphic).toBeDefined()
    expect(zoneGraphic?.rect).not.toHaveBeenCalled()
    expect(zoneGraphic?.moveTo).toHaveBeenCalledWith(7, -3)
    expect(zoneGraphic?.lineTo).toHaveBeenCalledWith(7, 7)
    expect(zoneGraphic?.lineTo).toHaveBeenCalledWith(3, 7)
    expect(zoneGraphic?.lineTo).toHaveBeenCalledWith(3, -3)
    renderer.dispose()
  })

  it('keeps zone and plant strokes screen-readable across viewport scale', async () => {
    const { createPixiSceneRenderer } = await import('../canvas/runtime/renderers/pixi-scene')
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{
          rect: ReturnType<typeof vi.fn>
          circle: ReturnType<typeof vi.fn>
          stroke: ReturnType<typeof vi.fn>
        }>
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
        plants: [{
          kind: 'plant',
          locked: false,
          id: 'plant-1',
          canonicalName: 'Malus domestica',
          commonName: 'Apple',
          color: null,
          stratum: 'mid',
          canopySpreadM: null,
          position: { x: 10, y: 20 },
          rotationDeg: null,
          scale: null,
          notes: null,
          plantedDate: null,
          quantity: 1,
        }],
        zones: [{
          kind: 'zone',
          locked: false,
          name: 'zone-1',
          zoneType: 'rect',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
          rotationDeg: 0,
          fillColor: null,
          notes: null,
        }],
        annotations: [],
        groups: [],
        layers: [],
        plantSpeciesColors: {},
        guides: [],
      },
      viewport: { x: 0, y: 0, scale: 4 },
      selectedPlantIds: new Set<string>(['plant-1']),
      selectedZoneIds: new Set<string>(['zone-1']),
      selectedAnnotationIds: new Set<string>(),
      highlightedPlantIds: new Set<string>(),
      highlightedZoneIds: new Set<string>(),
      sizeMode: 'default' as const,
      colorByAttr: null,
      localizedCommonNames: new Map(),
      hoveredCanonicalName: null,
      selectionLabels: [],
      speciesCache: new Map(),
    }

    renderer.renderScene(snapshot)

    const zoneGraphic = pixi.__pixiMockState.graphics.find((graphics) => graphics.rect.mock.calls.length > 0)
    const plantGraphic = pixi.__pixiMockState.graphics.find((graphics) => graphics.circle.mock.calls.length > 0)
    expect(zoneGraphic?.stroke.mock.calls[0]?.[0]).toMatchObject({ width: 1.125 })
    expect(plantGraphic?.stroke.mock.calls[0]?.[0]).toMatchObject({ width: 1.125 })

    renderer.setViewport({ x: 0, y: 0, scale: 2 })

    expect(zoneGraphic?.stroke.mock.calls.slice(-1)[0]?.[0]).toMatchObject({ width: 2.25 })
    expect(plantGraphic?.stroke.mock.calls.slice(-1)[0]?.[0]).toMatchObject({ width: 2.25 })
    renderer.dispose()
  })

  it('renders selected zones with stronger ochre strokes than hover highlights', async () => {
    const { createPixiSceneRenderer } = await import('../canvas/runtime/renderers/pixi-scene')
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{
          rect: ReturnType<typeof vi.fn>
          stroke: ReturnType<typeof vi.fn>
        }>
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
        plants: [],
        zones: [
          {
            kind: 'zone',
            locked: false,
            name: 'selected-zone',
            zoneType: 'rect',
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
            rotationDeg: 0,
            fillColor: null,
            notes: null,
          },
          {
            kind: 'zone',
            locked: false,
            name: 'hover-zone',
            zoneType: 'rect',
            points: [
              { x: 20, y: 0 },
              { x: 30, y: 0 },
              { x: 30, y: 10 },
              { x: 20, y: 10 },
            ],
            rotationDeg: 0,
            fillColor: null,
            notes: null,
          },
        ],
        annotations: [],
        groups: [],
        layers: [],
        plantSpeciesColors: {},
        guides: [],
      },
      viewport: { x: 0, y: 0, scale: 1 },
      selectedPlantIds: new Set<string>(),
      selectedZoneIds: new Set<string>(['selected-zone']),
      selectedAnnotationIds: new Set<string>(),
      highlightedPlantIds: new Set<string>(),
      highlightedZoneIds: new Set<string>(['hover-zone']),
      sizeMode: 'default' as const,
      colorByAttr: null,
      localizedCommonNames: new Map(),
      hoveredCanonicalName: null,
      selectionLabels: [],
      speciesCache: new Map(),
    }

    renderer.renderScene(snapshot)

    const selectedGraphic = pixi.__pixiMockState.graphics
      .find((graphics) => graphics.rect.mock.calls[0]?.[0] === 0)
    const hoverGraphic = pixi.__pixiMockState.graphics
      .find((graphics) => graphics.rect.mock.calls[0]?.[0] === 20)
    const selectedStroke = selectedGraphic?.stroke.mock.calls[0]?.[0]
    const hoverStroke = hoverGraphic?.stroke.mock.calls[0]?.[0]

    expect(selectedStroke).toMatchObject({ color: 0xa06b1f })
    expect(selectedStroke.width).toBeGreaterThan(hoverStroke.width)
    expect(selectedStroke.alpha).toBeGreaterThan(hoverStroke.alpha)
    renderer.dispose()
  })
})
