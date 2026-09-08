import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectRendererCapabilities } from '../canvas/runtime/renderers/capabilities'
import { RendererHost } from '../canvas/runtime/renderers/host'
import { createPixiSceneRenderer } from '../canvas/runtime/renderers/pixi-scene'
import { createCanvas2DSceneRenderer } from '../canvas/runtime/renderers/canvas2d-scene'

// Browsers bind a canvas to the first successfully created context type.
function createContextLockedCanvas(supported: readonly string[]) {
  let mode: string | null = null
  return {
    getContext(contextId: string) {
      if (!supported.includes(contextId) || (mode !== null && mode !== contextId)) return null
      mode = contextId
      return {}
    },
  }
}

function installCanvasEnvironment(dom: readonly string[] | null, offscreen: readonly string[] | null) {
  const offscreenContexts = offscreen ?? []
  vi.stubGlobal('document', dom === null ? undefined : {
    createElement: () => createContextLockedCanvas(dom),
  })
  vi.stubGlobal('OffscreenCanvas', offscreen === null ? undefined : class {
    getContext = createContextLockedCanvas(offscreenContexts).getContext
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('renderer capability detection', () => {
  it.each([
    { name: 'DOM', dom: ['2d', 'webgl', 'webgl2'], offscreen: null, offscreenCanvas2d: false },
    { name: 'OffscreenCanvas', dom: null, offscreen: ['2d', 'webgl', 'webgl2'], offscreenCanvas2d: true },
    { name: 'both canvas APIs', dom: ['2d', 'webgl', 'webgl2'], offscreen: ['2d', 'webgl', 'webgl2'], offscreenCanvas2d: true },
    { name: 'mixed support', dom: ['2d', 'webgl'], offscreen: ['2d', 'webgl2'], offscreenCanvas2d: true },
  ])('detects every supported context with $name', ({ dom, offscreen, offscreenCanvas2d }) => {
    installCanvasEnvironment(dom, offscreen)
    expect(detectRendererCapabilities()).toMatchObject({
      domCanvas: dom !== null,
      canvas2d: true,
      offscreenCanvas2d,
      webgl: true,
      webgl2: true,
    })
  })

  it.each([
    { supported: ['2d'], canvas2d: true, webgl: false, webgl2: false },
    { supported: ['webgl'], canvas2d: false, webgl: true, webgl2: false },
    { supported: ['webgl2'], canvas2d: false, webgl: false, webgl2: true },
    { supported: [], canvas2d: false, webgl: false, webgl2: false },
  ])('does not report unavailable contexts when support is $supported', ({ supported, ...expected }) => {
    installCanvasEnvironment(supported, supported)
    expect(detectRendererCapabilities()).toMatchObject(expected)
  })

  it('handles an environment without canvas APIs', () => {
    expect(detectRendererCapabilities({})).toMatchObject({
      domCanvas: false, canvas2d: false, offscreenCanvas: false,
      offscreenCanvas2d: false, webgl: false, webgl2: false,
    })
  })

  it('handles canvas construction failures', () => {
    vi.stubGlobal('document', { createElement: () => { throw new Error('DOM unavailable') } })
    vi.stubGlobal('OffscreenCanvas', class {
      constructor() { throw new Error('OffscreenCanvas unavailable') }
    })
    expect(detectRendererCapabilities()).toMatchObject({
      domCanvas: false, canvas2d: false, offscreenCanvas2d: false, webgl: false, webgl2: false,
    })
  })

  it('continues independent probes after a context creation failure', () => {
    installCanvasEnvironment(null, ['2d', 'webgl2'])
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => { throw new Error('Context creation failed') } }),
    })
    expect(detectRendererCapabilities()).toMatchObject({
      domCanvas: true, canvas2d: true, offscreenCanvas2d: true, webgl: false, webgl2: true,
    })
  })
})

describe('RendererHost automatic capability selection', () => {
  it.each([
    { name: 'WebGL', supported: ['2d', 'webgl'], gpuFails: false, expected: 'pixi' },
    { name: 'WebGL2', supported: ['2d', 'webgl2'], gpuFails: false, expected: 'pixi' },
    { name: 'unavailable WebGL', supported: ['2d'], gpuFails: false, expected: 'canvas2d' },
    { name: 'failed GPU initialization', supported: ['2d', 'webgl2'], gpuFails: true, expected: 'canvas2d' },
  ])('selects the correct backend with $name', async ({ supported, gpuFails, expected }) => {
    installCanvasEnvironment(supported, null)
    const gpuInitialize = vi.fn(() => {
      if (gpuFails) throw new Error('GPU initialization failed')
      return { id: 'pixi', dispose: vi.fn() }
    })
    const host = new RendererHost({
      backends: [
        { id: 'pixi', supports: createPixiSceneRenderer().supports, initialize: gpuInitialize },
        { id: 'canvas2d', supports: createCanvas2DSceneRenderer().supports, initialize: () => ({ id: 'canvas2d', dispose: vi.fn() }) },
      ],
    })
    try {
      expect((await host.initialize({})).id).toBe(expected)
      expect(host.snapshot.activeBackendId).toBe(expected)
      expect(gpuInitialize).toHaveBeenCalledTimes(supported.length > 1 ? 1 : 0)
      expect(host.snapshot.failedBackendIds).toEqual(gpuFails ? ['pixi'] : [])
    } finally {
      await host.dispose()
    }
  })
})
