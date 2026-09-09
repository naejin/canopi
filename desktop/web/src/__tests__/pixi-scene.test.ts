import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MEASUREMENT_GUIDE_LABEL_OFFSET_PX } from '../canvas/runtime/measurement-guides'
import type { SceneRendererSnapshot } from '../canvas/runtime/renderers/scene-types'
import { createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'
import { detectRendererCapabilities } from '../canvas/runtime/renderers/capabilities'

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
    bezierCurveTo = vi.fn(() => this)
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
    resolution: number | null
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
    constructor(options: { resolution?: number } = {}) {
      this.resolution = options.resolution ?? null
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

  it.each([1, 1.5, 2])('rasterizes every text role at twice DPR %s without enlarging text during zoom', async (dpr) => {
    const { createPixiSceneRenderer } = await import('../canvas/runtime/renderers/pixi-scene')
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: { texts: Array<{ text: string; resolution: number; style: { options: { fontSize: number; fontFamily: string } }; scale: { set: ReturnType<typeof vi.fn> } }> }
    }
    const renderer = await createPixiSceneRenderer().initialize({ container: document.createElement('div') }, {
      backendId: 'pixi', capabilities: { ...detectRendererCapabilities({}), devicePixelRatio: dpr },
    })
    try {
      renderer.renderScene(createTestSceneRendererSnapshot({
        scene: {
          plants: [createPlant({ id: 'a' }), createPlant({ id: 'b' })],
          annotations: [{ kind: 'annotation', annotationType: 'text', id: 'note', locked: false,
            position: { x: 1, y: 1 }, text: 'Érable 日本語', fontSize: 16, rotationDeg: 15 }],
          measurementGuides: [{ kind: 'measurement-guide', id: 'guide', locked: false,
            start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }],
        },
        viewport: { x: 0.35, y: 0.45, scale: 20 },
        pinnedPlantNameLabels: [{ plantId: 'a', text: 'Pinned name', fontStyle: 'normal', opacity: 1, screenPoint: { x: 10.35, y: 20.45 } }],
        selectionLabels: [{ canonicalName: 'Malus domestica', text: 'Selected name', fontStyle: 'italic', screenPoint: { x: 10.35, y: 30.45 } }],
      }))
      const texts = pixi.__pixiMockState.texts
      expect(texts.map(text => text.text)).toEqual(expect.arrayContaining(['2', 'Érable 日本語', 'Pinned name', 'Selected name']))
      expect(texts).toHaveLength(5)
      for (const scale of [0.1, 8, 14, 20, 63.75, 1000, 20]) {
        renderer.setViewport({ x: 0.35, y: 0.45, scale })
        for (const text of texts) {
          expect(text.resolution).toBe(dpr * 2)
          expect(text.style.options.fontFamily).toBe('Inter, sans-serif')
          expect(text.scale.set).not.toHaveBeenCalled()
        }
        expect(texts.find(text => text.text === 'Érable 日本語')?.style.options.fontSize).toBe(16)
      }
    } finally {
      renderer.dispose()
    }
  })

  it('refreshes pinned-name fading on zoom reversal while retaining readable font size', async () => {
    const { createPixiSceneRenderer } = await import('../canvas/runtime/renderers/pixi-scene')
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: { texts: Array<{ text: string; alpha: number; style: { options: { fontSize: number } }; destroy: ReturnType<typeof vi.fn> }> }
    }
    const host = document.createElement('div')
    const renderer = await createPixiSceneRenderer().initialize({ container: host }, {
      backendId: 'pixi', capabilities: { devicePixelRatio: 2 },
    } as never)
    renderer.renderScene(createRendererSnapshot({ plants: [createPlant({ pinnedName: true })] }))
    for (const [scale, opacity] of [[20, 1], [14, 0.5], [8, 0], [14, 0.5], [20, 1]]) {
      renderer.setViewport({ x: 0, y: 0, scale: scale! })
      const labels = pixi.__pixiMockState.texts.filter((text) => text.text === 'Apple' && !text.destroy.mock.calls.length)
      expect(labels).toHaveLength(opacity === 0 ? 0 : 1)
      if (opacity) {
        expect(labels[0]?.alpha).toBe(opacity)
        expect(labels[0]?.style.options.fontSize).toBe(12)
      }
    }
    renderer.dispose()
  })

  it('crossfades Annotation markers and text, and reveals only the direct selected note', async () => {
    const { createPixiSceneRenderer } = await import('../canvas/runtime/renderers/pixi-scene')
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: { texts: Array<{ text: string; alpha: number; visible: boolean; style: { options: { fontSize: number } } }>; graphics: Array<{ stroke: ReturnType<typeof vi.fn> }> }
    }
    const renderer = await createPixiSceneRenderer().initialize({ container: document.createElement('div') }, {
      backendId: 'pixi', capabilities: { devicePixelRatio: 2 },
    } as never)
    const snapshot = createTestSceneRendererSnapshot({ scene: {
      annotations: [{ kind: 'annotation', id: 'note', annotationType: 'text', locked: false,
        position: { x: 10, y: 20 }, text: 'First\nSecond', fontSize: 16, rotationDeg: 45 }],
    }, viewport: { x: 0, y: 0, scale: 20 } })
    renderer.renderScene(snapshot)
    for (const [scale, opacity] of [[20, 1], [14, 0.5], [8, 0], [14, 0.5], [20, 1]]) {
      renderer.setViewport({ x: 0, y: 0, scale: scale! })
      const text = pixi.__pixiMockState.texts.find((entry) => entry.text === 'First\nSecond')!
      expect(text.alpha).toBe(opacity)
      expect(text.visible).toBe(opacity! > 0)
      expect(text.style.options.fontSize).toBe(16)
      if (scale === 8) expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.stroke.mock.calls.some(([stroke]) => stroke.width === 1.5 && stroke.alpha === 1))).toBe(true)
    }
    renderer.renderScene({ ...snapshot, viewport: { x: 0, y: 0, scale: 4 }, revealedAnnotationId: 'note', selectedAnnotationIds: new Set(['note']) })
    expect(pixi.__pixiMockState.texts.find((entry) => entry.text === 'First\nSecond')).toMatchObject({ alpha: 1, visible: true })
    renderer.dispose()
  })

  it('renders precision glyphs and stack badges in CSS pixels at the detected density', async () => {
    const { createPixiSceneRenderer } = await import('../canvas/runtime/renderers/pixi-scene')
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        apps: Array<{ init: ReturnType<typeof vi.fn> }>;
        graphics: Array<{ circle: ReturnType<typeof vi.fn>; fill: ReturnType<typeof vi.fn> }>;
        texts: Array<{ text: string; style: { options: { fontSize: number } } }>;
      }
    }
    const renderer = await createPixiSceneRenderer().initialize({ container: document.createElement('div') }, {
      backendId: 'pixi', capabilities: { devicePixelRatio: 1.5 },
    } as never)
    expect(pixi.__pixiMockState.apps[0]?.init).toHaveBeenCalledWith(expect.objectContaining({ resolution: 1.5, autoDensity: true }))
    renderer.renderScene(createRendererSnapshot({
      plants: [createPlant({ id: 'a', symbol: 'round' }), createPlant({ id: 'b', symbol: 'round' })],
      viewport: { x: -9900, y: -9900, scale: 1000 },
    }))
    const circles = pixi.__pixiMockState.graphics.flatMap((graphics) => graphics.circle.mock.calls)
    expect(circles.some(([x, y, radius]) => x === 100 && y === 100 && radius > 6 && radius < 7)).toBe(true)
    expect(pixi.__pixiMockState.texts.find((text) => text.text === '2')?.style.options.fontSize).toBe(9)
    renderer.dispose()
  })

  it('preserves CSS Zone fill alpha when composing Layer opacity', async () => {
    const { createPixiSceneRenderer } = await import('../canvas/runtime/renderers/pixi-scene')
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: { graphics: Array<{ fill: ReturnType<typeof vi.fn> }>; containers: Array<{ alpha: number }> }
    }
    const renderer = await createPixiSceneRenderer().initialize({ container: document.createElement('div') }, {
      backendId: 'pixi', capabilities: { devicePixelRatio: 1 },
    } as never)
    renderer.renderScene(createTestSceneRendererSnapshot({ scene: {
      zones: [{ kind: 'zone', name: 'bed', zoneType: 'rect', locked: false, rotationDeg: 0,
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], fillColor: 'rgba(45, 95, 63, 0.1)', notes: null }],
      layers: [{ kind: 'layer', name: 'zones', visible: true, locked: false, opacity: 0.5 }],
    } }))
    const fills = pixi.__pixiMockState.graphics.flatMap((graphics) => graphics.fill.mock.calls)
    expect(fills[0]?.[0].alpha).toBeCloseTo(0.02)
    expect(pixi.__pixiMockState.containers.some((container) => container.alpha === 0.5)).toBe(true)
    renderer.dispose()
  })

  it('draws plant symbol glyphs at readable zoom and collapses them to dots at low zoom', async () => {
    const { createPixiSceneRenderer } = await import('../canvas/runtime/renderers/pixi-scene')
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{
          circle: ReturnType<typeof vi.fn>
          rect: ReturnType<typeof vi.fn>
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

    const snapshot = createRendererSnapshot({
      plants: [
        createPlant({ id: 'square', symbol: 'square', position: { x: 10, y: 10 } }),
        createPlant({ id: 'triangle', canonicalName: 'Pyrus communis', position: { x: 30, y: 10 } }),
      ],
      plantSpeciesSymbols: { 'Pyrus communis': 'triangle' },
      viewport: { x: 0, y: 0, scale: 20 },
    })

    renderer.renderScene(snapshot)

    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.rect.mock.calls.length > 0)).toBe(true)
    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.lineTo.mock.calls.length > 0)).toBe(true)

    vi.clearAllMocks()
    renderer.renderScene({
      ...snapshot,
      viewport: { x: 0, y: 0, scale: 0.25 },
    })

    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.circle.mock.calls.length > 0)).toBe(true)
    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.rect.mock.calls.length > 0)).toBe(false)
    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.lineTo.mock.calls.length > 0)).toBe(false)
    renderer.dispose()
  })

  it('draws curved plant symbol recipes with native Pixi curves', async () => {
    const { createPixiSceneRenderer } = await import('../canvas/runtime/renderers/pixi-scene')
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{
          bezierCurveTo: ReturnType<typeof vi.fn>
          fill: ReturnType<typeof vi.fn>
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

    renderer.renderScene(createRendererSnapshot({
      plants: [
        createPlant({ id: 'shrub', symbol: 'shrub', position: { x: 10, y: 10 } }),
        createPlant({ id: 'groundcover', symbol: 'groundcover', position: { x: 30, y: 10 } }),
      ],
      viewport: { x: 0, y: 0, scale: 20 },
    }))

    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.bezierCurveTo.mock.calls.length > 0)).toBe(true)
    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.fill.mock.calls.length > 0)).toBe(true)
    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.stroke.mock.calls.length > 0)).toBe(true)
    renderer.dispose()
  })

  it('renders Measurement Guides with screen-space distance labels and layer visibility', async () => {
    const { createPixiSceneRenderer } = await import('../canvas/runtime/renderers/pixi-scene')
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{
          moveTo: ReturnType<typeof vi.fn>
          lineTo: ReturnType<typeof vi.fn>
          stroke: ReturnType<typeof vi.fn>
        }>
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

    const snapshot = createRendererSnapshot({
      measurementGuides: [{
        kind: 'measurement-guide',
        id: 'guide-1',
        locked: false,
        start: { x: 40, y: 10 },
        end: { x: 10, y: 40 },
      }],
      layers: [{ kind: 'layer', name: 'measurement-guides', visible: true, locked: false, opacity: 1 }],
      viewport: { x: 0, y: 0, scale: 2 },
    })

    renderer.renderScene(snapshot)

    const guideGraphic = pixi.__pixiMockState.graphics.find((graphics) =>
      graphics.moveTo.mock.calls.some(([x, y]) => x === 40 && y === 10)
      && graphics.lineTo.mock.calls.some(([x, y]) => x === 10 && y === 40),
    )
    expect(guideGraphic?.stroke.mock.calls[0]?.[0]).toMatchObject({ width: 0.4, alpha: .25 })
    const label = pixi.__pixiMockState.texts.find((text) => text.text === '42 m')
    const expectedLabelPoint = {
      x: 50 - MEASUREMENT_GUIDE_LABEL_OFFSET_PX * Math.SQRT1_2,
      y: 50 - MEASUREMENT_GUIDE_LABEL_OFFSET_PX * Math.SQRT1_2,
    }
    const labelPositionCall = label?.position.set.mock.calls[0]
    expect(labelPositionCall?.[0]).toBeCloseTo(expectedLabelPoint.x)
    expect(labelPositionCall?.[1]).toBeCloseTo(expectedLabelPoint.y)
    expect(label?.rotation).toBeCloseTo(-Math.PI / 4)

    vi.clearAllMocks()
    renderer.renderScene({
      ...snapshot,
      scene: {
        ...snapshot.scene,
        layers: [{ kind: 'layer', name: 'measurement-guides', visible: false, locked: false, opacity: 1 }],
      },
    })

    expect(pixi.__pixiMockState.graphics.some((graphics) => graphics.lineTo.mock.calls.length > 0)).toBe(false)
    expect(pixi.__pixiMockState.texts.some((text) => text.position.set.mock.calls.length > 0)).toBe(false)
    renderer.dispose()
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

    const snapshot = createTestSceneRendererSnapshot({
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
      },
      selectedTargets: [{ kind: 'annotation', id: 'annotation-1' }],
    })

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

  it('applies text annotation rotation in screen space', async () => {
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

    const snapshot = createTestSceneRendererSnapshot({
      scene: {
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
      },
      viewport: { x: 10, y: 20, scale: 2 },
    })

    renderer.renderScene(snapshot)

    const annotationText = pixi.__pixiMockState.texts.find((text) => text.text === 'Hello')
    expect(annotationText?.position.set).toHaveBeenCalledWith(60, 90)
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

    const snapshot = createTestSceneRendererSnapshot({
      scene: {
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
      },
    })

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

    const snapshot = createTestSceneRendererSnapshot({
      scene: {
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
      },
    })

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

  it('uses interaction stroke alpha for rotated Pixi zones', async () => {
    const { createPixiSceneRenderer } = await import('../canvas/runtime/renderers/pixi-scene')
    const pixi = await import('pixi.js') as unknown as {
      __pixiMockState: {
        graphics: Array<{
          moveTo: ReturnType<typeof vi.fn>
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

    const snapshot = createTestSceneRendererSnapshot({
      scene: {
        zones: [
          {
            kind: 'zone',
            locked: false,
            name: 'rotated-rect',
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
          },
          {
            kind: 'zone',
            locked: false,
            name: 'rotated-ellipse',
            zoneType: 'ellipse',
            points: [
              { x: 40, y: 40 },
              { x: 8, y: 4 },
            ],
            rotationDeg: 45,
            fillColor: null,
            notes: null,
          },
        ],
      },
      highlightedZoneIds: new Set<string>(['rotated-rect', 'rotated-ellipse']),
    })

    renderer.renderScene(snapshot)

    const rotatedZoneStrokes = pixi.__pixiMockState.graphics
      .filter((graphics) => graphics.moveTo.mock.calls.length > 0)
      .map((graphics) => graphics.stroke.mock.calls[0]?.[0])

    expect(rotatedZoneStrokes).toHaveLength(2)
    for (const stroke of rotatedZoneStrokes) expect(stroke?.alpha).toBeCloseTo(0.72 * 0.62)
    renderer.dispose()
  })

  it('keeps colliding Zone and Plant selection strokes typed and screen-readable', async () => {
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

    const snapshot = createTestSceneRendererSnapshot({
      scene: {
        plants: [{
          kind: 'plant',
          locked: false,
          id: 'shared-id',
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
          name: 'shared-id',
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
      },
      viewport: { x: 0, y: 0, scale: 4 },
      selectedTargets: [{ kind: 'zone', id: 'shared-id' }],
    })

    renderer.renderScene(snapshot)

    const zoneGraphic = pixi.__pixiMockState.graphics.find((graphics) => graphics.rect.mock.calls.length > 0)
    const plantGraphic = pixi.__pixiMockState.graphics.find((graphics) => graphics.circle.mock.calls.length > 0)
    expect(zoneGraphic?.stroke.mock.calls[0]?.[0]).toMatchObject({ width: 1.125 })
    expect(plantGraphic?.stroke).not.toHaveBeenCalled()

    renderer.setViewport({ x: 0, y: 0, scale: 2 })

    expect(zoneGraphic?.stroke.mock.calls.slice(-1)[0]?.[0]).toMatchObject({ width: 2.25 })
    expect(plantGraphic?.stroke).not.toHaveBeenCalled()

    renderer.renderScene(createTestSceneRendererSnapshot({
      scene: snapshot.scene,
      viewport: { x: 0, y: 0, scale: 4 },
      selectedTargets: [
        { kind: 'zone', id: 'shared-id' },
        { kind: 'plant', id: 'shared-id' },
      ],
    }))

    expect(zoneGraphic?.stroke.mock.calls.slice(-1)[0]?.[0]).toMatchObject({ width: 1.125 })
    expect(plantGraphic?.stroke.mock.calls.slice(-1)[0]?.[0]).toMatchObject({ width: 4.5 })

    renderer.setViewport({ x: 0, y: 0, scale: 2 })

    expect(zoneGraphic?.stroke.mock.calls.slice(-1)[0]?.[0]).toMatchObject({ width: 2.25 })
    expect(plantGraphic?.stroke.mock.calls.slice(-1)[0]?.[0]).toMatchObject({ width: 4.5 })
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

    const snapshot = createTestSceneRendererSnapshot({
      scene: {
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
      },
      selectedTargets: [{ kind: 'zone', id: 'selected-zone' }],
      highlightedZoneIds: new Set<string>(['hover-zone']),
    })

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

function createRendererSnapshot(overrides: {
  plants?: SceneRendererSnapshot['scene']['plants']
  measurementGuides?: SceneRendererSnapshot['scene']['measurementGuides']
  layers?: SceneRendererSnapshot['scene']['layers']
  plantSpeciesSymbols?: Record<string, string>
  viewport?: SceneRendererSnapshot['viewport']
} = {}): SceneRendererSnapshot {
  return createTestSceneRendererSnapshot({
    scene: {
      plants: overrides.plants ?? [],
      layers: overrides.layers ?? [],
      plantSpeciesSymbols: overrides.plantSpeciesSymbols ?? {},
      measurementGuides: overrides.measurementGuides ?? [],
    },
    viewport: overrides.viewport ?? { x: 0, y: 0, scale: 1 },
  })
}

function createPlant(
  overrides: Partial<SceneRendererSnapshot['scene']['plants'][number]> = {},
): SceneRendererSnapshot['scene']['plants'][number] {
  return {
    kind: 'plant',
    locked: false,
    id: 'plant-1',
    canonicalName: 'Malus domestica',
    commonName: 'Apple',
    color: null,
    stratum: null,
    canopySpreadM: null,
    position: { x: 10, y: 10 },
    rotationDeg: null,
    scale: null,
    notes: null,
    plantedDate: null,
    quantity: 1,
    ...overrides,
  }
}
